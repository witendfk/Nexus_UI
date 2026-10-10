import Koa from 'koa';
import Router from '@koa/router';
import { AGENT_SERVER_VERSION } from '../index';
import type { CatalogContractClient } from '../catalog-contract/client';
import { createRpcRouter } from '../rpc/handler';
import type { RpcGenerator } from '../rpc/handler';

export interface CreateAppOptions {
  contractClient?: CatalogContractClient;
  generate?: RpcGenerator;
}

export function createApp(options: CreateAppOptions = {}): Koa {
  const app = new Koa();
  const router = new Router();

  router.get('/health', (ctx) => {
    ctx.body = {
      status: 'ok',
      service: '@orderops/agent-server',
      apiVersion: AGENT_SERVER_VERSION,
    };
  });

  if (options.contractClient !== undefined && options.generate !== undefined) {
    const rpc = createRpcRouter({ contractClient: options.contractClient, generate: options.generate });
    app.use(rpc.routes());
    app.use(rpc.allowedMethods());
  }

  app.use(router.routes());
  app.use(router.allowedMethods());
  return app;
}
