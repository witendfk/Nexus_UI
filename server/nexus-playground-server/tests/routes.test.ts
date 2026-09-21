import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { TASK_CATALOG } from '../src/agent/catalog';

process.env.NODE_ENV = 'test';
delete process.env.OPENAI_API_KEY;

const { app } = await import('../src/index');
const server = app.listen(0) as Server;
const { port } = server.address() as AddressInfo;
const baseUrl = `http://127.0.0.1:${port}`;

after(() => {
  server.close();
});

describe('Agent line routes', () => {
  it('无 LLM key 时使用联系人卡片 fallback', async () => {
    const response = await fetch(`${baseUrl}/api/a2ui/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '生成一张联系人卡片' }),
    });
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
    assert.match(text, /createSurface/);
    assert.match(text, /David Park/);
    assert.match(text, /event: done/);
  });

  it('拒绝生成请求未知字段', async () => {
    const response = await fetch(`${baseUrl}/api/a2ui/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi', extra: true }),
    });

    assert.equal(response.status, 400);
  });

  it('拒绝未注册的请求级 catalog', async () => {
    const response = await fetch(`${baseUrl}/api/a2ui/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogId: 'unknown-catalog' }),
    });

    assert.equal(response.status, 400);
  });

  it('action 回流返回同 surface 更新', async () => {
    const generated = await (
      await fetch(`${baseUrl}/api/a2ui/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).text();
    const surfaceId = /"surfaceId":"(surface-[^"]+)"/.exec(generated)?.[1];
    assert.ok(surfaceId);

    const response = await fetch(`${baseUrl}/api/a2ui/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 'v0.9',
        action: {
          name: 'call',
          surfaceId,
          sourceComponentId: 'callBtn',
          timestamp: new Date().toISOString(),
          context: {},
        },
      }),
    });
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.match(text, new RegExp(surfaceId));
    assert.match(text, /联系请求已发送/);
    assert.match(text, /event: done/);
  });

  it('task catalog 通过业务状态完成 start / complete 闭环', async () => {
    const generated = await (
      await fetch(`${baseUrl}/api/a2ui/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalogId: TASK_CATALOG }),
      })
    ).text();
    const surfaceId = /"surfaceId":"(surface-[^"]+)"/.exec(generated)?.[1];
    assert.ok(surfaceId);
    assert.match(generated, new RegExp(`"catalogId":"${TASK_CATALOG}"`));
    assert.match(generated, /"component":"TaskSummary"/);
    assert.match(generated, /"component":"TaskButton"/);
    assert.match(generated, /"name":"start"/);
    assert.doesNotMatch(generated, /"component":"Text"/);
    assert.match(generated, /event: done/);

    const startResponse = await fetch(`${baseUrl}/api/a2ui/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 'v0.9',
        action: {
          name: 'start',
          surfaceId,
          sourceComponentId: 'button',
          timestamp: new Date().toISOString(),
          context: { taskId: 'task-001' },
        },
      }),
    });
    const startText = await startResponse.text();

    assert.equal(startResponse.status, 200);
    assert.match(startText, new RegExp(surfaceId));
    assert.match(startText, /"component":"TaskButton"/);
    assert.match(startText, /进行中/);
    assert.match(startText, /"name":"complete"/);
    assert.doesNotMatch(startText, /"component":"Text"/);
    assert.match(startText, /event: done/);

    const completeResponse = await fetch(`${baseUrl}/api/a2ui/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 'v0.9',
        action: {
          name: 'complete',
          surfaceId,
          sourceComponentId: 'button',
          timestamp: new Date().toISOString(),
          context: { taskId: 'task-001' },
        },
      }),
    });
    const completeText = await completeResponse.text();

    assert.equal(completeResponse.status, 200);
    assert.match(completeText, /已完成/);
    assert.match(completeText, /"disabled":true/);
    assert.match(completeText, /event: done/);

    const duplicateResponse = await fetch(`${baseUrl}/api/a2ui/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 'v0.9',
        action: {
          name: 'complete',
          surfaceId,
          sourceComponentId: 'button',
          timestamp: new Date().toISOString(),
          context: { taskId: 'task-001' },
        },
      }),
    });

    assert.equal(duplicateResponse.status, 400);
    assert.match(await duplicateResponse.text(), /任务不能从 completed 状态完成/);
  });

  it('拒绝未注册的业务 action handler', async () => {
    const response = await fetch(`${baseUrl}/api/a2ui/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 'v0.9',
        action: {
          name: 'missing',
          surfaceId: 'surface-missing-handler',
          sourceComponentId: 'button',
          timestamp: new Date().toISOString(),
          context: {},
        },
      }),
    });

    assert.equal(response.status, 400);
    assert.match(await response.text(), /Action handler 未注册/);
  });
});
