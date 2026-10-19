import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import type { CatalogDefinition } from '@nexus-ui/core';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';
import {
  admitAction,
  createEditablePathWhitelist,
  type ActionNexusMetadata,
} from '../../src/agent/action-admission';
import { InMemorySurfaceActionStateStore } from '../../src/agent/surface-action-state';

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../fixtures/catalog-v2',
);

interface CatalogFixture {
  id: string;
  kind: 'catalog';
  expect: 'accept' | 'reject-registration';
  catalog: CatalogDefinition;
}

interface RequestFixture {
  id: string;
  kind: 'action-request';
  expect: 'accept' | 'reject-admission';
  reason?: string;
  catalog: string;
  editablePaths: readonly string[];
  surface: { messages: readonly unknown[] };
  request: {
    message: { action: Record<string, unknown> };
    nexus: Record<string, unknown>;
  };
}

const catalogFixtures = new Map<string, CatalogFixture>();
for (const file of readdirSync(FIXTURE_DIR).filter((name) => name.startsWith('catalog-'))) {
  const fixture = JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8')) as CatalogFixture;
  if (fixture.expect === 'accept') catalogFixtures.set(fixture.id, fixture);
}

const requestFixtures = readdirSync(FIXTURE_DIR)
  .filter((name) => name.startsWith('request-'))
  .map((name) => JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as RequestFixture);

/** 与共享 fixture 对测：同一份数据在 server 权威准入得到一致结论（SPEC §4）。 */
describe('fixtures/catalog-v2 request 夹具 × server 权威准入', () => {
  for (const fixture of requestFixtures) {
    it(`${fixture.id}: ${fixture.expect}${fixture.reason ? `（${fixture.reason}）` : ''}`, async () => {
      const catalogFixture = catalogFixtures.get(fixture.catalog);
      assert.ok(catalogFixture, `引用的 catalog 夹具必须存在: ${fixture.catalog}`);
      const catalog = catalogFixture.catalog;
      const catalogHash = createCatalogContractHash(catalog);

      // 用真实状态存储按夹具 surface 消息建立已提交权威状态（含契约固定）
      const store = new InMemorySurfaceActionStateStore();
      const surfaceMessages = JSON.parse(
        JSON.stringify(fixture.surface.messages).replace(/\{\{catalogHash\}\}/g, catalogHash),
      ) as readonly unknown[];
      const createSurface = surfaceMessages.find(
        (message) =>
          typeof message === 'object' &&
          message !== null &&
          'createSurface' in (message as Record<string, unknown>),
      ) as { createSurface: { surfaceId: string; catalogId: string } } | undefined;
      assert.ok(createSurface, '夹具 surface 消息必须包含 createSurface');
      await store.commitGeneration(
        createSurface.createSurface.surfaceId,
        createSurface.createSurface.catalogId,
        surfaceMessages,
        { catalogHash, contractVersion: 2, catalog },
      );
      const snapshot = await store.get(createSurface.createSurface.surfaceId);
      assert.ok(snapshot, '夹具 surface 必须已提交');

      const request = JSON.parse(
        JSON.stringify(fixture.request).replace(/\{\{catalogHash\}\}/g, catalogHash),
      ) as RequestFixture['request'];
      const action = request.message.action as Record<string, string>;
      const nexus = request.nexus as unknown as ActionNexusMetadata;
      const result = admitAction(
        {
          snapshot,
          editablePaths: createEditablePathWhitelist(fixture.editablePaths),
        },
        {
          name: action.name as string,
          surfaceId: action.surfaceId as string,
          sourceComponentId: action.sourceComponentId as string,
          context: action.context,
          actionId:
            (action.actionId as string | undefined) ??
            ((nexus as { actionId?: unknown } | undefined)?.actionId as string | undefined) ??
            '',
          nexus,
        },
      );

      if (fixture.expect === 'accept') {
        assert.equal(result.ok, true, `应准入: ${result.ok ? '' : result.message}`);
      } else {
        assert.equal(result.ok, false, '应拒绝准入');
      }

      // 准入不改变已提交状态：临时模型与快照隔离
      const snapshotAfter = await store.get(createSurface.createSurface.surfaceId);
      assert.equal(snapshotAfter?.version, snapshot.version);
    });
  }
});
