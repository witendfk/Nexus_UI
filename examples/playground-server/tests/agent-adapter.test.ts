import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import type Koa from 'koa';
import {
  AgentAdapter,
  InMemoryAgentRunManager,
  sendAgentRun,
  InMemorySurfaceHistoryStore,
} from '@nexus-ui/server';
import type { AgentLlmStreamRequest } from '@nexus-ui/server';
import { createCatalogContractHash } from '@nexus-ui/server';
import { agentCatalogRegistry } from '../src/agent/catalog';
import {
  BASIC_CATALOG,
  LEGACY_BASIC_TASK_CATALOG,
  NEXUS_BASIC_TASK_CATALOG,
  TASK_CATALOG,
  WORKBENCH_CATALOG,
} from '../src/agent/catalog';
import { WorkbenchTaskStore } from '../src/agent/workbench-agent';
import { createReferenceAgentAdapter } from '../src/reference/reference-agent';

function createSseContext(): Koa.Context {
  return {
    status: 200,
    set: () => undefined,
    res: new PassThrough(),
  } as unknown as Koa.Context;
}

let actionSeq = 0;
let litSeq = 0;
function nextLitId(): string {
  litSeq += 1;
  return `lit-${litSeq}`;
}
const TEST_CATALOG_HASH = createCatalogContractHash(agentCatalogRegistry.get(BASIC_CATALOG)!);
const WORKBENCH_CATALOG_HASH = createCatalogContractHash(
  agentCatalogRegistry.get(WORKBENCH_CATALOG)!,
);
const TASK_CATALOG_HASH = createCatalogContractHash(agentCatalogRegistry.get(TASK_CATALOG)!);

/** 组装必填 nexus 元数据（S2.4：缺失即旧格式拒绝）。 */
function createAction(name: string, surfaceId: string, catalogHash: string = TEST_CATALOG_HASH) {
  actionSeq += 1;
  return {
    name,
    surfaceId,
    sourceComponentId: 'button',
    timestamp: new Date().toISOString(),
    actionId: `action-${actionSeq}`,
    sessionVersion: 1,
    surfaceRevision: 1,
    catalogHash,
    context: {},
  };
}

