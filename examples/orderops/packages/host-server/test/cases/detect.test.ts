import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openDatabase, type SqliteDb } from '../../src/db/client';
import { detectStalledCases } from '../../src/cases/detect';
import {
  NORMAL_ORDER_ID,
  STALLED_LAST_EVENT_ID,
  STALLED_ORDER_ID,
} from '../../src/fixtures/data';
import { seedFixtures } from '../../src/fixtures/seed';

const HOUR = 3_600_000;
const NOW = new Date('2026-09-30T12:00:00.000Z');
const THRESHOLD_HOURS = 48;

const dbs: SqliteDb[] = [];
const dirs: string[] = [];

function newDb(): SqliteDb {
  const dir = mkdtempSync(join(tmpdir(), 'orderops-detect-'));
  dirs.push(dir);
  const db = openDatabase(join(dir, 'test.sqlite'), fileMigrationsDir());
  dbs.push(db);
  return db;
}

function fileMigrationsDir(): string {
  return new URL('../../src/db/migrations', import.meta.url).pathname;
}

function seededDb(now: Date = NOW): SqliteDb {
  const db = newDb();
  seedFixtures(db, now);
  return db;
}

function caseRows(db: SqliteDb): Record<string, unknown>[] {
  return db.prepare('SELECT * FROM anomaly_cases ORDER BY id').all() as Record<string, unknown>[];
}

function count(db: SqliteDb, sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}

