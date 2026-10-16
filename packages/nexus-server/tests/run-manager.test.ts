import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import type Koa from 'koa';
import { AgentAdapter } from '../src/agent/adapter';
import { InMemoryAgentRunManager } from '../src/agent/run-manager';
import { sendAgentRun } from '../src/api/send-messages';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function createSseContext(): Koa.Context {
  const req = new PassThrough();
  const res = new PassThrough();
  let body: unknown;
  return {
    req,
    res,
    status: 200,
    set: () => undefined,
    set body(value: unknown) {
      body = value;
    },
    get body() {
      return body;
    },
  } as unknown as Koa.Context;
}

describe('agent run manager', () => {
  it('records queued, running, and completed states', async () => {
    const manager = new InMemoryAgentRunManager();
    const adapter = new AgentAdapter({
      createSurfaceId: () => 'surface-run-success',
      createGenerationSource: () => [
        {
          version: 'v0.9',
          createSurface: {
            surfaceId: 'surface-run-success',
            catalogId: 'https://example.com/catalogs/nexus-basic-task/v1',
          },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'surface-run-success',
            components: [{ id: 'root', component: 'Text', text: 'Ready', variant: 'body' }],
          },
        },
      ],
    });
    const plan = await adapter.prepareGeneration({ message: '创建运行状态' });
    assert.ok(plan.ok);

    const result = await sendAgentRun(createSseContext(), plan.run, 'run-success', {
      manager,
      streamDelayMs: 0,
    });

    assert.equal(result.ok, true);
    const runs = manager.listBySurface('surface-run-success');
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.state, 'succeeded');
    assert.ok(runs[0]?.startedAt);
    assert.ok(runs[0]?.endedAt);
  });

  it('serializes runs on the same surface', async () => {
    const manager = new InMemoryAgentRunManager();
    const events: string[] = [];
    const surfaceId = 'surface-run-serial';
    const adapter = new AgentAdapter({
      createSurfaceId: () => surfaceId,
      createGenerationSource: () =>
        (async function* () {
          events.push('start');
          yield {
            version: 'v0.9',
            createSurface: {
              surfaceId,
              catalogId: 'https://example.com/catalogs/nexus-basic-task/v1',
            },
          };
          await sleep(20);
          yield {
            version: 'v0.9',
            updateComponents: {
              surfaceId,
              components: [{ id: 'root', component: 'Text', text: 'First', variant: 'body' }],
            },
          };
          events.push('end');
        })(),
    });
    const first = await adapter.prepareGeneration({ message: 'first' });
    const second = await adapter.prepareGeneration({ message: 'second' });
    assert.ok(first.ok);
    assert.ok(second.ok);

    const firstRun = sendAgentRun(createSseContext(), first.run, 'serial-1', {
      manager,
      streamDelayMs: 0,
    });
    const secondRun = sendAgentRun(createSseContext(), second.run, 'serial-2', {
      manager,
      streamDelayMs: 0,
    });
    const results = await Promise.all([firstRun, secondRun]);

    assert.deepEqual(
      results.map((result) => result.ok),
      [true, true],
    );
    assert.deepEqual(events, ['start', 'end', 'start', 'end']);
    assert.deepEqual(
      manager.listBySurface(surfaceId).map((run) => run.state),
      ['succeeded', 'succeeded'],
    );
  });

  it('marks an interrupted run canceled', async () => {
    const manager = new InMemoryAgentRunManager();
    const controller = new AbortController();
    const surfaceId = 'surface-run-cancel';
    const adapter = new AgentAdapter({
      createSurfaceId: () => surfaceId,
      createGenerationSource: () =>
        (async function* () {
          yield {
            version: 'v0.9',
            createSurface: {
              surfaceId,
              catalogId: 'https://example.com/catalogs/nexus-basic-task/v1',
            },
          };
          await sleep(20);
          yield {
            version: 'v0.9',
            updateComponents: {
              surfaceId,
              components: [{ id: 'root', component: 'Text', text: 'Never', variant: 'body' }],
            },
          };
        })(),
    });
    const plan = await adapter.prepareGeneration(
      { message: '取消测试' },
      {
        signal: controller.signal,
      },
    );
    assert.ok(plan.ok);

    const run = sendAgentRun(createSseContext(), plan.run, 'run-cancel', {
      manager,
      signal: controller.signal,
      streamDelayMs: 50,
    });
    controller.abort();
    const result = await run;

    assert.equal(result.ok, false);
    assert.equal(manager.get('run-cancel')?.state, 'canceled');
  });
});
