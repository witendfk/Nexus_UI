import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CatalogRegistry,
  standardCatalogComponentDeclarations,
  validateInputValueDiagnostics,
} from '@nexus-ui/core';
import type { CatalogDefinition } from '@nexus-ui/core';
import { AgentAdapter } from '../../src/agent/adapter';
import type { AgentAction, AgentAdapterOptions } from '../../src/agent/adapter';
import { InMemorySurfaceActionStateStore } from '../../src/agent/surface-action-state';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';
import { admitAction, createEditablePathWhitelist } from '../../src/agent/action-admission';
import {
  createAgentStreamState,
  validateAgentStreamMessageDetailed,
} from '../../src/agent/agent-guard';

function catalogOf(): CatalogDefinition {
  return {
    catalogId: 'https://example.com/regression',
    components: standardCatalogComponentDeclarations(),
    actions: [
      {
        name: 'save',
        sources: ['Button'],
        paramSchema: {
          type: 'object',
          properties: { note: { type: 'string' } },
          additionalProperties: false,
        },
      },
    ],
  };
}
function streamOf(catalog: CatalogDefinition) {
  return [
    { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: catalog.catalogId } },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 's',
        components: [
          { id: 'root', component: 'Column', children: ['input', 'button', 'label'] },
          { id: 'input', component: 'TextField', label: 'Input', value: { path: '/note' } },
          {
            id: 'button',
            component: 'Button',
            child: 'label',
            action: { event: { name: 'save', context: { note: { path: '/note' } } } },
          },
          { id: 'label', component: 'Text', text: 'Save' },
        ],
      },
    },
    { version: 'v0.9', updateDataModel: { surfaceId: 's', value: { note: 'old' } } },
  ];
}
const patch = (path: string, value: unknown) => ({
  version: 'v0.9',
  updateDataModel: { surfaceId: 's', path, value },
});
let seq = 0;
function action(hash: string, extra: Partial<AgentAction> = {}): AgentAction {
  return {
    name: 'save',
    surfaceId: 's',
    sourceComponentId: 'button',
    timestamp: '2026-10-19T00:00:00Z',
    context: {},
    actionId: `regression-${++seq}`,
    sessionVersion: 1,
    surfaceRevision: 1,
    catalogHash: hash,
    ...extra,
  };
}
async function harness(options: Partial<AgentAdapterOptions> = {}, catalog = catalogOf()) {
  const store = new InMemorySurfaceActionStateStore({ maxSurfaces: 1 });
  const stream = streamOf(catalog);
  const adapter = new AgentAdapter({
    registry: new CatalogRegistry([catalog]),
    actionStateStore: store,
    createSurfaceId: () => 's',
    createGenerationSource: () => stream,
    editablePaths: () => ['/note'],
    ...options,
  });
  const generation = await adapter.prepareGeneration({ catalogId: catalog.catalogId });
  assert(generation.ok);
  await generation.run.commit(stream);
  return { adapter, store, stream, catalog, hash: createCatalogContractHash(catalog) };
}
async function collect(source: Iterable<unknown> | AsyncIterable<unknown>) {
  const messages: unknown[] = [];
  for await (const message of source) messages.push(message);
  return messages;
}

