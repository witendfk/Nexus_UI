import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, it } from 'node:test';
import { fetchPublishedCatalogs } from '../src/api/catalog-discovery-client';

const payload = {
  serverApiVersion: 1,
  kind: 'published-catalog-list',
  catalogs: [
    {
      catalogId: 'https://example.com/catalogs/client-test/v1',
      contractVersion: 1,
      contractHash: 'sha256:catalog-contract-hash',
      components: ['Summary', 'Button'],
      actions: ['submit'],
      catalogContractUrl: 'https://example.com/api/a2ui/catalog-contract?catalogId=test',
      agentOnboardingUrl: 'https://example.com/api/a2ui/agent-onboarding?catalogId=test',
    },
  ],
};

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

describe('fetchPublishedCatalogs', () => {
  it('fetches and validates a published catalog payload', async () => {
    const server = createServer((request, response) => {
      assert.equal(request.url, '/api/a2ui/published-catalogs');
      assert.equal(request.headers.accept, 'application/json');
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(payload));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    const result = await fetchPublishedCatalogs({
      url: `http://127.0.0.1:${address.port}/api/a2ui/published-catalogs`,
      timeoutMs: 1000,
    });
    assert.deepEqual(result, payload);
  });

  it('rejects discovery summaries without a catalog contract identity', async () => {
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          ...payload,
          catalogs: [
            {
              ...payload.catalogs[0],
              contractVersion: 1,
              contractHash: 'not-a-catalog-contract-hash',
            },
          ],
        }),
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    await assert.rejects(
      fetchPublishedCatalogs({
        url: `http://127.0.0.1:${address.port}/api/a2ui/published-catalogs`,
        timeoutMs: 1000,
      }),
      /包含无效 catalog/,
    );
  });

  it('rejects a non-JSON payload', async () => {
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/plain');
      response.end('not-json');
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    await assert.rejects(
      fetchPublishedCatalogs({
        url: `http://127.0.0.1:${address.port}/discovery`,
        timeoutMs: 1000,
      }),
      /必须返回 JSON/,
    );
  });

  it('rejects an invalid payload shape', async () => {
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ serverApiVersion: 1, kind: 'unexpected', catalogs: [] }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    await assert.rejects(
      fetchPublishedCatalogs({
        url: `http://127.0.0.1:${address.port}/discovery`,
        timeoutMs: 1000,
      }),
      /kind 无效/,
    );
  });
});
