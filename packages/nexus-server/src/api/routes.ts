import type Koa from 'koa';
import Router from '@koa/router';
import { CatalogRegistry, createCatalogPromptContract } from '@nexus-ui/core';
import type { CatalogDefinition } from '@nexus-ui/core';

import type { AgentAdapter, AgentAccessHooks } from '../agent/adapter';
import type { AgentRunManager, AgentRunRecord } from '../agent/run-manager';
import type { EnqueueOutcome } from '../runtime/agent-runtime';
import { parseNexusActionRequest } from './nexus-request';
import { isRecord, readJsonBody } from './request';
import { sendAgentRun } from './send-messages';
import { registerSurfaceStateQueryRoute } from './surface-state';
import { SERVER_API_VERSION } from '../version';
import {
  createAgentOnboardingContract,
  type AgentOnboardingContractPayload,
} from './agent-onboarding';
import { CATALOG_CONTRACT_VERSION, createCatalogContractHash } from '../agent/catalog-contract';

function invalidRequest(ctx: Koa.Context, message: string): void {
  ctx.status = 400;
  ctx.body = { error: 'INVALID_REQUEST', message };
}

/**
 * 入队拒绝 → HTTP 状态映射（SPEC §5.4 状态码表）：容量 503（RUN_CAPACITY_
 * REJECTED，可稍后重试）、access 未配置/拒绝 403、其余请求级错误保持 400。
 * 全部发生在响应占用之前：无 SSE 头、无运行记录。
 */
function respondEnqueueRejection(
  ctx: Koa.Context,
  outcome: Extract<EnqueueOutcome, { accepted: false }>,
): void {
  if (outcome.stage === 'capacity') {
    ctx.status = 503;
    ctx.body = {
      error: outcome.code ?? 'RUN_CAPACITY_REJECTED',
      message: outcome.message,
    };
    return;
  }
  if (
    outcome.code === 'GENERATE_ACCESS_NOT_CONFIGURED' ||
    outcome.code === 'GENERATE_ACCESS_DENIED' ||
    outcome.code === 'ACTION_ACCESS_NOT_CONFIGURED' ||
    outcome.code === 'ACTION_ACCESS_DENIED'
  ) {
    ctx.status = 403;
    ctx.body = { error: outcome.code, message: outcome.message };
    return;
  }
  invalidRequest(ctx, outcome.message);
}

export interface AgentRouterOptions {
  adapter: AgentAdapter;
  /** Optional health-report override for assemblies that replace the default Agent mode. */
  healthAgentMode?: string;
  /** Optional health-report override for assemblies that replace the default action dispatch policy. */
  healthActionMode?: string;
  maxRequestBodyBytes?: number;
  requestBodyTimeoutMs?: number;
  /** Catalogs the host explicitly publishes to external Agent developers. */
  readonly catalogContracts?: readonly CatalogDefinition[];
  /** Optional onboarding publication details; never inferred from adapter internals. */
  agentOnboarding?: {
    rpcEndpoint?: string;
    verificationCommand?: string;
  };
  /** Demo-only pacing; production assemblies should omit this delay. */
  streamDelayMs?: number;
  /** Optional assertion of the adapter owner; inject custom storage at AgentAdapter.runManager. */
  runManager?: AgentRunManager;
  /**
   * Host access hooks for the query routes (`access.read`, SPEC §6.5). When
   * omitted here, the routes fall back to the adapter's `access.read`; when
   * neither exists, every query is denied with 403 RUNS_ACCESS_NOT_CONFIGURED —
   * the SDK never allows surfaceId enumeration by default. generate/action
   * access is enforced by the adapter itself before enqueue; the routes only
   * hand the trusted Koa context to it and map rejections to status codes.
   */
  access?: AgentAccessHooks;
}

export interface CatalogContractPayload {
  readonly serverApiVersion: 1;
  readonly kind: 'catalog-contract';
  readonly contractVersion: typeof CATALOG_CONTRACT_VERSION;
  readonly contractHash: string;
  readonly catalog: CatalogDefinition;
  readonly promptContract: string;
}

