import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import Koa from 'koa';
import { AgentAdapter, createAgentRouter } from '../src/index';
import { InMemoryAgentRunManager } from '../src/agent/run-manager';
import { TEST_CATALOG_ID, createTestRegistry } from './helpers/test-catalog';

const registry = createTestRegistry();

function createAdapter(): AgentAdapter {
  return new AgentAdapter({
    registry,
    useLlm: () => false,
    createGenerationSource: (request) => [
      {
        version: 'v0.9',
        createSurface: { surfaceId: request.surfaceId, catalogId: request.catalogId },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: request.surfaceId,
          components: [{ id: 'root', component: 'Text', text: 'Generated', variant: 'body' }],
        },
      },
    ],
  });
}

// 无 runsAccess：SDK 默认拒绝一切 runs 查询。
const defaultApp = new Koa();
defaultApp.use(createAgentRouter({ adapter: createAdapter() }).routes());
const defaultServer = defaultApp.listen(0, '127.0.0.1') as Server;
await new Promise<void>((resolve) => defaultServer.once('listening', resolve));
const defaultPort = (defaultServer.address() as AddressInfo).port;

// 有 runsAccess：宿主按可信上下文决定放行范围。
const gatedRunManager = new InMemoryAgentRunManager();
const gatedApp = new Koa();
gatedApp.use(
  createAgentRouter({
    adapter: createAdapter(),
    runManager: gatedRunManager,
    streamDelayMs: 0,
    runsAccess: (surfaceId) =>
      surfaceId.startsWith('surface-open') || !surfaceId.includes('secret'),
  }).routes(),
);
const gatedServer = gatedApp.listen(0, '127.0.0.1') as Server;
await new Promise<void>((resolve) => gatedServer.once('listening', resolve));
const gatedPort = (gatedServer.address() as AddressInfo).port;

after(async () => {
  defaultServer.closeAllConnections?.();
  gatedServer.closeAllConnections?.();
  await Promise.all([
    new Promise<void>((resolve) => defaultServer.close(() => resolve())),
    new Promise<void>((resolve) => gatedServer.close(() => resolve())),
  ]);
});

describe('createAgentRouter（通用装配）', () => {
  it('health 报告宿主显式配置的运行模式，默认值不读取环境或模型 key', async () => {
    const response = await fetch(`http://127.0.0.1:${defaultPort}/health`);
    const payload = (await response.json()) as { agentMode?: string; actionMode?: string };

    assert.equal(response.status, 200);
    assert.equal(payload.agentMode, 'default');
    assert.equal(payload.actionMode, 'adapter');
  });

  it('generate 缺 catalogId 返回 400 且不回落默认 Catalog', async () => {
    const response = await fetch(`http://127.0.0.1:${defaultPort}/api/a2ui/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '没有 catalogId' }),
    });

    assert.equal(response.status, 400);
    assert.match(await response.text(), /catalogId/);
  });

  it('generate 拒绝未知字段与未注册 catalog', async () => {
    const extra = await fetch(`http://127.0.0.1:${defaultPort}/api/a2ui/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi', catalogId: TEST_CATALOG_ID, extra: true }),
    });
    assert.equal(extra.status, 400);

    const unknown = await fetch(`http://127.0.0.1:${defaultPort}/api/a2ui/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogId: 'unknown-catalog' }),
    });
    assert.equal(unknown.status, 400);
    assert.match(await unknown.text(), /Agent catalog 未注册/);
  });

  it('未配置 runsAccess 时 runs 查询 403 并说明需宿主配置', async () => {
    const response = await fetch(
      `http://127.0.0.1:${defaultPort}/api/a2ui/runs?surfaceId=surface-any`,
    );

    assert.equal(response.status, 403, '未配置准入时不得默认放行');
    const body = (await response.json()) as { error?: string };
    assert.equal(body.error, 'RUNS_ACCESS_NOT_CONFIGURED');
  });

  it('runs 缺 surfaceId 仍是 400', async () => {
    const response = await fetch(`http://127.0.0.1:${defaultPort}/api/a2ui/runs`);
    assert.equal(response.status, 400);
  });

  it('配置 runsAccess 后按回调拒绝', async () => {
    const response = await fetch(
      `http://127.0.0.1:${gatedPort}/api/a2ui/runs?surfaceId=surface-secret-1`,
    );

    assert.equal(response.status, 403);
    const body = (await response.json()) as { error?: string };
    assert.equal(body.error, 'RUNS_ACCESS_DENIED');
  });

  it('配置 runsAccess 放行后可查询本实例 run 记录', async () => {
    const generated = await (
      await fetch(`http://127.0.0.1:${gatedPort}/api/a2ui/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '生成', catalogId: TEST_CATALOG_ID }),
      })
    ).text();
    const surfaceId = /"surfaceId":"(surface-[^"]+)"/.exec(generated)?.[1];
    assert.ok(surfaceId);

    const response = await fetch(
      `http://127.0.0.1:${gatedPort}/api/a2ui/runs?surfaceId=${encodeURIComponent(surfaceId)}`,
    );
    const payload = (await response.json()) as {
      kind?: string;
      runs?: Array<{ state?: string; kind?: string }>;
    };

    assert.equal(response.status, 200);
    assert.equal(payload.kind, 'agent-run-list');
    assert.equal(payload.runs?.length, 1);
    assert.equal(payload.runs?.[0]?.kind, 'generate');
    assert.equal(payload.runs?.[0]?.state, 'succeeded');
  });
});
