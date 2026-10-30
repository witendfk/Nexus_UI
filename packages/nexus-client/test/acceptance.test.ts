import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
// S4.1.4：从本次构建的 core/client 公开根入口验证完整链路（不 import 源码）。
import * as core from '@nexus-ui/core';
import * as client from '../dist/index.js';
import type { SseFrame, TransportRequest } from '../dist/index.js';

/** 与参考浏览器同口径：core 规范化输入 + SHA-256（浏览器用 Web Crypto）。 */
function contractHash(catalog: core.CatalogDefinition): string {
  return `sha256:${createHash('sha256').update(core.getCatalogContractHashInput(catalog)).digest('hex')}`;
}

/**
 * S4.1.4 headless 公开契约验收（SPEC §7/CURRENT S4.1.4）：
 * - 从构建产物（core dist via workspace 根入口 + client dist）驱动完整链路：
 *   生成 → 提交 → 输入/action → patch → 失败/unknown → 恢复；
 * - 实际读取共享 Session/Catalog fixture（fixtures/session-v1/）；
 * - 矩阵（17 cell 全覆盖，2026-10-30 完整矩阵签收）：自定义输入/action、
 *   两个 Catalog、双 surface 更新/删除、缺失 done、坏消息顺序、done-only、
 *   身份/版本错配、本地拒绝、发送不确定性、同步取消、晚到响应、unknown、
 *   合法/非法恢复、请求期间编辑、稳定快照、订阅与 dispose 幂等释放。
 * 断言视图、草稿、固定基准、动作门控与资源清理，而非仅状态字符串。
 */

const FIXTURE_ROOT = new URL('../../../fixtures/session-v1/', import.meta.url);
const fixtureCatalog = (
  JSON.parse(readFileSync(new URL('catalog.json', FIXTURE_ROOT), 'utf8')) as {
    catalog: core.CatalogDefinition;
  }
).catalog;
const FIXTURE_CATALOG_ID = fixtureCatalog.catalogId;
const fixtureHash = contractHash(fixtureCatalog);

const CLIENT_CATALOG_ID = 'https://example.com/catalogs/client-acceptance/v1';
function clientCatalog(): core.CatalogDefinition {
  return {
    catalogId: CLIENT_CATALOG_ID,
    components: {
      ...core.standardCatalogComponentDeclarations(),
      TextField: {
        ...core.standardCatalogComponentDeclarations().TextField,
        inputs: { value: { type: 'string', maxLength: 200 } },
      },
    },
    actions: [
      {
        name: 'save',
        sources: ['Button'],
        paramSchema: { type: 'object', additionalProperties: false, properties: {} },
      },
    ],
  };
}
const CLIENT_HASH = contractHash(clientCatalog());

interface Entry {
  runId: string | null;
  frames: SseFrame[];
}
function scripted(transportRef: {
  queue: Entry[];
  requests?: TransportRequest[];
  observed?: SseFrame[];
}): client.SessionTransport {
  return {
    async open(request) {
      const next = transportRef.queue.shift();
      if (!next) throw new Error('transport script exhausted');
      transportRef.requests?.push({ ...request, body: structuredClone(request.body) });
      return {
        runIdHeader: next.runId,
        frames: (async function* () {
          for (const frame of next.frames) {
            await Promise.resolve();
            transportRef.observed?.push(structuredClone(frame));
            yield frame;
          }
        })(),
      };
    },
  };
}

function buildQueue(): Entry[] & { pushEntry(e: Entry): void } {
  const arr: Entry[] = [];
  return Object.assign(arr, {
    pushEntry(e: Entry): void {
      arr.push(e);
    },
  });
}

interface OracleEvent {
  event: string;
  count?: number;
  surfaceRevision?: number | null;
  code?: string;
  commitState?: string;
}
interface SessionOracle {
  request: {
    generate?: client.GenerateRequest;
    action?: {
      message: { action: Pick<client.ActionRequest, 'name' | 'sourceComponentId' | 'context'> };
      nexus: {
        actionId: string;
        surfaceRevision: number;
        inputs: Array<{ componentId: string; property: string; value: unknown }>;
      };
    };
  };
  setup?: { surface: { messages: core.A2UIMessage[] } };
  steps?: Array<{ interleave?: string }>;
  source: { messages: core.A2UIMessage[] };
  expected: {
    events: OracleEvent[];
    terminal: string;
    commitState: string;
    surfaceRevisionAfter: number;
    handlerParamScore?: number;
  };
}
function loadOracle(name: string): SessionOracle {
  return JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURE_ROOT), 'utf8')) as SessionOracle;
}

function createdSurfaceId(messages: core.A2UIMessage[]): string {
  const first = messages[0];
  assert.ok(first && 'createSurface' in first);
  return first.createSurface.surfaceId;
}

/** 比较实际交给 client 的帧与共享 oracle；响应由场景事实构造，不由 expected 反推。 */
function assertOracleEvents(observed: SseFrame[], oracle: SessionOracle): void {
  const check = core.createSessionStreamCheck();
  const actual: OracleEvent[] = [];
  for (const frame of observed) {
    const raw = JSON.parse(frame.data) as Record<string, unknown>;
    const parsed = core.parseSessionEvent(frame.event, raw);
    assert.ok(parsed.ok, '共享序列须通过公开 Session 解析器');
    assert.equal(check.push(parsed.event), null);
    if (frame.event === 'message') {
      const last = actual[actual.length - 1];
      if (last?.event === 'message') last.count = (last.count ?? 1) + 1;
      else actual.push({ event: 'message', count: 1 });
    } else if (frame.event === 'error') {
      actual.push({ event: 'error', code: String(raw.code), commitState: String(raw.commitState) });
    } else {
      actual.push({
        event: frame.event,
        surfaceRevision: (raw.surfaceRevision as number | undefined) ?? null,
      });
    }
  }
  assert.equal(check.end(), null);
  assert.deepEqual(actual, oracle.expected.events, '实际消费序列须与共享 oracle 一致');
}

function assertOracleResult(result: client.RunResult, oracle: SessionOracle): void {
  // server failed/notCommitted + 准入拒绝映射为 client desync；不将业务终态等同 UI 就绪。
  const status = oracle.expected.terminal === 'succeeded' ? 'committed' : 'desync';
  assert.equal(result.status, status);
  if (result.status === 'committed') {
    assert.equal(oracle.expected.commitState, 'committed');
    assert.equal(result.commit.surfaceRevision, oracle.expected.surfaceRevisionAfter);
  } else {
    assert.equal(oracle.expected.terminal, 'failed');
    assert.equal(oracle.expected.commitState, 'notCommitted');
  }
}

