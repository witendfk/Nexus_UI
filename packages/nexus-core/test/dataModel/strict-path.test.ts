import { describe, it } from 'mocha';
import { strict as assert } from 'node:assert';
import {
  getStrictPath,
  setStrictPath,
  normalizeJsonPointer,
} from '../../src/dataModel/strict-path';

describe('strict JSON Pointer input addressing', () => {
  it('rejects every array alias while retaining literal object keys', () => {
    for (const key of ['01', '+1', '1e0', '', '-1', '1.0', 'Infinity']) {
      assert.throws(() => setStrictPath({ arr: ['a', 'b'] }, `/arr/${key}`, 'x'));
      assert.throws(() => getStrictPath({ arr: ['a', 'b'] }, `/arr/${key}`));
      assert.deepEqual(setStrictPath({ obj: {} }, `/obj/${key}`, 'x'), { obj: { [key]: 'x' } });
    }
  });
  it('supports escaped keys and rejects legacy root replacement aliases', () => {
    assert.throws(() => setStrictPath({ other: 1 }, '/', 'empty'));
    assert.equal(getStrictPath({ 'a/b': { '~': 3 } }, '/a~1b/~0'), 3);
    for (const path of ['', 'relative', '/bad~', '/bad~2', '/__proto__/x']) {
      assert.throws(() => normalizeJsonPointer(path));
    }
  });
});
