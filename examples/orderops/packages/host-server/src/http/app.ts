import Koa from 'koa';
import Router from '@koa/router';
import {
  createAgentRouter,
  createCatalogContractHash,
  InMemoryAgentRunManager,
  sendAgentRun,
} from '@nexus-ui/server';
import type { ExternalAgentRpcConfig } from '@nexus-ui/server';
import { HOST_SERVER_VERSION } from '../index';
import { createAgentAdapter } from '../nexus/adapter';
import { ORDEROPS_CATALOG } from '../nexus/catalog';
import { withAdversarialTail } from '../nexus/adversarial-source';
import { getCaseVersion, getActionAttemptByActionId, insertSurfaceBinding } from '../cases/repository';
import { admitAnalyze, ANALYZABLE_CASE_STATUSES } from '../cases/analyze-guard';
import { createCasesRouter } from './cases';
import { createInternalRouter } from '../tools/read-api';
import type { SqliteDb } from '../db/client';

export interface CreateAppOptions {
  /** 案件存储；未提供时 /api/cases* 与 analyze 返回 503（存储未接线）。 */
  db?: SqliteDb;
  /** T3.6：Agent `/rpc` 装配；未提供时 analyze 显式 503（生成源未配置）。 */
  agentRpc?: ExternalAgentRpcConfig;
  /** D8/V1 演示节奏：analyze 流每条消息间隔毫秒数（缺省 0 = 全速）。 */
  demoPacingMs?: number;
}

const ANALYZE_BODY_MAX_BYTES = 65_536;

function readRawBody(ctx: Koa.Context, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    ctx.req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error(`请求体超过 ${maxBytes} 字节上限`));
        ctx.req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    ctx.req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    ctx.req.on('error', reject);
  });
}

