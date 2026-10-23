import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import Koa from 'koa';
import { CatalogRegistry } from '@nexus-ui/core';
import type { CatalogDefinition, NexusSurfaceCommit } from '@nexus-ui/core';
import { AgentAdapter } from '../../src/agent/adapter';
import type { AgentMessageSource } from '../../src/agent/adapter';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';
import {
  InMemoryAgentRunManager,
  type AgentRunManager,
  type AgentRunRecord,
  type AgentRunState,
} from '../../src/agent/run-manager';
import { NEXUS_RUN_ID_HEADER } from '../../src/transport/sse';
import { createAgentRouter } from '../../src/api/routes';

/**
 * S2.5.7 入口与并发关联复核（全部经真实 HTTP 路由/真实 adapter，非存储层比较）：
 * - 非 HTTP 消费的 run 与 HTTP 路径同出 adapter 提交边界：查询 200 与两条路径
 *   的固定 commit 值一致，非 HTTP 运行纳入同一记录所有者（run-lifecycle）；
 * - 查询与容量淘汰的窗口期交错：读取先于淘汰返回时点一致的固定结果，查询
 *   到达前已淘汰则 404，都不回退同 surface 的更新提交；
 * - 查询 404/409 与 verifier 对账口径的端到端交错：响应头 ≡ event id 前缀 ≡
 *   done.runId ≡ 查询 200；失败流无 done、查询 409，对账无可确认结果；
 * - 重复标识与旧 envelope/版本/hash 混入查询关联的反例。
 * S2.5.3/.4 既有覆盖（400/403/404/409 判定顺序、baseline 两种时序、响应头
 * 占用时序、manager 层重复 ID/留存语义）由 surface-state-query.test.ts、
 * send-agent-run-response-header.test.ts、run-manager-result.test.ts 承担，
 * 本文件不重复。
 */

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../fixtures/catalog-v2',
);

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtureRoot, name), 'utf8'));
}

const formFixture = loadFixture('catalog-accept-interactive-form.json') as {
  catalog: CatalogDefinition;
};
const requestFixture = loadFixture('request-accept-with-inputs.json') as {
  editablePaths: string[];
  surface: { messages: unknown[] };
  request: {
    nexus: { inputs: { componentId: string; property: string; value: unknown }[] };
  };
};

const CATALOG = formFixture.catalog;
const CATALOG_HASH = createCatalogContractHash(CATALOG);
const SURFACE = 's-fix-1';

interface HarnessOptions {
  maxRecords?: number;
  runsAccess?: (surfaceId: string) => boolean | Promise<boolean>;
  failGenerationAfterMessages?: boolean;
}

type GetBehavior = 'plain' | 'evict-before-get' | 'evict-after-get';

/**
 * 真实 InMemory 所有者的观察窗口：委托全部接口，仅在 get 边界注入确定性的
 * 淘汰交错（以一次并发新建挤压容量、按插入序淘汰最旧终态记录，与真实并发
 * 负载同一机制），不另建平行记录所有者。
 */
class WindowedRunManager implements AgentRunManager {
  private readonly inner: InMemoryAgentRunManager;
  private triggerCount = 0;
  readonly createdIds: string[] = [];
  /** 一次性的 get 行为队列；消费完毕后回落 plain。 */
  behaviors: GetBehavior[] = [];

  constructor(options: { maxRecords?: number } = {}) {
    this.inner = new InMemoryAgentRunManager(options);
  }

  private forceEviction(): void {
    this.inner.create({
      id: `evict-trigger-${++this.triggerCount}`,
      surfaceId: 's-evict-trigger',
      kind: 'generate',
    });
  }

  create(input: { id: string; surfaceId: string; kind: 'generate' | 'action' }): AgentRunRecord {
    this.createdIds.push(input.id);
    return this.inner.create(input);
  }

  recordCommit(id: string, commit: NexusSurfaceCommit): void {
    this.inner.recordCommit(id, commit);
  }

  transition(
    id: string,
    state: Extract<AgentRunState, 'running' | 'succeeded' | 'failed' | 'canceled'>,
    message?: string,
  ): void {
    this.inner.transition(id, state, message);
  }