describe('S4.1.4 · 共享 fixture 驱动（core/client 构建入口）', () => {
  it('accept-generation oracle：事件序列与 core 解析器逐条一致，done 提交可恢复', async () => {
    const oracle = loadOracle('accept-generation');
    const runtime = new core.A2UIRuntime({
      catalogRegistry: new core.CatalogRegistry([fixtureCatalog]),
    });
    const queue = buildQueue();
    const runId = 'ace0f888-0000-4000-8000-000000000001';
    const surfaceId = createdSurfaceId(oracle.source.messages);
    queue.pushEntry({
      runId,
      frames: [
        startF(runId, surfaceId, { catalogId: FIXTURE_CATALOG_ID, hash: fixtureHash }),
        ...oracle.source.messages.map((message) => sse('message', message)),
        doneF(runId, surfaceId, 1, { catalogId: FIXTURE_CATALOG_ID, hash: fixtureHash }),
      ],
    });
    const observed: SseFrame[] = [];
    const session = client.createClientSession({
      runtime,
      catalogHashes: new Map([[FIXTURE_CATALOG_ID, fixtureHash]]),
      transport: scripted({ queue, observed }),
      endpoints: { generate: '/g', event: '/e' },
    });
    const result = await session.generate(oracle.request.generate!);
    assertOracleEvents(observed, oracle);
    assertOracleResult(result, oracle);
    assert.equal(session.getSurface(surfaceId)?.phase, 'ready');
    assert.equal(
      session.getSurface(surfaceId)?.baseline?.surfaceRevision,
      oracle.expected.surfaceRevisionAfter,
    );
    assert.equal(session.getSurface(surfaceId)?.baseline?.runId, runId);
    assert.ok(runtime.getSurfaceView(surfaceId)!.components.some((c) => c.id === 'root'));
    // open 已调用后抛错，不能证明未送达：旧基准关闭，固定提交可恢复。
    assert.equal(
      (await session.action({ surfaceId, name: 'rate', sourceComponentId: 'rating-1' })).status,
      'desync',
    );
    assert.equal(session.recover(session.getCommittedSurface(surfaceId)!).status, 'committed');
    assert.equal(session.getSurface(surfaceId)?.actionOpen, true);
  });

  it('accept-action-with-inputs oracle：inputs 随 nexus 发送，patch 提交推进 revision', async () => {
    const oracle = loadOracle('accept-action-with-inputs');
    const request = oracle.request.action!;
    const runtime = new core.A2UIRuntime({
      catalogRegistry: new core.CatalogRegistry([fixtureCatalog]),
    });
    const queue = buildQueue();
    const surfaceId = createdSurfaceId(oracle.setup!.surface.messages);
    const genRunId = 'ace0f888-0000-4000-8000-000000000010';
    const actionRunId = 'ace0f888-0000-4000-8000-000000000011';
    queue.pushEntry({
      runId: genRunId,
      frames: [
        startF(genRunId, surfaceId, { catalogId: FIXTURE_CATALOG_ID, hash: fixtureHash }),
        ...oracle.setup!.surface.messages.map((message) => sse('message', message)),
        doneF(genRunId, surfaceId, 1, { catalogId: FIXTURE_CATALOG_ID, hash: fixtureHash }),
      ],
    });
    const requests: TransportRequest[] = [],
      observed: SseFrame[] = [];
    const base = scripted({ queue, requests, observed });
    const transport: client.SessionTransport = {
      async open(actual) {
        if (actual.url === '/e') {
          // 校验真实请求，而非仅让固定成功响应掩盖漏发 inputs。
          const body = actual.body as ActionBody;
          assert.deepEqual(body.nexus.inputs, request.nexus.inputs);
          assert.equal(body.nexus.surfaceRevision, request.nexus.surfaceRevision);
          assert.equal(body.nexus.catalogHash, fixtureHash);
          assert.equal(body.nexus.actionId, request.nexus.actionId);
          assert.deepEqual(body.message.action.context, request.message.action.context);
          // 模拟 SDK server 的输入基础模型帧，再发布 fixture handler patch（S3 已对测服务端）。
          const inputView = runtime.createViewRuntime();
          inputView.restoreSurfaceView(session.getCommittedSurface(surfaceId)!.view);
          for (const input of body.nexus.inputs)
            assert.equal(
              inputView.setInputValue(input.componentId, surfaceId, input.property, input.value),
              true,
            );
          queue.pushEntry({
            runId: actionRunId,
            frames: [
              startF(actionRunId, surfaceId, {
                catalogId: FIXTURE_CATALOG_ID,
                hash: fixtureHash,
                revision: body.nexus.surfaceRevision,
              }),
              sse('message', {
                version: 'v0.9',
                updateDataModel: {
                  surfaceId,
                  value: inputView.getSurfaceView(surfaceId)!.dataModel,
                },
              }),
              ...oracle.source.messages.map((message) => sse('message', message)),
              doneF(actionRunId, surfaceId, body.nexus.surfaceRevision + 1, {
                catalogId: FIXTURE_CATALOG_ID,
                hash: fixtureHash,
              }),
            ],
          });
        }
        return base.open(actual);
      },
    };
    const session = client.createClientSession({
      runtime,
      catalogHashes: new Map([[FIXTURE_CATALOG_ID, fixtureHash]]),
      transport,
      endpoints: { generate: '/g', event: '/e' },
    });
    assert.equal((await session.generate({ catalogId: FIXTURE_CATALOG_ID })).status, 'committed');
    observed.length = 0;
    for (const input of request.nexus.inputs)
      assert.equal(
        runtime.setInputValue(input.componentId, surfaceId, input.property, input.value),
        true,
      );
    const result = await session.action({
      surfaceId,
      ...request.message.action,
      actionId: request.nexus.actionId,
    });
    assertOracleEvents(observed, oracle);
    assertOracleResult(result, oracle);
    assert.equal(requests.length, 2);
    assert.deepEqual((requests[1].body as ActionBody).nexus.inputs, request.nexus.inputs);
    assert.equal(
      core.getByPath(runtime.getSurfaceView(surfaceId)!.dataModel, '/score'),
      oracle.expected.handlerParamScore,
    );
    assert.equal(runtime.getLatestInputs(surfaceId).length, 0, '成功确认发送代次');
  });
});

interface ActionBody {
  message: { action: { context: Record<string, unknown> } };
  nexus: {
    actionId: string;
    surfaceRevision: number;
    catalogHash: string;
    inputs: Array<{ componentId: string; property: string; value: unknown }>;
  };
}

describe('S4.1.4 · 双 Catalog 与双 surface 隔离', () => {
  it('两个 Catalog 各自生成；delete 一个 surface 不影响另一 surface 的门控', async () => {
    const runtime = new core.A2UIRuntime({
      catalogRegistry: new core.CatalogRegistry([clientCatalog(), structuredClone(fixtureCatalog)]),
    });
    const queue = buildQueue();
    const hashes = new Map<string, string>([
      [CLIENT_CATALOG_ID, CLIENT_HASH],
      [FIXTURE_CATALOG_ID, fixtureHash],
    ]);
    const runIdFor = (surfaceId: string, rev: number) =>
      `dead0000-0000-4000-8000-${surfaceId.replace(/[^a-z0-9]/gi, '').slice(0, 8)}${rev}`;
    for (const [surfaceId, catalogId, hash] of [
      ['acc-a', CLIENT_CATALOG_ID, CLIENT_HASH],
      ['fix-b', FIXTURE_CATALOG_ID, fixtureHash],
    ] as const) {
      queue.pushEntry({
        runId: runIdFor(surfaceId, 1),
        frames: [
          {
            event: 'start',
            data: JSON.stringify({
              type: 'start',
              sessionVersion: 1,
              runId: runIdFor(surfaceId, 1),
              surfaceId,
              catalogId,
              contractVersion: 2,
              catalogHash: hash,
            }),
          },
          {
            event: 'message',
            data: JSON.stringify({ version: 'v0.9', createSurface: { surfaceId, catalogId } }),
          },
          {
            event: 'message',
            data: JSON.stringify({
              version: 'v0.9',
              updateComponents: {
                surfaceId,
                components: [{ id: 'root', component: 'Text', text: 'x' }],
              },
            }),
          },
          {
            event: 'message',
            data: JSON.stringify({
              version: 'v0.9',
              updateDataModel: { surfaceId, value: { v: 1 } },
            }),
          },
          {
            event: 'done',
            data: JSON.stringify({
              sessionVersion: 1,
              runId: runIdFor(surfaceId, 1),
              surfaceId,
              catalogId,
              contractVersion: 2,
              catalogHash: hash,
              surfaceRevision: 1,
            }),
          },
        ],
      });
    }
    const session = client.createClientSession({
      runtime,
      catalogHashes: hashes,
      transport: scripted({ queue }),
      endpoints: { generate: '/g', event: '/e' },
    });
    const a = await session.generate({ catalogId: CLIENT_CATALOG_ID });
    const b = await session.generate({ catalogId: FIXTURE_CATALOG_ID });
    assert.ok(a.status === 'committed' && b.status === 'committed');
    assert.equal(session.getSurface('acc-a')!.actionOpen, true);
    assert.equal(session.getSurface('fix-b')!.actionOpen, true);

    // 经 core 受控删除 acc-a 的视图；fix-b 视图与门控不变。
    runtime.removeSurfaceView('acc-a');
    assert.equal(runtime.getSurfaceView('acc-a'), undefined);
    assert.equal(runtime.store.getState().dataModelBySurface['acc-a'], undefined);
    assert.equal(session.getSurface('fix-b')!.actionOpen, true);
    assert.deepEqual(runtime.store.getState().dataModelBySurface['fix-b'], { v: 1 });
  });
});

