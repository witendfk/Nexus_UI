import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type Koa from 'koa';
import { createApp } from '../../src/http/app';
import { CatalogContractClient } from '../../src/catalog-contract/client';
import { fixtureGeneration } from '../../src/a2ui/fixture-source';

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

const CONTRACT = {
  serverApiVersion: 1,
  kind: 'catalog-contract',
  contractVersion: 1,
  contractHash: 'sha256:cat',
  catalog: { catalogId: 'https://example.com/catalogs/orderops/v1' },
  promptContract: 'PROMPT-V1',
};

const VALID_REQUEST = {
  version: 1,
  kind: 'generate',
  surfaceId: 'surface-1',
  message: 'case-order-stalled-001-evt-stalled-002',
  history: [],
  catalogId: 'https://example.com/catalogs/orderops/v1',
  supportedComponents: ['Column', 'Text'],
  supportedActions: ['createTicket'],
  catalogContract: { version: 1, hash: 'sha256:cat' },
};

/** 端到端：真实 HTTP + 宿主 contract 端点替身，等价于 curl 打通验证。 */
async function appWithFixture(): Promise<Koa> {
  const contractApp = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(CONTRACT));
  });
  servers.push(contractApp);
  const contractPort = await new Promise<number>((resolve, reject) => {
    contractApp.once('error', reject);
    contractApp.listen(0, '127.0.0.1', () => {
      resolve((contractApp.address() as AddressInfo).port);
    });
  });

  return createApp({
    contractClient: new CatalogContractClient({ hostBaseUrl: `http://127.0.0.1:${contractPort}` }),
    generate: fixtureGeneration,
  });
}

describe('POST /rpc（§10.1 契约）', () => {
  it('fixture 生成源 curl 打通：200 + application/x-ndjson，首条为匹配 surfaceId 的 createSurface 且含 root', async () => {
    const baseUrl = await listen(await appWithFixture());
    const response = await fetch(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_REQUEST),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');

    const text = await response.text();
    const lines = text.trimEnd().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const create = lines[0] as { createSurface: { surfaceId: string; catalogId: string } };
    expect(create.createSurface).toMatchObject({ surfaceId: 'surface-1', catalogId: VALID_REQUEST.catalogId });

    const components = (lines[1] as { updateComponents: { components: Array<{ id: string }> } })
      .updateComponents.components;
    expect(components[0]).toMatchObject({ id: 'root', component: 'Column' });
  });

  it('错误语义：version/kind/字段非法 → 400 {error:{message}}', async () => {
    const baseUrl = await listen(await appWithFixture());
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

  it('契约解析失败 → 502；生成器抛错/空产出 → 500 {error:{message}}', async () => {
    // 契约 hash 不一致（宿主端点返回别的 hash）
    const mismatchedContractApp = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ...CONTRACT, contractHash: 'sha256:other' }));
    });
    servers.push(mismatchedContractApp);
    const mismatchedPort = await new Promise<number>((resolve, reject) => {
      mismatchedContractApp.once('error', reject);
      mismatchedContractApp.listen(0, '127.0.0.1', () => {
        resolve((mismatchedContractApp.address() as AddressInfo).port);
      });
    });

    const mismatched = await listen(
      createApp({
        contractClient: new CatalogContractClient({ hostBaseUrl: `http://127.0.0.1:${mismatchedPort}` }),
        generate: fixtureGeneration,
      }),
    );
    const bad = await fetch(`${mismatched}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_REQUEST),
    });
    expect(bad.status).toBe(502);
    expect(((await bad.json()) as { error: { message: string } }).error.message).toContain('hash 不一致');

    // 生成器抛错
    const throwing = await listen(
      createApp({
        contractClient: new CatalogContractClient({ hostBaseUrl: 'http://127.0.0.1:1' }),
        generate: async function* () {
          throw new Error('模型不可用');
        },
      }) as Koa,
    );
    // 无 contract 端点可访问 → 502 而非生成错误；换一个带 contract 的组合验证 500
    const failingGenerate = await listen(
      createApp({
        contractClient: new CatalogContractClient({
          hostBaseUrl: 'http://127.0.0.1:1',
          fetchImpl: (() =>
            Promise.resolve(new Response(JSON.stringify(CONTRACT), { status: 200 }))) as typeof fetch,
        }),
        generate: async function* () {
          throw new Error('模型不可用');
        },
      }),
    );
    const genError = await fetch(`${failingGenerate}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_REQUEST),
    });
    expect(genError.status).toBe(500);
    expect(((await genError.json()) as { error: { message: string } }).error.message).toContain('模型不可用');
    void throwing;
  });

  it('空产出 → 500（契约要求至少一条消息）', async () => {
    const app = createApp({
      contractClient: new CatalogContractClient({
        hostBaseUrl: 'http://127.0.0.1:1',
        fetchImpl: (() =>
          Promise.resolve(new Response(JSON.stringify(CONTRACT), { status: 200 }))) as typeof fetch,
      }),
      generate: async function* () {},
    });
    const baseUrl = await listen(app);
    const response = await fetch(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_REQUEST),
    });
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain('未产出');
  });

  it('GET /rpc → 405（仅 POST 放行，@koa/router allowedMethods 语义）', async () => {
    const baseUrl = await listen(await appWithFixture());
    const response = await fetch(`${baseUrl}/rpc`);
    expect(response.status).toBe(405);
    void vi;
  });
});
