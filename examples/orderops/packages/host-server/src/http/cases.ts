import Router from '@koa/router';
import type { CaseSeverity, CaseStatus } from '@orderops/contracts';
import { CaseSeveritySchema, CaseStatusSchema } from '@orderops/contracts';
import type { SqliteDb } from '../db/client';
import { getCaseDetail, listCases } from '../cases/repository';

/**
 * 案件查询路由（T2.5）：队列筛选/搜索 + 详情回查。
 * 查询参数经 contracts zod 枚举校验，非法值 400（不静默忽略）。
 * db 未接线时显式 503——路由存在但后端不可用，不用 404 冒充。
 */
export function createCasesRouter(db: SqliteDb | undefined): Router {
  const router = new Router();

  const requireDb = (ctx: Router.RouterContext): db is SqliteDb => {
    if (db !== undefined) return true;
    ctx.status = 503;
    ctx.body = { error: 'SERVICE_UNAVAILABLE', message: '案件存储未接线' };
    return false;
  };

  router.get('/api/cases', (ctx) => {
    if (!requireDb(ctx)) return;
    const filters: { status?: CaseStatus; severity?: CaseSeverity; q?: string } = {};
    if (ctx.query.status !== undefined) {
      const parsed = CaseStatusSchema.safeParse(ctx.query.status);
      if (!parsed.success) {
        ctx.status = 400;
        ctx.body = { error: 'INVALID_REQUEST', message: `非法 status: ${String(ctx.query.status)}` };
        return;
      }
      filters.status = parsed.data;
    }
    if (ctx.query.severity !== undefined) {
      const parsed = CaseSeveritySchema.safeParse(ctx.query.severity);
      if (!parsed.success) {
        ctx.status = 400;
        ctx.body = {
          error: 'INVALID_REQUEST',
          message: `非法 severity: ${String(ctx.query.severity)}`,
        };
        return;
      }
      filters.severity = parsed.data;
    }
    if (ctx.query.q !== undefined) filters.q = String(ctx.query.q);
    ctx.body = { cases: listCases(db, filters) };
  });

  router.get('/api/cases/:caseId', (ctx) => {
    if (!requireDb(ctx)) return;
    const detail = getCaseDetail(db, ctx.params.caseId);
    if (detail === null) {
      ctx.status = 404;
      ctx.body = { error: 'NOT_FOUND', message: `案件不存在: ${ctx.params.caseId}` };
      return;
    }
    ctx.body = detail;
  });

  return router;
}
