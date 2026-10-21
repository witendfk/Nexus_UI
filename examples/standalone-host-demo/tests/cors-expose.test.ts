import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, describe, it } from 'node:test';
import { NEXUS_RUN_ID_HEADER } from '@nexus-ui/server';
import { createStandaloneHostApp } from '../src/host/app';

const servers: Server[] = [];

after(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (!server) break;
    server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

describe('S2.6.1.2 standalone host CORS 暴露运行标识', () => {
  it('exposeHeaders 消费公开常量并对跨源响应生效', async () => {
    const server = createStandaloneHostApp({
      endpoint: 'https://agent.invalid/a2ui',
      timeoutMs: 1,
    }).listen(0, '127.0.0.1') as Server;
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    await response.json();

    assert.equal(response.status, 200);
    const exposed = (response.headers.get('access-control-expose-headers') ?? '')
      .toLowerCase()
      .split(',')
      .map((item) => item.trim());
    assert.ok(
      exposed.includes(NEXUS_RUN_ID_HEADER.toLowerCase()),
      `CORS exposeHeaders 必须暴露 ${NEXUS_RUN_ID_HEADER}，实际: ${exposed.join(', ')}`,
    );
  });
});
