import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CatalogDefinition } from '@nexus-ui/core';
import type { AgentGenerationSourceRequest, NexusRunDiagnostic } from '../../src/agent/adapter';
import type { AgentRunManager, AgentRunRecord } from '../../src/agent/run-manager';
import { InMemoryAgentRunManager } from '../../src/agent/run-manager';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';
import {
  InMemorySurfaceActionLedger,
  InMemorySurfaceActionStateStore,
  type SurfaceActionLedgerRecord,
  type SurfaceCommitResult,
} from '../../src/agent/surface-action-state';
import { createAgentRuntime } from '../../src/runtime/runtime-facade';
import { TEST_CATALOG_ID, createTestRegistry } from '../../tests/helpers/test-catalog';
import { allowAllAccess } from '../../tests/helpers/access';

const registry = createTestRegistry();
const HASHED = createCatalogContractHash(registry.get(TEST_CATALOG_ID)!);

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 入队结果收窄：生成必须被接受并以 succeeded 收场。 */
async function settleGenerate(
  outcome: Awaited<ReturnType<ReturnType<typeof createAgentRuntime>['generate']>>,
) {
  assert.ok(outcome.accepted, 'generation must be accepted');
  const result = await outcome.run.result;
  assert.equal(result.terminal, 'succeeded');
  return result;
}

