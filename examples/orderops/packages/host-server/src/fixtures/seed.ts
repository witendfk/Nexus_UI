import type { SqliteDb } from '../db/client';
import { buildFixtures } from './data';

export interface SeedSummary {
  orders: number;
  events: number;
}

/**
 * 幂等 seed：固定主键 upsert + 事务原子写入。重复执行不产生重复行，
 * 已有行被刷新为最新 fixture 内容（时间相对本次 seed 时刻）。
 */
export function seedFixtures(db: SqliteDb, now: Date): SeedSummary {
  const data = buildFixtures(now);
  const insertOrder = db.prepare(`
    INSERT INTO orders (id, customer_id, currency, amount_minor, promised_at, status)
    VALUES (@id, @customer_id, @currency, @amount_minor, @promised_at, @status)
    ON CONFLICT(id) DO UPDATE SET
      customer_id = excluded.customer_id,
      currency = excluded.currency,
      amount_minor = excluded.amount_minor,
      promised_at = excluded.promised_at,
      status = excluded.status
  `);
  const insertEvent = db.prepare(`
    INSERT INTO logistics_events (id, order_id, status, occurred_at, source)
    VALUES (@id, @order_id, @status, @occurred_at, @source)
    ON CONFLICT(id) DO UPDATE SET
      order_id = excluded.order_id,
      status = excluded.status,
      occurred_at = excluded.occurred_at,
      source = excluded.source
  `);
  db.transaction(() => {
    for (const order of data.orders) insertOrder.run(order);
    for (const event of data.events) insertEvent.run(event);
  })();
  return { orders: data.orders.length, events: data.events.length };
}
