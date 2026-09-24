import type Koa from 'koa';
import Router from '@koa/router';
import type { AgentAdapter } from '../agent/adapter';
import { isLlmAgentEnabled } from '../agent/llm-agent';
import { parseClientActionMessage } from './client-event';
import { isRecord, readJsonBody } from './request';
import { sendAgentRun } from './send-messages';

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
}

export function createAgentRouter(options: AgentRouterOptions): Router {
  const router = new Router();

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

    const plan = await options.adapter.prepareGeneration({
      message: typeof body.message === 'string' ? body.message : undefined,
      catalogId: typeof body.catalogId === 'string' ? body.catalogId : undefined,
    });
    if (!plan.ok) {
      invalidRequest(ctx, plan.message);
      return;
    }

    const surfaceId = plan.run.sequence.surfaceId;
    void sendAgentRun(ctx, plan.run, `${surfaceId}:generate-${Date.now().toString(36)}`);
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

    const plan = await options.adapter.prepareAction(clientMessage.action);
    if (!plan.ok) {
      invalidRequest(ctx, plan.message);
      return;
    }

    const surfaceId = clientMessage.action.surfaceId;
    void sendAgentRun(ctx, plan.run, `${surfaceId}:event-${Date.now().toString(36)}`);
  });

  return router;
}