describe('S2.4 second-review regressions', () => {
  it('isolates generation and action message values at storage ingress', async () => {
    const h = await harness();
    h.stream[2]!.updateDataModel!.value.note = 'tampered';
    h.stream[1]!.updateComponents!.components[3]!.text = 'tampered';
    assert.equal((await h.store.get('s'))!.components.get('label')!.text, 'Save');
    assert.deepEqual((await h.store.get('s'))!.dataModel, { note: 'old' });
    const message = patch('/object', { nested: 'original' });
    await h.store.commitAction([message], { expectedEpoch: 1, expectedRevision: 1 });
    (message.updateDataModel.value as { nested: string }).nested = 'tampered';
    assert.deepEqual((await h.store.get('s'))!.dataModel, {
      note: 'old',
      object: { nested: 'original' },
    });
  });
  it('keeps normalized handler output authoritative and matches streamed model', async () => {
    const h = await harness();
    h.adapter.registerActionHandler(h.catalog.catalogId, 'save', () => [
      patch('/note', 'NORMALIZED'),
    ]);
    const plan = await h.adapter.prepareAction(
      action(h.hash, { inputs: [{ componentId: 'input', property: 'value', value: 'edited' }] }),
    );
    assert(plan.ok);
    const messages = await collect(plan.run.source);
    const state = createAgentStreamState(plan.run.sequence);
    for (const [index, message] of messages.entries()) {
      assert.equal(
        validateAgentStreamMessageDetailed(message as never, index, plan.run.sequence, state),
        null,
      );
    }
    await plan.run.commit(messages);
    assert.deepEqual((await h.store.get('s'))!.dataModel, state.dataModel);
    assert.equal((state.dataModel as { note: string }).note, 'NORMALIZED');
  });
  it('rejects array aliases before conflict checks, preserves numeric-looking object keys', async () => {
    const h = await harness();
    const snap = (await h.store.get('s'))!;
    const component = snap.components.get('input')!;
    for (const segment of ['01', '+1', '1e0', '', '1.0', '-1']) {
      (component as unknown as { value: unknown }).value = { path: `/arr/${segment}` };
      const candidate = { ...snap, dataModel: { note: 'old', arr: ['a', 'b'] } };
      const request = action(h.hash);
      const result = admitAction(
        { snapshot: candidate, editablePaths: createEditablePathWhitelist([`/arr/${segment}`]) },
        {
          ...request,
          nexus: { ...request, inputs: [{ componentId: 'input', property: 'value', value: 'x' }] },
        },
      );
      assert.equal(result.ok, false, segment);
    }
  });
  it('keeps resolver object inputs separate from the validated pending writes', async () => {
    const catalog = catalogOf();
    const objectSchema = {
      type: 'object' as const,
      properties: { label: { type: 'string' as const } },
      required: ['label'],
      additionalProperties: false,
    };
    (catalog.components as Record<string, unknown>).ObjectInput = {
      schema: { type: 'object', properties: { data: { ...objectSchema, dynamic: 'required' } } },
      inputs: { data: objectSchema },
    };
    const h = await harness(
      {
        editablePaths: () => ['/profile'],
        resolveActionContext: ({ tempDataModel, params }) => {
          (tempDataModel as { profile: { label: unknown } }).profile.label = 123;
          return params;
        },
      },
      catalog,
    );
    const snapshot = (await h.store.get('s'))!;
    await h.store.commitAction(
      [
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's',
            components: [{ id: 'object', component: 'ObjectInput', data: { path: '/profile' } }],
          },
        },
      ],
      { expectedEpoch: snapshot.epoch, expectedRevision: snapshot.version },
    );
    h.adapter.registerActionHandler(catalog.catalogId, 'save', () => [patch('/server', 'ok')]);
    const plan = await h.adapter.prepareAction(
      action(h.hash, {
        surfaceRevision: 2,
        inputs: [{ componentId: 'object', property: 'data', value: { label: 'valid' } }],
      }),
    );
    assert(plan.ok);
    await plan.run.commit(await collect(plan.run.source));
    const model = (await h.store.get('s'))!.dataModel as { profile: unknown };
    assert.deepEqual(model.profile, { label: 'valid' });
    assert.equal(validateInputValueDiagnostics(model.profile, objectSchema, 'profile').length, 0);
  });
  it('never reuses revision or epoch after eviction and rejects old commits', async () => {
    const h = await harness();
    const before = (await h.store.get('s'))!;
    const other = JSON.parse(JSON.stringify(h.stream).split('"s"').join('"t"'));
    await h.store.commitGeneration('t', h.catalog.catalogId, other, before.contract);
    await h.store.commitGeneration('s', h.catalog.catalogId, h.stream, before.contract);
    const recreated = (await h.store.get('s'))!;
    assert(recreated.version > before.version && recreated.epoch !== before.epoch);
    await assert.rejects(
      h.store.commitAction([patch('/note', 'stale')], {
        expectedEpoch: before.epoch,
        expectedRevision: before.version,
      }),
    );
    h.adapter.registerActionHandler(h.catalog.catalogId, 'save', () => []);
    assert.equal((await h.adapter.prepareAction(action(h.hash))).ok, false);
  });
  it('holds non-HTTP lock past source exhaustion and rejects queued stale revision before handler', async () => {
    const h = await harness();
    let calls = 0;
    h.adapter.registerActionHandler(h.catalog.catalogId, 'save', () => {
      calls++;
      return [patch('/note', 'new')];
    });
    const first = await h.adapter.prepareAction(action(h.hash));
    assert(first.ok);
    const messages = await collect(first.run.source);
    let secondSettled = false;
    const second = h.adapter.prepareAction(action(h.hash)).then((p) => {
      secondSettled = true;
      return p;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(secondSettled, false);
    assert.equal(calls, 1);
    await first.run.commit(messages);
    assert.equal((await second).ok, false);
    assert.equal(calls, 1);
    await assert.rejects(
      h.store.commitAction([patch('/note', 'stale')], { expectedEpoch: 1, expectedRevision: 1 }),
    );
  });
  it('keeps successful replay protection after repeated terminal cleanup', async () => {
    const h = await harness();
    let calls = 0;
    h.adapter.registerActionHandler(h.catalog.catalogId, 'save', () => {
      calls++;
      return [patch('/note', 'saved')];
    });
    const request = action(h.hash);
    const plan = await h.adapter.prepareAction(request);
    assert(plan.ok);
    await plan.run.commit(await collect(plan.run.source));
    plan.run.dispose?.();
    plan.run.onError?.();
    plan.run.dispose?.();
    const replay = await h.adapter.prepareAction({ ...request, surfaceRevision: 2 });
    assert.equal(replay.ok, false);
    assert.equal(calls, 1);
  });
  it('rejects patch values forbidden by the pinned Catalog even if live registry permits them', async () => {
    const catalog = catalogOf();
    (catalog.components.Text.schema.properties as Record<string, unknown>).text = {
      type: 'string',
      maxLength: 5,
      dynamic: 'allowed',
    };
    const h = await harness({}, catalog);
    (catalog.components.Text.schema.properties as Record<string, unknown>).text = {
      type: 'string',
      maxLength: 100,
      dynamic: 'allowed',
    };
    h.adapter.registerActionHandler(catalog.catalogId, 'save', () => [
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's',
          components: [
            { id: 'label', component: 'Text', text: 'too long for the committed declaration' },
          ],
        },
      },
    ]);
    const plan = await h.adapter.prepareAction(action(h.hash));
    assert(plan.ok);
    const messages = await collect(plan.run.source);
    const state = createAgentStreamState(plan.run.sequence);
    assert(validateAgentStreamMessageDetailed(messages[0] as never, 0, plan.run.sequence, state));
    await assert.rejects(async () => plan.run.commit(messages));
    assert.equal((await h.store.get('s'))!.version, 1);
    assert.equal((await h.store.get('s'))!.components.get('label')!.text, 'Save');
  });
  it('uses the pinned Catalog for the actual patch guard and commit', async () => {
    const h = await harness();
    (h.catalog.components.Text.schema.properties as Record<string, unknown>).text = {
      type: 'number',
    };
    h.adapter.registerActionHandler(h.catalog.catalogId, 'save', () => [
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's',
          components: [{ id: 'label', component: 'Text', text: 'valid pinned text' }],
        },
      },
    ]);
    const plan = await h.adapter.prepareAction(action(h.hash));
    assert(plan.ok);
    const messages = await collect(plan.run.source);
    const state = createAgentStreamState(plan.run.sequence);
    assert.equal(
      validateAgentStreamMessageDetailed(messages[0] as never, 0, plan.run.sequence, state),
      null,
    );
    await plan.run.commit(messages);
    assert.equal((await h.store.get('s'))!.components.get('label')!.text, 'valid pinned text');
  });
});