describe('S4.1.4 · done-only 生成与本地拒绝', () => {
  it('done-only 生成（无视图消息）：不提升门控', async () => {
    const runtime = new core.A2UIRuntime({
      catalogRegistry: new core.CatalogRegistry([clientCatalog()]),
    });
    const queue = buildQueue();
    const runId = 'd0ne0000-0000-4000-8000-000000000001';
    queue.pushEntry({
      runId,
      frames: [
        {
          event: 'start',
          data: JSON.stringify({
            type: 'start',
            sessionVersion: 1,
            runId,
            surfaceId: 'done-only',
            catalogId: CLIENT_CATALOG_ID,
            contractVersion: 2,
            catalogHash: CLIENT_HASH,
          }),
        },
        {
          event: 'done',
          data: JSON.stringify({
            sessionVersion: 1,
            runId,
            surfaceId: 'done-only',
            catalogId: CLIENT_CATALOG_ID,
            contractVersion: 2,
            catalogHash: CLIENT_HASH,
            surfaceRevision: 1,
          }),
        },
      ],
    });
    const session = client.createClientSession({
      runtime,
      catalogHashes: new Map([[CLIENT_CATALOG_ID, CLIENT_HASH]]),
      transport: scripted({ queue }),
      endpoints: { generate: '/g', event: '/e' },
    });
    const result = await session.generate({ catalogId: CLIENT_CATALOG_ID });
    assert.equal(result.status, 'desync', 'done-only 缺本地视图，按失同步收敛');
    assert.equal(
      session.getSurface('done-only'),
      undefined,
      '无视图无基准：surface 跟踪不保留，动作出口无从开放',
    );
  });

  it('本地拒绝（runtime dispatchChecked 拒绝非法组件）：流失败且视图无半提交', async () => {
    const runtime = new core.A2UIRuntime({
      catalogRegistry: new core.CatalogRegistry([clientCatalog()]),
    });
    const queue = buildQueue();
    const runId = 'ba d00000-0000-4000-8000-000000000001'.replace(' ', '');
    queue.pushEntry({
      runId,
      frames: [
        {
          event: 'start',
          data: JSON.stringify({
            type: 'start',
            sessionVersion: 1,
            runId,
            surfaceId: 'rej-1',
            catalogId: CLIENT_CATALOG_ID,
            contractVersion: 2,
            catalogHash: CLIENT_HASH,
          }),
        },
        {
          event: 'message',
          data: JSON.stringify({
            version: 'v0.9',
            createSurface: { surfaceId: 'rej-1', catalogId: CLIENT_CATALOG_ID },
          }),
        },
        {
          event: 'message',
          data: JSON.stringify({
            version: 'v0.9',
            updateComponents: {
              surfaceId: 'rej-1',
              components: [{ id: 'ghost', component: 'Ghost', child: 'x' }],
            },
          }),
        },
        {
          event: 'done',
          data: JSON.stringify({
            sessionVersion: 1,
            runId,
            surfaceId: 'rej-1',
            catalogId: CLIENT_CATALOG_ID,
            contractVersion: 2,
            catalogHash: CLIENT_HASH,
            surfaceRevision: 1,
          }),
        },
      ],
    });
    const session = client.createClientSession({
      runtime,
      catalogHashes: new Map([[CLIENT_CATALOG_ID, CLIENT_HASH]]),
      transport: scripted({ queue }),
      endpoints: { generate: '/g', event: '/e' },
    });
    const result = await session.generate({ catalogId: CLIENT_CATALOG_ID });
    assert.equal(result.status, 'desync', '本地拒绝按失同步收敛（视图已改动不可信）');
    // 预览不保留：跟踪与视图整体丢弃，动作出口无从开放。
    assert.equal(session.getSurface('rej-1'), undefined);
    assert.equal(runtime.getSurfaceView('rej-1'), undefined);
  });
});

describe('S4.1.4 · 请求期间编辑与订阅释放', () => {
  it('请求期间新编辑：可见模型与下次 inputs 一致，成功确认不误删新 serial', async () => {
    const runtime = new core.A2UIRuntime({
      catalogRegistry: new core.CatalogRegistry([clientCatalog()]),
    });
    const surfaceId = 'edit-1',
      opened = barrier(),
      release = barrier();
    const requests: TransportRequest[] = [];
    const transport: client.SessionTransport = {
      async open(request) {
        requests.push({ ...request, body: structuredClone(request.body) });
        if (requests.length === 1)
          return { runIdHeader: 'edit-setup', frames: framesOf(formRun('edit-setup', surfaceId)) };
        const revision = (request.body as ActionBody).nexus.surfaceRevision;
        const runId = `edit-action-${revision}`;
        if (revision === 1) {
          opened.resolve();
          await release.promise;
        }
        return {
          runIdHeader: runId,
          frames: framesOf([
            startF(runId, surfaceId, { revision }),
            sse('message', {
              version: 'v0.9',
              updateDataModel: { surfaceId, value: { name: 'server-normalized' } },
            }),
            doneF(runId, surfaceId, revision + 1),
          ]),
        };
      },
    };
    const session = client.createClientSession({
      runtime,
      catalogHashes: new Map([[CLIENT_CATALOG_ID, CLIENT_HASH]]),
      transport,
      endpoints: { generate: '/g', event: '/e' },
    });
    assert.equal((await session.generate({ catalogId: CLIENT_CATALOG_ID })).status, 'committed');
    assert.equal(runtime.setInputValue('field', surfaceId, 'value', 'sent'), true);
    const pending = session.action(save(surfaceId));
    await opened.promise;
    assert.deepEqual((requests[1].body as ActionBody).nexus.inputs, [
      { componentId: 'field', property: 'value', value: 'sent' },
    ]);
    assert.equal(runtime.setInputValue('field', surfaceId, 'value', 'edited-later'), true);
    assert.equal(
      core.getByPath(runtime.getSurfaceView(surfaceId)!.dataModel, '/name'),
      'edited-later',
    );
    release.resolve();
    assert.equal((await pending).status, 'committed');
    const visible = core.getByPath(runtime.getSurfaceView(surfaceId)!.dataModel, '/name');
    assert.equal(visible, 'edited-later', '服务端 patch 不能覆盖请求期间的新编辑');
    assert.equal(
      core.getByPath(session.getCommittedSurface(surfaceId)!.view.dataModel, '/name'),
      'server-normalized',
    );
    assert.deepEqual(runtime.getLatestInputs(surfaceId), [
      { componentId: 'field', property: 'value', value: visible },
    ]);
    assert.equal((await session.action(save(surfaceId))).status, 'committed');
    assert.deepEqual((requests[2].body as ActionBody).nexus.inputs, [
      { componentId: 'field', property: 'value', value: visible },
    ]);
    assert.equal(runtime.getLatestInputs(surfaceId).length, 0, '第二次提交确认对应草稿');
  });

  it('订阅与 dispose 幂等释放；dispose 后入口抛错', async () => {
    const runtime = new core.A2UIRuntime({
      catalogRegistry: new core.CatalogRegistry([clientCatalog()]),
    });
    const session = client.createClientSession({
      runtime,
      catalogHashes: new Map([[CLIENT_CATALOG_ID, CLIENT_HASH]]),
      transport: scripted({ queue: buildQueue() }),
      endpoints: { generate: '/g', event: '/e' },
    });
    let notified = 0;
    const unsub1 = session.subscribe(() => {
      notified += 1;
    });
    const unsub2 = session.subscribe(() => {
      notified += 1;
    });
    unsub1();
    unsub1(); // 幂等。
    session.dispose();
    unsub2(); // dispose 后解除仍安全。
    assert.equal(session.disposed, true);
    await assert.rejects(() => session.generate({ catalogId: CLIENT_CATALOG_ID }), /已销毁/);
    assert.equal(notified, 0, 'dispose 清空订阅，未发生通知');
  });
});