  get(id: string): AgentRunRecord | undefined {
    const behavior = this.behaviors.shift() ?? 'plain';
    if (behavior === 'evict-before-get') {
      this.forceEviction();
      return this.inner.get(id);
    }
    if (behavior === 'evict-after-get') {
      const record = this.inner.get(id);
      this.forceEviction();
      return record;
    }
    return this.inner.get(id);
  }

  listBySurface(surfaceId: string): readonly AgentRunRecord[] {
    return this.inner.listBySurface(surfaceId);
  }
}

const servers: Server[] = [];

interface Harness {
  baseUrl: string;
  adapter: AgentAdapter;
  manager: WindowedRunManager;
  handlerCalls: { rate: number };
}

/** 夹具消息按目标 surface 重写（仅 createSurface/updateComponents/updateDataModel）。 */
function rewriteSurfaceId(message: unknown, surfaceId: string): unknown {
  const clone = structuredClone(message) as Record<string, Record<string, unknown>>;
  for (const section of ['createSurface', 'updateComponents', 'updateDataModel']) {
    const payload = clone[section];
    if (payload && typeof payload === 'object') payload.surfaceId = surfaceId;
  }
  return clone;
}

async function buildHarness(options: HarnessOptions = {}): Promise<Harness> {
  const manager = new WindowedRunManager({ maxRecords: options.maxRecords });
  let surfaceCounter = 0;
  const adapter = new AgentAdapter({
    registry: new CatalogRegistry([structuredClone(CATALOG)]),
    runManager: manager,
    editablePaths: () => requestFixture.editablePaths,
    createSurfaceId: () => (surfaceCounter++ === 0 ? SURFACE : `${SURFACE}-${surfaceCounter}`),
    createGenerationSource: (request): AgentMessageSource =>
      // 夹具消息硬编码 s-fix-1；非首次生成重写到本次分配的 surface。
      (async function* () {
        for (const message of requestFixture.surface.messages) {
          yield rewriteSurfaceId(message, request.surfaceId);
        }
        if (options.failGenerationAfterMessages) throw new Error('生成源中途失败');
      })() as unknown as AgentMessageSource,
  });
  const handlerCalls = { rate: 0 };
  adapter.registerActionHandler(CATALOG.catalogId, 'rate', async (action) =>
    (async function* () {
      handlerCalls.rate += 1;
      yield {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: action.surfaceId,
          value: { score: 5, note: 'updated' },
        },
      };
    })(),
  );
  const router = createAgentRouter({
    adapter,
    ...(options.runsAccess === undefined
      ? {}
      : { runsAccess: (surfaceId) => options.runsAccess!(surfaceId) }),
    streamDelayMs: 0,
  });
  const app = new Koa();
  app.use(router.routes());
  app.use(router.allowedMethods());
  const server = app.listen(0, '127.0.0.1') as Server;
  servers.push(server);
  const baseUrl = await new Promise<string>((resolve) => {
    server.once('listening', () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
  return { baseUrl, adapter, manager, handlerCalls };
}

after(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (!server) break;
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

interface SseFrame {
  event: string;
  id?: string;
  data: unknown;
}

function parseSse(text: string): SseFrame[] {
  return text
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const event = /(?:^|\n)event: ([^\n]*)/.exec(block)?.[1] ?? '';
      const id = /(?:^|\n)id: ([^\n]*)/.exec(block)?.[1];
      const dataLine = /(?:^|\n)data: ([^\n]*)/.exec(block)?.[1];
      return {
        event,
        ...(id === undefined ? {} : { id }),
        data: dataLine === undefined ? undefined : (JSON.parse(dataLine) as unknown),
      };
    });
}

async function postGenerate(
  baseUrl: string,
): Promise<{ frames: SseFrame[]; runIdHeader: string | null }> {
  const response = await fetch(`${baseUrl}/api/a2ui/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ catalogId: CATALOG.catalogId }),
  });
  const text = await response.text();
  assert.equal(response.status, 200, `generate 应进入 SSE：${text}`);
  return { frames: parseSse(text), runIdHeader: response.headers.get(NEXUS_RUN_ID_HEADER) };
}

async function postRate(
  baseUrl: string,
  actionId: string,
  surfaceRevision: number,
  catalogHash: string = CATALOG_HASH,
): Promise<{ status: number; text: string }> {
  const response = await fetch(`${baseUrl}/api/a2ui/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        version: 'v0.9',
        action: {
          name: 'rate',
          surfaceId: SURFACE,
          sourceComponentId: 'rating-1',
          timestamp: '2026-10-20T00:00:00.000Z',
          context: { score: { path: '/score' } },
        },
      },
      nexus: {
        sessionVersion: 1,
        actionId,
        surfaceRevision,
        catalogHash,
        inputs: [{ componentId: 'rating-1', property: 'score', value: 4 }],
      },
    }),
  });
  const text = await response.text();
  return { status: response.status, text };
}

