import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, it } from 'node:test';
import type { CatalogDefinition } from '@nexus-ui/core';
import { createCatalogPromptContract } from '@nexus-ui/core';
import { createAgentOnboardingContract } from '../src/api/agent-onboarding';
import { verifyExternalAgentOnboarding } from '../src/agent/onboarding-verification';

const catalog: CatalogDefinition = {
  catalogId: 'https://example.com/catalogs/onboarding-verification/v1',
  components: ['ApprovalSummary', 'Button', 'Text'],
  actions: ['submit'],
  componentSchemas: {
    ApprovalSummary: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'status'],
      properties: {
        title: { type: 'string', dynamic: 'required' },
        status: { type: 'string', dynamic: 'required' },
      },
    },
    Button: {
      type: 'object',
      additionalProperties: false,
      properties: {
        disabled: { type: 'boolean', dynamic: 'forbidden' },
      },
    },
  },
  componentPolicies: {
    ApprovalSummary: {
      origin: 'host-extension',
      fields: {
        title: { binding: 'required', origin: 'host-extension' },
        status: { binding: 'required', origin: 'host-extension' },
      },
      action: { allowed: false },
    },
    Button: {
      fields: {
        child: { componentRef: true, binding: 'forbidden', origin: 'host-extension' },
        disabled: { binding: 'forbidden', origin: 'host-extension' },
      },
      action: { allowed: true },
    },
  },
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

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(body) as unknown);
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function writeNdjson(response: ServerResponse, messages: unknown[]): void {
  response.setHeader('Content-Type', 'application/x-ndjson');
  for (const message of messages) response.write(`${JSON.stringify(message)}\n`);
  response.end();
}

describe('verifyExternalAgentOnboarding', () => {
  it('fetches a published contract and verifies the disclosed JSONL Agent', async () => {
    const server = createServer(async (request, response) => {
      if (request.url === '/onboarding') {
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify(
            createAgentOnboardingContract({
              catalogContract: {
                serverApiVersion: 1,
                kind: 'catalog-contract',
                catalog,
                promptContract: createCatalogPromptContract(catalog),
              },
              rpcEndpoint: `http://${request.headers.host}/agent`,
              verificationCommand: 'pnpm verify-agent',
            }),
          ),
        );
        return;
      }

      const payload = (await readJsonBody(request)) as {
        kind?: string;
        surfaceId?: string;
      };
      const surfaceId = payload.surfaceId ?? 'surface-onboarding';
      if (payload.kind === 'generate') {
        writeNdjson(response, [
          {
            version: 'v0.9',
            createSurface: { surfaceId, catalogId: catalog.catalogId },
          },
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId,
              components: [
                {
                  id: 'root',
                  component: 'ApprovalSummary',
                  title: { path: '/title' },
                  status: { path: '/status' },
                  children: ['submit'],
                },
                {
                  id: 'submit',
                  component: 'Button',
                  child: 'submitLabel',
                  action: {
                    event: {
                      name: 'submit',
                      context: { title: { path: '/title' } },
                    },
                  },
                },
                { id: 'submitLabel', component: 'Text', text: 'Submit' },
              ],
            },
          },
          {
            version: 'v0.9',
            updateDataModel: {
              surfaceId,
              value: { title: 'Onboarding task', status: 'Pending' },
            },
          },
        ]);
        return;
      }

      writeNdjson(response, [
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId,
            components: [
              {
                id: 'root',
                component: 'ApprovalSummary',
                title: { path: '/title' },
                status: { path: '/status' },
                children: ['submit'],
              },
              { id: 'submit', component: 'Button', child: 'submitLabel', disabled: true },
              { id: 'submitLabel', component: 'Text', text: 'Submitted' },
            ],
          },
        },
        {
          version: 'v0.9',
          updateDataModel: {
            surfaceId,
            value: { title: 'Onboarding task', status: 'Submitted' },
          },
        },
      ]);
    });

    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const contractUrl = `http://127.0.0.1:${address.port}/onboarding`;

    const report = await verifyExternalAgentOnboarding({
      contractUrl,
      message: 'Create an onboarding verification task',
      timeoutMs: 1000,
    });

    assert.equal(report.endpoint, `http://127.0.0.1:${address.port}/agent`);
    assert.equal(report.contractUrl, contractUrl);
    assert.equal(report.contract.kind, 'agent-onboarding-contract');
    assert.equal(report.catalogId, catalog.catalogId);
    assert.equal(report.actionName, 'submit');
    assert.equal(report.actionContext.title, 'Onboarding task');
    assert.equal(report.policyRejection.boundaryCode, 'POLICY_REJECTED');
    assert.equal(
      report.checks.every((check) => check.status === 'passed'),
      true,
    );
  });

  it('rejects an undisclosed endpoint when the caller does not supply one', async () => {
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify(
          createAgentOnboardingContract({
            catalogContract: {
              serverApiVersion: 1,
              kind: 'catalog-contract',
              catalog,
              promptContract: createCatalogPromptContract(catalog),
            },
          }),
        ),
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    await assert.rejects(
      verifyExternalAgentOnboarding({
        contractUrl: `http://127.0.0.1:${address.port}/onboarding`,
        timeoutMs: 1000,
      }),
      /未披露 Agent endpoint/,
    );
  });

  it('rejects a mismatched expected catalog id before running the Agent', async () => {
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify(
          createAgentOnboardingContract({
            catalogContract: {
              serverApiVersion: 1,
              kind: 'catalog-contract',
              catalog,
              promptContract: createCatalogPromptContract(catalog),
            },
            rpcEndpoint: 'https://agent.invalid/a2ui',
          }),
        ),
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    await assert.rejects(
      verifyExternalAgentOnboarding({
        contractUrl: `http://127.0.0.1:${address.port}/onboarding`,
        expectedCatalogId: 'https://example.com/catalogs/other/v1',
        timeoutMs: 1000,
      }),
      /catalogId 不匹配/,
    );
  });
});
