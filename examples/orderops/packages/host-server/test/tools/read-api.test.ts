import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, expect, it } from 'vitest';
import type Koa from 'koa';
import { ReadContextResponseSchema } from '@orderops/contracts';
import { createApp } from '../../src/http/app';
import { openDatabase, type SqliteDb } from '../../src/db/client';
import { detectStalledCases } from '../../src/cases/detect';
import { seedFixtures } from '../../src/fixtures/seed';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const TOKEN = 'internal-test-token';
const CASE_ID = 'case-order-stalled-001-evt-stalled-002';

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

function seededDetectedDb(): SqliteDb {
  const dir = mkdtempSync(join(tmpdir(), 'orderops-readapi-'));
  const db = openDatabase(join(dir, 'test.sqlite'), fileMigrationsDir());
  dbs.push(db);
  seedFixtures(db, NOW);
  detectStalledCases(db, { now: NOW, thresholdHours: 48 });
  return db;
}

function fileMigrationsDir(): string {
  return new URL('../../src/db/migrations', import.meta.url).pathname;
}

function urlFor(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`;
}

afterAll(() => {
  for (const server of servers) server.close();
});

afterEach(() => {
  for (const db of dbs) db.close();
  dbs.length = 0;
});

it('T3.1 判据：无 token 401（token 未配置时 fail-closed）', async () => {
  process.env.ORDEROPS_INTERNAL_TOKEN = '';
  const baseUrl = await listen(createApp({ db: seededDetectedDb() }));
  const response = await fetch(urlFor(baseUrl, `/internal/cases/${CASE_ID}/context`));
  expect(response.status).toBe(401);
  expect(((await response.json()) as { error: string }).error).toBe('UNAUTHORIZED');
});

it('错误 token 401；正确 Bearer token 200', async () => {
  process.env.ORDEROPS_INTERNAL_TOKEN = TOKEN;
  const baseUrl = await listen(createApp({ db: seededDetectedDb() }));

  const denied = await fetch(urlFor(baseUrl, `/internal/cases/${CASE_ID}/context`), {
    headers: { authorization: `Bearer wrong-token` },
  });
  expect(denied.status).toBe(401);

  const allowed = await fetch(urlFor(baseUrl, `/internal/cases/${CASE_ID}/context`), {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  expect(allowed.status).toBe(200);
});

it('T3.1 判据：快照结构与 contracts ReadContextResponseSchema 完全一致', async () => {
  process.env.ORDEROPS_INTERNAL_TOKEN = TOKEN;
  const before = Date.now();
  const baseUrl = await listen(createApp({ db: seededDetectedDb() }));
  const response = await fetch(urlFor(baseUrl, `/internal/cases/${CASE_ID}/context`), {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as unknown;

  // 生产方出口即契约：zod 逐字段校验（含枚举、ISO 时间、amountMinor 整数、events ≤ 200）
  const parsed = ReadContextResponseSchema.parse(body);
  expect(parsed.contractVersion).toBe(1);
  expect(parsed.caseId).toBe(CASE_ID);
  expect(parsed.caseVersion).toBe(1); // 检测器建案 version=1
  expect(parsed.snapshot.case.orderId).toBe('order-stalled-001');
  expect(parsed.snapshot.case.severity).toBe('high');
  expect(parsed.snapshot.order.amountMinor).toBe(129_900);
  expect(parsed.snapshot.events.map((event) => event.id)).toEqual([
    'evt-stalled-001',
    'evt-stalled-002',
  ]);
  // capturedAt 是快照基准时间：晚于本次请求开始（服务端现取）
  expect(Date.parse(parsed.snapshot.capturedAt)).toBeGreaterThanOrEqual(before);
  delete process.env.ORDEROPS_INTERNAL_TOKEN;
});

it('未知案件 404（token 有效时）', async () => {
  process.env.ORDEROPS_INTERNAL_TOKEN = TOKEN;
  const baseUrl = await listen(createApp({ db: seededDetectedDb() }));
  const response = await fetch(urlFor(baseUrl, '/internal/cases/case-nope/context'), {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  expect(response.status).toBe(404);
  expect(((await response.json()) as { error: string }).error).toBe('NOT_FOUND');
  delete process.env.ORDEROPS_INTERNAL_TOKEN;
});
