import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import type Koa from 'koa';
import { createCatalogContractHash } from '@nexus-ui/server';
import { createApp } from '../../src/http/app';
import { ORDEROPS_CATALOG, ORDEROPS_CATALOG_ID } from '../../src/nexus/catalog';
import { getSurfaceBinding } from '../../src/cases/repository';
import { openDatabase, type SqliteDb } from '../../src/db/client';
import { detectStalledCases } from '../../src/cases/detect';
import { seedFixtures } from '../../src/fixtures/seed';
import { stubAgentServer, type StubAgent } from './agent-stub';

const NOW = new Date('2026-09-30T12:00:00.000Z');
/** detect 的确定性格式 `case-{orderId}-{eventId}`（fixtures 中唯一停滞案件）。 */
const SEEDED_CASE_ID = 'case-order-stalled-001-evt-stalled-002';

const servers: http.Server[] = [];
const dbs: SqliteDb[] = [];
const agents: StubAgent[] = [];

function listen(app: Koa): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app.callback());
    servers.push(server);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function seededDb(): SqliteDb {
  const dir = mkdtempSync(join(tmpdir(), 'orderops-app-http-'));
  const db = openDatabase(join(dir, 'test.sqlite'), fileMigrationsDir());
  dbs.push(db);
  seedFixtures(db, NOW);
  detectStalledCases(db, { now: NOW, thresholdHours: 48 });
  return db;
}

function fileMigrationsDir(): string {
  return new URL('../../src/db/migrations', import.meta.url).pathname;
}

interface SseEvent {
  event: string;
  data: unknown;
}

function parseSse(raw: string): SseEvent[] {
  return raw
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const event = /event: (.+)/.exec(block)?.[1] ?? '';
      const dataLine = /data: (.+)/.exec(block)?.[1];
      return { event, data: dataLine === undefined ? undefined : JSON.parse(dataLine) };
    });
}

afterEach(() => {
  for (const server of servers) server.close();
  servers.length = 0;
  for (const db of dbs) db.close();
  dbs.length = 0;
  for (const agent of agents) agent.close();
  agents.length = 0;
});

async function appWithAgent(): Promise<{ baseUrl: string; db: SqliteDb; agent: StubAgent }> {
  const db = seededDb();
  const agent = await stubAgentServer();
  agents.push(agent);
  const baseUrl = await listen(createApp({ db, agentRpc: { endpoint: agent.url } }));
  return { baseUrl, db, agent };
}

