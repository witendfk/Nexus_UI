import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateNexusProfileMessage, validateProtocolMessage } from '@nexus-ui/core';
import type { SurfaceStateBaseline } from '../../src/api/surface-state';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';
import { InMemorySurfaceActionStateStore } from '../../src/agent/surface-action-state';
import type { SurfaceActionContract } from '../../src/agent/surface-action-state';
import type { SurfaceActionSnapshot } from '../../src/agent/surface-action-state';

const fixtureRoot = new URL('../../../../fixtures/catalog-v2/', import.meta.url);

interface BaselineFixture {
  initialSurfaceFixture: string;
  renderedRunId: string;
  commits: readonly { runId: string; kind: 'generate' | 'action'; messages?: unknown[] }[];
  queryAfterRunId: string;
  query: { surfaceId: string; runId: string };
  expectedLatestRevisionAtQuery: number;
  expectedResponse: { status: 200; body: SurfaceStateBaseline };
  expectedNextAction: {
    surfaceRevision: number;
    serverRevision: number;
    decision: string;
    handlerCalls: number;
    snapshotUnchanged: boolean;
  };
}

for (const filename of [
  'baseline-query-after-concurrent-commit.json',
  'baseline-query-before-concurrent-commit.json',
]) {
  test(`baseline fixture reproduces stale rendered state: ${filename}`, async () => {
    const fixture: BaselineFixture = JSON.parse(
      readFileSync(new URL(filename, fixtureRoot), 'utf8'),
    );
    const initial = JSON.parse(
      readFileSync(new URL(fixture.initialSurfaceFixture, fixtureRoot), 'utf8'),
    );
    const create = initial.surface.messages.find(
      (message: { createSurface?: unknown }) => message.createSurface,
    ).createSurface;
    const store = new InMemorySurfaceActionStateStore();
    // These captures verify the fixture oracle, not the future HTTP query implementation.
    const committed = new Map<string, SurfaceActionSnapshot>();
    let atQuery: SurfaceActionSnapshot | undefined;

    for (const run of fixture.commits) {
      assert(!committed.has(run.runId), 'fixture run ids must be unique');
      const messages: unknown[] =
        run.kind === 'generate' ? initial.surface.messages : (run.messages ?? []);
      assert(messages.length > 0);
      for (const message of messages) {
        assert(validateProtocolMessage(message).ok, 'fixture protocol must be valid');
        assert.equal(validateNexusProfileMessage(message), null);
      }
      if (run.kind === 'generate') {
        // 契约与声明副本按引用 Catalog 夹具实算固定（hash 与 catalog 一体）：
        // baseline 夹具的 initial.catalog 是 catalog 夹具 id，定义在该夹具文件内
        const catalogFixtureId = (initial as { catalog: string }).catalog;
        const catalogFixture = JSON.parse(
          readFileSync(new URL(`catalog-accept-${catalogFixtureId}.json`, fixtureRoot), 'utf8'),
        ) as { catalog: SurfaceActionContract['catalog'] };
        const contract: SurfaceActionContract = {
          catalogHash: createCatalogContractHash(catalogFixture.catalog),
          contractVersion: 2,
          catalog: catalogFixture.catalog,
        };
        await store.commitGeneration(create.surfaceId, create.catalogId, messages, contract);
      } else {
        const current = await store.get(fixture.query.surfaceId);
        assert(current, 'commit 前必须有已提交快照');
        await store.commitAction(messages, {
          expectedEpoch: current.epoch,
          expectedRevision: current.version,
        });
      }
      const snapshot = await store.get(fixture.query.surfaceId);
      assert(snapshot);
      committed.set(run.runId, snapshot);
      if (run.runId === fixture.queryAfterRunId) atQuery = snapshot;
    }

    assert.equal(fixture.query.runId, fixture.renderedRunId);
    const rendered = committed.get(fixture.renderedRunId);
    const current = await store.get(fixture.query.surfaceId);
    assert(rendered && current && atQuery);
    assert.equal(atQuery.version, fixture.expectedLatestRevisionAtQuery);
    assert.notDeepEqual(rendered.dataModel, current.dataModel, 'must exercise an actual UI change');

    // A latest-snapshot baseline would pass revision comparison despite the stale view.
    assert.notEqual(rendered.version, current.version);
    const expected = fixture.expectedResponse.body;
    assert.deepEqual(expected, {
      sessionVersion: 1,
      runId: fixture.renderedRunId,
      surfaceId: rendered.surfaceId,
      catalogId: rendered.catalogId,
      contractVersion: 2,
      catalogHash: '{{catalogHash}}',
      surfaceRevision: rendered.version,
    });
    assert.equal(fixture.expectedNextAction.surfaceRevision, expected.surfaceRevision);
    assert.equal(fixture.expectedNextAction.serverRevision, current.version);
    assert.notEqual(fixture.expectedNextAction.surfaceRevision, current.version);
    // 夹具声明的 oracle 结论必须与内存对拍一致，不退化为文档字段。
    assert.equal(fixture.expectedNextAction.decision, 'reject-stale-revision');
    assert.equal(fixture.expectedNextAction.handlerCalls, 0);
    assert.equal(fixture.expectedNextAction.snapshotUnchanged, true);
    // S2.5 must also test HTTP responses, header association and actual admission rejection.
  });
}
