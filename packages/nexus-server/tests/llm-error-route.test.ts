import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.NODE_ENV = 'test';
process.env.OPENAI_API_KEY = 'test-key';
process.env.OPENAI_BASE_URL = 'http://127.0.0.1:9';

const { app } = await import('../src/main');
const server = app.listen(0) as Server;
const { port } = server.address() as AddressInfo;

after(() => {
  server.close();
});

describe('LLM failure route', () => {
  it('通过 SSE error 返回失败且不发送 done', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/a2ui/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '生成一张联系人卡片' }),
    });
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
    assert.match(text, /event: error/);
    assert.doesNotMatch(text, /event: done/);
  });
});