async function queryBaseline(
  baseUrl: string,
  surfaceId: string,
  runId: string,
): Promise<{ status: number; body: unknown }> {
  const params = new URLSearchParams({ surfaceId, runId });
  const response = await fetch(`${baseUrl}/api/a2ui/surface-state?${params}`);
  return { status: response.status, body: await response.json() };
}

function doneFrame(frames: SseFrame[]): SseFrame {
  const done = frames.find((frame) => frame.event === 'done');
  assert.ok(done, `生成流应有 done 帧：${JSON.stringify(frames)}`);
  return done;
}

/** 驱动一次真实 HTTP 生成流并返回其固定提交结果（查询 200 的同源期望）。 */
async function runGeneration(baseUrl: string): Promise<NexusSurfaceCommit> {
  const { frames } = await postGenerate(baseUrl);
  return doneFrame(frames).data as NexusSurfaceCommit;
}

describe('S2.5.7 非 HTTP 与 HTTP 固定结果同源（真实入口对照）', () => {
  it('HTTP done、真实查询与非 HTTP commit 三方同值；非 HTTP 运行纳入同一记录所有者', async () => {
    const { baseUrl, adapter, manager } = await buildHarness({ runsAccess: () => true });

    // HTTP 路径：真实生成流 + 真实查询路由。
    const httpCommit = await runGeneration(baseUrl);
    const httpQuery = await queryBaseline(baseUrl, httpCommit.surfaceId, httpCommit.runId);
    assert.equal(httpQuery.status, 200);
    assert.deepEqual(httpQuery.body, httpCommit, '查询 200 与 HTTP done 固定结果一致');

    // 非 HTTP 路径：同一 adapter 直接消费 run 并显式提交。
    const plan = await adapter.prepareGeneration({
      message: '非 HTTP 生成',
      catalogId: CATALOG.catalogId,
    });
    assert.ok(plan.ok);
    const messages: unknown[] = [];
    for await (const message of plan.run.source) messages.push(message);
    const directCommit = await plan.run.commit(messages);
    assert.ok(
      manager.createdIds.includes(directCommit.runId),
      '非 HTTP 消费的 run 已纳入 manager（run-lifecycle）',
    );
    assert.equal(manager.get(directCommit.runId)?.state, 'succeeded');
    const directQuery = await queryBaseline(baseUrl, directCommit.surfaceId, directCommit.runId);
    assert.equal(directQuery.status, 200);
    assert.deepEqual(
      directQuery.body,
      directCommit,
      '查询返回与非 HTTP commit 同值（同出 adapter 提交边界）',
    );
    assert.notEqual(directCommit.runId, httpCommit.runId, '一次 run 只有一个不可变 ID');

    // 非 HTTP action 同样经真实查询路由可对账。
    const action = await adapter.prepareAction({
      name: 'rate',
      surfaceId: directCommit.surfaceId,
      sourceComponentId: 'rating-1',
      timestamp: new Date().toISOString(),
      context: { score: 3 },
      actionId: 'direct-action-1',
      sessionVersion: 1,
      surfaceRevision: directCommit.surfaceRevision,
      catalogHash: CATALOG_HASH,
      inputs: requestFixture.request.nexus.inputs,
    });
    assert.ok(action.ok);
    const actionMessages: unknown[] = [];
    for await (const message of action.run.source) actionMessages.push(message);
    const actionCommit = await action.run.commit(actionMessages);
    const actionQuery = await queryBaseline(baseUrl, actionCommit.surfaceId, actionCommit.runId);
    assert.equal(actionQuery.status, 200);
    assert.deepEqual(actionQuery.body, actionCommit);
    assert.equal(actionCommit.surfaceRevision, directCommit.surfaceRevision + 1);
  });

  it('源 EOF 但未显式提交：真实查询 409（正常 EOF 不是终态），显式 commit 后同 run 200', async () => {
    const { baseUrl, adapter, manager } = await buildHarness({ runsAccess: () => true });

    // S3.2 迁移：调度任务自动消费 source 并自动提交，「EOF 后未提交」改由排队中
    // 无提交边界的记录承载同一证伪点——若无提交边界也返回 200 即为缺陷。
    manager.create({ id: 'reserved-queued-run', surfaceId: SURFACE, kind: 'generate' });
    const mid = await queryBaseline(baseUrl, SURFACE, 'reserved-queued-run');
    assert.equal(mid.status, 409);
    assert.deepEqual(mid.body, {
      error: 'SURFACE_STATE_COMMIT_UNAVAILABLE',
      message: '运行存在但尚无可确认的 UI 提交结果',
    });

    // S3.2 迁移：提交边界由调度任务在完整最终校验后自动建立（run.result 终态），
    // 不再走手工 collect + commit。
    const plan = await adapter.prepareGeneration({
      message: 'EOF 非终态',
      catalogId: CATALOG.catalogId,
    });
    assert.ok(plan.ok, 'S3.2：入队即接受');
    const outcome = await plan.run.result;
    assert.equal(outcome.terminal, 'succeeded');
    assert.equal(outcome.commitState, 'committed');
    const commit = outcome.commit;
    const after = await queryBaseline(baseUrl, commit.surfaceId, commit.runId);
    assert.equal(after.status, 200);
    assert.deepEqual(after.body, commit);
  });
});