// —— 以下为 S4.1.4 完整矩阵签收补充用例（2026-10-30）：覆盖原 7 项未及的
// 缺失 done、坏顺序、身份/版本错配、unknown、晚到/取消分支、stale-revision
// oracle 接线、非法恢复与稳定快照，全部仍从构建产物公开根入口驱动。

function sse(event: string, data: unknown): SseFrame {
  return { event, data: JSON.stringify(data) };
}

function startF(
  runId: string,
  surfaceId: string,
  opts: { catalogId?: string; hash?: string; revision?: number } = {},
): SseFrame {
  return sse('start', {
    type: 'start',
    sessionVersion: 1,
    runId,
    surfaceId,
    catalogId: opts.catalogId ?? CLIENT_CATALOG_ID,
    contractVersion: 2,
    catalogHash: opts.hash ?? CLIENT_HASH,
    ...(opts.revision === undefined ? {} : { surfaceRevision: opts.revision }),
  });
}

function doneF(
  runId: string,
  surfaceId: string,
  surfaceRevision: number,
  opts: { catalogId?: string; hash?: string; overrides?: Record<string, unknown> } = {},
): SseFrame {
  return sse('done', {
    sessionVersion: 1,
    runId,
    surfaceId,
    catalogId: opts.catalogId ?? CLIENT_CATALOG_ID,
    contractVersion: 2,
    catalogHash: opts.hash ?? CLIENT_HASH,
    surfaceRevision,
    ...opts.overrides,
  });
}

/** 表单 surface 视图消息：Button action（save）+ 可写 TextField（inputs 声明 value）。 */
function formMessages(surfaceId: string): SseFrame[] {
  return [
    sse('message', {
      version: 'v0.9',
      createSurface: { surfaceId, catalogId: CLIENT_CATALOG_ID },
    }),
    sse('message', {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Column', children: ['confirm', 'field'] },
          {
            id: 'confirm',
            component: 'Button',
            child: 'label',
            action: { event: { name: 'save', context: {} } },
          },
          { id: 'label', component: 'Text', text: '提交' },
          { id: 'field', component: 'TextField', value: { path: '/name' }, label: '姓名' },
        ],
      },
    }),
    sse('message', { version: 'v0.9', updateDataModel: { surfaceId, value: { name: 'base' } } }),
  ];
}

function formRun(runId: string, surfaceId: string, revision = 1): SseFrame[] {
  return [startF(runId, surfaceId), ...formMessages(surfaceId), doneF(runId, surfaceId, revision)];
}

function framesOf(list: SseFrame[]): AsyncIterable<SseFrame> {
  return (async function* () {
    for (const frame of list) {
      await Promise.resolve();
      yield frame;
    }
  })();
}

const save = (surfaceId: string) => ({ surfaceId, name: 'save', sourceComponentId: 'confirm' });

function barrier(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** 挂起的帧序列：收到 abort 时拒绝，模拟真实连接被取消。 */
function hangingFrames(request: TransportRequest): AsyncIterable<SseFrame> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise<IteratorResult<SseFrame>>((_resolve, reject) => {
          if (request.signal?.aborted) reject(new DOMException('aborted', 'AbortError'));
          else
            request.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('aborted', 'AbortError')),
              { once: true },
            );
        }),
    }),
  };
}

/** 统计 transport.open 次数（断言门控发生在出网之前）。 */
function openCounting(queue: ReturnType<typeof buildQueue>): {
  transport: client.SessionTransport;
  opens: () => number;
} {
  const base = scripted({ queue });
  let opens = 0;
  return {
    transport: {
      async open(request) {
        opens += 1;
        return base.open(request);
      },
    },
    opens: () => opens,
  };
}

const R1_BAD = 'ba800000-0000-4000-8000-000000000001';

describe('S4.1.4 · 缺失 done 与坏流顺序（构建入口）', () => {
  it('缺失 done：EOF 无终态 → desync，候选不发布、无半提交', async () => {
    const runtime = new core.A2UIRuntime({
      catalogRegistry: new core.CatalogRegistry([clientCatalog()]),
    });
    const queue = buildQueue();
    const runId = 'e0f00000-0000-4000-8000-000000000001';
    const surfaceId = 'no-done';
    // 与 formRun 相同的合法消息序列，但 EOF 无 done。
    queue.pushEntry({ runId, frames: [startF(runId, surfaceId), ...formMessages(surfaceId)] });
    const session = client.createClientSession({
      runtime,
      catalogHashes: new Map([[CLIENT_CATALOG_ID, CLIENT_HASH]]),
      transport: scripted({ queue }),
      endpoints: { generate: '/g', event: '/e' },
    });
    const result = await session.generate({ catalogId: CLIENT_CATALOG_ID });
    assert.equal(result.status, 'desync', 'EOF 不等于成功');
    assert.equal(session.getSurface(surfaceId), undefined, '候选跟踪已清理');
    assert.equal(runtime.getSurfaceView(surfaceId), undefined, '候选视图不发布');
    assert.equal(runtime.store.getState().surfaces[surfaceId], undefined, '无半提交 surface');
    assert.equal((await session.action(save(surfaceId))).status, 'desync', '动作出口无从开放');
  });

  it('坏顺序：message 先于 start、start 前终态 → 拒绝且视图无半提交', async () => {
    for (const [label, frames] of [
      ['message 先于 start', [...formMessages('bad-order'), doneF(R1_BAD, 'bad-order', 1)]],
      ['start 前终态', [doneF(R1_BAD, 'bad-order', 1)]],
    ] as const) {
      const runtime = new core.A2UIRuntime({
        catalogRegistry: new core.CatalogRegistry([clientCatalog()]),
      });
      const queue = buildQueue();
      queue.pushEntry({ runId: R1_BAD, frames: [...frames] });
      const session = client.createClientSession({
        runtime,
        catalogHashes: new Map([[CLIENT_CATALOG_ID, CLIENT_HASH]]),
        transport: scripted({ queue }),
        endpoints: { generate: '/g', event: '/e' },
      });
      const result = await session.generate({ catalogId: CLIENT_CATALOG_ID });
      assert.equal(result.status, 'desync', `${label}：无效流不采信`);
      assert.equal(session.getSurface('bad-order'), undefined, `${label}：跟踪已清理`);
      assert.equal(runtime.getSurfaceView('bad-order'), undefined, `${label}：视图未发布`);
      assert.equal(
        runtime.store.getState().surfaces['bad-order'],
        undefined,
        `${label}：runtime 无半提交`,
      );
    }
  });
});

