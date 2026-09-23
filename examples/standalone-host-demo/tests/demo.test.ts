import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, it } from 'node:test';
import { DEMO_AGENT_ACTION, DEMO_AGENT_CATALOG_ID } from '../src/contract';
import { createDemoAgentServer } from '../src/agent';
import { createDemoHostApp } from '../src/host';

process.env.NODE_ENV = 'test';

const servers: Server[] = [];

async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function closeServers(): Promise<void> {
  while (servers.length > 0) {
    const server = servers.pop();
    if (!server) break;
    server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe('standalone host demo', () => {
  afterEach(async () => {
    await closeServers();
  });

  it('runs generation and approval through separate Agent and host processes', async () => {
    const agentBaseUrl = await listen(createDemoAgentServer({ mode: 'deterministic' }));
    const hostServer = createDemoHostApp({
      endpoint: `${agentBaseUrl}/agent`,
      timeoutMs: 1000,
    }).listen(0, '127.0.0.1') as Server;
    const hostBaseUrl = await listen(hostServer);

    const health = await (await fetch(`${hostBaseUrl}/health`)).json();
    assert.equal((health as { agentMode?: string }).agentMode, 'external-rpc');

    const generated = await (
      await fetch(`${hostBaseUrl}/api/a2ui/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '创建独立宿主演示审批',
          catalogId: DEMO_AGENT_CATALOG_ID,
        }),
      })
    ).text();
    const surfaceId = /"surfaceId":"([^"]+)"/.exec(generated)?.[1];
    assert.ok(surfaceId);
    assert.match(generated, new RegExp(`"catalogId":"${DEMO_AGENT_CATALOG_ID}"`));
    assert.match(generated, /Approval requested: 创建独立宿主演示审批/);
    assert.match(generated, new RegExp(`"name":"${DEMO_AGENT_ACTION}"`));
    assert.match(generated, /event: done/);

    const actionResponse = await fetch(`${hostBaseUrl}/api/a2ui/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 'v0.9',
        action: {
          name: DEMO_AGENT_ACTION,
          surfaceId,
          sourceComponentId: 'approve',
          timestamp: new Date().toISOString(),
          context: { approvalId: 'approval-demo-001', amount: 'USD 12,000' },
        },
      }),
    });
    const actionText = await actionResponse.text();
    assert.equal(actionResponse.status, 200);
    assert.match(actionText, /Approved: approval-demo-001/);
    assert.match(actionText, /"disabled":true/);
    assert.match(actionText, /event: done/);
  });
});
