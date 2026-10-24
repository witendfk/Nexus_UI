import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { A2UIRuntime, CatalogRegistry, parseSurfaceCommit } from '@nexus-ui/core';
import type { CatalogDefinition, NexusSurfaceCommit } from '@nexus-ui/core';
import { NEXUS_BASIC_TASK_CATALOG } from '../src/agent/catalog';

process.env.NODE_ENV = 'test';
delete process.env.OPENAI_API_KEY;

const { app } = await import('../src/main');
const server = app.listen(0) as Server;
const { port } = server.address() as AddressInfo;
const baseUrl = `http://127.0.0.1:${port}`;

after(() => {
  server.close();
});

/**
 * S2.6.4.2 / S2.6.4.3 / S2.6.3.4 headless 对测（Basic 表单组）：
 * 实际装配 → core 本地编辑 → HTTP envelope → 权威 handler → 同 surface patch →
 * 再编辑/action。消费方语义与两个浏览器一致：响应头关联 runId、done 即基准、
 * 成功后按快照确认草稿、失败不确认。
 */

interface Consumed {
  readonly commit: NexusSurfaceCommit;
  readonly text: string;
  readonly runIdHeader: string | null;
}

async function loadRegistry(): Promise<CatalogRegistry> {
  const response = await fetch(
    `${baseUrl}/api/a2ui/catalog-contract?catalogId=${encodeURIComponent(NEXUS_BASIC_TASK_CATALOG)}`,
  );
  assert.equal(response.status, 200);
  const payload = (await response.json()) as { catalog: CatalogDefinition };
  return new CatalogRegistry([payload.catalog]);
}

async function consume(runtime: A2UIRuntime, url: string, body: unknown): Promise<Consumed> {
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
    const eventLine = frame.split('\n').find((line) => line.startsWith('event: '));
    const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
    if (!dataLine) continue;
    const event = eventLine?.slice(7) ?? 'message';
    if (event === 'message') runtime.push(`${dataLine.slice(6)}\n`);
    if (event === 'done') {
      commit = parseSurfaceCommit(JSON.parse(dataLine.slice(6)));
    }
  }
  runtime.end();
  assert.ok(commit, '成功流必须携带 done 固定结果');
  assert.equal(commit.runId, runIdHeader, 'done.runId 必须与 X-Nexus-Run-Id 一致');
  return { commit, text, runIdHeader };
}

async function generateForm(runtime: A2UIRuntime): Promise<Consumed> {
  return consume(runtime, `${baseUrl}/api/a2ui/generate`, {
    message: '生成一个订阅表单卡片',
    catalogId: NEXUS_BASIC_TASK_CATALOG,
  });
}

function actionEnvelope(
  baseline: NexusSurfaceCommit,
  inputs: readonly unknown[],
  overrides: Partial<{ surfaceRevision: number; catalogHash: string }> = {},
): unknown {
  return {
    message: {
      version: 'v0.9',
      action: {
        name: 'submit',
        surfaceId: baseline.surfaceId,
        sourceComponentId: 'submitButton',
        timestamp: new Date().toISOString(),
        context: {},
      },
    },
    nexus: {
      sessionVersion: baseline.sessionVersion,
      actionId: randomUUID(),
      surfaceRevision: overrides.surfaceRevision ?? baseline.surfaceRevision,
      catalogHash: overrides.catalogHash ?? baseline.catalogHash,
      inputs,
    },
  };
}