function addOrder(
  db: SqliteDb,
  id: string,
  status = 'shipping',
  promisedAt: string | null = null,
): void {
  db.prepare(
    'INSERT INTO orders (id, customer_id, currency, amount_minor, promised_at, status) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, `cust-${id}`, 'CNY', 1000, promisedAt, status);
}

function addEvent(db: SqliteDb, id: string, orderId: string, status: string, occurredAt: string): void {
  db.prepare(
    'INSERT INTO logistics_events (id, order_id, status, occurred_at, source) VALUES (?, ?, ?, ?, ?)',
  ).run(id, orderId, status, occurredAt, 'test');
}

function iso(msAgo: number): string {
  return new Date(NOW.getTime() - msAgo).toISOString();
}

afterEach(() => {
  for (const db of dbs) db.close();
  dbs.length = 0;
  dirs.length = 0;
});

it('判据一：停滞订单唯一建案，严重度/触发事件/审计可回查', () => {
  const db = seededDb();
  const summary = detectStalledCases(db, { now: NOW, thresholdHours: THRESHOLD_HOURS });

  expect(summary.scanned).toBe(2);
  expect(summary.createdCaseIds).toEqual([`case-${STALLED_ORDER_ID}-${STALLED_LAST_EVENT_ID}`]);

  const rows = caseRows(db);
  expect(rows).toHaveLength(1);
  const c = rows[0]!;
  expect(c.order_id).toBe(STALLED_ORDER_ID);
  expect(c.type).toBe('logistics_stalled');
  expect(c.severity).toBe('high'); // 承诺送达（24h 前）已过
  expect(c.status).toBe('open');
  expect(c.version).toBe(1);
  expect(c.last_event_id).toBe(STALLED_LAST_EVENT_ID);
  expect(c.occurrence_key).toBe(STALLED_LAST_EVENT_ID);
  expect(c.detected_at).toBe(NOW.toISOString());

  expect(count(db, "SELECT COUNT(*) AS n FROM audit_events WHERE kind = 'case_created'")).toBe(1);
  // 正常对照单不建案
  expect(count(db, 'SELECT COUNT(*) AS n FROM anomaly_cases WHERE order_id = ?', NORMAL_ORDER_ID)).toBe(0);
});

it('判据二：重复扫描不重建（occurrence_key 幂等）', () => {
  const db = seededDb();
  const first = detectStalledCases(db, { now: NOW, thresholdHours: THRESHOLD_HOURS });
  expect(first.createdCaseIds).toHaveLength(1);

  const second = detectStalledCases(db, { now: NOW, thresholdHours: THRESHOLD_HOURS });
  expect(second.createdCaseIds).toEqual([]);
  expect(second.skippedExisting).toBe(1);
  expect(caseRows(db)).toHaveLength(1);
  expect(count(db, "SELECT COUNT(*) AS n FROM audit_events WHERE kind = 'case_created'")).toBe(1);
});

it('判据三：正常对照样本零误报（只有正常单时不建案）', () => {
  const db = seededDb();
  db.prepare('DELETE FROM logistics_events WHERE order_id = ?').run(STALLED_ORDER_ID);
  db.prepare('DELETE FROM orders WHERE id = ?').run(STALLED_ORDER_ID);

  const summary = detectStalledCases(db, { now: NOW, thresholdHours: THRESHOLD_HOURS });
  expect(summary.scanned).toBe(1);
  expect(summary.createdCaseIds).toEqual([]);
  expect(caseRows(db)).toHaveLength(0);
});

it('乱序事件：按 occurred_at 取最新，不依赖插入顺序', () => {
  const db = newDb();
  addOrder(db, 'order-messy');
  // 先插入较新事件，再插入更旧事件——插入顺序与时间顺序相反
  addEvent(db, 'evt-messy-new', 'order-messy', 'in_transit', iso(50 * HOUR));
  addEvent(db, 'evt-messy-old', 'order-messy', 'picked_up', iso(100 * HOUR));

  const summary = detectStalledCases(db, { now: NOW, thresholdHours: THRESHOLD_HOURS });
  // 50h > 48h 建案，且触发事件必须是较新的 evt-messy-new（若误用插入序最后一条 evt-messy-old 则 last_event_id 错）
  expect(summary.createdCaseIds).toEqual([`case-order-messy-evt-messy-new`]);
  const c = caseRows(db).find((row) => row.order_id === 'order-messy')!;
  expect(c.last_event_id).toBe('evt-messy-new');
});

it('缺失事件：运输中但无任何物流事件的订单不建案、不崩溃', () => {
  const db = seededDb();
  addOrder(db, 'order-no-events');

  const summary = detectStalledCases(db, { now: NOW, thresholdHours: THRESHOLD_HOURS });
  expect(summary.scanned).toBe(3);
  expect(caseRows(db)).toHaveLength(1); // 仅 fixture 停滞单
});

it('终态事件：最新事件为 delivered 时不再按停滞处理', () => {
  const db = newDb();
  addOrder(db, 'order-done');
  addEvent(db, 'evt-done-1', 'order-done', 'in_transit', iso(100 * HOUR));
  addEvent(db, 'evt-done-2', 'order-done', 'delivered', iso(2 * HOUR));

  const summary = detectStalledCases(db, { now: NOW, thresholdHours: THRESHOLD_HOURS });
  expect(summary.createdCaseIds).toEqual([]);
  expect(caseRows(db)).toHaveLength(0);
});

it('阈值边界：等于阈值不建案，刚超过才建案', () => {
  const db = newDb();
  addOrder(db, 'order-at-threshold');
  addEvent(db, 'evt-at', 'order-at-threshold', 'in_transit', iso(THRESHOLD_HOURS * HOUR));
  addOrder(db, 'order-over-threshold');
  addEvent(db, 'evt-over', 'order-over-threshold', 'in_transit', iso(THRESHOLD_HOURS * HOUR + 60_000));

  const summary = detectStalledCases(db, { now: NOW, thresholdHours: THRESHOLD_HOURS });
  expect(summary.createdCaseIds).toEqual([`case-order-over-threshold-evt-over`]);
});

it('严重度：承诺送达未过判 medium（fixture 停滞单已覆盖 high）', () => {
  const db = seededDb();
  addOrder(db, 'order-medium', 'shipping', new Date(NOW.getTime() + 24 * HOUR).toISOString());
  addEvent(db, 'evt-medium', 'order-medium', 'in_transit', iso(72 * HOUR));

  detectStalledCases(db, { now: NOW, thresholdHours: THRESHOLD_HOURS });
  const c = caseRows(db).find((row) => row.order_id === 'order-medium')!;
  expect(c.severity).toBe('medium');
});

it('新停滞区间：新事件到达后再次停滞，产生新案件且旧案件保留', () => {
  const db = seededDb();
  detectStalledCases(db, { now: NOW, thresholdHours: THRESHOLD_HOURS });
  expect(caseRows(db)).toHaveLength(1);

  // 新事件 evt-stalled-003（比 evt-stalled-002 新，但仍停滞 70h）
  addEvent(db, 'evt-stalled-003', STALLED_ORDER_ID, 'in_transit', iso(70 * HOUR));
  const second = detectStalledCases(db, { now: NOW, thresholdHours: THRESHOLD_HOURS });

  expect(second.createdCaseIds).toEqual([`case-${STALLED_ORDER_ID}-evt-stalled-003`]);
  expect(second.skippedExisting).toBe(0); // evt-002 的 key 命中走 OR IGNORE，计数为 0 是因为新事件成了最新事件
  const rows = caseRows(db);
  expect(rows).toHaveLength(2); // 旧案件保留 + 新案件
  expect(count(db, "SELECT COUNT(*) AS n FROM audit_events WHERE kind = 'case_created'")).toBe(2);
});

it('非运输中订单（delivered）不参与扫描', () => {
  const db = seededDb();
  addOrder(db, 'order-archived', 'delivered');
  addEvent(db, 'evt-archived', 'order-archived', 'in_transit', iso(200 * HOUR));

  const summary = detectStalledCases(db, { now: NOW, thresholdHours: THRESHOLD_HOURS });
  expect(summary.scanned).toBe(2); // 只扫 fixture 两张 shipping 单
  expect(caseRows(db)).toHaveLength(1);
});

it('损坏时间戳：按缺失处理跳过，不崩溃', () => {
  const db = newDb();
  addOrder(db, 'order-bad-ts');
  addEvent(db, 'evt-bad', 'order-bad-ts', 'in_transit', 'not-a-timestamp');

  const summary = detectStalledCases(db, { now: NOW, thresholdHours: THRESHOLD_HOURS });
  expect(summary.createdCaseIds).toEqual([]);
  expect(caseRows(db)).toHaveLength(0);
});
