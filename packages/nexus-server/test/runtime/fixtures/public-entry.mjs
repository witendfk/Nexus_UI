// Artifact acceptance: execute with plain Node, using only exported package roots.
import assert from 'node:assert/strict';
import {
  CatalogRegistry,
  standardCatalogComponentDeclarations,
  createSessionStreamCheck,
} from '@nexus-ui/core';
import { createAgentRuntime } from '@nexus-ui/server';

const catalogId = 'https://example.com/catalogs/artifact/v1';
const standard = standardCatalogComponentDeclarations();
const registry = new CatalogRegistry([
  {
    catalogId,
    components: { Text: standard.Text, Button: standard.Button },
    actions: [{ name: 'submit', sources: ['Button'] }],
  },
]);
const generation = ({ surfaceId }) => [
  { version: 'v0.9', createSurface: { surfaceId, catalogId } },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
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

async function consume(enqueued) {
  assert.equal(enqueued.accepted, true);
  const check = createSessionStreamCheck();
  const events = [];
  for await (const event of enqueued.run.events()) {
    assert.equal(check.push(event), null);
    events.push(event);
  }
  assert.equal(check.end(), null);
  return { outcome: await enqueued.run.result, events };
}

let calls = 0;
const runtime = createAgentRuntime({
  registry,
  access: { generate: () => true, action: () => true },
  createSurfaceId: () => 'artifact-surface',
  createGenerationSource: generation,
  actionHandlers: new Map([
    [
      `${catalogId}:submit`,
      (action) => {
        calls++;
        return [
          {
            version: 'v0.9',
            updateDataModel: { surfaceId: action.surfaceId, value: { submitted: true } },
          },
        ];
      },
    ],
  ]),
});
const generated = await consume(await runtime.generate({ catalogId }));
assert.equal(generated.outcome.terminal, 'succeeded');
const baseline = generated.outcome.commit;
assert.equal(baseline.surfaceRevision, 1);
assert.deepEqual(generated.events.at(-1).commit, baseline);
assert.deepEqual(runtime.queryRun(baseline.surfaceId, baseline.runId).commit, baseline);

const request = {
  name: 'submit',
  surfaceId: baseline.surfaceId,
  sourceComponentId: 'root',
  timestamp: new Date().toISOString(),
  context: {},
  actionId: 'artifact-action',
  sessionVersion: 1,
  surfaceRevision: baseline.surfaceRevision,
  catalogHash: baseline.catalogHash,
};
const acted = await consume(await runtime.action(request));
assert.equal(acted.outcome.terminal, 'succeeded');
assert.equal(acted.outcome.commit.surfaceRevision, 2);
assert.equal(calls, 1);
const stale = await consume(await runtime.action({ ...request, actionId: 'stale-action' }));
assert.equal(stale.outcome.commitState, 'notCommitted');
assert.equal(stale.events.at(-1).code, 'RUN_ADMISSION_REJECTED');
assert.equal(calls, 1, 'stale baseline must be rejected before the handler');

const isolated = createAgentRuntime({ registry, createGenerationSource: generation });
const denied = await isolated.generate({ catalogId });
assert.equal(denied.accepted, false);
assert.equal(denied.code, 'GENERATE_ACCESS_NOT_CONFIGURED');
assert.equal(isolated.queryRun(baseline.surfaceId, baseline.runId), undefined);
assert.deepEqual(isolated.listRuns(baseline.surfaceId), []);
