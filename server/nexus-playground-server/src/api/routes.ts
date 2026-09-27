import type Koa from 'koa';
import Router from '@koa/router';
import { randomUUID } from 'node:crypto';
import type { CatalogDefinition } from '@nexus-ui/core';
import { createCatalogPromptContract } from '@nexus-ui/core';
import type { AgentAdapter, AgentPlan } from '../agent/adapter';
import { isLlmAgentEnabled } from '../agent/llm-agent';
import { InMemoryAgentRunManager } from '../agent/run-manager';
import type { AgentRunManager, AgentRunRecord } from '../agent/run-manager';
import { parseClientActionMessage } from './client-event';
import { isRecord, readJsonBody } from './request';
import { sendAgentRun } from './send-messages';
import { SERVER_API_VERSION } from '../version';
import {
  createAgentOnboardingContract,
  type AgentOnboardingContractPayload,
} from './agent-onboarding';

function invalidRequest(ctx: Koa.Context, message: string): void {
  ctx.status = 400;
  ctx.body = { error: 'INVALID_REQUEST', message };
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
  /** Host-replaceable run observability store. */
  runManager?: AgentRunManager;
}

export interface CatalogContractPayload {
  readonly serverApiVersion: 1;
  readonly kind: 'catalog-contract';
  readonly catalog: CatalogDefinition;
  readonly promptContract: string;
}

export type { AgentOnboardingContractPayload };

export interface PublishedCatalogSummary {
  readonly catalogId: string;
  readonly components: readonly string[];
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
  const runManager = options.runManager ?? new InMemoryAgentRunManager();
  const catalogContracts = new Map<string, CatalogContractPayload>();
  for (const catalog of options.catalogContracts ?? []) {
    if (catalogContracts.has(catalog.catalogId)) {
      throw new Error(`Catalog contract 重复公开: ${catalog.catalogId}`);
    }
    catalogContracts.set(catalog.catalogId, {
      serverApiVersion: SERVER_API_VERSION,
      kind: 'catalog-contract',
      catalog,
      promptContract: createCatalogPromptContract(catalog),
    });
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
      agentMode: options.healthAgentMode ?? (isLlmAgentEnabled() ? 'llm' : 'fallback'),
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
    let plan: AgentPlan;
    try {
      plan = await options.adapter.prepareGeneration(
        {
          message: typeof body.message === 'string' ? body.message : undefined,
          catalogId: typeof body.catalogId === 'string' ? body.catalogId : undefined,
        },
        { signal: requestAbort.signal },
      );
    } catch (error) {
      requestAbort.dispose();
      throw error;
    }
    if (!plan.ok) {
      requestAbort.dispose();
      invalidRequest(ctx, plan.message);
      return;
    }

    const surfaceId = plan.run.sequence.surfaceId;
    void sendAgentRun(ctx, plan.run, `${surfaceId}:generate-${randomUUID()}`, {
      ...(options.streamDelayMs === undefined ? {} : { streamDelayMs: options.streamDelayMs }),
      manager: runManager,
      signal: requestAbort.signal,
      dispose: requestAbort.dispose,
    });
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
      components: contract.catalog.components,
      actions: contract.catalog.actions ?? [],
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

  router.get('/api/a2ui/runs', (ctx) => {
    const surfaceId = ctx.query.surfaceId;
    if (typeof surfaceId !== 'string' || surfaceId === '') {
      invalidRequest(ctx, 'surfaceId 必须是非空字符串');
      return;
    }

    ctx.body = {
      serverApiVersion: SERVER_API_VERSION,
      kind: 'agent-run-list',
      runs: runManager.listBySurface(surfaceId),
    } satisfies AgentRunListPayload;
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

    const clientMessage = parseClientActionMessage(body);
    if (!clientMessage) {
      invalidRequest(ctx, 'action 消息不符合 A2UI v0.9 契约');
      return;
    }

    const requestAbort = createRequestAbortSignal(ctx);
    let plan: AgentPlan;
    try {
      plan = await options.adapter.prepareAction(clientMessage.action, {
        signal: requestAbort.signal,
      });
    } catch (error) {
      requestAbort.dispose();
      throw error;
    }
    if (!plan.ok) {
      requestAbort.dispose();
      invalidRequest(ctx, plan.message);
      return;
    }

    const surfaceId = clientMessage.action.surfaceId;
    void sendAgentRun(ctx, plan.run, `${surfaceId}:action-${randomUUID()}`, {
      ...(options.streamDelayMs === undefined ? {} : { streamDelayMs: options.streamDelayMs }),
      manager: runManager,
      signal: requestAbort.signal,
      dispose: requestAbort.dispose,
    });
  });

  return router;
}
