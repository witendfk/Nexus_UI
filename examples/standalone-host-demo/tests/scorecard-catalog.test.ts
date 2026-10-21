import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CatalogDefinition } from '@nexus-ui/core';
import { CatalogRegistry, validateInputValueDiagnostics } from '@nexus-ui/core';
import {
  SCORECARD_ACTION,
  SCORECARD_CATALOG_ID,
  scorecardHostCatalog,
} from '../src/shared/scorecard-contract';

function clone(): CatalogDefinition {
  return structuredClone(scorecardHostCatalog);
}

describe('S2.6.2.1 中立 scorecard 夹具注册闸门', () => {
  it('原样定义通过同一注册闸门，声明整数/布尔输入与非 Button 触发器', () => {
    const registry = new CatalogRegistry([structuredClone(scorecardHostCatalog)]);
    const catalog = registry.get(SCORECARD_CATALOG_ID);
    assert.ok(catalog);
    const score = catalog.components.ScoreDial;
    assert.deepEqual(score?.inputs, { score: { type: 'integer', minimum: 0, maximum: 100 } });
    assert.deepEqual(catalog.components.PinnedToggle?.inputs, { pinned: { type: 'boolean' } });
    const action = catalog.actions.find((entry) => entry.name === SCORECARD_ACTION);
    assert.deepEqual(action?.sources, ['SubmitCard']);
    assert.equal(catalog.components.SubmitCard?.action?.required, true);
  });

  it('整数输入范围声明非法（minimum>maximum）注册拒绝', () => {
    const catalog = clone();
    const scoreInputs = (
      catalog.components.ScoreDial as unknown as {
        inputs: { score: { minimum: number; maximum: number } };
      }
    ).inputs;
    scoreInputs.score.minimum = 100;
    scoreInputs.score.maximum = 0;
    assert.throws(() => new CatalogRegistry([catalog]), /minimum/);
  });

  it('inputs 键未在 schema.properties 声明时注册拒绝', () => {
    const catalog = clone();
    (
      catalog.components.ScoreDial as unknown as {
        inputs: Record<string, unknown>;
      }
    ).inputs = { level: { type: 'integer', minimum: 0, maximum: 100 } };
    assert.throws(() => new CatalogRegistry([catalog]), /inputs|level/);
  });

  it('inputs 值 schema 携带 dynamic 注册拒绝', () => {
    const catalog = clone();
    (
      catalog.components.PinnedToggle as unknown as {
        inputs: { pinned: { dynamic: string } };
      }
    ).inputs.pinned.dynamic = 'required';
    assert.throws(() => new CatalogRegistry([catalog]), /dynamic/);
  });

  it('action 挂载来源与组件声明不一致注册拒绝', () => {
    const catalog: CatalogDefinition = {
      ...clone(),
      actions: clone().actions.map((entry) =>
        entry.name === SCORECARD_ACTION ? { ...entry, sources: ['Text'] } : entry,
      ),
    };
    assert.throws(() => new CatalogRegistry([catalog]), /sources/);
  });

  it('score 越界或非整数在声明值域校验被拒', () => {
    const catalog = structuredClone(scorecardHostCatalog);
    const inputs = catalog.components.ScoreDial?.inputs;
    assert.ok(inputs);
    assert.ok(validateInputValueDiagnostics(101, inputs.score, 'score').length > 0);
    assert.ok(validateInputValueDiagnostics(3.5, inputs.score, 'score').length > 0);
    assert.ok(validateInputValueDiagnostics('42', inputs.score, 'score').length > 0);
    assert.equal(validateInputValueDiagnostics(42, inputs.score, 'score').length, 0);
  });
});
