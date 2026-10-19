import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { AgentAdapter } from '../src/agent/adapter';
import { FileSurfaceHistoryStore } from '../src/agent/file-history';
import { TEST_CATALOG_ID, createTestRegistry } from './helpers/test-catalog';

const registry = createTestRegistry();

async function collectMessages(
  messages: AsyncIterable<unknown> | Iterable<unknown>,
): Promise<unknown[]> {
  const collected: unknown[] = [];
  for await (const message of messages) collected.push(message);
  return collected;
}

function createGeneration(surfaceId: string): unknown[] {
  return [
    {
      version: 'v0.9',
      createSurface: { surfaceId, catalogId: TEST_CATALOG_ID },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [{ id: 'root', component: 'Text', text: 'Persisted history', variant: 'body' }],
      },
    },
  ];
}

describe('FileSurfaceHistoryStore', () => {
  it('persists catalog and history but does not resurrect action authority', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nexus-file-history-'));
    const historyFile = join(directory, 'surface-history.json');
    const surfaceId = 'surface-file-history';
    const firstStore = new FileSurfaceHistoryStore(historyFile);
    const firstAdapter = new AgentAdapter({
      registry,
      actionHandlers: new Map(),
      historyStore: firstStore,
      createSurfaceId: () => surfaceId,
      createGenerationSource: () => createGeneration(surfaceId),
    });
    const generation = await firstAdapter.prepareGeneration({
      message: '重启前生成',
      catalogId: TEST_CATALOG_ID,
    });
    assert.ok(generation.ok);
    await generation.run.commit(await collectMessages(generation.run.source));

    const secondStore = new FileSurfaceHistoryStore(historyFile);
    const secondAdapter = new AgentAdapter({
      registry,
      actionHandlers: new Map(),
      historyStore: secondStore,
      createSurfaceId: () => `unused-${surfaceId}`,
    });
    const action = await secondAdapter.prepareAction({
      name: 'submit',
      surfaceId,
      sourceComponentId: 'submitButton',
      timestamp: '2026-09-21T00:00:00.000Z',
      actionId: 'file-history-restore',
      sessionVersion: 1,
      surfaceRevision: 1,
      catalogHash: 'sha256:' + '0'.repeat(64),
      context: {},
    });
    assert.ok(!action.ok);
    assert.match(action.message, /Action surface 不存在或已过期/);
    assert.equal(await secondStore.getCatalogId(surfaceId), TEST_CATALOG_ID);
    assert.equal((await secondStore.getHistory(surfaceId)).length, 2);
  });

  it('keeps surface and turn capacity after a restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nexus-file-capacity-'));
    const historyFile = join(directory, 'surface-history.json');
    const store = new FileSurfaceHistoryStore(historyFile, {
      maxSurfaces: 1,
      maxTurnsPerSurface: 4,
    });

    await store.commitGeneration('surface-old', 'catalog-old', [
      { role: 'user', content: 'old request' },
    ]);
    await store.commitGeneration('surface-new', 'catalog-new', [
      { role: 'user', content: 'new-1' },
      { role: 'assistant', content: 'assistant-1' },
    ]);
    await store.commitGeneration('surface-new', 'catalog-new', [
      { role: 'user', content: 'new-2' },
      { role: 'assistant', content: 'assistant-2' },
    ]);

    const restored = new FileSurfaceHistoryStore(historyFile, {
      maxSurfaces: 1,
      maxTurnsPerSurface: 4,
    });
    assert.equal(await restored.getCatalogId('surface-old'), undefined);
    assert.equal(await restored.getCatalogId('surface-new'), 'catalog-new');
    assert.deepEqual(
      (await restored.getHistory('surface-new')).map((turn) => turn.content),
      ['new-1', 'assistant-1', 'new-2', 'assistant-2'],
    );
  });

  it('rejects an invalid history file with a clear error', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nexus-file-invalid-'));
    const historyFile = join(directory, 'surface-history.json');
    await writeFile(historyFile, '{not-json', 'utf8');

    const store = new FileSurfaceHistoryStore(historyFile);
    await assert.rejects(store.initialize(), /Surface history 文件不是合法 JSON/);
  });

  it('rejects commit and keeps the previous state when writing fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nexus-file-write-error-'));
    const historyFile = join(directory, 'surface-history.json');
    const store = new FileSurfaceHistoryStore(historyFile);
    await store.commitGeneration('surface-safe', 'catalog-safe', [
      { role: 'user', content: 'safe request' },
    ]);

    await chmod(directory, 0o500);
    try {
      await assert.rejects(
        store.commitGeneration('surface-unsafe', 'catalog-unsafe', [
          { role: 'user', content: 'unsafe request' },
        ]),
      );
    } finally {
      await chmod(directory, 0o700);
    }

    assert.equal(await store.getCatalogId('surface-unsafe'), undefined);
    assert.deepEqual(await store.getCatalogId('surface-safe'), 'catalog-safe');
    assert.equal((await readdir(directory)).filter((name) => name.endsWith('.tmp')).length, 0);

    const persisted = JSON.parse(await readFile(historyFile, 'utf8')) as { surfaces: unknown[] };
    assert.equal(persisted.surfaces.length, 1);
  });
});
