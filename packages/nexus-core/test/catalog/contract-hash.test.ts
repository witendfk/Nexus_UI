import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import {
  CatalogRegistry,
  getCatalogContractHashInput,
  type CatalogDefinition,
} from '../../src/catalog';

describe('Catalog hash 的 JSON 传输一致性', () => {
  it('合法可选字段显式 undefined 与省略字段经 JSON 往返后摘要输入相同', () => {
    const catalog: CatalogDefinition = {
      catalogId: 'wire',
      components: { Label: { schema: { type: 'object' }, origin: undefined, inputs: undefined } },
      actions: [],
    };
    new CatalogRegistry([catalog]);
    const wire = JSON.parse(JSON.stringify(catalog)) as CatalogDefinition;
    new CatalogRegistry([wire]);
    assert.equal(getCatalogContractHashInput(catalog), getCatalogContractHashInput(wire));
  });

  it('JSON 声明的既有规范化不变，键序无关且能力变化影响摘要', () => {
    const first: CatalogDefinition = {
      catalogId: 'wire',
      components: { Label: { schema: { type: 'object' } } },
      actions: [],
    };
    const second: CatalogDefinition = {
      actions: [],
      components: { Label: { schema: { type: 'object' } } },
      catalogId: 'wire',
    };
    assert.equal(
      getCatalogContractHashInput(first),
      '{"catalog":{"actions":[],"catalogId":"wire","components":{"Label":{"schema":{"type":"object"}}}},"contractVersion":2}',
    );
    assert.equal(getCatalogContractHashInput(first), getCatalogContractHashInput(second));
    assert.notEqual(
      getCatalogContractHashInput(first),
      getCatalogContractHashInput({ ...first, actions: [{ name: 'save', sources: ['Label'] }] }),
    );
  });
});
