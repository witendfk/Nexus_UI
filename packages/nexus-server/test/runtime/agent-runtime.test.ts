import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AgentAction, AgentGenerationSourceRequest } from '../../src/agent/adapter';
import { InMemoryAgentRunManager } from '../../src/agent/run-manager';
import { InMemorySurfaceActionStateStore } from '../../src/agent/surface-action-state';
import { createAgentRuntime } from '../../src/runtime/runtime-facade';
import type { RuntimeRunHandle } from '../../src/runtime/run-handle';
import {
  CATALOG_CONTRACT_VERSION,
  createCatalogContractHash,
} from '../../src/agent/catalog-contract';
import { TEST_CATALOG_ID, createTestRegistry } from '../../tests/helpers/test-catalog';

const registry = createTestRegistry();
const HASH = createCatalogContractHash(registry.get(TEST_CATALOG_ID)!);
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function generationSource(surfaceId: string, value: Record<string, unknown>) {
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
          { id: 'label', component: 'Text', text: '提交' },
        ],
      },
    },
    { version: 'v0.9', updateDataModel: { surfaceId, value } },
  ];
}

function actionRequest(surfaceId: string, surfaceRevision: number, actionId: string) {
  return {
    name: 'submit',
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

/** 最小非 Koa 接入：不构造任何 HTTP 对象即完成生成 → action 全链。 */
describe('createAgentRuntime 传输无关入口（S3.2.1）', () => {
  it('非 Koa 消费：generate 产出 start/message*/done 事件并自动提交', async () => {
    const runtime = createAgentRuntime({
      registry,
      createSurfaceId: () => 'rt-gen-1',
      createGenerationSource: (request) => generationSource(request.surfaceId, { title: 't' }),
    });
    const enqueued = await runtime.generate({ message: '建面', catalogId: TEST_CATALOG_ID });
    assert.ok(enqueued.accepted, 'S3.2：入队即建立 queued 记录');
    const run = enqueued.run;

    const events: string[] = [];
    let startEvent: Record<string, unknown> | undefined;
    for await (const event of run.events()) {
      events.push(event.type);
      if (event.type === 'start') startEvent = { ...event };
    }
    assert.deepEqual(events, ['start', 'message', 'message', 'message', 'done']);
    assert.equal(startEvent?.sessionVersion, 1);
    assert.equal(startEvent?.runId, run.runId);
    assert.equal(startEvent?.surfaceId, 'rt-gen-1');
    assert.equal(startEvent?.catalogId, TEST_CATALOG_ID);
    assert.equal(startEvent?.contractVersion, CATALOG_CONTRACT_VERSION);
    assert.equal(startEvent?.catalogHash, HASH);
    assert.equal(
      'surfaceRevision' in (startEvent ?? {}),
      false,
      '生成运行无旧基准，不带 surfaceRevision',
    );

    const outcome = await run.result;
    assert.equal(outcome.terminal, 'succeeded');
    assert.equal(outcome.commitState, 'committed');
    assert.equal(outcome.commit?.surfaceRevision, 1);
    assert.equal(runtime.queryRun('rt-gen-1', run.runId)?.state, 'succeeded');
  });

  it('action 同入口：start 绑定调度内基准 revision，空参数提交合法', async () => {
    let handlerCalls = 0;
    const runtime = createAgentRuntime({
      registry,
      createSurfaceId: () => 'rt-action-1',
      createGenerationSource: (request) => generationSource(request.surfaceId, { score: 3 }),
      actionHandlers: new Map([
        [
          `${TEST_CATALOG_ID}:submit`,
          async (action) => {
            handlerCalls += 1;
            return [
              {
                version: 'v0.9',
                updateDataModel: { surfaceId: action.surfaceId, value: { score: 5 } },
              },
            ];
          },
        ],
      ]),
    });

    const generated = await runtime.generate({ message: 'm', catalogId: TEST_CATALOG_ID });
    const genOutcome = generated.accepted ? await generated.run.result : undefined;
    assert.equal(genOutcome?.terminal, 'succeeded');

    const enqueued = await runtime.action(
      actionRequest('rt-action-1', genOutcome!.commit.surfaceRevision, 'rt-action-1'),
    );
    assert.ok(enqueued.accepted);

    let startRevision: number | undefined;
    for await (const event of enqueued.run.events()) {
      if (event.type === 'start') startRevision = event.surfaceRevision;
    }
    assert.equal(startRevision, 1, 'action start 必须携带调度内实际读取的基准 revision');
    const outcome = await enqueued.run.result;
    assert.equal(outcome.terminal, 'succeeded');
    assert.equal(handlerCalls, 1);
    assert.equal(outcome.commit?.surfaceRevision, 2);
  });

  it('实例隔离：两个 runtime 的同名 surface 互不阻塞、记录互不可见', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const heldSource = (request: AgentGenerationSourceRequest) =>
      (async function* () {
        // 第一个 runtime 的生成源在调度内挂起：快照未提交、surface 槽位被占。
        await gate;
        yield* generationSource(request.surfaceId, {});
      })();
    const freeSource = (request: AgentGenerationSourceRequest) =>
      (async function* () {
        yield* generationSource(request.surfaceId, {});
      })();
    const first = createAgentRuntime({
      registry,
      createSurfaceId: () => 'shared-surface',
      createGenerationSource: heldSource,
    });
    const second = createAgentRuntime({
      registry,
      createSurfaceId: () => 'shared-surface',
      createGenerationSource: freeSource,
    });

    const firstRun = await first.generate({ message: 'm', catalogId: TEST_CATALOG_ID });
    assert.ok(firstRun.accepted);
    await delay(10);
    assert.equal(
      await first.adapter.describeSurfaceContract('shared-surface'),
      undefined,
      '调度内提交未完成前不得有快照',
    );

    const secondRun = await second.generate({ message: 'm', catalogId: TEST_CATALOG_ID });
    assert.ok(secondRun.accepted);
    const secondOutcome = await secondRun.run.result;
    assert.equal(secondOutcome.terminal, 'succeeded', '跨 runtime 同名 surface 不得互相阻塞');

    release();
    const firstOutcome = await firstRun.run.result;
    assert.equal(firstOutcome.terminal, 'succeeded');
    assert.equal(first.queryRun('shared-surface', secondRun.run.runId), undefined);
    assert.equal(second.queryRun('shared-surface', firstRun.run.runId), undefined);
    assert.ok(first.listRuns('shared-surface').length >= 1);
  });

  it('排队容量在入队拒绝：无运行记录、额度释放后可再入队', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = createAgentRuntime({
      registry,
      scheduler: { maxQueuedPerSurface: 1 },
      createSurfaceId: () => 'rt-capacity',
      createGenerationSource: (request) =>
        (async function* () {
          // 首个运行挂起在生成源内：占住运行槽。
          await gate;
          yield* generationSource(request.surfaceId, {});
        })(),
    });
    const running = await runtime.generate({ message: 'm', catalogId: TEST_CATALOG_ID });
    assert.ok(running.accepted);
    await delay(10);

    const queued = await runtime.generate({ message: 'm', catalogId: TEST_CATALOG_ID });
    assert.ok(queued.accepted, '1 个排队额度可用');
    const rejected = await runtime.generate({ message: 'm', catalogId: TEST_CATALOG_ID });
    assert.deepEqual(
      {
        accepted: rejected.accepted,
        stage: rejected.accepted ? undefined : rejected.stage,
        code: rejected.accepted ? undefined : rejected.code,
      },
      { accepted: false, stage: 'capacity', code: 'RUN_CAPACITY_REJECTED' },
    );
    assert.equal(
      runtime.listRuns('rt-capacity').filter((record) => record.state === 'queued').length,
      1,
      '被拒绝的请求不得创建运行记录',
    );
    release();
    assert.equal((await queued.run.result).terminal, 'succeeded');
    assert.equal((await running.run.result).terminal, 'succeeded');
  });

  it('排队取消先于生成源工厂：canceled 终态、排队运行工厂零调用', async () => {
    let factoryCalls = 0;
    const runtime = createAgentRuntime({
      registry,
      createSurfaceId: () => 'rt-cancel-queued',
      createGenerationSource: (request) => {
        factoryCalls += 1;
        return generationSource(request.surfaceId, {});
      },
    });
    const running = await runtime.generate({ message: 'm', catalogId: TEST_CATALOG_ID });
    assert.ok(running.accepted);
    await delay(10); // 运行槽上的首任务已调用工厂
    const queued = await runtime.generate({ message: 'm', catalogId: TEST_CATALOG_ID });
    assert.ok(queued.accepted);

    queued.run.cancel();
    const outcome = await queued.run.result;
    assert.equal(outcome.terminal, 'canceled');
    assert.equal(outcome.commitState, 'notCommitted');
    assert.equal(factoryCalls, 1, '排队取消必须先于 source 工厂（只有运行槽任务调用过）');
    await delay(10);
    assert.equal(runtime.queryRun('rt-cancel-queued', queued.run.runId)?.state, 'canceled');
    assert.equal((await running.run.result).terminal, 'succeeded');
  });

  it('prepare* 兼容外壳与 runtime 入口共享同一调度（同 surface 串行）', async () => {
    const runtime = createAgentRuntime({
      registry,
      createSurfaceId: () => 'rt-shell',
      createGenerationSource: (request) => generationSource(request.surfaceId, {}),
    });
    const viaRuntime = await runtime.generate({ message: 'm', catalogId: TEST_CATALOG_ID });
    const viaShell = await runtime.adapter.prepareGeneration({
      message: 'm',
      catalogId: TEST_CATALOG_ID,
    });
    assert.ok(viaShell.ok);
    const first = viaRuntime.accepted ? await viaRuntime.run.result : undefined;
    const second = await viaShell.run.result;
    assert.equal(first?.terminal, 'succeeded');
    assert.equal(second.terminal, 'succeeded');
    // 同一 adapter scheduler：两次生成串行提交，revision 单调 1 → 2。
    assert.equal(first?.commit?.surfaceRevision, 1);
    assert.equal(second.commit.surfaceRevision, 2);
  });

  // —— S3.2 评审修复反例（P1-1/P1-2/P1-4） ——

  it('dispose 撞上在途提交：store 确认后终态保持 succeeded/committed，不倒写', async () => {
    // 受控 store：让 commitGeneration 挂在闸门上，dispose 恰好在写入在途时到达。
    const inner = new InMemorySurfaceActionStateStore();
    let releaseCommit!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    let commitEntered = false;
    const store = {
      get: (id: string) => inner.get(id),
      commitGeneration: async (...args: Parameters<typeof inner.commitGeneration>) => {
        commitEntered = true;
        await gate;
        return inner.commitGeneration(...args);
      },
      commitAction: (...args: Parameters<typeof inner.commitAction>) => inner.commitAction(...args),
      removeSnapshot: (id: string) => inner.removeSnapshot(id),
    };
    const racing = createAgentRuntime({
      registry,
      actionStateStore: store,
      createSurfaceId: () => 'rt-dispose-race',
      createGenerationSource: (request) => generationSource(request.surfaceId, {}),
    });
    const enqueued = await racing.generate({ message: 'm', catalogId: TEST_CATALOG_ID });
    assert.ok(enqueued.accepted);
    const run = enqueued.run;
    for await (const event of run.events()) {
      if (event.type === 'message') break; // 订阅保持存活（直接订阅模式）
    }
    // 等待 store 写入进入在途窗口，再调用公开 dispose。
    await new Promise<void>((resolve) => {
      const check = () => (commitEntered ? resolve() : setTimeout(check, 1));
      check();
    });
    run.dispose();

    releaseCommit();
    const outcome = await run.result;
    assert.equal(outcome.terminal, 'succeeded', 'store 确认提交必须胜过竞态 dispose');
    assert.equal(outcome.commitState, 'committed');
    assert.equal(
      (await racing.adapter.describeSurfaceContract('rt-dispose-race'))?.surfaceRevision,
      1,
      '快照已发布',
    );
  });

  it('终态后不得再有任何事件（直接订阅者守卫）', async () => {
    let releaseSource!: () => void;
    const sourceGate = new Promise<void>((resolve) => {
      releaseSource = resolve;
    });
    const runtime = createAgentRuntime({
      registry,
      createSurfaceId: () => 'rt-post-terminal',
      createGenerationSource: (request) =>
        (async function* () {
          yield* generationSource(request.surfaceId, {}).slice(0, 2);
          await sourceGate; // 第三条消息挂起，制造「拉取在飞」窗口
          yield generationSource(request.surfaceId, {})[2];
        })(),
    });
    const enqueued = await runtime.generate({ message: 'm', catalogId: TEST_CATALOG_ID });
    assert.ok(enqueued.accepted);
    const run = enqueued.run;
    const seen: string[] = [];
    run.subscribe((event) => seen.push(event.type));
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    run.dispose(); // 挂起的拉取在飞时终止 → 取消终态
    releaseSource();
    await run.result;
    assert.equal(seen[seen.length - 1], 'error', '最后事件必须是终态');
    assert.ok(!seen.slice(0, -1).includes('error'), '终态唯一');
    assert.equal(seen.filter((type) => type === 'done').length, 0);
  });

  it('候选被拒时宿主生成器 finally 必须执行（source return）', async () => {
    let sourceClosed = false;
    const runtime = createAgentRuntime({
      registry,
      createSurfaceId: () => 'rt-source-return',
      createGenerationSource: (request) =>
        (async function* () {
          try {
            yield* generationSource(request.surfaceId, {});
            yield {
              version: 'v0.9',
              updateComponents: {
                surfaceId: request.surfaceId,
                components: [{ id: 'ghost', component: 'NoSuchComponent', text: 'x' }],
              },
            };
          } finally {
            sourceClosed = true;
          }
        })(),
    });
    const enqueued = await runtime.generate({ message: 'm', catalogId: TEST_CATALOG_ID });
    assert.ok(enqueued.accepted);
    const outcome = await enqueued.run.result;
    assert.equal(outcome.terminal, 'failed', '未声明组件候选必须被候选 guard 拒绝');
    assert.equal(sourceClosed, true, '早退路径必须关闭宿主生成器');
  });
});

