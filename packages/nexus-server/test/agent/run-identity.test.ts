import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CatalogRegistry, standardCatalogComponentDeclarations } from '@nexus-ui/core';
import type { CatalogDefinition } from '@nexus-ui/core';
import { AgentAdapter } from '../../src/agent/adapter';
import type { AgentMessageSource } from '../../src/agent/adapter';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';

/**
 * S2.5.1 统一运行标识：一次 run 只分配一个不可变 ID，由运行创建方（adapter）
 * 分配并经 AgentRun.runId 暴露；非 HTTP commit 结果使用同一值。
 * runId（服务端运行标识）与 actionId（客户端提交标识、ledger 重放键）语义分离。
 */

const IDENTITY_CATALOG_ID = 'https://example.com/catalogs/run-identity/v1';
const identityCatalog: CatalogDefinition = {
  catalogId: IDENTITY_CATALOG_ID,
  components: standardCatalogComponentDeclarations(),
  actions: [
    {
      name: 'refresh',
      sources: ['Button'],
      paramSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { note: { type: 'string' } },
      },
    },
  ],
};
const registry = new CatalogRegistry([identityCatalog]);
const catalogHash = createCatalogContractHash(identityCatalog);

const SURFACE = 's-run-identity';

function generationMessages(): unknown[] {
  return [
    { version: 'v0.9', createSurface: { surfaceId: SURFACE, catalogId: IDENTITY_CATALOG_ID } },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: SURFACE,
        components: [
          { id: 'root', component: 'Column', children: ['note', 'button', 'label'] },
          { id: 'note', component: 'TextField', label: 'Note', value: { path: '/note' } },
          {
            id: 'button',
            component: 'Button',
            child: 'label',
            action: { event: { name: 'refresh', context: { note: { path: '/note' } } } },
          },
          { id: 'label', component: 'Text', text: 'Refresh' },
        ],
      },
    },
    { version: 'v0.9', updateDataModel: { surfaceId: SURFACE, value: { note: '' } } },
  ];
}

function generationStream(): AgentMessageSource {
  return generationMessages()[Symbol.iterator]() as unknown as AgentMessageSource;
}

function createAdapter(): AgentAdapter {
  const adapter = new AgentAdapter({
    registry,
    createSurfaceId: () => SURFACE,
    createGenerationSource: () => generationStream(),
  });
  adapter.registerActionHandler(IDENTITY_CATALOG_ID, 'refresh', async (action) => [
    {
      version: 'v0.9',
      updateDataModel: {
        surfaceId: action.surfaceId,
        value: { note: action.context.note },
      },
    },
  ]);
  return adapter;
}

describe('运行标识由运行创建方一次性分配（S2.5.1）', () => {
  it('生成 run 暴露非空 runId，非 HTTP commit 使用同一标识', async () => {
    const adapter = createAdapter();
    const plan = await adapter.prepareGeneration({ catalogId: IDENTITY_CATALOG_ID });
    assert.ok(plan.ok, plan.ok ? '' : plan.message);
    assert.equal(typeof plan.run.runId, 'string', 'AgentRun 必须暴露 runId');
    assert.notEqual(plan.run.runId, '');

    // S3.2 迁移：调度任务自动提交，hand-built 数组直提已移除；用实际运行
    // outcome.commit 核对同一标识
    const outcome = await plan.run.result;
    assert.equal(outcome.terminal, 'succeeded');
    assert.equal(outcome.commit.runId, plan.run.runId, '非 HTTP commit 必须使用 run.runId');
  });

  it('两次准备得到不同 runId，运行标识不复用', async () => {
    const adapter = createAdapter();
    const first = await adapter.prepareGeneration({ catalogId: IDENTITY_CATALOG_ID });
    const second = await adapter.prepareGeneration({ catalogId: IDENTITY_CATALOG_ID });
    assert.ok(first.ok && second.ok);
    assert.notEqual(first.run.runId, second.run.runId);
  });

  it('action run 的 runId 与 commit 同值，且与客户端 actionId 语义分离', async () => {
    const adapter = createAdapter();
    const generation = await adapter.prepareGeneration({ catalogId: IDENTITY_CATALOG_ID });
    assert.ok(generation.ok);
    // S3.2 迁移：生成任务自动提交，直接等终态即可
    const genOutcome = await generation.run.result;
    assert.equal(genOutcome.terminal, 'succeeded');

    const actionId = 'browser-action-1';
    const plan = await adapter.prepareAction({
      name: 'refresh',
      surfaceId: SURFACE,
      sourceComponentId: 'button',
      timestamp: new Date().toISOString(),
      context: { note: '' },
      actionId,
      sessionVersion: 1,
      surfaceRevision: 1,
      catalogHash,
    });
    assert.ok(plan.ok, plan.ok ? '' : plan.message);
    assert.equal(typeof plan.run.runId, 'string');
    assert.notEqual(plan.run.runId, actionId, 'runId 不能复用客户端 actionId');

    // S3.2 迁移：action 任务自动消费并提交，commit 取自实际运行终态
    const outcome = await plan.run.result;
    assert.equal(outcome.terminal, 'succeeded');
    assert.equal(
      outcome.commit.runId,
      plan.run.runId,
      'action 的非 HTTP commit 必须使用 run.runId',
    );
    assert.equal(outcome.commit.surfaceRevision, 2);
  });
});
