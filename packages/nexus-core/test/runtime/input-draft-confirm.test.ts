import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import { CatalogRegistry } from '../../src/catalog';
import type { CatalogDefinition } from '../../src/catalog';
import { standardCatalogComponentDeclarations } from '../../src/catalog/standard';
import { A2UIRuntime } from '../../src/runtime';
import type { Component } from '../../src/protocol/types';

function hostCatalog(): CatalogDefinition {
  return {
    catalogId: 'host',
    components: {
      ...standardCatalogComponentDeclarations(),
      RatingInput: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { score: { type: 'integer', dynamic: 'required' } },
        },
        inputs: { score: { type: 'integer', minimum: 0, maximum: 10 } },
      },
      StaticBadge: { schema: { type: 'object' } },
    },
    actions: [],
  };
}

function runtimeWith(
  components: readonly Component[],
  options: { dataModel?: unknown; catalogId?: string } = {},
): A2UIRuntime {
  const catalog = hostCatalog();
  const rt = new A2UIRuntime({ catalogRegistry: new CatalogRegistry([catalog]) });
  rt.dispatch({
    version: 'v0.9',
    createSurface: {
      surfaceId: 's',
      catalogId: options.catalogId ?? catalog.catalogId,
    },
  });
  if (options.dataModel !== undefined) {
    rt.dispatch({
      version: 'v0.9',
      updateDataModel: { surfaceId: 's', value: options.dataModel as Record<string, unknown> },
    });
  }
  rt.dispatch({
    version: 'v0.9',
    updateComponents: { surfaceId: 's', components: [...components] },
  });
  return rt;
}

const form: readonly Component[] = [
  {
    id: 'root',
    component: 'Column',
    children: ['score', 'note'],
  },
  { id: 'score', component: 'RatingInput', score: { path: '/score' } },
  { id: 'note', component: 'TextField', label: '备注', value: { path: '/note' } },
];

function inputsOf(snapshot: {
  entries: readonly { input: { componentId: string; property: string; value: unknown } }[];
}) {
  return snapshot.entries.map((entry) => entry.input);
}

describe('草稿发送快照与确认（S2.6.4.1）', () => {
  it('快照携带逐条代次；确认后已发送草稿清除且不重发', () => {
    const rt = runtimeWith(form, { dataModel: { score: 0, note: '' } });
    assert.ok(rt.setInputValue('score', 's', 'score', 7));
    assert.ok(rt.setInputValue('note', 's', 'value', '你好'));
    const snapshot = rt.extractLatestInputDrafts('s');
    assert.deepEqual(
      inputsOf(snapshot).map((input) => [input.componentId, input.property]),
      [
        ['score', 'score'],
        ['note', 'value'],
      ],
    );
    assert.equal(new Set(snapshot.entries.map((entry) => entry.serial)).size, 2);

    rt.confirmInputDrafts(snapshot);
    assert.deepEqual(rt.getLatestInputs('s'), []);
    // 幂等：重复确认不抛错、不变更。
    rt.confirmInputDrafts(snapshot);
    assert.deepEqual(rt.getLatestInputs('s'), []);
  });

  it('请求期间的新编辑（含改回同值）不因确认被误删', () => {
    const rt = runtimeWith(form, { dataModel: { score: 0, note: '' } });
    assert.ok(rt.setInputValue('score', 's', 'score', 7));
    const sent = rt.extractLatestInputDrafts('s');
    // 发送期间用户把 score 改回同值：代次必须变化，确认不删。
    assert.ok(rt.setInputValue('score', 's', 'score', 7));
    rt.confirmInputDrafts(sent);
    const kept = rt.getLatestInputs('s');
    assert.deepEqual(kept, [{ componentId: 'score', property: 'score', value: 7 }]);
  });

  it('同 surface 部分确认：仅清除未再编辑的条目', () => {
    const rt = runtimeWith(form, { dataModel: { score: 0, note: '' } });
    assert.ok(rt.setInputValue('score', 's', 'score', 7));
    assert.ok(rt.setInputValue('note', 's', 'value', '一'));
    const sent = rt.extractLatestInputDrafts('s');
    // 请求期间只再次编辑了 note。
    assert.ok(rt.setInputValue('note', 's', 'value', '二'));
    rt.confirmInputDrafts(sent);
    assert.deepEqual(rt.getLatestInputs('s'), [
      { componentId: 'note', property: 'value', value: '二' },
    ]);
  });

  it('其他 surface 的草稿不受确认影响', () => {
    const catalog = hostCatalog();
    const rt = new A2UIRuntime({ catalogRegistry: new CatalogRegistry([catalog]) });
    for (const surfaceId of ['a', 'b']) {
      rt.dispatch({
        version: 'v0.9',
        createSurface: { surfaceId, catalogId: catalog.catalogId },
      });
      rt.dispatch({
        version: 'v0.9',
        updateDataModel: { surfaceId, value: { score: 0 } },
      });
      rt.dispatch({
        version: 'v0.9',
        updateComponents: {
          surfaceId,
          components: [{ id: 'score', component: 'RatingInput', score: { path: '/score' } }],
        },
      });
      assert.ok(rt.setInputValue('score', surfaceId, 'score', 3));
    }
    const snapshotA = rt.extractLatestInputDrafts('a');
    rt.confirmInputDrafts(snapshotA);
    assert.deepEqual(rt.getLatestInputs('a'), []);
    assert.deepEqual(rt.getLatestInputs('b'), [
      { componentId: 'score', property: 'score', value: 3 },
    ]);
  });

  it('改绑/替换组件后确认不复活旧草稿', () => {
    const rt = runtimeWith(form, { dataModel: { score: 0, note: '' } });
    assert.ok(rt.setInputValue('score', 's', 'score', 7));
    const sent = rt.extractLatestInputDrafts('s');
    // 组件被替换：失效清理立即删除草稿。
    rt.dispatch({
      version: 'v0.9',
      updateComponents: {
        surfaceId: 's',
        components: [{ id: 'score', component: 'StaticBadge' }],
      },
    });
    rt.confirmInputDrafts(sent);
    assert.deepEqual(rt.getLatestInputs('s'), []);
  });

  it('快照与其他 runtime 实例不互认，确认是 no-op', () => {
    const first = runtimeWith(form, { dataModel: { score: 0 } });
    assert.ok(first.setInputValue('score', 's', 'score', 7));
    const snapshot = first.extractLatestInputDrafts('s');

    const second = runtimeWith(form, { dataModel: { score: 0 } });
    assert.ok(second.setInputValue('score', 's', 'score', 9));
    assert.equal(second.confirmInputDrafts(snapshot), false);
    assert.deepEqual(second.getLatestInputs('s'), [
      { componentId: 'score', property: 'score', value: 9 },
    ]);
  });

  it('失败路径不确认：草稿保留可重试', () => {
    const rt = runtimeWith(form, { dataModel: { score: 0, note: '' } });
    assert.ok(rt.setInputValue('note', 's', 'value', '草稿'));
    const sent = rt.extractLatestInputDrafts('s');
    // 模拟提交失败：不调用 confirm，草稿仍在。
    assert.deepEqual(rt.getLatestInputs('s'), [
      { componentId: 'note', property: 'value', value: '草稿' },
    ]);
    assert.equal(sent.surfaceId, 's');
  });
});

