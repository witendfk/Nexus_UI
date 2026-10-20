import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CatalogDefinition } from '@nexus-ui/core';
import {
  createCatalogContractHash,
  createCatalogContractReference,
  CATALOG_CONTRACT_VERSION,
} from '../../src/agent/catalog-contract';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * S2.5.5 hash 一致性口径（复用 server 既有 hash 实现，不另建解释器）：
 * - 输入能力（inputs）与 action 参数 schema（paramSchema）变化必须影响 hash；
 * - 对象键顺序不影响 hash；hash 为完整 `sha256:<64 hex>` 格式。
 */

function loadFixtureCatalog(name: string): CatalogDefinition {
  const file = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/catalog-v2', name),
    'utf8',
  );
  const parsed = JSON.parse(file) as { catalog: CatalogDefinition };
  return parsed.catalog;
}

const interactive = loadFixtureCatalog('catalog-accept-interactive-form.json');

describe('createCatalogContractHash 发布一致性口径（S2.5.5）', () => {
  it('hash 为完整 sha256:<64 hex> 格式并携带契约版本', () => {
    const hash = createCatalogContractHash(interactive);
    assert.match(hash, /^sha256:[0-9a-f]{64}$/);
    const reference = createCatalogContractReference(interactive);
    assert.equal(reference.version, CATALOG_CONTRACT_VERSION);
    assert.equal(reference.hash, hash);
  });

  it('输入能力（inputs）变化影响 hash', () => {
    const withoutInputs = structuredClone(interactive);
    const textField = withoutInputs.components.TextField as {
      inputs?: Record<string, unknown>;
    };
    assert.ok(textField.inputs);
    delete textField.inputs;

    assert.notEqual(
      createCatalogContractHash(withoutInputs),
      createCatalogContractHash(interactive),
    );
  });

  it('action 参数 schema（paramSchema）变化影响 hash', () => {
    const withoutParams = structuredClone(interactive);
    const rate = withoutParams.actions.find((action) => action.name === 'rate');
    assert.ok(rate);
    delete (rate as { paramSchema?: unknown }).paramSchema;

    assert.notEqual(
      createCatalogContractHash(withoutParams),
      createCatalogContractHash(interactive),
    );
  });

  it('对象键顺序不影响 hash（含 inputs 嵌套键）', () => {
    const reordered = JSON.parse(JSON.stringify(interactive)) as CatalogDefinition;
    const originalInputs = (interactive.components.TextField as { inputs: Record<string, unknown> })
      .inputs;
    const reorderedInputs = (reordered.components.TextField as { inputs: Record<string, unknown> })
      .inputs;
    // JSON.parse 保留键序；构造反向键序的等价 inputs
    const flipped = Object.fromEntries(Object.entries(reorderedInputs).slice().reverse());
    assert.deepEqual(Object.keys(flipped), Object.keys(originalInputs).slice().reverse());
    (reordered.components.TextField as { inputs: Record<string, unknown> }).inputs = flipped;

    assert.equal(createCatalogContractHash(reordered), createCatalogContractHash(interactive));
  });
});