describe('S2.5.7 查询与容量淘汰的窗口期交错', () => {
  it('读取先于淘汰（evict-after-get）：返回被查运行自己的固定结果，不返回同 surface 更新提交', async () => {
    const { baseUrl, manager } = await buildHarness({ runsAccess: () => true, maxRecords: 3 });
    const first = await runGeneration(baseUrl); // A：最旧终态记录
    manager.create({ id: 'window-placeholder', surfaceId: first.surfaceId, kind: 'generate' });
    manager.transition('window-placeholder', 'succeeded');
    const concurrent = await postRate(baseUrl, 'window-c', 1); // C：同 surface rev 2
    assert.match(concurrent.text, /event: done/);
    const commitC = doneFrame(parseSse(concurrent.text)).data as NexusSurfaceCommit;
    assert.equal(commitC.surfaceRevision, 2);

    // 证伪锚点：若查询回退最新快照（或淘汰后重读），这里会返回 C 的 rev 2。
    manager.behaviors = ['evict-after-get'];
    const during = await queryBaseline(baseUrl, first.surfaceId, first.runId);
    assert.equal(during.status, 200, '读取先于淘汰：返回时点一致的固定结果');
    assert.deepEqual(during.body, first, '返回被查运行自己的 revision，不是其他运行的新提交');

    // 窗口关闭：记录已被淘汰，同 run 再查明确不可用；更新提交仍可查（对照）。
    const afterWindow = await queryBaseline(baseUrl, first.surfaceId, first.runId);
    assert.equal(afterWindow.status, 404);
    assert.deepEqual(afterWindow.body, {
      error: 'SURFACE_STATE_NOT_FOUND',
      message: '指定运行的提交结果不存在、surface 不匹配或已淘汰',
    });
    const survivor = await queryBaseline(baseUrl, commitC.surfaceId, commitC.runId);
    assert.equal(survivor.status, 200);
    assert.deepEqual(survivor.body, commitC);
  });

  it('查询到达前已淘汰（evict-before-get）：404，不回退同 surface 更新提交', async () => {
    const { baseUrl, manager } = await buildHarness({ runsAccess: () => true, maxRecords: 3 });
    const first = await runGeneration(baseUrl);
    manager.create({ id: 'window-placeholder-2', surfaceId: first.surfaceId, kind: 'generate' });
    manager.transition('window-placeholder-2', 'succeeded');
    const concurrent = await postRate(baseUrl, 'window-d', 1);
    assert.match(concurrent.text, /event: done/);
    const commitC = doneFrame(parseSse(concurrent.text)).data as NexusSurfaceCommit;

    // 证伪锚点：若记录缺失时回退最新快照或报 5xx，这里不会是标准 404。
    manager.behaviors = ['evict-before-get'];
    const evicted = await queryBaseline(baseUrl, first.surfaceId, first.runId);
    assert.equal(evicted.status, 404);
    assert.deepEqual(evicted.body, {
      error: 'SURFACE_STATE_NOT_FOUND',
      message: '指定运行的提交结果不存在、surface 不匹配或已淘汰',
    });
    const survivor = await queryBaseline(baseUrl, commitC.surfaceId, commitC.runId);
    assert.equal(survivor.status, 200);
    assert.deepEqual(survivor.body, commitC, '404 只针对被淘汰目标，不影响其他可查运行');
  });
});

