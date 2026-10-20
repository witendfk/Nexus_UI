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
import type { AgentMessageSource } from '../../src/agent/adapter';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';
import type { AgentRunManager } from '../../src/agent/run-manager';
import { InMemoryAgentRunManager } from '../../src/agent/run-manager';
import { sendAgentRun } from '../../src/api/send-messages';

/**
 * S2.5.2 共用运行所有者的留存接线与拒绝路径：
 * - managed run commit 在成功 done 写出之前调用 manager.recordCommit 留存固定结果；
 * - 留存失败不得发布成功 done；
 * - 记录建立拒绝（重复 ID/容量满且全部活动）发生在占用 SSE 响应之前：
 *   不泄漏响应、不启动生成源/动作消息源、释放动作运行持有的 surface 锁。
 */

const RETENTION_CATALOG_ID = 'https://example.com/catalogs/run-retention/v1';
const retentionCatalog: CatalogDefinition = {
  catalogId: RETENTION_CATALOG_ID,
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
const registry = new CatalogRegistry([retentionCatalog]);
const catalogHash = createCatalogContractHash(retentionCatalog);

const SURFACE = 's-run-retention';

const flowEvents: string[] = [];

function generationMessages(): unknown[] {
  return [
    { version: 'v0.9', createSurface: { surfaceId: SURFACE, catalogId: RETENTION_CATALOG_ID } },
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
  return (async function* () {
    flowEvents.push('generate-source-started');
    yield* generationMessages()[Symbol.iterator]();
  })() as unknown as AgentMessageSource;
}

function createAdapter(runManager?: AgentRunManager): AgentAdapter {
  const adapter = new AgentAdapter({
    registry,
    runManager,
    createSurfaceId: () => SURFACE,
    createGenerationSource: () => generationStream(),
  });
  adapter.registerActionHandler(RETENTION_CATALOG_ID, 'refresh', async (action) => {
    flowEvents.push('action-handler-started');
    return (async function* () {
      yield {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: action.surfaceId,
          value: { note: action.context.note },
        },
      };
    })();
  });
  return adapter;
}

/** 包装同一 InMemory 实例，观察 recordCommit 调用时序，不另建平行记录所有者。 */
class SpyRunManager implements AgentRunManager {
  private readonly inner: InMemoryAgentRunManager;
  readonly events: string[] = [];
  onRecordCommit?: () => void;

  constructor(options?: { maxRecords?: number }) {
    this.inner = new InMemoryAgentRunManager(options);
  }

  create(input: { id: string; surfaceId: string; kind: 'generate' | 'action' }) {
    this.events.push(`create:${input.id}`);
    return this.inner.create(input);
  }

  recordCommit(id: string, commit: NexusSurfaceCommit): void {
    this.events.push(`recordCommit:${id}`);
    this.onRecordCommit?.();
    this.inner.recordCommit(id, commit);
  }

  transition(
    id: string,
    state: 'running' | 'succeeded' | 'failed' | 'canceled',
    message?: string,
  ): void {
    this.events.push(`transition:${id}:${state}`);
    this.inner.transition(id, state, message);
  }

  get(id: string) {
    return this.inner.get(id);
  }

  listBySurface(surfaceId: string) {
    return this.inner.listBySurface(surfaceId);
  }
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

function doneCommit(text: string): NexusSurfaceCommit {
  const frame = text.split('\n\n').find((candidate) => candidate.startsWith('event: done'));
  assert.ok(frame, `缺少 done 帧：\n${text}`);
  const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
  assert.ok(dataLine, 'done 帧缺少 data 行');
  const commit = parseSurfaceCommit(JSON.parse(dataLine.slice(6)));
  assert.ok(commit, 'done 载荷必须是合法 NexusSurfaceCommit');
  return commit;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('发送层固定结果留存（S2.5.2）', () => {
  it('成功 done 发出之前完成留存，done 载荷与记录中的固定结果一致', async () => {
    flowEvents.length = 0;
    const manager = new SpyRunManager();
    const adapter = createAdapter(manager);
    const plan = await adapter.prepareGeneration({ catalogId: RETENTION_CATALOG_ID });
    assert.ok(plan.ok);

    manager.onRecordCommit = () => {
      assert.ok(!output().includes('event: done'), 'recordCommit 必须发生在成功 done 写出之前');
    };
    const { ctx, output, ended } = createSseCapture();
    const result = await sendAgentRun(ctx, plan.run, { manager, streamDelayMs: 0 });
    await ended;

    assert.equal(result.ok, true);
    assert.deepEqual(
      manager.events,
      [
        `create:${plan.run.runId}`,
        `transition:${plan.run.runId}:running`,
        `recordCommit:${plan.run.runId}`,
        `transition:${plan.run.runId}:succeeded`,
      ],
      `实际事件序：${manager.events.join(' → ')}`,
    );
    const record = manager.get(plan.run.runId);
    assert.deepEqual(record?.commit, doneCommit(output()), '留存结果与 done 载荷一致');
    assert.ok(flowEvents.includes('generate-source-started'));
  });

  it('留存失败不得发布成功 done，运行记录无可用基准', async () => {
    flowEvents.length = 0;
    const manager = new SpyRunManager();
    manager.onRecordCommit = () => {
      throw new Error('留存存储不可用');
    };
    const adapter = createAdapter(manager);
    const plan = await adapter.prepareGeneration({ catalogId: RETENTION_CATALOG_ID });
    assert.ok(plan.ok);

    const { ctx, output, ended } = createSseCapture();
    const result = await sendAgentRun(ctx, plan.run, { manager, streamDelayMs: 0 });
    await ended;

    assert.equal(result.ok, false);
    assert.match(output(), /event: error/);
    assert.doesNotMatch(output(), /event: done/, '留存失败不得发布成功 done');
    const record = manager.get(plan.run.runId);
    assert.equal(record?.commit, undefined, '留存失败不得留下可用提交基准');
    assert.equal(record?.state, 'failed');
  });

  it('记录建立拒绝发生在占用响应之前：不泄漏响应、不启动生成源', async () => {
    flowEvents.length = 0;
    const manager = new InMemoryAgentRunManager({ maxRecords: 1 });
    // 占满容量的活动记录：永不迁移状态，受淘汰保护。
    manager.create({ id: 'active-blocker', surfaceId: 's-blocker', kind: 'generate' });

    const adapter = createAdapter(manager);
    const plan = await adapter.prepareGeneration({ catalogId: RETENTION_CATALOG_ID });
    assert.ok(plan.ok);

    const { ctx } = createSseCapture();
    assert.throws(() => sendAgentRun(ctx, plan.run, { manager, streamDelayMs: 0 }), /容量/);
    assert.equal(ctx.body, undefined, '拒绝时不得占用 SSE 响应');
    assert.equal(flowEvents.length, 0, '生成源不得在记录建立拒绝后启动');
  });

  it('动作运行被容量拒绝后释放 surface 锁，后续运行可正常提交', async () => {
    flowEvents.length = 0;
    const manager = new InMemoryAgentRunManager({ maxRecords: 1 });
    const adapter = createAdapter(manager);
    // 非 HTTP 提交也留存结果；终态记录可被随后活动记录淘汰。
    const generation = await adapter.prepareGeneration({ catalogId: RETENTION_CATALOG_ID });
    assert.ok(generation.ok);
    await generation.run.commit(generationMessages());
    manager.create({ id: 'active-blocker', surfaceId: 's-blocker', kind: 'generate' });

    const first = await adapter.prepareAction({
      name: 'refresh',
      surfaceId: SURFACE,
      sourceComponentId: 'button',
      timestamp: new Date().toISOString(),
      context: { note: '' },
      actionId: 'retention-action-1',
      sessionVersion: 1,
      surfaceRevision: 1,
      catalogHash,
    });
    assert.ok(first.ok);

    const { ctx } = createSseCapture();
    assert.throws(() => sendAgentRun(ctx, first.run, { manager, streamDelayMs: 0 }), /容量/);
    assert.equal(ctx.body, undefined, '拒绝时不得占用 SSE 响应');
    assert.equal(flowEvents.length, 0, '动作消息源不得在记录建立拒绝后启动');

    // 释放容量后，同 surface 的下一个 action 必须能拿到锁并完整提交：
    // 若拒绝路径泄漏了锁，这里的 prepareAction 会永远挂起。
    manager.transition('active-blocker', 'succeeded');
    const second = await Promise.race([
      adapter.prepareAction({
        name: 'refresh',
        surfaceId: SURFACE,
        sourceComponentId: 'button',
        timestamp: new Date().toISOString(),
        context: { note: '' },
        actionId: 'retention-action-2',
        sessionVersion: 1,
        surfaceRevision: 1,
        catalogHash,
      }),
      sleep(300).then(() => 'timeout' as const),
    ]);
    assert.notEqual(second, 'timeout', 'surface 锁未释放：prepareAction 挂起');
    assert.ok(second !== 'timeout' && second.ok);

    const capture = createSseCapture();
    const result = await sendAgentRun(capture.ctx, second.run, { manager, streamDelayMs: 0 });
    await capture.ended;

    assert.equal(result.ok, true);
    assert.ok(flowEvents.includes('action-handler-started'), '后续动作运行正常执行');
    const commit = doneCommit(capture.output());
    assert.equal(commit.runId, second.run.runId);
    assert.equal(manager.get(second.run.runId)?.commit?.surfaceRevision, commit.surfaceRevision);
  });
});

describe('运行留存不依赖 HTTP，初始化失败完整清理', () => {
  it('SDK run 拒绝另一个 manager，清理宿主资源且不占用响应', async () => {
    const adapter = createAdapter();
    const plan = await adapter.prepareGeneration({ catalogId: RETENTION_CATALOG_ID });
    assert.ok(plan.ok);
    const other = new InMemoryAgentRunManager();
    let disposed = 0;
    const { ctx } = createSseCapture();
    assert.throws(
      () =>
        sendAgentRun(ctx, plan.run, {
          manager: other,
          dispose: () => {
            disposed++;
          },
        }),
      /所有者一致/,
    );
    assert.equal(disposed, 1);
    assert.equal(ctx.body, undefined);
    assert.equal(adapter.runManager.get(plan.run.runId), undefined);
    assert.equal(other.get(plan.run.runId), undefined);
    await assert.rejects(async () => plan.run.commit(generationMessages()), /已终止/);
  });

  it('非 HTTP generation/action commit 使用同一 adapter 的记录所有者', async () => {
    const adapter = createAdapter();
    const generation = await adapter.prepareGeneration({ catalogId: RETENTION_CATALOG_ID });
    assert.ok(generation.ok);
    const commit = await generation.run.commit(generationMessages());
    assert.deepEqual(adapter.runManager.get(generation.run.runId)?.commit, commit);
    const action = await adapter.prepareAction({
      name: 'refresh',
      surfaceId: SURFACE,
      sourceComponentId: 'button',
      timestamp: new Date().toISOString(),
      context: { note: '' },
      actionId: 'neutral-record-action',
      sessionVersion: 1,
      surfaceRevision: commit.surfaceRevision,
      catalogHash,
    });
    assert.ok(action.ok);
    const messages: unknown[] = [];
    for await (const message of action.run.source) messages.push(message);
    const actionCommit = await action.run.commit(messages);
    assert.deepEqual(adapter.runManager.get(action.run.runId)?.commit, actionCommit);
    assert.equal(adapter.runManager.get(action.run.runId)?.state, 'succeeded');
  });
  it('容量拒绝调用宿主 dispose 且不启动自定义 source', async () => {
    let created = false;
    let disposed = 0;
    const manager = new InMemoryAgentRunManager({ maxRecords: 1 });
    manager.create({ id: 'occupied', surfaceId: 'occupied-surface', kind: 'generate' });
    const adapter = new AgentAdapter({
      registry,
      runManager: manager,
      createSurfaceId: () => SURFACE,
      createGenerationSource: () => {
        created = true;
        return generationMessages();
      },
    });
    const plan = await adapter.prepareGeneration({ catalogId: RETENTION_CATALOG_ID });
    assert.ok(plan.ok);
    const { ctx } = createSseCapture();
    assert.throws(
      () =>
        sendAgentRun(ctx, plan.run, {
          manager,
          dispose: () => {
            disposed++;
          },
        }),
      /容量/,
    );
    assert.equal(disposed, 1);
    assert.equal(created, false);
    assert.equal(ctx.body, undefined);
  });
  it('响应占用抛错时结束记录、释放运行与宿主资源，容量可再次使用', async () => {
    const manager = new InMemoryAgentRunManager({ maxRecords: 1 });
    const adapter = new AgentAdapter({
      registry,
      runManager: manager,
      createSurfaceId: () => SURFACE,
      createGenerationSource: () => generationMessages(),
    });
    const plan = await adapter.prepareGeneration({ catalogId: RETENTION_CATALOG_ID });
    assert.ok(plan.ok);
    let disposed = 0;
    const { ctx } = createSseCapture();
    ctx.set = () => {
      throw new Error('headers failed');
    };
    assert.throws(
      () =>
        sendAgentRun(ctx, plan.run, {
          manager,
          dispose: () => {
            disposed++;
          },
        }),
      /headers failed/,
    );
    assert.equal(disposed, 1);
    assert.equal(manager.get(plan.run.runId)?.state, 'failed');
    assert.doesNotThrow(() =>
      manager.create({ id: 'replacement', surfaceId: 'replacement-surface', kind: 'generate' }),
    );
  });
  it('flushHeaders 在 body 占用后失败时撤销流并且仅清理一次', async () => {
    let hostDisposed = 0;
    let runDisposed = 0;
    const manager = new InMemoryAgentRunManager({ maxRecords: 1 });
    const adapter = createAdapter(manager);
    const plan = await adapter.prepareGeneration({ catalogId: RETENTION_CATALOG_ID });
    assert.ok(plan.ok);
    const dispose = plan.run.dispose!.bind(plan.run);
    plan.run.dispose = () => {
      runDisposed++;
      dispose();
    };
    const { ctx } = createSseCapture();
    ctx.respond = true;
    let claimed: PassThrough | undefined;
    ctx.res.flushHeaders = () => {
      claimed = ctx.body as PassThrough;
      throw new Error('flush failed');
    };
    assert.throws(
      () =>
        sendAgentRun(ctx, plan.run, {
          dispose: () => {
            hostDisposed++;
          },
        }),
      /flush failed/,
    );
    assert.equal(hostDisposed, 1);
    assert.equal(runDisposed, 1);
    assert.equal(claimed?.destroyed, true);
    assert.equal(ctx.body, null);
    assert.equal(ctx.respond, true);
    assert.equal(manager.get(plan.run.runId)?.state, 'failed');
    assert.doesNotThrow(() => manager.create({ id: 'next', surfaceId: SURFACE, kind: 'generate' }));
  });
});
