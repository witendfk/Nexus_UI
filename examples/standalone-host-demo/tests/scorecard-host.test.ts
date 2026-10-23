import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, describe, it } from 'node:test';
import { createStandaloneHostApp } from '../src/host/app';
import { DEMO_AGENT_CATALOG_ID } from '../src/contract';
import { SCORECARD_ACTION, SCORECARD_CATALOG_ID } from '../src/shared/scorecard-contract';

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

async function listen(actionMode: 'local' | 'external'): Promise<string> {
  const server = createStandaloneHostApp({
    endpoint: 'https://agent.invalid/a2ui',
    timeoutMs: 1,
    actionMode,
  }).listen(0, '127.0.0.1') as Server;
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function doneCommit(output: string): Record<string, unknown> {
  const frame = output.split('\n\n').find((part) => part.includes('event: done\n'));
  assert(frame, '成功流必须发布 done 固定提交');
  const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
  assert(dataLine, 'done 帧必须携带 data 载荷');
  return JSON.parse(dataLine.slice(6)) as Record<string, unknown>;
}

async function generateScorecard(baseUrl: string): Promise<{
  text: string;
  commit: Record<string, unknown>;
  surfaceId: string;
}> {
  const response = await fetch(`${baseUrl}/api/a2ui/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ catalogId: SCORECARD_CATALOG_ID }),
  });
  const text = await response.text();
  assert.equal(response.status, 200);
  const commit = doneCommit(text);
  const surfaceId = /"surfaceId":"(surface-[^"]+)"/.exec(text)?.[1];
  assert.ok(surfaceId);
  return { text, commit, surfaceId };
}

function scorecardActionEnvelope(
  commit: Record<string, unknown>,
  surfaceId: string,
  inputs: readonly { componentId: string; property: string; value: unknown }[],
  context: Record<string, unknown> = {},
): unknown {
  return {
    message: {
      version: 'v0.9',
      action: {
        name: SCORECARD_ACTION,
        surfaceId,
        sourceComponentId: 'submitCard',
        timestamp: new Date().toISOString(),
        context,
      },
    },
    nexus: {
      sessionVersion: commit.sessionVersion,
      actionId: randomUUID(),
      surfaceRevision: commit.surfaceRevision,
      catalogHash: commit.catalogHash,
      inputs,
    },
  };
}

describe('S2.6.2.2 中立 scorecard 经实际装配的 HTTP 闭环', () => {
  it('发布列表同时包含审批与 scorecard 两个 Catalog', async () => {
    const baseUrl = await listen('external');
    const payload = (await (await fetch(`${baseUrl}/api/a2ui/published-catalogs`)).json()) as {
      catalogs: { catalogId: string }[];
    };
    const ids = payload.catalogs.map((catalog) => catalog.catalogId);
    assert.ok(ids.includes(DEMO_AGENT_CATALOG_ID));
    assert.ok(ids.includes(SCORECARD_CATALOG_ID));
  });

  it('确定性生成源产出可编辑夹具，不触碰外部 RPC', async () => {
    const baseUrl = await listen('external');
    const { text } = await generateScorecard(baseUrl);
    assert.match(text, /"ScoreDial"/);
    assert.match(text, /"PinnedToggle"/);
    assert.match(text, /"SubmitCard"/);
    assert.match(text, /"score":\{"path":"\/score"\}/);
  });

  it('准入后的整数/布尔输入到达 handler，伪造 context 不改写权威参数', async () => {
    const baseUrl = await listen('external');
    const { commit, surfaceId } = await generateScorecard(baseUrl);
    const response = await fetch(`${baseUrl}/api/a2ui/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        scorecardActionEnvelope(
          commit,
          surfaceId,
          [
            { componentId: 'scoreDial', property: 'score', value: 42 },
            { componentId: 'pinnedToggle', property: 'pinned', value: true },
          ],
          // 客户端伪造值必须被服务端重算覆盖。
          { score: 999, pinned: 'x' },
        ),
      ),
    });
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.match(text, /已记录：score=42，pinned=true/);
    assert.doesNotMatch(text, /999/);
    // patch 不 create/delete surface。
    assert.doesNotMatch(text, /createSurface/);
    assert.doesNotMatch(text, /deleteSurface/);
  });

  it('local 模式下 scorecard 行为一致，原审批装配保持可用', async () => {
    const baseUrl = await listen('local');
    const health = (await (await fetch(`${baseUrl}/health`)).json()) as { actionMode: string };
    assert.equal(health.actionMode, 'local');
    const { commit, surfaceId } = await generateScorecard(baseUrl);
    const first = await fetch(`${baseUrl}/api/a2ui/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        scorecardActionEnvelope(commit, surfaceId, [
          { componentId: 'scoreDial', property: 'score', value: 7 },
          { componentId: 'pinnedToggle', property: 'pinned', value: false },
        ]),
      ),
    });
    const firstText = await first.text();
    assert.equal(first.status, 200);
    assert.match(firstText, /已记录：score=7，pinned=false/);
  });

  it('整数越界、非整数与错误类型输入被真实入口拒绝', async () => {
    const baseUrl = await listen('external');
    const cases: readonly { label: string; inputs: readonly unknown[] }[] = [
      {
        label: 'score 越上界',
        inputs: [
          { componentId: 'scoreDial', property: 'score', value: 101 },
          { componentId: 'pinnedToggle', property: 'pinned', value: true },
        ],
      },
      {
        label: 'score 非整数',
        inputs: [{ componentId: 'scoreDial', property: 'score', value: 3.5 }],
      },
      {
        label: 'pinned 错误类型',
        inputs: [{ componentId: 'pinnedToggle', property: 'pinned', value: 'yes' }],
      },
    ];
    for (const item of cases) {
      const { commit, surfaceId } = await generateScorecard(baseUrl);
      const response = await fetch(`${baseUrl}/api/a2ui/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scorecardActionEnvelope(commit, surfaceId, item.inputs as never)),
      });
      const text = await response.text();
      // S3.2：调度内准入失败经 SSE error 报告（200 + error 帧），handler 零调用。
      assert.equal(response.status, 200, item.label);
      assert.match(text, /event: error/, item.label);
      assert.match(text, /"runCode":"RUN_ADMISSION_REJECTED"/, item.label);
      assert.doesNotMatch(text, /已记录/, item.label);
      assert.doesNotMatch(text, /event: done/, item.label);
    }
  });
});
