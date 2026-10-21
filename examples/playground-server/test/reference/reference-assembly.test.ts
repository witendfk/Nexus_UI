import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import type { NexusSurfaceCommit } from '@nexus-ui/core';
import { NEXUS_BASIC_TASK_CATALOG, TASK_CATALOG, WORKBENCH_CATALOG } from '../../src/agent/catalog';
import { createReferenceAgentAdapter } from '../../src/reference/reference-agent';
import type { AgentAction } from '@nexus-ui/server';

const FORM_MESSAGE = '生成一个订阅表单卡片';

async function generateSurface(catalogId: string, message?: string) {
  const adapter = createReferenceAgentAdapter({ useLlm: () => false });
  const plan = await adapter.prepareGeneration({
    catalogId,
    ...(message === undefined ? {} : { message }),
  });
  assert.ok(plan.ok, `生成被拒: ${plan.ok ? '' : plan.message}`);
  const messages: unknown[] = [];
  for await (const streamMessage of plan.run.source) messages.push(streamMessage);
  const commit = await plan.run.commit(messages);
  return { adapter, surfaceId: plan.run.sequence.surfaceId, commit, messages };
}

function actionFrom(
  commit: NexusSurfaceCommit,
  overrides: Partial<AgentAction> & { name: string; sourceComponentId: string },
): AgentAction {
  return {
    surfaceId: commit.surfaceId,
    timestamp: new Date().toISOString(),
    actionId: randomUUID(),
    context: {},
    sessionVersion: commit.sessionVersion,
    surfaceRevision: commit.surfaceRevision,
    catalogHash: commit.catalogHash,
    ...overrides,
  };
}

async function consumeAction(
  adapter: ReturnType<typeof createReferenceAgentAdapter>,
  action: AgentAction,
) {
  const plan = await adapter.prepareAction(action);
  if (!plan.ok) return { ok: false as const, message: plan.message };
  const messages: unknown[] = [];
  for await (const streamMessage of plan.run.source) messages.push(streamMessage);
  const commit = await plan.run.commit(messages);
  return { ok: true as const, messages, commit };
}

describe('S2.6.1.2 参考装配的可信可编辑路径', () => {
  it('workbench 三个真实表单输入经白名单准入，handler 收到服务端重算参数', async () => {
    const { adapter, surfaceId, commit } = await generateSurface(WORKBENCH_CATALOG);
    const result = await consumeAction(
      adapter,
      actionFrom(commit, {
        name: 'submit',
        sourceComponentId: 'submitButton',
        inputs: [
          { componentId: 'taskTitle', property: 'value', value: '上线nxui文档' },
          { componentId: 'priority', property: 'value', value: ['high'] },
          { componentId: 'reminderAt', property: 'value', value: '2026-10-21T09:00:00Z' },
        ],
      }),
    );
    assert.ok(result.ok, `workbench 输入应经白名单准入: ${result.message}`);
    const patchText = JSON.stringify(result.messages);
    assert.match(patchText, /任务已创建：followup-0001 · 上线nxui文档/);
    // customerId/customerName 未随输入提交，由服务端从只读模型路径重算。
    assert.ok(JSON.stringify(result.commit).includes(surfaceId));
  });

  it('宿主收窄白名单后，未开放路径的输入被拒绝', async () => {
    const adapter = createReferenceAgentAdapter({
      useLlm: () => false,
      editablePaths: () => ['/name'],
    });
    const plan = await adapter.prepareGeneration({
      catalogId: NEXUS_BASIC_TASK_CATALOG,
      message: FORM_MESSAGE,
    });
    assert.ok(plan.ok);
    const messages: unknown[] = [];
    for await (const streamMessage of plan.run.source) messages.push(streamMessage);
    const commit = await plan.run.commit(messages);

    const rejected = await adapter.prepareAction(
      actionFrom(commit, {
        name: 'submit',
        sourceComponentId: 'submitButton',
        inputs: [
          { componentId: 'name', property: 'value', value: '张三' },
          { componentId: 'subscribed', property: 'value', value: true },
        ],
      }),
    );
    assert.equal(rejected.ok, false, '未开放 /subscribed 时整批输入必须拒绝');
  });

  it('默认装配开放 Basic 表单的 /name 与 /subscribed', async () => {
    const { adapter, commit } = await generateSurface(NEXUS_BASIC_TASK_CATALOG, FORM_MESSAGE);
    const admitted = await consumeAction(
      adapter,
      actionFrom(commit, {
        name: 'submit',
        sourceComponentId: 'submitButton',
        inputs: [
          { componentId: 'name', property: 'value', value: '张三' },
          { componentId: 'subscribed', property: 'value', value: true },
        ],
      }),
    );
    assert.ok(admitted.ok, `Basic 表单输入应默认可准入: ${admitted.message}`);
  });

  it('Task Catalog 无输入组件，inputs=[] 的 action 不受白名单缺省影响', async () => {
    const { adapter, commit } = await generateSurface(TASK_CATALOG);
    const admitted = await consumeAction(
      adapter,
      actionFrom(commit, {
        name: 'start',
        sourceComponentId: 'button',
        inputs: [],
      }),
    );
    assert.ok(admitted.ok, `无输入 action 应可执行: ${admitted.message}`);
    assert.match(JSON.stringify(admitted.messages), /进行中/);
  });
});

describe('S2.6.1.3 Basic fallback 确定性表单', () => {
  it('表单意图消息生成可编辑表单并通过演示 Policy', async () => {
    const { messages } = await generateSurface(NEXUS_BASIC_TASK_CATALOG, FORM_MESSAGE);
    const rendered = JSON.stringify(messages);
    assert.match(rendered, /"TextField"/);
    assert.match(rendered, /\/name/);
    assert.match(rendered, /"CheckBox"/);
    assert.match(rendered, /\/subscribed/);
    assert.match(rendered, /"submit"/);
  });

  it('表单输入经权威准入到达 submit handler 并 patch 原 surface', async () => {
    const { adapter, commit } = await generateSurface(NEXUS_BASIC_TASK_CATALOG, FORM_MESSAGE);
    const result = await consumeAction(
      adapter,
      actionFrom(commit, {
        name: 'submit',
        sourceComponentId: 'submitButton',
        inputs: [
          { componentId: 'name', property: 'value', value: '张三' },
          { componentId: 'subscribed', property: 'value', value: true },
        ],
      }),
    );
    assert.ok(result.ok, `submit 应成功: ${result.message}`);
    assert.match(JSON.stringify(result.messages), /已提交：name=张三，subscribed=true/);
  });

  it('联系人消息仍走联系人卡片，不携带输入组件', async () => {
    const { messages } = await generateSurface(NEXUS_BASIC_TASK_CATALOG, '生成一张联系人卡片');
    const rendered = JSON.stringify(messages);
    assert.match(rendered, /David Park/);
    assert.doesNotMatch(rendered, /"CheckBox"/);
  });

  it('错误类型的输入值被整批拒绝', async () => {
    const { adapter, commit } = await generateSurface(NEXUS_BASIC_TASK_CATALOG, FORM_MESSAGE);
    const rejected = await adapter.prepareAction(
      actionFrom(commit, {
        name: 'submit',
        sourceComponentId: 'submitButton',
        inputs: [{ componentId: 'subscribed', property: 'value', value: 'yes' }],
      }),
    );
    assert.equal(rejected.ok, false, '布尔字段收到字符串必须拒绝');
    assert.match(rejected.ok ? '' : rejected.message, /值不符合声明 schema/);
  });
});
