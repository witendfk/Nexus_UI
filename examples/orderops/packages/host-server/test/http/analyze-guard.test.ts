import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, expect, it } from 'vitest';
import type Koa from 'koa';
import { createApp } from '../../src/http/app';
import { openDatabase, type SqliteDb } from '../../src/db/client';
import { detectStalledCases } from '../../src/cases/detect';
import { seedFixtures } from '../../src/fixtures/seed';

/** T3.3b 判据（docs/tasks/CURRENT.md）：无效/不可分析 caseId 均被拒；自由 message
 * 不能经任一入口创建 surface；每类拒绝都有触发该失败的自动化用例。 */

const NOW = new Date('2026-09-30T12:00:00.000Z');
const SEEDED_CASE_ID = 'case-order-stalled-001-evt-stalled-002';

const servers: http.Server[] = [];
const dbs: SqliteDb[] = [];

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
  const dir = mkdtempSync(join(tmpdir(), 'orderops-analyze-guard-'));
  const db = openDatabase(join(dir, 'test.sqlite'), fileMigrationsDir());
  dbs.push(db);
  seedFixtures(db, NOW);
  detectStalledCases(db, { now: NOW, thresholdHours: 48 });
  return db;
}

function fileMigrationsDir(): string {
  return new URL('../../src/db/migrations', import.meta.url).pathname;
}

function parseSse(raw: string): Array<{ event: string }> {
  return raw
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => ({ event: /event: (.+)/.exec(block)?.[1] ?? '' }));
}

afterAll(() => {
  for (const server of servers) server.close();
});

afterEach(() => {
  for (const db of dbs) db.close();
  dbs.length = 0;
});

it('未知 caseId → 404，不产生 surface 流', async () => {
  const baseUrl = await listen(createApp({ db: seededDb() }));
  const response = await fetch(`${baseUrl}/api/cases/case-not-exist/analyze`, { method: 'POST' });
  expect(response.status).toBe(404);
  expect(response.headers.get('content-type')).toContain('application/json');
  const body = (await response.json()) as { error: string };
  expect(body.error).toBe('NOT_FOUND');
});

it('ticket_created / dismissed 状态 → 409 拒绝分析', async () => {
  const db = seededDb();
  const baseUrl = await listen(createApp({ db }));
  for (const status of ['ticket_created', 'dismissed']) {
    db.prepare('UPDATE anomaly_cases SET status = ? WHERE id = ?').run(status, SEEDED_CASE_ID);
    const response = await fetch(`${baseUrl}/api/cases/${SEEDED_CASE_ID}/analyze`, {
      method: 'POST',
    });
    expect(response.status, status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error, status).toBe('CASE_NOT_ANALYZABLE');
  }
});

it('open 案件仍可正常分析（封口不误伤合法入口）', async () => {
  const baseUrl = await listen(createApp({ db: seededDb() }));
  const response = await fetch(`${baseUrl}/api/cases/${SEEDED_CASE_ID}/analyze`, {
    method: 'POST',
  });
  expect(response.status).toBe(200);
  const events = parseSse(await response.text());
  expect(events.at(-1)?.event).toBe('done');
});

it('通用 POST /api/a2ui/generate 已下线：自由 message 不能创建 surface', async () => {
  const baseUrl = await listen(createApp({ db: seededDb() }));
  const response = await fetch(`${baseUrl}/api/a2ui/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'any-free-message' }),
  });
  expect(response.status).toBe(404);
  expect(response.headers.get('content-type')).toContain('application/json');
  const body = (await response.json()) as { error: string };
  expect(body.error).toBe('ROUTE_DISABLED');
});

it('db 未接线时 analyze 显式 503（与案件查询路由语义一致）', async () => {
  const baseUrl = await listen(createApp());
  const response = await fetch(`${baseUrl}/api/cases/${SEEDED_CASE_ID}/analyze`, {
    method: 'POST',
  });
  expect(response.status).toBe(503);
  const body = (await response.json()) as { error: string };
  expect(body.error).toBe('SERVICE_UNAVAILABLE');
});