export type { AgentOnboardingContractPayload };

export interface PublishedCatalogSummary {
  readonly catalogId: string;
  readonly contractVersion: typeof CATALOG_CONTRACT_VERSION;
  readonly contractHash: string;
  readonly components: readonly string[];
  /** v2 声明数量；components 为组件名列表（对外摘要保持字符串数组）。 */
  readonly actions: readonly string[];
  readonly catalogContractUrl: string;
  readonly agentOnboardingUrl: string;
}

export interface PublishedCatalogsPayload {
  readonly serverApiVersion: 1;
  readonly kind: 'published-catalog-list';
  readonly catalogs: readonly PublishedCatalogSummary[];
}

export interface AgentRunListPayload {
  readonly serverApiVersion: 1;
  readonly kind: 'agent-run-list';
  readonly runs: readonly AgentRunRecord[];
}

function contractUrl(ctx: Koa.Context, path: string, catalogId: string): string {
  const url = new URL(path, ctx.origin);
  url.searchParams.set('catalogId', catalogId);
  return url.toString();
}

/**
 * S2.5.5：发布内容与执行契约一致。装配期先复制再校验，hash、prompt 与发布的
 * catalog 全部来自同一份独立副本——初始化后修改调用方对象不能造成内容/hash
 * 分裂。注册闸门复用 core 既有规则，不复制通用 schema 解释器。
 */
