import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';
import { afterEach, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type Koa from 'koa';
import { AgentAdapter } from '../src/agent/adapter';
import type { AgentMessageSource } from '../src/agent/adapter';
import { BASIC_CATALOG, agentCatalogRegistry } from '../src/agent/catalog';
import {
  createExternalAgentActionHandler,
  createExternalAgentGenerationSource,
} from '../src/agent/external-agent';
import { createCatalogContractReference } from '../src/agent/catalog-contract';
import { CATALOG_CONTRACT_VERSION } from '../src/agent/catalog-contract';
import { sendAgentRun } from '../src/api/send-messages';

interface CapturedRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

type RouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  body: unknown,
) => void | Promise<void>;

const servers: Server[] = [];
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function createSseContext(): Koa.Context & { getOutput(): string } {
  let body: unknown;
  let output = '';
  const context = {
    status: 200,
    set: () => undefined,
    res: { flushHeaders: () => undefined },
    set body(value: unknown) {
      body = value;
    },
    get body() {
      return body;
    },
    getOutput: () => output,
  };
  Object.defineProperty(context, 'body', {
    set(value: unknown) {
      body = value;
      if (value instanceof PassThrough) {
        value.on('data', (chunk: Buffer) => {
          output += chunk.toString('utf8');
        });
      }
    },
    get(): unknown {
      return body;
    },
  });
  return context as unknown as Koa.Context & { getOutput(): string };
}

async function collect(source: AgentMessageSource): Promise<unknown[]> {
  const messages: unknown[] = [];
  for await (const message of source) messages.push(message);
  return messages;
}