describe('S2.5.7 查询路由与 verifier 对账口径的端到端交错', () => {
  it('成功流全链关联：X-Nexus-Run-Id ≡ event id 前缀 ≡ done.runId ≡ 查询 200 固定结果', async () => {
    const { baseUrl } = await buildHarness({ runsAccess: () => true });
    const { frames, runIdHeader } = await postGenerate(baseUrl);
    assert.ok(runIdHeader, 'SSE 响应被占用即带运行标识头');
    for (const frame of frames) {
      assert.ok(
        frame.id !== undefined && frame.id.startsWith(`${runIdHeader}:`),
        '每个 event id 都以本次 runId 为前缀',
      );
    }
    const done = doneFrame(frames);
    const commit = done.data as NexusSurfaceCommit;
    assert.equal(commit.runId, runIdHeader, 'done.runId ≡ 响应头');

    const { status, body } = await queryBaseline(baseUrl, commit.surfaceId, commit.runId);
    assert.equal(status, 200);
    assert.deepEqual(body, commit, '查询 200 ≡ done 固定结果（同出 adapter 提交边界）');
  });

  it('失败流（error 无 done）：对账链无固定结果，查询 409 明确不可用，报告不得虚报通过', async () => {
    const { baseUrl, manager } = await buildHarness({
      runsAccess: () => true,
      failGenerationAfterMessages: true,
    });
    const { frames, runIdHeader } = await postGenerate(baseUrl);
    assert.ok(runIdHeader);
    assert.ok(
      frames.some((frame) => frame.event === 'error'),
      '应有 error 帧',
    );
    assert.ok(!frames.some((frame) => frame.event === 'done'), '失败流没有 done：对账基准不存在');
    assert.ok(
      frames.every((frame) => frame.id === undefined || frame.id.startsWith(`${runIdHeader}:`)),
      '失败流的事件 id 仍与本次 runId 关联',
    );
    const failedRunId = manager.createdIds[0];
    assert.equal(failedRunId, runIdHeader, '记录 id ≡ 响应头（≡ 链在失败路径同样成立）');

    // 证伪锚点：若失败运行被事后拼装可用基准，这里会 200 而非 409。
    const { status, body } = await queryBaseline(baseUrl, SURFACE, failedRunId);
    assert.equal(status, 409);
    assert.deepEqual(body, {
      error: 'SURFACE_STATE_COMMIT_UNAVAILABLE',
      message: '运行存在但尚无可确认的 UI 提交结果',
    });
  });
});

