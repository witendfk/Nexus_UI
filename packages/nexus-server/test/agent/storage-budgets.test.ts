import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InMemorySurfaceHistoryStore } from '../../src/agent/history';
import { InMemorySurfaceActionStateStore } from '../../src/agent/surface-action-state';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';
import { jsonBytes } from '../../src/runtime/budgets';
import { createAgentRuntime } from '../../src/runtime/runtime-facade';
import { createTestRegistry, TEST_CATALOG_ID } from '../../tests/helpers/test-catalog';
import { allowAllAccess } from '../../tests/helpers/access';
const registry = createTestRegistry();
const catalog = registry.require(TEST_CATALOG_ID);
const contract = { catalogHash: createCatalogContractHash(catalog), contractVersion: 2, catalog };
const messages = [
  { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: TEST_CATALOG_ID } },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 's',
      components: [{ id: 'root', component: 'Text', text: '边界\n"' }],
    },
  },
  { version: 'v0.9', updateDataModel: { surfaceId: 's', value: { arr: [] } } },
];
describe('S3.6 storage byte budgets', () => {
  it('UTF-8 JSON metering matches wire bytes including escaping and stops on huge sparse arrays', () => {
    for (const value of [
      null,
      123,
      '汉字\n"\\',
      { a: [1, undefined, null, '😀'], b: false, c: undefined },
      [[], {}],
    ]) {
      assert.equal(jsonBytes(value), Buffer.byteLength(JSON.stringify(value), 'utf8'));
    }
    const sparse: unknown[] = [];
    sparse.length = 1_000_000_000;
    assert.ok(jsonBytes(sparse, 1000) > 1000);
  });

  it('snapshot exact boundary passes; one byte lower fails without publishing', async () => {
    const store = new InMemorySurfaceActionStateStore();
    const baseline = await store.commitGeneration('s', TEST_CATALOG_ID, messages, contract);
    assert.ok(baseline.outcome === 'committed');
    const bytes = Buffer.byteLength(
      JSON.stringify({
        ...baseline.snapshot,
        components: [...baseline.snapshot.components.values()],
      }),
    );
    const exact = new InMemorySurfaceActionStateStore({ maxSnapshotBytes: bytes });
    assert.equal(
      (await exact.commitGeneration('s', TEST_CATALOG_ID, messages, contract)).outcome,
      'committed',
    );
    const under = new InMemorySurfaceActionStateStore({ maxSnapshotBytes: bytes - 1 });
    const rejected = await under.commitGeneration('s', TEST_CATALOG_ID, messages, contract);
    assert.ok(rejected.outcome === 'notCommitted');
    assert.equal(rejected.code, 'RESOURCE_LIMIT_EXCEEDED');
    assert.equal(await under.get('s'), undefined);
  });

  it('component growth and sparse input array growth are atomically rejected', async () => {
    const store = new InMemorySurfaceActionStateStore({
      maxComponentsPerSurface: 1,
      maxSnapshotBytes: 10000,
    });
    const result = await store.commitGeneration('s', TEST_CATALOG_ID, messages, contract);
    assert.ok(result.outcome === 'committed');
    const commit = {
      surfaceId: 's',
      expectedEpoch: result.snapshot.epoch,
      expectedRevision: result.snapshot.version,
    };
    const component = await store.commitAction(
      [
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's',
            components: [{ id: 'extra', component: 'Text', text: 'extra' }],
          },
        },
      ],
      commit,
    );
    assert.ok(component.outcome === 'notCommitted');
    assert.equal(component.code, 'RESOURCE_LIMIT_EXCEEDED');
    const input = await store.commitAction([], {
      ...commit,
      inputWrites: [{ path: '/arr/1000000000', value: true }],
    });
    assert.ok(input.outcome === 'notCommitted');
    assert.equal(input.code, 'RESOURCE_LIMIT_EXCEEDED');
    assert.deepEqual(await store.get('s'), result.snapshot);
  });

  it('generation and action classify the same array overflow without publishing or advancing revision', async () => {
    const store = new InMemorySurfaceActionStateStore();
    const baseline = await store.commitGeneration('s', TEST_CATALOG_ID, messages, contract);
    assert.ok(baseline.outcome === 'committed');
    const invalid = {
      version: 'v0.9',
      updateDataModel: { surfaceId: 's', path: '/arr/5', value: 'x' },
    };
    const commit = {
      surfaceId: 's',
      expectedEpoch: baseline.snapshot.epoch,
      expectedRevision: baseline.snapshot.version,
    };
    const generation = await store.commitGeneration(
      's',
      TEST_CATALOG_ID,
      [...messages, invalid],
      contract,
    );
    const action = await store.commitAction([invalid], commit);
    for (const rejected of [generation, action]) {
      assert.ok(rejected.outcome === 'notCommitted');
      assert.equal(rejected.code, 'RESOURCE_LIMIT_EXCEEDED');
      assert.match(rejected.reason, /数组下标越界/);
    }
    assert.deepEqual(await store.get('s'), baseline.snapshot);
    const accepted = await store.commitAction(
      [{ version: 'v0.9', updateDataModel: { surfaceId: 's', path: '/arr/0', value: 'x' } }],
      commit,
    );
    assert.ok(accepted.outcome === 'committed');
    assert.equal(accepted.snapshot.version, baseline.snapshot.version + 1);
    assert.deepEqual(accepted.snapshot.dataModel, { arr: ['x'] });
  });

  it('history rejects oversized incoming turns before changing catalog/history, and evicts whole old turns', async () => {
    const store = new InMemorySurfaceHistoryStore({ maxBytesPerTurn: 70, maxBytesPerSurface: 90 });
    const old = { role: 'user' as const, content: 'old'.repeat(5) };
    const recent = { role: 'assistant' as const, content: 'recent'.repeat(3) };
    await store.commitGeneration('s', 'old-catalog', [old]);
    await assert.rejects(
      store.commitGeneration('s', 'bad-catalog', [{ role: 'user', content: 'x'.repeat(100) }]),
    );
    assert.equal(await store.getCatalogId('s'), 'old-catalog');
    assert.deepEqual(await store.getHistory('s'), [old]);
    await store.commitGeneration('s', 'new-catalog', [recent]);
    assert.deepEqual(await store.getHistory('s'), [recent]);
    assert.ok(Buffer.byteLength(JSON.stringify(await store.getHistory('s'))) <= 90);
  });

  it('history budget failure after UI commit is diagnostic, not a fabricated failed UI result', async () => {
    const diagnostics: string[] = [];
    const runtime = createAgentRuntime({
      access: allowAllAccess,
      registry,
      createSurfaceId: () => 's',
      budgets: { maxHistoryBytesPerTurn: 1 },
      createGenerationSource: () => messages,
      onRunDiagnostic: (d) => {
        diagnostics.push(d.stage);
      },
    });
    const q = await runtime.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(q.accepted);
    assert.equal((await q.run.result).terminal, 'succeeded');
    assert.ok(diagnostics.includes('history-commit'));
    assert.ok(await runtime.adapter.describeSurfaceContract('s'));
  });
});
