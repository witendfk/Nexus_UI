import Koa from 'koa';
import cors from '@koa/cors';
import { createAgentRouter, NEXUS_RUN_ID_HEADER } from '@nexus-ui/server';
import { createStandaloneHostAdapter } from './adapter';
import type { StandaloneHostAdapterOptions } from './adapter';
import { createLocalApprovalActionHandler } from './local-action';
import type { StandaloneHostActionMode } from '../shared/action-mode';
import { standaloneHostCatalog } from '../shared/catalog-contract';
import { scorecardHostCatalog } from '../shared/scorecard-contract';

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
    // S2.6.2.2：审批与中立反馈两个 Catalog 都经实际装配发布；装配期与执行声明核对。
    catalogContracts: [standaloneHostCatalog, scorecardHostCatalog],
    agentOnboarding: {
      rpcEndpoint: adapterOptions.endpoint,
      verificationCommand: `pnpm --filter @nexus-ui/standalone-host-demo verify -- --endpoint ${adapterOptions.endpoint}`,
    },
  });
  const app = new Koa();

  // S2.5.4：SSE 响应携带运行标识，跨源客户端可读需显式暴露。
  // 在宿主已有暴露头（当前为空）上合并；只增补暴露，不接管 CORS 授权策略。
  const hostExposeHeaders: string[] = [];
  const exposeHeaders = [...new Set([...hostExposeHeaders, NEXUS_RUN_ID_HEADER])];
  app.use(cors({ exposeHeaders }));
  app.use(router.routes());
  app.use(router.allowedMethods());
  return app;
}
