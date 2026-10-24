import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import type Koa from 'koa';
import type { AgentRun } from '../../src/agent/adapter';
import { InMemoryAgentRunManager } from '../../src/agent/run-manager';
import { InMemorySurfaceActionStateStore } from '../../src/agent/surface-action-state';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';
import { createAgentRuntime } from '../../src/runtime/runtime-facade';
import { sendAgentRun } from '../../src/api/send-messages';
import { TEST_CATALOG_ID, createTestRegistry } from '../../tests/helpers/test-catalog';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function capture() {
  let output = '';
  const res = new PassThrough();
  res.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  const ended = new Promise<void>((resolve) => res.once('end', resolve));
  const ctx = { res, set: () => undefined } as unknown as Koa.Context;
  return { ctx, ended, output: () => output };
}

const registry = createTestRegistry();
const catalog = registry.require(TEST_CATALOG_ID);
const hash = createCatalogContractHash(catalog);
const messages = (surfaceId: string, text: string) => [
  { version: 'v0.9', createSurface: { surfaceId, catalogId: TEST_CATALOG_ID } },
  {
    version: 'v0.9',
    updateComponents: { surfaceId, components: [{ id: 'root', component: 'Text', text }] },
  },
];

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('sendAgentRun S3.2 独立复审回归', () => {
  it('仅 sender 的已取消 signal 也在工厂调用前取消 SDK 句柄', async () => {
    let calls = 0;
    const runtime = createAgentRuntime({
      registry,
      createSurfaceId: () => 'abort-before',
      createGenerationSource: (r) => {
        calls++;
        return messages(r.surfaceId, 'never');
      },
    });
    const pending = runtime.generate({ catalogId: TEST_CATALOG_ID });
    const run = await pending;
    assert.ok(run.accepted);
    const controller = new AbortController();
    controller.abort();
    const dest = capture();
    const sent = await sendAgentRun(dest.ctx, run.run, {
      signal: controller.signal,
      streamDelayMs: 0,
    });
    await dest.ended;
    assert.equal(sent.ok, false);
    assert.equal(calls, 0, '工厂不能在已取消 sender 接入后执行');
    assert.equal((await run.run.result).terminal, 'canceled');
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    assert.match(dest.output(), /event: error/);
    assert.doesNotMatch(dest.output(), /event: done/);
    assert.equal(await runtime.adapter.describeSurfaceContract('abort-before'), undefined);
  });

  it('sender 后续 abort 会传给已运行句柄，关闭源并拒绝晚到提交', async () => {
    const entered = deferred(),
      release = deferred();
    let closed = false;
    const runtime = createAgentRuntime({
      registry,
      createSurfaceId: () => 'abort-later',
      createGenerationSource: (r) =>
        (async function* () {
          try {
            entered.resolve();
            await release.promise;
            yield* messages(r.surfaceId, 'late');
          } finally {
            closed = true;
          }
        })(),
    });
    const enqueued = await runtime.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(enqueued.accepted);
    const controller = new AbortController(),
      dest = capture();
    const sent = sendAgentRun(dest.ctx, enqueued.run, {
      signal: controller.signal,
      streamDelayMs: 0,
    });
    await entered.promise;
    controller.abort();
    release.resolve();
    assert.equal((await sent).ok, false);
    await dest.ended;
    assert.ok(closed);
    assert.equal((await enqueued.run.result).terminal, 'canceled');
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    assert.equal(await runtime.adapter.describeSurfaceContract('abort-later'), undefined);
    assert.match(dest.output(), /event: error/);
    assert.doesNotMatch(dest.output(), /event: done/);
  });

  for (const first of ['runtime', 'custom'] as const) {
    it(`${first} 先启动：自定义 run 与 runtime 共用同一 surface 调度并实际串行提交`, async () => {
      const manager = new InMemoryAgentRunManager();
      const store = new InMemorySurfaceActionStateStore();
      const entered = deferred(),
        release = deferred();
      const calls: string[] = [];
      const surfaceId = `mixed-${first}`;
      const createRuntime = () =>
        createAgentRuntime({
          registry,
          runManager: manager,
          actionStateStore: store,
          createSurfaceId: () => surfaceId,
          createGenerationSource: (r) => {
            calls.push('runtime');
            return (async function* () {
              if (first === 'runtime') {
                entered.resolve();
                await release.promise;
              }
              yield* messages(r.surfaceId, 'runtime');
            })();
          },
        });
      const custom: AgentRun = {
        runId: `custom-${first}`,
        sequence: {
          kind: 'generate',
          surfaceId,
          catalogId: TEST_CATALOG_ID,
          registry,
          supportedActions: ['submit', 'call'],
        },
        source: (async function* () {
          calls.push('custom');
          if (first === 'custom') {
            entered.resolve();
            await release.promise;
          }
          yield* messages(surfaceId, 'custom');
        })(),
        commit: async (sent) => {
          // S3.3：store 结果契约——commitGeneration 返回 SurfaceCommitResult，
          // 确认提交后从 result.snapshot 取基准。
          const result = await store.commitGeneration(surfaceId, TEST_CATALOG_ID, sent, {
            catalog,
            contractVersion: 2,
            catalogHash: hash,
          });
          if (result.outcome !== 'committed') {
            throw new Error(`custom run 提交未确认: ${result.outcome}`);
          }
          const snapshot = result.snapshot;
          return {
            sessionVersion: 1,
            runId: `custom-${first}`,
            surfaceId,
            catalogId: TEST_CATALOG_ID,
            contractVersion: 2,
            catalogHash: hash,
            surfaceRevision: snapshot.version,
          };
        },
      };
      const dest = capture();
      let runtime: ReturnType<typeof createRuntime>;
      let send: ReturnType<typeof sendAgentRun>;
      let run: Awaited<ReturnType<typeof runtime.generate>>;
      if (first === 'runtime') {
        runtime = createRuntime();
        run = await runtime.generate({ catalogId: TEST_CATALOG_ID });
        await entered.promise;
        send = sendAgentRun(dest.ctx, custom, { manager, streamDelayMs: 0 });
      } else {
        send = sendAgentRun(dest.ctx, custom, { manager, streamDelayMs: 0 });
        await entered.promise;
        runtime = createRuntime();
        run = await runtime.generate({ catalogId: TEST_CATALOG_ID });
      }
      try {
        await nextTurn();
        assert.deepEqual(calls, [first], '另一入口不得在当前提交完成前开始执行');
      } finally {
        release.resolve();
      }
      assert.ok(run.accepted);
      const [sent, outcome] = await Promise.all([send, run.run.result]);
      await dest.ended;
      assert.equal(sent.ok, true);
      assert.equal(outcome.terminal, 'succeeded');
      assert.deepEqual(calls, first === 'runtime' ? ['runtime', 'custom'] : ['custom', 'runtime']);
      assert.equal((await store.get(surfaceId))?.version, 2);
      assert.equal(manager.get(custom.runId)?.commit?.surfaceRevision, first === 'custom' ? 1 : 2);
      assert.equal(outcome.commit.surfaceRevision, first === 'runtime' ? 1 : 2);
      assert.match(dest.output(), /event: done/);
    });
  }
});
