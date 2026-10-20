import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CatalogRegistry, standardCatalogComponentDeclarations } from '@nexus-ui/core';
import type { CatalogDefinition } from '@nexus-ui/core';
import { AgentAdapter } from '../../src/agent/adapter';
import type { AgentAction, AgentMessageSource } from '../../src/agent/adapter';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';
import { InMemorySurfaceActionStateStore } from '../../src/agent/surface-action-state';

/** 自洽夹具 Catalog：标准声明组合 + 显式 paramSchema（S2.4 参数准入）。 */
const ADMISSION_CATALOG_ID = 'https://example.com/catalogs/adapter-admission/v1';
const admissionCatalog: CatalogDefinition = {
  catalogId: ADMISSION_CATALOG_ID,
  components: standardCatalogComponentDeclarations(),
  actions: [
    {
      name: 'submit',
      sources: ['Button'],
      paramSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { counter: { type: 'number' }, note: { type: 'string' } },
      },
    },
  ],
};
const registry = new CatalogRegistry([admissionCatalog]);
const catalogHash = createCatalogContractHash(admissionCatalog);

const SURFACE = 's-admission';
const GENERATION_STREAM = [
  { version: 'v0.9', createSurface: { surfaceId: SURFACE, catalogId: ADMISSION_CATALOG_ID } },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: SURFACE,
      components: [
        { id: 'root', component: 'Column', children: ['note', 'button', 'label'] },
        {
          id: 'note',
          component: 'TextField',
          label: '备注',
          value: { path: '/note' },
        },
        {
          id: 'button',
          component: 'Button',
          child: 'label',
          action: {
            event: {
              name: 'submit',
              context: { counter: { path: '/counter' }, note: { path: '/note' } },
            },
          },
        },
        { id: 'label', component: 'Text', text: '提交' },
      ],
    },
  },
  { version: 'v0.9', updateDataModel: { surfaceId: SURFACE, value: { counter: 0.2, note: '' } } },
];

interface Harness {
  adapter: AgentAdapter;
  store: InMemorySurfaceActionStateStore;
  handlerCalls: { context: Record<string, unknown> }[];
}

async function createHarness(
  options: {
    editablePaths?: (surfaceId: string) => readonly string[];
    resolveActionContext?: never;
  } = {},
): Promise<Harness> {
  const store = new InMemorySurfaceActionStateStore();
  const handlerCalls: { context: Record<string, unknown> }[] = [];
  const adapter = new AgentAdapter({
    registry,
    ...(options.editablePaths === undefined ? {} : { editablePaths: options.editablePaths }),
    actionStateStore: store,
    createSurfaceId: () => SURFACE,
    createGenerationSource: () =>
      GENERATION_STREAM[Symbol.iterator]() as unknown as AgentMessageSource,
  });
  adapter.registerActionHandler(ADMISSION_CATALOG_ID, 'submit', async (action) => {
    handlerCalls.push({ context: { ...action.context } });
    return [
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: action.surfaceId,
          path: '/counter',
          value: action.context.counter,
        },
      },
    ];
  });
  const generation = await adapter.prepareGeneration({
    message: '建立 surface',
    catalogId: ADMISSION_CATALOG_ID,
  });
  assert.ok(generation.ok, generation.ok ? '' : generation.message);
  for await (const _ of generation.run.source) void _;
  await generation.run.commit(GENERATION_STREAM);
  return { adapter, store, handlerCalls };
}

let actionSeq = 0;

function actionWith(overrides: Record<string, unknown>): AgentAction {
  actionSeq += 1;
  return {
    name: 'submit',
    surfaceId: SURFACE,
    sourceComponentId: 'button',
    timestamp: '2026-10-18T00:00:00.000Z',
    actionId: `admission-${actionSeq}`,
    sessionVersion: 1,
    surfaceRevision: 1,
    catalogHash,
    context: {},
    ...overrides,
  } as AgentAction;
}

async function snapshotOf(store: InMemorySurfaceActionStateStore) {
  const snapshot = await store.get(SURFACE);
  assert.ok(snapshot);
  return snapshot;
}