/** analyze 可选请求体（V2 对抗模式开关）：strict——未知字段与非法值一律 400。 */
async function readAnalyzeBody(ctx: Koa.Context): Promise<{ adversarial?: boolean } | { error: string }> {
  let raw: string;
  try {
    raw = await readRawBody(ctx, ANALYZE_BODY_MAX_BYTES);
  } catch (error) {
    return { error: error instanceof Error ? error.message : '请求体读取失败' };
  }
  if (raw.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { error: '请求体不是合法 JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: '请求体必须是 JSON 对象' };
  }
  const body = parsed as Record<string, unknown>;
  const unknownKeys = Object.keys(body).filter((key) => key !== 'adversarial');
  if (unknownKeys.length > 0) {
    return { error: `未声明的请求字段: ${unknownKeys.join(', ')}` };
  }
  if (body.adversarial !== undefined && typeof body.adversarial !== 'boolean') {
    return { error: 'adversarial 必须是布尔值' };
  }
  return body.adversarial === undefined ? {} : { adversarial: body.adversarial };
}

export function createApp(options: CreateAppOptions = {}): Koa {
  const app = new Koa();
  const adapter = createAgentAdapter({ agentRpc: options.agentRpc, db: options.db });
  // S1 可观察性：analyze 与 /api/a2ui/runs 共享同一 run manager，
  // 生成流的成功/失败/取消状态可被宿主与前端查询（此前 analyze 的 run 落在
  // 默认全局 manager，runs 端点看不到）。
  const runManager = new InMemoryAgentRunManager();
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

  // T4.2 断线恢复入口：按客户端 actionId 查操作终态（事务先于流，SSE 中断后
  // 以此处为准，不得依据 SDK run 状态重试业务动作）。
  own.get('/api/actions/:actionId', (ctx) => {
    if (options.db === undefined) {
      ctx.status = 503;
      ctx.body = { error: 'SERVICE_UNAVAILABLE', message: '案件存储未接线' };
      return;
    }
    const attempt = getActionAttemptByActionId(options.db, ctx.params.actionId);
    if (attempt === null) {
      ctx.status = 404;
      ctx.body = { error: 'NOT_FOUND', message: `未知操作: ${ctx.params.actionId}` };
      return;
    }
    ctx.body = {
      actionId: attempt.actionId,
      operation: attempt.operation,
      caseId: attempt.caseId,
      status: attempt.status,
      ...(attempt.resultId === null ? {} : { resultId: attempt.resultId }),
      ...(attempt.error === null ? {} : { error: attempt.error }),
      createdAt: attempt.createdAt,
    };
  });

  const catalogHash = createCatalogContractHash(ORDEROPS_CATALOG);

  // 案件生成走自有路由：analyze 前核对案件存在与状态（T3.3b，docs/ARCHITECTURE.md §3），
  // 自由 message 不能经任何入口绕过只读案件边界。
  own.post('/api/cases/:caseId/analyze', async (ctx) => {
    if (options.db === undefined) {
      ctx.status = 503;
      ctx.body = { error: 'SERVICE_UNAVAILABLE', message: '案件存储未接线' };
      return;
    }
    const caseId = ctx.params.caseId;
    const admission = admitAnalyze(options.db, caseId);
    if (!admission.ok) {
      if (admission.reason === 'not_found') {
        ctx.status = 404;
        ctx.body = { error: 'NOT_FOUND', message: `案件不存在: ${caseId}` };
      } else {
        ctx.status = 409;
        ctx.body = {
          error: 'CASE_NOT_ANALYZABLE',
          message: `案件状态 ${admission.status} 不允许分析（仅 ${ANALYZABLE_CASE_STATUSES.join('/')} 可分析）`,
        };
      }
      return;
    }
    if (options.agentRpc === undefined) {
      ctx.status = 503;
      ctx.body = { error: 'SERVICE_UNAVAILABLE', message: 'Agent 生成源未配置' };
      return;
    }
    const bodyResult = await readAnalyzeBody(ctx);
    if ('error' in bodyResult) {
      ctx.status = 400;
      ctx.body = { error: 'INVALID_REQUEST', message: bodyResult.error };
      return;
    }
    // S1 取消传播（docs/DESIGN.md D6/PRD R1）：客户端断开时中止上游 Agent RPC，
    // 而不是让 Agent 空转后丢弃结果；同一信号交给 sendAgentRun 收尾流。
    const controller = new AbortController();
    const abort = (): void => {
      if (!ctx.res.writableEnded) controller.abort();
    };
    ctx.req.once('aborted', abort);
    ctx.res.once('close', abort);
    const plan = await adapter.prepareGeneration(
      {
        message: caseId,
        catalogId: ORDEROPS_CATALOG.catalogId,
      },
      { signal: controller.signal },
    );
    if (!plan.ok) {
      ctx.req.off('aborted', abort);
      ctx.res.off('close', abort);
      ctx.status = 400;
      ctx.body = { error: 'INVALID_REQUEST', message: plan.message };
      return;
    }
    const surfaceId = plan.run.sequence.surfaceId;
    // T3.6（docs/ARCHITECTURE.md §3）：Nexus 快照提交成功后、done 发出前记录
    // surface ↔ case 绑定；绑定写失败会让本次流以 error 收尾（快照已提交但不发 done）。
    const caseVersion = getCaseVersion(options.db, caseId);
    if (caseVersion === null) {
      // admission 已确认存在；防御并发删除，不进入流。
      ctx.req.off('aborted', abort);
      ctx.res.off('close', abort);
      ctx.status = 404;
      ctx.body = { error: 'NOT_FOUND', message: `案件不存在: ${caseId}` };
      return;
    }
    const commit = plan.run.commit.bind(plan.run);
    plan.run.commit = async (messages: unknown[]) => {
      await commit(messages);
      insertSurfaceBinding(options.db!, {
        surfaceId,
        caseId,
        caseVersion,
        catalogHash,
        createdAt: new Date().toISOString(),
      });
    };
    // D8/V2 对抗模式（docs/PRD.md §5.3）：演示开关在同一生产管线的候选源尾部
    // 注入越权输出（模型幻觉替身），guard 的拒绝行为与真实越权完全一致。
    if (bodyResult.adversarial === true) {
      plan.run.source = withAdversarialTail(plan.run.source, surfaceId);
    }
    try {
      await sendAgentRun(ctx, plan.run, `${surfaceId}:analyze`, {
        streamDelayMs: options.demoPacingMs ?? 0,
        manager: runManager,
        signal: controller.signal,
      });
    } finally {
      ctx.req.off('aborted', abort);
      ctx.res.off('close', abort);
    }
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
    runManager,
    streamDelayMs: 0,
  });

  app.use(own.routes());
  app.use(own.allowedMethods());
  app.use(nexusRouter.routes());
  app.use(nexusRouter.allowedMethods());
  return app;
}
