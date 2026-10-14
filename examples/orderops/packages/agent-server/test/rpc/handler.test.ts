import http from 'node:http';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import type Koa from 'koa';
import { ORDEROPS_CATALOG } from '@orderops/contracts';
import { createApp } from '../../src/http/app';
import { CatalogContractClient } from '../../src/catalog-contract/client';
import { CaseContextClient } from '../../src/tools/case-context';
import { createAnalysisGeneration } from '../../src/a2ui/generate';
import type { RpcGenerateInput } from '../../src/rpc/handler';
import { analyzeCase } from '../../src/analysis/engine';
import { ModelClient } from '../../src/analysis/model-client';
import {
  INTERNAL_TOKEN,
  STALLED_CASE_ID,
  catalogContractPayload,
  chatCompletion,
  stalledContext,
} from '../fixtures/snapshot';

/** T3.3 判据 + T3.4/T3.5 管线端到端：真实 HTTP + 宿主替身（contract + 内部快照）。 */

const servers: http.Server[] = [];

function listen(app: Koa): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app.callback());
    servers.push(server);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

afterAll(() => {
  for (const server of servers) server.close();
});

const VALID_REQUEST = {
  version: 1,
  kind: 'generate',
  surfaceId: 'surface-1',
  message: STALLED_CASE_ID,
  history: [],
  catalogId: ORDEROPS_CATALOG.catalogId,
  supportedComponents: ORDEROPS_CATALOG.components,
  supportedActions: ORDEROPS_CATALOG.actions,
  catalogContract: { version: 1, hash: 'sha256:cat' },
};