describe('AgentAdapter × 权威准入（S2.4 不变式）', () => {
  it('拒绝类（revision/hash/schema/冲突/白名单）一律 handler 未调用、快照不变、可重试', async () => {
    const { adapter, store, handlerCalls } = await createHarness({
      editablePaths: () => ['/note'],
    });
    const before = await snapshotOf(store);

    const rejections: readonly AgentAction[] = [
      actionWith({ surfaceRevision: 2, catalogHash, inputs: [] }),
      actionWith({ surfaceRevision: 1, catalogHash: 'sha256:' + 'b'.repeat(64), inputs: [] }),
      actionWith({
        surfaceRevision: 1,
        catalogHash,
        inputs: [{ componentId: 'note', property: 'value', value: 9 }],
      }),
      actionWith({
        surfaceRevision: 1,
        catalogHash,
        inputs: [{ componentId: 'ghost', property: 'value', value: 'x' }],
      }),
      actionWith({
        surfaceRevision: 1,
        catalogHash,
        inputs: [{ componentId: 'note', property: 'value', value: 'x', path: '/hack' }],
      }),
    ];
    for (const [index, action] of rejections.entries()) {
      const plan = await adapter.prepareAction(action);
      assert.equal(plan.ok, false, `rejection ${index} 应失败`);
      assert.ok(
        'code' in plan && typeof plan.code === 'string',
        `rejection ${index} 应带结构化 code`,
      );
      assert.equal(handlerCalls.length, 0, `rejection ${index} 不得调用 handler`);
    }

    const after = await snapshotOf(store);
    assert.equal(after.version, before.version, '拒绝不得递增 revision');
    assert.deepEqual(after.dataModel, before.dataModel, '拒绝不得改变已提交模型');

    // 拒绝记录为 failed 终态：同一 action 修正后可重新提交（重放保护不误锁）
    const retry = await adapter.prepareAction(
      actionWith({ surfaceRevision: 1, catalogHash, inputs: [] }),
    );
    assert.ok(retry.ok, retry.ok ? '' : retry.message);
  });

  it('可编辑白名单缺省即全部拒绝；白名单配置错误显式抛出', async () => {
    const denied = await createHarness();
    const plan = await denied.adapter.prepareAction(
      actionWith({
        surfaceRevision: 1,
        catalogHash,
        inputs: [{ componentId: 'note', property: 'value', value: '浏览器编辑' }],
      }),
    );
    assert.equal(plan.ok, false);
    assert.ok(!plan.ok && plan.code === 'path-forbidden');
    assert.equal(denied.handlerCalls.length, 0);

    const broken = await createHarness({
      editablePaths: () => ['/a', '/a'],
    });
    await assert.rejects(() => broken.adapter.prepareAction(actionWith({ inputs: [] })), /重复/);
  });

  it('合法输入经临时模型重算参数到达 handler；已提交快照在准入时不变', async () => {
    const { adapter, store, handlerCalls } = await createHarness({
      editablePaths: () => ['/note'],
    });
    const before = await snapshotOf(store);
    const plan = await adapter.prepareAction(
      actionWith({
        surfaceRevision: 1,
        catalogHash,
        inputs: [{ componentId: 'note', property: 'value', value: '浏览器编辑' }],
      }),
    );
    assert.ok(plan.ok, plan.ok ? '' : plan.message);
    assert.equal(handlerCalls.length, 0, '消息源消费前不执行 handler');
    for await (const message of plan.run.source) void message;
    assert.equal(handlerCalls.length, 1);
    // 参数来自临时输入模型（0.5），不是已提交模型（0.2）
    assert.deepEqual(handlerCalls[0]?.context, { counter: 0.2, note: '浏览器编辑' });

    const midStream = await snapshotOf(store);
    assert.equal(midStream.version, before.version, '准入本身不发布输入、不递增 revision');

    await plan.run.commit([
      {
        version: 'v0.9',
        updateDataModel: { surfaceId: SURFACE, value: { counter: 0.2, note: '浏览器编辑' } },
      },
    ]);
    const after = await snapshotOf(store);
    assert.equal(after.version, before.version + 1, '提交沿既有 patch 路径递增');
    assert.deepEqual(after.dataModel, { counter: 0.2, note: '浏览器编辑' });
  });

  it('resolver 后置：可读取共享准入参数与临时模型，输出仍须通过声明与 paramSchema', async () => {
    const seen: { params: unknown; tempDataModel: unknown }[] = [];
    const store = new InMemorySurfaceActionStateStore();
    const handlerCalls: unknown[] = [];
    const adapter = new AgentAdapter({
      registry,
      actionStateStore: store,
      editablePaths: () => ['/note'],
      createSurfaceId: () => SURFACE,
      createGenerationSource: () =>
        GENERATION_STREAM[Symbol.iterator]() as unknown as AgentMessageSource,
      resolveActionContext: ({ params, tempDataModel }) => {
        seen.push({ params, tempDataModel });
        // 合法扩展：基于共享参数派生（保持已声明键）
        return {
          counter: (params as { counter: number }).counter,
          note: (params as { note: string }).note,
        };
      },
    });
    adapter.registerActionHandler(ADMISSION_CATALOG_ID, 'submit', async (action) => {
      handlerCalls.push(action.context);
      return [];
    });
    const generation = await adapter.prepareGeneration({
      message: '建立 surface',
      catalogId: ADMISSION_CATALOG_ID,
    });
    assert.ok(generation.ok);
    for await (const _ of generation.run.source) void _;
    await generation.run.commit(GENERATION_STREAM);

    const ok = await adapter.prepareAction(
      actionWith({
        surfaceRevision: 1,
        catalogHash,
        inputs: [{ componentId: 'note', property: 'value', value: '浏览器编辑' }],
      }),
    );
    assert.ok(ok.ok, ok.ok ? '' : ok.message);
    assert.deepEqual(
      seen[0]?.params,
      { counter: 0.2, note: '浏览器编辑' },
      'resolver 收到共享准入重算的参数',
    );
    for await (const message of ok.run.source) void message;
    assert.deepEqual(handlerCalls[0], { counter: 0.2, note: '浏览器编辑' });
    ok.run.dispose?.();

    // resolver 输出未声明键：即使输入已准入，也必须拒绝且 handler 未调用
    const store2 = new InMemorySurfaceActionStateStore();
    const handlerCalls2: unknown[] = [];
    const adapter2 = new AgentAdapter({
      registry,
      actionStateStore: store2,
      editablePaths: () => ['/note'],
      createSurfaceId: () => SURFACE,
      createGenerationSource: () =>
        GENERATION_STREAM[Symbol.iterator]() as unknown as AgentMessageSource,
      resolveActionContext: () => ({ counter: 1, injected: 'business fact' }),
    });
    adapter2.registerActionHandler(ADMISSION_CATALOG_ID, 'submit', async (action) => {
      handlerCalls2.push(action.context);
      return [];
    });
    const generation2 = await adapter2.prepareGeneration({
      message: '建立 surface',
      catalogId: ADMISSION_CATALOG_ID,
    });
    assert.ok(generation2.ok);
    for await (const _ of generation2.run.source) void _;
    await generation2.run.commit(GENERATION_STREAM);

    const rejected = await adapter2.prepareAction(actionWith({ surfaceRevision: 1, catalogHash }));
    assert.equal(rejected.ok, false);
    assert.ok(!rejected.ok && rejected.code === 'param-invalid');
    assert.match(rejected.message, /injected/);
    assert.equal(handlerCalls2.length, 0, 'resolver 不得把额外字段带成可执行 action');
  });
});

