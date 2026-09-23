import Koa from 'koa';
import cors from '@koa/cors';
import { createAgentRouter } from '../../../../server/nexus-playground-server/src/api/routes';
import { createStandaloneHostAdapter } from './adapter';
import type { StandaloneHostAdapterOptions } from './adapter';

export interface StandaloneHostAppOptions extends StandaloneHostAdapterOptions {
  maxRequestBodyBytes?: number;
  requestBodyTimeoutMs?: number;
}

/**
 * Assemble a host-owned HTTP surface without the playground's built-in catalogs.
 * The host remains responsible for endpoint credentials and deployment policy.
 */
export function createStandaloneHostApp(options: StandaloneHostAppOptions): Koa {
  const adapter = createStandaloneHostAdapter(options);
  const router = createAgentRouter({
    adapter,
    healthAgentMode: 'external-rpc',
    maxRequestBodyBytes: options.maxRequestBodyBytes,
    requestBodyTimeoutMs: options.requestBodyTimeoutMs,
  });
  const app = new Koa();

  app.use(cors());
  app.use(router.routes());
  app.use(router.allowedMethods());
  return app;
}
