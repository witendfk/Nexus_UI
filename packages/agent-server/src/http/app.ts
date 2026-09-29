import Koa from 'koa';
import Router from '@koa/router';
import { AGENT_SERVER_VERSION } from '../index';

export function createApp(): Koa {
  const app = new Koa();
  const router = new Router();

  router.get('/health', (ctx) => {
    ctx.body = {
      status: 'ok',
      service: '@orderops/agent-server',
      apiVersion: AGENT_SERVER_VERSION,
    };
  });

  app.use(router.routes());
  app.use(router.allowedMethods());
  return app;
}