describe('S2.4 评审 P1 反例（组合提交 / 隔离 / 固定契约 / 单调版本 / 基准核对 / 无旁路）', () => {
  it('P1-1：未回显输入的 handler patch 也落库已准入输入（一次组合提交）', async () => {
    const { adapter, store, handlerCalls } = await createHarness({
      editablePaths: () => ['/note'],
    });
    const plan = await adapter.prepareAction(
      actionWith({
        surfaceRevision: 1,
        catalogHash,
        inputs: [{ componentId: 'note', property: 'value', value: '浏览器编辑' }],
      }),
    );
    assert.ok(plan.ok, plan.ok ? '' : plan.message);
    // 消费真实 handler partial patch；不另造不同作用域的待提交消息。
    const messages: unknown[] = [];
    for await (const message of plan.run.source) messages.push(message);
    await plan.run.commit(messages);
    const after = await snapshotOf(store);
    assert.deepEqual(after.dataModel, { counter: 0.2, note: '浏览器编辑' });
    assert.ok(handlerCalls.length === 1);
  });

  it('P1-2：resolver 修改快照嵌套引用后返回非法参数，权威状态不受污染', async () => {
    const store = new InMemorySurfaceActionStateStore();
    const adapter = new AgentAdapter({
      registry,
      actionStateStore: store,
      editablePaths: () => ['/note'],
      createSurfaceId: () => SURFACE,
      createGenerationSource: () =>
        GENERATION_STREAM[Symbol.iterator]() as unknown as AgentMessageSource,
      resolveActionContext: (resolution) => {
        // 恶意/有缺陷 resolver：改动快照嵌套引用后返回未声明参数
        (resolution.tempDataModel as Record<string, unknown>).injected = true;
        (resolution.surfaceAction.snapshot.dataModel as Record<string, unknown>).mutated = true;
        (resolution.surfaceAction.snapshot.contract as { catalogHash: string }).catalogHash =
          'sha256:tampered';
        return { injected: 'no' } as Record<string, unknown>;
      },
    });
    adapter.registerActionHandler(ADMISSION_CATALOG_ID, 'submit', async () => []);
    const generation = await adapter.prepareGeneration({
      message: '建立 surface',
      catalogId: ADMISSION_CATALOG_ID,
    });
    assert.ok(generation.ok);
    for await (const _ of generation.run.source) void _;
    await generation.run.commit(GENERATION_STREAM);
    const before = await snapshotOf(store);

    const plan = await adapter.prepareAction(actionWith({ surfaceRevision: 1, catalogHash }));
    assert.equal(plan.ok, false);
    assert.ok(!plan.ok && plan.code === 'param-invalid');

    const after = await snapshotOf(store);
    assert.deepEqual(after, before);
  });

  it('P1-4：重新生成不重置 revision（跨代单调），旧 revision 请求被拒；版本上溢显式失败', async () => {
    const store = new InMemorySurfaceActionStateStore();
    await store.commitGeneration(SURFACE, ADMISSION_CATALOG_ID, GENERATION_STREAM, {
      catalogHash,
      contractVersion: 2,
      catalog: admissionCatalog,
    });
    await store.commitAction(
      [{ version: 'v0.9', updateDataModel: { surfaceId: SURFACE, value: { counter: 1 } } }],
      { expectedEpoch: 1, expectedRevision: 1 },
    );
    assert.equal((await snapshotOf(store)).version, 2);

    // 重新生成：revision 继续单调（不回到 1），旧视图的 revision 1 失效
    await store.commitGeneration(SURFACE, ADMISSION_CATALOG_ID, GENERATION_STREAM, {
      catalogHash,
      contractVersion: 2,
      catalog: admissionCatalog,
    });
    const regenerated = await snapshotOf(store);
    assert.equal(regenerated.version, 3);
    assert.equal(regenerated.epoch, 3);

    // 旧视图（revision 1）的请求被拒
    const staleAdapter = new AgentAdapter({
      registry,
      actionStateStore: store,
      editablePaths: () => ['/note'],
      createSurfaceId: () => SURFACE,
    });
    staleAdapter.registerActionHandler(ADMISSION_CATALOG_ID, 'submit', async () => []);
    const stale = await staleAdapter.prepareAction(
      actionWith({ surfaceRevision: 1, catalogHash, inputs: [] }),
    );
    assert.equal(stale.ok, false);
    assert.ok(!stale.ok && stale.code === 'revision-mismatch');

    // 版本上溢：显式失败，不重置为可碰撞的基准
    const overflowStore = new InMemorySurfaceActionStateStore();
    (
      overflowStore as unknown as {
        revision: number;
      }
    ).revision = Number.MAX_SAFE_INTEGER;
    await assert.rejects(
      () =>
        overflowStore.commitGeneration(SURFACE, ADMISSION_CATALOG_ID, GENERATION_STREAM, {
          catalogHash,
          contractVersion: 2,
          catalog: admissionCatalog,
        }),
      /安全整数上限/,
    );
  });

  it('P1-5：action 准入后发生新生成，其提交按代核对拒绝，过期 patch 不落库', async () => {
    const { adapter, store, handlerCalls } = await createHarness({
      editablePaths: () => ['/note'],
    });
    const plan = await adapter.prepareAction(actionWith({ surfaceRevision: 1, catalogHash }));
    assert.ok(plan.ok, plan.ok ? '' : plan.message);

    for await (const message of plan.run.source) void message;
    // 旧 action handler 已执行，新 generation 提交（替换快照、推进代与版本）
    await store.commitGeneration(SURFACE, ADMISSION_CATALOG_ID, GENERATION_STREAM, {
      catalogHash,
      contractVersion: 2,
      catalog: admissionCatalog,
    });
    const replaced = await snapshotOf(store);
    assert.equal(replaced.epoch, 2);

    await assert.rejects(
      async () =>
        plan.run.commit([
          { version: 'v0.9', updateDataModel: { surfaceId: SURFACE, value: { counter: 9 } } },
        ]),
      /提交基准已变化/,
    );
    // 过期 patch（含已准入输入）不得落库；快照保持新代内容
    const after = await snapshotOf(store);
    assert.deepEqual(after.dataModel, { counter: 0.2, note: '' });
    assert.equal(after.version, replaced.version);
    assert.equal(
      handlerCalls.length,
      1,
      'handler 已执行属既有契约：副作用归宿主幂等，SDK 不重放不回滚',
    );
  });

  it('P1-6：准入使用提交边界固定的声明副本，registry 原地变更不改变结论', async () => {
    const liveCatalog: CatalogDefinition = {
      catalogId: 'https://example.com/catalogs/adapter-admission/v1',
      components: standardCatalogComponentDeclarations(),
      actions: [
        {
          name: 'submit',
          sources: ['Button'],
          paramSchema: {
            type: 'object',
            additionalProperties: false,
            properties: { counter: { type: 'number' }, note: { type: 'string' } },
          },
        },
      ],
    };
    const liveCatalogHash = createCatalogContractHash(liveCatalog);
    const liveRegistry = new CatalogRegistry([liveCatalog]);
    const store = new InMemorySurfaceActionStateStore();
    const liveAdapter = new AgentAdapter({
      registry: liveRegistry,
      actionStateStore: store,
      editablePaths: () => ['/note'],
      createSurfaceId: () => SURFACE,
      createGenerationSource: () =>
        GENERATION_STREAM[Symbol.iterator]() as unknown as AgentMessageSource,
    });
    liveAdapter.registerActionHandler(liveCatalog.catalogId, 'submit', async () => []);
    const generation = await liveAdapter.prepareGeneration({
      message: '建立 surface',
      catalogId: liveCatalog.catalogId,
    });
    assert.ok(generation.ok);
    for await (const _ of generation.run.source) void _;
    await generation.run.commit(GENERATION_STREAM);

    // 提交后原地修改当前 registry 中的声明（撤回 submit 来源能力）
    (liveCatalog.actions[0].sources as string[]).length = 0;

    // 提交时固定的 hash/声明副本不受影响：同一请求结论不变
    const plan = await liveAdapter.prepareAction(
      actionWith({ surfaceRevision: 1, catalogHash: liveCatalogHash }),
    );
    assert.ok(plan.ok, plan.ok ? '' : plan.message);
  });

  it('P1-7：缺失 nexus 元数据的 prepareAction 一律拒绝（无兼容旁路）', async () => {
    const { adapter, handlerCalls } = await createHarness({
      editablePaths: () => ['/note'],
    });
    const plan = await adapter.prepareAction({
      name: 'submit',
      surfaceId: SURFACE,
      sourceComponentId: 'button',
      timestamp: '2026-10-18T00:00:00.000Z',
      actionId: 'bypass-attempt',
      context: {},
    } as unknown as AgentAction);
    assert.equal(plan.ok, false);
    assert.ok(!plan.ok && plan.code === 'nexus-invalid');
    assert.equal(handlerCalls.length, 0);
  });
});
