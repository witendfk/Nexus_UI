/**
 * Fixture 事实数据：两条**订单事实**（非案件——案件由检测器扫描产出）。
 * - 停滞单：最后事件在 72h 前，且承诺送达时间已过（预期被判为 high 停滞案件）；
 * - 正常对照单：1h 前仍有新事件，承诺时间未到（预期不建案）。
 * 所有时间相对 seed 时刻生成，保证任意时间运行的可复现性。
 */

const HOUR = 3_600_000;

export interface FixtureOrderRow {
  id: string;
  customer_id: string;
  currency: string;
  amount_minor: number;
  promised_at: string;
  status: string;
}

export interface FixtureEventRow {
  id: string;
  order_id: string;
  status: string;
  occurred_at: string;
  source: string;
}

export interface FixtureData {
  orders: FixtureOrderRow[];
  events: FixtureEventRow[];
}

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

export function buildFixtures(now: Date): FixtureData {
  const t = now.getTime();
  return {
    orders: [
      {
        id: 'order-stalled-001',
        customer_id: 'cust-1001',
        currency: 'CNY',
        amount_minor: 129_900,
        promised_at: iso(t - 24 * HOUR),
        status: 'shipping',
      },
      {
        id: 'order-normal-001',
        customer_id: 'cust-1002',
        currency: 'CNY',
        amount_minor: 5_800,
        promised_at: iso(t + 72 * HOUR),
        status: 'shipping',
      },
    ],
    events: [
      {
        id: 'evt-stalled-001',
        order_id: 'order-stalled-001',
        status: 'picked_up',
        occurred_at: iso(t - 96 * HOUR),
        source: 'carrier-api',
      },
      {
        // 停滞区间起点：检测器建案后 last_event_id 应可回查到此事件。
        id: 'evt-stalled-002',
        order_id: 'order-stalled-001',
        status: 'in_transit',
        occurred_at: iso(t - 72 * HOUR),
        source: 'carrier-api',
      },
      {
        id: 'evt-normal-001',
        order_id: 'order-normal-001',
        status: 'picked_up',
        occurred_at: iso(t - 30 * HOUR),
        source: 'carrier-api',
      },
      {
        id: 'evt-normal-002',
        order_id: 'order-normal-001',
        status: 'in_transit',
        occurred_at: iso(t - 2 * HOUR),
        source: 'carrier-api',
      },
      {
        id: 'evt-normal-003',
        order_id: 'order-normal-001',
        status: 'out_for_delivery',
        occurred_at: iso(t - 1 * HOUR),
        source: 'carrier-api',
      },
    ],
  };
}

/** fixture 固定 ID，供检测器与测试按名引用。 */
export const STALLED_ORDER_ID = 'order-stalled-001';
export const STALLED_LAST_EVENT_ID = 'evt-stalled-002';
export const NORMAL_ORDER_ID = 'order-normal-001';
