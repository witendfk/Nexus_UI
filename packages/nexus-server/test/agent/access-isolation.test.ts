import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CatalogRegistry } from '@nexus-ui/core';
import type { AgentAccessHooks, AgentAction } from '../../src/agent/adapter';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';
import { createAgentRuntime } from '../../src/runtime/runtime-facade';
import { TEST_CATALOG_ID, testCatalog } from '../../tests/helpers/test-catalog';

const ALLOWED_CATALOG = `${TEST_CATALOG_ID}/allowed`;
const registry = new CatalogRegistry([testCatalog, { ...testCatalog, catalogId: ALLOWED_CATALOG }]);
const hash = createCatalogContractHash(testCatalog);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(access: AgentAccessHooks) {
  let surface = 0;
  const generated: Array<{ catalogId: string; message: string }> = [];
  const handled: AgentAction[] = [];
  const runtime = createAgentRuntime({
    registry,
    access,
    createSurfaceId: () => `access-isolation-${++surface}`,
    createGenerationSource: (request) => {
      generated.push({ catalogId: request.catalogId, message: request.message });
      return [
        {
          version: 'v0.9',
          createSurface: { surfaceId: request.surfaceId, catalogId: request.catalogId },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: request.surfaceId,
            components: [
              {
                id: 'root',
                component: 'Button',
                child: 'label',
                action: { event: { name: 'submit', context: {} } },
              },
              { id: 'label', component: 'Text', text: 'Submit' },
            ],
          },
        },
      ];
    },
    actionHandlers: new Map([
      [
        `${TEST_CATALOG_ID}:submit`,
        (action) => {
          handled.push(structuredClone(action));
          return [];
        },
      ],
    ]),
  });
  return { runtime, generated, handled };
}

function action(surfaceId: string): AgentAction {
  return {
    name: 'submit',
    surfaceId,
    sourceComponentId: 'root',
    timestamp: new Date().toISOString(),
    context: {},
    inputs: [],
    actionId: 'isolated-action',
    sessionVersion: 1,
    surfaceRevision: 1,
    catalogHash: hash,
  };
}

