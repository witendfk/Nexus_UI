import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createServer, type Server } from 'node:http';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';
import type { CatalogDefinition } from '@nexus-ui/core';
import { CATALOG_CONTRACT_VERSION } from '../../src/agent/catalog-contract';
import { fetchPublishedCatalogs } from '../../src/api/catalog-discovery-client';

/**
 * S2.5.5 discovery 严格校验：serverApiVersion/契约版本、完整 hash 格式、
 * 组件/action 列表形状与重复项；非法或错配的发现摘要整体拒绝，不部分采信。
 */

const summaryCatalog: CatalogDefinition = {
  catalogId: 'https://example.com/catalogs/discovery-test/v2',
  components: {
    Text: { schema: { type: 'object' } },
    Button: { schema: { type: 'object' } },
  },
  actions: [{ name: 'submit', sources: ['Button'] }],
};

const FULL_HASH = createCatalogContractHash(summaryCatalog);

function validSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    catalogId: summaryCatalog.catalogId,
    contractVersion: CATALOG_CONTRACT_VERSION,
    contractHash: FULL_HASH,
    components: ['Text', 'Button'],
    actions: ['submit'],
    catalogContractUrl: 'https://example.com/api/a2ui/catalog-contract?catalogId=test',
    agentOnboardingUrl: 'https://example.com/api/a2ui/agent-onboarding?catalogId=test',
    ...overrides,
  };
}

const servers: Server[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (!server) break;
    server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

async function serve(payload: unknown): Promise<string> {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(payload));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}/api/a2ui/published-catalogs`;
}

function discovery(summary: Record<string, unknown>): Record<string, unknown> {
  return { serverApiVersion: 1, kind: 'published-catalog-list', catalogs: [summary] };
}

async function rejectsSummary(summary: Record<string, unknown>, pattern: RegExp): Promise<void> {
  const url = await serve(discovery(summary));
  await assert.rejects(fetchPublishedCatalogs({ url, timeoutMs: 1000 }), pattern);
}

describe('fetchPublishedCatalogs 严格校验（S2.5.5）', () => {
  it('接受完整 hash 格式与展示型空 actions 列表', async () => {
    const url = await serve(discovery(validSummary({ components: ['Text'], actions: [] })));
    const payload = await fetchPublishedCatalogs({ url, timeoutMs: 1000 });
    assert.equal(payload.catalogs.length, 1);
    assert.deepEqual(payload.catalogs[0].actions, []);
  });

  it('拒绝不完整或非十六进制的 contractHash', async () => {
    await rejectsSummary(validSummary({ contractHash: 'sha256:tooshort' }), /无效 catalog/);
    await rejectsSummary(
      validSummary({ contractHash: `sha256:${'g'.repeat(64)}` }),
      /无效 catalog/,
    );
    await rejectsSummary(validSummary({ contractHash: FULL_HASH.slice(0, 70) }), /无效 catalog/);
  });

  it('拒绝 contractVersion 与 SDK 支持版本不一致的摘要', async () => {
    await rejectsSummary(validSummary({ contractVersion: 1 }), /无效 catalog/);
    await rejectsSummary(validSummary({ contractVersion: 3 }), /无效 catalog/);
  });

  it('拒绝缺失或非数组的 actions 列表', async () => {
    const missing = validSummary();
    delete missing.actions;
    await rejectsSummary(missing, /无效 catalog/);
    await rejectsSummary(validSummary({ actions: 'submit' }), /无效 catalog/);
  });

  it('拒绝组件/action 列表中的重复项与非字符串项', async () => {
    await rejectsSummary(validSummary({ components: ['Text', 'Text'] }), /重复/);
    await rejectsSummary(validSummary({ actions: ['submit', 'submit'] }), /重复/);
    await rejectsSummary(validSummary({ components: ['Text', ''] }), /无效 catalog/);
    await rejectsSummary(validSummary({ actions: ['submit', 42] }), /无效 catalog/);
  });

  it('拒绝缺失或为空的发现 URL', async () => {
    const noContractUrl = validSummary();
    delete noContractUrl.catalogContractUrl;
    await rejectsSummary(noContractUrl, /无效 catalog/);
    await rejectsSummary(validSummary({ agentOnboardingUrl: '' }), /无效 catalog/);
  });
});
