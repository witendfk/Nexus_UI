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
import { InMemoryAgentRunManager, type AgentRunRecord } from '../../src/agent/run-manager';
import { createAgentRouter } from '../../src/api/routes';

/**
 * S2.5.3 按 run 查询与访问控制（GET /api/a2ui/surface-state）：
 * - 缺失/空 surfaceId 或 runId → 400；合法参数先鉴权后查记录：
 *   runsAccess 未配置/拒绝均为 403，不泄露记录存在性；
 * - 记录不存在、surface 不匹配或已淘汰 → 404（不回退最新快照）；
 * - 存在但没有可确认提交 → 409；200 只返回该记录的固定结果。
 * 全部经真实 Koa HTTP 服务与 fetch 验证。
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
    message: { action: { name: string; surfaceId: string; sourceComponentId: string } };
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

class RecordingRunManager extends InMemoryAgentRunManager {
  readonly getCalls: string[] = [];
  readonly createdIds: string[] = [];

  create(input: { id: string; surfaceId: string; kind: 'generate' | 'action' }): AgentRunRecord {
    this.createdIds.push(input.id);
    return super.create(input);
  }

  get(id: string): AgentRunRecord | undefined {
    this.getCalls.push(id);
    return super.get(id);
  }
}

const servers: Server[] = [];

interface Harness {
  baseUrl: string;
  adapter: AgentAdapter;
  manager: RecordingRunManager;
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
  const manager = new RecordingRunManager({ maxRecords: options.maxRecords });
  let surfaceCounter = 0;
  const adapter = new AgentAdapter({
    registry: new CatalogRegistry([structuredClone(CATALOG)]),
    runManager: manager,
    editablePaths: () => requestFixture.editablePaths,
    createSurfaceId: () => (surfaceCounter++ === 0 ? SURFACE : `${SURFACE}-${surfaceCounter}`),
    createGenerationSource: (request): AgentMessageSource =>
      // 夹具消息硬编码 s-fix-1；非首次生成重写到本次分配的 surface，
      // 避免多次生成重复推进同一快照。
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

async function postGenerate(baseUrl: string): Promise<SseFrame[]> {
  const response = await fetch(`${baseUrl}/api/a2ui/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ catalogId: CATALOG.catalogId }),
  });
  const text = await response.text();
  assert.equal(response.status, 200, `generate 应进入 SSE：${text}`);
  return parseSse(text);
}

async function postRate(
  baseUrl: string,
  actionId: string,
  surfaceRevision: number,
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
        catalogHash: CATALOG_HASH,
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

/** 驱动一次真实生成流并返回其固定提交结果（done 载荷即查询的 200 期望）。 */
async function runGeneration(baseUrl: string): Promise<NexusSurfaceCommit> {
  const frames = await postGenerate(baseUrl);
  const done = frames.find((frame) => frame.event === 'done');
  assert.ok(done, `生成流应有 done 帧：${JSON.stringify(frames)}`);
  return done.data as NexusSurfaceCommit;
}

describe('S2.5.3 查询参数校验（400）', () => {
  for (const [label, search] of [
    ['缺失 surfaceId', 'runId=r-1'],
    ['缺失 runId', 'surfaceId=s-1'],
    ['空 surfaceId', 'surfaceId=&runId=r-1'],
    ['空 runId', 'surfaceId=s-1&runId='],
  ] as readonly [string, string][]) {
    it(`${label} 返回 400，且参数校验先于准入（未配置 runsAccess 也是 400）`, async () => {
      const { baseUrl } = await buildHarness();
      const response = await fetch(`${baseUrl}/api/a2ui/surface-state?${search}`);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        error: 'INVALID_REQUEST',
        message: 'surfaceId 与 runId 都必须是非空字符串',
      });
    });
  }
});

describe('S2.5.3 宿主 runsAccess 准入（403）', () => {
  it('未配置 runsAccess 一律 403，且不泄露记录存在性', async () => {
    const { baseUrl } = await buildHarness();
    const commit = await runGeneration(baseUrl);
    for (const runId of [commit.runId, 'never-created-run']) {
      const { status, body } = await queryBaseline(baseUrl, SURFACE, runId);
      assert.equal(status, 403);
      assert.deepEqual(body, {
        error: 'RUNS_ACCESS_NOT_CONFIGURED',
        message: '宿主必须配置 runsAccess 准入回调后，才能查询运行提交结果',
      });
    }
  });

  it('runsAccess 拒绝时 403（同步/异步一致），且先鉴权后查记录', async () => {
    for (const access of [() => false, () => Promise.resolve(false)] as readonly (() =>
      | boolean
      | Promise<boolean>)[]) {
      const { baseUrl, manager } = await buildHarness({ runsAccess: access });
      const commit = await runGeneration(baseUrl);
      for (const runId of [commit.runId, 'never-created-run']) {
        const { status, body } = await queryBaseline(baseUrl, SURFACE, runId);
        assert.equal(status, 403);
        assert.deepEqual(body, {
          error: 'RUNS_ACCESS_DENIED',
          message: '该 surface 的运行提交结果查询被宿主准入策略拒绝',
        });
      }
      assert.deepEqual(
        manager.getCalls,
        [],
        '准入拒绝时不得查询运行记录（先鉴权后查记录，不泄露存在性）',
      );
    }
  });
});