describe('S2.5.7 重复标识与旧 envelope 混入查询关联的反例', () => {
  it('事件 id 全值不是查询键：以 <runId>:<seq> 查询 404，裸 runId 查询 200', async () => {
    const { baseUrl } = await buildHarness({ runsAccess: () => true });
    const { frames, runIdHeader } = await postGenerate(baseUrl);
    const done = doneFrame(frames);
    assert.ok(runIdHeader);
    const fullEventId = done.id;
    assert.ok(
      fullEventId && fullEventId.startsWith(`${runIdHeader}:`),
      '前置：done 有前缀化事件 id',
    );

    // 证伪锚点：若查询键按「前缀截断/包含」解释事件 id，或记录以事件 id 为键，
    // 这里会 200——消费者必须使用响应头/done 的裸 runId（SPEC §5.3 口径）。
    const wrong = await queryBaseline(baseUrl, SURFACE, fullEventId);
    assert.equal(wrong.status, 404);
    assert.deepEqual(wrong.body, {
      error: 'SURFACE_STATE_NOT_FOUND',
      message: '指定运行的提交结果不存在、surface 不匹配或已淘汰',
    });
    const right = await queryBaseline(baseUrl, SURFACE, runIdHeader);
    assert.equal(right.status, 200);
    assert.equal((right.body as NexusSurfaceCommit).runId, runIdHeader);
  });

  it('旧 envelope（旧 revision/错 catalogHash）被拒后无查询记录，先前固定结果不受影响', async () => {
    const { baseUrl, handlerCalls } = await buildHarness({ runsAccess: () => true });
    const commit = await runGeneration(baseUrl);

    // S3.2 迁移：envelope 准入移入调度任务，拒绝从同步 400 变为 200 SSE + error
    // 事件（runCode RUN_ADMISSION_REJECTED / commitState notCommitted），且留下
    // failed 运行记录；actionId 仍不是运行标识（按 actionId 查询 404）。
    const stale = await postRate(baseUrl, 'stale-envelope-1', 2);
    assert.equal(stale.status, 200, '旧 revision envelope 仍必须被拒（S3.2 调度内失败）');
    assert.doesNotMatch(stale.text, /event: done/);
    const staleError = parseSse(stale.text).find((frame) => frame.event === 'error');
    assert.ok(staleError, '旧 revision envelope 以 error 事件终态');
    assert.equal((staleError.data as { runCode?: string }).runCode, 'RUN_ADMISSION_REJECTED');
    assert.equal((staleError.data as { commitState?: string }).commitState, 'notCommitted');

    const wrongHash = await postRate(baseUrl, 'wrong-hash-1', 1, `sha256:${'0'.repeat(64)}`);
    assert.equal(wrongHash.status, 200, '错误 catalogHash envelope 仍必须被拒（S3.2 调度内失败）');
    assert.doesNotMatch(wrongHash.text, /event: done/);
    const wrongHashError = parseSse(wrongHash.text).find((frame) => frame.event === 'error');
    assert.ok(wrongHashError, '错误 catalogHash envelope 以 error 事件终态');
    assert.equal((wrongHashError.data as { runCode?: string }).runCode, 'RUN_ADMISSION_REJECTED');
    assert.equal(handlerCalls.rate, 0, '旧 envelope 拒绝时 handler 未调用');

    // 证伪锚点：查询键回退接受 actionId 的话，这里会查到可对账结果。
    for (const actionId of ['stale-envelope-1', 'wrong-hash-1']) {
      const ghost = await queryBaseline(baseUrl, SURFACE, actionId);
      assert.equal(
        ghost.status,
        404,
        'actionId 不是运行标识，被拒 envelope 的 actionId 无查询记录',
      );
    }
    // S3.2 迁移：被拒 envelope 留有 failed 运行记录——按真实 runId 查询 409
    // （有记录无结果），不是 404。
    for (const frame of [staleError, wrongHashError]) {
      const rejectedRunId = (frame!.data as { runId?: string }).runId;
      assert.ok(typeof rejectedRunId === 'string' && rejectedRunId !== '', 'error 载荷携带 runId');
      const failed = await queryBaseline(baseUrl, SURFACE, rejectedRunId);
      assert.equal(failed.status, 409, 'failed 运行有记录无结果 → 409');
      assert.deepEqual(failed.body, {
        error: 'SURFACE_STATE_COMMIT_UNAVAILABLE',
        message: '运行存在但尚无可确认的 UI 提交结果',
      });
    }
    const intact = await queryBaseline(baseUrl, SURFACE, commit.runId);
    assert.equal(intact.status, 200);
    assert.deepEqual(intact.body, commit, '先前固定结果不受被拒 envelope 影响');
  });
});