function buildPublishedCatalogContract(
  catalog: CatalogDefinition,
  adapter: AgentAdapter,
): CatalogContractPayload {
  const published = structuredClone(catalog);
  try {
    new CatalogRegistry([published]);
  } catch (error) {
    throw new Error(
      `公开 Catalog 未通过注册校验: ${published.catalogId} (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }
  const actual = adapter.describeCatalog(published.catalogId);
  if (!actual || createCatalogContractHash(actual) !== createCatalogContractHash(published)) {
    throw new Error(`公开 Catalog 与 adapter 实际执行契约不一致: ${published.catalogId}`);
  }
  return {
    serverApiVersion: SERVER_API_VERSION,
    kind: 'catalog-contract',
    contractVersion: CATALOG_CONTRACT_VERSION,
    contractHash: createCatalogContractHash(published),
    catalog: published,
    promptContract: createCatalogPromptContract(published),
  };
}

function createRequestAbortSignal(ctx: Koa.Context): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const abort = (): void => {
    if (!ctx.res.writableEnded) controller.abort();
  };
  ctx.req.once('aborted', abort);
  ctx.res.once('close', abort);
  return {
    signal: controller.signal,
    dispose: () => {
      ctx.req.off('aborted', abort);
      ctx.res.off('close', abort);
    },
  };
}

export function createAgentRouter(options: AgentRouterOptions): Router {
  const router = new Router();
  const runManager = options.adapter.runManager;
  if (options.runManager !== undefined && options.runManager !== runManager) {
    throw new Error('router runManager 必须与 adapter 的 runManager 所有者一致');
  }
  // 查询准入单一来源（SPEC §6.5/§6.7）：路由级 access.read 优先，缺省回落
  // adapter 装配的 read 钩子；两者都缺省时查询一律 403。
  const readAccess = options.access?.read ?? options.adapter.access?.read;
  const catalogContracts = new Map<string, CatalogContractPayload>();
  for (const catalog of options.catalogContracts ?? []) {
    const payload = buildPublishedCatalogContract(catalog, options.adapter);
    if (catalogContracts.has(payload.catalog.catalogId)) {
      throw new Error(`Catalog contract 重复公开: ${payload.catalog.catalogId}`);
    }
    catalogContracts.set(payload.catalog.catalogId, payload);
  }

  const onboardingContracts = new Map<string, AgentOnboardingContractPayload>();
  for (const [catalogId, catalogContract] of catalogContracts) {
    onboardingContracts.set(
      catalogId,
      createAgentOnboardingContract({
        catalogContract,
        rpcEndpoint: options.agentOnboarding?.rpcEndpoint,
        verificationCommand: options.agentOnboarding?.verificationCommand,
      }),
    );
  }

  router.get('/health', (ctx) => {
    ctx.body = {
      status: 'ok',
      service: '@nexus-ui/server',
      version: '0.1.0',
      agentMode: options.healthAgentMode ?? 'default',
      actionMode: options.healthActionMode ?? 'adapter',
    };
  });

  router.post('/api/a2ui/generate', async (ctx) => {
    let body: unknown;
    try {
      body = await readJsonBody(ctx.req, {
        maxBodySize: options.maxRequestBodyBytes,
        timeoutMs: options.requestBodyTimeoutMs,
      });
    } catch (error) {
      invalidRequest(ctx, error instanceof Error ? error.message : '请求体解析失败');
      return;
    }
    if (!isRecord(body)) {
      invalidRequest(ctx, '请求体必须是 JSON 对象');
      return;
    }
    if (body.message !== undefined && typeof body.message !== 'string') {
      invalidRequest(ctx, 'message 必须是字符串');
      return;
    }
    if (body.catalogId !== undefined && typeof body.catalogId !== 'string') {
      invalidRequest(ctx, 'catalogId 必须是字符串');
      return;
    }
    if (!Object.keys(body).every((key) => key === 'message' || key === 'catalogId')) {
      invalidRequest(ctx, '生成请求包含未知字段');
      return;
    }

    const requestAbort = createRequestAbortSignal(ctx);
    // access.generate 由 adapter 在入队前评估（缺省拒绝）；Koa Context 只作
    // 可信上下文透传，宿主闭包自行提取身份，SDK 不解释其内容。
    let outcome: EnqueueOutcome;
    try {
      outcome = await options.adapter.enqueueGeneration(
        {
          message: typeof body.message === 'string' ? body.message : undefined,
          catalogId: typeof body.catalogId === 'string' ? body.catalogId : undefined,
        },
        { signal: requestAbort.signal, context: ctx },
      );
    } catch (error) {
      requestAbort.dispose();
      throw error;
    }
    if (!outcome.accepted) {
      requestAbort.dispose();
      respondEnqueueRejection(ctx, outcome);
      return;
    }

    try {
      void sendAgentRun(ctx, outcome.run, {
        ...(options.streamDelayMs === undefined ? {} : { streamDelayMs: options.streamDelayMs }),
        manager: runManager,
        signal: requestAbort.signal,
      });
    } finally {
      // sender 已同步接管连接监听；占用失败时也释放入队阶段的监听。
      requestAbort.dispose();
    }
  });

  router.get('/api/a2ui/catalog-contract', (ctx) => {
    const catalogId = ctx.query.catalogId;
    if (typeof catalogId !== 'string' || catalogId === '') {
      invalidRequest(ctx, 'catalogId 必须是非空字符串');
      return;
    }

    const contract = catalogContracts.get(catalogId);
    if (!contract) {
      ctx.status = 404;
      ctx.body = {
        error: 'CATALOG_CONTRACT_NOT_FOUND',
        message: '该 catalog contract 未公开',
      };
      return;
    }

    ctx.body = contract;
  });

  router.get('/api/a2ui/published-catalogs', (ctx) => {
    const catalogs: PublishedCatalogSummary[] = [...catalogContracts.values()].map((contract) => ({
      catalogId: contract.catalog.catalogId,
      contractVersion: contract.contractVersion,
      contractHash: contract.contractHash,
      components: Object.keys(contract.catalog.components),
      actions: contract.catalog.actions.map((action) => action.name),
      catalogContractUrl: contractUrl(
        ctx,
        '/api/a2ui/catalog-contract',
        contract.catalog.catalogId,
      ),
      agentOnboardingUrl: contractUrl(
        ctx,
        '/api/a2ui/agent-onboarding',
        contract.catalog.catalogId,
      ),
    }));

    ctx.body = {
      serverApiVersion: SERVER_API_VERSION,
      kind: 'published-catalog-list',
      catalogs,
    } satisfies PublishedCatalogsPayload;
  });

  router.get('/api/a2ui/runs', async (ctx) => {
    const surfaceId = ctx.query.surfaceId;
    if (typeof surfaceId !== 'string' || surfaceId === '') {
      invalidRequest(ctx, 'surfaceId 必须是非空字符串');
      return;
    }

    // Runs expose failure messages and surface activity: access is deny-by-default.
    // surfaceId is not a credential; the host decides from its trusted request context.
    if (!readAccess) {
      ctx.status = 403;
      ctx.body = {
        error: 'RUNS_ACCESS_NOT_CONFIGURED',
        message: '宿主必须配置 access.read 准入回调后，/api/a2ui/runs 才会返回运行记录',
      };
      return;
    }
    const allowed = await readAccess(surfaceId, ctx);
    if (allowed !== true) {
      ctx.status = 403;
      ctx.body = {
        error: 'RUNS_ACCESS_DENIED',
        message: '该 surface 的运行记录查询被宿主准入策略拒绝',
      };
      return;
    }

    ctx.body = {
      serverApiVersion: SERVER_API_VERSION,
      kind: 'agent-run-list',
      runs: runManager.listBySurface(surfaceId),
    } satisfies AgentRunListPayload;
  });

  // S2.5.3 按运行查询固定提交基线；准入沿用宿主 access.read（缺省 403）。
  registerSurfaceStateQueryRoute(router, {
    runManager,
    ...(readAccess === undefined ? {} : { access: { read: readAccess } }),
  });

  router.get('/api/a2ui/agent-onboarding', (ctx) => {
    const catalogId = ctx.query.catalogId;
    if (typeof catalogId !== 'string' || catalogId === '') {
      invalidRequest(ctx, 'catalogId 必须是非空字符串');
      return;
    }

    const contract = onboardingContracts.get(catalogId);
    if (!contract) {
      ctx.status = 404;
      ctx.body = {
        error: 'AGENT_ONBOARDING_CONTRACT_NOT_FOUND',
        message: '该 catalog 的 agent onboarding contract 未公开',
      };
      return;
    }

    ctx.body = contract;
  });

  router.post('/api/a2ui/event', async (ctx) => {
    let body: unknown;
    try {
      body = await readJsonBody(ctx.req, {
        maxBodySize: options.maxRequestBodyBytes,
        timeoutMs: options.requestBodyTimeoutMs,
      });
    } catch (error) {
      invalidRequest(ctx, error instanceof Error ? error.message : '请求体解析失败');
      return;
    }

    const request = parseNexusActionRequest(body);
    const clientMessage = request?.message;
    if (!clientMessage || !request) {
      invalidRequest(ctx, 'action 请求必须提供合法的 { message, nexus } envelope');
      return;
    }

    const requestAbort = createRequestAbortSignal(ctx);
    // access.action 由 adapter 在入队前评估（缺省拒绝，先于快照读取与记录建立）。
    let outcome: EnqueueOutcome;
    try {
      outcome = await options.adapter.enqueueAction(
        { ...clientMessage.action, ...request.nexus },
        { signal: requestAbort.signal, context: ctx },
      );
    } catch (error) {
      requestAbort.dispose();
      throw error;
    }
    if (!outcome.accepted) {
      requestAbort.dispose();
      respondEnqueueRejection(ctx, outcome);
      return;
    }

    try {
      void sendAgentRun(ctx, outcome.run, {
        ...(options.streamDelayMs === undefined ? {} : { streamDelayMs: options.streamDelayMs }),
        manager: runManager,
        signal: requestAbort.signal,
      });
    } finally {
      requestAbort.dispose();
    }
  });

  return router;
}
