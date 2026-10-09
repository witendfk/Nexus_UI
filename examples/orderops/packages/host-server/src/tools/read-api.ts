import Router from '@koa/router';
import { ReadContextResponseSchema } from '@orderops/contracts';
import type { SqliteDb } from '../db/client';

/**
 * Agent 只读工具入口（T3.1，architecture.md §5）：`GET /internal/cases/:caseId/context`。
 *
 * 鉴权：`Authorization: Bearer <ORDEROPS_INTERNAL_TOKEN>`，host 与 agent 两边共享
 * 同一 token（design.md 环境变量表）。**fail-closed**：token 未配置时一律 401——
 * 内部端点宁可不服务，不在无鉴权状态下暴露案件事实。
 */
export function createInternalRouter(db: SqliteDb): Router {
  const router = new Router();

  router.use('/internal', async (ctx, next) => {
    const expected = process.env.ORDEROPS_INTERNAL_TOKEN;
    const header = ctx.get('authorization');
    const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (expected === undefined || expected === '' || provided !== expected) {
      ctx.status = 401;
      ctx.body = { error: 'UNAUTHORIZED', message: '内部工具需要有效的 ORDEROPS_INTERNAL_TOKEN' };
      return;
    }
    await next();
  });

  router.get('/internal/cases/:caseId/context', (ctx) => {
    const caseId = ctx.params.caseId;
    const caseRow = db
      .prepare(
        'SELECT id, order_id, type, severity, status, version, detected_at, last_event_id FROM anomaly_cases WHERE id = ?',
      )
      .get(caseId) as
      | { id: string; order_id: string; type: string; severity: string; status: string; version: number; detected_at: string; last_event_id: string | null }
      | undefined;
    if (caseRow === undefined) {
      ctx.status = 404;
      ctx.body = { error: 'NOT_FOUND', message: `案件不存在: ${caseId}` };
      return;
    }

    const orderRow = db
      .prepare(
        'SELECT id, customer_id, currency, amount_minor, promised_at, status FROM orders WHERE id = ?',
      )
      .get(caseRow.order_id) as Record<string, unknown> | undefined;
    if (orderRow === undefined) {
      // 外键保证不发生；真发生时按内部错误处理而不是给 Agent 半份快照
      ctx.status = 500;
      ctx.body = { error: 'INTERNAL_ERROR', message: '案件关联的订单缺失' };
      return;
    }

    // 快照事件上限 200（contracts 约束）：取最近的 200 条再反转为升序时间线
    const eventRows = db
      .prepare(
        'SELECT id, order_id, status, occurred_at, source FROM logistics_events WHERE order_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 200',
      )
      .all(caseRow.order_id) as Array<Record<string, unknown>>;
    eventRows.reverse();

    const body = {
      contractVersion: 1 as const,
      caseId: caseRow.id,
      caseVersion: caseRow.version,
      snapshot: {
        case: {
          id: caseRow.id,
          orderId: caseRow.order_id,
          type: caseRow.type,
          severity: caseRow.severity,
          status: caseRow.status,
          detectedAt: caseRow.detected_at,
          lastEventId: caseRow.last_event_id,
        },
        order: {
          id: orderRow.id as string,
          customerId: orderRow.customer_id as string,
          currency: orderRow.currency as string,
          amountMinor: orderRow.amount_minor as number,
          promisedAt: (orderRow.promised_at as string | null) ?? null,
          status: orderRow.status as string,
        },
        events: eventRows.map((row) => ({
          id: row.id as string,
          orderId: row.order_id as string,
          status: row.status as string,
          occurredAt: row.occurred_at as string,
          source: row.source as string,
        })),
        capturedAt: new Date().toISOString(),
      },
    };

    // 出口即契约：生产方自己先过 schema（contracts 是 T2.1 建立的版本化边界）
    ctx.body = ReadContextResponseSchema.parse(body);
  });

  return router;
}