describe('S3.5 访问判定与执行请求快照一致', () => {
  it('异步 generate 不得批准被调用方改成允许 Catalog 的受限请求', async () => {
    const gate = deferred();
    const { runtime, generated } = fixture({
      generate: async (request) => {
        await gate.promise;
        return request.catalogId === ALLOWED_CATALOG;
      },
    });
    const request = { catalogId: TEST_CATALOG_ID };
    const pending = runtime.generate(request);
    request.catalogId = ALLOWED_CATALOG;
    gate.resolve();
    const outcome = await pending;
    assert.ok(!outcome.accepted);
    assert.equal(outcome.code, 'GENERATE_ACCESS_DENIED');
    assert.deepEqual(generated, []);
    assert.deepEqual(runtime.listRuns('access-isolation-1'), []);
  });

  it('异步 generate 批准的原 Catalog 和 message 在执行时保持不变', async () => {
    const gate = deferred();
    const { runtime, generated } = fixture({
      generate: async (request) => {
        await gate.promise;
        return request.catalogId === ALLOWED_CATALOG && request.message === 'original';
      },
    });
    const request = { catalogId: ALLOWED_CATALOG, message: 'original' };
    const pending = runtime.generate(request);
    request.catalogId = TEST_CATALOG_ID;
    request.message = 'changed';
    gate.resolve();
    const outcome = await pending;
    assert.ok(outcome.accepted);
    assert.equal((await outcome.run.result).terminal, 'succeeded');
    assert.deepEqual(generated, [{ catalogId: ALLOWED_CATALOG, message: 'original' }]);
  });

  it('generate 钩子不能改写它批准的 Catalog 或 message', async () => {
    const { runtime, generated } = fixture({
      generate: (request) => {
        assert.equal(Reflect.set(request, 'catalogId', TEST_CATALOG_ID), false);
        assert.equal(Reflect.set(request, 'message', 'changed'), false);
        return request.catalogId === ALLOWED_CATALOG && request.message === 'original';
      },
    });
    const outcome = await runtime.generate({ catalogId: ALLOWED_CATALOG, message: 'original' });
    assert.ok(outcome.accepted);
    assert.equal((await outcome.run.result).terminal, 'succeeded');
    assert.deepEqual(generated, [{ catalogId: ALLOWED_CATALOG, message: 'original' }]);
  });

  for (const initiallyAllowed of [false, true]) {
    it(`异步 action ${initiallyAllowed ? '允许' : '拒绝'}以入口快照为准，调用方改目标不影响判定`, async () => {
      const gate = deferred();
      const { runtime, handled } = fixture({
        generate: () => true,
        action: async (request) => {
          await gate.promise;
          return request.surfaceId === 'access-isolation-2';
        },
      });
      const revisions = new Map<string, number>();
      for (let index = 0; index < 2; index++) {
        const gen = await runtime.generate({ catalogId: TEST_CATALOG_ID });
        assert.ok(gen.accepted);
        const terminal = await gen.run.result;
        assert.ok(terminal.terminal === 'succeeded');
        revisions.set(terminal.commit.surfaceId, terminal.commit.surfaceRevision);
      }
      const originalSurface = `access-isolation-${initiallyAllowed ? 2 : 1}`;
      const request = action(originalSurface);
      request.surfaceRevision = revisions.get(originalSurface)!;
      const pending = runtime.action(request);
      request.surfaceId = `access-isolation-${initiallyAllowed ? 1 : 2}`;
      gate.resolve();
      const outcome = await pending;
      if (initiallyAllowed) {
        assert.ok(outcome.accepted);
        const terminal = await outcome.run.result;
        assert.equal(terminal.terminal, 'succeeded', JSON.stringify(terminal));
        assert.equal(handled.length, 1);
        assert.equal(handled[0].surfaceId, originalSurface);
      } else {
        assert.ok(!outcome.accepted);
        assert.equal(outcome.code, 'ACTION_ACCESS_DENIED');
        assert.deepEqual(handled, []);
        assert.equal(runtime.listRuns(originalSurface).length, 1);
        assert.equal(
          (await runtime.adapter.describeSurfaceContract(originalSurface))?.surfaceRevision,
          revisions.get(originalSurface),
        );
      }
    });
  }

  it('action 钩子的目标、嵌套 context 与 inputs 均隔离且不可改写', async () => {
    const request = action('protected-surface');
    request.context = { nested: { values: ['original'] } };
    request.inputs = [{ componentId: 'input', property: 'value', value: { values: ['original'] } }];
    const gate = deferred();
    const { runtime } = fixture({
      action: async (snapshot) => {
        await gate.promise;
        assert.equal(snapshot.surfaceId, 'protected-surface');
        assert.deepEqual(snapshot.context, { nested: { values: ['original'] } });
        assert.deepEqual(snapshot.inputs, [
          { componentId: 'input', property: 'value', value: { values: ['original'] } },
        ]);
        assert.equal(Reflect.set(snapshot, 'surfaceId', 'allowed-surface'), false);
        const nested = snapshot.context.nested as { values: string[] };
        assert.equal(Reflect.set(nested.values, '0', 'hook-change'), false);
        assert.equal(Reflect.set(snapshot.inputs![0].value as object, 'values', []), false);
        assert.equal(Reflect.set(snapshot.inputs!, '0', {}), false);
        return false;
      },
    });
    const pending = runtime.action(request);
    (request.context.nested as { values: string[] }).values[0] = 'caller-change';
    (request.inputs[0].value as { values: string[] }).values[0] = 'caller-change';
    request.surfaceId = 'allowed-surface';
    gate.resolve();
    const outcome = await pending;
    assert.ok(!outcome.accepted);
    assert.equal(outcome.code, 'ACTION_ACCESS_DENIED');
    assert.deepEqual(runtime.listRuns('protected-surface'), []);
  });
});
