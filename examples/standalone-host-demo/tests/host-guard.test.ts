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
import { createStandaloneHostAdapter } from '../src/host/adapter';
import { createStandaloneHostApp } from '../src/host/app';
import { DEMO_AGENT_ACTION, DEMO_AGENT_CATALOG_ID } from '../src/contract';
import { createStandaloneHostRegistry, standaloneHostRenderMap } from '../src/shared/catalog';

const STANDALONE_HOST_ACTION = DEMO_AGENT_ACTION;
const STANDALONE_HOST_CATALOG_ID = DEMO_AGENT_CATALOG_ID;

type RemoteRequest = {
  version?: number;
  kind?: string;
  surfaceId?: string;
  message?: string;
  catalogId?: string;
  supportedComponents?: string[];
  supportedActions?: string[];
  action?: { name?: string; context?: Record<string, unknown> };
  history?: Array<{ content: string }>;
};

const servers: Server[] = [];
const surfaceId = 'surface-standalone-host';

type RouteHandler = (request: IncomingMessage, response: ServerResponse, body: unknown) => void;

function writeMessage(response: ServerResponse, message: unknown): void {
  response.write(`${JSON.stringify(message)}\n`);
}

async function startRemoteAgent(): Promise<{ endpoint: string; requests: RemoteRequest[] }> {
  const requests: RemoteRequest[] = [];
  const routeHandler: RouteHandler = (_request, response, rawBody) => {
    const body = rawBody as RemoteRequest;
    requests.push(body);
    response.setHeader('Content-Type', 'application/x-ndjson');
    if (body.kind === 'generate') {
      writeMessage(response, {
        version: 'v0.9',
        createSurface: { surfaceId, catalogId: STANDALONE_HOST_CATALOG_ID },
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
                  name: STANDALONE_HOST_ACTION,
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
            approvalId: 'approval-001',
          },
        },
      });
      response.end();
      return;
    }

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
          { id: 'submit', component: 'Button', child: 'submitLabel', disabled: true },
          { id: 'submitLabel', component: 'Text', text: 'Approved' },
        ],
      },
    });
    writeMessage(response, {
      version: 'v0.9',
      updateDataModel: {
        surfaceId,
        value: { title: 'Approved: approval-001', amount: 'USD 12,000' },
      },
    });
    response.end();
  };
  const server = createServer((request, response) => {
    let rawBody = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      rawBody += chunk;
    });
    request.on('end', () => {
      void routeHandler(request, response, JSON.parse(rawBody));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { endpoint: `http://127.0.0.1:${port}/agent`, requests };
}

async function startMalformedAgent(): Promise<{ endpoint: string; requests: RemoteRequest[] }> {
  const requests: RemoteRequest[] = [];
  const server = createServer((request, response) => {
    let rawBody = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      rawBody += chunk;
    });
    request.on('end', () => {
      requests.push(JSON.parse(rawBody) as RemoteRequest);
      response.setHeader('Content-Type', 'application/x-ndjson');
      response.end('{"version":"v0.9","createSurface":\n');
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { endpoint: `http://127.0.0.1:${port}/agent`, requests };
}

function createSseContext(): { ctx: Koa.Context; getOutput: () => string } {
  let output = '';
  let body: unknown;
  const ctx = {
    status: 200,
    set: () => undefined,
    res: { flushHeaders: () => undefined },
    get body() {
      return body;
    },
    set body(value: unknown) {
      body = value;
      if (value instanceof PassThrough) {
        value.on('data', (chunk: Buffer) => {
          output += chunk.toString('utf8');
        });
      }
    },
  } as unknown as Koa.Context;
  return { ctx, getOutput: () => output };
}

function pushMessages(runtime: A2UIRuntime, messages: unknown[]): void {
  runtime.push(`${messages.map((message) => JSON.stringify(message)).join('\n')}\n`);
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

describe('standalone host example', () => {
  afterEach(async () => {
    await closeServers();
  });

  it('connects an external Agent, custom catalog, React renderer, and action loop', async () => {
    const { endpoint, requests } = await startRemoteAgent();
    const adapter = createStandaloneHostAdapter({
      endpoint,
      timeoutMs: 1000,
      createSurfaceId: () => surfaceId,
    });
    const renderer = new ReactRenderer(standaloneHostRenderMap);
    const actionEvents: ActionEvent[] = [];
    let markup = '';
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
      message: '创建审批任务面',
      catalogId: STANDALONE_HOST_CATALOG_ID,
    });
    assert.ok(generation.ok);
    const generationTransport = createSseContext();
    const generationResult = await sendAgentRun(
      generationTransport.ctx,
      generation.run,
      'standalone-generation',
    );

    assert.equal(generationResult.ok, true);
    assert.match(generationTransport.getOutput(), /event: done/);
    assert.doesNotMatch(generationTransport.getOutput(), /event: error/);
    assert.deepEqual(requests[0]?.supportedActions, [STANDALONE_HOST_ACTION]);

    pushMessages(runtime, generationResult.messages);
    assert.match(markup, /Marketing campaign approval/);
    assert.match(markup, /USD 12,000/);
    assert.match(markup, /Approve/);

    runtime.triggerAction('submit', surfaceId);
    assert.deepEqual(actionEvents, [
      {
        name: STANDALONE_HOST_ACTION,
        surfaceId,
        sourceComponentId: 'submit',
        context: { approvalId: 'approval-001', amount: 'USD 12,000' },
      },
    ]);

    const actionEvent = actionEvents[0];
    assert.ok(actionEvent);
    const action = await adapter.prepareAction({
      ...actionEvent,
      sourceComponentId: actionEvent.sourceComponentId,
      timestamp: new Date().toISOString(),
    });
    assert.ok(action.ok);
    const actionTransport = createSseContext();
    const actionResult = await sendAgentRun(actionTransport.ctx, action.run, 'standalone-action');

    assert.equal(actionResult.ok, true);
    assert.match(actionTransport.getOutput(), /event: done/);
    assert.doesNotMatch(actionTransport.getOutput(), /event: error/);
    assert.equal(requests[1]?.kind, 'action');
    assert.equal(requests[1]?.action?.name, STANDALONE_HOST_ACTION);
    assert.deepEqual(requests[1]?.action?.context, actionEvent.context);
    assert.match(requests[1]?.history?.[0]?.content ?? '', /创建审批任务面/);

    pushMessages(runtime, actionResult.messages);
    assert.match(markup, /Approved: approval-001/);
    assert.match(markup, /disabled=""/);
    assert.deepEqual(runtime.store.getState().errors, []);
  });

  it('rejects an undeclared catalog action before it reaches SSE', async () => {
    const generation = await createStandaloneHostAdapter({
      endpoint: 'https://agent.invalid/a2ui',
      createSurfaceId: () => surfaceId,
    }).prepareGeneration({ catalogId: STANDALONE_HOST_CATALOG_ID });
    assert.ok(generation.ok);
    generation.run.source = [
      {
        version: 'v0.9',
        createSurface: { surfaceId, catalogId: STANDALONE_HOST_CATALOG_ID },
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
              amount: { path: '/amount' },
            },
            {
              id: 'submit',
              component: 'Button',
              child: 'submitLabel',
              action: { event: { name: 'reject' } },
            },
            { id: 'submitLabel', component: 'Text', text: 'Reject' },
          ],
        },
      },
    ];
    const transport = createSseContext();
    const result = await sendAgentRun(transport.ctx, generation.run, 'invalid-action');

    assert.equal(result.ok, false);
    assert.match(transport.getOutput(), /当前 Agent 线不支持 action: reject/);
    assert.doesNotMatch(transport.getOutput(), /event: done/);
  });

  it('converts a replaced external Agent endpoint with malformed JSONL to SSE error', async () => {
    const { endpoint, requests } = await startMalformedAgent();
    const app = createStandaloneHostApp({
      endpoint,
      timeoutMs: 1000,
      createSurfaceId: () => surfaceId,
    });
    const hostServer = app.listen(0, '127.0.0.1');
    servers.push(hostServer);
    await new Promise<void>((resolve) => hostServer.once('listening', resolve));
    const { port } = hostServer.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/api/a2ui/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '创建替换 endpoint 后的审批任务面',
        catalogId: STANDALONE_HOST_CATALOG_ID,
      }),
    });
    const output = await response.text();

    assert.equal(response.status, 200);
    assert.match(output, /event: error/);
    assert.match(output, /外部 Agent 返回的 JSONL 中包含非法 JSON/);
    assert.doesNotMatch(output, /event: done/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.version, 1);
    assert.equal(requests[0]?.kind, 'generate');
    assert.equal(requests[0]?.surfaceId, surfaceId);
    assert.equal(requests[0]?.message, '创建替换 endpoint 后的审批任务面');
    assert.equal(requests[0]?.catalogId, STANDALONE_HOST_CATALOG_ID);
    assert.deepEqual(requests[0]?.supportedComponents, ['ApprovalSummary', 'Text', 'Button']);
    assert.deepEqual(requests[0]?.supportedActions, [STANDALONE_HOST_ACTION]);
    assert.deepEqual(requests[0]?.history, []);
  });

  it('serves a standalone host through guarded HTTP generation and action routes', async () => {
    const { endpoint, requests } = await startRemoteAgent();
    const app = createStandaloneHostApp({
      endpoint,
      timeoutMs: 1000,
      createSurfaceId: () => surfaceId,
    });
    const hostServer = app.listen(0, '127.0.0.1');
    servers.push(hostServer);
    await new Promise<void>((resolve) => hostServer.once('listening', resolve));
    const { port } = hostServer.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    const healthResponse = await fetch(`${baseUrl}/health`);
    const health = (await healthResponse.json()) as { agentMode?: string };
    assert.equal(health.agentMode, 'external-rpc');

    const generationResponse = await fetch(`${baseUrl}/api/a2ui/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '创建独立宿主审批任务面',
        catalogId: STANDALONE_HOST_CATALOG_ID,
      }),
    });
    const generationText = await generationResponse.text();

    assert.equal(generationResponse.status, 200);
    assert.match(generationText, new RegExp(`"catalogId":"${STANDALONE_HOST_CATALOG_ID}"`));
    assert.match(generationText, /"component":"ApprovalSummary"/);
    assert.match(generationText, /"name":"approve"/);
    assert.match(generationText, /event: done/);
    assert.doesNotMatch(generationText, /event: error/);

    const actionResponse = await fetch(`${baseUrl}/api/a2ui/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 'v0.9',
        action: {
          name: STANDALONE_HOST_ACTION,
          surfaceId,
          sourceComponentId: 'submit',
          timestamp: new Date().toISOString(),
          context: {
            approvalId: 'approval-001',
            amount: 'USD 12,000',
          },
        },
      }),
    });
    const actionText = await actionResponse.text();

    assert.equal(actionResponse.status, 200);
    assert.match(actionText, /Approved: approval-001/);
    assert.match(actionText, /"disabled":true/);
    assert.match(actionText, /event: done/);
    assert.doesNotMatch(actionText, /event: error/);
    assert.equal(requests[1]?.kind, 'action');
    assert.deepEqual(requests[1]?.action?.context, {
      approvalId: 'approval-001',
      amount: 'USD 12,000',
    });
    assert.match(requests[1]?.history?.[0]?.content ?? '', /创建独立宿主审批任务面/);
  });
});
