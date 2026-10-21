import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, describe, it } from 'node:test';
import {
  CATALOG_CONTRACT_VERSION,
  createCatalogPromptContract,
  getCatalogContractHashInput,
} from '@nexus-ui/core';
import { createStandaloneHostApp } from '../src/host/app';
import { loadHostCatalogs } from '../src/browser/catalog-loader';
import { DEMO_AGENT_CATALOG_ID } from '../src/contract';
import { SCORECARD_CATALOG_ID, scorecardHostCatalog } from '../src/shared/scorecard-contract';
import { standaloneHostCatalog } from '../src/shared/catalog-contract';

const servers: Server[] = [];

after(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (!server) break;
    server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

async function listenRealApp(): Promise<string> {
  const server = createStandaloneHostApp({
    endpoint: 'https://agent.invalid/a2ui',
    timeoutMs: 1,
  }).listen(0, '127.0.0.1') as Server;
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

/** 桩服务：按 path 前缀返回可定制的 JSON；用于发布响应的各类非法形态。 */
async function listenStub(
  respond: (url: string) => { status?: number; body: unknown },
): Promise<string> {
  const server = createServer((req, res) => {
    const result = respond(String(req.url));
    res.writeHead(result.status ?? 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result.body));
  }).listen(0, '127.0.0.1') as Server;
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function stubContract(
  catalog: typeof standaloneHostCatalog,
  overrides: Record<string, unknown> = {},
) {
  let promptContract: string;
  try {
    promptContract = createCatalogPromptContract(catalog);
  } catch {
    // 非法声明本身造不出标准 prompt；loader 会在注册闸门处拒绝。
    promptContract = 'unregistrable';
  }
  return {
    serverApiVersion: 1,
    kind: 'catalog-contract',
    contractVersion: CATALOG_CONTRACT_VERSION,
    contractHash: sha256(getCatalogContractHashInput(catalog)),
    catalog,
    promptContract,
    ...overrides,
  };
}

describe('S2.6.3.1 浏览器契约加载校验', () => {
  it('真实入口发布的两个 Catalog 全部通过校验并返回 hash 与注册表', async () => {
    const base = await listenRealApp();
    const loaded = await loadHostCatalogs(
      base,
      [DEMO_AGENT_CATALOG_ID, SCORECARD_CATALOG_ID],
      new AbortController().signal,
    );
    assert.equal(loaded.size, 2);
    const approval = loaded.get(DEMO_AGENT_CATALOG_ID);
    assert.ok(approval);
    assert.match(approval.contractHash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(approval.contractHash, sha256(getCatalogContractHashInput(standaloneHostCatalog)));
    assert.ok(approval.registry.get(DEMO_AGENT_CATALOG_ID));
    const scorecard = loaded.get(SCORECARD_CATALOG_ID);
    assert.ok(scorecard);
    assert.ok(scorecard.registry.get(SCORECARD_CATALOG_ID));
  });

  it('响应 Catalog 与请求错配拒绝', async () => {
    const base = await listenStub((url) => {
      if (url.startsWith('/api/a2ui/published-catalogs')) {
        return {
          body: {
            kind: 'published-catalog-list',
            serverApiVersion: 1,
            catalogs: [
              {
                catalogId: DEMO_AGENT_CATALOG_ID,
                contractVersion: CATALOG_CONTRACT_VERSION,
                contractHash: sha256(getCatalogContractHashInput(standaloneHostCatalog)),
                catalogContractUrl: '/contract',
              },
            ],
          },
        };
      }
      // 摘要声称审批 Catalog，契约响应却给了 scorecard：身份错配整体失败。
      return { body: stubContract(scorecardHostCatalog) };
    });
    await assert.rejects(
      loadHostCatalogs(base, [DEMO_AGENT_CATALOG_ID], new AbortController().signal),
      /错配/,
    );
  });

  it('契约版本不受支持拒绝', async () => {
    const base = await listenStub((url) => {
      if (url.startsWith('/api/a2ui/published-catalogs')) {
        return {
          body: {
            kind: 'published-catalog-list',
            serverApiVersion: 1,
            catalogs: [
              {
                catalogId: DEMO_AGENT_CATALOG_ID,
                contractVersion: 99,
                contractHash: sha256(getCatalogContractHashInput(standaloneHostCatalog)),
                catalogContractUrl: '/contract',
              },
            ],
          },
        };
      }
      return { body: stubContract(standaloneHostCatalog) };
    });
    await assert.rejects(
      loadHostCatalogs(base, [DEMO_AGENT_CATALOG_ID], new AbortController().signal),
      /版本/,
    );
  });

  it('hash 格式合法但内容错配拒绝', async () => {
    // 篡改保持可注册（legal 关键字），只改变规范化内容使 hash 失配。
    const tampered = structuredClone(standaloneHostCatalog) as typeof standaloneHostCatalog;
    (
      (tampered.components.ApprovalSummary.schema as { properties: Record<string, unknown> })
        .properties.title as Record<string, unknown>
    ).minLength = 1;
    const base = await listenStub((url) => {
      if (url.startsWith('/api/a2ui/published-catalogs')) {
        return {
          body: {
            kind: 'published-catalog-list',
            serverApiVersion: 1,
            catalogs: [
              {
                catalogId: DEMO_AGENT_CATALOG_ID,
                contractVersion: CATALOG_CONTRACT_VERSION,
                // 摘要用篡改内容的 hash（合法格式），正文却是原 Catalog。
                contractHash: sha256(getCatalogContractHashInput(tampered)),
                catalogContractUrl: '/contract',
              },
            ],
          },
        };
      }
      // 契约自身 hash 与摘要一致（过第一层核对），但内容复算对不上摘要：
      // 命中「复算内容 ↔ hash」这一层拒绝。
      return {
        body: stubContract(standaloneHostCatalog, {
          contractHash: sha256(getCatalogContractHashInput(tampered)),
        }),
      };
    });
    await assert.rejects(
      loadHostCatalogs(base, [DEMO_AGENT_CATALOG_ID], new AbortController().signal),
      /内容与 hash 不一致/,
    );
  });

  it('标准 prompt 与声明不一致拒绝', async () => {
    const base = await listenStub((url) => {
      if (url.startsWith('/api/a2ui/published-catalogs')) {
        return {
          body: {
            kind: 'published-catalog-list',
            serverApiVersion: 1,
            catalogs: [
              {
                catalogId: DEMO_AGENT_CATALOG_ID,
                contractVersion: CATALOG_CONTRACT_VERSION,
                contractHash: sha256(getCatalogContractHashInput(standaloneHostCatalog)),
                catalogContractUrl: '/contract',
              },
            ],
          },
        };
      }
      return {
        body: stubContract(standaloneHostCatalog, { promptContract: '伪造的标准 prompt' }),
      };
    });
    await assert.rejects(
      loadHostCatalogs(base, [DEMO_AGENT_CATALOG_ID], new AbortController().signal),
      /prompt/,
    );
  });

  it('注册闸门拒绝非法声明（未知键不放过）', async () => {
    const illegal = structuredClone(standaloneHostCatalog) as typeof standaloneHostCatalog;
    (illegal.components.ApprovalSummary as unknown as Record<string, unknown>).unknownKey = true;
    const base = await listenStub((url) => {
      if (url.startsWith('/api/a2ui/published-catalogs')) {
        return {
          body: {
            kind: 'published-catalog-list',
            serverApiVersion: 1,
            catalogs: [
              {
                catalogId: DEMO_AGENT_CATALOG_ID,
                contractVersion: CATALOG_CONTRACT_VERSION,
                contractHash: sha256(getCatalogContractHashInput(illegal)),
                catalogContractUrl: '/contract',
              },
            ],
          },
        };
      }
      return { body: stubContract(illegal) };
    });
    await assert.rejects(
      loadHostCatalogs(base, [DEMO_AGENT_CATALOG_ID], new AbortController().signal),
      /未知|unknown|ApprovalSummary/,
    );
  });
});
