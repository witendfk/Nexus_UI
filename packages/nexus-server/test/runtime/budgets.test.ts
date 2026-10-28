import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  DEFAULT_MAX_QUEUED_PER_SURFACE,
  DEFAULT_RUN_STREAM_BUDGETS,
  DEFAULT_STORAGE_BUDGETS,
  DEFAULT_SOURCE_CLEANUP_TIMEOUT_MS,
  DEFAULT_SLOW_CONSUMER_TIMEOUT_MS,
  DEFAULT_SSE_HIGH_WATER_MARK,
} from '../../src/index';
import { createAgentRuntime } from '../../src/runtime/runtime-facade';
import type { AgentRuntimeOptions } from '../../src/runtime/agent-runtime';
import { resolveRunStreamBudgets } from '../../src/runtime/budgets';
import { InMemorySurfaceActionStateStore } from '../../src/agent/surface-action-state';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';
import type { AgentAction } from '../../src/agent/adapter';
import {
  TEST_CATALOG_ID,
  TEST_CATALOG_ACTIONS,
  createTestRegistry,
} from '../../tests/helpers/test-catalog';
import { allowAllAccess } from '../../tests/helpers/access';

/**
 * S3.6.1/.2 资源预算（SPEC §6.6，fixtures/session-v1/budgets.json 同源）：
 * - 默认值与共享 fixture 一致；非法配置装配时显式抛错，0 不表示关闭；
 * - run 级消息数/单条字节/累计字节超限 → 流中结构化失败（RESOURCE_LIMIT_
 *   EXCEEDED），不提交、不发布部分 UI，快照与 revision 不变；
 * - executionTimeoutMs/queueTimeoutMs 按取消收敛并释放额度；晚到 handler
 *   输出被丢弃（不假装已杀死，也不放行晚到提交）；
 * - 有活动/排队 run 的 surface 不被快照容量淘汰（store 活动保护）。
 */

const registry = createTestRegistry();
const HASH = createCatalogContractHash(registry.require(TEST_CATALOG_ID));

function surfaceMessages(surfaceId: string, text = 'generated'): unknown[] {
  return [
    { version: 'v0.9', createSurface: { surfaceId, catalogId: TEST_CATALOG_ID } },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Column', children: ['confirm'] },
          {
            id: 'confirm',
            component: 'Button',
            child: 'label',
            action: { event: { name: 'submit', context: {} } },
          },
          { id: 'label', component: 'Text', text },
        ],
      },
    },
    { version: 'v0.9', updateDataModel: { surfaceId, value: { note: 'generated' } } },
  ];
}