async function startAgentServer(handler: RouteHandler): Promise<{
  endpoint: string;
  requests: CapturedRequest[];
}> {
  const requests: CapturedRequest[] = [];
  const server = createServer((request, response) => {
    let rawBody = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      rawBody += chunk;
    });
    request.on('end', () => {
      let body: unknown = rawBody;
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body,
      });
      void Promise.resolve(handler(request, response, body));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { endpoint: `http://127.0.0.1:${port}/agent`, requests };
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

describe('external agent RPC', () => {
  afterEach(async () => {
    await closeServers();
  });

  it('通过外部 JSONL RPC 完成生成与 action 原地更新闭环', async () => {
    const surfaceId = 'surface-external-rpc';
    const { endpoint, requests } = await startAgentServer((_request, response, body) => {
      response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      response.setHeader('Connection', 'close');
      const rpcRequest = body as { kind?: string };
      if (rpcRequest.kind === 'generate') {
        const messages = [
          {
            version: 'v0.9',
            createSurface: { surfaceId, catalogId: BASIC_CATALOG },
          },
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId,
              components: [
                {
                  id: 'root',
                  component: 'Column',
                  children: ['externalText', 'submitButton', 'submitLabel'],
                },
                {
                  id: 'externalText',
                  component: 'Text',
                  text: 'External generation',
                  variant: 'body',
                },
                {
                  id: 'submitButton',
                  component: 'Button',
                  child: 'submitLabel',
                  action: { event: { name: 'submit', context: {} } },
                },
                { id: 'submitLabel', component: 'Text', text: 'Submit' },
              ],
            },
          },
        ];
        response.end(messages.map((message) => `${JSON.stringify(message)}\n`).join(''));
        return;
      }
      response.end(
        `{"version":"v0.9","updateComponents":{"surfaceId":"${surfaceId}","components":[{"id":"root","component":"Text","text":"External action done","variant":"body"}]}}\n`,
      );
    });
    const adapter = new AgentAdapter({
      actionHandlers: new Map(),
      useLlm: () => false,
      createSurfaceId: () => surfaceId,
      createGenerationSource: createExternalAgentGenerationSource({
        endpoint,
        headers: { Authorization: 'Bearer test-token' },
        timeoutMs: 1000,
        catalogContractUrl: 'https://host.example/api/a2ui/catalog-contract?catalogId=host',
      }),
      resolveActionContext: ({ clientContext }) => ({ ...clientContext }),
    });
    adapter.registerActionHandler(
      BASIC_CATALOG,
      'submit',
      createExternalAgentActionHandler({
        endpoint,
        timeoutMs: 1000,
        catalogContractUrl: 'https://host.example/api/a2ui/catalog-contract?catalogId=host',
      }),
    );

    const generation = await adapter.prepareGeneration({ message: '创建外部任务面' });
    assert.ok(generation.ok);
    const generationTransport = createSseContext();
    const generationResult = await sendAgentRun(generationTransport, generation.run, 'external');
    assert.equal(generationResult.ok, true, generationTransport.getOutput());
    assert.deepEqual(
      generationResult.messages.map((message) => message),
      [
        {
          version: 'v0.9',
          createSurface: { surfaceId, catalogId: BASIC_CATALOG },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId,
            components: [
              {
                id: 'root',
                component: 'Column',
                children: ['externalText', 'submitButton', 'submitLabel'],
              },
              {
                id: 'externalText',
                component: 'Text',
                text: 'External generation',
                variant: 'body',
              },
              {
                id: 'submitButton',
                component: 'Button',
                child: 'submitLabel',
                action: { event: { name: 'submit', context: {} } },
              },
              { id: 'submitLabel', component: 'Text', text: 'Submit' },
            ],
          },
        },
      ],
    );

    const action = await adapter.prepareAction({
      name: 'submit',
      surfaceId,
      sourceComponentId: 'submitButton',
      timestamp: new Date().toISOString(),
      context: { keyword: 'A2UI Runtime' },
    });
    assert.ok(action.ok);
    const actionResult = await sendAgentRun(createSseContext(), action.run, 'external-action');
    assert.equal(actionResult.ok, true);
    assert.match(JSON.stringify(actionResult.messages), /External action done/);

    assert.equal(requests.length, 2);
    const generationRequest = requests[0]?.body as Record<string, unknown>;
    const actionRequest = requests[1]?.body as Record<string, unknown>;
    assert.equal(generationRequest.version, 1);
    assert.equal(generationRequest.kind, 'generate');
    assert.equal(generationRequest.surfaceId, surfaceId);
    assert.equal(generationRequest.catalogId, BASIC_CATALOG);
    assert.ok((generationRequest.supportedComponents as string[]).includes('Text'));
    assert.ok((generationRequest.supportedActions as string[]).includes('submit'));
    const generationContract = generationRequest.catalogContract as Record<string, unknown>;
    const actionContract = actionRequest.catalogContract as Record<string, unknown>;
    assert.deepEqual(generationContract.version, CATALOG_CONTRACT_VERSION);
    assert.equal(
      generationContract.hash,
      createCatalogContractReference(agentCatalogRegistry.get(BASIC_CATALOG)!).hash,
    );
    assert.equal(
      generationContract.url,
      'https://host.example/api/a2ui/catalog-contract?catalogId=host',
    );
    assert.equal(actionContract.version, generationContract.version);
    assert.equal(actionContract.hash, generationContract.hash);
    assert.equal(actionContract.url, generationContract.url);
    assert.equal(actionRequest.kind, 'action');
    assert.deepEqual((actionRequest.action as { context?: unknown }).context, {
      keyword: 'A2UI Runtime',
    });
    const actionHistory = actionRequest.history as Array<{ content: string }>;
    assert.equal(actionHistory[0]?.content, '创建外部任务面');
    assert.match(actionHistory[1]?.content ?? '', /External generation/);
  });

  it('非 2xx 响应返回远端错误契约并停止流', async () => {
    const { endpoint } = await startAgentServer((_request, response) => {
      response.statusCode = 503;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ error: { message: 'Agent unavailable' } }));
    });
    const source = createExternalAgentGenerationSource({ endpoint, timeoutMs: 1000 })({
      kind: 'generate',
      surfaceId: 'surface-error',
      message: '请求失败',
      catalogId: BASIC_CATALOG,
      catalog: { catalogId: BASIC_CATALOG, components: ['Text'] },
      supportedComponents: ['Text'],
      supportedActions: ['submit'],
      history: [],
      catalogContract: createCatalogContractReference({
        catalogId: BASIC_CATALOG,
        components: ['Text'],
      }),
    });

    await assert.rejects(collect(source), /Agent unavailable/);
  });

  it('RPC 超时转换为明确错误', async () => {
    const { endpoint } = await startAgentServer(async (_request, response) => {
      await sleep(100);
      response.setHeader('Content-Type', 'application/x-ndjson');
      response.end('');
    });
    const source = createExternalAgentGenerationSource({
      endpoint,
      timeoutMs: 1,
    })({
      kind: 'generate',
      surfaceId: 'surface-timeout',
      message: '请求超时',
      catalogId: BASIC_CATALOG,
      catalog: { catalogId: BASIC_CATALOG, components: ['Text'] },
      supportedComponents: ['Text'],
      supportedActions: ['submit'],
      history: [],
      catalogContract: createCatalogContractReference({
        catalogId: BASIC_CATALOG,
        components: ['Text'],
      }),
    });

    await assert.rejects(collect(source), /RPC 超过 1ms/);
  });
});