describe('S4.1.4 · 身份与版本错配（构建入口）', () => {
  it('done 的 catalogHash 与 start 不一致 → desync 不提升', async () => {
    const runtime = new core.A2UIRuntime({
      catalogRegistry: new core.CatalogRegistry([clientCatalog()]),
    });
    const queue = buildQueue();
    const runId = 'ha5h0000-0000-4000-8000-000000000001';
    queue.pushEntry({
      runId,
      frames: [
        startF(runId, 'hash-mix'),
        ...formMessages('hash-mix'),
        doneF(runId, 'hash-mix', 1, { hash: 'sha256:' + 'b'.repeat(64) }),
      ],
    });
    const session = client.createClientSession({
      runtime,
      catalogHashes: new Map([[CLIENT_CATALOG_ID, CLIENT_HASH]]),
      transport: scripted({ queue }),
      endpoints: { generate: '/g', event: '/e' },
    });
    const result = await session.generate({ catalogId: CLIENT_CATALOG_ID });
    assert.equal(result.status, 'desync');
    assert.match((result as { reason: string }).reason, /不一致/);
    assert.equal(session.getSurface('hash-mix'), undefined);
    assert.equal(runtime.getSurfaceView('hash-mix'), undefined);
  });

  it('done 的 runId 与 start 不一致 → desync 不提升', async () => {
    const runtime = new core.A2UIRuntime({
      catalogRegistry: new core.CatalogRegistry([clientCatalog()]),
    });
    const queue = buildQueue();
    const runId = 'run1d000-0000-4000-8000-000000000001';
    const otherRunId = 'run1d000-0000-4000-8000-000000000002';
    queue.pushEntry({
      runId,
      frames: [
        startF(runId, 'run-mix'),
        ...formMessages('run-mix'),
        doneF(otherRunId, 'run-mix', 1),
      ],
    });
    const session = client.createClientSession({
      runtime,
      catalogHashes: new Map([[CLIENT_CATALOG_ID, CLIENT_HASH]]),
      transport: scripted({ queue }),
      endpoints: { generate: '/g', event: '/e' },
    });
    const result = await session.generate({ catalogId: CLIENT_CATALOG_ID });
    assert.equal(result.status, 'desync');
    assert.equal(session.getSurface('run-mix'), undefined, '跨 run 的 done 不提升视图');
    assert.equal(runtime.getSurfaceView('run-mix'), undefined);
  });
});

describe('S4.1.4 · 取消、晚到与 unknown（构建入口）', () => {
  it('unknown：error 帧 commitState unknown → desync 且动作出口关闭', async () => {
    const runtime = new core.A2UIRuntime({
      catalogRegistry: new core.CatalogRegistry([clientCatalog()]),
    });
    const queue = buildQueue();
    const surfaceId = 'unk-1';
    const setupRunId = 'unk00000-0000-4000-8000-000000000001';
    const actionRunId = 'unk00000-0000-4000-8000-000000000002';
    queue.pushEntry({ runId: setupRunId, frames: formRun(setupRunId, surfaceId) });
    queue.pushEntry({
      runId: actionRunId,
      frames: [
        startF(actionRunId, surfaceId),
        sse('error', {
          sessionVersion: 1,
          runId: actionRunId,
          surfaceId,
          code: 'RUN_COMMIT_UNKNOWN',
          commitState: 'unknown',
        }),
      ],
    });
    const session = client.createClientSession({
      runtime,
      catalogHashes: new Map([[CLIENT_CATALOG_ID, CLIENT_HASH]]),
      transport: scripted({ queue }),
      endpoints: { generate: '/g', event: '/e' },
    });
    assert.equal((await session.generate({ catalogId: CLIENT_CATALOG_ID })).status, 'committed');
    const result = await session.action(save(surfaceId));
    assert.equal(result.status, 'desync', '提交状态不可知按失同步收敛');
    const status = session.getSurface(surfaceId);
    assert.equal(status?.phase, 'desync');
    assert.equal(status?.actionOpen, false);
    assert.equal(status?.baseline?.surfaceRevision, 1, '基准不被未采信的运行推进');
  });

  it('晚到 done 不覆盖取消结论，也不推进基准', async () => {
    const release = barrier();
    const runtime = new core.A2UIRuntime({
      catalogRegistry: new core.CatalogRegistry([clientCatalog()]),
    });
    const surfaceId = 'late-1';
    const started = barrier();
    let opened = false;
    const setupRunId = '1a7e0000-0000-4000-8000-000000000001';
    const actionRunId = '1a7e0000-0000-4000-8000-000000000002';
    const transport: client.SessionTransport = {
      async open() {
        if (!opened) {
          opened = true;
          return { runIdHeader: setupRunId, frames: framesOf(formRun(setupRunId, surfaceId)) };
        }
        return {
          runIdHeader: actionRunId,
          frames: (async function* () {
            yield startF(actionRunId, surfaceId);
            started.resolve();
            await release.promise;
            yield doneF(actionRunId, surfaceId, 2);
          })(),
        };
      },
    };
    const session = client.createClientSession({
      runtime,
      catalogHashes: new Map([[CLIENT_CATALOG_ID, CLIENT_HASH]]),
      transport,
      endpoints: { generate: '/g', event: '/e' },
    });
    assert.equal((await session.generate({ catalogId: CLIENT_CATALOG_ID })).status, 'committed');
    const pending = session.action(save(surfaceId));
    // start 已消费后取消；release 后晚到 done 不得覆盖取消结论。
    await started.promise;
    session.cancel('用户取消');
    release.resolve();
    const result = await pending;
    assert.equal(result.status, 'desync');
    const status = session.getSurface(surfaceId);
    assert.equal(status?.baseline?.surfaceRevision, 1, '晚到 done 不推进基准');
    assert.equal(status?.actionOpen, false, '请求可能已提交，取消不能证明旧基准仍有效');
  });

  it('已发送、未收到帧时取消 → desync，草稿保留（发送不确定性）', async () => {
    const sent = barrier();
    const runtime = new core.A2UIRuntime({
      catalogRegistry: new core.CatalogRegistry([clientCatalog()]),
    });
    const queue = buildQueue();
    const surfaceId = 'sent-1';
    const setupRunId = '53nt0000-0000-4000-8000-000000000001';
    const actionRunId = '53nt0000-0000-4000-8000-000000000002';
    queue.pushEntry({ runId: setupRunId, frames: formRun(setupRunId, surfaceId) });
    const base = scripted({ queue });
    let opened = 0;
    const transport: client.SessionTransport = {
      async open(request) {
        opened += 1;
        if (opened === 1) return base.open(request);
        const frames = hangingFrames(request);
        sent.resolve();
        return { runIdHeader: actionRunId, frames };
      },
    };
    const session = client.createClientSession({
      runtime,
      catalogHashes: new Map([[CLIENT_CATALOG_ID, CLIENT_HASH]]),
      transport,
      endpoints: { generate: '/g', event: '/e' },
    });
    assert.equal((await session.generate({ catalogId: CLIENT_CATALOG_ID })).status, 'committed');
    assert.equal(runtime.setInputValue('field', surfaceId, 'value', 'draft'), true);
    const drafts = runtime.extractLatestInputDrafts(surfaceId);
    const pending = session.action(save(surfaceId));
    await sent.promise;
    session.cancel('用户取消');
    assert.equal((await pending).status, 'desync', '请求已送达但结果未知，按失同步收敛');
    assert.equal(session.getSurface(surfaceId)?.actionOpen, false);
    assert.deepEqual(runtime.extractLatestInputDrafts(surfaceId), drafts, '发送不确定性不确认草稿');
  });

  it('busy 订阅内同步 cancel：请求不出网、未发送基准保留', async () => {
    const runtime = new core.A2UIRuntime({
      catalogRegistry: new core.CatalogRegistry([clientCatalog()]),
    });
    const queue = buildQueue();
    const surfaceId = 'sync-1';
    const setupRunId = '5ync0000-0000-4000-8000-000000000001';
    queue.pushEntry({ runId: setupRunId, frames: formRun(setupRunId, surfaceId) });
    const counted = openCounting(queue);
    const session = client.createClientSession({
      runtime,
      catalogHashes: new Map([[CLIENT_CATALOG_ID, CLIENT_HASH]]),
      transport: counted.transport,
      endpoints: { generate: '/g', event: '/e' },
    });
    assert.equal((await session.generate({ catalogId: CLIENT_CATALOG_ID })).status, 'committed');
    session.subscribe(() => {
      if (session.getSurface(surfaceId)?.busy) session.cancel();
    });
    assert.equal((await session.action(save(surfaceId))).status, 'canceled');
    assert.equal(counted.opens(), 1, '同步取消发生在 transport.open 之前');
    assert.equal(session.getSurface(surfaceId)?.actionOpen, true, '确定未发送可保留基准');
  });
});