function actionRequest(surfaceId: string, surfaceRevision: number, actionId: string): AgentAction {
  return {
    name: TEST_CATALOG_ACTIONS[0],
    surfaceId,
    sourceComponentId: 'confirm',
    timestamp: new Date().toISOString(),
    context: {},
    actionId,
    sessionVersion: 1,
    surfaceRevision,
    catalogHash: HASH,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function runtime(options: Partial<AgentRuntimeOptions> = {}) {
  return createAgentRuntime({
    access: allowAllAccess,
    registry,
    createSurfaceId: () => 'budget-surface',
    createGenerationSource: (request) => surfaceMessages(request.surfaceId),
    actionHandlers: new Map([[`${TEST_CATALOG_ID}:submit`, () => []]]),
    ...options,
  });
}

describe('S3.6 预算默认值与 fixtures/session-v1/budgets.json 同源', () => {
  const root = new URL('../../../../fixtures/session-v1/', import.meta.url);
  const budgets = (
    JSON.parse(readFileSync(new URL('budgets.json', root), 'utf8')) as {
      budgets: Record<string, { default?: number }>;
    }
  ).budgets;

  it('run 级消息流预算默认值一致', () => {
    assert.equal(resolveRunStreamBudgets().maxMessagesPerRun, budgets.maxMessagesPerRun.default);
    assert.equal(resolveRunStreamBudgets().maxBytesPerMessage, budgets.maxBytesPerMessage.default);
    assert.equal(
      resolveRunStreamBudgets().maxTotalBytesPerRun,
      budgets.maxTotalBytesPerRun.default,
    );
    assert.equal(resolveRunStreamBudgets().executionTimeoutMs, null);
  });

  it('持久状态、事件消费和关闭期限读取共享 fixture', () => {
    for (const [key, value] of Object.entries(DEFAULT_STORAGE_BUDGETS)) {
      assert.equal(value, budgets[key].default, key);
    }
    assert.equal(DEFAULT_SOURCE_CLEANUP_TIMEOUT_MS, budgets.sourceCleanupTimeoutMs.default);
  });

  it('SSE 与排队预算默认值一致', () => {
    assert.equal(DEFAULT_SSE_HIGH_WATER_MARK, budgets.sseHighWaterMark.default);
    assert.equal(DEFAULT_SLOW_CONSUMER_TIMEOUT_MS, budgets.slowConsumerTimeoutMs.default);
    assert.equal(DEFAULT_MAX_QUEUED_PER_SURFACE, budgets.maxQueuedPerSurface.default);
    assert.equal(DEFAULT_RUN_STREAM_BUDGETS.maxMessagesPerRun, 2_000);
  });
});

describe('S3.6.1 预算装配校验', () => {
  it('非法数值预算在工厂初始化时抛错，0 不表示关闭', () => {
    assert.throws(
      () => runtime({ budgets: { maxMessagesPerRun: 0 } }),
      /maxMessagesPerRun 必须是正安全整数/,
    );
    assert.throws(
      () => runtime({ budgets: { maxBytesPerMessage: -1 } }),
      /maxBytesPerMessage 必须是正安全整数/,
    );
    assert.throws(() => runtime({ budgets: { sseHighWaterMark: Number.NaN } }), /sseHighWaterMark/);
  });

  it('可空超时项只接受正安全整数或显式 null', () => {
    assert.throws(() => runtime({ budgets: { executionTimeoutMs: 1.5 } }), /executionTimeoutMs/);
    assert.throws(() => runtime({ budgets: { queueTimeoutMs: 0 } }), /queueTimeoutMs/);
    // null 显式关闭（默认不启用），不抛错。
    runtime({ budgets: { executionTimeoutMs: null, queueTimeoutMs: null } });
  });
});

describe('S3.6.2 run 级消息流预算', () => {
  it('消息条数超限：RESOURCE_LIMIT_EXCEEDED，不提交、快照不存在（无部分 UI）', async () => {
    const instance = runtime({
      budgets: { maxMessagesPerRun: 2 },
      createGenerationSource: (request) => surfaceMessages(request.surfaceId),
    });
    const enqueued = await instance.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(enqueued.accepted);
    const outcome = await enqueued.run.result;
    assert.equal(outcome.terminal, 'failed');
    assert.ok(outcome.terminal === 'failed');
    assert.equal(outcome.code, 'RESOURCE_LIMIT_EXCEEDED');
    assert.equal(outcome.commitState, 'notCommitted');
    // 超限不发布部分 UI：surface 快照未建立，revision 不存在。
    assert.equal(await instance.adapter.describeSurfaceContract('budget-surface'), undefined);
  });

  it('单条消息字节超限：同口径结构化失败', async () => {
    const big = 'x'.repeat(1_500_000);
    const instance = runtime({
      budgets: { maxBytesPerMessage: 1_000_000 },
      createGenerationSource: (request) => [
        {
          version: 'v0.9',
          createSurface: { surfaceId: request.surfaceId, catalogId: TEST_CATALOG_ID },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: request.surfaceId,
            components: [{ id: 'root', component: 'Text', text: big }],
          },
        },
      ],
    });
    const enqueued = await instance.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(enqueued.accepted);
    const outcome = await enqueued.run.result;
    assert.ok(outcome.terminal === 'failed');
    assert.equal(outcome.code, 'RESOURCE_LIMIT_EXCEEDED');
    assert.match(outcome.message ?? '', /单条消息字节超过预算/);
  });

  it('累计字节超限：多小消息累加触发，非只限条数', async () => {
    const chunk = 'y'.repeat(900);
    const instance = runtime({
      budgets: { maxTotalBytesPerRun: 2_000 },
      createGenerationSource: (request) => [
        {
          version: 'v0.9',
          createSurface: { surfaceId: request.surfaceId, catalogId: TEST_CATALOG_ID },
        },
        ...Array.from({ length: 5 }, () => ({
          version: 'v0.9',
          updateDataModel: { surfaceId: request.surfaceId, value: { fill: chunk } },
        })),
      ],
    });
    const enqueued = await instance.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(enqueued.accepted);
    const outcome = await enqueued.run.result;
    assert.ok(outcome.terminal === 'failed');
    assert.equal(outcome.code, 'RESOURCE_LIMIT_EXCEEDED');
    assert.match(outcome.message ?? '', /累计消息字节超过预算/);
  });

  it('预算内的合法流不受影响（对照）', async () => {
    const instance = runtime({ budgets: { maxMessagesPerRun: 3 } });
    const enqueued = await instance.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(enqueued.accepted);
    assert.equal((await enqueued.run.result).terminal, 'succeeded');
  });
});

describe('S3.6.1 执行超时（executionTimeoutMs）', () => {
  it('超时按取消收敛、宿主退出前拒绝重叠、晚到输出被丢弃', async () => {
    const gate = deferred();
    let zombieHandlerReturned = false;
    const instance = runtime({
      budgets: { executionTimeoutMs: 80 },
      actionHandlers: new Map([
        [
          `${TEST_CATALOG_ID}:submit`,
          (action: AgentAction) => {
            if (action.actionId === 'timeout-run') {
              return (async function* () {
                await gate.promise;
                zombieHandlerReturned = true;
                yield {
                  version: 'v0.9',
                  updateDataModel: { surfaceId: action.surfaceId, value: { zombie: true } },
                };
              })();
            }
            return [];
          },
        ],
      ]),
    });
    const setup = await instance.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(setup.accepted);
    const baseline = await setup.run.result;
    assert.ok(baseline.terminal === 'succeeded');

    const zombie = await instance.action(
      actionRequest('budget-surface', baseline.commit!.surfaceRevision, 'timeout-run'),
    );
    assert.ok(zombie.accepted);
    const started = Date.now();
    const outcome = await zombie.run.result;
    assert.equal(outcome.terminal, 'canceled');
    assert.ok(Date.now() - started < 5_000, '超时后运行收敛，不悬挂');

    const blocked = await instance.action(
      actionRequest('budget-surface', baseline.commit!.surfaceRevision, 'blocked'),
    );
    assert.equal(blocked.accepted, false, '旧 handler 未退出前不能启动后续业务');

    // 残留 handler 稍后返回：晚到输出被丢弃，不改写权威状态。
    gate.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    assert.ok(zombieHandlerReturned, '不假装已杀死 handler：宿主代码自行结束');
    const successor = await instance.action(
      actionRequest('budget-surface', baseline.commit!.surfaceRevision, 'after-timeout'),
    );
    assert.ok(successor.accepted);
    const successorOutcome = await successor.run.result;
    assert.equal(successorOutcome.terminal, 'succeeded');
    assert.ok(successorOutcome.terminal === 'succeeded');
    assert.equal(
      successorOutcome.commit.surfaceRevision,
      baseline.commit!.surfaceRevision + 1,
      '僵尸输出没有产生第二次提交',
    );
    assert.equal(
      (await instance.adapter.describeSurfaceContract('budget-surface'))?.surfaceRevision,
      successorOutcome.commit.surfaceRevision,
    );
  });
});

describe('S3.6.1 排队超时（queueTimeoutMs）', () => {
  it('排队超过时限按取消收敛并释放额度，任务体不启动', async () => {
    const hold = deferred();
    let firstEntered = false;
    const instance = runtime({
      budgets: { queueTimeoutMs: 80 },
      createGenerationSource: (request) =>
        (async function* () {
          if (!firstEntered) {
            firstEntered = true;
            await hold.promise;
          }
          yield* surfaceMessages(request.surfaceId);
        })(),
    });
    const first = await instance.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(first.accepted);
    const queued = await instance.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(queued.accepted);
    const outcome = await queued.run.result;
    assert.equal(outcome.terminal, 'canceled');
    // 排队取消无 start（既有契约）；额度释放后新运行可入队。
    const third = await instance.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(third.accepted);
    hold.resolve();
    assert.equal((await first.run.result).terminal, 'succeeded');
    assert.equal((await third.run.result).terminal, 'succeeded');
  });
});

describe('S3.6.1 surface 快照活动保护', () => {
  it('有活动 run 的 surface 不被容量淘汰，action 照常提交', async () => {
    const handlerGate = deferred();
    let surfaceCounter = 0;
    const instance = runtime({
      budgets: { surfaceSnapshots: 1 },
      actionStateStore: new InMemorySurfaceActionStateStore({ maxSurfaces: 1 }),
      createSurfaceId: () => `pin-${++surfaceCounter}`,
      createGenerationSource: (request) => surfaceMessages(request.surfaceId),
      actionHandlers: new Map([
        [
          `${TEST_CATALOG_ID}:submit`,
          (action: AgentAction) =>
            action.actionId === 'held-action'
              ? (async function* () {
                  await handlerGate.promise;
                  yield {
                    version: 'v0.9',
                    updateDataModel: { surfaceId: action.surfaceId, value: { acted: true } },
                  };
                })()
              : [],
        ],
      ]),
    });
    const setup = await instance.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(setup.accepted);
    const baseline = await setup.run.result;
    assert.ok(baseline.terminal === 'succeeded');
    const heldSurface = baseline.commit!.surfaceId; // pin-1

    // pin-1 上的活动 action（handler 挂起）→ surface 受活动保护。
    const action = await instance.action(
      actionRequest(heldSurface, baseline.commit!.surfaceRevision, 'held-action'),
    );
    assert.ok(action.accepted);
    await new Promise<void>((resolve) => setTimeout(resolve, 30));

    // 全部快照受保护时，硬预算在 source 工厂之前拒绝新 surface。
    const pressure = await instance.generate({ catalogId: TEST_CATALOG_ID });
    assert.equal(pressure.accepted, false);

    // 活动保护生效：pin-1 快照仍在，action 正常提交并推进 revision。
    handlerGate.resolve();
    const outcome = await action.run.result;
    assert.equal(outcome.terminal, 'succeeded');
    assert.ok(outcome.terminal === 'succeeded');
    assert.ok(
      outcome.commit.surfaceRevision > baseline.commit!.surfaceRevision,
      'action 在被保护的快照上推进 revision',
    );
    assert.equal(
      (await instance.adapter.describeSurfaceContract(heldSurface))?.surfaceRevision,
      outcome.commit.surfaceRevision,
      '被保护 surface 的固定结果与查询一致',
    );
  });
});
