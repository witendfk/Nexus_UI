import Koa from 'koa';
import Router from '@koa/router';
import { createAgentRouter, sendAgentRun } from '@nexus-ui/server';
import { HOST_SERVER_VERSION } from '../index';
import { createAgentAdapter } from '../nexus/adapter';
import { ORDEROPS_CATALOG } from '../nexus/catalog';
import { createCasesRouter } from './cases';
import { admitAnalyze, ANALYZABLE_CASE_STATUSES } from '../cases/analyze-guard';
import { createInternalRouter } from '../tools/read-api';
import type { SqliteDb } from '../db/client';

export interface CreateAppOptions {
  /** 案件存储；未提供时 /api/cases* 返回 503（存储未接线）。 */
  db?: SqliteDb;
}

export function createApp(options: CreateAppOptions = {}): Koa {
  const app = new Koa();
  const adapter = createAgentAdapter();
  if (options.db !== undefined) {
    // 内部只读工具：鉴权在 router 内 fail-closed（ORDEROPS_INTERNAL_TOKEN）
    const internalRouter = createInternalRouter(options.db);
    app.use(internalRouter.routes());
    app.use(internalRouter.allowedMethods());
  }

  const own = new Router();

  own.get('/health', (ctx) => {
    ctx.body = {
      status: 'ok',
      service: '@orderops/host-server',
      apiVersion: HOST_SERVER_VERSION,
    };
  });

  const casesRouter = createCasesRouter(options.db);
  own.use(casesRouter.routes());
  own.use(casesRouter.allowedMethods());

  // 案件生成走自有路由：analyze 前核对案件存在与状态（T3.3b，docs/ARCHITECTURE.md §3），
  // 自由 message 不能经任何入口绕过只读案件边界。
  own.post('/api/cases/:caseId/analyze', async (ctx) => {
    if (options.db === undefined) {
      ctx.status = 503;
      ctx.body = { error: 'SERVICE_UNAVAILABLE', message: '案件存储未接线' };
      return;
    }
    const admission = admitAnalyze(options.db, ctx.params.caseId);
    if (!admission.ok) {
      if (admission.reason === 'not_found') {
        ctx.status = 404;
        ctx.body = { error: 'NOT_FOUND', message: `案件不存在: ${ctx.params.caseId}` };
      } else {
        ctx.status = 409;
        ctx.body = {
          error: 'CASE_NOT_ANALYZABLE',
          message: `案件状态 ${admission.status} 不允许分析（仅 ${ANALYZABLE_CASE_STATUSES.join('/')} 可分析）`,
        };
      }
      return;
    }
    const plan = await adapter.prepareGeneration({
      message: ctx.params.caseId,
      catalogId: ORDEROPS_CATALOG.catalogId,
    });
    if (!plan.ok) {
      ctx.status = 400;
      ctx.body = { error: 'INVALID_REQUEST', message: plan.message };
      return;
    }
    const surfaceId = plan.run.sequence.surfaceId;
    await sendAgentRun(ctx, plan.run, `${surfaceId}:analyze`, { streamDelayMs: 0 });
  });

  // T3.3b（docs/tasks/CURRENT.md）：业务宿主下线参考程序的自由 generate 路由，
  // 任意 message 不能经通用入口创建 surface；案件生成只走上面的 analyze 入口。
  app.use(async (ctx, next) => {
    if (ctx.method === 'POST' && ctx.path === '/api/a2ui/generate') {
      ctx.status = 404;
      ctx.body = {
        error: 'ROUTE_DISABLED',
        message: '自由 generate 已下线：案件生成只经 POST /api/cases/:caseId/analyze',
      };
      return;
    }
    await next();
  });

  const nexusRouter = createAgentRouter({
    adapter,
    catalogContracts: [ORDEROPS_CATALOG],
    streamDelayMs: 0,
  });

  app.use(own.routes());
  app.use(own.allowedMethods());
  app.use(nexusRouter.routes());
  app.use(nexusRouter.allowedMethods());
  return app;
}