it('GET /health 返回服务状态', async () => {
  const baseUrl = await listen(createApp());
  const response = await fetch(`${baseUrl}/health`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { status: string; service: string };
  expect(body.status).toBe('ok');
  expect(body.service).toBe('@orderops/host-server');
});

it('GET /api/a2ui/published-catalogs 发布 OrderOps Catalog', async () => {
  const baseUrl = await listen(createApp());
  const response = await fetch(`${baseUrl}/api/a2ui/published-catalogs`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { catalogs: Array<{ catalogId: string }> };
  expect(body.catalogs.map((catalog) => catalog.catalogId)).toContain(ORDEROPS_CATALOG_ID);
});

it('agentRpc 未配置时 analyze 显式 503', async () => {
  const baseUrl = await listen(createApp({ db: seededDb() }));
  const response = await fetch(`${baseUrl}/api/cases/${SEEDED_CASE_ID}/analyze`, {
    method: 'POST',
  });
  expect(response.status).toBe(503);
  const body = (await response.json()) as { error: string };
  expect(body.error).toBe('SERVICE_UNAVAILABLE');
});

it('analyze 经外部 Agent RPC 分阶段流式输出，以 done 结束，并落 surface_bindings', async () => {
  const { baseUrl, db, agent } = await appWithAgent();
  const response = await fetch(`${baseUrl}/api/cases/${SEEDED_CASE_ID}/analyze`, {
    method: 'POST',
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');

  const events = parseSse(await response.text());
  expect(events.at(-1)?.event).toBe('done');

  const messages = events.filter((entry) => entry.event === 'message').map((entry) => entry.data) as Array<Record<string, unknown>>;
  // V1 分阶段产出：createSurface + 多次交错 components/data（替身与编译器同形）
  expect(messages.length).toBeGreaterThanOrEqual(5);
  const create = messages[0] as { createSurface: { surfaceId: string; catalogId: string } };
  expect(create.createSurface.catalogId).toBe(ORDEROPS_CATALOG_ID);
  const surfaceId = create.createSurface.surfaceId;

  // 逐条渲染的可见证据：首个 updateComponents 只有骨架（root+标题），后续批次才出现执行区与按钮
  const componentBatches = messages
    .filter((message) => 'updateComponents' in message)
    .map((message) => (message as { updateComponents: { components: Array<{ id: string }> } }).updateComponents.components
      .map((component) => component.id));
  expect(componentBatches[0]).toEqual(['root', 'case-title']);
  expect(componentBatches.some((ids) => ids.includes('ticket-result'))).toBe(true);
  expect(componentBatches.at(-1)).toContain('submit-ticket');

  // T3.6 判据：提交后写 surface_bindings（case_version 为分析时刻版本）。
  const binding = getSurfaceBinding(db, surfaceId);
  expect(binding).not.toBeNull();
  expect(binding).toMatchObject({
    surfaceId,
    caseId: SEEDED_CASE_ID,
    caseVersion: 1,
    catalogHash: createCatalogContractHash(ORDEROPS_CATALOG),
  });
  // RPC 请求的 message 规范化为 caseId
  expect((agent.lastRequest as { message?: string }).message).toBe(SEEDED_CASE_ID);
});

it('S1 可观察性：analyze 的 run 状态（成功/失败）可经 /api/a2ui/runs 查询', async () => {
  const { baseUrl } = await appWithAgent();
  const doneResponse = await fetch(`${baseUrl}/api/cases/${SEEDED_CASE_ID}/analyze`, { method: 'POST' });
  const doneEvents = parseSse(await doneResponse.text());
  expect(doneEvents.at(-1)?.event).toBe('done');
  const surfaceId = (doneEvents.find((entry) => entry.event === 'message')?.data as { createSurface: { surfaceId: string } })
    .createSurface.surfaceId;

  const runs = await fetch(`${baseUrl}/api/a2ui/runs?surfaceId=${encodeURIComponent(surfaceId)}`);
  expect(runs.status).toBe(200);
  const body = (await runs.json()) as { runs: Array<{ state: string; kind: string }> };
  expect(body.runs.at(-1)?.state).toBe('succeeded');

  // 失败流同样可观察
  const failing = await stubAgentServer({ status: 500, errorBody: { error: { message: '模型不可用' } } });
  agents.push(failing);
  const failBaseUrl = await listen(createApp({ db: seededDb(), agentRpc: { endpoint: failing.url } }));
  const failResponse = await fetch(`${failBaseUrl}/api/cases/${SEEDED_CASE_ID}/analyze`, { method: 'POST' });
  const failEvents = parseSse(await failResponse.text());
  expect(failEvents.at(-1)?.event).toBe('error');
  const failSurfaceId = (failEvents.find((entry) => entry.event === 'message')?.data as { createSurface: { surfaceId: string } } | undefined)
    ?.createSurface.surfaceId;
  if (failSurfaceId !== undefined) {
    const failRuns = await fetch(`${failBaseUrl}/api/a2ui/runs?surfaceId=${encodeURIComponent(failSurfaceId)}`);
    const failBody = (await failRuns.json()) as { runs: Array<{ state: string }> };
    expect(failBody.runs.at(-1)?.state).toBe('failed');
  }
});

it('S1 取消传播：客户端断开 → 上游 stub 观测到连接中止，不落绑定', async () => {
  const db = seededDb();
  const agent = await stubAgentServer({ delayMs: 800 });
  agents.push(agent);
  const baseUrl = await listen(createApp({ db, agentRpc: { endpoint: agent.url } }));

  const controller = new AbortController();
  const pending = fetch(`${baseUrl}/api/cases/${SEEDED_CASE_ID}/analyze`, {
    method: 'POST',
    signal: controller.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  controller.abort();
  await pending.catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // 取消传播到上游：宿主在生成期间断开了对 stub 的连接
  expect(agent.sawClientClose).toBe(true);
  expect(db.prepare('SELECT surface_id FROM surface_bindings').all()).toHaveLength(0);
});

it('S1 资源上限：Agent NDJSON 超过 2MB → SSE error 且无绑定', async () => {
  const db = seededDb();
  const agent = await stubAgentServer({ oversized: true });
  agents.push(agent);
  const baseUrl = await listen(createApp({ db, agentRpc: { endpoint: agent.url } }));

  const response = await fetch(`${baseUrl}/api/cases/${SEEDED_CASE_ID}/analyze`, { method: 'POST' });
  const events = parseSse(await response.text());
  expect(events.at(-1)?.event).toBe('error');
  expect(JSON.stringify(events.at(-1)?.data)).toContain('字节上限');
  expect(db.prepare('SELECT surface_id FROM surface_bindings').all()).toHaveLength(0);
});

it('S1 重放：同一 actionId 的重复提交 → 400 重放拒绝', async () => {
  const { baseUrl } = await appWithAgent();
  const surfaceId = await analyzeForSurface(baseUrl);

  const post = (): Promise<Response> =>
    fetch(`${baseUrl}/api/a2ui/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 'v0.9',
        action: {
          name: 'createTicket',
          surfaceId,
          sourceComponentId: 'submit-ticket',
          timestamp: new Date().toISOString(),
          actionId: 'replay-1',
          context: { note: '重放识别' },
        },
      }),
    });

  expect((await post()).status).toBe(200);
  const replay = await post();
  expect(replay.status).toBe(400);
  const body = (await replay.json()) as { message: string };
  expect(body.message).toContain('重放');
});

it('Agent RPC 失败 → SSE error 收尾，且不留 surface_bindings', async () => {
  const db = seededDb();
  const agent = await stubAgentServer({ status: 500, errorBody: { error: { message: '模型不可用' } } });
  agents.push(agent);
  const baseUrl = await listen(createApp({ db, agentRpc: { endpoint: agent.url } }));
  const response = await fetch(`${baseUrl}/api/cases/${SEEDED_CASE_ID}/analyze`, {
    method: 'POST',
  });
  expect(response.status).toBe(200); // SSE 通道建立，但流内 error
  const events = parseSse(await response.text());
  expect(events.at(-1)?.event).toBe('error');
  const errorData = events.at(-1)?.data as { message: string };
  expect(errorData.message).toContain('模型不可用');

  // 失败流：无绑定（fail 流无可执行快照与业务关联）
  const caseRows = db.prepare('SELECT surface_id FROM surface_bindings').all() as unknown[];
  expect(caseRows).toHaveLength(0);
});

it('action 回流触发真实建单事务：备注落库、案件推进、patch 展示工单号并禁用按钮', async () => {
  const { baseUrl, db } = await appWithAgent();

  const generateResponse = await fetch(`${baseUrl}/api/cases/${SEEDED_CASE_ID}/analyze`, {
    method: 'POST',
  });
  const generateEvents = parseSse(await generateResponse.text());
  const createMessage = generateEvents.find((entry) => entry.event === 'message')
    ?.data as { createSurface: { surfaceId: string } };
  const surfaceId = createMessage.createSurface.surfaceId;

  const actionResponse = await fetch(`${baseUrl}/api/a2ui/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      version: 'v0.9',
      action: {
        name: 'createTicket',
        surfaceId,
        sourceComponentId: 'submit-ticket',
        timestamp: new Date().toISOString(),
        actionId: 'test-action-1',
        context: { note: '穿刺备注' },
      },
    }),
  });
  expect(actionResponse.status).toBe(200);

  const actionEvents = parseSse(await actionResponse.text());
  expect(actionEvents.at(-1)?.event).toBe('done');
  // T4.2 判据：patch = 禁用按钮 + /result 定点写工单号（不清空 draft）
  const patches = actionEvents.filter((entry) => entry.event === 'message').map((entry) => entry.data) as Array<
    { updateComponents?: { components: Array<{ id: string; disabled?: boolean }> }; updateDataModel?: { path?: string; value: { ticketText?: string; ticketId?: string; draft?: unknown } } }
  >;
  expect(patches).toHaveLength(2);
  expect(patches[0]?.updateComponents?.components[0]).toMatchObject({ id: 'submit-ticket', disabled: true });
  expect(patches[1]?.updateDataModel?.path).toBe('/result');
  const ticketRow = db.prepare('SELECT id, note FROM tickets').get() as { id: string; note: string };
  expect(patches[1]?.updateDataModel?.value.ticketId).toBe(ticketRow.id);
  expect(patches[1]?.updateDataModel?.value.ticketText).toBe(`工单号：${ticketRow.id}`);
  expect(patches[1]?.updateDataModel?.value.draft).toBeUndefined();

  // 案件推进 + 备注落库
  const c = db.prepare('SELECT status, version FROM anomaly_cases WHERE id = ?').get(SEEDED_CASE_ID) as { status: string; version: number };
  expect(c).toEqual({ status: 'ticket_created', version: 2 });
  expect(ticketRow.note).toBe('穿刺备注');
});

it('GET /api/actions/:actionId 返回操作终态；未知 actionId 404', async () => {
  const { baseUrl, db } = await appWithAgent();
  const generateResponse = await fetch(`${baseUrl}/api/cases/${SEEDED_CASE_ID}/analyze`, { method: 'POST' });
  const generateEvents = parseSse(await generateResponse.text());
  const surfaceId = (generateEvents.find((entry) => entry.event === 'message')?.data as { createSurface: { surfaceId: string } }).createSurface.surfaceId;

  await fetch(`${baseUrl}/api/a2ui/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      version: 'v0.9',
      action: {
        name: 'createTicket',
        surfaceId,
        sourceComponentId: 'submit-ticket',
        timestamp: new Date().toISOString(),
        actionId: 'query-action-1',
        context: { note: '查询用' },
      },
    }),
  });

  const found = await fetch(`${baseUrl}/api/actions/query-action-1`);
  expect(found.status).toBe(200);
  expect(await found.json()).toMatchObject({
    actionId: 'query-action-1',
    operation: 'createTicket',
    caseId: SEEDED_CASE_ID,
    status: 'succeeded',
    resultId: (db.prepare('SELECT id FROM tickets').get() as { id: string }).id,
  });

  const missing = await fetch(`${baseUrl}/api/actions/no-such-action`);
  expect(missing.status).toBe(404);
});

it('客户端中断不回滚已提交事务：abort 后按 actionId 查到 succeeded 终态', async () => {
  const { baseUrl, db } = await appWithAgent();
  const generateResponse = await fetch(`${baseUrl}/api/cases/${SEEDED_CASE_ID}/analyze`, { method: 'POST' });
  const generateEvents = parseSse(await generateResponse.text());
  const surfaceId = (generateEvents.find((entry) => entry.event === 'message')?.data as { createSurface: { surfaceId: string } }).createSurface.surfaceId;

  // 等响应头到达（此刻 handler/事务已在 prepareAction 执行完），随后中断流：
  // SSE 未读完，事务不得回滚。
  const controller = new AbortController();
  const responsePromise = fetch(`${baseUrl}/api/a2ui/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      version: 'v0.9',
      action: {
        name: 'createTicket',
        surfaceId,
        sourceComponentId: 'submit-ticket',
        timestamp: new Date().toISOString(),
        actionId: 'abort-action-1',
        context: { note: '中断也不回滚' },
      },
    }),
    signal: controller.signal,
  });
  const actionResponse = await responsePromise;
  expect(actionResponse.status).toBe(200);
  controller.abort();
  await actionResponse.text().catch(() => '');

  // 轮询查询端点直至终态可见（事务与流解耦的最终一致窗口）
  let attempt: { status: string } | null = null;
  for (let i = 0; i < 20 && attempt === null; i += 1) {
    const found = await fetch(`${baseUrl}/api/actions/abort-action-1`);
    if (found.status === 200) attempt = (await found.json()) as { status: string };
    else await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(attempt?.status).toBe('succeeded');
  const tickets = db.prepare('SELECT note FROM tickets').all() as Array<{ note: string }>;
  expect(tickets).toHaveLength(1);
  expect(tickets[0]?.note).toBe('中断也不回滚');
});

it('双击建单（不同 actionId 的第二个请求）→ 400 拒绝，不产生第二张工单', async () => {
  const { baseUrl, db } = await appWithAgent();

  const generateResponse = await fetch(`${baseUrl}/api/cases/${SEEDED_CASE_ID}/analyze`, {
    method: 'POST',
  });
  const generateEvents = parseSse(await generateResponse.text());
  const createMessage = generateEvents.find((entry) => entry.event === 'message')
    ?.data as { createSurface: { surfaceId: string } };
  const surfaceId = createMessage.createSurface.surfaceId;

  const postAction = (actionId: string): Promise<Response> =>
    fetch(`${baseUrl}/api/a2ui/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 'v0.9',
        action: {
          name: 'createTicket',
          surfaceId,
          sourceComponentId: 'submit-ticket',
          timestamp: new Date().toISOString(),
          actionId,
          context: { note: `备注-${actionId}` },
        },
      }),
    });

  const first = await postAction('click-1');
  expect(first.status).toBe(200);
  const second = await postAction('click-2');
  expect(second.status).toBe(400);
  const body = (await second.json()) as { error: string; message: string };
  expect(body.error).toBe('INVALID_REQUEST');
  expect(body.message).toContain('已建单');

  const tickets = db.prepare('SELECT note FROM tickets').all() as Array<{ note: string }>;
  expect(tickets).toHaveLength(1);
  expect(tickets[0]?.note).toBe('备注-click-1');
});

it('伪造的 action 名被拒绝', async () => {
  const { baseUrl } = await appWithAgent();

  const generateResponse = await fetch(`${baseUrl}/api/cases/${SEEDED_CASE_ID}/analyze`, {
    method: 'POST',
  });
  const generateEvents = parseSse(await generateResponse.text());
  const createMessage = generateEvents.find((entry) => entry.event === 'message')
    ?.data as { createSurface: { surfaceId: string } };

  // surface 快照里的 Button 只声明了 createTicket，伪造 action 名在快照校验即被拒（400，不进流）。
  const actionResponse = await fetch(`${baseUrl}/api/a2ui/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      version: 'v0.9',
      action: {
        name: 'ping',
        surfaceId: createMessage.createSurface.surfaceId,
        sourceComponentId: 'submit-ticket',
        timestamp: new Date().toISOString(),
        context: {},
      },
    }),
  });
  expect(actionResponse.status).toBe(400);
  const body = (await actionResponse.json()) as { error: string };
  expect(body.error).toBe('INVALID_REQUEST');
});

