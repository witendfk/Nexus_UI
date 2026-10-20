import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import type Koa from 'koa';
import { CatalogRegistry } from '@nexus-ui/core';
import { AgentAdapter } from '../src/agent/adapter';
import type {
  AgentAction,
  AgentActionContext,
  AgentGenerationSourceRequest,
  AgentLlmStreamRequest,
  AgentMessageSource,
  AgentRun,
} from '../src/agent/adapter';
import { OFFICIAL_BASIC_CATALOG } from '../src/agent/catalog-identity';
import { CATALOG_CONTRACT_VERSION, createCatalogContractHash } from '../src/agent/catalog-contract';
import { InMemorySurfaceHistoryStore } from '../src/agent/history';
import { InMemoryAgentRunManager } from '../src/agent/run-manager';
import { InMemorySurfaceActionStateStore } from '../src/agent/surface-action-state';
import type { SurfaceActionStateStore } from '../src/agent/surface-action-state';
import { sendAgentRun } from '../src/api/send-messages';
import { TEST_CATALOG_ID, createTestRegistry } from './helpers/test-catalog';

const registry = createTestRegistry();

async function collect(source: AgentMessageSource): Promise<unknown[]> {
  const messages: unknown[] = [];
  for await (const message of source) messages.push(message);
  return messages;
}

const firstDelay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let actionSeq = 0;
const TEST_CATALOG_HASH = createCatalogContractHash(registry.get(TEST_CATALOG_ID)!);

/** 组装必填 nexus 元数据（S2.4：缺失即旧格式拒绝；测试 surface 均为 fresh revision 1）。 */
function createAction(name: string, surfaceId: string) {
  actionSeq += 1;
  return {
    name,
    surfaceId,
    sourceComponentId: 'button',
    timestamp: new Date().toISOString(),
    actionId: `action-${actionSeq}`,
    sessionVersion: 1,
    surfaceRevision: 1,
    catalogHash: TEST_CATALOG_HASH,
    context: {},
  };
}

function createSseContext(): { ctx: Koa.Context; getOutput: () => string } {
  let output = '';
  let body: unknown;
  const ctx = {
    status: 200,
    set: () => undefined,
    // res 必须是可写流：claimSseResponse 会 pipe 到它（ctx.respond = false）。
    res: new PassThrough(),
    get body() {
      return body;
    },
    set body(value: unknown) {
      body = value;
      if (value instanceof PassThrough) {
        value.on('data', (chunk: Buffer) => {
          output += chunk.toString('utf8');
        });
      }
    },
  } as unknown as Koa.Context;
  return { ctx, getOutput: () => output };
}

function createObservedSseContext(onData: (chunk: string) => void): Koa.Context {
  const ctx = {
    status: 200,
    set: () => undefined,
    // res 必须是可写流：claimSseResponse 会 pipe 到它（ctx.respond = false）。
    res: new PassThrough(),
  } as unknown as Koa.Context;
  Object.defineProperty(ctx, 'body', {
    set(value: unknown) {
      if (value instanceof PassThrough) {
        value.on('data', (chunk: Buffer) => onData(chunk.toString('utf8')));
      }
    },
  });
  return ctx;
}

function createActionRun(runId: string, commit: AgentRun['commit']): AgentRun {
  return {
    runId,
    source: [
      {
        version: 'v0.9',
        updateDataModel: { surfaceId: 'surface-commit', value: { ok: true } },
      },
    ],
    sequence: {
      kind: 'action',
      surfaceId: 'surface-commit',
      catalogId: TEST_CATALOG_ID,
      registry,
      supportedActions: ['submit'],
    },
    commit,
  };
}

/** S2.5.1：自定义 run 的 commit 必须返回固定提交结果，不能返回 void。 */
function commitFixture(runId: string) {
  return {
    sessionVersion: 1 as const,
    runId,
    surfaceId: 'surface-commit',
    catalogId: TEST_CATALOG_ID,
    contractVersion: CATALOG_CONTRACT_VERSION,
    catalogHash: TEST_CATALOG_HASH,
    surfaceRevision: 1,
  };
}

