import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import type Koa from 'koa';
import { AgentAdapter } from '../src/agent/adapter';
import { InMemoryAgentRunManager } from '../src/agent/run-manager';
import { sendAgentRun } from '../src/api/send-messages';
import { TEST_CATALOG_ID, createTestRegistry } from './helpers/test-catalog';

const registry = createTestRegistry();

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
      registry,
      createSurfaceId: () => 'surface-run-success',
      createGenerationSource: () => [
        {
          version: 'v0.9',
          createSurface: {
            surfaceId: 'surface-run-success',
            catalogId: TEST_CATALOG_ID,
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
    const plan = await adapter.prepareGeneration({
      message: '创建运行状态',
      catalogId: TEST_CATALOG_ID,
    });
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
      registry,
      createSurfaceId: () => surfaceId,
      createGenerationSource: () =>
        (async function* () {
          events.push('start');
          yield {
            version: 'v0.9',
            createSurface: {
              surfaceId,
              catalogId: TEST_CATALOG_ID,
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
    const first = await adapter.prepareGeneration({ message: 'first', catalogId: TEST_CATALOG_ID });
    const second = await adapter.prepareGeneration({
      message: 'second',
      catalogId: TEST_CATALOG_ID,
    });
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

  it('缺 manager 时 sendAgentRun 显式报错，不再回退全局单例', async () => {
    const ctx = createSseContext();
    const run = {
      source: [
        { version: 'v0.9', updateDataModel: { surfaceId: 'surface-no-manager', value: {} } },
      ],
      sequence: {
        kind: 'action' as const,
        surfaceId: 'surface-no-manager',
        catalogId: TEST_CATALOG_ID,
        registry,
        supportedActions: ['submit'],
      },
      commit: () => undefined,
    };
    assert.throws(
      () => sendAgentRun(ctx, run, 'no-manager', {} as Parameters<typeof sendAgentRun>[3]),
      /manager/,
    );
  });

  it('marks an interrupted run canceled', async () => {
    const manager = new InMemoryAgentRunManager();
    const controller = new AbortController();
    const surfaceId = 'surface-run-cancel';
    const adapter = new AgentAdapter({
      registry,
      createSurfaceId: () => surfaceId,
      createGenerationSource: () =>
        (async function* () {
          yield {
            version: 'v0.9',
            createSurface: {
              surfaceId,
              catalogId: TEST_CATALOG_ID,
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
      { message: '取消测试', catalogId: TEST_CATALOG_ID },
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