describe('S4.1.4 · 非法 done revision（构建入口）', () => {
  for (const [label, startRevision, doneRevision] of [
    ['等于 start 与本地基准', 2, 2],
    ['省略 start revision、等于本地基准', undefined, 2],
    ['省略 start revision、倒退本地基准', undefined, 1],
    ['推进旧 start、未推进本地基准', 1, 2],
  ] as const) {
    it(`${label}：候选、草稿与固定提交均不提升`, async () => {
      const surfaceId = 'bad-revision';
      const runtime = new core.A2UIRuntime({
        catalogRegistry: new core.CatalogRegistry([clientCatalog()]),
      });
      const queue = buildQueue();
      queue.pushEntry({ runId: 'revision-setup', frames: formRun('revision-setup', surfaceId) });
      queue.pushEntry({
        runId: 'revision-good',
        frames: [
          startF('revision-good', surfaceId, { revision: 1 }),
          doneF('revision-good', surfaceId, 2),
        ],
      });
      queue.pushEntry({
        runId: 'revision-bad',
        frames: [
          startF('revision-bad', surfaceId, { revision: startRevision }),
          sse('message', {
            version: 'v0.9',
            updateDataModel: { surfaceId, value: { name: 'must-not-publish' } },
          }),
          doneF('revision-bad', surfaceId, doneRevision),
        ],
      });
      const session = client.createClientSession({
        runtime,
        catalogHashes: new Map([[CLIENT_CATALOG_ID, CLIENT_HASH]]),
        transport: scripted({ queue }),
        endpoints: { generate: '/g', event: '/e' },
      });
      assert.equal((await session.generate({ catalogId: CLIENT_CATALOG_ID })).status, 'committed');
      assert.equal(
        (await session.action(save(surfaceId))).status,
        'committed',
        '同路径先证明 revision 合法前进可提交',
      );
      assert.equal(runtime.setInputValue('field', surfaceId, 'value', 'keep-draft'), true);
      const view = runtime.getSurfaceView(surfaceId),
        drafts = runtime.extractLatestInputDrafts(surfaceId),
        fixed = session.getCommittedSurface(surfaceId);
      const result = await session.action(save(surfaceId));
      assert.equal(result.status, 'desync');
      if (result.status === 'desync') assert.match(result.reason, /revision/);
      assert.equal(runtime.getSurfaceView(surfaceId), view);
      assert.deepEqual(runtime.extractLatestInputDrafts(surfaceId), drafts);
      assert.equal(session.getCommittedSurface(surfaceId), fixed);
      assert.equal(session.getSurface(surfaceId)?.baseline?.surfaceRevision, 2);
      assert.equal(session.getSurface(surfaceId)?.actionOpen, false);
      assert.equal(session.getSurface(surfaceId)?.preview, null);
    });
  }
});