describe('S2.5.3 记录不可用（404/409）', () => {
  it('不存在的 runId 与跨 surface 的既有 runId 返回相同 404（不泄露存在性）', async () => {
    const { baseUrl } = await buildHarness({ runsAccess: () => true });
    const commit = await runGeneration(baseUrl);
    const missing = await queryBaseline(baseUrl, SURFACE, 'never-created-run');
    const crossSurface = await queryBaseline(baseUrl, 's-other-surface', commit.runId);
    assert.equal(missing.status, 404);
    assert.equal(crossSurface.status, 404);
    assert.deepEqual(missing.body, crossSurface.body);
    assert.deepEqual(missing.body, {
      error: 'SURFACE_STATE_NOT_FOUND',
      message: '指定运行的提交结果不存在、surface 不匹配或已淘汰',
    });
  });

  it('记录容量淘汰后明确不可用：404，不回退该 surface 的最新快照', async () => {
    const { baseUrl, manager } = await buildHarness({ runsAccess: () => true, maxRecords: 2 });
    const first = await runGeneration(baseUrl); // s-fix-1 revision 1
    await runGeneration(baseUrl); // second surface，占位
    // 第三个生成触发淘汰最旧终态记录（first）
    const third = await runGeneration(baseUrl);
    // 被淘汰运行的 surface 仍存在并被后续 action 推进到新 revision
    // （store 派发实例级单调 revision，不与旧基准重号）
    const action = await postRate(baseUrl, 'after-eviction', 1);
    assert.match(action.text, /event: done/);
    const actionCommit = parseSse(action.text).find((frame) => frame.event === 'done')
      ?.data as NexusSurfaceCommit;
    assert.ok(actionCommit && actionCommit.surfaceRevision > 1);
    const concurrentRunId = manager.createdIds[manager.createdIds.length - 1];
    const latest = await queryBaseline(baseUrl, SURFACE, concurrentRunId);
    assert.equal(latest.status, 200);
    assert.deepEqual(
      latest.body,
      actionCommit,
      '对照：同 surface 存在更新的可查询提交（回退最新快照会返回它）',
    );

    const evicted = await queryBaseline(baseUrl, SURFACE, first.runId);
    assert.equal(evicted.status, 404, '已淘汰记录必须 404');
    assert.deepEqual(evicted.body, {
      error: 'SURFACE_STATE_NOT_FOUND',
      message: '指定运行的提交结果不存在、surface 不匹配或已淘汰',
    });
    // 对照：未被淘汰的记录仍可查询（同一服务）
    const survivor = await queryBaseline(baseUrl, `${SURFACE}-3`, third.runId);
    assert.equal(survivor.status, 200);
    assert.equal((survivor.body as NexusSurfaceCommit).runId, third.runId);
  });

  it('运行失败没有可确认提交 → 409；排队中尚未提交 → 409', async () => {
    const { baseUrl, manager } = await buildHarness({
      runsAccess: () => true,
      failGenerationAfterMessages: true,
    });
    const frames = await postGenerate(baseUrl);
    assert.match(frames.map((frame) => frame.event).join(','), /error/);
    const failedRunId = manager.createdIds[0];
    const failed = await queryBaseline(baseUrl, SURFACE, failedRunId);
    assert.equal(failed.status, 409);
    assert.deepEqual(failed.body, {
      error: 'SURFACE_STATE_COMMIT_UNAVAILABLE',
      message: '运行存在但尚无可确认的 UI 提交结果',
    });

    manager.create({ id: 'reserved-queued-run', surfaceId: SURFACE, kind: 'generate' });
    const queued = await queryBaseline(baseUrl, SURFACE, 'reserved-queued-run');
    assert.equal(queued.status, 409);
  });
});

describe('S2.5.3 查询返回固定提交结果（200）', () => {
  it('200 只读该记录的固定结果，与成功 done 载荷一致', async () => {
    const { baseUrl } = await buildHarness({ runsAccess: () => true });
    const commit = await runGeneration(baseUrl);
    const { status, body } = await queryBaseline(baseUrl, SURFACE, commit.runId);
    assert.equal(status, 200);
    assert.deepEqual(body, {
      sessionVersion: 1,
      runId: commit.runId,
      surfaceId: SURFACE,
      catalogId: CATALOG.catalogId,
      contractVersion: 2,
      catalogHash: CATALOG_HASH,
      surfaceRevision: 1,
    });
    // 后续 action 提交不改变历史结果
    const action = await postRate(baseUrl, 'after-query', 1);
    assert.match(action.text, /event: done/);
    const again = await queryBaseline(baseUrl, SURFACE, commit.runId);
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, body, '历史结果不受后续提交影响');
  });
});