// RuntimeRunHandle 类型仅作类型面导入校验（防止公开类型漂移）。
export type HandleCheck = RuntimeRunHandle;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function within<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('运行终态未收敛')), 500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe('S3.2 独立复审回归', () => {
  it('同一记录所有者不能装配冲突调度器，拒绝后原 runtime 仍可用', async () => {
    const manager = new InMemoryAgentRunManager();
    const runtime = createAgentRuntime({
      registry,
      runManager: manager,
      scheduler: { maxQueuedPerSurface: 1 },
      createGenerationSource: (r) => generationSource(r.surfaceId, {}),
    });
    assert.throws(
      () =>
        createAgentRuntime({
          registry,
          runManager: manager,
          scheduler: { maxQueuedPerSurface: 2 },
        }),
      /只能绑定一个 scheduler/,
    );
    const next = await runtime.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(next.accepted);
    assert.equal((await within(next.run.result)).terminal, 'succeeded');
  });

  it('入队后修改 surfaceId 不得把 A 队列任务转向仍活动的 B', async () => {
    let nextSurface = 'a';
    const holdA = deferred(),
      holdB = deferred();
    const enteredA = deferred(),
      enteredB = deferred();
    let activeB = 0,
      peakB = 0;
    const runtime = createAgentRuntime({
      registry,
      createSurfaceId: () => nextSurface,
      createGenerationSource: (request) => generationSource(request.surfaceId, {}),
      actionHandlers: new Map([
        [
          `${TEST_CATALOG_ID}:submit`,
          async (action) => {
            if (action.surfaceId === 'b') {
              activeB += 1;
              peakB = Math.max(peakB, activeB);
            }
            if (action.actionId === 'hold-a') {
              enteredA.resolve();
              await holdA.promise;
            }
            if (action.actionId === 'hold-b') {
              enteredB.resolve();
              await holdB.promise;
            }
            if (action.surfaceId === 'b') activeB -= 1;
            return [];
          },
        ],
      ]),
    });
    const a = await runtime.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(a.accepted);
    const ac = await a.run.result;
    assert.equal(ac.terminal, 'succeeded');
    nextSurface = 'b';
    const b = await runtime.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(b.accepted);
    const bc = await b.run.result;
    assert.equal(bc.terminal, 'succeeded');
    const first = await runtime.action(actionRequest('a', ac.commit.surfaceRevision, 'hold-a'));
    const second = await runtime.action(actionRequest('b', bc.commit.surfaceRevision, 'hold-b'));
    assert.ok(first.accepted && second.accepted);
    await Promise.all([enteredA.promise, enteredB.promise]);
    try {
      const request = actionRequest('a', ac.commit.surfaceRevision, 'redirect');
      const queued = await runtime.action(request);
      assert.ok(queued.accepted);
      request.surfaceId = 'b';
      request.surfaceRevision = bc.commit.surfaceRevision;
      holdA.resolve();
      const outcome = await within(queued.run.result);
      assert.equal(outcome.terminal, 'failed', '原 A 基准在前一提交后失效，应拒绝');
      assert.equal(peakB, 1, '不得绕过 B 的调度调用第二个 handler');
      assert.equal(
        (await runtime.adapter.describeSurfaceContract('b'))?.surfaceRevision,
        bc.commit.surfaceRevision,
      );
    } finally {
      holdA.resolve();
      holdB.resolve();
      await Promise.all([first.run.result, second.run.result]);
    }
  });

  it('入队请求的 context 与 inputs 嵌套引用同样隔离', async () => {
    const gate = deferred(),
      entered = deferred();
    const runtime = createAgentRuntime({
      registry,
      createSurfaceId: () => 'request-copy',
      createGenerationSource: (r) => generationSource(r.surfaceId, {}),
      resolveActionContext: async ({ params }) => {
        entered.resolve();
        await gate.promise;
        return params;
      },
      actionHandlers: new Map([[`${TEST_CATALOG_ID}:submit`, () => []]]),
    });
    const gen = await runtime.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(gen.accepted);
    const baseline = await gen.run.result;
    assert.equal(baseline.terminal, 'succeeded');
    const request: AgentAction = {
      ...actionRequest('request-copy', baseline.commit.surfaceRevision, 'nested'),
      inputs: [],
    };
    const pending = runtime.action(request);
    // 调用返回后、异步准入继续前改变原数组/对象。
    request.context.untrusted = 'changed';
    (request.inputs as unknown[]).push({ componentId: 'missing', property: 'value', value: 'bad' });
    const enqueued = await pending;
    assert.ok(enqueued.accepted);
    try {
      // 旧实现会在 resolver 前被修改后的输入拒绝，不能等待 entered 永久悬挂。
      await within(Promise.race([entered.promise, enqueued.run.result.then(() => undefined)]));
      gate.resolve();
      assert.equal((await within(enqueued.run.result)).terminal, 'succeeded');
    } finally {
      gate.resolve();
    }
  });

  it('failed transition 抛错仍发布 error、结束 result 并释放同 surface', async () => {
    class ThrowingManager extends InMemoryAgentRunManager {
      override transition(
        id: string,
        state: Parameters<InMemoryAgentRunManager['transition']>[1],
        message?: string,
      ) {
        if (state === 'failed') throw new Error('record write unavailable');
        super.transition(id, state, message);
      }
    }
    let failSource = true;
    const runtime = createAgentRuntime({
      registry,
      runManager: new ThrowingManager(),
      createSurfaceId: () => 'record-fault',
      createGenerationSource: (r) => {
        if (failSource) throw new Error('source unavailable');
        return generationSource(r.surfaceId, {});
      },
    });
    const failed = await runtime.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(failed.accepted);
    const events: string[] = [];
    failed.run.subscribe((event) => events.push(event.type));
    const outcome = await within(failed.run.result);
    assert.equal(outcome.terminal, 'failed');
    assert.ok(
      outcome.diagnostics?.some((d) => (d as { code?: string }).code === 'RUN_LIFECYCLE_ERROR'),
    );
    assert.equal(events.at(-1), 'error');
    assert.equal(events.filter((t) => t === 'error').length, 1);
    failSource = false;
    const next = await runtime.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(next.accepted);
    assert.equal((await within(next.run.result)).terminal, 'succeeded');
  });

  it('排队取消的记录写入抛错仍收敛句柄、释放额度且不调用工厂', async () => {
    class ThrowingManager extends InMemoryAgentRunManager {
      override transition(
        id: string,
        state: Parameters<InMemoryAgentRunManager['transition']>[1],
        message?: string,
      ) {
        if (state === 'canceled') throw new Error('cancel record unavailable');
        super.transition(id, state, message);
      }
    }
    const gate = deferred(),
      entered = deferred();
    let factories = 0;
    const runtime = createAgentRuntime({
      registry,
      runManager: new ThrowingManager(),
      scheduler: { maxQueuedPerSurface: 1 },
      createSurfaceId: () => 'cancel-fault',
      createGenerationSource: (r) => {
        factories++;
        return (async function* () {
          entered.resolve();
          await gate.promise;
          yield* generationSource(r.surfaceId, {});
        })();
      },
    });
    const active = await runtime.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(active.accepted);
    await entered.promise;
    try {
      const queued = await runtime.generate({ catalogId: TEST_CATALOG_ID });
      assert.ok(queued.accepted);
      assert.doesNotThrow(() => queued.run.cancel());
      const outcome = await within(queued.run.result);
      assert.equal(outcome.terminal, 'canceled');
      assert.equal(factories, 1);
      const replacement = await runtime.generate({ catalogId: TEST_CATALOG_ID });
      assert.ok(replacement.accepted);
      replacement.run.cancel();
      await within(replacement.run.result);
    } finally {
      gate.resolve();
      await active.run.result;
    }
  });
});