describe('成功确认后的草稿可见性', () => {
  it('权威响应归一化已发送字段，新代次草稿恢复为可见编辑值并保留 serial', () => {
    const rt = runtimeWith(form, { dataModel: { score: 0, note: '' } });
    assert.ok(rt.setInputValue('score', 's', 'score', 7));
    assert.ok(rt.setInputValue('note', 's', 'value', 'first'));
    const sent = rt.extractLatestInputDrafts('s');
    assert.ok(rt.setInputValue('note', 's', 'value', 'second'));
    const edited = rt
      .extractLatestInputDrafts('s')
      .entries.find((entry) => entry.input.componentId === 'note')!;
    rt.dispatch({
      version: 'v0.9',
      updateDataModel: { surfaceId: 's', value: { score: 8, note: 'normalized' } },
    });
    rt.confirmInputDrafts(sent);
    assert.deepEqual(rt.store.getState().dataModelBySurface.s, { score: 8, note: 'second' });
    assert.deepEqual(rt.extractLatestInputDrafts('s').entries, [edited]);
    rt.confirmInputDrafts(sent);
    assert.deepEqual(rt.store.getState().dataModelBySurface.s, { score: 8, note: 'second' });
  });

  it('发送后首次编辑的属性也恢复可见', () => {
    const rt = runtimeWith(form, { dataModel: { score: 0, note: '' } });
    const sent = rt.extractLatestInputDrafts('s');
    assert.ok(rt.setInputValue('note', 's', 'value', 'new'));
    rt.dispatch({
      version: 'v0.9',
      updateDataModel: { surfaceId: 's', value: { score: 2, note: 'server' } },
    });
    rt.confirmInputDrafts(sent);
    assert.deepEqual(rt.store.getState().dataModelBySurface.s, { score: 2, note: 'new' });
    assert.equal(rt.getLatestInputs('s')[0]?.value, 'new');
  });
});

it('新草稿恢复失败整体返回 false，模型与确认条目都不部分改变', () => {
  const rt = runtimeWith(
    [
      { id: 'root', component: 'Column', children: ['note', 'score', 'tag'] },
      { id: 'tag', component: 'TextField', label: 'tag', value: { path: '/tag' } },
      { id: 'note', component: 'TextField', label: 'note', value: { path: '/note' } },
      { id: 'score', component: 'RatingInput', score: { path: '/nested/score' } },
    ],
    { dataModel: { note: '', nested: { score: 0 } } },
  );
  assert.ok(rt.setInputValue('note', 's', 'value', 'sent'));
  assert.ok(rt.setInputValue('tag', 's', 'value', 'sent-tag'));
  const sent = rt.extractLatestInputDrafts('s');
  assert.ok(rt.setInputValue('note', 's', 'value', 'new-note'));
  assert.ok(rt.setInputValue('score', 's', 'score', 7));
  rt.dispatch({
    version: 'v0.9',
    updateDataModel: { surfaceId: 's', value: { note: 'server', tag: 'server-tag', nested: 1 } },
  });
  const model = structuredClone(rt.store.getState().dataModelBySurface.s);
  const drafts = rt.extractLatestInputDrafts('s');
  assert.equal(rt.confirmInputDrafts(sent), false);
  assert.deepEqual(rt.store.getState().dataModelBySurface.s, model);
  assert.deepEqual(rt.extractLatestInputDrafts('s'), drafts);
});

it('改回同值的新代次在权威归一化后恢复可见', () => {
  const rt = runtimeWith(form, { dataModel: { score: 0, note: '' } });
  assert.ok(rt.setInputValue('score', 's', 'score', 7));
  const sent = rt.extractLatestInputDrafts('s');
  assert.ok(rt.setInputValue('score', 's', 'score', 7));
  rt.dispatch({ version: 'v0.9', updateDataModel: { surfaceId: 's', path: '/score', value: 8 } });
  assert.equal(rt.confirmInputDrafts(sent), true);
  assert.equal((rt.store.getState().dataModelBySurface.s as { score: number }).score, 7);
  assert.equal(rt.getLatestInputs('s')[0]?.value, 7);
});
