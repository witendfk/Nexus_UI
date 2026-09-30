import type {
  CaseSeverity,
  CaseStatus,
  CaseSummary,
  LogisticsEvent,
  OrderFacts,
} from '@orderops/contracts';
import type { SqliteDb } from '../db/client';

export interface CaseListFilters {
  status?: CaseStatus;
  severity?: CaseSeverity;
  /** 模糊搜索：匹配案件 ID 或订单 ID 子串（`%`/`_` 按字面量处理）。 */
  q?: string;
}

export interface CaseDetail {
  case: CaseSummary;
  order: OrderFacts;
  /** 物流时间线：按发生时间升序。 */
  events: LogisticsEvent[];
}

function mapCaseSummary(row: Record<string, unknown>): CaseSummary {
  return {
    id: row.id as string,
    orderId: row.order_id as string,
    type: row.type as CaseSummary['type'],
    severity: row.severity as CaseSummary['severity'],
    status: row.status as CaseSummary['status'],
    detectedAt: row.detected_at as string,
    lastEventId: (row.last_event_id as string | null) ?? null,
  };
}

function mapOrderFacts(row: Record<string, unknown>): OrderFacts {
  return {
    id: row.id as string,
    customerId: row.customer_id as string,
    currency: row.currency as string,
    amountMinor: row.amount_minor as number,
    promisedAt: (row.promised_at as string | null) ?? null,
    status: row.status as string,
  };
}

function mapLogisticsEvent(row: Record<string, unknown>): LogisticsEvent {
  return {
    id: row.id as string,
    orderId: row.order_id as string,
    status: row.status as string,
    occurredAt: row.occurred_at as string,
    source: row.source as string,
  };
}

/**
 * 案件队列查询（T2.5）：按 status/severity 过滤、q 模糊匹配案件/订单 ID，
 * 检测时间倒序（id 兜底确定性次序）。全部参数化，无字符串拼接值。
 */
export function listCases(db: SqliteDb, filters: CaseListFilters = {}): CaseSummary[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.status !== undefined) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  if (filters.severity !== undefined) {
    clauses.push('severity = ?');
    params.push(filters.severity);
  }
  if (filters.q !== undefined && filters.q !== '') {
    // LIKE 通配符按字面量匹配：q 是用户输入的搜索词，不是模式
    const literal = filters.q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    clauses.push("(id LIKE ? ESCAPE '\\' OR order_id LIKE ? ESCAPE '\\')");
    params.push(`%${literal}%`, `%${literal}%`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT id, order_id, type, severity, status, detected_at, last_event_id
       FROM anomaly_cases ${where} ORDER BY detected_at DESC, id ASC`,
    )
    .all(...params) as Record<string, unknown>[];
  return rows.map(mapCaseSummary);
}

/** 案件详情（T2.5 判据：事件 ID、时间、来源可回查）；案件不存在返回 null。 */
export function getCaseDetail(db: SqliteDb, caseId: string): CaseDetail | null {
  const caseRow = db
    .prepare(
      'SELECT id, order_id, type, severity, status, detected_at, last_event_id FROM anomaly_cases WHERE id = ?',
    )
    .get(caseId) as Record<string, unknown> | undefined;
  if (caseRow === undefined) return null;

  const orderRow = db
    .prepare(
      'SELECT id, customer_id, currency, amount_minor, promised_at, status FROM orders WHERE id = ?',
    )
    .get(caseRow.order_id) as Record<string, unknown> | undefined;
  if (orderRow === undefined) return null; // 外键保证不发生；防御式收窄类型

  const eventRows = db
    .prepare(
      'SELECT id, order_id, status, occurred_at, source FROM logistics_events WHERE order_id = ? ORDER BY occurred_at ASC, id ASC',
    )
    .all(caseRow.order_id) as Record<string, unknown>[];

  return {
    case: mapCaseSummary(caseRow),
    order: mapOrderFacts(orderRow),
    events: eventRows.map(mapLogisticsEvent),
  };
}
