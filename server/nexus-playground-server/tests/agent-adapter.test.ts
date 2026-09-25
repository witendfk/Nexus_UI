import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import type Koa from 'koa';
import { CatalogRegistry } from '@nexus-ui/core';
import { AgentAdapter } from '../src/agent/adapter';
import type {
  AgentActionContext,
  AgentGenerationSourceRequest,
  AgentRun,
} from '../src/agent/adapter';
import type { AgentMessageSource } from '../src/agent/adapter';
import {
  BASIC_CATALOG,
  LEGACY_BASIC_TASK_CATALOG,
  OFFICIAL_BASIC_CATALOG,
  TASK_CATALOG,
  WORKBENCH_CATALOG,
} from '../src/agent/catalog';
import { InMemorySurfaceHistoryStore } from '../src/agent/history';
import type { LlmAgentRequest } from '../src/agent/llm-agent';
import { WorkbenchTaskStore } from '../src/agent/workbench-agent';
import { sendAgentRun } from '../src/api/send-messages';

async function collect(source: AgentMessageSource): Promise<unknown[]> {
  const messages: unknown[] = [];
  for await (const message of source) messages.push(message);
  return messages;
}

function createAction(name: string, surfaceId: string) {
  return {
    name,
    surfaceId,
    sourceComponentId: 'button',
    timestamp: new Date().toISOString(),
    context: {},
  };
}

