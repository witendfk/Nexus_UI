import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import type Koa from 'koa';
import {
  CatalogRegistry,
  parseSurfaceCommit,
  standardCatalogComponentDeclarations,
} from '@nexus-ui/core';
import type { CatalogDefinition, NexusSurfaceCommit } from '@nexus-ui/core';
import { AgentAdapter } from '../../src/agent/adapter';
import type { AgentMessageSource, AgentRun } from '../../src/agent/adapter';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';
import { InMemoryAgentRunManager } from '../../src/agent/run-manager';
import { sendAgentRun, sendMessages } from '../../src/api/send-messages';

/**
 * S2.5.1 发送层身份收口：sendAgentRun 以 AgentRun.runId 为唯一运行标识——
 * manager 记录、SSE 事件 id 前缀与成功 done 全部同值，不再以另一个 idPrefix
 * 改写 commit.runId；无可确认提交结果的运行不能伪造成功 done。
 * 原始 sendMessages 仍是工具路径，不产生运行记录。
 */

const IDENTITY_CATALOG_ID = 'https://example.com/catalogs/send-identity/v1';
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

const SURFACE = 's-send-identity';

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

function createAdapter(
  runManager?: InMemoryAgentRunManager,
  onEmptyAction?: () => void,
): AgentAdapter {
  const adapter = new AgentAdapter({
    registry,
    runManager,
    createSurfaceId: () => SURFACE,
    createGenerationSource: () => generationStream(),
  });
  adapter.registerActionHandler(IDENTITY_CATALOG_ID, 'refresh', async (action) => {
    if (onEmptyAction) {
      onEmptyAction();
      return [];
    }
    return [
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: action.surfaceId,
          value: { note: action.context.note },
        },
      },
    ];
  });
  return adapter;
}

function createSseCapture(): { ctx: Koa.Context; output: () => string; ended: Promise<void> } {
  let output = '';
  let body: unknown;
  const res = new PassThrough();
  // res 必须处于 flowing 模式，否则其 readable 'end' 永不触发，ended 会挂起。
  res.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  const ended = new Promise<void>((resolve) => res.once('end', () => resolve()));
  const ctx = {
    status: 200,
    set: () => undefined,
    res,
    get body() {
      return body;
    },
    set body(value: unknown) {
      body = value;
    },
  } as unknown as Koa.Context;
  return { ctx, output: () => output, ended };
}

function doneFrame(text: string): string {
  const frame = text.split('\n\n').find((candidate) => candidate.startsWith('event: done'));
  assert.ok(frame, `缺少 done 帧：\n${text}`);
  return frame;
}

function doneCommit(text: string): NexusSurfaceCommit {
  const dataLine = doneFrame(text)
    .split('\n')
    .find((line) => line.startsWith('data: '));
  assert.ok(dataLine, 'done 帧缺少 data 行');
  const commit = parseSurfaceCommit(JSON.parse(dataLine.slice(6)));
  assert.ok(commit, 'done 载荷必须是合法 NexusSurfaceCommit');
  return commit;
}

