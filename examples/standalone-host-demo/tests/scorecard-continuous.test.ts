import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, describe, it } from 'node:test';
import { A2UIRuntime, CatalogRegistry, parseSurfaceCommit } from '@nexus-ui/core';
import type { CatalogDefinition, NexusSurfaceCommit } from '@nexus-ui/core';
import { createStandaloneHostApp } from '../src/host/app';
import { SCORECARD_ACTION, SCORECARD_CATALOG_ID } from '../src/shared/scorecard-contract';

/**
 * S2.6.4.2 / S2.6.4.3 第二组（中立 scorecard）：整数非 value 属性 + 布尔 +
 * partial patch（handler 只写 /note，不回显整表输入）。消费方语义与浏览器一致。
 */

const servers: Server[] = [];

after(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (!server) break;
    server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

async function listen(): Promise<string> {
  const server = createStandaloneHostApp({
    endpoint: 'https://agent.invalid/a2ui',
    timeoutMs: 1,
  }).listen(0, '127.0.0.1') as Server;
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function loadRegistry(baseUrl: string): Promise<CatalogRegistry> {
  const response = await fetch(
    `${baseUrl}/api/a2ui/catalog-contract?catalogId=${encodeURIComponent(SCORECARD_CATALOG_ID)}`,
  );
  assert.equal(response.status, 200);
  const payload = (await response.json()) as { catalog: CatalogDefinition };
  return new CatalogRegistry([payload.catalog]);
}

async function consume(
  runtime: A2UIRuntime,
  url: string,
  body: unknown,
): Promise<{ commit: NexusSurfaceCommit; text: string }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  assert.equal(response.status, 200, text.slice(0, 300));
  const runIdHeader = response.headers.get('X-Nexus-Run-Id');
  let commit: NexusSurfaceCommit | null = null;
  for (const frame of text.split('\n\n')) {
    if (!frame.trim()) continue;
    const lines = frame.split('\n');
    const event = lines.find((line) => line.startsWith('event: '))?.slice(7) ?? 'message';
    const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
    if (data === undefined) continue;
    if (event === 'message') runtime.push(`${data}\n`);
    if (event === 'done') commit = parseSurfaceCommit(JSON.parse(data));
  }
  runtime.end();
  assert.ok(commit, '成功流必须携带 done 固定结果');
  assert.equal(commit.runId, runIdHeader, 'done.runId 必须与 X-Nexus-Run-Id 一致');
  return { commit, text };
}

function envelope(
  baseline: NexusSurfaceCommit,
  inputs: readonly unknown[],
  overrides: Partial<{ surfaceRevision: number }> = {},
): unknown {
  return {
    message: {
      version: 'v0.9',
      action: {
        name: SCORECARD_ACTION,
        surfaceId: baseline.surfaceId,
        sourceComponentId: 'submitCard',
        timestamp: new Date().toISOString(),
        context: {},
      },
    },
    nexus: {
      sessionVersion: baseline.sessionVersion,
      actionId: randomUUID(),
      surfaceRevision: overrides.surfaceRevision ?? baseline.surfaceRevision,
      catalogHash: baseline.catalogHash,
      inputs,
    },
  };
}

describe('S2.6.4.2 scorecard 连续交互：整数/布尔非 value 输入与 partial patch', () => {
  it('首次提交→确认→第二次不重发→只改 score 时 pinned 由服务端模型保留', async () => {
    const baseUrl = await listen();
    const runtime = new A2UIRuntime({ catalogRegistry: await loadRegistry(baseUrl) });
    const generation = await consume(runtime, `${baseUrl}/api/a2ui/generate`, {
      catalogId: SCORECARD_CATALOG_ID,
    });
    const surfaceId = generation.commit.surfaceId;

    assert.ok(runtime.setInputValue('scoreDial', surfaceId, 'score', 42));
    assert.ok(runtime.setInputValue('pinnedToggle', surfaceId, 'pinned', true));
    const sent = runtime.extractLatestInputDrafts(surfaceId);
    const first = await consume(
      runtime,
      `${baseUrl}/api/a2ui/event`,
      envelope(
        generation.commit,
        sent.entries.map((entry) => entry.input),
      ),
    );
    assert.match(first.text, /已记录：score=42，pinned=true/);
    runtime.confirmInputDrafts(sent);
    assert.deepEqual(runtime.getLatestInputs(surfaceId), []);

    // partial patch：handler 只写 /note；score/pinned 来自已准入输入基础模型。
    const model = runtime.store.getState().dataModelBySurface[surfaceId] as Record<string, unknown>;
    assert.equal(model.score, 42);
    assert.equal(model.pinned, true);
    assert.equal(model.note, '已记录：score=42，pinned=true');

    // 第二次：无新草稿，inputs=[]，参数由服务端模型重算，结果一致。
    const second = await consume(runtime, `${baseUrl}/api/a2ui/event`, envelope(first.commit, []));
    assert.match(second.text, /已记录：score=42，pinned=true/);
    assert.ok(second.commit.surfaceRevision > first.commit.surfaceRevision);

    // 只改 score：inputs 只带 score，pinned 不回显也由服务端模型保留。
    assert.ok(runtime.setInputValue('scoreDial', surfaceId, 'score', 7));
    const third = runtime.extractLatestInputDrafts(surfaceId);
    assert.deepEqual(
      third.entries.map((entry) => entry.input),
      [{ componentId: 'scoreDial', property: 'score', value: 7 }],
    );
    const result = await consume(
      runtime,
      `${baseUrl}/api/a2ui/event`,
      envelope(
        second.commit,
        third.entries.map((entry) => entry.input),
      ),
    );
    assert.match(result.text, /已记录：score=7，pinned=true/);
    runtime.confirmInputDrafts(third);
    assert.deepEqual(runtime.getLatestInputs(surfaceId), []);
  });
});

describe('S2.6.4.3 scorecard 拒绝与双 surface 隔离', () => {
  it('越界整数被拒后草稿保留，修正后同一基准仍可提交', async () => {
    const baseUrl = await listen();
    const runtime = new A2UIRuntime({ catalogRegistry: await loadRegistry(baseUrl) });
    const generation = await consume(runtime, `${baseUrl}/api/a2ui/generate`, {
      catalogId: SCORECARD_CATALOG_ID,
    });
    const surfaceId = generation.commit.surfaceId;
    // 本地 core 就拒绝越界整数（声明值域），草稿不记录。
    assert.equal(runtime.setInputValue('scoreDial', surfaceId, 'score', 101), false);
    assert.deepEqual(runtime.getLatestInputs(surfaceId), []);

    // 绕过本地校验直接发越界输入：服务端拒绝，handler 零调用。
    const rejected = await fetch(`${baseUrl}/api/a2ui/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        envelope(generation.commit, [{ componentId: 'scoreDial', property: 'score', value: 101 }]),
      ),
    });
    assert.equal(rejected.status, 400);
    assert.doesNotMatch(await rejected.text(), /已记录/);

    // 旧 revision 拒绝。
    const stale = await fetch(`${baseUrl}/api/a2ui/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope(generation.commit, [], { surfaceRevision: 999 })),
    });
    assert.equal(stale.status, 400);

    // 快照未变：原基准提交合法输入仍成功。
    assert.ok(runtime.setInputValue('scoreDial', surfaceId, 'score', 9));
    const sent = runtime.extractLatestInputDrafts(surfaceId);
    const ok = await consume(
      runtime,
      `${baseUrl}/api/a2ui/event`,
      envelope(
        generation.commit,
        sent.entries.map((entry) => entry.input),
      ),
    );
    assert.match(ok.text, /已记录：score=9，pinned=false/);
  });

  it('双 surface：A 的草稿/确认/patch 不影响 B', async () => {
    const baseUrl = await listen();
    const runtime = new A2UIRuntime({ catalogRegistry: await loadRegistry(baseUrl) });
    const a = await consume(runtime, `${baseUrl}/api/a2ui/generate`, {
      catalogId: SCORECARD_CATALOG_ID,
    });
    const b = await consume(runtime, `${baseUrl}/api/a2ui/generate`, {
      catalogId: SCORECARD_CATALOG_ID,
    });
    assert.ok(runtime.setInputValue('scoreDial', a.commit.surfaceId, 'score', 11));
    assert.ok(runtime.setInputValue('scoreDial', b.commit.surfaceId, 'score', 22));

    const sentA = runtime.extractLatestInputDrafts(a.commit.surfaceId);
    const actionA = await consume(
      runtime,
      `${baseUrl}/api/a2ui/event`,
      envelope(
        a.commit,
        sentA.entries.map((entry) => entry.input),
      ),
    );
    assert.match(actionA.text, /已记录：score=11/);
    runtime.confirmInputDrafts(sentA);

    assert.deepEqual(runtime.getLatestInputs(b.commit.surfaceId), [
      { componentId: 'scoreDial', property: 'score', value: 22 },
    ]);
    const modelB = runtime.store.getState().dataModelBySurface[b.commit.surfaceId] as Record<
      string,
      unknown
    >;
    assert.equal(modelB.score, 22);
    assert.equal(modelB.note, '给本次会话打分并选择是否置顶');

    const sentB = runtime.extractLatestInputDrafts(b.commit.surfaceId);
    const actionB = await consume(
      runtime,
      `${baseUrl}/api/a2ui/event`,
      envelope(
        b.commit,
        sentB.entries.map((entry) => entry.input),
      ),
    );
    assert.match(actionB.text, /已记录：score=22/);
    assert.equal(actionB.commit.surfaceId, b.commit.surfaceId);
  });
});
