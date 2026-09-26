import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { createCatalogPromptContract } from '@nexus-ui/core';
import { createStandaloneHostApp } from '../src/host/app';
import { DEMO_AGENT_CATALOG_ID } from '../src/contract';
import { standaloneHostCatalog } from '../src/shared/catalog-contract';

const servers: Server[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (!server) break;
    server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

describe('standalone host catalog contract route', () => {
  it('serves the catalog contract used by the host guard', async () => {
    const server = createStandaloneHostApp({
      endpoint: 'https://agent.invalid/a2ui',
      timeoutMs: 1,
    }).listen(0, '127.0.0.1') as Server;
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${port}/api/a2ui/catalog-contract?catalogId=${encodeURIComponent(
        DEMO_AGENT_CATALOG_ID,
      )}`,
    );
    const payload = (await response.json()) as {
      catalog?: unknown;
      promptContract?: string;
    };

    assert.equal(response.status, 200);
    assert.deepEqual(payload.catalog, standaloneHostCatalog);
    assert.equal(payload.promptContract, createCatalogPromptContract(standaloneHostCatalog));
  });

  it('publishes an agent onboarding contract for the demo catalog', async () => {
    const server = createStandaloneHostApp({
      endpoint: 'https://agent.invalid/a2ui',
      timeoutMs: 1,
    }).listen(0, '127.0.0.1') as Server;
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${port}/api/a2ui/agent-onboarding?catalogId=${encodeURIComponent(
        DEMO_AGENT_CATALOG_ID,
      )}`,
    );
    const payload = (await response.json()) as {
      kind?: string;
      catalogContract?: { catalog?: { catalogId?: string } };
      rpc?: { endpoint?: { disclosed?: boolean; url?: string } };
      errors?: { boundaryCodes?: string[] };
      verification?: { checks?: readonly { id?: string }[] };
    };

    assert.equal(response.status, 200);
    assert.equal(payload.kind, 'agent-onboarding-contract');
    assert.equal(payload.catalogContract?.catalog?.catalogId, DEMO_AGENT_CATALOG_ID);
    assert.equal(payload.rpc?.endpoint?.url, 'https://agent.invalid/a2ui');
    assert.ok(payload.errors?.boundaryCodes?.includes('POLICY_REJECTED'));
    assert.deepEqual(
      payload.verification?.checks?.map((check) => check.id),
      [
        'generation-lifecycle',
        'catalog-stability',
        'generation-root',
        'action-same-surface',
        'action-root-stability',
        'policy-rejection',
      ],
    );
  });

  it('discovers the standalone demo catalog contracts', async () => {
    const server = createStandaloneHostApp({
      endpoint: 'https://agent.invalid/a2ui',
      timeoutMs: 1,
    }).listen(0, '127.0.0.1') as Server;
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;
    const response = await fetch(`${baseUrl}/api/a2ui/published-catalogs`);
    const payload = (await response.json()) as {
      kind?: string;
      catalogs?: {
        catalogId?: string;
        components?: string[];
        actions?: string[];
        catalogContractUrl?: string;
        agentOnboardingUrl?: string;
      }[];
    };

    assert.equal(response.status, 200);
    assert.equal(payload.kind, 'published-catalog-list');
    assert.deepEqual(payload.catalogs, [
      {
        catalogId: DEMO_AGENT_CATALOG_ID,
        components: ['ApprovalSummary', 'Text', 'Button'],
        actions: ['approve'],
        catalogContractUrl: `${baseUrl}/api/a2ui/catalog-contract?catalogId=${encodeURIComponent(
          DEMO_AGENT_CATALOG_ID,
        )}`,
        agentOnboardingUrl: `${baseUrl}/api/a2ui/agent-onboarding?catalogId=${encodeURIComponent(
          DEMO_AGENT_CATALOG_ID,
        )}`,
      },
    ]);
  });
});
