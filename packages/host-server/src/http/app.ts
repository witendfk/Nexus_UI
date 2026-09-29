import Koa from 'koa';
import Router from '@koa/router';
import { createAgentRouter, sendAgentRun } from '@nexus-ui/server';
import { HOST_SERVER_VERSION } from '../index';
import { createAgentAdapter } from '../nexus/adapter';
import { ORDEROPS_CATALOG } from '../nexus/catalog';

export function createApp(): Koa {
  const app = new Koa();
  const adapter = createAgentAdapter();

  const own = new Router();

  own.get('/health', (ctx) => {
    ctx.body = {
      status: 'ok',
      service: '@orderops/host-server',
      apiVersion: HOST_SERVER_VERSION,
    };
  });

  // 案件生成走自有路由：prepareGeneration 的 message 只允许是案件 ID，
  // 浏览器无法用通用 generate 路由注入任意 prompt（见 architecture.md §5）。
  own.post('/api/cases/:caseId/analyze', async (ctx) => {
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