describe('playground reference adapter（参考装配，注册表与生成源显式注入）', () => {
  it('按 catalog 选择 fallback 生成源并生成 surfaceId', async () => {
    const adapter = createReferenceAgentAdapter({
      createSurfaceId: () => 'surface-task-adapter',
    });
    const plan = await adapter.prepareGeneration({ catalogId: TASK_CATALOG });

    assert.ok(plan.ok, 'S3.2：入队即接受');
    const outcome = await plan.run.result; // S3.2：sequence 在调度内准备完成后才可读
    assert.equal(outcome.terminal, 'succeeded');
    assert.equal(plan.run.sequence.surfaceId, 'surface-task-adapter');
    assert.equal(plan.run.sequence.catalogId, TASK_CATALOG);
  });

  it('action 按 surface 记录的 catalog 分发 handler', async () => {
    const adapter = createReferenceAgentAdapter({
      createSurfaceId: () => 'surface-action-adapter',
    });
    const generation = await adapter.prepareGeneration({ catalogId: TASK_CATALOG });
    assert.ok(generation.ok, 'S3.2：入队即接受');
    // S3.2：调度自动消费生成源并提交，无需 collect+commit
    const generationOutcome = await generation.run.result;
    assert.equal(generationOutcome.terminal, 'succeeded');

    const start = await adapter.prepareAction(
      createAction('start', generation.run.sequence.surfaceId, TASK_CATALOG_HASH),
    );
    assert.ok(start.ok, 'S3.2：入队即接受');
    const startOutcome = await start.run.result; // S3.2：消息断言改用终态 outcome.messages
    assert.equal(startOutcome.terminal, 'succeeded');
    assert.equal(start.run.sequence.catalogId, TASK_CATALOG);
    const startResponse = startOutcome.messages;
    assert.match(JSON.stringify(startResponse), /进行中/);
    assert.match(JSON.stringify(startResponse), /"name":"complete"/);

    // complete 在 start 提交（revision 2）之后准入：客户端观测随之刷新为 2
    const completeAction = {
      ...createAction('complete', generation.run.sequence.surfaceId, TASK_CATALOG_HASH),
      surfaceRevision: 2,
      timestamp: '2026-09-21T00:00:01.000Z',
    };
    const complete = await adapter.prepareAction(completeAction);
    assert.ok(complete.ok, 'S3.2：入队即接受');
    const completeOutcome = await complete.run.result;
    assert.equal(completeOutcome.terminal, 'succeeded');
    const completeResponse = completeOutcome.messages;
    assert.match(JSON.stringify(completeResponse), /已完成/);
    assert.match(JSON.stringify(completeResponse), /"disabled":true/);

    // 重放以 actionId 为键：同一提交标识再次到达即拒绝（ledger 终态可重试的
    // 是失败记录，不是成功提交）。S3.2：ledger 准入移入调度任务，拒绝变为运行失败终态
    const duplicate = await adapter.prepareAction(completeAction);
    assert.ok(duplicate.ok, 'S3.2：入队即接受');
    const duplicateOutcome = await duplicate.run.result;
    assert.equal(duplicateOutcome.terminal, 'failed');
    assert.equal(duplicateOutcome.code, 'RUN_ADMISSION_REJECTED');
    assert.match(duplicateOutcome.message ?? '', /Action 重放或重复提交已被拒绝/);
  });

  it('Workbench 生成后 submit action 创建任务并原地关闭提交入口', async () => {
    const workbenchStore = new WorkbenchTaskStore();
    const adapter = createReferenceAgentAdapter({
      createSurfaceId: () => 'surface-workbench',
      workbenchTaskStore: workbenchStore,
      resolveActionContext: ({ clientContext }) => ({ ...clientContext }),
    });
    const generation = await adapter.prepareGeneration({ catalogId: WORKBENCH_CATALOG });
    assert.ok(generation.ok, 'S3.2：入队即接受');
    // S3.2：调度自动消费并提交，消息断言改用终态 outcome.messages
    const generationOutcome = await generation.run.result;
    assert.equal(generationOutcome.terminal, 'succeeded');
    const messages = generationOutcome.messages;

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
      actionId: nextLitId(),
      sessionVersion: 1,
      surfaceRevision: 1,
      catalogHash: WORKBENCH_CATALOG_HASH,
      // S2.4：参数形状由 paramSchema 先行校验（客户端须发送完整表单批次），
      // 业务文案（空标题）由消息源消费时调用的演示 handler 给出。
      context: {
        taskTitle: '',
        priority: [],
        reminderAt: '',
        customerId: 'customer-1024',
        customerName: '华云科技',
      },
    });
    assert.ok(empty.ok, 'S3.2：入队即接受');
    // S3.2：handler 业务报错在调度内消费时发生，收敛为运行失败终态
    const emptyOutcome = await empty.run.result;
    assert.equal(emptyOutcome.terminal, 'failed');
    assert.match(emptyOutcome.message ?? '', /请输入跟进任务标题/);

    for (const priority of [[], ['urgent'], ['high', 'low']]) {
      const invalid = await adapter.prepareAction({
        name: 'submit',
        surfaceId: 'surface-workbench',
        sourceComponentId: 'submitButton',
        timestamp: new Date().toISOString(),
        actionId: nextLitId(),
        sessionVersion: 1,
        surfaceRevision: 1,
        catalogHash: WORKBENCH_CATALOG_HASH,
        context: {
          taskTitle: '发送方案修订版',
          priority,
          reminderAt: '2026-09-20T10:00:00',
          customerId: 'customer-1024',
          customerName: '华云科技',
        },
      });
      assert.ok(invalid.ok, 'S3.2：入队即接受');
      const invalidOutcome = await invalid.run.result; // S3.2：handler 报错收敛为运行失败终态
      assert.equal(invalidOutcome.terminal, 'failed');
      assert.match(invalidOutcome.message ?? '', /请选择有效的任务优先级/);
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
        actionId: nextLitId(),
        sessionVersion: 1,
        surfaceRevision: 1,
        catalogHash: WORKBENCH_CATALOG_HASH,
        context: {
          taskTitle: '发送方案修订版',
          priority: ['high'],
          reminderAt,
          customerId: 'customer-1024',
          customerName: '华云科技',
        },
      });
      assert.ok(invalid.ok, 'S3.2：入队即接受');
      const invalidOutcome = await invalid.run.result; // S3.2：handler 报错收敛为运行失败终态
      assert.equal(invalidOutcome.terminal, 'failed');
      assert.equal(invalidOutcome.message, message);
    }

    const plan = await adapter.prepareAction({
      name: 'submit',
      surfaceId: 'surface-workbench',
      sourceComponentId: 'submitButton',
      timestamp: new Date().toISOString(),
      actionId: nextLitId(),
      sessionVersion: 1,
      surfaceRevision: 1,
      catalogHash: WORKBENCH_CATALOG_HASH,
      context: {
        taskTitle: '发送方案修订版',
        priority: ['high'],
        reminderAt: '2026-09-20T10:00',
        customerId: 'customer-1024',
        customerName: '华云科技',
      },
    });
    assert.ok(plan.ok, 'S3.2：入队即接受');
    const planOutcome = await plan.run.result; // S3.2：调度自动提交，直接读终态消息
    assert.equal(planOutcome.terminal, 'succeeded');
    assert.equal(plan.run.sequence.catalogId, WORKBENCH_CATALOG);
    const serialized = JSON.stringify(planOutcome.messages);

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
      actionId: nextLitId(),
      sessionVersion: 1,
      surfaceRevision: 2,
      catalogHash: WORKBENCH_CATALOG_HASH,
      context: {
        taskTitle: '再次提交',
        priority: ['low'],
        reminderAt: '2026-09-21T10:00:00',
        customerId: 'customer-1024',
        customerName: '华云科技',
      },
    });
    assert.ok(duplicate.ok, 'S3.2：入队即接受');
    const duplicateOutcome = await duplicate.run.result; // S3.2：handler 报错收敛为运行失败终态
    assert.equal(duplicateOutcome.terminal, 'failed');
    assert.match(duplicateOutcome.message ?? '', /该客户的跟进任务已创建，不能重复提交/);
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
    assert.ok(generation.ok, 'S3.2：入队即接受');
    const generationOutcome = await generation.run.result; // S3.2：调度自动消费并提交
    assert.equal(generationOutcome.terminal, 'succeeded');
    const action = await adapter.prepareAction({
      ...createAction('search', surfaceId),
      sourceComponentId: 'searchButton',
      context: { keyword: 'A2UI Runtime' },
    });

    assert.ok(action.ok, 'S3.2：入队即接受');
    const actionOutcome = await action.run.result; // S3.2：调度自动提交，消息断言改用终态
    assert.equal(actionOutcome.terminal, 'succeeded');
    assert.deepEqual(actionOutcome.messages, [
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
                // S2.4：客户端 context 键必须是已声明绑定字段——旧夹具依赖
                // 空 context 透传客户端值，现按契约显式声明绑定并由服务端重算。
                action: {
                  event: {
                    name: 'submit',
                    context: {
                      name: { path: '/name' },
                      subscribed: { path: '/subscribed' },
                    },
                  },
                },
              },
              { id: 'submitLabel', component: 'Text', text: 'Submit' },
            ],
          },
        },
        {
          version: 'v0.9',
          updateDataModel: {
            surfaceId,
            value: { name: 'A2UI Runtime', subscribed: true },
          },
        },
      ],
      resolveActionContext: ({ clientContext }) => ({ ...clientContext }),
    });
    const generation = await adapter.prepareGeneration({
      message: '创建操作界面',
      catalogId: BASIC_CATALOG,
    });
    assert.ok(generation.ok, 'S3.2：入队即接受');
    const generationOutcome = await generation.run.result; // S3.2：调度自动消费并提交
    assert.equal(generationOutcome.terminal, 'succeeded');
    const action = await adapter.prepareAction({
      ...createAction('submit', surfaceId),
      sourceComponentId: 'submitButton',
      context: { name: 'A2UI Runtime', subscribed: true },
    });

    assert.ok(action.ok, 'S3.2：入队即接受');
    const actionOutcome = await action.run.result; // S3.2：调度自动提交，消息断言改用终态
    assert.equal(actionOutcome.terminal, 'succeeded');
    assert.deepEqual(actionOutcome.messages, [
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
    assert.ok(action.ok, 'S3.2：入队即接受');
    // S3.2：快照准入移入调度任务，surface 缺失变为运行失败终态
    const outcome = await action.run.result;
    assert.equal(outcome.terminal, 'failed');
    assert.equal(outcome.code, 'RUN_ADMISSION_REJECTED');
    assert.match(outcome.message ?? '', /Action surface 不存在或已过期/);
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
          // S3.2：最终校验在调度内执行，mock 流补全 root 组件以满足生成流契约
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId: request.surfaceId,
              components: [
                { id: 'root', component: 'Column', children: ['heading'] },
                { id: 'heading', component: 'Text', text: 'Nexus' },
              ],
            },
          },
        ];
      },
    });
    const plan = await adapter.prepareGeneration({ catalogId: NEXUS_BASIC_TASK_CATALOG });
    assert.ok(plan.ok, 'S3.2：入队即接受');
    const outcome = await plan.run.result; // S3.2：调度自动消费生成源
    assert.equal(outcome.terminal, 'succeeded');

    assert.equal(generationRequests.length, 1);
    assert.equal(generationRequests[0]?.catalogId, NEXUS_BASIC_TASK_CATALOG);
    assert.ok(generationRequests[0]?.supportedComponents.includes('Text'));
  });

  it('参考装配走显式注入的生成源与 manager 契约', async () => {
    const manager = new InMemoryAgentRunManager();
    const adapter = createReferenceAgentAdapter({
      createSurfaceId: () => 'surface-reference-run',
      runManager: manager,
    });
    const plan = await adapter.prepareGeneration({ catalogId: TASK_CATALOG });
    assert.ok(plan.ok);
    const result = await sendAgentRun(createSseContext(), plan.run, {
      manager,
      streamDelayMs: 0,
    });
    assert.equal(result.ok, true);
  });

  it('没有 registry 时 AgentAdapter 构造报错（参考装配必须显式提供）', () => {
    assert.throws(
      () => new AgentAdapter({} as ConstructorParameters<typeof AgentAdapter>[0]),
      /registry/i,
    );
  });
});
