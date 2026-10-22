import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  InMemorySurfaceActionLedger,
  InMemorySurfaceActionStateStore,
} from '../src/agent/surface-action-state';

function record(key: string) {
  return { key, surfaceId: 'surface-1', actionName: 'submit', sourceComponentId: 'btn' };
}

describe('InMemorySurfaceActionLedger', () => {
  it('never evicts running records when enforcing capacity', () => {
    const ledger = new InMemorySurfaceActionLedger({ maxRecords: 2 });
    assert.equal(ledger.begin(record('k1')), true);
    assert.equal(ledger.begin(record('k2')), true);

    // Capacity is reached with every record still running: k3 must not evict
    // them, even though that means temporarily exceeding the cap.
    assert.equal(ledger.begin(record('k3')), true);
    assert.equal(ledger.get('k1')?.status, 'running');
    assert.equal(ledger.get('k2')?.status, 'running');
    assert.ok(ledger.get('k3'));

    // Replay protection still holds for the retained running records.
    assert.equal(ledger.begin(record('k1')), false);

    // Once a record settles it becomes evictable again (oldest terminal first).
    ledger.complete('k1', 'succeeded');
    assert.equal(ledger.begin(record('k4')), true);
    assert.equal(ledger.get('k1'), undefined, 'oldest terminal record is evicted');
    assert.equal(ledger.get('k2')?.status, 'running', 'running records survive eviction');
    assert.ok(ledger.get('k3'));
    assert.ok(ledger.get('k4'));
  });
});

describe('InMemorySurfaceActionStateStore 快照容量淘汰', () => {
  for (const write of ['generation', 'action'] as const) {
    it(`${write} 刷新写入顺序，容量满时不得淘汰刚提交的权威快照`, async () => {
      const store = new InMemorySurfaceActionStateStore({ maxSurfaces: 2 });
      const contract = {
        catalogHash: `sha256:${'a'.repeat(64)}`,
        contractVersion: 2,
        catalog: {
          catalogId: 'https://example.com/catalogs/evict/v1',
          components: { Text: { schema: { type: 'object' } } },
          actions: [],
        },
      } as never;
      const catalogId = 'https://example.com/catalogs/evict/v1';
      const stream = (surfaceId: string) => [
        { version: 'v0.9', createSurface: { surfaceId, catalogId } },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId,
            components: [{ id: 'root', component: 'Text', text: 'x' }],
          },
        },
        { version: 'v0.9', updateDataModel: { surfaceId, value: {} } },
      ];

      await store.commitGeneration('s-a', catalogId, stream('s-a'), contract);
      await store.commitGeneration('s-b', catalogId, stream('s-b'), contract);
      // 两条独立序列，不能用 action 刷新顺序掩盖 generation 缺陷。
      if (write === 'generation') {
        await store.commitGeneration('s-a', catalogId, stream('s-a'), contract);
      } else {
        await store.commitAction(
          [{ version: 'v0.9', updateDataModel: { surfaceId: 's-a', value: { v: 1 } } }],
          { expectedEpoch: 1, expectedRevision: 1 },
        );
      }

      // 第三个 surface 触发淘汰：受害者必须是最久未写入的 s-b，而不是刚提交的 s-a。
      await store.commitGeneration('s-c', catalogId, stream('s-c'), contract);
      const survivor = await store.get('s-a');
      assert.ok(survivor, '刚重新生成的 s-a 不得被容量淘汰');
      assert.ok(!survivor || survivor.version >= 3, 's-a 保留重生成后的权威版本');
      const evicted = await store.get('s-b');
      assert.ok(!evicted, '最久未写入的 s-b 被淘汰');
      assert.ok(await store.get('s-c'));
    });
  }
});
