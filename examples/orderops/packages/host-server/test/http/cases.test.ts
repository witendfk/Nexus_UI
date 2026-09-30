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

const NOW = new Date('2026-09-30T12:00:00.000Z');

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
  const dir = mkdtempSync(join(tmpdir(), 'orderops-cases-http-'));
  const db = openDatabase(join(dir, 'test.sqlite'), fileMigrationsDir());
  dbs.push(db);
  seedFixtures(db, NOW);
  detectStalledCases(db, { now: NOW, thresholdHours: 48 });
  return db;
}

function fileMigrationsDir(): string {
  return new URL('../../src/db/migrations', import.meta.url).pathname;
}

afterAll(() => {
  for (const server of servers) server.close();
});

afterEach(() => {
  for (const db of dbs) db.close();
  dbs.length = 0;
});

it('GET /api/cases：返回案件队列，字段可回查', async () => {
  const baseUrl = await listen(createApp({ db: seededDetectedDb() }));
  const response = await fetch(`${baseUrl}/api/cases`);
  expect(response.status).toBe(200);

  const body = (await response.json()) as {
    cases: Array<{ id: string; orderId: string; severity: string; detectedAt: string; lastEventId: string }>;
  };
  expect(body.cases).toHaveLength(1);
  expect(body.cases[0]).toMatchObject({
    orderId: 'order-stalled-001',
    severity: 'high',
    detectedAt: NOW.toISOString(),
    lastEventId: 'evt-stalled-002',
  });
});

it('GET /api/cases：过滤与搜索生效', async () => {
  const baseUrl = await listen(createApp({ db: seededDetectedDb() }));
  const ok = await fetch(`${baseUrl}/api/cases?status=open&severity=high&q=stalled`);
  expect(((await ok.json()) as { cases: unknown[] }).cases).toHaveLength(1);

  const none = await fetch(`${baseUrl}/api/cases?status=dismissed`);
  expect(((await none.json()) as { cases: unknown[] }).cases).toHaveLength(0);
});

it('GET /api/cases：非法 status/severity 被 400 拒绝（不静默忽略）', async () => {
  const baseUrl = await listen(createApp({ db: seededDetectedDb() }));
  for (const query of ['status=closed', 'severity=urgent']) {
    const response = await fetch(`${baseUrl}/api/cases?${query}`);
    expect(response.status, query).toBe(400);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe('INVALID_REQUEST');
    expect(body.message).toContain('非法');
  }
});

it('GET /api/cases/:id：详情含订单事实与物流时间线；未知 id 404', async () => {
  const baseUrl = await listen(createApp({ db: seededDetectedDb() }));

  const detailResponse = await fetch(`${baseUrl}/api/cases/case-order-stalled-001-evt-stalled-002`);
  expect(detailResponse.status).toBe(200);
  const detail = (await detailResponse.json()) as {
    case: { orderId: string };
    order: { id: string; amountMinor: number };
    events: Array<{ id: string; occurredAt: string; source: string }>;
  };
  expect(detail.case.orderId).toBe('order-stalled-001');
  expect(detail.order.amountMinor).toBe(129_900);
  // T2.5 判据：事件 ID、时间、来源可回查
  expect(detail.events).toEqual([
    {
      id: 'evt-stalled-001',
      orderId: 'order-stalled-001',
      status: 'picked_up',
      occurredAt: new Date(NOW.getTime() - 96 * 3_600_000).toISOString(),
      source: 'carrier-api',
    },
    {
      id: 'evt-stalled-002',
      orderId: 'order-stalled-001',
      status: 'in_transit',
      occurredAt: new Date(NOW.getTime() - 72 * 3_600_000).toISOString(),
      source: 'carrier-api',
    },
  ]);

  const missing = await fetch(`${baseUrl}/api/cases/case-nope`);
  expect(missing.status).toBe(404);
  expect(((await missing.json()) as { error: string }).error).toBe('NOT_FOUND');
});

it('db 未接线：/api/cases 显式 503，不冒充 404', async () => {
  const baseUrl = await listen(createApp());
  const response = await fetch(`${baseUrl}/api/cases`);
  expect(response.status).toBe(503);
  const body = (await response.json()) as { error: string };
  expect(body.error).toBe('SERVICE_UNAVAILABLE');
});
