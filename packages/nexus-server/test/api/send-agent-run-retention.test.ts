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
import type { AgentMessageSource, NexusRunDiagnostic } from '../../src/agent/adapter';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';
import type { AgentRunManager } from '../../src/agent/run-manager';
import { InMemoryAgentRunManager } from '../../src/agent/run-manager';
import { sendAgentRun } from '../../src/api/send-messages';

/**
 * S2.5.2 共用运行所有者的留存接线与拒绝路径（S3.2 迁移后语义；留存语义以 S3.3.2 为准）：
 * - 调度任务自动提交，recordCommit 在成功 done 写出之前留存固定结果；
 *   S3.3.2 起留存失败保留成功事实（运行 succeeded、done 照发、诊断 record-commit）；
 * - 记录建立（含容量拒绝）随 enqueue 前移到 prepare 阶段：拒绝返回 ok:false 计划，
 *   不产生 run、不占用 SSE 响应、不启动生成源/动作消息源；
 * - 响应占用失败以 promise 拒绝暴露，发送层以 run.cancel() 终止排队中的运行。
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

function createAdapter(
  runManager?: AgentRunManager,
  onRunDiagnostic?: (diagnostic: NexusRunDiagnostic) => void,
): AgentAdapter {
  const adapter = new AgentAdapter({
    registry,
    runManager,
    ...(onRunDiagnostic ? { onRunDiagnostic } : {}),
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

  // S3.3.2 语义升级（原「留存失败不得发布成功 done，运行记录无可用基准」）：
  // 以 S3.1 锁定的 §6.3 矩阵为准——store 确认提交后，recordCommit 失败不改写
  // 已发布的成功事实：运行 succeeded、done 照发（载荷为固定 commit）、记录无
  // commit（按 run 查询 409）、失败经 onRunDiagnostic(stage 'record-commit') 报告。
  it('留存失败保留成功事实并经诊断报告', async () => {
    flowEvents.length = 0;
    const diagnostics: NexusRunDiagnostic[] = [];
    const manager = new SpyRunManager();
    manager.onRecordCommit = () => {
      throw new Error('留存存储不可用');
    };
    const adapter = createAdapter(manager, (diagnostic) => diagnostics.push(diagnostic));
    const plan = await adapter.prepareGeneration({ catalogId: RETENTION_CATALOG_ID });
    assert.ok(plan.ok);

    const { ctx, output, ended } = createSseCapture();
    const result = await sendAgentRun(ctx, plan.run, { manager, streamDelayMs: 0 });
    await ended;

    // 成功事实保留：done 照发且载荷为本次运行的固定 commit。
    assert.equal(result.ok, true);
    const commit = doneCommit(output());
    assert.equal(commit.runId, plan.run.runId);
    assert.equal(commit.surfaceId, SURFACE);
    assert.doesNotMatch(output(), /event: error/, '留存失败不得改写为错误终态');
    // 留存失败：记录无可用提交基准（按 run 查询 409），运行记录仍 succeeded。
    const record = manager.get(plan.run.runId);
    assert.equal(record?.commit, undefined, '留存失败不得留下可用提交基准');
    assert.equal(record?.state, 'succeeded');
    // 失败经诊断面报告，不改写终态。
    assert.ok(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.stage === 'record-commit' && /留存存储不可用/.test(diagnostic.message),
      ),
      `应报告 record-commit 诊断：${JSON.stringify(diagnostics)}`,
    );
    assert.ok(flowEvents.includes('generate-source-started'));
  });

  it('记录建立拒绝发生在占用响应之前：不泄漏响应、不启动生成源', async () => {
    flowEvents.length = 0;
    const manager = new InMemoryAgentRunManager({ maxRecords: 1 });
    // 占满容量的活动记录：永不迁移状态，受淘汰保护。
    manager.create({ id: 'active-blocker', surfaceId: 's-blocker', kind: 'generate' });

    const adapter = createAdapter(manager);
    const { ctx } = createSseCapture();
    // S3.2 迁移：记录建立（含容量拒绝）随 enqueue 前移到 prepare 阶段，拒绝返回
    // ok:false 计划（无 run 可发送），不再进入发送层。
    const plan = await adapter.prepareGeneration({ catalogId: RETENTION_CATALOG_ID });
    assert.ok(!plan.ok && plan.code === 'capacity-limit' && /容量/.test(plan.message));
    assert.equal(ctx.body, undefined, '拒绝时不得占用 SSE 响应');
    assert.equal(flowEvents.length, 0, '生成源不得在记录建立拒绝后启动');
  });

  it('动作运行被容量拒绝后释放 surface 锁，后续运行可正常提交', async () => {
    flowEvents.length = 0;
    const manager = new InMemoryAgentRunManager({ maxRecords: 1 });
    const adapter = createAdapter(manager);
    // 非 HTTP 提交也留存结果；终态记录可被随后活动记录淘汰。
    // S3.2 迁移：非 HTTP 提交由调度任务自动完成，不再手工数组直提。
    const generation = await adapter.prepareGeneration({ catalogId: RETENTION_CATALOG_ID });
    assert.ok(generation.ok);
    const generationOutcome = await generation.run.result;
    assert.equal(generationOutcome.terminal, 'succeeded');
    manager.create({ id: 'active-blocker', surfaceId: 's-blocker', kind: 'generate' });

    // S3.2 迁移：记录容量拒绝同样前移到 prepareAction 入队段（原在 sendAgentRun
    // 同步段），拒绝计划不产生 run，也不启动动作 handler。
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
    assert.ok(!first.ok && /容量/.test(first.message));
    assert.ok(!flowEvents.includes('action-handler-started'), '动作消息源不得在记录建立拒绝后启动');

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
  it('SDK run 拒绝另一个 manager：不占用响应，运行仍归属原所有者', async () => {
    const adapter = createAdapter();
    const plan = await adapter.prepareGeneration({ catalogId: RETENTION_CATALOG_ID });
    assert.ok(plan.ok);
    const other = new InMemoryAgentRunManager();
    const { ctx } = createSseCapture();
    assert.throws(() => sendAgentRun(ctx, plan.run, { manager: other }), /所有者一致/);
    // S3.2 迁移：记录自 enqueue 起归属 adapter 所有者，所有者不匹配的发送只在
    // 占用响应前的同步段拒绝——另一个 manager 永远拿不到记录，运行本身不受影响
    // （原「清理记录 + 宿主 dispose + 运行终止」是发送层创建记录时代的清理契约）。
    assert.equal(ctx.body, undefined);
    assert.equal(other.get(plan.run.runId), undefined);
    const outcome = await plan.run.result;
    assert.equal(outcome.terminal, 'succeeded');
    assert.equal(adapter.runManager.get(plan.run.runId)?.state, 'succeeded');
  });

  it('非 HTTP generation/action commit 使用同一 adapter 的记录所有者', async () => {
    const adapter = createAdapter();
    const generation = await adapter.prepareGeneration({ catalogId: RETENTION_CATALOG_ID });
    assert.ok(generation.ok);
    // S3.2 迁移：非 HTTP 提交由调度任务自动完成；留存结果即运行终态 commit。
    const outcome = await generation.run.result;
    assert.equal(outcome.terminal, 'succeeded');
    const commit = outcome.commit;
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
    const actionOutcome = await action.run.result;
    assert.equal(actionOutcome.terminal, 'succeeded');
    assert.deepEqual(adapter.runManager.get(action.run.runId)?.commit, actionOutcome.commit);
    assert.equal(adapter.runManager.get(action.run.runId)?.state, 'succeeded');
  });
  it('容量拒绝发生在 enqueue：不启动自定义 source', async () => {
    let created = false;
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
    // S3.2 迁移：记录容量拒绝随 enqueue 前移到 prepare 阶段（返回 ok:false 计划，
    // 无 run 可发送）；原「sendAgentRun 同步抛错并回调宿主 dispose」随之消失。
    const plan = await adapter.prepareGeneration({ catalogId: RETENTION_CATALOG_ID });
    assert.ok(!plan.ok && plan.code === 'capacity-limit' && /容量/.test(plan.message));
    assert.equal(created, false, '自定义生成源不得在容量拒绝后构造');
  });
  it('响应占用抛错时取消运行、回调宿主 dispose，容量可再次使用', async () => {
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
    // S3.2 迁移：占用失败保持 S2 同步抛错语义（DESIGN D3），排队中的运行
    // 以取消终态写回记录，容量随终态释放。
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
    // 取消收敛是任务侧落账：句柄终态先行，记录随终态写 canceled。
    assert.equal((await plan.run.result).terminal, 'canceled');
    assert.equal(manager.get(plan.run.runId)?.state, 'canceled');
    assert.doesNotThrow(() =>
      manager.create({ id: 'replacement', surfaceId: 'replacement-surface', kind: 'generate' }),
    );
  });
  it('flushHeaders 在 body 占用后失败时撤销流并且仅清理一次', async () => {
    let hostDisposed = 0;
    let runCanceled = 0;
    const manager = new InMemoryAgentRunManager({ maxRecords: 1 });
    const adapter = createAdapter(manager);
    const plan = await adapter.prepareGeneration({ catalogId: RETENTION_CATALOG_ID });
    assert.ok(plan.ok);
    // S3.2 迁移：占用失败时发送层以 run.cancel() 收敛运行且恰好一次；
    // 占用错误保持 S2 同步抛错语义。
    const cancel = plan.run.cancel.bind(plan.run);
    plan.run.cancel = () => {
      runCanceled++;
      cancel();
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
    assert.equal(runCanceled, 1);
    assert.equal((await plan.run.result).terminal, 'canceled');
    assert.equal(claimed?.destroyed, true);
    assert.equal(ctx.body, null);
    assert.equal(ctx.respond, true);
    assert.equal(manager.get(plan.run.runId)?.state, 'canceled');
    assert.doesNotThrow(() => manager.create({ id: 'next', surfaceId: SURFACE, kind: 'generate' }));
  });
});
