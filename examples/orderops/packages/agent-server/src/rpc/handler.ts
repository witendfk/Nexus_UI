import Router from '@koa/router';
import type { ParameterizedContext } from 'koa';
import type { CatalogContractClient, CatalogContractReference } from '../catalog-contract/client';

/**
 * 外部生成 RPC（T3.3，docs/SPEC.md §3）：`POST /rpc`。
 *
 * 请求：`{version: 1, kind: 'generate', surfaceId, message, history, catalogId,
 * supportedComponents, supportedActions, catalogContract}`。
 * 响应：`application/x-ndjson`，每行一条 A2UI 消息。
 * 错误：非 2xx + `{error: {message}}`（宿主客户端 readRemoteError 按此解析）。
 *
 * 语义约束：生成流首条消息必须是匹配 surfaceId/catalogId 的 createSurface，
 * root 组件由后续 updateComponents 建立；宿主 guard 会逐条校验。本 handler 缓冲后
 * 一次性输出，借机强制「至少一条消息」契约并在出错时仍能以 JSON 错误体响应
 * （T3.4 接真实模型流式时如需边生成边推，再改为逐行写 + 头部先置 x-ndjson）。
 */

const REQUEST_MAX_BYTES = 1_000_000;

export interface RpcGenerateInput {
  readonly surfaceId: string;
  readonly message: string;
  readonly catalogId: string;
  readonly supportedComponents: readonly string[];
  readonly supportedActions: readonly string[];
  readonly catalog: unknown;
  readonly promptContract: string;
  readonly contractHash: string;
  readonly history: readonly unknown[];
}

export type RpcGenerator = (input: RpcGenerateInput) => AsyncGenerator<unknown, void, void>;

export interface CreateRpcRouterOptions {
  contractClient: CatalogContractClient;
  generate: RpcGenerator;
}

interface RpcRequestBody {
  version?: unknown;
  kind?: unknown;
  surfaceId?: unknown;
  message?: unknown;
  catalogId?: unknown;
  supportedComponents?: unknown;
  supportedActions?: unknown;
  catalogContract?: unknown;
  history?: unknown;
}

/** 无依赖的请求体读取：上限 1MB，超限断开连接并拒绝（与宿主侧 maxBytes 纪律对齐）。 */
function readJsonBody(ctx: ParameterizedContext): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    ctx.req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > REQUEST_MAX_BYTES) {
        reject(new Error('请求体超过 1MB 上限'));
        ctx.req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    ctx.req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.trim() === '') {
        reject(new Error('请求体不能为空'));
        return;
      }
      try {
        resolve(JSON.parse(raw) as unknown);
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    ctx.req.on('error', reject);
  });
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isContractReference(value: unknown): value is CatalogContractReference {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { version?: unknown }).version === 1 &&
    typeof (value as { hash?: unknown }).hash === 'string'
  );
}

export function createRpcRouter(options: CreateRpcRouterOptions): Router {
  const router = new Router();

  router.post('/rpc', async (ctx) => {
    let body: RpcRequestBody;
    try {
      body = (await readJsonBody(ctx)) as RpcRequestBody;
    } catch (error) {
      ctx.status = 400;
      ctx.body = { error: { message: error instanceof Error ? error.message : '请求体非法' } };
      return;
    }

    if (body.version !== 1) {
      ctx.status = 400;
      ctx.body = { error: { message: 'version 必须是 1' } };
      return;
    }
    if (body.kind !== 'generate') {
      // 首条切片 action 由宿主本地 handler 承接（docs/ARCHITECTURE.md §4），Agent 不接收 kind:'action'
      ctx.status = 400;
      ctx.body = {
        error: {
          message: `不支持的 kind: ${String(body.kind)}（首条切片仅支持 generate，action 由宿主本地处理）`,
        },
      };
      return;
    }
    if (
      typeof body.surfaceId !== 'string' ||
      body.surfaceId === '' ||
      typeof body.message !== 'string' ||
      typeof body.catalogId !== 'string' ||
      !isStringArray(body.supportedComponents) ||
      !isStringArray(body.supportedActions) ||
      !isContractReference(body.catalogContract) ||
      !Array.isArray(body.history)
    ) {
      ctx.status = 400;
      ctx.body = { error: { message: '请求字段缺失或类型非法' } };
      return;
    }

    let catalog: unknown;
    let promptContract: string;
    try {
      const contract = await options.contractClient.get(body.catalogContract, body.catalogId);
      catalog = contract.catalog;
      promptContract = contract.promptContract;
    } catch (error) {
      ctx.status = 502;
      ctx.body = {
        error: { message: `解析 Catalog Contract 失败：${error instanceof Error ? error.message : String(error)}` },
      };
      return;
    }

    const messages: unknown[] = [];
    try {
      for await (const message of options.generate({
        surfaceId: body.surfaceId,
        message: body.message,
        catalogId: body.catalogId,
        supportedComponents: body.supportedComponents,
        supportedActions: body.supportedActions,
        catalog,
        promptContract,
        contractHash: body.catalogContract.hash,
        history: body.history,
      })) {
        messages.push(message);
      }
    } catch (error) {
      ctx.status = 500;
      ctx.body = {
        error: { message: `生成失败：${error instanceof Error ? error.message : String(error)}` },
      };
      return;
    }

    if (messages.length === 0) {
      ctx.status = 500;
      ctx.body = { error: { message: '生成器未产出任何 A2UI 消息' } };
      return;
    }

    ctx.set('content-type', 'application/x-ndjson');
    ctx.body = messages.map((message) => JSON.stringify(message)).join('\n') + '\n';
  });

  return router;
}
