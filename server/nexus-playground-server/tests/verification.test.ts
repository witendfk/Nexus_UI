import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, it } from 'node:test';
import type { CatalogDefinition } from '@nexus-ui/core';
import { verifyExternalAgentIntegration } from '../src/agent/verification';

const catalog: CatalogDefinition = {
  catalogId: 'https://example.com/catalogs/server-verification/v1',
  components: ['TaskSummary', 'Button', 'Text'],
  actions: ['submit'],
  componentSchemas: {
    TaskSummary: {
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
    TaskSummary: {
      origin: 'host-extension',
      fields: {
        title: { binding: 'required', origin: 'host-extension' },
        status: { binding: 'required', origin: 'host-extension' },
      },
      action: { allowed: false },
    },
    Button: {
      fields: {
        child: { componentRef: true, binding: 'forbidden', origin: 'official-basic' },
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
    if (!server) continue;
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe('verifyExternalAgentIntegration', () => {
  it('verifies a real JSONL Agent across generation, policy, and action boundaries', async () => {
    let generationRequest: unknown;
    const server = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        const payload = JSON.parse(body) as {
          kind?: string;
          surfaceId?: string;
        };
        const surfaceId = payload.surfaceId ?? 'surface-server-verification';
        response.setHeader('Content-Type', 'application/x-ndjson');

        if (payload.kind === 'generate') {
          generationRequest = payload;
          const messages = [
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
                    component: 'TaskSummary',
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
                        context: {
                          title: { path: '/title' },
                        },
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
                value: {
                  title: 'Server verification task',
                  status: 'Pending',
                },
              },
            },
          ];
          for (const message of messages) response.write(`${JSON.stringify(message)}\n`);
          response.end();
          return;
        }

        const messages = [
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId,
              components: [
                {
                  id: 'root',
                  component: 'TaskSummary',
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
              value: {
                title: 'Server verification task',
                status: 'Submitted',
              },
            },
          },
        ];
        for (const message of messages) response.write(`${JSON.stringify(message)}\n`);
        response.end();
      });
    });

    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    const report = await verifyExternalAgentIntegration({
      endpoint: `http://127.0.0.1:${address.port}/agent`,
      catalog,
      message: 'Run server verification',
      timeoutMs: 1000,
      actionSelector: (components) =>
        components.find((component) => component.id === 'submit') ?? null,
    });

    assert.equal(report.surfaceId.startsWith('surface-'), true);
    assert.equal(report.actionName, 'submit');
    assert.equal(report.actionComponentId, 'submit');
    assert.ok(report.componentIdsAfterGeneration.includes('root'));
    assert.ok(report.componentIdsAfterAction.includes('root'));
    assert.equal(report.policyRejection.rejected, true);
    assert.equal(report.policyRejection.boundaryCode, 'POLICY_REJECTED');
    assert.ok(generationRequest);
  });
});
