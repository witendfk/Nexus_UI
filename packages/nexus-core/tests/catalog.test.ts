import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import { CatalogRegistry } from '../src/catalog';
import type { CatalogComponentDeclaration } from '../src/catalog/schema';
import type { ComponentPropsSchema } from '../src/catalog/schema';

const openDecl: CatalogComponentDeclaration = { schema: { type: 'object' } };
const baseDecl: CatalogComponentDeclaration = { schema: { type: 'object' } };

describe('CatalogRegistry', () => {
  it('注册并查询 catalog 与组件', () => {
    const definition = {
      catalogId: 'basic',
      components: { Text: openDecl, Button: openDecl },
      actions: [{ name: 'call', sources: ['Button'] }],
    };
    const registry = new CatalogRegistry([definition]);

    assert.equal(registry.has('basic'), true);
    assert.equal(registry.supportsComponent('basic', 'Text'), true);
    assert.equal(registry.supportsComponent('basic', 'TextField'), false);
    assert.equal(registry.supportsComponent('unknown', 'Text'), false);
    assert.deepEqual([...registry.getActions('basic')], ['call']);
    assert.equal(registry.supportsAction('basic', 'call'), true);
    assert.equal(registry.supportsAction('basic', 'submit'), false);
    assert.deepEqual(registry.getComponentDeclaration('basic', 'Button'), openDecl);
    assert.deepEqual(registry.getActionDeclaration('basic', 'call'), {
      name: 'call',
      sources: ['Button'],
    });
    assert.deepEqual(registry.list(), [definition]);
  });

  it('拒绝非法和重复定义', () => {
    assert.throws(
      () => new CatalogRegistry([{ catalogId: '', components: { Text: openDecl }, actions: [] }]),
    );
    assert.throws(() => new CatalogRegistry([{ catalogId: 'basic', components: {}, actions: [] }]));
    assert.throws(
      () => new CatalogRegistry([{ catalogId: 'basic', components: { Text: openDecl } } as never]),
    );
    assert.throws(
      () =>
        new CatalogRegistry([
          {
            catalogId: 'basic',
            components: { Text: { schema: { type: 'object' }, extra: 1 } },
          } as never,
        ]),
    );

    const registry = new CatalogRegistry([
      { catalogId: 'basic', components: { Text: openDecl }, actions: [] },
    ]);
    assert.throws(() =>
      registry.register({ catalogId: 'basic', components: { Button: openDecl }, actions: [] }),
    );
    assert.throws(() =>
      registry.register({
        catalogId: 'empty-action',
        components: { Text: openDecl },
        actions: [{ name: '', sources: ['Text'] }],
      }),
    );
    assert.throws(() =>
      registry.register({
        catalogId: 'duplicate-action',
        components: { Text: openDecl },
        actions: [
          { name: 'call', sources: ['Text'] },
          { name: 'call', sources: ['Text'] },
        ],
      }),
    );
    assert.throws(() =>
      registry.register({
        catalogId: 'bad-source',
        components: { Text: openDecl },
        actions: [{ name: 'call', sources: ['Button'] }],
      }),
    );
    assert.throws(() =>
      registry.register({
        catalogId: 'empty-sources',
        components: { Text: openDecl },
        actions: [{ name: 'call', sources: [] }],
      }),
    );
    assert.deepEqual(
      new CatalogRegistry([
        { catalogId: 'display-only', components: { Text: openDecl }, actions: [] },
      ]).getActions('display-only'),
      [],
    );
  });

  it('注册并执行自定义组件 props schema', () => {
    const registry = new CatalogRegistry([
      {
        catalogId: 'task',
        components: {
          TaskSummary: {
            schema: {
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
        actions: [],
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
        components: {
          TaskSummary: {
            schema: {
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
        actions: [],
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

  it('注册时拒绝非法 component schema 与越界声明', () => {
    assert.throws(
      () =>
        new CatalogRegistry([
          {
            catalogId: 'task',
            components: { TaskSummary: { schema: { type: 'string' } as never } },
            actions: [],
          },
        ]),
    );
    assert.throws(
      () =>
        new CatalogRegistry([
          {
            catalogId: 'task',
            components: {
              TaskSummary: {
                schema: {
                  type: 'object',
                  properties: {
                    title: { dynamic: 'sometimes' } as unknown as ComponentPropsSchema,
                  },
                },
              },
            },
            actions: [],
          },
        ]),
    );
    assert.throws(
      () =>
        new CatalogRegistry([
          {
            catalogId: 'task',
            components: {
              TaskSummary: {
                schema: {
                  type: 'object',
                  properties: { format: { format: 'email' } },
                } as never,
              },
            },
            actions: [],
          },
        ]),
      /不支持的 schema 关键字/,
    );
    assert.throws(
      () =>
        new CatalogRegistry([
          {
            catalogId: 'task',
            components: {
              TaskSummary: {
                schema: { type: 'object', properties: { code: { pattern: '^(?=.*[0-9]).+$' } } },
              },
            },
            actions: [],
          },
        ]),
      /不受支持的语法/,
    );
  });

  it('配置闸门拒绝错误类型与越界预算（证伪：enabled 字符串真值、非安全整数预算）', () => {
    const base = { schema: { type: 'object' } };
    assert.throws(
      () =>
        new CatalogRegistry([
          {
            catalogId: 'bad-checks',
            components: { TextField: { ...base, checks: { enabled: 'false' } } } as never,
            actions: [],
          },
        ]),
      /checks\.enabled 必须是布尔值/,
    );
    assert.throws(
      () =>
        new CatalogRegistry([
          {
            catalogId: 'bad-ref',
            components: {
              Button: { schema: base.schema, fields: { child: { componentRef: 'true' } } },
            } as never,
            actions: [],
          },
        ]),
      /componentRef 必须是布尔值/,
    );
    assert.throws(
      () =>
        new CatalogRegistry([
          {
            catalogId: 'bad-budget',
            components: {
              TextField: {
                ...base,
                checks: {
                  enabled: true,
                  functions: ['required'],
                  maxRules: Number.MAX_SAFE_INTEGER + 1,
                },
              },
            } as never,
            actions: [],
          },
        ]),
      /checks\.maxRules 必须是非负安全整数/,
    );
    assert.throws(
      () =>
        new CatalogRegistry([
          { catalogId: 123 as never, components: { Text: baseDecl }, actions: [] },
        ]),
      /catalogId 必须是非空字符串/,
    );
  });

  it('自有属性判断：toString 冒充已声明组件或字段被拒（证伪：in 沿原型链误判）', () => {
    assert.throws(
      () =>
        new CatalogRegistry([
          {
            catalogId: 'proto-source',
            components: { Text: { schema: { type: 'object' } } },
            actions: [{ name: 'call', sources: ['toString'] }],
          },
        ]),
      /sources 引用未声明组件: toString/,
    );
    const registry = new CatalogRegistry([
      {
        catalogId: 'own-props',
        components: {
          Card: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: { title: { type: 'string' } },
            },
          },
        },
        actions: [],
      },
    ]);
    // 自有 toString 属性不是声明字段（in 会沿原型链误判为存在）
    const component = {
      id: 'card',
      component: 'Card',
      title: 'T',
      toString: 'injected',
    } as unknown as Parameters<CatalogRegistry['validateComponent']>[1];
    assert.equal(
      registry.validateComponent('own-props', component),
      'Card.toString 不是允许的字段',
    );
  });

  it('inputs 值 schema 全树禁止 dynamic（含嵌套 properties/items）', () => {
    assert.throws(
      () =>
        new CatalogRegistry([
          {
            catalogId: 'nested-dynamic',
            components: {
              RatingInput: {
                schema: {
                  type: 'object',
                  properties: {
                    profile: { type: 'object', dynamic: 'required' },
                  },
                },
                inputs: {
                  profile: {
                    type: 'object',
                    properties: { name: { type: 'string', dynamic: 'allowed' } },
                  },
                },
              },
            },
            actions: [],
          },
        ]),
      /properties\.name\.dynamic 不受支持：输入值是字面值/,
    );
    assert.throws(
      () =>
        new CatalogRegistry([
          {
            catalogId: 'nested-dynamic-items',
            components: {
              TagInput: {
                schema: {
                  type: 'object',
                  properties: { tags: { type: 'array', dynamic: 'required' } },
                },
                inputs: {
                  tags: { type: 'array', items: { type: 'string', dynamic: 'allowed' } },
                },
              },
            },
            actions: [],
          },
        ]),
      /items\.dynamic 不受支持：输入值是字面值/,
    );
  });

  it('enforces declarative component capability policies', () => {
    const registry = new CatalogRegistry([
      {
        catalogId: 'profile',
        components: {
          Button: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: { disabled: { type: 'boolean' } },
            },
            fields: {
              child: { componentRef: true, origin: 'official-basic' },
              disabled: { origin: 'nexus-extension' },
            },
            checks: {
              enabled: true,
              functions: ['required'],
              maxRules: 1,
              maxMessageLength: 10,
              maxPatternLength: 8,
            },
          },
        },
        actions: [{ name: 'submit', sources: ['Button'] }],
      },
    ]);

    assert.deepEqual(
      registry.getComponentDiagnostics('profile', {
        id: 'submit',
        component: 'Button',
        child: 'label',
        disabled: true,
        action: { event: { name: 'submit' } },
      }),
      [],
    );
    assert.deepEqual(
      registry.getComponentDiagnostics('profile', {
        id: 'submit',
        component: 'Button',
        child: 1,
        disabled: true,
        owner: 'host',
      } as unknown as Parameters<CatalogRegistry['validateComponent']>[1]),
      [
        { path: 'Button.child', message: 'Button.child 必须是组件 id' },
        { path: 'Button.owner', message: 'Button.owner 不是允许的字段' },
      ],
    );
    // 未注册 action 名由共享诊断统一报告（runtime 不再另设一套）。
    assert.deepEqual(
      registry.getComponentDiagnostics('profile', {
        id: 'submit',
        component: 'Button',
        action: { event: { name: 'other' } },
      }),
      [
        {
          path: 'components.submit.action.event.name',
          message: 'Catalog profile 不支持 action: other',
        },
      ],
    );
  });

  it('action 挂载按声明 sources 准入，不按组件名特判', () => {
    const registry = new CatalogRegistry([
      {
        catalogId: 'mount',
        components: {
          Button: {
            schema: { type: 'object', additionalProperties: false, properties: {} },
            action: { required: true },
          },
          Text: openDecl,
        },
        actions: [{ name: 'submit', sources: ['Button'] }],
      },
    ]);

    assert.deepEqual(
      registry.getComponentDiagnostics('mount', {
        id: 'btn',
        component: 'Button',
        action: { event: { name: 'submit' } },
      }),
      [],
    );
    assert.equal(
      registry.validateComponent('mount', {
        id: 'txt',
        component: 'Text',
        action: { event: { name: 'submit' } },
      }),
      'Catalog mount 的 action submit 不允许挂载在组件 Text 上（sources 不含该组件）',
    );
    assert.throws(
      () =>
        new CatalogRegistry([
          {
            catalogId: 'orphan',
            components: { Text: { schema: { type: 'object' }, action: { required: true } } },
            actions: [],
          },
        ]),
      /action.required 但不在任何 action 的 sources 中/,
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
      components: { TaskSummary: { schema } },
      actions: [],
    },
  ]);
  return registry.getComponentDiagnostics('task', component, dataModel);
}
