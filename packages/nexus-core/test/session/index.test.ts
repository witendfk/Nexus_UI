import { describe, it } from 'mocha';
import { strict as assert } from 'node:assert';
import { parseSurfaceCommit } from '../../src/session';

describe('fixed surface commit validation', () => {
  it('accepts versioned commits and rejects unusable baselines', () => {
    const commit = {
      sessionVersion: 1,
      runId: 'run-1',
      surfaceId: 's',
      catalogId: 'catalog',
      contractVersion: 2,
      catalogHash: `sha256:${'a'.repeat(64)}`,
      surfaceRevision: 1,
    };
    assert.deepEqual(parseSurfaceCommit(commit), commit);
    for (const override of [
      { sessionVersion: 2 },
      { contractVersion: 1 },
      { runId: '' },
      { surfaceId: '' },
      { catalogHash: 'not-a-hash' },
      { surfaceRevision: 0 },
      { surfaceRevision: 1.5 },
      { surfaceRevision: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      assert.equal(parseSurfaceCommit({ ...commit, ...override }), null);
    }
    assert.equal(parseSurfaceCommit(null), null);
  });
});