describe('S4.1.4 · 响应释放与在途销毁（构建入口）', () => {
  for (const ending of ['done', 'missing-done', 'invalid-done', 'missing-header'] as const) {
    it(`${ending} 结束时调用实际 response.close 一次`, async () => {
      const surfaceId = 'close-view',
        runId = 'close-run';
      const frames = [startF(runId, surfaceId), ...formMessages(surfaceId)];
      if (ending !== 'missing-done')
        frames.push(
          doneF(
            runId,
            surfaceId,
            1,
            ending === 'invalid-done' ? { overrides: { runId: 'wrong-run' } } : {},
          ),
        );
      let closes = 0,
        consumed = 0;
      const session = client.createClientSession({
        runtimeOptions: { catalogRegistry: new core.CatalogRegistry([clientCatalog()]) },
        catalogHashes: new Map([[CLIENT_CATALOG_ID, CLIENT_HASH]]),
        endpoints: { generate: '/g', event: '/e' },
        transport: {
          async open() {
            return {
              runIdHeader: ending === 'missing-header' ? null : runId,
              frames: (async function* () {
                for (const frame of frames) {
                  consumed++;
                  yield frame;
                }
              })(),
              close() {
                closes++;
              },
            };
          },
        },
      });
      const result = await session.generate({ catalogId: CLIENT_CATALOG_ID });
      assert.equal(result.status, ending === 'done' ? 'committed' : 'desync');
      assert.equal(consumed, ending === 'missing-header' ? 0 : frames.length);
      assert.equal(closes, 1, '包括未开始消费帧的拒绝也必须释放响应');
      session.dispose();
      session.dispose();
      assert.equal(closes, 1);
    });
  }

  it('busy 订阅内同步 dispose：运行入口已登记，动作不发送且不复活', async () => {
    const surfaceId = 'sync-dispose';
    const queue = buildQueue();
    queue.pushEntry({ runId: 'dispose-setup', frames: formRun('dispose-setup', surfaceId) });
    const counted = openCounting(queue);
    const session = client.createClientSession({
      runtimeOptions: { catalogRegistry: new core.CatalogRegistry([clientCatalog()]) },
      catalogHashes: new Map([[CLIENT_CATALOG_ID, CLIENT_HASH]]),
      transport: counted.transport,
      endpoints: { generate: '/g', event: '/e' },
    });
    assert.equal((await session.generate({ catalogId: CLIENT_CATALOG_ID })).status, 'committed');
    let notifications = 0;
    const off = session.subscribe(() => {
      notifications++;
      if (session.getSurface(surfaceId)?.busy) session.dispose();
    });
    assert.equal((await session.action(save(surfaceId))).status, 'canceled');
    assert.equal(counted.opens(), 1);
    assert.equal(notifications, 1, '销毁后不再通知');
    assert.equal(session.disposed, true);
    assert.deepEqual(session.surfaces(), []);
    assert.equal(session.runtime.getSurfaceView(surfaceId), undefined, '自建 runtime 视图清理');
    await assert.rejects(() => session.action(save(surfaceId)), /已销毁/);
    session.dispose();
    off();
    off();
  });

  for (const phase of ['opening', 'reading'] as const) {
    it(
      `${phase} 时 dispose：abort 真实请求、关闭响应且晚到 patch 不写入`,
      { timeout: 2000 },
      async (t) => {
        const surfaceId = 'in-flight-dispose',
          entered = barrier(),
          release = barrier();
        t.after(() => release.resolve());
        const runtime = new core.A2UIRuntime({
          catalogRegistry: new core.CatalogRegistry([clientCatalog()]),
        });
        let candidate: core.A2UIRuntime | undefined;
        const createCandidate = runtime.createViewRuntime.bind(runtime);
        // 只观测公开工厂返回的候选，不触碰私有运行上下文。
        runtime.createViewRuntime = () => {
          candidate = createCandidate();
          return candidate;
        };
        const queue = buildQueue();
        queue.pushEntry({ runId: 'dispose-setup', frames: formRun('dispose-setup', surfaceId) });
        const base = scripted({ queue });
        let signal: AbortSignal | undefined,
          closes = 0,
          lateYielded = false;
        const transport: client.SessionTransport = {
          async open(request) {
            if (request.url === '/g') return base.open(request);
            signal = request.signal;
            if (phase === 'opening') {
              entered.resolve();
              await release.promise;
            }
            return {
              runIdHeader: 'dispose-action',
              close() {
                closes++;
              },
              frames: (async function* () {
                yield startF('dispose-action', surfaceId, { revision: 1 });
                if (phase === 'reading') {
                  yield sse('message', {
                    version: 'v0.9',
                    updateDataModel: { surfaceId, path: '/candidate', value: true },
                  });
                  entered.resolve();
                  await release.promise;
                }
                lateYielded = true;
                yield sse('message', {
                  version: 'v0.9',
                  updateDataModel: { surfaceId, path: '/late', value: true },
                });
                yield doneF('dispose-action', surfaceId, 2);
              })(),
            };
          },
        };
        const session = client.createClientSession({
          runtime,
          catalogHashes: new Map([[CLIENT_CATALOG_ID, CLIENT_HASH]]),
          transport,
          endpoints: { generate: '/g', event: '/e' },
        });
        assert.equal(
          (await session.generate({ catalogId: CLIENT_CATALOG_ID })).status,
          'committed',
        );
        runtime.setInputValue('field', surfaceId, 'value', 'draft');
        let notifications = 0;
        const off = session.subscribe(() => notifications++);
        const pending = session.action(save(surfaceId));
        await entered.promise;
        assert.equal(signal?.aborted, false);
        const candidateBefore = candidate!.getSurfaceView(surfaceId);
        if (phase === 'reading')
          assert.equal(
            core.getByPath(candidateBefore!.dataModel, '/candidate'),
            true,
            '已实际消费第一条候选 patch',
          );
        const view = runtime.getSurfaceView(surfaceId),
          drafts = runtime.extractLatestInputDrafts(surfaceId);
        session.dispose();
        const count = notifications;
        assert.equal(signal?.aborted, true, '销毁须立即触发底层取消');
        release.resolve();
        assert.equal((await pending).status, 'desync');
        assert.equal(closes, 1);
        assert.equal(
          lateYielded,
          phase === 'reading',
          '建连晚到不消费，读流晚到确实交付一条 patch',
        );
        assert.equal(candidate!.getSurfaceView(surfaceId), candidateBefore, '晚到帧不得写入候选');
        assert.equal(runtime.getSurfaceView(surfaceId), view, '外部 runtime 保留原视图');
        assert.deepEqual(runtime.extractLatestInputDrafts(surfaceId), drafts);
        assert.equal(notifications, count);
        assert.deepEqual(session.surfaces(), []);
        assert.equal(session.getCommittedSurface(surfaceId), undefined);
        session.dispose();
        off();
        off();
        assert.equal(closes, 1);
      },
    );
  }

  it('默认 fetch/SSE 在 dispose 后实际 cancel reader 并结束运行', { timeout: 2000 }, async () => {
    const surfaceId = 'reader-dispose',
      ready = barrier();
    const queue = buildQueue();
    queue.pushEntry({ runId: 'reader-setup', frames: formRun('reader-setup', surfaceId) });
    const base = scripted({ queue });
    let cancels = 0,
      fetchSignal: AbortSignal | null | undefined;
    const transport = client.fetchSseTransport({
      fetch: async (_url, init) => {
        fetchSignal = init?.signal;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              const frames = [
                startF('reader-action', surfaceId, { revision: 1 }),
                sse('message', {
                  version: 'v0.9',
                  updateDataModel: { surfaceId, path: '/streamed', value: true },
                }),
              ];
              controller.enqueue(
                new TextEncoder().encode(
                  frames.map((frame) => `event: ${frame.event}\ndata: ${frame.data}\n\n`).join(''),
                ),
              );
            },
            cancel() {
              cancels++;
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream', 'X-Nexus-Run-Id': 'reader-action' } },
        );
      },
    });
    const session = client.createClientSession({
      runtimeOptions: { catalogRegistry: new core.CatalogRegistry([clientCatalog()]) },
      catalogHashes: new Map([[CLIENT_CATALOG_ID, CLIENT_HASH]]),
      endpoints: { generate: '/g', event: '/e' },
      transport: {
        open: (request) => (request.url === '/g' ? base.open(request) : transport.open(request)),
      },
    });
    assert.equal((await session.generate({ catalogId: CLIENT_CATALOG_ID })).status, 'committed');
    const off = session.subscribe(() => {
      if (core.getByPath(session.getSurface(surfaceId)?.preview?.dataModel, '/streamed') === true)
        ready.resolve();
    });
    const pending = session.action(save(surfaceId));
    await ready.promise;
    session.dispose();
    assert.equal((await pending).status, 'desync');
    assert.equal(fetchSignal?.aborted, true);
    assert.equal(cancels, 1, '底层响应流的 cancel 被实际调用');
    assert.equal(session.runtime.getSurfaceView(surfaceId), undefined);
    off();
    session.dispose();
    assert.equal(cancels, 1);
  });
});

