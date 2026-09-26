import assert from 'node:assert/strict';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, it } from 'node:test';
import { createCatalogPromptContract } from '@nexus-ui/core';
import { createAgentOnboardingContract } from '@nexus-ui/server';
import { DEMO_AGENT_ACTION, DEMO_AGENT_CATALOG_ID } from '../src/contract';
import { standaloneHostCatalog } from '../src/shared/catalog-contract';
import { verifyExternalAgentIntegration, verifyExternalAgentOnboarding } from '../src/host/verify';

const surfaceId = 'surface-verify-host';
const servers: Server[] = [];

function writeMessage(response: ServerResponse, message: unknown): void {
  response.write(`${JSON.stringify(message)}\n`);
}

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (!server) continue;
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe('verifyExternalAgentIntegration', () => {
  it('accepts a compliant external Agent and verifies policy rejection', async () => {
    const server = createServer((request, response) => {
      if (request.url === '/onboarding') {
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify(
            createAgentOnboardingContract({
              catalogContract: {
                serverApiVersion: 1,
                kind: 'catalog-contract',
                catalog: standaloneHostCatalog,
                promptContract: createCatalogPromptContract(standaloneHostCatalog),
              },
              rpcEndpoint: `http://${request.headers.host}/agent`,
            }),
          ),
        );
        return;
      }

      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        const payload = JSON.parse(body) as { kind?: string; surfaceId?: string };
        const agentSurfaceId = payload.surfaceId ?? surfaceId;
        response.setHeader('Content-Type', 'application/x-ndjson');
        if (payload.kind === 'generate') {
          writeMessage(response, {
            version: 'v0.9',
            createSurface: { surfaceId: agentSurfaceId, catalogId: DEMO_AGENT_CATALOG_ID },
          });
          writeMessage(response, {
            version: 'v0.9',
            updateComponents: {
              surfaceId: agentSurfaceId,
              components: [
                {
                  id: 'root',
                  component: 'ApprovalSummary',
                  title: { path: '/title' },
                  amount: { path: '/amount' },
                  children: ['submit'],
                },
                {
                  id: 'submit',
                  component: 'Button',
                  child: 'submitLabel',
                  action: {
                    event: {
                      name: DEMO_AGENT_ACTION,
                      context: {
                        approvalId: { path: '/approvalId' },
                        amount: { path: '/amount' },
                      },
                    },
                  },
                },
                { id: 'submitLabel', component: 'Text', text: 'Approve' },
              ],
            },
          });
          writeMessage(response, {
            version: 'v0.9',
            updateDataModel: {
              surfaceId: agentSurfaceId,
              value: {
                title: 'Marketing campaign approval',
                amount: 'USD 12,000',
                approvalId: 'approval-verify-001',
              },
            },
          });
          response.end();
          return;
        }

        writeMessage(response, {
          version: 'v0.9',
          updateComponents: {
            surfaceId: agentSurfaceId,
            components: [
              {
                id: 'root',
                component: 'ApprovalSummary',
                title: { path: '/title' },
                amount: { path: '/amount' },
                children: ['submit'],
              },
              { id: 'submit', component: 'Button', child: 'submitLabel', disabled: true },
              { id: 'submitLabel', component: 'Text', text: 'Approved' },
            ],
          },
        });
        writeMessage(response, {
          version: 'v0.9',
          updateDataModel: {
            surfaceId: agentSurfaceId,
            value: { title: 'Approved: approval-verify-001', amount: 'USD 12,000' },
          },
        });
        response.end();
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const endpoint = `http://127.0.0.1:${address.port}/agent`;

    const report = await verifyExternalAgentIntegration({
      endpoint,
      message: '创建验收审批任务',
      timeoutMs: 1000,
    });

    assert.match(report.surfaceId, /^surface-/);
    assert.equal(report.actionName, DEMO_AGENT_ACTION);
    assert.equal(report.actionComponentId, 'submit');
    assert.deepEqual(report.actionContext, {
      approvalId: 'approval-verify-001',
      amount: 'USD 12,000',
    });
    assert.ok(report.componentIdsAfterGeneration.includes('root'));
    assert.ok(report.componentIdsAfterAction.includes('root'));
    assert.equal(report.policyRejection.rejected, true);
    assert.equal(report.policyRejection.boundaryCode, 'POLICY_REJECTED');
    assert.deepEqual(
      report.checks.map((check) => [check.id, check.status]),
      [
        ['generation-lifecycle', 'passed'],
        ['catalog-stability', 'passed'],
        ['generation-root', 'passed'],
        ['action-same-surface', 'passed'],
        ['action-root-stability', 'passed'],
        ['policy-rejection', 'passed'],
      ],
    );

    const onboardingReport = await verifyExternalAgentOnboarding({
      contractUrl: `http://127.0.0.1:${address.port}/onboarding`,
      message: '创建验收审批任务',
      timeoutMs: 1000,
    });
    assert.equal(onboardingReport.contractUrl, `http://127.0.0.1:${address.port}/onboarding`);
    assert.equal(onboardingReport.catalogId, DEMO_AGENT_CATALOG_ID);
    assert.equal(onboardingReport.actionName, DEMO_AGENT_ACTION);
    assert.equal(onboardingReport.policyRejection.boundaryCode, 'POLICY_REJECTED');
  });
});