/** 宿主替身：GET /api/a2ui/catalog-contract + GET /internal/cases/:id/context。 */
async function stubHost(options?: { contextStatus?: number }): Promise<number> {
  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/api/a2ui/catalog-contract')) {
      res.end(JSON.stringify(catalogContractPayload()));
      return;
    }
    if (req.url?.includes('/internal/cases/')) {
      const knownCase = req.url.includes(encodeURIComponent(STALLED_CASE_ID));
      const status = knownCase ? (options?.contextStatus ?? 200) : 404;
      res.statusCode = status;
      res.end(JSON.stringify(status === 200 ? stalledContext() : { error: 'NOT_FOUND', message: `案件不存在: ${req.url}` }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  };
  const server = createServer(handler);
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

function appWithPipeline(hostPort: number): Koa {
  const hostBaseUrl = `http://127.0.0.1:${hostPort}`;
  return createApp({
    contractClient: new CatalogContractClient({ hostBaseUrl }),
    generate: createAnalysisGeneration({
      contextClient: new CaseContextClient({ hostBaseUrl, internalToken: INTERNAL_TOKEN }),
      analyze: (context, promptContract) =>
        analyzeCase(context, { mode: 'deterministic', promptContract }),
    }),
  });
}

describe('POST /rpc（§10.1 契约 + T3.4/T3.5 管线）', () => {
  it('分析管线端到端：200 + application/x-ndjson，createSurface 匹配、组件 ⊆ Catalog v1、draft 可编辑', async () => {
    const hostPort = await stubHost();
    const baseUrl = await listen(appWithPipeline(hostPort));
    const response = await fetch(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_REQUEST),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');

    const lines = (await response.text()).trimEnd().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    // V1 分阶段产出：createSurface + 多次交错 components/data
    expect(lines.length).toBeGreaterThanOrEqual(11);
    expect(lines[0]).toMatchObject({
      version: 'v0.9',
      createSurface: { surfaceId: 'surface-1', catalogId: ORDEROPS_CATALOG.catalogId },
    });

    const allComponents = lines.flatMap((line) =>
      'updateComponents' in line
        ? (line.updateComponents as { components: Array<{ id: string; component: string; action?: { event: { name: string } } }> }).components
        : [],
    );
    expect(allComponents[0]).toMatchObject({ id: 'root', component: 'Column' });
    for (const component of allComponents) {
      expect(ORDEROPS_CATALOG.components, component.id).toContain(component.component);
    }
    const button = allComponents.find((component) => component.component === 'Button')!;
    expect(button.action?.event.name).toBe('createTicket');

    const merged = lines.reduce<Record<string, unknown>>((model, line) => {
      if ('updateDataModel' in line) {
        const { path, value } = line.updateDataModel as { path?: string; value?: unknown };
        if (value === undefined) return model;
        if (typeof path !== 'string' || path === '' || path === '/') {
          return { ...model, ...(value as Record<string, unknown>) };
        }
        const keys = path.split('/').filter(Boolean);
        let cursor: Record<string, unknown> = model;
        for (let i = 0; i < keys.length - 1; i += 1) {
          const key = keys[i]!;
          if (cursor[key] === undefined || typeof cursor[key] !== 'object') cursor[key] = {};
          cursor = cursor[key] as Record<string, unknown>;
        }
        cursor[keys[keys.length - 1]!] = value;
      }
      return model;
    }, {});
    const draft = merged.draft as { note: string };
    expect(draft.note).toBe('');
    const timeline = merged.timeline as { events: unknown[] };
    expect(timeline.events).toHaveLength(2);
  });

  it('未知案件 → 500 {error:{message}} 且指明案件不存在', async () => {
    const hostPort = await stubHost();
    const baseUrl = await listen(appWithPipeline(hostPort));
    const response = await fetch(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_REQUEST, message: 'case-not-exist' }),
    });
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain('案件不存在');
  });

  it('错误语义：version/kind/字段非法 → 400 {error:{message}}', async () => {
    const hostPort = await stubHost();
    const baseUrl = await listen(appWithPipeline(hostPort));
    for (const patch of [
      { version: 2 },
      { kind: 'action' },
      { surfaceId: '' },
      { catalogContract: { version: 1 } },
    ]) {
      const response = await fetch(`${baseUrl}/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...VALID_REQUEST, ...patch }),
      });
      expect(response.status, JSON.stringify(patch)).toBe(400);
      const body = (await response.json()) as { error: { message: string } };
      expect(body.error.message).toBeTruthy();
    }
  });

  it('契约 hash 不一致 → 502（在取快照之前拒绝）', async () => {
    const mismatched = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(catalogContractPayload('sha256:other')));
    });
    servers.push(mismatched);
    const port = await new Promise<number>((resolve, reject) => {
      mismatched.once('error', reject);
      mismatched.listen(0, '127.0.0.1', () => resolve((mismatched.address() as AddressInfo).port));
    });
    const app = createApp({
      contractClient: new CatalogContractClient({ hostBaseUrl: `http://127.0.0.1:${port}` }),
      generate: createAnalysisGeneration({
        contextClient: new CaseContextClient({
          hostBaseUrl: `http://127.0.0.1:${port}`,
          internalToken: INTERNAL_TOKEN,
        }),
        analyze: (context) => analyzeCase(context, { mode: 'deterministic' }),
      }),
    });
    const baseUrl = await listen(app);
    const response = await fetch(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_REQUEST),
    });
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain('hash 不一致');
  });

  it('GET /rpc → 405（仅 POST 放行，@koa/router allowedMethods 语义）', async () => {
    const hostPort = await stubHost();
    const baseUrl = await listen(appWithPipeline(hostPort));
    const response = await fetch(`${baseUrl}/rpc`);
    expect(response.status).toBe(405);
  });

  it('S1 取消传播：宿主在生成期间断开 → 生成器 finally 触发，不再产出响应', async () => {
    const hostPort = await stubHost();
    const hostBaseUrl = `http://127.0.0.1:${hostPort}`;
    let finallyRan = false;
    async function* slowGenerate(input: RpcGenerateInput): AsyncGenerator<unknown, void, void> {
      try {
        yield { version: 'v0.9', createSurface: { surfaceId: input.surfaceId, catalogId: input.catalogId } };
        await new Promise((resolve) => setTimeout(resolve, 600));
        yield { version: 'v0.9', updateDataModel: { surfaceId: input.surfaceId, value: { late: true } } };
      } finally {
        finallyRan = true;
      }
    }
    const baseUrl = await listen(
      createApp({
        contractClient: new CatalogContractClient({ hostBaseUrl }),
        generate: slowGenerate,
      }),
    );

    const controller = new AbortController();
    const pending = fetch(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_REQUEST),
      signal: controller.signal,
    }).catch(() => undefined);
    // 首条已缓冲，生成器悬停期间宿主断开
    await new Promise((resolve) => setTimeout(resolve, 150));
    controller.abort();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 900));

    expect(finallyRan).toBe(true);
  });

  it('T4.4 样本④编造事件 ID：模型引用快照外证据 → 200 但为不可执行面（无输入/按钮，缺信息明示）', async () => {
    const hostPort = await stubHost();
    const hostBaseUrl = `http://127.0.0.1:${hostPort}`;
    const model = new ModelClient(
      { baseUrl: 'http://model.test/v1', apiKey: 'k', model: 'm', timeoutMs: 5_000 },
      (): Promise<Response> =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              chatCompletion(
                JSON.stringify({
                  verdict: 'analysis',
                  summary: '编造证据的分析',
                  reason: '引用了不存在的事件',
                  evidenceEventIds: ['evt-fabricated-999'],
                  recommendation: '建单',
                  uncertainties: [],
                }),
              ),
            ),
            { status: 200 },
          ) as unknown as Response,
        ),
    );
    const baseUrl = await listen(
      createApp({
        contractClient: new CatalogContractClient({ hostBaseUrl }),
        generate: createAnalysisGeneration({
          contextClient: new CaseContextClient({ hostBaseUrl, internalToken: INTERNAL_TOKEN }),
          analyze: (context, promptContract) =>
            analyzeCase(context, { mode: 'model', attempts: 2, promptContract, model }),
        }),
      }),
    );

    const response = await fetch(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_REQUEST),
    });
    expect(response.status).toBe(200);
    const lines = (await response.text()).trimEnd().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(3);
    const components = (lines[1] as { updateComponents: { components: Array<{ component: string }> } })
      .updateComponents.components;
    // 不可执行面：不给输入与按钮，明示缺失信息（SPEC §5）
    expect(components.map((c) => c.component)).not.toContain('Button');
    expect(components.map((c) => c.component)).not.toContain('TextField');
    const insufficient = (lines[2] as { updateDataModel: { value: { insufficient: { missingText: string } } } })
      .updateDataModel.value.insufficient;
    expect(insufficient.missingText).toContain('evt-fabricated-999');
  });
});
