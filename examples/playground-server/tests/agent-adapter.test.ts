import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import type Koa from 'koa';
import { AgentAdapter, InMemoryAgentRunManager, sendAgentRun, InMemorySurfaceHistoryStore } from '@nexus-ui/server';
import type { AgentLlmStreamRequest, AgentMessageSource } from '@nexus-ui/server';
import {
  BASIC_CATALOG,
  LEGACY_BASIC_TASK_CATALOG,
  NEXUS_BASIC_TASK_CATALOG,
  TASK_CATALOG,
  WORKBENCH_CATALOG,
} from '../src/agent/catalog';
import { WorkbenchTaskStore } from '../src/agent/workbench-agent';
import { createReferenceAgentAdapter } from '../src/reference/reference-agent';

async function collect(source: AgentMessageSource): Promise<unknown[]> {
  const messages: unknown[] = [];
  for await (const message of source) messages.push(message);
  return messages;
}

function createSseContext(): Koa.Context {
  return {
    status: 200,
    set: () => undefined,
    res: new PassThrough(),
  } as unknown as Koa.Context;
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

describe('playground reference adapter（参考装配，注册表与生成源显式注入）', () => {
  it('按 catalog 选择 fallback 生成源并生成 surfaceId', async () => {
    const adapter = createReferenceAgentAdapter({
      createSurfaceId: () => 'surface-task-adapter',
    });
    const plan = await adapter.prepareGeneration({ catalogId: TASK_CATALOG });

    assert.ok(plan.ok);
    assert.equal(plan.run.sequence.surfaceId, 'surface-task-adapter');
    assert.equal(plan.run.sequence.catalogId, TASK_CATALOG);
  });

  it('action 按 surface 记录的 catalog 分发 handler', async () => {
    const adapter = createReferenceAgentAdapter({
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
    await start.run.commit(startResponse);

    const complete = await adapter.prepareAction({
      ...createAction('complete', generation.run.sequence.surfaceId),
      timestamp: '2026-09-21T00:00:01.000Z',
    });
    assert.ok(complete.ok);
    const completeResponse = await collect(complete.run.source);
    assert.match(JSON.stringify(completeResponse), /已完成/);
    assert.match(JSON.stringify(completeResponse), /"disabled":true/);
    await complete.run.commit(completeResponse);

    const duplicate = await adapter.prepareAction({
      ...createAction('complete', generation.run.sequence.surfaceId),
      timestamp: '2026-09-21T00:00:01.000Z',
    });
    assert.ok(!duplicate.ok);
    assert.match(duplicate.message, /Action 重放或重复提交已被拒绝/);
  });

  it('Workbench 生成后 submit action 创建任务并原地关闭提交入口', async () => {
    const workbenchStore = new WorkbenchTaskStore();
    const adapter = createReferenceAgentAdapter({
      createSurfaceId: () => 'surface-workbench',
      workbenchTaskStore: workbenchStore,
      resolveActionContext: ({ clientContext }) => ({ ...clientContext }),
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

  it('Basic search action 返回包含用户输入值的原地更新', async () => {
    const surfaceId = 'surface-search';
    const adapter = createReferenceAgentAdapter({
      useLlm: () => false,
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
              {
                id: 'root',
                component: 'Column',
                children: ['keyword', 'searchButton', 'searchLabel'],
              },
              {
                id: 'keyword',
                component: 'TextField',
                label: 'Keyword',
                value: { path: '/keyword' },
              },
              {
                id: 'searchButton',
                component: 'Button',
                child: 'searchLabel',
                action: {
                  event: { name: 'search', context: { keyword: { path: '/keyword' } } },
                },
              },
              { id: 'searchLabel', component: 'Text', text: 'Search' },
            ],
          },
        },
      ],
      resolveActionContext: ({ clientContext }) => ({ ...clientContext }),
    });
    const generation = await adapter.prepareGeneration({
      message: '创建查询界面',
      catalogId: BASIC_CATALOG,
    });
    assert.ok(generation.ok);
    const generationMessages = await collect(generation.run.source);
    await generation.run.commit(generationMessages);
    const action = await adapter.prepareAction({
      ...createAction('search', surfaceId),
      sourceComponentId: 'searchButton',
      context: { keyword: 'A2UI Runtime' },
    });

    assert.ok(action.ok, action.ok ? undefined : action.message);
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
    const surfaceId = 'surface-form';
    const adapter = createReferenceAgentAdapter({
      useLlm: () => false,
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
      resolveActionContext: ({ clientContext }) => ({ ...clientContext }),
    });
    const generation = await adapter.prepareGeneration({
      message: '创建操作界面',
      catalogId: BASIC_CATALOG,
    });
    assert.ok(generation.ok);
    const generationMessages = await collect(generation.run.source);
    await generation.run.commit(generationMessages);
    const action = await adapter.prepareAction({
      ...createAction('submit', surfaceId),
      sourceComponentId: 'submitButton',
      context: { name: 'A2UI Runtime', subscribed: true },
    });

    assert.ok(action.ok, action.ok ? undefined : action.message);
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

  it('旧版 Basic Task catalog ID 不再被静默归一，直接按未注册拒绝', async () => {
    const adapter = createReferenceAgentAdapter({
      useLlm: () => false,
    });
    const plan = await adapter.prepareGeneration({ catalogId: LEGACY_BASIC_TASK_CATALOG });
    assert.ok(!plan.ok);
    assert.match(plan.message, /Agent catalog 未注册/);
  });

  it('rejects actions when only the legacy history record exists', async () => {
    const historyStore = new InMemorySurfaceHistoryStore();
    await historyStore.commitGeneration('surface-legacy-action', LEGACY_BASIC_TASK_CATALOG, []);
    const adapter = createReferenceAgentAdapter({ historyStore, useLlm: () => false });

    const action = await adapter.prepareAction(createAction('search', 'surface-legacy-action'));
    assert.ok(!action.ok);
    assert.match(action.message, /Action surface 不存在或已过期/);
  });

  it('参考装配显式携带演示 registry 与 LLM 生成源', async () => {
    const generationRequests: AgentLlmStreamRequest[] = [];
    const adapter = createReferenceAgentAdapter({
      useLlm: () => true,
      createSurfaceId: () => 'surface-reference-llm',
      streamLlm: (request) => {
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
    const plan = await adapter.prepareGeneration({ catalogId: NEXUS_BASIC_TASK_CATALOG });
    assert.ok(plan.ok);
    await collect(plan.run.source);

    assert.equal(generationRequests.length, 1);
    assert.equal(generationRequests[0]?.catalogId, NEXUS_BASIC_TASK_CATALOG);
    assert.ok(generationRequests[0]?.supportedComponents.includes('Text'));
  });

  it('参考装配走显式注入的生成源与 manager 契约', async () => {
    const adapter = createReferenceAgentAdapter({
      createSurfaceId: () => 'surface-reference-run',
    });
    const plan = await adapter.prepareGeneration({ catalogId: TASK_CATALOG });
    assert.ok(plan.ok);
    const result = await sendAgentRun(
      createSseContext(),
      plan.run,
      'reference-run',
      { manager: new InMemoryAgentRunManager(), streamDelayMs: 0 },
    );
    assert.equal(result.ok, true);
  });

  it('没有 registry 时 AgentAdapter 构造报错（参考装配必须显式提供）', () => {
    assert.throws(
      () => new AgentAdapter({} as ConstructorParameters<typeof AgentAdapter>[0]),
      /registry/i,
    );
  });
});
