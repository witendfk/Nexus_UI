import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import Koa from 'koa';
import { createCatalogPromptContract } from '@nexus-ui/core';
import { AgentAdapter, createAgentRouter } from '../src/index';
import type { CatalogDefinition } from '@nexus-ui/core';

process.env.NODE_ENV = 'test';
delete process.env.OPENAI_API_KEY;

const catalog: CatalogDefinition = {
  catalogId: 'https://example.com/catalogs/host-contract/v1',
  components: ['CustomerSummary', 'Text', 'Button'],
  actions: ['submit'],
  componentSchemas: {
    CustomerSummary: {
      type: 'object',
      additionalProperties: false,
      required: ['customerName'],
      properties: {
        customerName: { type: 'string', minLength: 1, dynamic: 'required' },
      },
    },
  },
};

const app = new Koa();
const router = createAgentRouter({
  adapter: new AgentAdapter({ useLlm: () => false }),
  catalogContracts: [catalog],
  agentOnboarding: {
    rpcEndpoint: 'https://agent.example.internal/a2ui',
    verificationCommand: 'pnpm verify-agent --endpoint https://agent.example.internal/a2ui',
  },
});
app.use(router.routes());
app.use(router.allowedMethods());

const server = app.listen(0, '127.0.0.1') as Server;
await new Promise<void>((resolve) => server.once('listening', resolve));
const { port } = server.address() as AddressInfo;
const baseUrl = `http://127.0.0.1:${port}`;

after(() => {
  server.close();
});

describe('catalog contract route', () => {
  it('publishes only an explicitly allowed catalog and its generated prompt', async () => {
    const response = await fetch(
      `${baseUrl}/api/a2ui/catalog-contract?catalogId=${encodeURIComponent(catalog.catalogId)}`,
    );
    const payload = (await response.json()) as {
      serverApiVersion?: number;
      kind?: string;
      catalog?: CatalogDefinition;
      promptContract?: string;
    };

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    assert.equal(payload.serverApiVersion, 1);
    assert.equal(payload.kind, 'catalog-contract');
    assert.deepEqual(payload.catalog, catalog);
    assert.equal(payload.promptContract, createCatalogPromptContract(catalog));
  });

  it('publishes an explicit agent onboarding contract for a published catalog', async () => {
    const response = await fetch(
      `${baseUrl}/api/a2ui/agent-onboarding?catalogId=${encodeURIComponent(catalog.catalogId)}`,
    );
    const payload = (await response.json()) as {
      serverApiVersion?: number;
      contractVersion?: number;
      kind?: string;
      catalogContract?: { kind?: string };
      rpc?: {
        endpoint?: { disclosed?: boolean; url?: string };
        response?: { contentType?: string[] };
      };
      errors?: { boundaryCodes?: string[] };
      verification?: { command?: string };
    };

    assert.equal(response.status, 200);
    assert.equal(payload.serverApiVersion, 1);
    assert.equal(payload.contractVersion, 1);
    assert.equal(payload.kind, 'agent-onboarding-contract');
    assert.equal(payload.catalogContract?.kind, 'catalog-contract');
    assert.equal(payload.rpc?.endpoint?.disclosed, true);
    assert.equal(payload.rpc?.endpoint?.url, 'https://agent.example.internal/a2ui');
    assert.deepEqual(payload.rpc?.response?.contentType, [
      'application/x-ndjson',
      'application/jsonl',
    ]);
    assert.ok(payload.errors?.boundaryCodes?.includes('POLICY_REJECTED'));
    assert.match(payload.verification?.command ?? '', /pnpm verify-agent/);
  });

  it('rejects missing ids and unpublished agent onboarding contracts', async () => {
    const missing = await fetch(`${baseUrl}/api/a2ui/agent-onboarding`);
    assert.equal(missing.status, 400);
    assert.match(await missing.text(), /catalogId 必须是非空字符串/);

    const unknown = await fetch(
      `${baseUrl}/api/a2ui/agent-onboarding?catalogId=${encodeURIComponent('unknown-catalog')}`,
    );
    assert.equal(unknown.status, 404);
    assert.match(await unknown.text(), /AGENT_ONBOARDING_CONTRACT_NOT_FOUND/);
  });

  it('rejects missing ids and unpublished catalogs', async () => {
    const missing = await fetch(`${baseUrl}/api/a2ui/catalog-contract`);
    assert.equal(missing.status, 400);
    assert.match(await missing.text(), /catalogId 必须是非空字符串/);

    const unknown = await fetch(
      `${baseUrl}/api/a2ui/catalog-contract?catalogId=${encodeURIComponent('unknown-catalog')}`,
    );
    assert.equal(unknown.status, 404);
    assert.match(await unknown.text(), /CATALOG_CONTRACT_NOT_FOUND/);
  });

  it('rejects duplicate publication during host assembly', () => {
    assert.throws(
      () =>
        createAgentRouter({
          adapter: new AgentAdapter({ useLlm: () => false }),
          catalogContracts: [catalog, catalog],
        }),
      /Catalog contract 重复公开/,
    );
  });
});
