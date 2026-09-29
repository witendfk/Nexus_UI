import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InMemorySurfaceActionLedger } from '../src/agent/surface-action-state';

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