interface BaselineFixture {
  id: string;
  reason: string;
  renderedRunId: string;
  queryAfterRunId: string;
  query: { surfaceId: string; runId: string };
  expectedLatestRevisionAtQuery: number;
  expectedResponse: { status: 200; body: NexusSurfaceCommit };
  expectedNextAction: {
    surfaceRevision: number;
    serverRevision: number;
    decision: string;
    handlerCalls: number;
    snapshotUnchanged: boolean;
  };
}

describe('S2.5.3 baseline 时序夹具经真实 HTTP 查询路由验证', () => {
  for (const filename of [
    'baseline-query-after-concurrent-commit.json',
    'baseline-query-before-concurrent-commit.json',
  ]) {
    it(`查询 A 恒返 A 的固定旧 revision：${filename}`, async () => {
      const fixture = loadFixture(filename) as BaselineFixture;
      const { baseUrl, adapter, handlerCalls } = await buildHarness({ runsAccess: () => true });

      // run A（渲染运行）：真实 HTTP 生成，提交 revision 1
      const rendered = await runGeneration(baseUrl);
      assert.equal(rendered.surfaceRevision, 1);
      assert.equal(rendered.surfaceId, fixture.query.surfaceId);

      const latestBeforeQuery = await adapter.describeSurfaceContract(SURFACE);
      assert.equal(latestBeforeQuery?.surfaceRevision, 1);

      const beforeTiming = fixture.queryAfterRunId === fixture.renderedRunId;
      if (beforeTiming) {
        // 查询前时序：查询发生在并发提交之前，此时最新即 revision 1
        assert.equal(
          latestBeforeQuery?.surfaceRevision,
          fixture.expectedLatestRevisionAtQuery,
          '查询时序位置与服务端最新 revision 一致',
        );
        const first = await queryBaseline(baseUrl, SURFACE, rendered.runId);
        assert.equal(first.status, fixture.expectedResponse.status);
        assert.deepEqual(first.body, {
          ...fixture.expectedResponse.body,
          // 夹具的 runId 是逻辑角色标签（run-rendered）；真实 HTTP 运行映射到实际 UUID。
          runId: rendered.runId,
          catalogHash: CATALOG_HASH,
        });
      }

      // 并发 run B：真实 HTTP action 提交 revision 2
      const concurrent = await postRate(baseUrl, 'run-concurrent', 1);
      assert.match(concurrent.text, /event: done/);
      const latestAfterConcurrent = await adapter.describeSurfaceContract(SURFACE);
      assert.equal(
        latestAfterConcurrent?.surfaceRevision,
        fixture.expectedNextAction.serverRevision,
        '并发提交推进服务端快照',
      );
      if (!beforeTiming) {
        // 查询后时序：并发提交先于查询发生
        assert.equal(
          latestAfterConcurrent?.surfaceRevision,
          fixture.expectedLatestRevisionAtQuery,
          '查询时序位置与服务端最新 revision 一致',
        );
      }

      // 查询 A：无论时序先后，都返回 A 的固定旧 revision
      const result = await queryBaseline(baseUrl, SURFACE, rendered.runId);
      assert.equal(result.status, fixture.expectedResponse.status);
      assert.deepEqual(result.body, {
        ...fixture.expectedResponse.body,
        runId: rendered.runId,
        catalogHash: CATALOG_HASH,
      });

      // 旧视图携带旧 revision 的下一枚 action 被权威准入拒绝，handler 未调用
      const handlerCallsBefore = handlerCalls.rate;
      const stale = await postRate(
        baseUrl,
        'stale-next-action',
        fixture.expectedNextAction.surfaceRevision,
      );
      assert.equal(stale.status, 400, '旧 revision 的 action 必须被拒');
      assert.doesNotMatch(stale.text, /event: done/);
      assert.equal(handlerCalls.rate, handlerCallsBefore, '旧 revision 拒绝时 handler 不得调用');
      // 夹具声明的 oracle 结论与实际行为逐项一致，不退化为文档字段。
      assert.equal(fixture.expectedNextAction.decision, 'reject-stale-revision');
      assert.equal(fixture.expectedNextAction.handlerCalls, 0);
      assert.equal(fixture.expectedNextAction.snapshotUnchanged, true);
      const snapshotAfter = await adapter.describeSurfaceContract(SURFACE);
      assert.equal(snapshotAfter?.surfaceRevision, fixture.expectedNextAction.serverRevision);
    });
  }
});
