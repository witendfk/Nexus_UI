import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import { CatalogRegistry } from '../src/catalog';
import type { ComponentPropsSchema } from '../src/catalog/schema';

describe('CatalogRegistry', () => {
  it('注册并查询 catalog 与组件', () => {
    const registry = new CatalogRegistry([{ catalogId: 'basic', components: ['Text', 'Button'] }]);

    assert.equal(registry.has('basic'), true);
    assert.equal(registry.supportsComponent('basic', 'Text'), true);
    assert.equal(registry.supportsComponent('basic', 'TextField'), false);
    assert.equal(registry.supportsComponent('unknown', 'Text'), false);
    assert.deepEqual(registry.list(), [{ catalogId: 'basic', components: ['Text', 'Button'] }]);
  });

  it('拒绝非法和重复定义', () => {
    assert.throws(() => new CatalogRegistry([{ catalogId: '', components: ['Text'] }]));
    assert.throws(() => new CatalogRegistry([{ catalogId: 'basic', components: [] }]));
    assert.throws(
      () => new CatalogRegistry([{ catalogId: 'basic', components: ['Text', 'Text'] }]),
    );

    const registry = new CatalogRegistry([{ catalogId: 'basic', components: ['Text'] }]);
    assert.throws(() => registry.register({ catalogId: 'basic', components: ['Button'] }));
  });

  it('注册并执行自定义组件 props schema', () => {
    const registry = new CatalogRegistry([
      {
        catalogId: 'task',
        components: ['TaskSummary'],
        componentSchemas: {
          TaskSummary: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'priority'],
            properties: {
              title: { type: 'string', minLength: 1, dynamic: 'allowed' },
              priority: { type: 'string', enum: ['high', 'normal', 'low'] },
              meta: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  tags: { type: 'array', items: { type: 'string', minLength: 1 } },
                },
              },
            },
          },
        },
      },
    ]);

    assert.equal(
      registry.validateComponent('task', {
        id: 'root',
        component: 'TaskSummary',
        title: { path: '/title' },
        priority: 'high',
        meta: { tags: ['agent'] },
      }),
      null,
    );
    assert.equal(
      registry.validateComponent('task', {
        id: 'root',
        component: 'TaskSummary',
        title: { path: '/title' },
        priority: 'urgent',
      }),
      'TaskSummary.priority 只支持 "high"/"normal"/"low"',
    );
    assert.equal(
      registry.validateComponent('task', {
        id: 'root',
        component: 'TaskSummary',
        title: '任务',
        priority: 'high',
        owner: 'host',
      }),
      'TaskSummary.owner 不是允许的字段',
    );
  });

  it('聚合返回所有 props schema 诊断', () => {
    const registry = new CatalogRegistry([
      {
        catalogId: 'task',
        components: ['TaskSummary'],
        componentSchemas: {
          TaskSummary: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'priority'],
            properties: {
              title: { type: 'string', minLength: 1 },
              priority: { type: 'string', enum: ['high', 'normal', 'low'] },
              meta: {
                type: 'object',
                properties: {
                  tags: { type: 'array', items: { type: 'string', minLength: 1 } },
                },
              },
            },
          },
        },
      },
    ]);

    assert.deepEqual(
      registry.getComponentDiagnostics('task', {
        id: 'root',
        component: 'TaskSummary',
        priority: 'urgent',
        meta: { tags: ['agent', 12] },
        owner: 'host',
      }),
      [
        { path: 'TaskSummary.title', message: 'TaskSummary.title 是必填字段' },
        { path: 'TaskSummary.owner', message: 'TaskSummary.owner 不是允许的字段' },
        {
          path: 'TaskSummary.priority',
          message: 'TaskSummary.priority 只支持 "high"/"normal"/"low"',
        },
        {
          path: 'TaskSummary.meta.tags[1]',
          message: 'TaskSummary.meta.tags[1] 必须是 string',
        },
      ],
    );
  });

  it('动态绑定在 dataModel 已有值时校验 resolved value', () => {
    const schema: ComponentPropsSchema = {
      type: 'object',
      properties: { amount: { type: 'number', minimum: 0, dynamic: 'allowed' } },
    };
    const component = {
      id: 'root',
      component: 'TaskSummary',
      amount: { path: '/amount' },
    };

    assert.deepEqual(registryDiagnostics(component, schema, { other: 1 }), []);
    assert.deepEqual(registryDiagnostics(component, schema, { amount: 12 }), []);
    assert.deepEqual(registryDiagnostics(component, schema, { amount: '12' }), [
      {
        path: 'TaskSummary.amount',
        message: 'TaskSummary.amount 必须是 number',
        dataPath: '/amount',
      },
    ]);
  });

  it('注册时拒绝非法 component schema', () => {
    assert.throws(
      () =>
        new CatalogRegistry([
          {
            catalogId: 'task',
            components: ['TaskSummary'],
            componentSchemas: {
              Unknown: { type: 'object' },
            },
          },
        ]),
    );
    assert.throws(
      () =>
        new CatalogRegistry([
          {
            catalogId: 'task',
            components: ['TaskSummary'],
            componentSchemas: {
              TaskSummary: { type: 'string' } as unknown as ComponentPropsSchema,
            },
          },
        ]),
    );
    assert.throws(
      () =>
        new CatalogRegistry([
          {
            catalogId: 'task',
            components: ['TaskSummary'],
            componentSchemas: {
              TaskSummary: {
                type: 'object',
                properties: {
                  title: { dynamic: 'sometimes' } as unknown as ComponentPropsSchema,
                },
              },
            },
          },
        ]),
    );
  });
});

function registryDiagnostics(
  component: Parameters<CatalogRegistry['validateComponent']>[1],
  schema: ComponentPropsSchema,
  dataModel: unknown,
) {
  const registry = new CatalogRegistry([
    {
      catalogId: 'task',
      components: ['TaskSummary'],
      componentSchemas: { TaskSummary: schema },
    },
  ]);
  return registry.getComponentDiagnostics('task', component, dataModel);
}
