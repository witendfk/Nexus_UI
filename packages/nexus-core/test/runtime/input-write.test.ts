import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import { CatalogRegistry } from '../../src/catalog';
import type { CatalogDefinition } from '../../src/catalog';
import { standardCatalogComponentDeclarations } from '../../src/catalog/standard';
import { A2UIRuntime } from '../../src/runtime';
import type { Component } from '../../src/protocol/types';

/** 宿主 Catalog：标准声明组合 + 自定义输入（非 value 绑定属性）+ 自定义展示组件。 */
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
  options: { dataModel?: unknown; catalog?: CatalogDefinition } = {},
): { rt: A2UIRuntime; renders: number } {
  let renders = 0;
  const catalog = options.catalog ?? hostCatalog();
  const rt = new A2UIRuntime({
    catalogRegistry: new CatalogRegistry([catalog]),
    onRender: () => {
      renders += 1;
    },
  });
  rt.dispatch({
    version: 'v0.9',
    createSurface: { surfaceId: 's', catalogId: catalog.catalogId },
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
  return { rt, renders };
}

describe('setInputValue 声明驱动写回与输入收集（S2.3）', () => {
  it('自定义非 value 绑定属性可写回：路径由声明解析，草稿记录最新输入', () => {
    const { rt, renders } = runtimeWith(
      [{ id: 'r1', component: 'RatingInput', score: { path: '/profile/score' } } as Component],
      { dataModel: { profile: { score: 3 } } },
    );
    assert.equal(rt.setInputValue('r1', 's', 'score', 7), true);
    assert.deepEqual(rt.store.getState().dataModelBySurface.s, { profile: { score: 7 } });
    assert.ok(renders > 0);
    assert.deepEqual(rt.getLatestInputs('s'), [{ componentId: 'r1', property: 'score', value: 7 }]);
  });

  it('array aliases and root input targets reject without changing model or drafts', () => {
    for (const path of ['/', '/arr/01', '/arr/+1', '/arr/1e0', '/arr/']) {
      const { rt } = runtimeWith(
        [{ id: 'r1', component: 'RatingInput', score: { path } } as Component],
        { dataModel: { arr: [2, 3] } },
      );
      const before = rt.store.getState().dataModelBySurface.s;
      assert.equal(rt.setInputValue('r1', 's', 'score', 7), false, path);
      assert.equal(rt.store.getState().dataModelBySurface.s, before);
      assert.deepEqual(rt.getLatestInputs('s'), []);
    }
  });

  it('值域由声明值 schema 决定：越界/非整数/错误类型拒绝且状态与草稿不变', () => {
    const { rt } = runtimeWith(
      [{ id: 'r1', component: 'RatingInput', score: { path: '/score' } } as Component],
      { dataModel: { score: 3 } },
    );
    const before = rt.store.getState().dataModelBySurface.s;
    assert.equal(rt.setInputValue('r1', 's', 'score', 11), false);
    assert.equal(rt.setInputValue('r1', 's', 'score', 3.5), false);
    assert.equal(rt.setInputValue('r1', 's', 'score', '7'), false);
    assert.deepEqual(rt.store.getState().dataModelBySurface.s, before);
    assert.deepEqual(rt.getLatestInputs('s'), []);
  });

  it('未声明属性与只读绑定属性拒绝：inputs 键是唯一可写入口', () => {
    const { rt } = runtimeWith(
      [
        {
          id: 't1',
          component: 'TextField',
          label: { path: '/ui/title' },
          value: { path: '/name' },
        },
        { id: 'b1', component: 'StaticBadge', text: { path: '/badge' } },
      ] as Component[],
      { dataModel: { ui: { title: 't' }, name: 'n', badge: 'b' } },
    );
    // label 在 schema 中声明为可绑定，但不在 inputs 中：只读，不得写回
    assert.equal(rt.setInputValue('t1', 's', 'label', 'x'), false);
    // value 不属于 StaticBadge 声明：未知属性
    assert.equal(rt.setInputValue('b1', 's', 'value', 'x'), false);
    assert.equal(rt.setInputValue('b1', 's', 'text', 'x'), false);
    assert.deepEqual(rt.store.getState().dataModelBySurface.s, {
      ui: { title: 't' },
      name: 'n',
      badge: 'b',
    });
  });

  it('危险绑定路径拒绝（保留段）', () => {
    const { rt } = runtimeWith(
      [
        { id: 't1', component: 'TextField', label: 'p', value: { path: '/a/__proto__/x' } },
      ] as unknown as Component[],
      { dataModel: { a: {} } },
    );
    // 绑定渐进解析为 undefined，组件在准入时被接受；拒绝发生在写回边界
    assert.ok(rt.store.getState().componentsBySurface.s?.t1);
    assert.equal(rt.setInputValue('t1', 's', 'value', 'evil'), false);
    assert.deepEqual(rt.store.getState().dataModelBySurface.s, { a: {} });
  });

  it('{ path } 形状的输入值按绑定拒绝（值必须是字面值）', () => {
    const { rt } = runtimeWith(
      [{ id: 'r1', component: 'RatingInput', score: { path: '/score' } } as Component],
      { dataModel: { score: 3 } },
    );
    assert.equal(rt.setInputValue('r1', 's', 'score', { path: '/other' }), false);
    assert.deepEqual(rt.store.getState().dataModelBySurface.s, { score: 3 });
  });

  it('绑定缺失拒绝：流式未到达的绑定无写回目标', () => {
    const { rt } = runtimeWith(
      [{ id: 't2', component: 'TextField', label: 'no value yet' }] as unknown as Component[],
      { dataModel: {} },
    );
    assert.ok(rt.store.getState().componentsBySurface.s?.t2);
    assert.equal(rt.setInputValue('t2', 's', 'value', 'x'), false);
    assert.deepEqual(rt.getLatestInputs('s'), []);
  });

  it('写路径中间节点非容器时收敛为 false，不向调用方抛错', () => {
    const { rt } = runtimeWith(
      [{ id: 'r1', component: 'RatingInput', score: { path: '/a/b' } } as Component],
      { dataModel: { a: 5 } },
    );
    assert.equal(rt.setInputValue('r1', 's', 'score', 1), false);
    assert.deepEqual(rt.store.getState().dataModelBySurface.s, { a: 5 });
    assert.deepEqual(rt.getLatestInputs('s'), []);
  });

  it('无 registry 的轻量 runtime 拒绝一切本地写回（名字分支删除）', () => {
    const rt = new A2UIRuntime({});
    rt.push('{"version":"v0.9","createSurface":{"surfaceId":"s","catalogId":"any"}}\n');
    rt.push(
      '{"version":"v0.9","updateComponents":{"surfaceId":"s","components":[{"id":"t1","component":"TextField","label":"n","value":{"path":"/name"}}]}}\n',
    );
    // Profile/协议校验照常执行（组件已落库）；拒绝来自写回边界缺少 Catalog 声明
    assert.ok(rt.store.getState().componentsBySurface.s?.t1);
    assert.equal(rt.setInputValue('t1', 's', 'value', 'x'), false);
    assert.equal(rt.store.getState().dataModelBySurface.s, undefined);
    assert.deepEqual(rt.getLatestInputs('s'), []);
  });

  it('未变化输入幂等合法：重复写同值成功且草稿按组件+属性去重取最新', () => {
    const { rt } = runtimeWith(
      [{ id: 'r1', component: 'RatingInput', score: { path: '/score' } } as Component],
      { dataModel: { score: 3 } },
    );
    assert.equal(rt.setInputValue('r1', 's', 'score', 7), true);
    assert.equal(rt.setInputValue('r1', 's', 'score', 7), true);
    assert.equal(rt.setInputValue('r1', 's', 'score', 9), true);
    assert.deepEqual(rt.store.getState().dataModelBySurface.s, { score: 9 });
    assert.deepEqual(rt.getLatestInputs('s'), [{ componentId: 'r1', property: 'score', value: 9 }]);
  });

  it('多组件草稿按写入顺序排列，值快照与写入后变更隔离（防别名）', () => {
    const { rt } = runtimeWith(
      [
        {
          id: 'pick',
          component: 'ChoicePicker',
          label: 'tags',
          variant: 'multipleSelection',
          options: [
            { label: 'A', value: 'a' },
            { label: 'B', value: 'b' },
          ],
          value: { path: '/tags' },
        },
        { id: 'r1', component: 'RatingInput', score: { path: '/score' } },
      ] as unknown as Component[],
      { dataModel: { tags: ['a'], score: 1 } },
    );
    const submitted = ['a', 'b'];
    assert.equal(rt.setInputValue('pick', 's', 'value', submitted), true);
    submitted.push('mutated');
    assert.equal(rt.setInputValue('r1', 's', 'score', 5), true);
    assert.deepEqual(rt.store.getState().dataModelBySurface.s, {
      tags: ['a', 'b'],
      score: 5,
    });
    assert.deepEqual(rt.getLatestInputs('s'), [
      { componentId: 'pick', property: 'value', value: ['a', 'b'] },
      { componentId: 'r1', property: 'score', value: 5 },
    ]);
  });

  it('ChoicePicker 空数组按声明 minItems:1 拒绝（声明权威取代名字分支宽容度）', () => {
    const { rt } = runtimeWith(
      [
        {
          id: 'pick',
          component: 'ChoicePicker',
          label: 'tags',
          variant: 'multipleSelection',
          options: [{ label: 'A', value: 'a' }],
          value: { path: '/tags' },
        },
      ] as unknown as Component[],
      { dataModel: { tags: ['a'] } },
    );
    assert.equal(rt.setInputValue('pick', 's', 'value', []), false);
    assert.deepEqual(rt.store.getState().dataModelBySurface.s, { tags: ['a'] });
  });

  it('getLatestInputs 过滤已失效条目：组件被替换或属性不再可写后不再输出', () => {
    const { rt } = runtimeWith(
      [{ id: 'r1', component: 'RatingInput', score: { path: '/score' } } as Component],
      { dataModel: { score: 3 } },
    );
    assert.equal(rt.setInputValue('r1', 's', 'score', 7), true);
    // 同 id 换成无 inputs 的展示组件：旧草稿失效
    rt.dispatch({
      version: 'v0.9',
      updateComponents: { surfaceId: 's', components: [{ id: 'r1', component: 'StaticBadge' }] },
    });
    assert.deepEqual(rt.getLatestInputs('s'), []);
  });

  it('提取结果的条目、数组与嵌套对象都不与模型或后续草稿共享引用', () => {
    const { rt } = runtimeWith(
      [{ id: 'edit', component: 'Editor', content: { path: '/content' } } as Component],
      {
        catalog: {
          catalogId: 'host',
          components: {
            Editor: {
              schema: { properties: { content: { type: 'object', dynamic: 'required' } } },
              inputs: {
                content: {
                  type: 'object',
                  properties: { tags: { type: 'array', items: { type: 'string' } } },
                },
              },
            },
          },
          actions: [],
        },
        dataModel: { content: { tags: ['valid'] } },
      },
    );
    assert.equal(rt.setInputValue('edit', 's', 'content', { tags: ['valid'] }), true);
    const result = rt.getLatestInputs('s');
    const entry = result[0] as {
      componentId: string;
      property: string;
      value: { tags: unknown[] };
    };
    entry.value.tags.push(123);
    entry.componentId = 'forged';
    entry.property = 'other';
    assert.deepEqual(rt.store.getState().dataModelBySurface.s, { content: { tags: ['valid'] } });
    assert.deepEqual(rt.getLatestInputs('s'), [
      { componentId: 'edit', property: 'content', value: { tags: ['valid'] } },
    ]);
    const model = rt.store.getState().dataModelBySurface.s as { content: { tags: string[] } };
    model.content.tags.push('external-store-edit');
    assert.deepEqual(rt.getLatestInputs('s'), [
      { componentId: 'edit', property: 'content', value: { tags: ['valid'] } },
    ]);
  });

  it('绑定改址后清除旧草稿，恢复原路径也不会复活，重新编辑才记录', () => {
    const { rt } = runtimeWith(
      [{ id: 'r1', component: 'RatingInput', score: { path: '/a' } } as Component],
      { dataModel: { a: 3, b: 2 } },
    );
    assert.equal(rt.setInputValue('r1', 's', 'score', 7), true);
    for (const path of ['/b', '/a']) {
      rt.dispatch({
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's',
          components: [{ id: 'r1', component: 'RatingInput', score: { path } } as Component],
        },
      });
      // 不在两次更新之间读取，避免以读取时过滤掩盖旧草稿复活。
    }
    assert.deepEqual(rt.getLatestInputs('s'), []);
    assert.deepEqual(rt.store.getState().dataModelBySurface.s, { a: 7, b: 2 });
    assert.equal(rt.setInputValue('r1', 's', 'score', 8), true);
    assert.deepEqual(rt.getLatestInputs('s'), [{ componentId: 'r1', property: 'score', value: 8 }]);
    const components = rt.store.getState().componentsBySurface.s;
    rt.dispatch({
      version: 'v0.9',
      updateComponents: {
        surfaceId: 's',
        components: [{ id: 'r1', component: 'RatingInput', score: 'invalid' } as Component],
      },
    });
    assert.equal(rt.store.getState().componentsBySurface.s, components);
    assert.deepEqual(rt.getLatestInputs('s'), [{ componentId: 'r1', property: 'score', value: 8 }]);
  });

  for (const replacement of ['StaticBadge', 'OtherRating']) {
    it(`同 id 替换为 ${replacement} 后恢复，不会复活旧草稿`, () => {
      const catalog = hostCatalog();
      const { rt } = runtimeWith(
        [{ id: 'r1', component: 'RatingInput', score: { path: '/score' } } as Component],
        {
          dataModel: { score: 3 },
          catalog: {
            ...catalog,
            components: { ...catalog.components, OtherRating: catalog.components.RatingInput },
          },
        },
      );
      assert.equal(rt.setInputValue('r1', 's', 'score', 7), true);
      for (const type of [replacement, 'RatingInput']) {
        rt.dispatch({
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's',
            components: [
              {
                id: 'r1',
                component: type,
                ...(type === 'StaticBadge' ? {} : { score: { path: '/score' } }),
              } as Component,
            ],
          },
        });
      }
      assert.deepEqual(rt.getLatestInputs('s'), []);
    });
  }

  it('绑定消失再恢复清除草稿，同类型同绑定的无关更新保留其他 surface 的草稿', () => {
    const { rt } = runtimeWith(
      [{ id: 't', component: 'TextField', label: 'name', value: { path: '/name' } } as Component],
      { dataModel: { name: 'a' } },
    );
    rt.dispatch({ version: 'v0.9', createSurface: { surfaceId: 'other', catalogId: 'host' } });
    rt.dispatch({
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'other',
        components: [{ id: 't', component: 'TextField', label: 'name', value: { path: '/name' } }],
      },
    });
    assert.equal(rt.setInputValue('t', 's', 'value', 'edited'), true);
    assert.equal(rt.setInputValue('t', 'other', 'value', 'isolated'), true);
    rt.dispatch({
      version: 'v0.9',
      updateComponents: {
        surfaceId: 's',
        components: [{ id: 't', component: 'TextField', label: 'name' }],
      },
    });
    rt.dispatch({
      version: 'v0.9',
      updateComponents: {
        surfaceId: 's',
        components: [{ id: 't', component: 'TextField', label: 'name', value: { path: '/name' } }],
      },
    });
    rt.dispatch({
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'other',
        components: [
          { id: 't', component: 'TextField', label: 'new label', value: { path: '/name' } },
        ],
      },
    });
    assert.deepEqual(rt.getLatestInputs('s'), []);
    assert.deepEqual(rt.getLatestInputs('other'), [
      { componentId: 't', property: 'value', value: 'isolated' },
    ]);
  });

  it('Catalog 输入声明变化后清除已记录草稿', () => {
    const catalog = hostCatalog();
    const { rt } = runtimeWith(
      [{ id: 'r1', component: 'RatingInput', score: { path: '/score' } } as Component],
      { dataModel: { score: 3 }, catalog },
    );
    assert.equal(rt.setInputValue('r1', 's', 'score', 7), true);
    Object.assign(catalog.components.RatingInput.inputs!.score, { maximum: 5 });
    assert.deepEqual(rt.getLatestInputs('s'), []);
    Object.assign(catalog.components.RatingInput.inputs!.score, { maximum: 10 });
    assert.deepEqual(rt.getLatestInputs('s'), []);
  });

  it('deleteSurface 清理该 surface 的输入草稿', () => {
    const { rt } = runtimeWith(
      [{ id: 'r1', component: 'RatingInput', score: { path: '/score' } } as Component],
      { dataModel: { score: 3 } },
    );
    assert.equal(rt.setInputValue('r1', 's', 'score', 7), true);
    rt.dispatch({ version: 'v0.9', deleteSurface: { surfaceId: 's' } });
    assert.deepEqual(rt.getLatestInputs('s'), []);
  });

  it('未知组件 id 与未知 surface 返回 false/空', () => {
    const { rt } = runtimeWith(
      [{ id: 'r1', component: 'RatingInput', score: { path: '/score' } } as Component],
      { dataModel: { score: 3 } },
    );
    assert.equal(rt.setInputValue('ghost', 's', 'score', 1), false);
    assert.equal(rt.setInputValue('r1', 'other', 'score', 1), false);
    assert.deepEqual(rt.getLatestInputs('other'), []);
  });

  it('标准输入组件与自定义组件走同一路径：声明值 schema 决定值域', () => {
    const { rt } = runtimeWith(
      [
        { id: 't1', component: 'TextField', label: 'n', value: { path: '/name' } },
        { id: 'c1', component: 'CheckBox', label: 'sub', value: { path: '/subscribed' } },
        {
          id: 's1',
          component: 'Slider',
          label: 't',
          min: 0,
          max: 1,
          value: { path: '/threshold' },
        },
      ] as unknown as Component[],
      { dataModel: { name: '', subscribed: false, threshold: 0.2 } },
    );
    assert.equal(rt.setInputValue('t1', 's', 'value', 'A2UI'), true);
    assert.equal(rt.setInputValue('c1', 's', 'value', true), true);
    assert.equal(rt.setInputValue('c1', 's', 'value', 'true'), false);
    assert.equal(rt.setInputValue('s1', 's', 'value', 0.7), true);
    assert.equal(rt.setInputValue('s1', 's', 'value', '0.7'), false);
    assert.deepEqual(rt.store.getState().dataModelBySurface.s, {
      name: 'A2UI',
      subscribed: true,
      threshold: 0.7,
    });
    assert.deepEqual(rt.getLatestInputs('s'), [
      { componentId: 't1', property: 'value', value: 'A2UI' },
      { componentId: 'c1', property: 'value', value: true },
      { componentId: 's1', property: 'value', value: 0.7 },
    ]);
  });

  it('Catalog 未声明 inputs 的同名组件不因标准名获得写回能力（声明权威）', () => {
    const { rt } = runtimeWith(
      [{ id: 't1', component: 'TextField', value: { path: '/name' } } as Component],
      {
        dataModel: { name: '' },
        catalog: {
          catalogId: 'host',
          components: {
            TextField: { schema: { type: 'object' } }, // 无 inputs：TextField 名不隐含可写
          },
          actions: [],
        },
      },
    );
    assert.equal(rt.setInputValue('t1', 's', 'value', 'x'), false);
  });
});
