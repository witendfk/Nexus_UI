import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InMemorySurfaceHistoryStore } from '../../src/agent/history';
import { FileSurfaceHistoryStore } from '../../src/agent/file-history';
import { InMemoryAgentRunManager } from '../../src/agent/run-manager';
import {
  InMemorySurfaceActionLedger,
  InMemorySurfaceActionStateStore,
} from '../../src/agent/surface-action-state';

describe('store budget initialization', () => {
  for (const value of [NaN, Infinity, -Infinity, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    it(`rejects invalid budget ${value} before any state or file operation`, () => {
      for (const key of ['maxSurfaces', 'maxTurnsPerSurface'] as const) {
        assert.throws(() => new InMemorySurfaceHistoryStore({ [key]: value }), new RegExp(key));
        assert.throws(
          () => new FileSurfaceHistoryStore('/unused-history.json', { [key]: value }),
          new RegExp(key),
        );
      }
      assert.throws(
        () => new InMemorySurfaceActionStateStore({ maxSurfaces: value }),
        /maxSurfaces/,
      );
      assert.throws(() => new InMemorySurfaceActionLedger({ maxRecords: value }), /maxRecords/);
      assert.throws(() => new InMemoryAgentRunManager({ maxRecords: value }), /maxRecords/);
    });
  }

  it('retains the latest turn with the smallest positive history budget', async () => {
    const store = new InMemorySurfaceHistoryStore({ maxSurfaces: 1, maxTurnsPerSurface: 1 });
    await store.commitGeneration('s', 'custom', [
      { role: 'user', content: 'old' },
      { role: 'assistant', content: 'new' },
    ]);
    assert.deepEqual(await store.getHistory('s'), [{ role: 'assistant', content: 'new' }]);
  });
});
