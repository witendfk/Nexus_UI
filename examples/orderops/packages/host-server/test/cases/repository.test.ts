import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openDatabase, type SqliteDb } from '../../src/db/client';
import { detectStalledCases } from '../../src/cases/detect';
import { getCaseDetail, listCases } from '../../src/cases/repository';
import { STALLED_ORDER_ID } from '../../src/fixtures/data';
import { seedFixtures } from '../../src/fixtures/seed';

const NOW = new Date('2026-09-30T12:00:00.000Z');

const dbs: SqliteDb[] = [];
const dirs: string[] = [];

function seededDetectedDb(): SqliteDb {
  const dir = mkdtempSync(join(tmpdir(), 'orderops-repo-'));
  dirs.push(dir);
  const db = openDatabase(join(dir, 'test.sqlite'), fileMigrationsDir());
  dbs.push(db);
  seedFixtures(db, NOW);
  detectStalledCases(db, { now: NOW, thresholdHours: 48 });
  return db;
}

function fileMigrationsDir(): string {
  return new URL('../../src/db/migrations', import.meta.url).pathname;
}

afterEach(() => {
  for (const db of dbs) db.close();
  dbs.length = 0;
  dirs.length = 0;
});

it('listCases：行映射为契约 camelCase 字段，检测时间倒序', () => {
  const db = seededDetectedDb();
  const cases = listCases(db);
  expect(cases).toHaveLength(1);
  const c = cases[0]!;
  expect(c.id).toBe(`case-${STALLED_ORDER_ID}-evt-stalled-002`);
  expect(c.orderId).toBe(STALLED_ORDER_ID);
  expect(c.type).toBe('logistics_stalled');
  expect(c.severity).toBe('high');
  expect(c.status).toBe('open');
  expect(c.detectedAt).toBe(NOW.toISOString());
  expect(c.lastEventId).toBe('evt-stalled-002');
});

it('listCases：status / severity 组合过滤', () => {
  const db = seededDetectedDb();
  expect(listCases(db, { status: 'open' })).toHaveLength(1);
  expect(listCases(db, { status: 'dismissed' })).toHaveLength(0);
  expect(listCases(db, { severity: 'high' })).toHaveLength(1);
  expect(listCases(db, { severity: 'low' })).toHaveLength(0);
  expect(listCases(db, { status: 'open', severity: 'high' })).toHaveLength(1);
  expect(listCases(db, { status: 'open', severity: 'medium' })).toHaveLength(0);
});

it('listCases：q 匹配案件/订单 ID 子串；LIKE 通配符按字面量处理', () => {
  const db = seededDetectedDb();
  expect(listCases(db, { q: 'stalled' })).toHaveLength(1);
  expect(listCases(db, { q: 'order-stalled-00' })).toHaveLength(1);
  expect(listCases(db, { q: 'missing-order' })).toHaveLength(0);
  // 'll%ed' 不作为模式展开（否则会命中 stalled），按字面量匹配应为空
  expect(listCases(db, { q: 'll%ed' })).toHaveLength(0);
  expect(listCases(db, { q: 'll_ed' })).toHaveLength(0);
});

it('getCaseDetail：案件 + 订单事实 + 事件时间线（ID/时间/来源可回查）', () => {
  const db = seededDetectedDb();
  const detail = getCaseDetail(db, `case-${STALLED_ORDER_ID}-evt-stalled-002`);
  expect(detail).not.toBeNull();

  expect(detail!.case.severity).toBe('high');
  expect(detail!.order).toEqual({
    id: STALLED_ORDER_ID,
    customerId: 'cust-1001',
    currency: 'CNY',
    amountMinor: 129_900,
    promisedAt: new Date(NOW.getTime() - 24 * 3_600_000).toISOString(),
    status: 'shipping',
  });
  // 事件升序时间线，字段齐全
  expect(detail!.events.map((event) => event.id)).toEqual(['evt-stalled-001', 'evt-stalled-002']);
  expect(detail!.events[0]).toEqual({
    id: 'evt-stalled-001',
    orderId: STALLED_ORDER_ID,
    status: 'picked_up',
    occurredAt: new Date(NOW.getTime() - 96 * 3_600_000).toISOString(),
    source: 'carrier-api',
  });
});

it('getCaseDetail：不存在的案件返回 null', () => {
  const db = seededDetectedDb();
  expect(getCaseDetail(db, 'case-nope')).toBeNull();
});