describe('S4.1.4 · stale-revision oracle 与非法恢复（构建入口）', () => {
  it('reject-admission-stale-revision oracle：准入拒绝关闭旧基准动作资格，旧基准不能重发', async () => {
    const oracle = loadOracle('reject-admission-stale-revision');
    const surfaceId = createdSurfaceId(oracle.setup!.surface.messages);
    const runtime = new core.A2UIRuntime({
      catalogRegistry: new core.CatalogRegistry([structuredClone(fixtureCatalog)]),
    });
    const queue = buildQueue();
    const setupRunId = '57a1e000-0000-4000-8000-000000000001';
    const actionRunId = '57a1e000-0000-4000-8000-000000000002';
    queue.pushEntry({
      runId: setupRunId,
      frames: [
        startF(setupRunId, surfaceId, { catalogId: FIXTURE_CATALOG_ID, hash: fixtureHash }),
        ...oracle.setup!.surface.messages.map((message) => sse('message', message)),
        doneF(setupRunId, surfaceId, 1, { catalogId: FIXTURE_CATALOG_ID, hash: fixtureHash }),
      ],
    });
    // oracle 场景：其他提交先推进权威 revision，本请求携带旧基准 → 服务器准入拒绝。
    // 客户端可见契约：RUN_ADMISSION_REJECTED/notCommitted → desync，动作资格关闭。
    const baseRevision = oracle.request.action!.nexus.surfaceRevision;
    const authoritativeRevision =
      baseRevision + oracle.steps!.filter((step) => step.interleave === 'generation-B').length;
    queue.pushEntry({
      runId: actionRunId,
      frames: [
        startF(actionRunId, surfaceId, {
          catalogId: FIXTURE_CATALOG_ID,
          hash: fixtureHash,
          revision: authoritativeRevision,
        }),
        sse('error', {
          sessionVersion: 1,
          runId: actionRunId,
          surfaceId,
          code: 'RUN_ADMISSION_REJECTED',
          commitState: 'notCommitted',
        }),
      ],
    });
    const requests: TransportRequest[] = [],
      observed: SseFrame[] = [];
    const base = scripted({ queue, requests, observed });
    let opens = 0;
    const transport: client.SessionTransport = {
      async open(request) {
        opens++;
        return base.open(request);
      },
    };
    const session = client.createClientSession({
      runtime,
      catalogHashes: new Map([[FIXTURE_CATALOG_ID, fixtureHash]]),
      transport,
      endpoints: { generate: '/g', event: '/e' },
    });
    assert.equal((await session.generate({ catalogId: FIXTURE_CATALOG_ID })).status, 'committed');
    observed.length = 0;
    const result = await session.action({
      surfaceId,
      name: oracle.request.action!.message.action.name,
      sourceComponentId: oracle.request.action!.message.action.sourceComponentId,
      actionId: oracle.request.action!.nexus.actionId,
    });
    assertOracleEvents(observed, oracle);
    assertOracleResult(result, oracle);
    assert.equal(authoritativeRevision, oracle.expected.surfaceRevisionAfter);
    assert.equal((requests[1].body as ActionBody).nexus.surfaceRevision, baseRevision);
    assert.equal(
      session.getSurface(surfaceId)?.baseline?.surfaceRevision,
      baseRevision,
      '权威新版本不能借给旧视图',
    );
    assert.equal(result.status, 'desync', '准入拒绝：声明基准已过期，不能作为可信未提交事实');
    assert.equal(session.getSurface(surfaceId)?.actionOpen, false);
    assert.equal(opens, 2);
    assert.equal(
      (
        await session.action({
          surfaceId,
          name: oracle.request.action!.message.action.name,
          sourceComponentId: oracle.request.action!.message.action.sourceComponentId,
        })
      ).status,
      'desync',
      '旧基准不能再次发送',
    );
    assert.equal(opens, 2, '重试被入口门控，不出网');
  });

  it('非法恢复：过期/身份错配/篡改/超预算被拒，视图、基准与草稿不变', async () => {
    const runtime = new core.A2UIRuntime({
      catalogRegistry: new core.CatalogRegistry([clientCatalog()]),
      maxDataModelBytes: 80,
    });
    const queue = buildQueue();
    const surfaceId = 'rec-reject';
    const setupRunId = 'r3c0e000-0000-4000-8000-000000000001';
    const actionRunId = 'r3c0e000-0000-4000-8000-000000000002';
    queue.pushEntry({ runId: setupRunId, frames: formRun(setupRunId, surfaceId) });
    // done-only action：无视图变更的合法提交推进 revision。
    queue.pushEntry({
      runId: actionRunId,
      frames: [startF(actionRunId, surfaceId), doneF(actionRunId, surfaceId, 2)],
    });
    const session = client.createClientSession({
      runtime,
      catalogHashes: new Map([[CLIENT_CATALOG_ID, CLIENT_HASH]]),
      transport: scripted({ queue }),
      endpoints: { generate: '/g', event: '/e' },
    });
    assert.equal((await session.generate({ catalogId: CLIENT_CATALOG_ID })).status, 'committed');
    const stale = session.getCommittedSurface(surfaceId)!;
    assert.equal((await session.action(save(surfaceId))).status, 'committed');
    const current = session.getCommittedSurface(surfaceId)!;
    assert.notEqual(stale, current, '两次固定提交是不同代次');
    assert.equal(runtime.setInputValue('field', surfaceId, 'value', 'keep'), true);
    const viewBefore = runtime.getSurfaceView(surfaceId);
    const draftsBefore = runtime.extractLatestInputDrafts(surfaceId);
    const expectUnchanged = () => {
      assert.equal(runtime.getSurfaceView(surfaceId), viewBefore, '恢复拒绝不动视图引用');
      assert.deepEqual(runtime.extractLatestInputDrafts(surfaceId), draftsBefore, '草稿不变');
      assert.equal(session.getCommittedSurface(surfaceId), current, '固定提交不变');
      assert.equal(session.getSurface(surfaceId)?.baseline?.surfaceRevision, 2, '基准不变');
    };
    // 过期：revision 1 的旧提交。
    assert.throws(() => session.recover(stale), /过期|冲突/);
    expectUnchanged();
    // 同版本身份冲突：篡改 runId。
    assert.throws(
      () => session.recover({ ...current, commit: { ...current.commit, runId: setupRunId } }),
      /过期|冲突/,
    );
    expectUnchanged();
    // 同版本内容冲突：篡改视图。
    assert.throws(
      () =>
        session.recover({ ...current, view: { ...current.view, dataModel: { name: 'forged' } } }),
      /过期|冲突/,
    );
    expectUnchanged();
    // 超预算：前进 revision 携带超大视图，核心完整重验按字节上限整体拒绝。
    assert.throws(
      () =>
        session.recover({
          ...current,
          commit: { ...current.commit, surfaceRevision: 3 },
          view: { ...current.view, dataModel: { name: 'x'.repeat(200) } },
        }),
      /字节超过上限/,
    );
    expectUnchanged();
    // 合法恢复一次到位，重新开启动作出口。
    assert.equal(session.recover(current).status, 'committed');
    assert.equal(session.getSurface(surfaceId)?.actionOpen, true);
  });
});

describe('S4.1.4 · 稳定快照与按 surface 订阅（构建入口）', () => {
  it('状态未变时快照引用稳定；按 surface 通知隔离、解除幂等', async () => {
    const runtime = new core.A2UIRuntime({
      catalogRegistry: new core.CatalogRegistry([clientCatalog()]),
    });
    const queue = buildQueue();
    const surfaceA = 'snap-a';
    const surfaceB = 'snap-b';
    const ids = [surfaceA, surfaceB];
    for (const [index, surfaceId] of ids.entries()) {
      const runId = `5nap0000-0000-4000-8000-00000000000${index + 1}`;
      queue.pushEntry({ runId, frames: formRun(runId, surfaceId) });
    }
    const actionRunB = '5nap0000-0000-4000-8000-000000000003';
    const actionRunA = '5nap0000-0000-4000-8000-000000000004';
    queue.pushEntry({
      runId: actionRunB,
      frames: [
        startF(actionRunB, surfaceB, { revision: 1 }),
        sse('message', {
          version: 'v0.9',
          updateDataModel: { surfaceId: surfaceB, path: '/name', value: 'B-updated' },
        }),
        doneF(actionRunB, surfaceB, 2),
      ],
    });
    queue.pushEntry({
      runId: actionRunA,
      frames: [startF(actionRunA, surfaceA), doneF(actionRunA, surfaceA, 2)],
    });
    const session = client.createClientSession({
      runtime,
      catalogHashes: new Map([[CLIENT_CATALOG_ID, CLIENT_HASH]]),
      transport: scripted({ queue }),
      endpoints: { generate: '/g', event: '/e' },
    });
    assert.equal((await session.generate({ catalogId: CLIENT_CATALOG_ID })).status, 'committed');
    assert.equal((await session.generate({ catalogId: CLIENT_CATALOG_ID })).status, 'committed');
    const viewA = runtime.getSurfaceView(surfaceA);
    const before = session.getSurface(surfaceA);
    assert.ok(before);
    assert.equal(session.getSurface(surfaceA), before, '状态未变时快照引用稳定');

    let called = 0;
    const off = session.subscribeSurface(surfaceA, () => {
      called += 1;
    });
    // surface B 的运行不通知 A 的订阅，也不替换 A 的快照。
    assert.equal((await session.action(save(surfaceB))).status, 'committed');
    assert.equal(called, 0, '按 surface 隔离通知');
    assert.equal(runtime.getSurfaceView(surfaceA), viewA, 'B 的实际模型 patch 不改变 A');
    assert.equal(core.getByPath(runtime.getSurfaceView(surfaceB)!.dataModel, '/name'), 'B-updated');
    assert.equal(session.getSurface(surfaceA), before, 'B 更新不影响 A 快照');

    // A 自身更新：通知且快照换代。
    assert.equal((await session.action(save(surfaceA))).status, 'committed');
    assert.ok(called > 0, 'A 更新通知 A 订阅');
    assert.notEqual(session.getSurface(surfaceA), before, '更新后快照换代');

    // 解除幂等；身份未变的恢复不重复通知。
    off();
    off();
    const count = called;
    assert.equal(session.recover(session.getCommittedSurface(surfaceA)!).status, 'committed');
    assert.equal(called, count, '身份与门控未变不重复通知');
    session.dispose();
    off(); // dispose 后解除仍安全。
  });
});
