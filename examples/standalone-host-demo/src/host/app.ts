import Koa from 'koa';
import cors from '@koa/cors';
import { createAgentRouter } from '@nexus-ui/server';
import { createStandaloneHostAdapter } from './adapter';
import type { StandaloneHostAdapterOptions } from './adapter';
import { createLocalApprovalActionHandler } from './local-action';
import type { StandaloneHostActionMode } from '../shared/action-mode';
import { standaloneHostCatalog } from '../shared/catalog-contract';

export interface StandaloneHostAppOptions extends Omit<
  StandaloneHostAdapterOptions,
  'actionHandler'
> {
  actionMode?: StandaloneHostActionMode;
  maxRequestBodyBytes?: number;
  requestBodyTimeoutMs?: number;
}

/**
 * Assemble a host-owned HTTP surface without the playground's built-in catalogs.
 * The host remains responsible for endpoint credentials and deployment policy.
 */
export function createStandaloneHostApp(options: StandaloneHostAppOptions): Koa {
  const { actionMode = 'external', ...adapterOptions } = options;
  const adapter = createStandaloneHostAdapter({
    ...adapterOptions,
    actionHandler: actionMode === 'local' ? createLocalApprovalActionHandler() : undefined,
  });
  const router = createAgentRouter({
    adapter,
    healthAgentMode: 'external-rpc',
    healthActionMode: actionMode,
    maxRequestBodyBytes: options.maxRequestBodyBytes,
    requestBodyTimeoutMs: options.requestBodyTimeoutMs,
    catalogContracts: [standaloneHostCatalog],
  });
  const app = new Koa();

  app.use(cors());
  app.use(router.routes());
  app.use(router.allowedMethods());
  return app;
}
