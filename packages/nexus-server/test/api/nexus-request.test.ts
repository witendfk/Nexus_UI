import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import Koa from 'koa';
import { CatalogRegistry, parseSurfaceCommit } from '@nexus-ui/core';
import { AgentAdapter } from '../../src/agent/adapter';
import { createAgentRouter } from '../../src/api/routes';
import { parseNexusActionRequest } from '../../src/api/nexus-request';

const fixtureRoot = new URL('../../../../fixtures/catalog-v2/', import.meta.url);
const fixture = JSON.parse(
  readFileSync(new URL('request-accept-with-inputs.json', fixtureRoot), 'utf8'),
);
const { catalog } = JSON.parse(
  readFileSync(new URL('catalog-accept-interactive-form.json', fixtureRoot), 'utf8'),
);

function fixedCommit(output: string) {
  const frames = output.split('\n\n').filter((frame) => frame.startsWith('event: done\n'));
  assert.equal(frames.length, 1, output);
  const frame = frames[0]!;
  const commit = parseSurfaceCommit(
    JSON.parse(
      frame
        .split('\n')
        .find((line) => line.startsWith('data: '))!
        .slice(6),
    ),
  );
  assert(commit);
  assert(frame.includes(`id: ${commit.runId}:done`));
  return commit;
}

test('HTTP uses the rendered run commit and original actionId; rejects old, stale and replayed requests', async (t) => {
  let calls = 0;
  const surfaceId = fixture.request.message.action.surfaceId;
  const adapter = new AgentAdapter({
    registry: new CatalogRegistry([catalog]),
    createSurfaceId: () => surfaceId,
    createGenerationSource: () => fixture.surface.messages,
    editablePaths: () => fixture.editablePaths,
  });
  adapter.registerActionHandler(catalog.catalogId, 'rate', (action) => {
    calls++;
    assert.equal(action.context.score, 4);
    assert.equal(action.actionId, 'original-browser-action');
    return [{ version: 'v0.9', updateDataModel: { surfaceId, path: '/note', value: 'accepted' } }];
  });
  const app = new Koa();
  app.use(createAgentRouter({ adapter, streamDelayMs: 0 }).routes());
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) =>
    fetch(`${base}/api/a2ui/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const generate = async () =>
    fixedCommit(await (await post('generate', { catalogId: catalog.catalogId })).text());
  // S3.2 迁移：调度内准入失败（旧 revision/重放/陈旧 actionId）从同步 400 变为
  // HTTP 200 SSE + error 事件（runCode RUN_ADMISSION_REJECTED、commitState notCommitted），
  // handler 不得调用；拒绝语义本身保持不变。
  const assertEventRejected = async (body: unknown, why: string) => {
    const response = await post('event', body);
    const text = await response.text();
    assert.equal(response.status, 200, `${why}（S3.2 调度内失败 → 200 SSE）：${text}`);
    assert.ok(text.includes('event: error'), `${why}：应以 error 事件终态`);
    assert.ok(!text.includes('event: done'), `${why}：被拒不产生 done 提交`);
    const payload = JSON.parse(
      text
        .split('\n\n')
        .find((block) => block.includes('event: error'))!
        .match(/data: (.*)/)![1],
    ) as { runCode?: string; commitState?: string };
    assert.equal(payload.runCode, 'RUN_ADMISSION_REJECTED', `${why}：运行内准入拒绝码`);
    assert.equal(payload.commitState, 'notCommitted');
  };
  const first = await generate();
  assert.equal((await post('event', fixture.request.message)).status, 400);
  const envelope = {
    message: fixture.request.message,
    nexus: {
      ...fixture.request.nexus,
      actionId: 'original-browser-action',
      surfaceRevision: first.surfaceRevision,
      catalogHash: first.catalogHash,
    },
  };
  for (const invalid of [
    { ...envelope, nexus: undefined },
    { ...envelope, nexus: { ...envelope.nexus, inputs: null } },
    { ...envelope, nexus: { ...envelope.nexus, surfaceRevision: 0 } },
  ]) {
    assert.equal((await post('event', invalid)).status, 400);
  }
  assert.equal(calls, 0);
  // Another generation commits before the old view submits: latest-state reconstruction would bless it.
  const second = await generate();
  assert(second.surfaceRevision > first.surfaceRevision);
  await assertEventRejected(envelope, '旧渲染 revision 的提交必须被拒');
  assert.equal(calls, 0);
  const current = {
    ...envelope,
    nexus: { ...envelope.nexus, surfaceRevision: second.surfaceRevision },
  };
  const response = await post('event', current);
  const output = await response.text();
  assert.equal(response.status, 200, output);
  const actionCommit = fixedCommit(output);
  assert(actionCommit.surfaceRevision > second.surfaceRevision);
  assert.equal(calls, 1);
  await assertEventRejected(current, 'same actionId cannot execute twice');
  assert.equal(calls, 1, 'same actionId cannot execute twice');
  await assertEventRejected(
    { ...current, nexus: { ...current.nexus, actionId: 'another-stale-action' } },
    'old rendered commit cannot be refreshed from current server state',
  );
  assert.equal(calls, 1, 'old rendered commit cannot be refreshed from current server state');
});

test('request parser rejects conflicting action IDs and unknown metadata', () => {
  const valid = {
    ...fixture.request,
    nexus: { ...fixture.request.nexus, catalogHash: `sha256:${'0'.repeat(64)}` },
  };
  assert(parseNexusActionRequest(valid));
  assert.equal(
    parseNexusActionRequest({
      ...valid,
      message: { ...valid.message, action: { ...valid.message.action, actionId: 'conflicting' } },
    }),
    null,
  );
  assert.equal(
    parseNexusActionRequest({ ...valid, nexus: { ...valid.nexus, forged: true } }),
    null,
  );
});