describe('sendAgentRun 单一运行标识（S2.5.1）', () => {
  it('生成流的事件前缀、done 与 manager 记录都使用 run.runId', async () => {
    const manager = new InMemoryAgentRunManager();
    const adapter = createAdapter(manager);
    const plan = await adapter.prepareGeneration({ catalogId: IDENTITY_CATALOG_ID });
    assert.ok(plan.ok);

    const { ctx, output, ended } = createSseCapture();
    const result = await sendAgentRun(ctx, plan.run, {
      manager,
      streamDelayMs: 0,
    });
    await ended;

    assert.equal(result.ok, true);
    const text = output();
    assert.match(text, new RegExp(`^id: ${plan.run.runId}:0$`, 'm'), text);
    const frame = doneFrame(text);
    assert.match(frame, new RegExp(`^id: ${plan.run.runId}:done$`, 'm'), frame);
    assert.equal(doneCommit(text).runId, plan.run.runId, 'done 不得改写 commit.runId');

    const record = manager.get(plan.run.runId);
    assert.equal(record?.state, 'succeeded');
    assert.equal(record?.surfaceId, SURFACE);
    assert.equal(record?.kind, 'generate');
  });

  it('action 流同样以 run.runId 贯穿事件与 done', async () => {
    const manager = new InMemoryAgentRunManager();
    const adapter = createAdapter(manager);
    const generation = await adapter.prepareGeneration({ catalogId: IDENTITY_CATALOG_ID });
    assert.ok(generation.ok);
    await generation.run.commit(generationMessages());

    const plan = await adapter.prepareAction({
      name: 'refresh',
      surfaceId: SURFACE,
      sourceComponentId: 'button',
      timestamp: new Date().toISOString(),
      context: { note: '' },
      actionId: 'browser-action-identity',
      sessionVersion: 1,
      surfaceRevision: 1,
      catalogHash,
    });
    assert.ok(plan.ok);

    const { ctx, output, ended } = createSseCapture();
    const result = await sendAgentRun(ctx, plan.run, {
      manager,
      streamDelayMs: 0,
    });
    await ended;

    assert.equal(result.ok, true);
    const commit = doneCommit(output());
    assert.equal(commit.runId, plan.run.runId);
    assert.equal(commit.surfaceRevision, 2);
    assert.equal(manager.get(plan.run.runId)?.kind, 'action');
    assert.equal(manager.get(plan.run.runId)?.state, 'succeeded');
  });

  it('HTTP 空输出 action 消费完整响应后得到固定成功 done', async () => {
    const manager = new InMemoryAgentRunManager();
    let calls = 0;
    const adapter = createAdapter(manager, () => {
      calls += 1;
    });
    const generation = await adapter.prepareGeneration({ catalogId: IDENTITY_CATALOG_ID });
    assert.ok(generation.ok);
    const baseline = await generation.run.commit(generationMessages());
    const plan = await adapter.prepareAction({
      name: 'refresh',
      surfaceId: SURFACE,
      sourceComponentId: 'button',
      timestamp: new Date().toISOString(),
      context: { note: '' },
      actionId: 'empty-http-action',
      sessionVersion: 1,
      surfaceRevision: baseline.surfaceRevision,
      catalogHash,
    });
    assert.ok(plan.ok);
    const { ctx, output, ended } = createSseCapture();
    const result = await sendAgentRun(ctx, plan.run, { manager, streamDelayMs: 0 });
    await ended;
    assert.equal(result.ok, true);
    assert.deepEqual(result.messages, []);
    assert.equal(calls, 1);
    assert.doesNotMatch(output(), /event: (error|message)/);
    const commit = doneCommit(output());
    assert.deepEqual(commit, {
      ...baseline,
      runId: plan.run.runId,
      surfaceRevision: baseline.surfaceRevision + 1,
    });
    assert.equal(manager.get(plan.run.runId)?.state, 'succeeded');
    // 真实权威 revision 已前进：下一次可用新基准准入。
    const next = await adapter.prepareAction({
      name: 'refresh',
      surfaceId: SURFACE,
      sourceComponentId: 'button',
      timestamp: new Date().toISOString(),
      context: { note: '' },
      actionId: 'after-empty-http-action',
      sessionVersion: 1,
      surfaceRevision: commit.surfaceRevision,
      catalogHash,
    });
    assert.ok(next.ok);
    next.run.dispose?.();
  });

  it('无可确认提交结果的自定义运行不得伪造成功 done', async () => {
    const manager = new InMemoryAgentRunManager();
    // 既有 commit(): void 形态（迁移前签名）：显式断言其被拒绝而非发布成功。
    const legacyRun = {
      source: [{ version: 'v0.9', updateDataModel: { surfaceId: SURFACE, value: { step: 1 } } }],
      sequence: {
        kind: 'action' as const,
        surfaceId: SURFACE,
        catalogId: IDENTITY_CATALOG_ID,
        registry,
        supportedActions: ['refresh'],
      },
      runId: 'custom-run-void-commit',
      commit: () => undefined,
    } as unknown as AgentRun;

    const { ctx, output, ended } = createSseCapture();
    const result = await sendAgentRun(ctx, legacyRun, { manager, streamDelayMs: 0 });
    await ended;

    assert.equal(result.ok, false, 'void commit 不能宣告成功');
    const text = output();
    assert.match(text, /event: error/);
    assert.doesNotMatch(text, /event: done/);
    assert.equal(manager.get('custom-run-void-commit')?.state, 'failed');
  });

  it('缺少 runId 的运行在占用 SSE 响应前显式拒绝', () => {
    const manager = new InMemoryAgentRunManager();
    const run = {
      source: [],
      sequence: {
        kind: 'action' as const,
        surfaceId: SURFACE,
        catalogId: IDENTITY_CATALOG_ID,
        registry,
        supportedActions: ['refresh'],
      },
      commit: async (): Promise<NexusSurfaceCommit> => ({
        sessionVersion: 1,
        runId: 'should-not-matter',
        surfaceId: SURFACE,
        catalogId: IDENTITY_CATALOG_ID,
        contractVersion: 2,
        catalogHash,
        surfaceRevision: 1,
      }),
    } as unknown as AgentRun;

    const { ctx } = createSseCapture();
    assert.throws(() => sendAgentRun(ctx, run, { manager }), /runId/);
    assert.equal(ctx.body, undefined, '拒绝非法 run 时不能占用响应');
  });

  it('原始 sendMessages 仍是工具路径：按调用方 idPrefix 命名事件，不产生运行记录', async () => {
    const { ctx, output, ended } = createSseCapture();
    const result = await sendMessages(
      ctx,
      [
        { version: 'v0.9', createSurface: { surfaceId: SURFACE, catalogId: IDENTITY_CATALOG_ID } },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: SURFACE,
            components: [{ id: 'root', component: 'Card' }],
          },
        },
      ],
      'raw-prefix',
      {
        kind: 'generate',
        surfaceId: SURFACE,
        catalogId: IDENTITY_CATALOG_ID,
        registry,
        supportedActions: [],
      },
      () => undefined,
      { streamDelayMs: 0 },
    );
    await ended;

    assert.equal(result.ok, true);
    const text = output();
    assert.match(text, /^id: raw-prefix:0$/m);
    assert.match(doneFrame(text), /^id: raw-prefix:done$/m);
  });
});