function createSseContext(): { ctx: Koa.Context; getOutput: () => string } {
  let output = '';
  let body: unknown;
  const ctx = {
    status: 200,
    set: () => undefined,
    res: { flushHeaders: () => undefined },
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
    res: { flushHeaders: () => undefined },
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

function createActionRun(commit: AgentRun['commit']): AgentRun {
  return {
    source: [
      {
        version: 'v0.9',
        updateDataModel: { surfaceId: 'surface-commit', value: { ok: true } },
      },
    ],
    sequence: {
      kind: 'action',
      surfaceId: 'surface-commit',
      supportedActions: ['refresh'],
    },
    commit,
  };
}

describe('AgentAdapter', () => {
  it('宿主可注入生成源，action handler 可读取成功生成上下文', async () => {
    const generationRequests: AgentGenerationSourceRequest[] = [];
    const actionContexts: AgentActionContext[] = [];
    const surfaceId = 'surface-host-generation';
    const adapter = new AgentAdapter({
      actionHandlers: new Map(),
      createSurfaceId: () => surfaceId,
      createGenerationSource: (request) => {
        generationRequests.push(request);
        return [
          {
            version: 'v0.9',
            createSurface: { surfaceId: request.surfaceId, catalogId: BASIC_CATALOG },
          },
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId: request.surfaceId,
              components: [
                { id: 'root', component: 'Text', text: 'Host agent surface', variant: 'body' },
              ],
            },
          },
        ];
      },
    });
    adapter.registerActionHandler(BASIC_CATALOG, 'context-check', (action, context) => {
      actionContexts.push(context);
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

    const generation = await adapter.prepareGeneration({ message: '创建宿主任务面' });
    assert.ok(generation.ok);
    const generationTransport = createSseContext();
    const generationResult = await sendAgentRun(
      generationTransport.ctx,
      generation.run,
      'host-source',
    );
    assert.equal(generationResult.ok, true);

    const action = await adapter.prepareAction(createAction('context-check', surfaceId));
    assert.ok(action.ok);
    await collect(action.run.source);

    assert.equal(generationRequests.length, 1);
    assert.equal(generationRequests[0]?.catalogId, BASIC_CATALOG);
    assert.ok(generationRequests[0]?.supportedComponents.includes('Text'));
    assert.deepEqual(generationRequests[0]?.history, []);
    assert.equal(actionContexts.length, 1);
    assert.equal(actionContexts[0]?.catalogId, BASIC_CATALOG);
    assert.ok(actionContexts[0]?.catalog.components.includes('Text'));
    assert.equal(actionContexts[0]?.history[0]?.content, '创建宿主任务面');
    assert.match(actionContexts[0]?.history[1]?.content ?? '', /Host agent surface/);
  });

  it('自定义生成源的非法输出仍被 SSE guard 拒绝且不提交 history', async () => {
    let committed = false;
    const adapter = new AgentAdapter({
      createSurfaceId: () => 'surface-host-invalid',
      createGenerationSource: (request) => [
        {
          version: 'v0.9',
          createSurface: { surfaceId: request.surfaceId, catalogId: 'unregistered-catalog' },
        },
      ],
    });
    const plan = await adapter.prepareGeneration({ message: '非法输出' });
    assert.ok(plan.ok);
    plan.run.commit = () => {
      committed = true;
    };

    const transport = createSseContext();
    const result = await sendAgentRun(transport.ctx, plan.run, 'host-invalid');
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
          components: ['TaskSummary'],
          componentSchemas: {
            TaskSummary: {
              type: 'object',
              properties: { amount: { type: 'number', dynamic: 'allowed' } },
            },
          },
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
    const result = await sendAgentRun(transport.ctx, plan.run, 'diagnostics');
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
      createActionRun(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        commitFinished = true;
      }),
      'commit-success',
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
      createActionRun(async () => {
        throw new Error('history store unavailable');
      }),
      'commit-failure',
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
      actionHandlers: new Map(),
      historyStore,
      createSurfaceId: () => surfaceId,
      createGenerationSource: () => [
        {
          version: 'v0.9',
          createSurface: { surfaceId, catalogId: BASIC_CATALOG },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId,
            components: [
              { id: 'root', component: 'Text', text: 'Injected history', variant: 'body' },
            ],
          },
        },
      ],
    });
    adapter.registerActionHandler(BASIC_CATALOG, 'submit', (_action, context) => {
      actionContexts.push(context);
      return [
        {
          version: 'v0.9',
          updateDataModel: { surfaceId, value: { submitted: true } },
        },
      ];
    });

    const generation = await adapter.prepareGeneration({ message: '注入 history store' });
    assert.ok(generation.ok);
    const messages = await collect(generation.run.source);
    await generation.run.commit(messages);

    assert.equal(await historyStore.getCatalogId(surfaceId), BASIC_CATALOG);
    assert.equal((await historyStore.getHistory(surfaceId)).length, 2);

    const action = await adapter.prepareAction(createAction('submit', surfaceId));
    assert.ok(action.ok);
    await collect(action.run.source);

    assert.equal(actionContexts.length, 1);
    assert.equal(actionContexts[0]?.history.length, 2);
    assert.equal(actionContexts[0]?.history[0]?.content, '注入 history store');
  });

  it('按 catalog 选择 fallback 生成源并生成 surfaceId', async () => {
    const adapter = new AgentAdapter({
      createSurfaceId: () => 'surface-task-adapter',
    });
    const plan = await adapter.prepareGeneration({ catalogId: TASK_CATALOG });

    assert.ok(plan.ok);
    assert.equal(plan.run.sequence.surfaceId, 'surface-task-adapter');
    assert.equal(plan.run.sequence.catalogId, TASK_CATALOG);
  });

  it('LLM 生成源接收 catalog 组件边界', async () => {
    const requests: LlmAgentRequest[] = [];
    const adapter = new AgentAdapter({
      useLlm: () => true,
      createSurfaceId: () => 'surface-llm-adapter',
      streamLlm: async function* (request) {
        requests.push(request);
        yield {
          version: 'v0.9',
          createSurface: {
            surfaceId: request.surfaceId,
            catalogId: TASK_CATALOG,
          },
        };
      },
    });
    const plan = await adapter.prepareGeneration({ catalogId: TASK_CATALOG });
    assert.ok(plan.ok);
    await collect(plan.run.source);

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.catalogId, TASK_CATALOG);
    assert.deepEqual(requests[0]?.supportedComponents, ['TaskSummary', 'TaskButton']);
    assert.deepEqual(requests[0]?.supportedActions, ['start', 'complete']);
  });

  it('action 按 surface 记录的 catalog 分发 handler', async () => {
    const adapter = new AgentAdapter({
      createSurfaceId: () => 'surface-action-adapter',
    });
    const generation = await adapter.prepareGeneration({ catalogId: TASK_CATALOG });
    assert.ok(generation.ok);
    const messages = await collect(generation.run.source);
    await generation.run.commit(messages);

    const start = await adapter.prepareAction(
      createAction('start', generation.run.sequence.surfaceId),
    );
    assert.ok(start.ok);
    assert.equal(start.run.sequence.catalogId, TASK_CATALOG);
    const startResponse = await collect(start.run.source);
    assert.match(JSON.stringify(startResponse), /进行中/);
    assert.match(JSON.stringify(startResponse), /"name":"complete"/);

    const complete = await adapter.prepareAction(
      createAction('complete', generation.run.sequence.surfaceId),
    );
    assert.ok(complete.ok);
    const completeResponse = await collect(complete.run.source);
    assert.match(JSON.stringify(completeResponse), /已完成/);
    assert.match(JSON.stringify(completeResponse), /"disabled":true/);

    const duplicate = await adapter.prepareAction(
      createAction('complete', generation.run.sequence.surfaceId),
    );
    assert.ok(!duplicate.ok);
    assert.match(duplicate.message, /任务不能从 completed 状态完成/);
  });

  it('Workbench 生成后 submit action 创建任务并原地关闭提交入口', async () => {
    const workbenchStore = new WorkbenchTaskStore();
    const adapter = new AgentAdapter({
      createSurfaceId: () => 'surface-workbench',
      workbenchTaskStore: workbenchStore,
    });
    const generation = await adapter.prepareGeneration({ catalogId: WORKBENCH_CATALOG });
    assert.ok(generation.ok);
    const messages = await collect(generation.run.source);
    await generation.run.commit(messages);

    assert.match(
      JSON.stringify(messages),
      /"catalogId":"https:\/\/example\.com\/catalogs\/nexus-workbench\/v1"/,
    );
    assert.match(JSON.stringify(messages), /"component":"CustomerSummary"/);
    assert.match(JSON.stringify(messages), /"component":"ChoicePicker"/);
    assert.match(JSON.stringify(messages), /"component":"DateTimeInput"/);

    const empty = await adapter.prepareAction({
      name: 'submit',
      surfaceId: 'surface-workbench',
      sourceComponentId: 'submitButton',
      timestamp: new Date().toISOString(),
      context: { taskTitle: '', reminderAt: '', customerId: 'customer-1024' },
    });
    assert.ok(!empty.ok);
    assert.equal(empty.message, '请输入跟进任务标题');

    for (const priority of [[], ['urgent'], ['high', 'low']]) {
      const invalid = await adapter.prepareAction({
        name: 'submit',
        surfaceId: 'surface-workbench',
        sourceComponentId: 'submitButton',
        timestamp: new Date().toISOString(),
        context: {
          taskTitle: '发送方案修订版',
          priority,
          reminderAt: '2026-09-20T10:00:00',
          customerId: 'customer-1024',
          customerName: '华云科技',
        },
      });
      assert.ok(!invalid.ok);
      assert.equal(invalid.message, '请选择有效的任务优先级');
    }

    for (const [reminderAt, message] of [
      ['', '请选择提醒时间'],
      ['not-a-date', '请输入有效的提醒时间'],
    ] as const) {
      const invalid = await adapter.prepareAction({
        name: 'submit',
        surfaceId: 'surface-workbench',
        sourceComponentId: 'submitButton',
        timestamp: new Date().toISOString(),
        context: {
          taskTitle: '发送方案修订版',
          priority: ['high'],
          reminderAt,
          customerId: 'customer-1024',
          customerName: '华云科技',
        },
      });
      assert.ok(!invalid.ok);
      assert.equal(invalid.message, message);
    }

    const plan = await adapter.prepareAction({
      name: 'submit',
      surfaceId: 'surface-workbench',
      sourceComponentId: 'submitButton',
      timestamp: new Date().toISOString(),
      context: {
        taskTitle: '发送方案修订版',
        priority: ['high'],
        reminderAt: '2026-09-20T10:00',
        customerId: 'customer-1024',
        customerName: '华云科技',
      },
    });
    assert.ok(plan.ok);
    assert.equal(plan.run.sequence.catalogId, WORKBENCH_CATALOG);
    const response = await collect(plan.run.source);
    const serialized = JSON.stringify(response);

    assert.match(serialized, /followup-0001/);
    assert.match(serialized, /发送方案修订版/);
    assert.match(serialized, /优先级：高/);
    assert.match(serialized, /提醒时间：2026-09-20T10:00:00/);
    assert.match(serialized, /"disabled":true/);
    assert.match(serialized, /"surfaceId":"surface-workbench"/);

    const duplicate = await adapter.prepareAction({
      name: 'submit',
      surfaceId: 'surface-workbench',
      sourceComponentId: 'submitButton',
      timestamp: new Date().toISOString(),
      context: {
        taskTitle: '再次提交',
        priority: ['low'],
        reminderAt: '2026-09-21T10:00:00',
        customerId: 'customer-1024',
      },
    });
    assert.ok(!duplicate.ok);
    assert.equal(duplicate.message, '该客户的跟进任务已创建，不能重复提交');
  });

  it('支持异步业务 action handler 并拒绝未注册 action', async () => {
    const adapter = new AgentAdapter({ useLlm: () => false });
    adapter.registerActionHandler(BASIC_CATALOG, 'custom-submit', async (action) => [
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: action.surfaceId,
          value: { submitted: true },
        },
      },
    ]);

    const action = await adapter.prepareAction(createAction('custom-submit', 'surface-custom'));
    assert.ok(action.ok);
    const response = await collect(action.run.source);
    assert.deepEqual(response, [
      {
        version: 'v0.9',
        updateDataModel: { surfaceId: 'surface-custom', value: { submitted: true } },
      },
    ]);

    const unknown = await adapter.prepareAction(createAction('missing', 'surface-custom'));
    assert.ok(!unknown.ok);
    assert.match(unknown.message, /Action handler 未注册/);
  });

  it('Basic search action 返回包含用户输入值的原地更新', async () => {
    const adapter = new AgentAdapter({ useLlm: () => false });
    const action = await adapter.prepareAction({
      ...createAction('search', 'surface-search'),
      context: { keyword: 'A2UI Runtime' },
    });

    assert.ok(action.ok);
    const response = await collect(action.run.source);
    assert.deepEqual(response, [
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'surface-search',
          components: [
            {
              id: 'searchResult',
              component: 'Text',
              text: '搜索：A2UI Runtime',
              variant: 'body',
            },
          ],
        },
      },
    ]);
  });

  it('Basic submit action 返回文本与布尔输入的原地更新', async () => {
    const adapter = new AgentAdapter({ useLlm: () => false });
    const action = await adapter.prepareAction({
      ...createAction('submit', 'surface-form'),
      context: { name: 'A2UI Runtime', subscribed: true },
    });

    assert.ok(action.ok);
    const response = await collect(action.run.source);
    assert.deepEqual(response, [
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'surface-form',
          components: [
            {
              id: 'submitResult',
              component: 'Text',
              text: '已提交：name=A2UI Runtime，subscribed=true',
              variant: 'body',
            },
          ],
        },
      },
    ]);
  });

  it('normalizes the legacy Basic Task catalog ID to the canonical Nexus profile', async () => {
    const generationRequests: AgentGenerationSourceRequest[] = [];
    const surfaceId = 'surface-legacy-basic';
    const adapter = new AgentAdapter({
      actionHandlers: new Map(),
      createSurfaceId: () => surfaceId,
      createGenerationSource: (request) => {
        generationRequests.push(request);
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

    const plan = await adapter.prepareGeneration({ catalogId: LEGACY_BASIC_TASK_CATALOG });
    assert.ok(plan.ok);
    assert.equal(plan.run.sequence.catalogId, BASIC_CATALOG);
    assert.equal(generationRequests[0]?.catalogId, BASIC_CATALOG);

    const source = await collect(plan.run.source);
    assert.equal(
      findCreateCatalogId(source),
      BASIC_CATALOG,
      'new generations must carry the canonical Nexus profile ID',
    );
  });

  it('keeps the official Basic Catalog identity unregistered', async () => {
    const adapter = new AgentAdapter({ useLlm: () => false });
    const plan = await adapter.prepareGeneration({ catalogId: OFFICIAL_BASIC_CATALOG });

    assert.ok(!plan.ok);
    assert.match(plan.message, /Nexus 不注册官方 Basic Catalog/);
  });

  it('dispatches actions stored under the legacy Basic Task catalog ID', async () => {
    const historyStore = new InMemorySurfaceHistoryStore();
    await historyStore.commitGeneration('surface-legacy-action', LEGACY_BASIC_TASK_CATALOG, []);
    const adapter = new AgentAdapter({ historyStore, useLlm: () => false });

    const action = await adapter.prepareAction(createAction('search', 'surface-legacy-action'));
    assert.ok(action.ok);
    assert.equal(action.run.sequence.catalogId, BASIC_CATALOG);
    const response = await collect(action.run.source);
    assert.match(JSON.stringify(response), /搜索：/);
  });
});

function findCreateCatalogId(messages: unknown[]): string | undefined {
  for (const message of messages) {
    const candidate = message as {
      createSurface?: { catalogId?: string };
    };
    if (candidate.createSurface?.catalogId) return candidate.createSurface.catalogId;
  }
  return undefined;
}
