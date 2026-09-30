import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openDatabase, type SqliteDb } from '../../src/db/client';
import {
  buildFixtures,
  NORMAL_ORDER_ID,
  STALLED_LAST_EVENT_ID,
  STALLED_ORDER_ID,
} from '../../src/fixtures/data';
import { seedFixtures } from '../../src/fixtures/seed';

const dbs: SqliteDb[] = [];
const dirs: string[] = [];

function newDb(): SqliteDb {
  const dir = mkdtempSync(join(tmpdir(), 'orderops-fixture-'));
  dirs.push(dir);
  const db = openDatabase(join(dir, 'test.sqlite'), fileMigrationsDir());
  dbs.push(db);
  return db;
}

function fileMigrationsDir(): string {
  return new URL('../../src/db/migrations', import.meta.url).pathname;
}

function count(db: SqliteDb, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

afterEach(() => {
  for (const db of dbs) db.close();
  dbs.length = 0;
});

it('seed 可重复执行：两次后行数不变、无重复事件', () => {
  const db = newDb();
  const first = seedFixtures(db, new Date());
  expect(first).toEqual({ orders: 2, events: 5 });

  seedFixtures(db, new Date(Date.now() + 60_000));
  expect(count(db, 'orders')).toBe(2);
  expect(count(db, 'logistics_events')).toBe(5);
  const distinctEvents = db.prepare('SELECT COUNT(DISTINCT id) AS n FROM logistics_events').get() as {
    n: number;
  };
  expect(distinctEvents.n).toBe(5);
});

it('内容锚点：停滞单 72h 无更新且已逾期；正常单 1h 前仍有事件', () => {
  const now = new Date('2026-09-29T12:00:00.000Z');
  const db = newDb();
  seedFixtures(db, now);
  const data = buildFixtures(now);

  const stalledLast = db
    .prepare(
      'SELECT occurred_at FROM logistics_events WHERE order_id = ? ORDER BY occurred_at DESC LIMIT 1',
    )
    .get(STALLED_ORDER_ID) as { occurred_at: string };
  expect(stalledLast.occurred_at).toBe(data.events[1].occurred_at);
  expect(Date.parse(stalledLast.occurred_at)).toBe(now.getTime() - 72 * 3_600_000);

  const stalledOrder = db.prepare('SELECT promised_at FROM orders WHERE id = ?').get(STALLED_ORDER_ID) as {
    promised_at: string;
  };
  expect(Date.parse(stalledOrder.promised_at)).toBeLessThan(now.getTime());

  const normalLast = db
    .prepare(
      'SELECT occurred_at FROM logistics_events WHERE order_id = ? ORDER BY occurred_at DESC LIMIT 1',
    )
    .get(NORMAL_ORDER_ID) as { occurred_at: string };
  expect(Date.parse(normalLast.occurred_at)).toBe(now.getTime() - 1 * 3_600_000);
});

it('触发事件可回查：evt-stalled-002 存在且属于停滞单', () => {
  const db = newDb();
  seedFixtures(db, new Date());
  const event = db
    .prepare('SELECT order_id, status FROM logistics_events WHERE id = ?')
    .get(STALLED_LAST_EVENT_ID) as { order_id: string; status: string } | undefined;
  expect(event).toEqual({ order_id: STALLED_ORDER_ID, status: 'in_transit' });
});

it('重复 seed 刷新同一单的时间戳（相对当前时刻，不产生僵尸旧数据）', () => {
  const db = newDb();
  const now1 = new Date('2026-09-01T00:00:00.000Z');
  seedFixtures(db, now1);
  const now2 = new Date('2026-09-29T00:00:00.000Z');
  seedFixtures(db, now2);

  const promised = db.prepare('SELECT promised_at FROM orders WHERE id = ?').get(
    STALLED_ORDER_ID,
  ) as { promised_at: string };
  expect(promised.promised_at).toBe(buildFixtures(now2).orders[0].promised_at);
});
