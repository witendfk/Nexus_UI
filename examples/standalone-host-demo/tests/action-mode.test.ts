import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { afterEach, describe, it } from 'node:test';
import { createStandaloneHostApp } from '../src/host/app';
import { resolveStandaloneHostActionMode } from '../src/shared/action-mode';

const servers: Server[] = [];

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

describe('standalone host action mode', () => {
  afterEach(async () => {
    await closeServers();
  });

  it('defaults to the external Agent and supports an explicit local handler', () => {
    assert.equal(resolveStandaloneHostActionMode(undefined), 'external');
    assert.equal(resolveStandaloneHostActionMode('  '), 'external');
    assert.equal(resolveStandaloneHostActionMode('external'), 'external');
    assert.equal(resolveStandaloneHostActionMode('local'), 'local');
    assert.throws(() => resolveStandaloneHostActionMode('remote'), /只支持 external 或 local/);
  });

  it('reports the selected action policy without changing the generation Agent mode', async () => {
    const app = createStandaloneHostApp({
      endpoint: 'https://agent.invalid/a2ui',
      actionMode: 'local',
    });
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Failed to listen on a TCP port');
    }
    const { port } = address;

    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.deepEqual(health, {
      status: 'ok',
      service: '@nexus-ui/server',
      version: '0.1.0',
      agentMode: 'external-rpc',
      actionMode: 'local',
    });
  });
});