describe('AgentAdapter 显式装配', () => {
  it('缺 registry 时构造必须显式报错，不再回退示例 Catalog 注册表', () => {
    assert.throws(
      () => new AgentAdapter({} as ConstructorParameters<typeof AgentAdapter>[0]),
      /registry/i,
    );
  });

  it('generate 请求缺 catalogId 必须显式报错，不回落示例 Catalog', async () => {
    const adapter = new AgentAdapter({
      registry,
      useLlm: () => false,
      createGenerationSource: () => [
        {
          version: 'v0.9',
          createSurface: { surfaceId: 'surface-no-catalog', catalogId: TEST_CATALOG_ID },
        },
      ],
    });
    const plan = await adapter.prepareGeneration({ message: '缺 catalogId' });
    assert.ok(!plan.ok);
    assert.match(plan.message, /catalogId/);
  });

  it('useLlm=true 而 streamLlm 缺失必须在 prepare 时显式报错', async () => {
    const adapter = new AgentAdapter({ registry, useLlm: () => true });
    await assert.rejects(
      () => adapter.prepareGeneration({ message: '无 streamLlm', catalogId: TEST_CATALOG_ID }),
      /streamLlm/,
    );
  });

  it('未注入 historyStore 的 adapter 实例各自持有隔离 history', async () => {
    const surfaceId = 'surface-isolation';
    const seenHistories: unknown[] = [];
    const createSource = (): AgentMessageSource => [
      {
        version: 'v0.9',
        createSurface: { surfaceId, catalogId: TEST_CATALOG_ID },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId,
          components: [{ id: 'root', component: 'Text', text: 'isolated' }],
        },
      },
    ];
    const first = new AgentAdapter({
      registry,
      useLlm: () => false,
      createSurfaceId: () => surfaceId,
      createGenerationSource: (request) => {
        seenHistories.push(request.history);
        return createSource();
      },
    });
    const second = new AgentAdapter({
      registry,
      useLlm: () => false,
      createSurfaceId: () => surfaceId,
      createGenerationSource: (request) => {
        seenHistories.push(request.history);
        return createSource();
      },
    });

    const firstPlan = await first.prepareGeneration({
      message: '第一条',
      catalogId: TEST_CATALOG_ID,
    });
    assert.ok(firstPlan.ok);
    await firstPlan.run.commit(await collect(firstPlan.run.source));

    const secondPlan = await second.prepareGeneration({
      message: '第二条',
      catalogId: TEST_CATALOG_ID,
    });
    assert.ok(secondPlan.ok);
    await secondPlan.run.commit(await collect(secondPlan.run.source));

    assert.deepEqual(seenHistories[1], [], '两个 adapter 实例不得共享 history（模块级单例已删除）');
  });

  it('keeps deterministic fallback and example actions out of the generic adapter', async () => {
    const generic = new AgentAdapter({ registry, useLlm: () => false });
    const missingSource = await generic.prepareGeneration({
      message: '创建任务面',
      catalogId: TEST_CATALOG_ID,
    });
    assert.ok(!missingSource.ok);
    assert.match(missingSource.message, /Generation source 未配置/);

    const surfaceId = 'surface-no-reference-defaults';
    const adapter = new AgentAdapter({
      registry,
      actionHandlers: new Map(),
      useLlm: () => false,
      createSurfaceId: () => surfaceId,
      createGenerationSource: () => [
        {
          version: 'v0.9',
          createSurface: { surfaceId, catalogId: TEST_CATALOG_ID },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId,
            components: [
              {
                id: 'root',
                component: 'Column',
                children: ['callButton', 'callLabel'],
              },
              {
                id: 'callButton',
                component: 'Button',
                child: 'callLabel',
                action: { event: { name: 'call', context: {} } },
              },
              { id: 'callLabel', component: 'Text', text: 'Call' },
            ],
          },
        },
      ],
    });
    const generation = await adapter.prepareGeneration({
      message: '创建任务面',
      catalogId: TEST_CATALOG_ID,
    });
    assert.ok(generation.ok);
    const messages = await collect(generation.run.source);
    await generation.run.commit(messages);

    const action = await adapter.prepareAction({
      ...createAction('call', surfaceId),
      sourceComponentId: 'callButton',
    });
    assert.ok(!action.ok);
    assert.match(action.message, /Action handler 未注册/);
  });

  it('宿主可注入生成源，action handler 可读取成功生成上下文', async () => {
    const generationRequests: AgentGenerationSourceRequest[] = [];
    const actionContexts: Array<{ action: AgentAction; context: AgentActionContext }> = [];
    const surfaceId = 'surface-host-generation';
    const adapter = new AgentAdapter({
      registry,
      actionHandlers: new Map(),
      createSurfaceId: () => surfaceId,
      createGenerationSource: (request) => {
        generationRequests.push(request);
        return [
          {
            version: 'v0.9',
            createSurface: { surfaceId: request.surfaceId, catalogId: TEST_CATALOG_ID },
          },
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId: request.surfaceId,
              components: [
                {
                  id: 'root',
                  component: 'Column',
                  children: ['hostText', 'contextButton', 'contextLabel'],
                },
                { id: 'hostText', component: 'Text', text: 'Host agent surface', variant: 'body' },
                {
                  id: 'contextButton',
                  component: 'Button',
                  child: 'contextLabel',
                  action: { event: { name: 'call', context: {} } },
                },
                { id: 'contextLabel', component: 'Text', text: 'Run' },
              ],
            },
          },
        ];
      },
    });
    adapter.registerActionHandler(TEST_CATALOG_ID, 'call', (action, context) => {
      actionContexts.push({ action, context });
      return [
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: action.surfaceId,
            components: [
              { id: 'root', component: 'Text', text: 'Context checked', variant: 'body' },
            ],
          },
        },
      ];
    });

    const generation = await adapter.prepareGeneration({
      message: '创建宿主任务面',
      catalogId: TEST_CATALOG_ID,
    });
    assert.ok(generation.ok);
    const generationTransport = createSseContext();
    const generationResult = await sendAgentRun(
      generationTransport.ctx,
      generation.run,
      'host-source',
      {},
    );
    assert.equal(generationResult.ok, true, generationTransport.getOutput());

    const action = await adapter.prepareAction({
      ...createAction('call', surfaceId),
      sourceComponentId: 'contextButton',
    });
    assert.ok(action.ok);
    await collect(action.run.source);

    assert.equal(generationRequests.length, 1);
    assert.equal(generationRequests[0]?.catalogId, TEST_CATALOG_ID);
    assert.ok(generationRequests[0]?.supportedComponents.includes('Text'));
    assert.deepEqual(generationRequests[0]?.history, []);
    assert.equal(actionContexts.length, 1);
    assert.deepEqual(actionContexts[0]?.action.context, {});
    assert.deepEqual(actionContexts[0]?.context.clientContext, {});
    assert.equal(actionContexts[0]?.context.catalogId, TEST_CATALOG_ID);
    assert.ok(actionContexts[0]?.context.catalog.components['Text'] !== undefined);
    assert.equal(actionContexts[0]?.context.history[0]?.content, '创建宿主任务面');
    assert.match(actionContexts[0]?.context.history[1]?.content ?? '', /Host agent surface/);
  });

  it('自定义生成源的非法输出仍被 SSE guard 拒绝且不提交 history', async () => {
    let committed = false;
    const adapter = new AgentAdapter({
      registry,
      createSurfaceId: () => 'surface-host-invalid',
      createGenerationSource: (request) => [
        {
          version: 'v0.9',
          createSurface: { surfaceId: request.surfaceId, catalogId: 'unregistered-catalog' },
        },
      ],
    });
    const plan = await adapter.prepareGeneration({
      message: '非法输出',
      catalogId: TEST_CATALOG_ID,
    });
    assert.ok(plan.ok);
    plan.run.commit = () => {
      committed = true;
      return commitFixture(plan.run.runId);
    };

    const transport = createSseContext();
    const result = await sendAgentRun(transport.ctx, plan.run, 'host-invalid', {});
    const output = transport.getOutput();

    assert.equal(result.ok, false);
    assert.equal(committed, false);
    assert.match(output, /event: error/);
    assert.doesNotMatch(output, /event: done/);
  });

  it('Catalog 诊断会随 SSE error 契约透出', async () => {
    const customCatalogId = 'https://example.com/catalogs/task/v3';
    const adapter = new AgentAdapter({
      registry: new CatalogRegistry([
        {
          catalogId: customCatalogId,
          components: {
            TaskSummary: {
              schema: {
                type: 'object',
                properties: { amount: { type: 'number', dynamic: 'allowed' } },
              },
            },
          },
          actions: [],
        },
      ]),
      createSurfaceId: () => 'surface-diagnostics',
      createGenerationSource: (request) => [
        {
          version: 'v0.9',
          createSurface: { surfaceId: request.surfaceId, catalogId: customCatalogId },
        },
        {
          version: 'v0.9',
          updateDataModel: {
            surfaceId: request.surfaceId,
            value: { amount: '12' },
          },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: request.surfaceId,
            components: [{ id: 'root', component: 'TaskSummary', amount: { path: '/amount' } }],
          },
        },
      ],
    });
    const plan = await adapter.prepareGeneration({ catalogId: customCatalogId });
    assert.ok(plan.ok);
    const transport = createSseContext();
    const result = await sendAgentRun(transport.ctx, plan.run, 'diagnostics', {});
    const output = transport.getOutput();

    assert.equal(result.ok, false);
    assert.match(output, /event: error/);
    assert.match(output, /"diagnostics":\[/);
    assert.match(output, /"path":"TaskSummary.amount"/);
    assert.match(output, /"dataPath":"\/amount"/);
    assert.doesNotMatch(output, /event: done/);
  });

  it('history 提交成功后才发送 done，提交失败只发送 error', async () => {
    let commitFinished = false;
    let doneBeforeCommit = false;
    const successEvents: string[] = [];
    const successTransport = createObservedSseContext((chunk) => {
      if (chunk.includes('event: done') && !commitFinished) doneBeforeCommit = true;
      if (/^event: /m.test(chunk)) successEvents.push(chunk);
    });

    const success = await sendAgentRun(
      successTransport,
      createActionRun('commit-success-run', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        commitFinished = true;
        return commitFixture('commit-success-run');
      }),
      'commit-success',
      { manager: new InMemoryAgentRunManager() },
    );

    assert.equal(success.ok, true);
    assert.equal(doneBeforeCommit, false);
    assert.ok(successEvents.at(-1)?.includes('event: done'));

    const failureEvents: string[] = [];
    const failureTransport = createObservedSseContext((chunk) => {
      if (/^event: /m.test(chunk)) failureEvents.push(chunk);
    });
    const failure = await sendAgentRun(
      failureTransport,
      createActionRun('commit-failure-run', async () => {
        throw new Error('history store unavailable');
      }),
      'commit-failure',
      { manager: new InMemoryAgentRunManager() },
    );

    assert.equal(failure.ok, false);
    assert.ok(failureEvents.some((event) => event.includes('event: error')));
    assert.ok(failureEvents.some((event) => event.includes('history store unavailable')));
    assert.ok(!failureEvents.some((event) => event.includes('event: done')));
  });

  it('宿主可注入独立 history store 并用于 action 上下文', async () => {
    const surfaceId = 'surface-custom-history';
    const historyStore = new InMemorySurfaceHistoryStore();
    const actionContexts: AgentActionContext[] = [];
    const adapter = new AgentAdapter({
      registry,
      actionHandlers: new Map(),
      historyStore,
      createSurfaceId: () => surfaceId,
      createGenerationSource: () => [
        {
          version: 'v0.9',
          createSurface: { surfaceId, catalogId: TEST_CATALOG_ID },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId,
            components: [
              {
                id: 'root',
                component: 'Column',
                children: ['historyText', 'submitButton', 'submitLabel'],
              },
              { id: 'historyText', component: 'Text', text: 'Injected history', variant: 'body' },
              {
                id: 'submitButton',
                component: 'Button',
                child: 'submitLabel',
                action: { event: { name: 'submit', context: {} } },
              },
              { id: 'submitLabel', component: 'Text', text: 'Submit' },
            ],
          },
        },
      ],
    });
    adapter.registerActionHandler(TEST_CATALOG_ID, 'submit', (_action, context) => {
      actionContexts.push(context);
      return [
        {
          version: 'v0.9',
          updateDataModel: { surfaceId, value: { submitted: true } },
        },
      ];
    });

    const generation = await adapter.prepareGeneration({
      message: '注入 history store',
      catalogId: TEST_CATALOG_ID,
    });
    assert.ok(generation.ok);
    const messages = await collect(generation.run.source);
    await generation.run.commit(messages);

    assert.equal(await historyStore.getCatalogId(surfaceId), TEST_CATALOG_ID);
    assert.equal((await historyStore.getHistory(surfaceId)).length, 2);

    const action = await adapter.prepareAction({
      ...createAction('submit', surfaceId),
      sourceComponentId: 'submitButton',
    });
    assert.ok(action.ok);
    await collect(action.run.source);

    assert.equal(actionContexts.length, 1);
    assert.equal(actionContexts[0]?.history.length, 2);
    assert.equal(actionContexts[0]?.history[0]?.content, '注入 history store');
  });

  it('LLM 生成源接收 catalog 组件边界', async () => {
    const requests: AgentLlmStreamRequest[] = [];
    const llmCatalogId = 'https://example.com/catalogs/llm-probe/v1';
    const adapter = new AgentAdapter({
      registry: new CatalogRegistry([
        {
          catalogId: llmCatalogId,
          components: {
            TaskSummary: { schema: { type: 'object' } },
            TaskButton: { schema: { type: 'object' }, action: { required: true } },
          },
          actions: [
            { name: 'start', sources: ['TaskButton'] },
            { name: 'complete', sources: ['TaskButton'] },
          ],
        },
      ]),
      useLlm: () => true,
      createSurfaceId: () => 'surface-llm-adapter',
      streamLlm: (request) => {
        requests.push(request);
        return [
          {
            version: 'v0.9',
            createSurface: {
              surfaceId: request.surfaceId,
              catalogId: request.catalogId,
            },
          },
        ];
      },
    });
    const plan = await adapter.prepareGeneration({ catalogId: llmCatalogId });
    assert.ok(plan.ok);
    await collect(plan.run.source);

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.catalogId, llmCatalogId);
    assert.deepEqual(requests[0]?.supportedComponents, ['TaskSummary', 'TaskButton']);
    assert.deepEqual(requests[0]?.supportedActions, ['start', 'complete']);
  });

  it('支持异步业务 action handler 并拒绝未注册 action', async () => {
    const surfaceId = 'surface-custom';
    const adapter = new AgentAdapter({
      registry,
      actionHandlers: new Map(),
      useLlm: () => false,
      createSurfaceId: () => surfaceId,
      createGenerationSource: () => [
        {
          version: 'v0.9',
          createSurface: { surfaceId, catalogId: TEST_CATALOG_ID },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId,
            components: [
              { id: 'root', component: 'Column', children: ['submitButton', 'submitLabel'] },
              {
                id: 'submitButton',
                component: 'Button',
                child: 'submitLabel',
                action: { event: { name: 'submit', context: {} } },
              },
              { id: 'submitLabel', component: 'Text', text: 'Submit' },
            ],
          },
        },
      ],
    });
    adapter.registerActionHandler(TEST_CATALOG_ID, 'submit', async (action) => [
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: action.surfaceId,
          value: { submitted: true },
        },
      },
    ]);

    const generation = await adapter.prepareGeneration({
      message: 'create action surface',
      catalogId: TEST_CATALOG_ID,
    });
    assert.ok(generation.ok);
    const generationMessages = await collect(generation.run.source);
    await generation.run.commit(generationMessages);

    const action = await adapter.prepareAction({
      ...createAction('submit', surfaceId),
      timestamp: '2026-09-21T00:00:01.000Z',
      sourceComponentId: 'submitButton',
    });
    assert.ok(action.ok, action.ok ? undefined : action.message);
    const response = await collect(action.run.source);
    assert.deepEqual(response, [
      {
        version: 'v0.9',
        updateDataModel: { surfaceId: 'surface-custom', value: { submitted: true } },
      },
    ]);

    action.run.dispose?.();
    const unknown = await adapter.prepareAction(createAction('missing', surfaceId));
    assert.ok(!unknown.ok);
    assert.match(unknown.message, /与服务端 surface 状态不匹配/);
  });

  it('keeps the official Basic Catalog identity unregistered', async () => {
    const adapter = new AgentAdapter({ registry, useLlm: () => false });
    const plan = await adapter.prepareGeneration({ catalogId: OFFICIAL_BASIC_CATALOG });

    assert.ok(!plan.ok);
    assert.match(plan.message, /Nexus 不注册官方 Basic Catalog/);
  });

  it('serializes concurrent handler execution for the same surface', async () => {
    const surfaceId = 'surface-serial-action';
    const executionOrder: string[] = [];
    const adapter = new AgentAdapter({
      registry,
      useLlm: () => false,
      createSurfaceId: () => surfaceId,
      createGenerationSource: () => [
        {
          version: 'v0.9',
          createSurface: { surfaceId, catalogId: TEST_CATALOG_ID },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId,
            components: [
              { id: 'root', component: 'Column', children: ['btn', 'label'] },
              {
                id: 'btn',
                component: 'Button',
                child: 'label',
                action: { event: { name: 'submit', context: {} } },
              },
              { id: 'label', component: 'Text', text: 'Submit' },
            ],
          },
        },
      ],
      actionHandlers: new Map([
        [
          `${TEST_CATALOG_ID}:submit`,
          async function* () {
            executionOrder.push('handler-start');
            await firstDelay(30);
            executionOrder.push('handler-end');
            yield {
              version: 'v0.9',
              updateDataModel: { surfaceId, value: { done: true } },
            } as unknown;
          },
        ],
      ]),
    });
    const generation = await adapter.prepareGeneration({
      message: 'setup',
      catalogId: TEST_CATALOG_ID,
    });
    assert.ok(generation.ok);
    const generationMessages = await collect(generation.run.source);
    await generation.run.commit(generationMessages);

    const firstPromise = adapter.prepareAction({
      ...createAction('submit', surfaceId),
      sourceComponentId: 'btn',
      timestamp: '2026-09-28T00:00:00.000Z',
    });
    const firstPlan = await firstPromise;
    assert.ok(firstPlan.ok);

    // Start the second while the first still holds the lock.
    const secondPromise = adapter.prepareAction({
      ...createAction('submit', surfaceId),
      sourceComponentId: 'btn',
      timestamp: '2026-09-28T00:00:01.000Z',
    });

    // Source exhaustion keeps the lock; only commit releases it.
    const firstMessages = await collect(firstPlan.run.source);
    await firstPlan.run.commit(firstMessages);
    assert.ok(executionOrder.includes('handler-start'));
    assert.ok(executionOrder.includes('handler-end'));

    // The second prepareAction should have waited for the first to complete.
    const secondPlan = await secondPromise;
    assert.ok(!secondPlan.ok, 'the queued request carries the stale first revision');
    assert.equal(
      executionOrder.filter((entry) => entry === 'handler-start').length,
      1,
      'stale queued actions must be rejected before executing their handler',
    );
  });

  it('rolls back the action snapshot when the generation commit hook fails', async () => {
    const surfaceId = 'surface-rollback-generation';
    const adapter = new AgentAdapter({
      registry,
      useLlm: () => false,
      createSurfaceId: () => surfaceId,
      createGenerationSource: () => [
        {
          version: 'v0.9',
          createSurface: { surfaceId, catalogId: TEST_CATALOG_ID },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId,
            components: [{ id: 'root', component: 'Column', children: [] }],
          },
        },
      ],
      onGenerationCommitted: () => {
        throw new Error('host success hook failed');
      },
    });
    const generation = await adapter.prepareGeneration({
      message: 'rollback test',
      catalogId: TEST_CATALOG_ID,
    });
    assert.ok(generation.ok);
    const messages = await collect(generation.run.source);
    await assert.rejects(
      () => Promise.resolve().then(() => generation.run.commit(messages)),
      /host success hook failed/,
    );

    const snapshot = await adapter.prepareAction({
      ...createAction('submit', surfaceId),
      sourceComponentId: 'root',
    });
    assert.ok(!snapshot.ok);
    assert.match(snapshot.message, /Action surface 不存在或已过期/);
  });

  it('marks the action ledger as failed when the stream fails before commit', async () => {
    const surfaceId = 'surface-ledger-fail';
    const adapter = new AgentAdapter({
      registry,
      useLlm: () => false,
      createSurfaceId: () => surfaceId,
      createGenerationSource: () => [
        {
          version: 'v0.9',
          createSurface: { surfaceId, catalogId: TEST_CATALOG_ID },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId,
            components: [
              { id: 'root', component: 'Column', children: ['btn', 'label'] },
              {
                id: 'btn',
                component: 'Button',
                child: 'label',
                action: { event: { name: 'submit', context: {} } },
              },
              { id: 'label', component: 'Text', text: 'Submit' },
            ],
          },
        },
      ],
      actionHandlers: new Map([
        [
          `${TEST_CATALOG_ID}:submit`,
          async function* () {
            yield {
              version: 'v0.9',
              updateDataModel: { surfaceId, value: { done: true } },
            } as unknown;
          },
        ],
      ]),
    });
    const generation = await adapter.prepareGeneration({
      message: 'ledger test',
      catalogId: TEST_CATALOG_ID,
    });
    assert.ok(generation.ok);
    const generationMessages = await collect(generation.run.source);
    await generation.run.commit(generationMessages);

    const action = await adapter.prepareAction({
      ...createAction('submit', surfaceId),
      sourceComponentId: 'btn',
      timestamp: '2026-09-28T00:00:00.000Z',
      actionId: 'test-action-id-1',
    });
    assert.ok(action.ok);

    await collect(action.run.source);
    // Simulate stream failure without calling commit.
    action.run.onError?.(new Error('stream failed'));

    const retry = await adapter.prepareAction({
      ...createAction('submit', surfaceId),
      sourceComponentId: 'btn',
      timestamp: '2026-09-28T00:00:00.000Z',
      actionId: 'test-action-id-1',
    });
    // The ledger entry was closed as failed, so the same actionId can be retried.
    assert.ok(retry.ok);
  });

  it('rejects action context fields not declared on the surface', async () => {
    const surfaceId = 'surface-undeclared-fields';
    const adapter = new AgentAdapter({
      registry,
      useLlm: () => false,
      createSurfaceId: () => surfaceId,
      createGenerationSource: () => [
        {
          version: 'v0.9',
          createSurface: { surfaceId, catalogId: TEST_CATALOG_ID },
        },
        {
          version: 'v0.9',
          updateDataModel: {
            surfaceId,
            value: { orderId: 'SO-001', adminOverride: true },
          },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId,
            components: [
              { id: 'root', component: 'Column', children: ['btn', 'label'] },
              {
                id: 'btn',
                component: 'Button',
                child: 'label',
                action: {
                  event: {
                    name: 'submit',
                    context: { orderId: { path: '/orderId' } },
                  },
                },
              },
              { id: 'label', component: 'Text', text: 'Submit' },
            ],
          },
        },
      ],
      actionHandlers: new Map([
        [
          `${TEST_CATALOG_ID}:submit`,
          async function* () {
            yield {
              version: 'v0.9',
              updateDataModel: { surfaceId, value: { done: true } },
            } as unknown;
          },
        ],
      ]),
    });
    const generation = await adapter.prepareGeneration({
      message: 'field test',
      catalogId: TEST_CATALOG_ID,
    });
    assert.ok(generation.ok);
    const generationMessages = await collect(generation.run.source);
    await generation.run.commit(generationMessages);

    const injected = await adapter.prepareAction({
      ...createAction('submit', surfaceId),
      sourceComponentId: 'btn',
      timestamp: '2026-09-28T00:00:00.000Z',
      context: { orderId: 'SO-001', adminOverride: true },
    });
    assert.ok(!injected.ok);
    assert.match(injected.message, /Action context 包含未声明的客户端字段: adminOverride/);
  });

  it('runs the next same-surface action only after the previous action commits', async () => {
    const surfaceId = 'surface-commit-visibility';
    const observed: number[] = [];
    let releaseCommit!: () => void;
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });

    // Gate the first commitAction so the test controls the exact moment the
    // first action's result becomes authoritative.
    const inner = new InMemorySurfaceActionStateStore();
    let gated = false;
    let commitEntered = false;
    const actionStore: SurfaceActionStateStore = {
      get: (id) => inner.get(id),
      commitGeneration: (id, catalogId, messages, contract) =>
        inner.commitGeneration(id, catalogId, messages, contract),
      removeSnapshot: (id) => inner.removeSnapshot(id),
      commitAction: async (messages, commit) => {
        if (!gated) {
          gated = true;
          commitEntered = true;
          await commitGate;
        }
        return inner.commitAction(messages, commit);
      },
    };

    const adapter = new AgentAdapter({
      registry,
      useLlm: () => false,
      createSurfaceId: () => surfaceId,
      actionStateStore: actionStore,
      createGenerationSource: () => [
        {
          version: 'v0.9',
          createSurface: { surfaceId, catalogId: TEST_CATALOG_ID },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId,
            components: [
              { id: 'root', component: 'Column', children: ['btn', 'label'] },
              {
                id: 'btn',
                component: 'Button',
                child: 'label',
                action: {
                  event: { name: 'submit', context: { counter: { path: '/counter' } } },
                },
              },
              { id: 'label', component: 'Text', text: 'Submit' },
            ],
          },
        },
        {
          version: 'v0.9',
          updateDataModel: { surfaceId, value: { counter: 1 } },
        },
      ],
      actionHandlers: new Map([
        [
          `${TEST_CATALOG_ID}:submit`,
          async function* (action: AgentAction) {
            const counter = Number((action.context as { counter?: number }).counter ?? -1);
            observed.push(counter);
            yield {
              version: 'v0.9',
              updateDataModel: { surfaceId, value: { counter: counter + 1 } },
            } as unknown;
          },
        ],
      ]),
    });
    const generation = await adapter.prepareGeneration({
      message: 'setup',
      catalogId: TEST_CATALOG_ID,
    });
    assert.ok(generation.ok);
    const generationMessages = await collect(generation.run.source);
    await generation.run.commit(generationMessages);

    const firstPlan = await adapter.prepareAction({
      ...createAction('submit', surfaceId),
      sourceComponentId: 'btn',
      timestamp: '2026-09-28T00:00:00.000Z',
    });
    assert.ok(firstPlan.ok, firstPlan.ok ? '' : firstPlan.message);

    // The handler body is lazy: it runs at the first pull inside the queue.
    const firstSent = sendAgentRun(createSseContext().ctx, firstPlan.run, 'commit-visibility-a', {
      streamDelayMs: 0,
    });
    await firstDelay(20);
    assert.ok(commitEntered, 'first commit is now gated inside sendAgentRun');

    // Fire the second action while the first commit is still in flight.
    // 准入发生在首笔提交之后：客户端观测的 revision 随之为 2（基准刷新语义）。
    const secondPlanPromise = adapter.prepareAction({
      ...createAction('submit', surfaceId),
      sourceComponentId: 'btn',
      timestamp: '2026-09-28T00:00:01.000Z',
      surfaceRevision: 2,
    });
    await firstDelay(5);
    assert.equal(
      observed.length,
      1,
      'the second handler must not run before the first commit settles',
    );

    releaseCommit();

    const firstResult = await firstSent;
    assert.ok(firstResult.ok, 'first action stream should finish with done');

    const secondPlan = await secondPlanPromise;
    assert.ok(secondPlan.ok);
    const secondMessages = await collect(secondPlan.run.source);
    await secondPlan.run.commit(secondMessages);

    assert.deepEqual(
      observed,
      [1, 2],
      'the second handler must read the snapshot committed by the first action',
    );
  });

  it('closes the action ledger and releases the surface lock when history reads fail', async () => {
    const surfaceId = 'surface-history-failure';

    class FlakyHistoryStore extends InMemorySurfaceHistoryStore {
      failing = false;
      override async getHistory(id: string) {
        if (this.failing) throw new Error('history store unavailable');
        return super.getHistory(id);
      }
    }

    const historyStore = new FlakyHistoryStore();
    const adapter = new AgentAdapter({
      registry,
      historyStore,
      useLlm: () => false,
      createSurfaceId: () => surfaceId,
      createGenerationSource: () => [
        {
          version: 'v0.9',
          createSurface: { surfaceId, catalogId: TEST_CATALOG_ID },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId,
            components: [
              { id: 'root', component: 'Column', children: ['btn', 'label'] },
              {
                id: 'btn',
                component: 'Button',
                child: 'label',
                action: { event: { name: 'submit', context: {} } },
              },
              { id: 'label', component: 'Text', text: 'Submit' },
            ],
          },
        },
      ],
      actionHandlers: new Map([
        [
          `${TEST_CATALOG_ID}:submit`,
          async function* () {
            yield {
              version: 'v0.9',
              updateDataModel: { surfaceId, value: { done: true } },
            } as unknown;
          },
        ],
      ]),
    });
    const generation = await adapter.prepareGeneration({
      message: 'setup',
      catalogId: TEST_CATALOG_ID,
    });
    assert.ok(generation.ok);
    await generation.run.commit(await collect(generation.run.source));

    historyStore.failing = true;
    const failedPlan = await adapter.prepareAction({
      ...createAction('submit', surfaceId),
      sourceComponentId: 'btn',
      timestamp: '2026-09-28T00:00:00.000Z',
    });
    assert.ok(!failedPlan.ok);
    assert.match(failedPlan.message, /Action 历史读取失败: history store unavailable/);

    historyStore.failing = false;
    // Same timestamp + context => same ledger key: the retry only passes when
    // the failed record was closed and the surface lock was released.
    const retryPlan = await adapter.prepareAction({
      ...createAction('submit', surfaceId),
      sourceComponentId: 'btn',
      timestamp: '2026-09-28T00:00:00.000Z',
    });
    assert.ok(retryPlan.ok, 'retry after a failed history read must be accepted');
    await collect(retryPlan.run.source);
  });
});
