import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { afterEach, describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type Koa from 'koa';
import { A2UIRuntime } from '@nexus-ui/core';
import type { ActionEvent, VNode } from '@nexus-ui/core';
import { ReactRenderer } from '@nexus-ui/react';
import { sendAgentRun } from '@nexus-ui/server';
import { DEMO_AGENT_ACTION, DEMO_AGENT_CATALOG_ID } from '../src/contract';
import { createStandaloneHostAdapter } from '../src/host/adapter';
import { createLocalApprovalActionHandler } from '../src/host/local-action';
import { createStandaloneHostRegistry, standaloneHostRenderMap } from '../src/shared/catalog';

const surfaceId = 'surface-local-action';
const servers: Server[] = [];

function writeMessage(response: ServerResponse, message: unknown): void {
  response.write(`${JSON.stringify(message)}\n`);
}

async function startGenerationOnlyAgent(): Promise<{
  endpoint: string;
  requestCount: () => number;
}> {
  let requestCount = 0;
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    requestCount += 1;
    let rawBody = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      rawBody += chunk;
    });
    request.on('end', () => {
      const body = JSON.parse(rawBody) as { kind?: string };
      assert.equal(body.kind, 'generate');
      response.setHeader('Content-Type', 'application/x-ndjson');
      writeMessage(response, {
        version: 'v0.9',
        createSurface: { surfaceId, catalogId: DEMO_AGENT_CATALOG_ID },
      });
      writeMessage(response, {
        version: 'v0.9',
        updateComponents: {
          surfaceId,
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
          surfaceId,
          value: {
            title: 'Marketing campaign approval',
            amount: 'USD 12,000',
            approvalId: 'approval-local-001',
          },
        },
      });
      response.end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { endpoint: `http://127.0.0.1:${port}/agent`, requestCount: () => requestCount };
}

function createSseContext(): { ctx: Koa.Context; getOutput: () => string } {
  let output = '';
  const ctx = {
    status: 200,
    set: () => undefined,
    res: { flushHeaders: () => undefined },
    set body(value: unknown) {
      if (value instanceof PassThrough) {
        value.on('data', (chunk: Buffer) => {
          output += chunk.toString('utf8');
        });
      }
    },
  } as unknown as Koa.Context;
  return { ctx, getOutput: () => output };
}

async function closeServers(): Promise<void> {
  while (servers.length > 0) {
    const server = servers.pop();
    if (!server) break;
    server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe('standalone host local action assembly', () => {
  afterEach(async () => {
    await closeServers();
  });

  it('keeps the action loop in the host while generation uses the public server assembly API', async () => {
    const { endpoint, requestCount } = await startGenerationOnlyAgent();
    const adapter = createStandaloneHostAdapter({
      endpoint,
      timeoutMs: 1000,
      createSurfaceId: () => surfaceId,
      actionHandler: createLocalApprovalActionHandler(),
    });
    const renderer = new ReactRenderer(standaloneHostRenderMap);
    let markup = '';
    const actionEvents: ActionEvent[] = [];
    const runtime = new A2UIRuntime({
      catalogRegistry: createStandaloneHostRegistry(),
      onRender: (root: VNode | null) => {
        markup = renderToStaticMarkup(
          renderer.renderTree(root, {
            triggerAction: (componentId, sid) => runtime.triggerAction(componentId, sid),
            setInputValue: () => false,
          }),
        );
      },
      onAction: (event) => actionEvents.push(event),
    });

    const generation = await adapter.prepareGeneration({
      message: '创建本地 action 审批任务',
      catalogId: DEMO_AGENT_CATALOG_ID,
    });
    assert.ok(generation.ok);
    const generationTransport = createSseContext();
    const generationResult = await sendAgentRun(
      generationTransport.ctx,
      generation.run,
      'local-action-generation',
    );

    assert.equal(generationResult.ok, true);
    assert.match(generationTransport.getOutput(), /event: done/);
    runtime.push(
      `${generationResult.messages.map((message) => JSON.stringify(message)).join('\n')}\n`,
    );
    assert.match(markup, /Marketing campaign approval/);

    runtime.triggerAction('submit', surfaceId);
    const action = actionEvents[0];
    assert.ok(action);
    assert.equal(action.name, DEMO_AGENT_ACTION);
    assert.deepEqual(action.context, {
      approvalId: 'approval-local-001',
      amount: 'USD 12,000',
    });

    const actionPlan = await adapter.prepareAction({
      name: action.name,
      surfaceId,
      sourceComponentId: 'submit',
      timestamp: new Date().toISOString(),
      context: action.context,
    });
    assert.ok(actionPlan.ok);
    const actionTransport = createSseContext();
    const actionResult = await sendAgentRun(
      actionTransport.ctx,
      actionPlan.run,
      'local-action-response',
    );

    assert.equal(actionResult.ok, true);
    assert.match(actionTransport.getOutput(), /event: done/);
    assert.doesNotMatch(actionTransport.getOutput(), /event: error/);
    runtime.push(`${actionResult.messages.map((message) => JSON.stringify(message)).join('\n')}\n`);
    assert.match(markup, /Approved locally: approval-local-001/);
    assert.match(markup, /<p style="[^"]*">Approved locally<\/p><\/button>/);
    assert.match(markup, /disabled=""/);
    assert.deepEqual(runtime.store.getState().errors, []);
    assert.equal(requestCount(), 1);
  });
});
