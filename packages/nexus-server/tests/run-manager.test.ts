import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import type Koa from 'koa';
import { AgentAdapter } from '../src/agent/adapter';
import { InMemoryAgentRunManager } from '../src/agent/run-manager';
import { createCatalogContractHash } from '../src/agent/catalog-contract';
import { sendAgentRun, type SendAgentRunOptions } from '../src/api/send-messages';
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
      runManager: manager,
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

    const result = await sendAgentRun(createSseContext(), plan.run, {
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
      runManager: manager,
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

    const firstRun = sendAgentRun(createSseContext(), first.run, {
      manager,
      streamDelayMs: 0,
    });
    const secondRun = sendAgentRun(createSseContext(), second.run, {
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
      runId: 'no-manager-run',
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
      commit: () => ({
        sessionVersion: 1 as const,
        runId: 'no-manager-run',
        surfaceId: 'surface-no-manager',
        catalogId: TEST_CATALOG_ID,
        contractVersion: 2,
        catalogHash: createCatalogContractHash(registry.get(TEST_CATALOG_ID)!),
        surfaceRevision: 1,
      }),
    };
    assert.throws(() => sendAgentRun(ctx, run, {} as SendAgentRunOptions), /manager/);
  });

  it('marks an interrupted run canceled', async () => {
    const manager = new InMemoryAgentRunManager();
    const controller = new AbortController();
    const surfaceId = 'surface-run-cancel';
    const adapter = new AgentAdapter({
      registry,
      runManager: manager,
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
    const runId = plan.run.runId;

    const run = sendAgentRun(createSseContext(), plan.run, {
      manager,
      signal: controller.signal,
      streamDelayMs: 50,
    });
    controller.abort();
    const result = await run;

    assert.equal(result.ok, false);
    // S2.5.1：运行记录以运行创建方分配的 runId 为键，而非发送层 idPrefix。
    assert.equal(manager.get(runId)?.state, 'canceled');
    assert.equal(manager.get('run-cancel'), undefined);
  });
});