function generationSource(surfaceId: string, value: Record<string, unknown> = {}) {
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

function actionRequest(
  surfaceId: string,
  surfaceRevision: number,
  actionId: string,
): Parameters<ReturnType<typeof createAgentRuntime>['action']>[0] {
  return {
    name: 'submit',
    surfaceId,
    sourceComponentId: 'confirm',
    timestamp: new Date().toISOString(),
    context: {},
    actionId,
    sessionVersion: 1,
    surfaceRevision,
    catalogHash: HASHED,
  };
}

interface GenerationDeps {
  registry: typeof registry;
  createSurfaceId: () => string;
  createGenerationSource: (request: AgentGenerationSourceRequest) => Iterable<unknown>;
  actionStateStore?: unknown;
  actionLedger?: unknown;
  runManager?: AgentRunManager;
  actionHandlers?: Map<string, unknown>;
  onRunDiagnostic?: (d: NexusRunDiagnostic) => void;
  onGenerationCommitted?: (event: unknown) => void;
}

describe('S3.3.4 提交事实证伪：副作用替身与故障 store', () => {
  it('handler 副作用已发生后 patch 提交被拒：notCommitted、不重放、不回滚副作用', async () => {
    const surfaceId = 'cf-side-effect';
    const shared = new InMemorySurfaceActionStateStore();
    let sideEffects = 0;

    // 两个 runtime 共享同一 store：调度互不可见，但权威状态同源。
    const build = (handlers: Map<string, unknown>) =>
      createAgentRuntime({
        access: allowAllAccess,
        registry,
        actionStateStore: shared,
        createSurfaceId: () => surfaceId,
        createGenerationSource: (request: AgentGenerationSourceRequest) =>
          generationSource(request.surfaceId),
        actionHandlers: handlers,
      } as never);

    const seeder = build(new Map());
    const seeded = await seeder.generate({ message: 'seed', catalogId: TEST_CATALOG_ID });
    const seedOutcome = seeded.accepted ? await seeded.run.result : undefined;
    assert.equal(seedOutcome?.terminal, 'succeeded');

    let releaseHandler!: () => void;
    const handlerGate = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const main = build(
      new Map([
        [
          `${TEST_CATALOG_ID}:submit`,
          async function* () {
            sideEffects += 1; // 业务副作用替身：已发生即不可回滚
            await handlerGate;
            yield {
              version: 'v0.9',
              updateDataModel: { surfaceId, value: { done: true } },
            };
          },
        ],
      ]),
    );
    const action = await main.action(actionRequest(surfaceId, 1, 'cf-se-1'));
    assert.ok(action.accepted);
    await delay(10); // handler 已执行（副作用已发生），patch 提交在途

    // 另一 runtime 在 handler 挂起期间重建同一 surface：epoch/revision 前进。
    const rebuild = await seeder.generate({ message: 'rebuild', catalogId: TEST_CATALOG_ID });
    assert.ok(rebuild.accepted);
    assert.equal((await rebuild.run.result).terminal, 'succeeded');

    releaseHandler();
    const outcome = await action.run.result;
    assert.equal(outcome.terminal, 'failed');
    assert.equal(outcome.commitState, 'notCommitted', 'patch 被拒是确定性未写入');
    assert.equal(sideEffects, 1, '副作用已发生且不被 SDK 重放');
    assert.equal(
      (await shared.get(surfaceId))?.version,
      2,
      '权威快照保持重建后的 revision，旧 patch 不落库',
    );
  });

  it('store 提交异常且无法证明未写入：failed/unknown + RUN_COMMIT_UNKNOWN，不自动重试', async () => {
    const surfaceId = 'cf-unknown-store';
    const inner = new InMemorySurfaceActionStateStore();
    let commitCalls = 0;
    const throwingStore = {
      get: (id: string) => inner.get(id),
      commitGeneration: ((...args: Parameters<typeof inner.commitGeneration>) =>
        inner.commitGeneration(...args)) as unknown as (
        ...args: Parameters<typeof inner.commitGeneration>
      ) => Promise<SurfaceCommitResult>,
      commitAction: async (): Promise<SurfaceCommitResult> => {
        commitCalls += 1;
        throw new Error('disk full after write attempt');
      },
      removeSnapshot: (id: string) => inner.removeSnapshot(id),
    };
    const runtime = createAgentRuntime({
      access: allowAllAccess,
      registry,
      actionStateStore: throwingStore,
      createSurfaceId: () => surfaceId,
      createGenerationSource: (request: AgentGenerationSourceRequest) =>
        generationSource(request.surfaceId),
      actionHandlers: new Map([[`${TEST_CATALOG_ID}:submit`, async function* () {}]]),
    } as never);
    // 面先用正常 store 建立 surface，再换抛错 store 提交 action。
    const normal = createAgentRuntime({
      access: allowAllAccess,
      registry,
      actionStateStore: inner,
      createSurfaceId: () => surfaceId,
      createGenerationSource: (request: AgentGenerationSourceRequest) =>
        generationSource(request.surfaceId),
    });
    const baseline = (
      await settleGenerate(await normal.generate({ message: 'm', catalogId: TEST_CATALOG_ID }))
    ).commit;

    const action = await runtime.action(
      actionRequest(surfaceId, baseline.surfaceRevision, 'cf-u1'),
    );
    assert.ok(action.accepted);
    const outcome = await action.run.result;
    assert.equal(outcome.terminal, 'failed');
    assert.equal(outcome.commitState, 'unknown', '异常不得推断为未提交');
    assert.equal(outcome.code, 'RUN_COMMIT_UNKNOWN');
    assert.equal(commitCalls, 1, 'SDK 不自动重试 store 提交');
  });

  it('store 确定性拒绝（notCommitted）按 RUN_FAILED/notCommitted 传播', async () => {
    const surfaceId = 'cf-not-committed';
    const inner = new InMemorySurfaceActionStateStore();
    const rejectingStore = {
      get: (id: string) => inner.get(id),
      commitGeneration: ((...args: Parameters<typeof inner.commitGeneration>) =>
        inner.commitGeneration(...args)) as unknown as (
        ...args: Parameters<typeof inner.commitGeneration>
      ) => Promise<SurfaceCommitResult>,
      commitAction: async (): Promise<SurfaceCommitResult> => ({
        outcome: 'notCommitted',
        reason: '确定性拒绝',
      }),
      removeSnapshot: (id: string) => inner.removeSnapshot(id),
    };
    const normal = createAgentRuntime({
      access: allowAllAccess,
      registry,
      actionStateStore: inner,
      createSurfaceId: () => surfaceId,
      createGenerationSource: (request: AgentGenerationSourceRequest) =>
        generationSource(request.surfaceId),
    });
    const baseline = (
      await settleGenerate(await normal.generate({ message: 'm', catalogId: TEST_CATALOG_ID }))
    ).commit;

    const runtime = createAgentRuntime({
      access: allowAllAccess,
      registry,
      actionStateStore: rejectingStore,
      createSurfaceId: () => surfaceId,
      createGenerationSource: (request: AgentGenerationSourceRequest) =>
        generationSource(request.surfaceId),
      actionHandlers: new Map([[`${TEST_CATALOG_ID}:submit`, async function* () {}]]),
    } as never);
    const action = await runtime.action(
      actionRequest(surfaceId, baseline.surfaceRevision, 'cf-nc1'),
    );
    assert.ok(action.accepted);
    const outcome = await action.run.result;
    assert.equal(outcome.terminal, 'failed');
    assert.equal(outcome.commitState, 'notCommitted');
    assert.equal(outcome.code, 'RUN_FAILED');
    assert.match(outcome.message ?? '', /确定性拒绝/);
  });

  it('hook 提交失败不回滚快照：succeeded/committed + 诊断 generation-hook', async () => {
    const surfaceId = 'cf-observer-hook';
    const diagnostics: NexusRunDiagnostic[] = [];
    const runtime = createAgentRuntime({
      access: allowAllAccess,
      registry,
      createSurfaceId: () => surfaceId,
      createGenerationSource: (request: AgentGenerationSourceRequest) =>
        generationSource(request.surfaceId),
      onGenerationCommitted: () => {
        throw new Error('host hook failed');
      },
      onRunDiagnostic: (d) => diagnostics.push(d),
    });
    const generated = await runtime.generate({ message: 'm', catalogId: TEST_CATALOG_ID });
    const outcome = await (generated.accepted ? generated.run.result : undefined);
    assert.equal(outcome?.terminal, 'succeeded', '发布点之后的 hook 失败不改写成功事实');
    assert.equal(outcome?.commitState, 'committed');
    assert.ok(outcome?.commit);
    assert.equal(
      (await runtime.adapter.describeSurfaceContract(surfaceId))?.surfaceRevision,
      1,
      'S3.3.2：快照不被 hook 异常删除',
    );
    assert.deepEqual(
      diagnostics.map((d) => d.stage),
      ['generation-hook'],
    );
    assert.match(diagnostics[0]?.message ?? '', /host hook failed/);
  });

  it('recordCommit 抛错：成功事实保留、done 照发、无留存结果、诊断 record-commit', async () => {
    const surfaceId = 'cf-record-failure';
    const diagnostics: NexusRunDiagnostic[] = [];
    const inner = new InMemoryAgentRunManager();
    const failingManager: AgentRunManager = {
      create: (spec) => inner.create(spec),
      recordCommit: () => {
        throw new Error('record store unavailable');
      },
      transition: (id, state, message) => inner.transition(id, state, message),
      get: (id) => inner.get(id),
      listBySurface: (id) => inner.listBySurface(id),
    };
    const runtime = createAgentRuntime({
      access: allowAllAccess,
      registry,
      runManager: failingManager,
      createSurfaceId: () => surfaceId,
      createGenerationSource: (request: AgentGenerationSourceRequest) =>
        generationSource(request.surfaceId),
      onRunDiagnostic: (d) => diagnostics.push(d),
    });
    const generated = await runtime.generate({ message: 'm', catalogId: TEST_CATALOG_ID });
    const outcome = await (generated.accepted ? generated.run.result : undefined);
    assert.equal(outcome?.terminal, 'succeeded', 'store 已确认提交，成功事实不因留存失败改写');
    assert.equal(outcome?.commitState, 'committed');
    assert.ok(outcome?.commit, 'done 携带固定提交');
    const record: AgentRunRecord | undefined = runtime.queryRun(surfaceId, outcome!.commit.runId);
    assert.equal(record?.state, 'succeeded');
    assert.equal(record?.commit, undefined, '留存未完成：不伪造成功留存');
    assert.ok(
      diagnostics.some((d) => d.stage === 'record-commit'),
      '留存失败必须经诊断面报告',
    );
  });

  it('ledger complete 抛错：UI 提交事实成立、诊断 ledger-complete、调度权不泄漏', async () => {
    const surfaceId = 'cf-ledger-complete';
    const diagnostics: NexusRunDiagnostic[] = [];
    let handlerCalls = 0;
    const inner = new InMemorySurfaceActionLedger();
    const throwingLedger = {
      begin(record: Omit<SurfaceActionLedgerRecord, 'startedAt' | 'status'>) {
        return inner.begin(record);
      },
      complete() {
        throw new Error('ledger unavailable');
      },
      get(key: string) {
        return inner.get(key);
      },
    };
    const runtime = createAgentRuntime({
      access: allowAllAccess,
      registry,
      actionLedger: throwingLedger,
      createSurfaceId: () => surfaceId,
      createGenerationSource: (request: AgentGenerationSourceRequest) =>
        generationSource(request.surfaceId),
      actionHandlers: new Map([
        [
          `${TEST_CATALOG_ID}:submit`,
          async function* () {
            handlerCalls += 1;
            yield {
              version: 'v0.9',
              updateDataModel: { surfaceId, value: { n: handlerCalls } },
            };
          },
        ],
      ]),
      onRunDiagnostic: (d: NexusRunDiagnostic) => diagnostics.push(d),
    } as never);
    await settleGenerate(await runtime.generate({ message: 'm', catalogId: TEST_CATALOG_ID }));

    const first = await runtime.action(actionRequest(surfaceId, 1, 'cf-lc-1'));
    assert.ok(first.accepted);
    const outcome = await first.run.result;
    assert.equal(outcome.terminal, 'succeeded', 'UI 提交事实不依赖 ledger complete 成功');
    assert.equal(outcome.commitState, 'committed');
    assert.ok(diagnostics.some((d) => d.stage === 'ledger-complete'));

    const second = await runtime.action(actionRequest(surfaceId, 2, 'cf-lc-2'));
    assert.ok(second.accepted, 'ledger 故障不泄漏 surface 调度权');
    assert.equal((await second.run.result).terminal, 'succeeded');
    assert.equal(handlerCalls, 2);
  });

  it('同 actionId 首试失败后重试被拒：duplicate、handler 累计一次', async () => {
    const surfaceId = 'cf-duplicate';
    let handlerCalls = 0;
    let firstCall = true;
    const runtime = createAgentRuntime({
      access: allowAllAccess,
      registry,
      createSurfaceId: () => surfaceId,
      createGenerationSource: (request: AgentGenerationSourceRequest) =>
        generationSource(request.surfaceId),
      actionHandlers: new Map([
        [
          `${TEST_CATALOG_ID}:submit`,
          async function* () {
            handlerCalls += 1;
            if (firstCall) {
              firstCall = false;
              throw new Error('first attempt failed');
            }
            yield {
              version: 'v0.9',
              updateDataModel: { surfaceId, value: { ok: true } },
            };
          },
        ],
      ]),
    });
    await settleGenerate(await runtime.generate({ message: 'm', catalogId: TEST_CATALOG_ID }));

    const first = await runtime.action(actionRequest(surfaceId, 1, 'cf-dup-1'));
    assert.ok(first.accepted);
    const firstOutcome = await first.run.result;
    assert.equal(firstOutcome.terminal, 'failed');

    const retry = await runtime.action(actionRequest(surfaceId, 1, 'cf-dup-1'));
    assert.ok(retry.accepted, 'S3.3：入队即接受，重入拒绝在调度内');
    const retryOutcome = await retry.run.result;
    assert.equal(retryOutcome.terminal, 'failed', 'failed 不是重试许可');
    assert.equal(retryOutcome.code, 'RUN_ADMISSION_REJECTED');
    assert.match(retryOutcome.message ?? '', /重放或重复/);
    assert.equal(handlerCalls, 1, '同一 actionId 不得再次进入 handler');
  });

  it('ledger 容量满且全部活动：capacity 拒绝且 handler 零调用，额度释放后可再提交', async () => {
    // 同 surface 动作经调度串行，永远不会双记录并发——容量约束由跨 surface 命中。
    const surfaceIds = ['cf-lc-a', 'cf-lc-b'];
    let surfaceCursor = 0;
    let handlerCalls = 0;
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const baselines = new Map<string, number>();
    const runtime = createAgentRuntime({
      access: allowAllAccess,
      registry,
      actionLedger: new InMemorySurfaceActionLedger({ maxRecords: 1 }),
      createSurfaceId: () => surfaceIds[surfaceCursor++ % surfaceIds.length]!,
      createGenerationSource: (request: AgentGenerationSourceRequest) =>
        generationSource(request.surfaceId),
      actionHandlers: new Map([
        [
          `${TEST_CATALOG_ID}:submit`,
          async function* (action: { surfaceId: string }) {
            handlerCalls += 1;
            if (action.surfaceId === surfaceIds[0]) await gate;
            yield {
              version: 'v0.9',
              updateDataModel: { surfaceId: action.surfaceId, value: { n: handlerCalls } },
            };
          },
        ],
      ]),
    });
    for (const surfaceId of surfaceIds) {
      const generated = await runtime.generate({ message: 'm', catalogId: TEST_CATALOG_ID });
      const outcome = await (generated.accepted ? generated.run.result : undefined);
      assert.equal(outcome?.terminal, 'succeeded');
      baselines.set(surfaceId, outcome!.commit.surfaceRevision);
    }

    const first = await runtime.action(
      actionRequest(surfaceIds[0]!, baselines.get(surfaceIds[0]!)!, 'cf-cap-1'),
    );
    assert.ok(first.accepted);
    await delay(10); // surface A 的 ledger 记录进入 running，占满 1 条容量

    const second = await runtime.action(
      actionRequest(surfaceIds[1]!, baselines.get(surfaceIds[1]!)!, 'cf-cap-2'),
    );
    assert.ok(second.accepted);
    const secondOutcome = await second.run.result;
    assert.equal(secondOutcome.terminal, 'failed');
    assert.equal(secondOutcome.code, 'RESOURCE_LIMIT_EXCEEDED');
    assert.equal(handlerCalls, 1, '容量拒绝不得执行 handler');

    releaseFirst();
    const firstOutcome = await first.run.result;
    assert.equal(firstOutcome.terminal, 'succeeded');
    const third = await runtime.action(
      actionRequest(surfaceIds[1]!, baselines.get(surfaceIds[1]!)!, 'cf-cap-3'),
    );
    assert.ok(third.accepted, '终态释放额度后可再入账');
    assert.equal((await third.run.result).terminal, 'succeeded');
    assert.equal(handlerCalls, 2);
  });
});

export type GenerationDepsCheck = GenerationDeps;
export type CatalogDefinitionCheck = CatalogDefinition;
