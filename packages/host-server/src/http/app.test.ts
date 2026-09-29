import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, expect, it } from 'vitest';
import type Koa from 'koa';
import { createApp } from './app';
import { ORDEROPS_CATALOG_ID } from '../nexus/catalog';

const servers: http.Server[] = [];

function listen(app: Koa): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app.callback());
    servers.push(server);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

interface SseEvent {
  event: string;
  data: unknown;
}

function parseSse(raw: string): SseEvent[] {
  return raw
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const event = /event: (.+)/.exec(block)?.[1] ?? '';
      const dataLine = /data: (.+)/.exec(block)?.[1];
      return { event, data: dataLine === undefined ? undefined : JSON.parse(dataLine) };
    });
}

afterAll(() => {
  for (const server of servers) server.close();
});

it('GET /health 返回服务状态', async () => {
  const baseUrl = await listen(createApp());
  const response = await fetch(`${baseUrl}/health`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { status: string; service: string };
  expect(body.status).toBe('ok');
  expect(body.service).toBe('@orderops/host-server');
});

it('GET /api/a2ui/published-catalogs 发布 OrderOps Catalog', async () => {
  const baseUrl = await listen(createApp());
  const response = await fetch(`${baseUrl}/api/a2ui/published-catalogs`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { catalogs: Array<{ catalogId: string }> };
  expect(body.catalogs.map((catalog) => catalog.catalogId)).toContain(ORDEROPS_CATALOG_ID);
});

it('analyze 路由流式输出受控 surface 并以 done 结束', async () => {
  const baseUrl = await listen(createApp());
  const response = await fetch(`${baseUrl}/api/cases/case-1/analyze`, { method: 'POST' });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');

  const events = parseSse(await response.text());
  expect(events.at(-1)?.event).toBe('done');

  const messages = events.filter((entry) => entry.event === 'message').map((entry) => entry.data);
  expect(messages).toHaveLength(3);
  const create = messages[0] as { createSurface: { catalogId: string } };
  expect(create.createSurface.catalogId).toBe(ORDEROPS_CATALOG_ID);
});

it('action 回流触发 ping patch 并禁用按钮', async () => {
  const app = createApp();
  const baseUrl = await listen(app);

  const generateResponse = await fetch(`${baseUrl}/api/cases/case-1/analyze`, {
    method: 'POST',
  });
  const generateEvents = parseSse(await generateResponse.text());
  const createMessage = generateEvents.find((entry) => entry.event === 'message')
    ?.data as { createSurface: { surfaceId: string } };
  const surfaceId = createMessage.createSurface.surfaceId;

  const actionResponse = await fetch(`${baseUrl}/api/a2ui/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      version: 'v0.9',
      action: {
        name: 'ping',
        surfaceId,
        sourceComponentId: 'ping',
        timestamp: new Date().toISOString(),
        actionId: 'test-action-1',
        context: { note: '穿刺备注' },
      },
    }),
  });
  expect(actionResponse.status).toBe(200);

  const actionEvents = parseSse(await actionResponse.text());
  expect(actionEvents.at(-1)?.event).toBe('done');
  const patch = actionEvents.find((entry) => entry.event === 'message')
    ?.data as { updateComponents: { components: Array<{ id: string; disabled?: boolean }> } };
  expect(patch.updateComponents.components[0]).toMatchObject({ id: 'ping', disabled: true });
});

it('伪造的 action 名被拒绝', async () => {
  const app = createApp();
  const baseUrl = await listen(app);

  const generateResponse = await fetch(`${baseUrl}/api/cases/case-1/analyze`, {
    method: 'POST',
  });
  const generateEvents = parseSse(await generateResponse.text());
  const createMessage = generateEvents.find((entry) => entry.event === 'message')
    ?.data as { createSurface: { surfaceId: string } };

  // surface 快照里的 Button 只声明了 ping，伪造 action 名在快照校验即被拒（400，不进流）。
  const actionResponse = await fetch(`${baseUrl}/api/a2ui/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      version: 'v0.9',
      action: {
        name: 'createTicket',
        surfaceId: createMessage.createSurface.surfaceId,
        sourceComponentId: 'ping',
        timestamp: new Date().toISOString(),
        context: {},
      },
    }),
  });
  expect(actionResponse.status).toBe(400);
  const body = (await actionResponse.json()) as { error: string };
  expect(body.error).toBe('INVALID_REQUEST');
});
