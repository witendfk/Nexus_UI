import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InMemorySurfaceHistoryStore } from '../src/agent/history';

describe('surface history store', () => {
  it('returns copied history and keeps per-surface turn limits', async () => {
    const store = new InMemorySurfaceHistoryStore({ maxTurnsPerSurface: 4 });
    await store.commitGeneration('surface-history', 'catalog-history', [
      { role: 'user', content: 'user-1' },
      { role: 'assistant', content: 'assistant-1' },
    ]);

    const history = await store.getHistory('surface-history');
    history[0]!.content = 'mutated';

    assert.equal((await store.getHistory('surface-history'))[0]?.content, 'user-1');

    await store.commitGeneration('surface-history', 'catalog-history', [
      { role: 'user', content: 'user-2' },
      { role: 'assistant', content: 'assistant-2' },
    ]);
    await store.commitGeneration('surface-history', 'catalog-history', [
      { role: 'user', content: 'user-3' },
      { role: 'assistant', content: 'assistant-3' },
    ]);

    assert.deepEqual(
      (await store.getHistory('surface-history')).map((turn) => turn.content),
      ['user-2', 'assistant-2', 'user-3', 'assistant-3'],
    );
  });

  it('evicts the oldest complete surface when the store reaches its limit', async () => {
    const store = new InMemorySurfaceHistoryStore({ maxSurfaces: 1 });
    await store.commitGeneration('surface-old', 'catalog-old', [
      { role: 'user', content: 'old request' },
    ]);
    await store.commitGeneration('surface-new', 'catalog-new', [
      { role: 'user', content: 'new request' },
    ]);

    assert.deepEqual(await store.getHistory('surface-old'), []);
    assert.equal(await store.getCatalogId('surface-old'), undefined);
    assert.equal((await store.getHistory('surface-new'))[0]?.content, 'new request');
    assert.equal(await store.getCatalogId('surface-new'), 'catalog-new');
  });

  it('also limits surfaces that only register a catalog without history turns', async () => {
    const store = new InMemorySurfaceHistoryStore({ maxSurfaces: 1 });
    await store.commitGeneration('surface-fallback-old', 'catalog-old', []);
    await store.commitGeneration('surface-fallback-new', 'catalog-new', []);

    assert.equal(await store.getCatalogId('surface-fallback-old'), undefined);
    assert.equal(await store.getCatalogId('surface-fallback-new'), 'catalog-new');
  });
});