async function postRaw(body: unknown): Promise<{ status: number; text: string }> {
  const response = await fetch(`${baseUrl}/api/a2ui/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

describe('S2.6.4.2 Basic 表单连续交互（headless，真实 HTTP）', () => {
  it('首次提交草稿→确认→第二次不重发→再编辑随新草稿发出；最终模型与服务端一致', async () => {
    const runtime = new A2UIRuntime({ catalogRegistry: await loadRegistry() });
    const generation = await generateForm(runtime);
    const surfaceId = generation.commit.surfaceId;

    assert.ok(runtime.setInputValue('name', surfaceId, 'value', '张三'));
    assert.ok(runtime.setInputValue('subscribed', surfaceId, 'value', true));
    const sent = runtime.extractLatestInputDrafts(surfaceId);
    const first = await consume(
      runtime,
      `${baseUrl}/api/a2ui/event`,
      actionEnvelope(
        generation.commit,
        sent.entries.map((entry) => entry.input),
      ),
    );
    assert.match(first.text, /已提交：name=张三，subscribed=true/);
    // revision 为实例级单调计数：只断言新基准严格大于旧基准。
    assert.ok(first.commit.surfaceRevision > generation.commit.surfaceRevision);
    runtime.confirmInputDrafts(sent);
    assert.deepEqual(runtime.getLatestInputs(surfaceId), []);

    // 本地最终模型 = 服务端已准入输入 + handler patch。
    const model = runtime.store.getState().dataModelBySurface[surfaceId] as Record<string, unknown>;
    assert.equal(model.name, '张三');
    assert.equal(model.subscribed, true);

    // 第二次提交：不重发已确认草稿，参数由服务端模型重算。
    const again = runtime.extractLatestInputDrafts(surfaceId);
    assert.deepEqual(again.entries, []);
    const second = await consume(
      runtime,
      `${baseUrl}/api/a2ui/event`,
      actionEnvelope(first.commit, []),
    );
    assert.match(second.text, /已提交：name=张三，subscribed=true/);
    assert.ok(second.commit.surfaceRevision > first.commit.surfaceRevision);

    // 再编辑：只带新草稿。
    assert.ok(runtime.setInputValue('name', surfaceId, 'value', '李四'));
    const third = runtime.extractLatestInputDrafts(surfaceId);
    assert.deepEqual(
      third.entries.map((entry) => entry.input),
      [{ componentId: 'name', property: 'value', value: '李四' }],
    );
    const result = await consume(
      runtime,
      `${baseUrl}/api/a2ui/event`,
      actionEnvelope(
        second.commit,
        third.entries.map((entry) => entry.input),
      ),
    );
    assert.match(result.text, /已提交：name=李四，subscribed=true/);
    runtime.confirmInputDrafts(third);
    assert.deepEqual(runtime.getLatestInputs(surfaceId), []);
  });
});

describe('S2.6.4.3 拒绝不变式与双 surface 隔离（headless，真实 HTTP）', () => {
  it('旧 revision / 错 hash / 未声明属性被拒：handler 零调用、草稿不确认、基准可继续使用', async () => {
    const runtime = new A2UIRuntime({ catalogRegistry: await loadRegistry() });
    const generation = await generateForm(runtime);
    const surfaceId = generation.commit.surfaceId;
    assert.ok(runtime.setInputValue('name', surfaceId, 'value', '草稿'));
    const sent = runtime.extractLatestInputDrafts(surfaceId);
    const inputs = sent.entries.map((entry) => entry.input);

    // S3.2：调度内准入失败（stale revision/错 hash/越权属性）经 SSE error 报告
    //（200 + error 帧），不再是入队前 400；handler 零调用、草稿不确认不变。
    const staleRevision = await postRaw(
      actionEnvelope(generation.commit, inputs, { surfaceRevision: 99 }),
    );
    assert.equal(staleRevision.status, 200);
    assert.match(staleRevision.text, /event: error/);
    assert.match(staleRevision.text, /"code":"RUN_ADMISSION_REJECTED"/);
    assert.doesNotMatch(staleRevision.text, /已提交/);

    const wrongHash = await postRaw(
      actionEnvelope(generation.commit, inputs, { catalogHash: `sha256:${'0'.repeat(64)}` }),
    );
    assert.equal(wrongHash.status, 200);
    assert.match(wrongHash.text, /event: error/);
    assert.doesNotMatch(wrongHash.text, /已提交/);

    const undeclaredProperty = await postRaw(
      actionEnvelope(generation.commit, [
        { componentId: 'name', property: 'label', value: '越权' },
      ]),
    );
    assert.equal(undeclaredProperty.status, 200);
    assert.match(undeclaredProperty.text, /event: error/);
    assert.doesNotMatch(undeclaredProperty.text, /已提交/);

    // 失败不确认：草稿原样保留；快照/revision 不变，原基准仍可用。
    assert.deepEqual(runtime.getLatestInputs(surfaceId), [
      { componentId: 'name', property: 'value', value: '草稿' },
    ]);
    const ok = await consume(
      runtime,
      `${baseUrl}/api/a2ui/event`,
      actionEnvelope(generation.commit, inputs),
    );
    assert.match(ok.text, /已提交：name=草稿/);
    assert.ok(ok.commit.surfaceRevision > generation.commit.surfaceRevision);
  });

  it('双 surface：A 的草稿/确认/基准/patch 不影响 B', async () => {
    const runtime = new A2UIRuntime({ catalogRegistry: await loadRegistry() });
    const a = await generateForm(runtime);
    const b = await generateForm(runtime);
    assert.notEqual(a.commit.surfaceId, b.commit.surfaceId);

    assert.ok(runtime.setInputValue('name', a.commit.surfaceId, 'value', 'A-草稿'));
    assert.ok(runtime.setInputValue('name', b.commit.surfaceId, 'value', 'B-草稿'));
    const sentA = runtime.extractLatestInputDrafts(a.commit.surfaceId);
    const actionA = await consume(
      runtime,
      `${baseUrl}/api/a2ui/event`,
      actionEnvelope(
        a.commit,
        sentA.entries.map((entry) => entry.input),
      ),
    );
    assert.match(actionA.text, /已提交：name=A-草稿/);
    runtime.confirmInputDrafts(sentA);

    // B 的草稿、基准与模型未被 A 触碰。
    assert.deepEqual(runtime.getLatestInputs(b.commit.surfaceId), [
      { componentId: 'name', property: 'value', value: 'B-草稿' },
    ]);
    const modelB = runtime.store.getState().dataModelBySurface[b.commit.surfaceId] as Record<
      string,
      unknown
    >;
    assert.equal(modelB.name, 'B-草稿');
    assert.equal((modelB as { result?: unknown }).result, '等待提交');

    const sentB = runtime.extractLatestInputDrafts(b.commit.surfaceId);
    const actionB = await consume(
      runtime,
      `${baseUrl}/api/a2ui/event`,
      actionEnvelope(
        b.commit,
        sentB.entries.map((entry) => entry.input),
      ),
    );
    assert.match(actionB.text, /已提交：name=B-草稿/);
    assert.ok(actionB.commit.surfaceRevision > b.commit.surfaceRevision);
    assert.equal(actionB.commit.surfaceId, b.commit.surfaceId);
  });
});

describe('S2.6.3.4 查询不恢复资格（真实路由）', () => {
  it('按 run 查询返回旧结果，但不能给旧视图换 revision；404 不能形成基准', async () => {
    const runtime = new A2UIRuntime({ catalogRegistry: await loadRegistry() });
    const generation = await generateForm(runtime);
    const surfaceId = generation.commit.surfaceId;
    const action = await consume(
      runtime,
      `${baseUrl}/api/a2ui/event`,
      actionEnvelope(generation.commit, []),
    );
    assert.ok(action.commit.surfaceRevision > generation.commit.surfaceRevision);

    // 查询 A 的生成运行：返回该运行提交时的固定旧 revision。
    const query = await fetch(
      `${baseUrl}/api/a2ui/surface-state?surfaceId=${encodeURIComponent(surfaceId)}&runId=${encodeURIComponent(
        generation.commit.runId,
      )}`,
    );
    assert.equal(query.status, 200);
    const queried = parseSurfaceCommit(await query.json());
    assert.ok(queried);
    assert.equal(queried.surfaceRevision, generation.commit.surfaceRevision);
    assert.ok(queried.surfaceRevision < action.commit.surfaceRevision);

    // 用查询到的旧结果当基准提交 action：服务端 revision 已是 2，必须拒绝。
    // S3.2：调度内准入失败经 SSE error 报告（200 + error 帧），不再是 400。
    const stale = await postRaw(actionEnvelope(queried, []));
    assert.equal(stale.status, 200);
    assert.match(stale.text, /event: error/);
    assert.match(stale.text, /"code":"RUN_ADMISSION_REJECTED"/);
    assert.doesNotMatch(stale.text, /已提交/);

    // 未知 runId：404，不能构造任何基准。
    const missing = await fetch(
      `${baseUrl}/api/a2ui/surface-state?surfaceId=${encodeURIComponent(surfaceId)}&runId=${encodeURIComponent(
        randomUUID(),
      )}`,
    );
    assert.equal(missing.status, 404);

    // 正常基准来自本次成功 done，无需查询。
    const next = await consume(
      runtime,
      `${baseUrl}/api/a2ui/event`,
      actionEnvelope(action.commit, []),
    );
    assert.ok(next.commit.surfaceRevision > action.commit.surfaceRevision);
  });
});
