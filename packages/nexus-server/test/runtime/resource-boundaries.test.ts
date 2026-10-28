import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, it } from 'node:test';
import { AgentAdapter } from '../../src/agent/adapter';
import type { AgentAction } from '../../src/agent/adapter';
import { InMemorySurfaceActionStateStore } from '../../src/agent/surface-action-state';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';
import { createAgentRuntime } from '../../src/runtime/runtime-facade';
import type { AgentRuntimeOptions } from '../../src/runtime/agent-runtime';
import { TEST_CATALOG_ID, createTestRegistry } from '../../tests/helpers/test-catalog';
import { allowAllAccess } from '../../tests/helpers/access';

const registry = createTestRegistry();
const hash = createCatalogContractHash(registry.require(TEST_CATALOG_ID));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function messages(surfaceId: string): unknown[] {
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
          { id: 'label', component: 'Text', text: 'ok' },
        ],
      },
    },
  ];
}
function options(
  extra: Partial<Omit<AgentRuntimeOptions, 'scheduler'>> = {},
): Omit<AgentRuntimeOptions, 'scheduler'> {
  return {
    access: allowAllAccess,
    registry,
    createSurfaceId: () => 's',
    createGenerationSource: (r) => messages(r.surfaceId),
    actionHandlers: new Map([[`${TEST_CATALOG_ID}:submit`, () => []]]),
    ...extra,
  };
}
function action(surfaceRevision: number, actionId: string): AgentAction {
  return {
    name: 'submit',
    surfaceId: 's',
    sourceComponentId: 'confirm',
    timestamp: new Date().toISOString(),
    context: {},
    actionId,
    sessionVersion: 1,
    surfaceRevision,
    catalogHash: hash,
  };
}
async function setup(runtime: ReturnType<typeof createAgentRuntime>): Promise<number> {
  const q = await runtime.generate({ catalogId: TEST_CATALOG_ID });
  assert.ok(q.accepted);
  const outcome = await q.run.result;
  assert.ok(outcome.terminal === 'succeeded');
  // task cleanup, not just public terminal, has completed.
  await delay(0);
  return outcome.commit.surfaceRevision;
}
async function timely<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('terminal did not converge')), 150);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe('S3.6 review resource boundaries', () => {
  it('timeout aborts host, rejects queued/new overlap, and recovers only after host exits', async () => {
    const held = deferred();
    const entered = deferred();
    let calls = 0;
    let signal: AbortSignal | undefined;
    const runtime = createAgentRuntime(
      options({
        budgets: { executionTimeoutMs: 30 },
        actionHandlers: new Map([
          [
            `${TEST_CATALOG_ID}:submit`,
            async (_a, ctx) => {
              calls++;
              signal = ctx.signal;
              entered.resolve();
              await held.promise;
              return [];
            },
          ],
        ]),
      }),
    );
    const rev = await setup(runtime);
    const a = await runtime.action(action(rev, 'old'));
    assert.ok(a.accepted);
    await entered.promise;
    const queued = await runtime.action(action(rev, 'queued'));
    assert.ok(queued.accepted);
    try {
      assert.equal((await timely(a.run.result)).terminal, 'canceled');
      assert.equal(signal?.aborted, true);
      assert.equal((await timely(queued.run.result)).terminal, 'failed');
      const next = await runtime.action(action(rev, 'new'));
      assert.equal(next.accepted, false, 'uncooperative host still owns the surface');
      assert.equal(calls, 1);
    } finally {
      held.resolve();
    }
    await delay(10);
    const recovered = await runtime.action(action(rev, 'recovered'));
    assert.ok(recovered.accepted);
    assert.equal((await recovered.run.result).terminal, 'succeeded');
  });

  it('cancel during next settles without waiting for output and requests iterator return', async () => {
    const held = deferred();
    const entered = deferred();
    let returned = 0;
    const runtime = createAgentRuntime(
      options({
        createGenerationSource: () => ({
          [Symbol.asyncIterator]() {
            return {
              async next() {
                entered.resolve();
                await held.promise;
                return { done: true as const, value: undefined };
              },
              async return() {
                returned++;
                return { done: true as const, value: undefined };
              },
            };
          },
        }),
      }),
    );
    const q = await runtime.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(q.accepted);
    await entered.promise;
    try {
      q.run.cancel();
      assert.equal((await timely(q.run.result)).terminal, 'canceled');
      assert.equal(returned, 1, 'cleanup is requested while next is outstanding');
      assert.equal((await runtime.generate({ catalogId: TEST_CATALOG_ID })).accepted, false);
    } finally {
      held.resolve();
    }
    await delay(0);
  });

  it('queued cancel releases pin exactly once and permits later capacity eviction', async () => {
    const store = new InMemorySurfaceActionStateStore({ maxSurfaces: 1 });
    let pins = 0;
    const retain = store.retainSurface.bind(store);
    store.retainSurface = (id) => {
      pins++;
      const release = retain(id);
      let done = false;
      return () => {
        assert.equal(done, false);
        done = true;
        pins--;
        release();
      };
    };
    const held = deferred();
    const entered = deferred();
    let surfaceId = 's';
    const runtime = createAgentRuntime(
      options({
        actionStateStore: store,
        createSurfaceId: () => surfaceId,
        actionHandlers: new Map([
          [
            `${TEST_CATALOG_ID}:submit`,
            async () => {
              entered.resolve();
              await held.promise;
              return [];
            },
          ],
        ]),
      }),
    );
    const rev = await setup(runtime);
    const a = await runtime.action(action(rev, 'a'));
    assert.ok(a.accepted);
    await entered.promise;
    const b = await runtime.action(action(rev, 'b'));
    assert.ok(b.accepted);
    b.run.cancel();
    await b.run.result;
    held.resolve();
    await a.run.result;
    await delay(0);
    assert.equal(pins, 0);
    surfaceId = 'other';
    const c = await runtime.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(c.accepted);
    await c.run.result;
    assert.equal(await store.get('s'), undefined);
  });

  it('merged surface bytes are bounded across individually valid actions and rejection is atomic', async () => {
    const store = new InMemorySurfaceActionStateStore({ maxSnapshotBytes: 5000 });
    const runtime = createAgentRuntime(
      options({
        actionStateStore: store,
        budgets: { maxTotalBytesPerRun: 2000 },
        actionHandlers: new Map([
          [
            `${TEST_CATALOG_ID}:submit`,
            (a) => [
              {
                version: 'v0.9',
                updateDataModel: {
                  surfaceId: a.surfaceId,
                  path: `/${a.actionId}`,
                  value: 'x'.repeat(1000),
                },
              },
            ],
          ],
        ]),
      }),
    );
    let rev = await setup(runtime);
    let rejected = false;
    for (let i = 0; i < 10; i++) {
      const before = await store.get('s');
      const q = await runtime.action(action(rev, `part${i}`));
      assert.ok(q.accepted);
      const outcome = await q.run.result;
      if (outcome.terminal === 'succeeded') {
        rev = outcome.commit.surfaceRevision;
        continue;
      }
      assert.ok(outcome.terminal === 'failed');
      assert.equal(outcome.code, 'RESOURCE_LIMIT_EXCEEDED');
      assert.equal(outcome.commitState, 'notCommitted');
      assert.deepEqual(await store.get('s'), before);
      rejected = true;
      break;
    }
    assert.equal(rejected, true, 'finite snapshot bytes limit must reject growth');
  });

  it('non HTTP iterator bounds production while consumer pauses and resumes through done', async () => {
    let produced = 0;
    const runtime = createAgentRuntime(
      options({
        budgets: { eventHighWaterMarkMessages: 2, eventHighWaterMarkBytes: 1000 },
        createGenerationSource: (r) =>
          (function* () {
            for (const m of messages(r.surfaceId)) {
              produced++;
              yield m;
            }
            for (let i = 0; i < 50; i++) {
              produced++;
              yield { version: 'v0.9', updateDataModel: { surfaceId: r.surfaceId, value: { i } } };
            }
          })(),
      }),
    );
    const q = await runtime.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(q.accepted);
    const iterator = q.run.events()[Symbol.asyncIterator]();
    assert.equal((await iterator.next()).value.type, 'start');
    await delay(10);
    const paused = produced;
    await delay(10);
    assert.equal(produced, paused);
    assert.ok(produced < 10);
    const types: string[] = [];
    for (;;) {
      const step = await iterator.next();
      if (step.done) break;
      types.push(step.value.type);
    }
    assert.equal(types.at(-1), 'done');
    assert.equal((await q.run.result).terminal, 'succeeded');
  });

  it('Adapter and runtime apply the same default scheduler queue budget', async () => {
    const held = deferred();
    const entered = deferred();
    const adapter = new AgentAdapter(
      options({
        budgets: { maxQueuedPerSurface: 1 },
        actionHandlers: new Map([
          [
            `${TEST_CATALOG_ID}:submit`,
            async () => {
              entered.resolve();
              await held.promise;
              return [];
            },
          ],
        ]),
      }),
    );
    const generated = await adapter.enqueueGeneration({ catalogId: TEST_CATALOG_ID });
    assert.ok(generated.accepted);
    const baseline = await generated.run.result;
    assert.ok(baseline.terminal === 'succeeded');
    await delay(0);
    const a = await adapter.enqueueAction(action(baseline.commit.surfaceRevision, 'a'));
    assert.ok(a.accepted);
    await entered.promise;
    const b = await adapter.enqueueAction(action(baseline.commit.surfaceRevision, 'b'));
    assert.ok(b.accepted);
    const c = await adapter.enqueueAction(action(baseline.commit.surfaceRevision, 'c'));
    try {
      assert.equal(c.accepted, false);
    } finally {
      b.run.cancel();
      if (c.accepted) c.run.cancel();
      held.resolve();
      await a.run.result;
    }
  });
  it('cancel in preparation settles before store returns and never starts a late factory', async () => {
    const store = new InMemorySurfaceActionStateStore();
    const entered = deferred();
    const held = deferred();
    let block = false;
    let calls = 0;
    const get = store.get.bind(store);
    store.get = async (id) => {
      if (block) {
        entered.resolve();
        await held.promise;
      }
      return get(id);
    };
    const runtime = createAgentRuntime(
      options({
        actionStateStore: store,
        actionHandlers: new Map([
          [
            `${TEST_CATALOG_ID}:submit`,
            () => {
              calls++;
              return [];
            },
          ],
        ]),
      }),
    );
    const rev = await setup(runtime);
    block = true;
    const q = await runtime.action(action(rev, 'prepare'));
    assert.ok(q.accepted);
    await entered.promise;
    try {
      q.run.cancel();
      assert.equal((await timely(q.run.result)).terminal, 'canceled');
      assert.equal(calls, 0);
    } finally {
      block = false;
      held.resolve();
    }
    await delay(0);
    assert.equal(calls, 0);
    const next = await runtime.action(action(rev, 'next'));
    assert.ok(next.accepted);
    await next.run.result;
    assert.equal(calls, 1);
  });

  it('quarantine has a global hard bound even when terminal run records can be evicted', async () => {
    const held = deferred();
    const entered = deferred();
    let id = 'held';
    let factories = 0;
    const runtime = createAgentRuntime(
      options({
        budgets: { maxTrackedSurfaces: 1, runRecords: 1 },
        createSurfaceId: () => id,
        createGenerationSource: (r) => {
          factories++;
          return (async function* () {
            entered.resolve();
            await held.promise;
            yield* messages(r.surfaceId);
          })();
        },
      }),
    );
    const q = await runtime.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(q.accepted);
    await entered.promise;
    try {
      q.run.cancel();
      await timely(q.run.result);
      id = 'other';
      assert.equal((await runtime.generate({ catalogId: TEST_CATALOG_ID })).accepted, false);
      assert.equal(factories, 1);
    } finally {
      held.resolve();
    }
    await delay(0);
    const next = await runtime.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(next.accepted);
    assert.equal((await next.run.result).terminal, 'succeeded');
  });

  it('execution timeout during store commit waits for confirmation and preserves succeeded', async () => {
    const store = new InMemorySurfaceActionStateStore();
    const entered = deferred();
    const held = deferred();
    const commit = store.commitAction.bind(store);
    store.commitAction = async (...args) => {
      entered.resolve();
      await held.promise;
      return commit(...args);
    };
    const runtime = createAgentRuntime(
      options({ actionStateStore: store, budgets: { executionTimeoutMs: 25 } }),
    );
    const rev = await setup(runtime);
    const q = await runtime.action(action(rev, 'commit'));
    assert.ok(q.accepted);
    await entered.promise;
    let settled = false;
    void q.run.result.then(() => {
      settled = true;
    });
    await delay(40);
    assert.equal(settled, false, 'timeout cannot invent notCommitted for an in-flight write');
    held.resolve();
    assert.equal((await timely(q.run.result)).terminal, 'succeeded');
  });

  it('already aborted queued signal releases listeners and pin before any factory', async () => {
    const store = new InMemorySurfaceActionStateStore();
    let pins = 0;
    let calls = 0;
    const retain = store.retainSurface.bind(store);
    store.retainSurface = (id) => {
      pins++;
      const release = retain(id);
      return () => {
        pins--;
        release();
      };
    };
    const controller = new AbortController();
    controller.abort();
    const runtime = createAgentRuntime(
      options({
        actionStateStore: store,
        budgets: { queueTimeoutMs: 1000 },
        createGenerationSource: (r) => {
          calls++;
          return messages(r.surfaceId);
        },
      }),
    );
    const q = await runtime.generate({ catalogId: TEST_CATALOG_ID }, { signal: controller.signal });
    assert.ok(q.accepted);
    assert.equal((await q.run.result).terminal, 'canceled');
    assert.equal(pins, 0);
    assert.equal(calls, 0);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  });

  it('non HTTP stalled consumer times out; cancel and iterator handoff also release capacity', async () => {
    const runtime = createAgentRuntime(
      options({ budgets: { eventHighWaterMarkMessages: 1, eventSlowConsumerTimeoutMs: 25 } }),
    );
    const q = await runtime.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(q.accepted);
    const iterator = q.run.events()[Symbol.asyncIterator]();
    await iterator.next();
    const outcome = await timely(q.run.result);
    assert.ok(outcome.terminal === 'failed');
    assert.equal(outcome.code, 'AGENT_STREAM_ERROR');
    await iterator.return?.();
    const next = await runtime.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(next.accepted);
    const iter = next.run.events()[Symbol.asyncIterator]();
    await iter.next();
    await delay(0);
    next.run.cancel();
    assert.equal((await timely(next.run.result)).terminal, 'canceled');
    await iter.return?.();
  });

  it('return cleanup that never resolves preserves bounded ownership after a protocol rejection', async () => {
    const entered = deferred();
    const held = deferred();
    const runtime = createAgentRuntime(
      options({
        createGenerationSource: () => ({
          [Symbol.asyncIterator]() {
            return {
              next: async () => ({ done: false as const, value: { illegal: true } }),
              return: async () => {
                entered.resolve();
                await held.promise;
                return { done: true as const, value: undefined };
              },
            };
          },
        }),
      }),
    );
    const q = await runtime.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(q.accepted);
    await entered.promise;
    try {
      assert.equal((await timely(q.run.result)).terminal, 'failed');
      assert.equal((await runtime.generate({ catalogId: TEST_CATALOG_ID })).accepted, false);
    } finally {
      held.resolve();
    }
    await delay(0);
  });

  it('runtime scheduler overrides queue fields individually and validates timeout', async () => {
    assert.throws(
      () => createAgentRuntime({ ...options(), scheduler: { queueTimeoutMs: 0 } }),
      /queueTimeoutMs/,
    );
    const held = deferred();
    const entered = deferred();
    const runtime = createAgentRuntime({
      ...options({
        budgets: { maxQueuedPerSurface: 1, queueTimeoutMs: 1000 },
        createGenerationSource: (r) =>
          (async function* () {
            entered.resolve();
            await held.promise;
            yield* messages(r.surfaceId);
          })(),
      }),
      scheduler: { queueTimeoutMs: 20 },
    });
    const first = await runtime.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(first.accepted);
    await entered.promise;
    const second = await runtime.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(second.accepted);
    assert.equal((await runtime.generate({ catalogId: TEST_CATALOG_ID })).accepted, false);
    try {
      assert.equal((await timely(second.run.result)).terminal, 'canceled');
    } finally {
      held.resolve();
      await first.run.result;
    }
  });

  it('caller mutation of configured budgets cannot disable per-run limits', async () => {
    const budgets = { maxMessagesPerRun: 1 };
    const runtime = createAgentRuntime(options({ budgets }));
    budgets.maxMessagesPerRun = Number.NaN;
    const q = await runtime.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(q.accepted);
    const outcome = await q.run.result;
    assert.ok(outcome.terminal === 'failed');
    assert.equal(outcome.code, 'RESOURCE_LIMIT_EXCEEDED');
  });
});
