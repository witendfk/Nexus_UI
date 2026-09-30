import type { CaseSeverity } from '@orderops/contracts';
import type { SqliteDb } from '../db/client';

const HOUR_MS = 3_600_000;

/** 终态物流事件：最新事件处于终态说明运输流程已结束（或取消），不再按停滞处理。 */
const TERMINAL_EVENT_STATUSES = new Set(['delivered', 'cancelled']);

export interface StallDetectionOptions {
  /** 扫描基准时间：测试显式注入，生产传 `new Date()`。 */
  now: Date;
  /** 停滞阈值（小时）：最新有效物流事件距今**超过**该值才建案。来自 `ORDEROPS_STALL_THRESHOLD_HOURS`。 */
  thresholdHours: number;
}

export interface StallDetectionSummary {
  /** 参与扫描的运输中订单数。 */
  scanned: number;
  /** 本次新创建的案件 ID（确定性格式 `case-{orderId}-{eventId}`）。 */
  createdCaseIds: string[];
  /** 因同停滞区间已有案件而跳过的次数（幂等命中）。 */
  skippedExisting: number;
}

interface LatestEventRow {
  id: string;
  status: string;
  occurred_at: string;
}

/**
 * T2.4 首条检测规则（architecture.md §4）：仅扫描运输中（status='shipping'）的订单，
 * 最新物流事件距今超过阈值即建 `logistics_stalled` 案件，严重度结合承诺送达时间判定。
 *
 * - 乱序：按 `occurred_at`（`id` 兜底排序键）取最新，不依赖插入顺序；
 * - 缺失/损坏：无事件、时间不可解析的订单跳过——事实缺失不交给模型补造；
 * - 幂等：`occurrence_key =` 触发事件 ID，`UNIQUE(order_id, occurrence_key)` 兜底
 *   重复扫描；之后的新停滞以新事件为 key，自然产生新案件；
 * - 建案同时写一条 `case_created` 审计事件（含阈值与停滞时长，供回查）。
 */
export function detectStalledCases(
  db: SqliteDb,
  options: StallDetectionOptions,
): StallDetectionSummary {
  const nowMs = options.now.getTime();
  const detectedAt = options.now.toISOString();
  const summary: StallDetectionSummary = { scanned: 0, createdCaseIds: [], skippedExisting: 0 };

  const orders = db
    .prepare("SELECT id, promised_at FROM orders WHERE status = 'shipping'")
    .all() as Array<{ id: string; promised_at: string | null }>;
  const latestEventStmt = db.prepare(
    'SELECT id, status, occurred_at FROM logistics_events WHERE order_id = ? ' +
      'ORDER BY occurred_at DESC, id DESC LIMIT 1',
  );
  const insertCaseStmt = db.prepare(`
    INSERT OR IGNORE INTO anomaly_cases
      (id, order_id, type, occurrence_key, severity, status, version, detected_at, last_event_id)
    VALUES (?, ?, 'logistics_stalled', ?, ?, 'open', 1, ?, ?)
  `);
  const insertAuditStmt = db.prepare(`
    INSERT OR IGNORE INTO audit_events (id, case_id, kind, actor, payload, created_at)
    VALUES (?, ?, 'case_created', 'stall-detector', ?, ?)
  `);

  db.transaction(() => {
    for (const order of orders) {
      summary.scanned += 1;
      const latest = latestEventStmt.get(order.id) as LatestEventRow | undefined;
      if (latest === undefined) continue; // 缺失事件：无法计算停滞时长
      if (TERMINAL_EVENT_STATUSES.has(latest.status)) continue; // 运输流程已结束
      const lastMs = Date.parse(latest.occurred_at);
      if (!Number.isFinite(lastMs)) continue; // 损坏时间戳按缺失处理
      const stallHours = (nowMs - lastMs) / HOUR_MS;
      if (stallHours <= options.thresholdHours) continue; // 边界：等于阈值不算停滞

      const promisedMs = order.promised_at === null ? NaN : Date.parse(order.promised_at);
      const severity: CaseSeverity =
        Number.isFinite(promisedMs) && promisedMs < nowMs ? 'high' : 'medium';
      const caseId = `case-${order.id}-${latest.id}`;
      const info = insertCaseStmt.run(caseId, order.id, latest.id, severity, detectedAt, latest.id);
      if (info.changes === 0) {
        summary.skippedExisting += 1;
        continue;
      }
      insertAuditStmt.run(
        `audit-${caseId}`,
        caseId,
        JSON.stringify({
          thresholdHours: options.thresholdHours,
          stallHours: Math.round(stallHours * 10) / 10,
          lastEventId: latest.id,
        }),
        detectedAt,
      );
      summary.createdCaseIds.push(caseId);
    }
  })();

  return summary;
}