describe('提交结果的运行时校验与关联', () => {
  for (const [label, override] of [
    ['空对象', {}],
    ['错误运行', { runId: 'another-run' }],
    ['错误 surface', { surfaceId: 'another-surface' }],
    ['错误 Catalog', { catalogId: 'https://example.com/another-catalog' }],
    ['错误 hash', { catalogHash: `sha256:${'0'.repeat(64)}` }],
  ] as readonly [string, Record<string, unknown>][]) {
    it(`拒绝${label}提交结果，不留存且不发布成功 done`, async () => {
      const manager = new InMemoryAgentRunManager();
      const commit =
        label === '空对象'
          ? {}
          : {
              sessionVersion: 1,
              runId: 'custom-checked-run',
              surfaceId: SURFACE,
              catalogId: IDENTITY_CATALOG_ID,
              contractVersion: 2,
              catalogHash,
              surfaceRevision: 1,
              ...override,
            };
      const run = {
        runId: 'custom-checked-run',
        source: [{ version: 'v0.9', updateDataModel: { surfaceId: SURFACE, value: { note: '' } } }],
        sequence: {
          kind: 'action',
          surfaceId: SURFACE,
          catalogId: IDENTITY_CATALOG_ID,
          registry,
          supportedActions: ['refresh'],
        },
        commit: () => commit,
      } as unknown as AgentRun;
      const { ctx, output, ended } = createSseCapture();
      const result = await sendAgentRun(ctx, run, { manager, streamDelayMs: 0 });
      await ended;
      assert.equal(result.ok, false);
      assert.doesNotMatch(output(), /event: done/);
      assert.match(output(), /event: error/);
      assert.equal(manager.get(run.runId)?.commit, undefined);
      assert.equal(manager.get(run.runId)?.state, 'failed');
    });
  }
});
