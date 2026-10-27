import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAgentRuntime } from '../../src/runtime/runtime-facade';
import type { AgentRuntimeOptions } from '../../src/runtime/agent-runtime';
import { InMemoryAgentRunManager } from '../../src/agent/run-manager';
import {
  InMemorySurfaceActionLedger,
  InMemorySurfaceActionStateStore,
  type SurfaceCommitResult,
} from '../../src/agent/surface-action-state';
import type { NexusRunDiagnostic } from '../../src/agent/adapter';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';
import { createTestRegistry, TEST_CATALOG_ID } from '../../tests/helpers/test-catalog';
import { allowAllAccess } from '../../tests/helpers/access';

const registry = createTestRegistry();
const hash = createCatalogContractHash(registry.require(TEST_CATALOG_ID));
const surfaceId = 'commit-faults';
const source = () => [
  { version: 'v0.9', createSurface: { surfaceId, catalogId: TEST_CATALOG_ID } },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [
        { id: 'root', component: 'Column', children: ['btn'] },
        {
          id: 'btn',
          component: 'Button',
          child: 'label',
          action: { event: { name: 'submit', context: {} } },
        },
        { id: 'label', component: 'Text', text: 'Submit' },
      ],
    },
  },
];
const action = (actionId: string) => ({
  name: 'submit',
  surfaceId,
  sourceComponentId: 'btn',
  timestamp: new Date().toISOString(),
  context: {},
  actionId,
  sessionVersion: 1,
  surfaceRevision: 1,
  catalogHash: hash,
});
function runtime(options: Partial<AgentRuntimeOptions> = {}) {
  return createAgentRuntime({
    access: allowAllAccess,
    registry,
    createSurfaceId: () => surfaceId,
    createGenerationSource: source,
    actionHandlers: new Map([[`${TEST_CATALOG_ID}:submit`, () => []]]),
    ...options,
  });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function seed(r: ReturnType<typeof runtime>) {
  const q = await r.generate({ catalogId: TEST_CATALOG_ID });
  assert.ok(q.accepted);
  assert.equal((await q.run.result).terminal, 'succeeded');
}

describe('S3.3 复审：提交事实与组合故障', () => {
  it('提交前最终 Policy 拒绝释放 ledger，保留去重并允许新 action', async () => {
    let deny = false,
      handlers = 0,
      writes = 0;
    const ledger = new InMemorySurfaceActionLedger({ maxRecords: 1 });
    const store = new InMemorySurfaceActionStateStore();
    const r = runtime({
      actionLedger: ledger,
      actionStateStore: {
        get: (id) => store.get(id),
        removeSnapshot: (id) => store.removeSnapshot(id),
        commitGeneration: (...args) => store.commitGeneration(...args),
        commitAction: (...args) => {
          writes++;
          return store.commitAction(...args);
        },
      },
      policy: {
        validateComponent: (_, ctx) => (ctx.kind === 'action' && deny ? 'policy expired' : null),
      },
      actionHandlers: new Map([
        [
          `${TEST_CATALOG_ID}:submit`,
          async function* () {
            handlers++;
            yield {
              version: 'v0.9',
              updateComponents: {
                surfaceId,
                components: [{ id: 'label', component: 'Text', text: 'Updated' }],
              },
            };
            deny = true; // 流式校验已通过，提交前策略失效。
          },
        ],
      ]),
    });
    await seed(r);
    const first = await r.action(action('first'));
    assert.ok(first.accepted);
    assert.equal((await first.run.result).commitState, 'notCommitted');
    const key = ['id:first', surfaceId, 'btn', 'submit'].join('\0');
    assert.equal(ledger.get(key)?.status, 'failed');
    assert.equal(writes, 0);
    assert.equal((await store.get(surfaceId))?.version, 1);
    deny = false;
    const replay = await r.action(action('first'));
    assert.ok(replay.accepted);
    const duplicate = await replay.run.result;
    assert.equal(duplicate.terminal, 'failed');
    if (duplicate.terminal === 'failed') assert.equal(duplicate.code, 'RUN_ADMISSION_REJECTED');
    const next = await r.action(action('next'));
    assert.ok(next.accepted);
    const rejected = await next.run.result;
    assert.equal(rejected.terminal, 'failed');
    if (rejected.terminal === 'failed') assert.match(rejected.message ?? '', /policy expired/);
    assert.equal(handlers, 2, '新 action 必须进入 handler，不能被泄漏的 ledger 容量阻断');
  });

  for (const kind of ['generate', 'action'] as const) {
    it(`${kind} 取消后 store 明确拒绝仍为 notCommitted`, async () => {
      const entered = deferred(),
        release = deferred(),
        store = new InMemorySurfaceActionStateStore();
      const reject = async (): Promise<SurfaceCommitResult> => {
        entered.resolve();
        await release.promise;
        return { outcome: 'notCommitted', reason: 'definite rejection' };
      };
      const r = runtime({
        actionStateStore: {
          get: (id) => store.get(id),
          removeSnapshot: (id) => store.removeSnapshot(id),
          commitGeneration:
            kind === 'generate' ? reject : (...args) => store.commitGeneration(...args),
          commitAction: kind === 'action' ? reject : (...args) => store.commitAction(...args),
        },
      });
      if (kind === 'action') await seed(r);
      const q = await (kind === 'generate'
        ? r.generate({ catalogId: TEST_CATALOG_ID })
        : r.action(action('cancel')));
      assert.ok(q.accepted);
      await entered.promise;
      q.run.cancel();
      release.resolve();
      const result = await q.run.result;
      assert.equal(result.terminal, 'canceled');
      assert.equal(result.commitState, 'notCommitted');
      assert.equal((await store.get(surfaceId))?.version, kind === 'action' ? 1 : undefined);
    });

    for (const fault of ['missing-contract', 'wrong-identity', 'invalid-outcome'] as const) {
      it(`${kind} 已写入后返回 ${fault}：unknown，不伪报未提交`, async () => {
        const store = new InMemorySurfaceActionStateStore();
        const diagnostics: NexusRunDiagnostic[] = [];
        const damage = (result: SurfaceCommitResult): SurfaceCommitResult => {
          assert.equal(result.outcome, 'committed');
          if (result.outcome !== 'committed') throw new Error('expected write');
          if (fault === 'invalid-outcome')
            return { ...result, outcome: 'invalid' } as unknown as SurfaceCommitResult;
          if (fault === 'wrong-identity')
            return { ...result, snapshot: { ...result.snapshot, surfaceId: 'other' } };
          return {
            ...result,
            snapshot: { ...result.snapshot, contract: undefined },
          } as unknown as SurfaceCommitResult;
        };
        const r = runtime({
          onRunDiagnostic: (d) => diagnostics.push(d),
          actionStateStore: {
            get: (id) => store.get(id),
            removeSnapshot: (id) => store.removeSnapshot(id),
            commitGeneration: async (...args) => {
              const result = await store.commitGeneration(...args);
              return kind === 'generate' ? damage(result) : result;
            },
            commitAction: async (...args) => damage(await store.commitAction(...args)),
          },
        });
        if (kind === 'action') await seed(r);
        const q = await (kind === 'generate'
          ? r.generate({ catalogId: TEST_CATALOG_ID })
          : r.action(action('malformed')));
        assert.ok(q.accepted);
        const result = await q.run.result;
        assert.equal(result.terminal, 'failed');
        assert.equal(result.commitState, 'unknown');
        if (result.terminal === 'failed') assert.equal(result.code, 'RUN_COMMIT_UNKNOWN');
        assert.equal((await store.get(surfaceId))?.version, kind === 'action' ? 2 : 1);
        assert.equal(r.queryRun(surfaceId, q.run.runId)?.commit, undefined);
        assert.ok(diagnostics.some((d) => d.stage === 'commit-identity'));
      });
    }
  }

  it('store unknown 加 manager failed-transition 故障不丢失错误分类', async () => {
    class Manager extends InMemoryAgentRunManager {
      override transition(
        id: string,
        state: Parameters<InMemoryAgentRunManager['transition']>[1],
        message?: string,
      ) {
        if (state === 'failed') throw new Error('record unavailable');
        super.transition(id, state, message);
      }
    }
    const store = new InMemorySurfaceActionStateStore();
    const r = runtime({
      runManager: new Manager(),
      actionStateStore: {
        get: (id) => store.get(id),
        removeSnapshot: (id) => store.removeSnapshot(id),
        commitAction: (...args) => store.commitAction(...args),
        commitGeneration: async () => ({ outcome: 'unknown', reason: 'write response lost' }),
      },
    });
    const q = await r.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(q.accepted);
    const result = await q.run.result;
    assert.equal(result.terminal, 'failed');
    assert.equal(result.commitState, 'unknown');
    if (result.terminal === 'failed') {
      assert.equal(result.code, 'RUN_COMMIT_UNKNOWN');
      assert.ok(
        result.diagnostics?.some((d) => (d as { code?: string }).code === 'RUN_LIFECYCLE_ERROR'),
      );
    }
  });

  it('成功 transition 抛错：保留成功事实并报告真实记录状态', async () => {
    class Manager extends InMemoryAgentRunManager {
      override transition(
        id: string,
        state: Parameters<InMemoryAgentRunManager['transition']>[1],
        message?: string,
      ) {
        if (state === 'succeeded') throw new Error('terminal record unavailable');
        super.transition(id, state, message);
      }
    }
    const manager = new Manager(),
      diagnostics: NexusRunDiagnostic[] = [];
    const r = runtime({
      runManager: manager,
      onRunDiagnostic: async (d) => {
        diagnostics.push(d);
        throw new Error('diagnostic observer rejected');
      },
    });
    const q = await r.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(q.accepted);
    const result = await q.run.result;
    assert.equal(result.terminal, 'succeeded');
    assert.equal(manager.get(q.run.runId)?.state, 'running', '不伪造外部终态写入成功');
    assert.ok(manager.get(q.run.runId)?.commit);
    assert.ok(
      diagnostics.some(
        (d) => d.stage === 'record-transition' && /terminal record unavailable/.test(d.message),
      ),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
});