/* ─────────── T4.4 七类失败样本（docs/tasks/CURRENT.md）：每类一条端到端证伪 ───────────
 * 双击 →「双击建单」用例；SSE 中断 →「客户端中断不回滚」用例；此处补齐其余四类。 */

it('T4.4 样本①非法 Catalog 字段：Agent 返回未声明组件 → SSE error，无绑定落库', async () => {
  const db = seededDb();
  const agent = await stubAgentServer({ illegalSurface: true });
  agents.push(agent);
  const baseUrl = await listen(createApp({ db, agentRpc: { endpoint: agent.url } }));

  const response = await fetch(`${baseUrl}/api/cases/${SEEDED_CASE_ID}/analyze`, {
    method: 'POST',
  });
  const events = parseSse(await response.text());
  expect(events.at(-1)?.event).toBe('error');
  const errorData = events.at(-1)?.data as { message: string };
  expect(errorData.message).toContain('NotInCatalog');
  // 失败流不提交快照、不落绑定
  expect(db.prepare('SELECT surface_id FROM surface_bindings').all()).toHaveLength(0);
});

it('T4.4 样本②伪造订单 ID 走 action 字段 → 400 未声明字段（归属以 surface_bindings 为准）', async () => {
  const { baseUrl, db } = await appWithAgent();
  const surfaceId = await analyzeForSurface(baseUrl);

  const response = await fetch(`${baseUrl}/api/a2ui/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      version: 'v0.9',
      action: {
        name: 'createTicket',
        surfaceId,
        sourceComponentId: 'submit-ticket',
        timestamp: new Date().toISOString(),
        actionId: 'forge-order-1',
        context: { note: 'x', orderId: 'order-forged' },
      },
    }),
  });
  expect(response.status).toBe(400);
  const body = (await response.json()) as { message: string };
  expect(body.message).toContain('orderId');
  expect(db.prepare('SELECT id FROM tickets').all()).toHaveLength(0);
});

it('T4.4 样本③旧 surface（案件版本已推进）→ 400 要求重新分析', async () => {
  const { baseUrl, db } = await appWithAgent();
  const surfaceId = await analyzeForSurface(baseUrl);

  // surface 提交后案件被其他路径推进（如另一操作员处理）
  db.prepare('UPDATE anomaly_cases SET version = version + 1 WHERE id = ?').run(SEEDED_CASE_ID);

  const response = await fetch(`${baseUrl}/api/a2ui/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      version: 'v0.9',
      action: {
        name: 'createTicket',
        surfaceId,
        sourceComponentId: 'submit-ticket',
        timestamp: new Date().toISOString(),
        actionId: 'stale-surface-1',
        context: { note: 'x' },
      },
    }),
  });
  expect(response.status).toBe(400);
  const body = (await response.json()) as { message: string };
  expect(body.message).toContain('重新分析');
  expect(db.prepare('SELECT id FROM tickets').all()).toHaveLength(0);
});

/** analyze 一次并返回 surfaceId（T4.4 样本共用）。 */
async function analyzeForSurface(baseUrl: string): Promise<string> {
  const generateResponse = await fetch(`${baseUrl}/api/cases/${SEEDED_CASE_ID}/analyze`, {
    method: 'POST',
  });
  const generateEvents = parseSse(await generateResponse.text());
  const createMessage = generateEvents.find((entry) => entry.event === 'message')
    ?.data as { createSurface: { surfaceId: string } };
  return createMessage.createSurface.surfaceId;
}
