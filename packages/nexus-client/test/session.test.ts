import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  A2UIRuntime,
  CatalogRegistry,
  standardCatalogComponentDeclarations,
  type CatalogDefinition,
} from '@nexus-ui/core';
import { createClientSession } from '../src/session';
import { fetchSseTransport } from '../src/transport/fetch-sse';
import type { SessionTransport, SseFrame, TransportRequest } from '../src/transport';

/**
 * S4.1 会话状态机 headless 对测（SPEC §7；语义抽取自两个参考浏览器 S2.6.3）：
 * 响应头权威 runId 关联、done 身份/hash/revision 门控、生成视图归属校验、
 * 终态后事件拒绝、EOF 不成功（desync）、unknown 失同步、取消/晚到、草稿
 * extract/confirm、双 surface 隔离、订阅与释放。全部使用假 transport 与契约
 * fixture，不依赖 React/网络。
 */

const CATALOG_ID = 'https://example.com/catalogs/client-test/v1';
const HASH = 'sha256:' + 'a'.repeat(64);

function catalog(): CatalogDefinition {
  return {
    catalogId: CATALOG_ID,
    components: {
      ...standardCatalogComponentDeclarations(),
      // 可写 Text：inputs 声明 text 属性值域（setInputValue 门控需要）。
      Text: {
        ...standardCatalogComponentDeclarations().Text,
        inputs: { text: { type: 'string', maxLength: 200 } },
      },
    },
    actions: [
      {
        name: 'submit',
        sources: ['Button'],
        paramSchema: { type: 'object', additionalProperties: false, properties: {} },
      },
    ],
  };
}

function surfaceMessages(surfaceId: string): unknown[] {
  return [
    {
      version: 'v0.9',
      createSurface: { surfaceId, catalogId: CATALOG_ID },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Column', children: ['confirm'] },
          {
            id: 'confirm',
            component: 'Button',
            child: 'label',
            action: { event: { name: 'submit', context: {} } },
          },
          { id: 'label', component: 'Text', text: { path: '/note' } },
        ],
      },
    },
    { version: 'v0.9', updateDataModel: { surfaceId, value: { note: 'v1' } } },
  ];
}

/** 把 `{ event, data: object }` 转成传输帧（只序列化一次）。 */
function framesOf(list: Array<{ event: string; data: unknown }>): SseFrame[] {
  return list.map((f, index) => ({
    event: f.event,
    data: JSON.stringify(f.data),
    id: `run:${index}`,
  }));
}

function startFrame(
  runId: string,
  surfaceId: string,
): { event: string; data: Record<string, unknown> } {
  return {
    event: 'start',
    data: {
      type: 'start',
      sessionVersion: 1,
      runId,
      surfaceId,
      catalogId: CATALOG_ID,
      contractVersion: 2,
      catalogHash: HASH,
    },
  };
}

function doneFrame(
  runId: string,
  surfaceId: string,
  surfaceRevision: number,
  overrides: Record<string, unknown> = {},
): { event: string; data: Record<string, unknown> } {
  return {
    event: 'done',
    data: {
      sessionVersion: 1,
      runId,
      surfaceId,
      catalogId: CATALOG_ID,
      contractVersion: 2,
      catalogHash: HASH,
      surfaceRevision,
      ...overrides,
    },
  };
}

function messageFrames(surfaceId: string): Array<{ event: string; data: unknown }> {
  return surfaceMessages(surfaceId).map((message) => ({ event: 'message', data: message }));
}

/** 一次完整成功的生成流。 */
function happyRun(runId: string, surfaceId: string): SseFrame[] {
  return framesOf([
    startFrame(runId, surfaceId),
    ...messageFrames(surfaceId),
    doneFrame(runId, surfaceId, 1),
  ]);
}

interface ScriptEntry {
  runId: string | null;
  frames?: SseFrame[];
  /** 自定义帧序列（取消/晚到等时序用例），优先于 frames。 */
  makeFrames?: (request: TransportRequest) => AsyncIterable<SseFrame>;
}

interface ScriptedTransport {
  transport: SessionTransport;
  requests: TransportRequest[];
  queue: ScriptEntry[];
}

function abortError(): Error {
  return new DOMException('aborted', 'AbortError');
}

function scriptedTransport(script: ScriptEntry[]): ScriptedTransport {
  const requests: TransportRequest[] = [];
  const queue = [...script];
  const transport: SessionTransport = {
    async open(request: TransportRequest) {
      requests.push(request);
      const next = queue.shift();
      if (!next) throw new Error('script exhausted');
      const frames =
        next.makeFrames !== undefined
          ? next.makeFrames(request)
          : (async function* () {
              for (const frame of next.frames ?? []) {
                await Promise.resolve();
                yield frame;
              }
            })();
      return { runIdHeader: next.runId, frames };
    },
  };
  return { transport, requests, queue };
}

/** 挂起的帧序列：收到 abort 时拒绝，模拟真实连接被取消。 */
function hangingFrames(request: TransportRequest): AsyncIterable<SseFrame> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise<IteratorResult<SseFrame>>((_resolve, reject) => {
          if (request.signal?.aborted) reject(abortError());
          else
            request.signal?.addEventListener('abort', () => reject(abortError()), { once: true });
        }),
    }),
  };
}

interface SessionHarness {
  session: ReturnType<typeof createClientSession>;
  runtime: A2UIRuntime;
  registry: CatalogRegistry;
}

function makeSession(
  transport: SessionTransport,
  overrides: Record<string, unknown> = {},
): SessionHarness {
  const registry = new CatalogRegistry([catalog()]);
  const runtime = new A2UIRuntime({ catalogRegistry: registry });
  const session = createClientSession({
    runtime,
    catalogHashes: new Map([[CATALOG_ID, HASH]]),
    transport,
    endpoints: { generate: '/api/a2ui/generate', event: '/api/a2ui/event' },
    ...overrides,
  });
  return { session, runtime, registry };
}

const R1 = '11111111-1111-4111-8111-111111111111';
const R2 = '22222222-2222-4222-8222-222222222222';

describe('S4.1 · 正常生成与 action', () => {
  it('生成：start/message/done → committed，surface ready、baseline 固定、root 存在', async () => {
    const t = scriptedTransport([{ runId: R1, frames: happyRun(R1, 'gen-1') }]);
    const { session, runtime } = makeSession(t.transport);
    const result = await session.generate({ catalogId: CATALOG_ID });
    assert.ok(result.status === 'committed');
    assert.equal(result.surfaceId, 'gen-1');
    assert.equal(result.commit.runId, R1);
    const status = session.getSurface('gen-1');
    assert.ok(status);
    assert.equal(status.phase, 'ready');
    assert.equal(status.actionOpen, true);
    assert.equal(status.busy, false);
    assert.equal(status.baseline?.surfaceRevision, 1);
    assert.ok(runtime.store.getState().componentsBySurface['gen-1']?.root);
    assert.equal(t.requests[0].url, '/api/a2ui/generate');
    assert.deepEqual((t.requests[0].body as { catalogId: string }).catalogId, CATALOG_ID);
  });

  it('action：基准 revision 前进门控、nexus 组装、草稿随请求发送并在成功后确认', async () => {
    const t = scriptedTransport([
      { runId: R1, frames: happyRun(R1, 'act-1') },
      { runId: R2, frames: framesOf([startFrame(R2, 'act-1'), doneFrame(R2, 'act-1', 2)]) },
    ]);
    const { session, runtime } = makeSession(t.transport);
    const setup = await session.generate({ catalogId: CATALOG_ID });
    assert.ok(setup.status === 'committed');

    // 本地输入写回产生草稿（catalog registry 已注入，inputs 声明来自 Text）。
    assert.equal(runtime.setInputValue('label', 'act-1', 'text', '本地新值'), true);
    assert.ok(runtime.getLatestInputs('act-1').length > 0, '草稿已记录');

    const result = await session.action({
      surfaceId: 'act-1',
      name: 'submit',
      sourceComponentId: 'confirm',
    });
    assert.equal(result.status, 'committed');
    const body = t.requests[1].body as {
      message: { action: { actionId: string } };
      nexus: { surfaceRevision: number; catalogHash: string; inputs: unknown[]; actionId: string };
    };
    assert.equal(body.nexus.surfaceRevision, 1, '基准 revision 随 nexus 发送');
    assert.equal(body.nexus.catalogHash, HASH);
    // envelope 契约：surfaceRevision 只在 nexus，message.action 不携带（未知键拒绝）。
    assert.equal(body.message.action.actionId, body.nexus.actionId);
    assert.ok(body.nexus.inputs.length > 0, '草稿作为 inputs 发送');
    // 成功后草稿已确认：旧代次条目被清除。
    assert.equal(runtime.getLatestInputs('act-1').length, 0);
    const status = session.getSurface('act-1');
    assert.equal(status?.baseline?.surfaceRevision, 2);
    assert.equal(status?.actionOpen, true);
  });
});

describe('S4.1 · 失败分级（failed / desync）', () => {
  async function setupReady(t: ScriptedTransport): Promise<SessionHarness> {
    const harness = makeSession(t.transport);
    t.queue.unshift({ runId: R1, frames: happyRun(R1, 'ready-1') });
    const setup = await harness.session.generate({ catalogId: CATALOG_ID });
    assert.ok(setup.status === 'committed');
    return harness;
  }

  it('明确 notCommitted 且基准仍可信 → failed；旧视图与门控保留', async () => {
    const t = scriptedTransport([]);
    const harness = await setupReady(t);
    t.queue.push({
      runId: R2,
      frames: framesOf([
        startFrame(R2, 'ready-1'),
        {
          event: 'error',
          data: {
            sessionVersion: 1,
            runId: R2,
            surfaceId: 'ready-1',
            code: 'RUN_FAILED',
            commitState: 'notCommitted',
            message: '执行前确定失败',
          },
        },
      ]),
    });
    const result = await harness.session.action({
      surfaceId: 'ready-1',
      name: 'submit',
      sourceComponentId: 'confirm',
    });
    assert.equal(result.status, 'failed');
    assert.match((result as { reason: string }).reason, /执行前确定失败/);
    const status = harness.session.getSurface('ready-1');
    assert.equal(status?.phase, 'ready', '旧已提交视图保留');
    assert.equal(status?.actionOpen, true, '旧基准仍可继续 action');
  });

  it('error 帧 commitState unknown → desync 禁 action', async () => {
    const t = scriptedTransport([]);
    const harness = await setupReady(t);
    t.queue.push({
      runId: R2,
      frames: framesOf([
        startFrame(R2, 'ready-1'),
        {
          event: 'error',
          data: {
            sessionVersion: 1,
            runId: R2,
            surfaceId: 'ready-1',
            code: 'RUN_COMMIT_UNKNOWN',
            commitState: 'unknown',
          },
        },
      ]),
    });
    const result = await harness.session.action({
      surfaceId: 'ready-1',
      name: 'submit',
      sourceComponentId: 'confirm',
    });
    assert.equal(result.status, 'desync');
    const status = harness.session.getSurface('ready-1');
    assert.equal(status?.phase, 'desync');
    assert.equal(status?.actionOpen, false);
  });

  it('EOF 无终态 → desync（EOF 不等于成功）', async () => {
    const t = scriptedTransport([]);
    const harness = await setupReady(t);
    t.queue.push({ runId: R2, frames: framesOf([startFrame(R2, 'ready-1')]) });
    const result = await harness.session.action({
      surfaceId: 'ready-1',
      name: 'submit',
      sourceComponentId: 'confirm',
    });
    assert.equal(result.status, 'desync');
    assert.equal(harness.session.getSurface('ready-1')?.actionOpen, false);
  });

  it('终态后收到额外事件 → desync 且动作出口关闭（提交状态不可知）', async () => {
    const t = scriptedTransport([]);
    const harness = await setupReady(t);
    t.queue.push({
      runId: R2,
      frames: framesOf([
        startFrame(R2, 'ready-1'),
        doneFrame(R2, 'ready-1', 2),
        {
          event: 'message',
          data: { version: 'v0.9', updateDataModel: { surfaceId: 'ready-1', value: {} } },
        },
      ]),
    });
    const result = await harness.session.action({
      surfaceId: 'ready-1',
      name: 'submit',
      sourceComponentId: 'confirm',
    });
    assert.equal(result.status, 'desync');
    assert.match((result as { reason: string }).reason, /终态|流序/);
    const status = harness.session.getSurface('ready-1');
    assert.equal(status?.phase, 'desync', '无效流不采信 done，且不能继续 action');
    assert.equal(status?.actionOpen, false);
    assert.equal(status?.baseline?.surfaceRevision, 1, '基准不被未采信的 done 推进');
  });

  it('候选 patch 后明确 notCommitted：丢弃候选，保留原视图与动作资格', async () => {
    const t = scriptedTransport([]);
    const harness = await setupReady(t);
    t.queue.push({
      runId: R2,
      frames: framesOf([
        startFrame(R2, 'ready-1'),
        {
          event: 'message',
          data: {
            version: 'v0.9',
            updateDataModel: { surfaceId: 'ready-1', value: { note: 'x' } },
          },
        },
        {
          event: 'error',
          data: {
            sessionVersion: 1,
            runId: R2,
            surfaceId: 'ready-1',
            code: 'RUN_FAILED',
            commitState: 'notCommitted',
          },
        },
      ]),
    });
    const result = await harness.session.action({
      surfaceId: 'ready-1',
      name: 'submit',
      sourceComponentId: 'confirm',
    });
    assert.equal(result.status, 'failed');
    assert.equal(harness.session.getSurface('ready-1')?.actionOpen, true);
    assert.deepEqual(harness.runtime.getSurfaceView('ready-1')?.dataModel, { note: 'v1' });
  });
});

describe('S4.1 · 关联与门控反例', () => {
  it('响应头缺失：不采信 done，generate 返回 desync 并丢弃预览', async () => {
    const t = scriptedTransport([
      {
        runId: null,
        frames: framesOf([
          startFrame(R1, 'gen-x'),
          ...messageFrames('gen-x'),
          doneFrame(R1, 'gen-x', 1),
        ]),
      },
    ]);
    const { session, runtime } = makeSession(t.transport);
    const result = await session.generate({ catalogId: CATALOG_ID });
    assert.equal(result.status, 'desync');
    assert.match((result as { reason: string }).reason, /运行标识头/);
    assert.equal(session.getSurface('gen-x'), undefined, '预览跟踪已清理');
    assert.deepEqual(
      Object.keys(runtime.store.getState().surfaces),
      [],
      'runtime 不残留半成品 surface',
    );
  });

  it('done 的 catalogHash 与契约不一致 → desync', async () => {
    const t = scriptedTransport([
      {
        runId: R1,
        frames: framesOf([
          startFrame(R1, 'gen-h'),
          ...messageFrames('gen-h'),
          doneFrame(R1, 'gen-h', 1, { catalogHash: 'sha256:' + 'b'.repeat(64) }),
        ]),
      },
    ]);
    const { session } = makeSession(t.transport);
    const result = await session.generate({ catalogId: CATALOG_ID });
    assert.equal(result.status, 'desync');
    // core 流序检查先捕获 start/done hash 不一致（会话门控的第二道防线）。
    assert.match((result as { reason: string }).reason, /不一致/);
  });

  it('未加载契约的 catalogId 在入口拒绝（fail-closed）', async () => {
    const { session } = makeSession(scriptedTransport([]).transport);
    await assert.rejects(
      () => session.generate({ catalogId: 'https://example.com/unknown' }),
      /缺少 hash/,
    );
  });

  it('action 在未就绪 surface 上被门控（desync/未跟踪）', async () => {
    const { session } = makeSession(scriptedTransport([]).transport);
    const result = await session.action({
      surfaceId: 'never-generated',
      name: 'submit',
      sourceComponentId: 'confirm',
    });
    assert.equal(result.status, 'desync');
    assert.equal(result.surfaceId, 'never-generated');
  });

  it('在途重复 action 忽略，不打断当前运行', async () => {
    const t = scriptedTransport([{ runId: R1, frames: happyRun(R1, 'busy-1') }]);
    let releaseAction!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseAction = resolve;
    });
    t.queue.push({
      runId: R2,
      makeFrames: () =>
        (async function* () {
          yield framesOf([startFrame(R2, 'busy-1')])[0];
          await gate;
          yield framesOf([doneFrame(R2, 'busy-1', 2)])[0];
        })(),
    });
    const { session } = makeSession(t.transport);
    const setup = await session.generate({ catalogId: CATALOG_ID });
    assert.ok(setup.status === 'committed');
    const inFlight = session.action({
      surfaceId: 'busy-1',
      name: 'submit',
      sourceComponentId: 'confirm',
    });
    const duplicate = await session.action({
      surfaceId: 'busy-1',
      name: 'submit',
      sourceComponentId: 'confirm',
    });
    assert.equal(duplicate.status, 'ignored');
    assert.equal(t.requests.length, 2, '重复提交不产生第二次 transport 调用');
    releaseAction();
    const result = await inFlight;
    assert.equal(result.status, 'committed');
    assert.equal(session.getSurface('busy-1')?.baseline?.surfaceRevision, 2);
  });

  it('双 surface 隔离：其一失败不影响另一 surface 的门控与基准', async () => {
    const t = scriptedTransport([
      { runId: R1, frames: happyRun(R1, 'surf-a') },
      {
        runId: R2,
        frames: framesOf([
          startFrame(R2, 'surf-b'),
          {
            event: 'error',
            data: {
              sessionVersion: 1,
              runId: R2,
              surfaceId: 'surf-b',
              code: 'RUN_FAILED',
              commitState: 'notCommitted',
              message: 'surf-b 失败',
            },
          },
        ]),
      },
    ]);
    const { session } = makeSession(t.transport);
    const a = await session.generate({ catalogId: CATALOG_ID });
    const b = await session.generate({ catalogId: CATALOG_ID });
    assert.ok(a.status === 'committed');
    assert.equal(b.status, 'failed', 'surf-b 的 error 帧（notCommitted）按失败收敛');
    assert.equal(session.getSurface('surf-a')?.actionOpen, true, '失败不影响另一 surface');
    assert.equal(session.getSurface('surf-a')?.baseline?.surfaceRevision, 1);
    assert.equal(session.getSurface('surf-b'), undefined, '失败生成的预览跟踪已清理');
  });
});

describe('S4.1 · 取消、晚到与释放', () => {
  it('cancel 只作用于在途运行，之后仍可发起新运行', async () => {
    const t = scriptedTransport([
      { runId: R1, makeFrames: hangingFrames },
      { runId: R2, frames: happyRun(R2, 'after-cancel') },
    ]);
    const { session } = makeSession(t.transport);
    const pending = session.generate({ catalogId: CATALOG_ID });
    session.cancel('用户取消');
    const canceled = await pending;
    assert.equal(canceled.status, 'canceled');

    const again = await session.generate({ catalogId: CATALOG_ID });
    assert.equal(again.status, 'committed', '取消后新运行不被历史取消原因毒化');
    assert.equal(session.getSurface('after-cancel')?.actionOpen, true);
  });

  it('action 取消且已应用补丁 → desync（不保留可交互的脏视图）', async () => {
    const t = scriptedTransport([{ runId: R1, frames: happyRun(R1, 'cancel-1') }]);
    t.queue.push({
      runId: R2,
      makeFrames: (request) =>
        (async function* () {
          yield framesOf([startFrame(R2, 'cancel-1')])[0];
          yield framesOf([
            {
              event: 'message',
              data: {
                version: 'v0.9',
                updateDataModel: { surfaceId: 'cancel-1', value: { note: 'x' } },
              },
            },
          ])[0];
          yield* hangingFrames(request);
        })(),
    });
    const { session } = makeSession(t.transport);
    assert.ok((await session.generate({ catalogId: CATALOG_ID })).status === 'committed');
    const pending = session.action({
      surfaceId: 'cancel-1',
      name: 'submit',
      sourceComponentId: 'confirm',
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    session.cancel('用户取消');
    const result = await pending;
    assert.equal(result.status, 'desync');
    assert.equal(session.getSurface('cancel-1')?.actionOpen, false);
  });

  it('晚到 done 不覆盖取消结论，也不推进基准', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const t = scriptedTransport([{ runId: R1, frames: happyRun(R1, 'late-1') }]);
    t.queue.push({
      runId: R2,
      makeFrames: () =>
        (async function* () {
          yield framesOf([startFrame(R2, 'late-1')])[0];
          await gate;
          yield framesOf([doneFrame(R2, 'late-1', 2)])[0];
        })(),
    });
    const { session } = makeSession(t.transport);
    assert.ok((await session.generate({ catalogId: CATALOG_ID })).status === 'committed');
    const pending = session.action({
      surfaceId: 'late-1',
      name: 'submit',
      sourceComponentId: 'confirm',
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    session.cancel('用户取消');
    release();
    const result = await pending;
    assert.equal(result.status, 'desync');
    const status = session.getSurface('late-1');
    assert.equal(status?.baseline?.surfaceRevision, 1, '晚到 done 不推进基准');
    assert.equal(status?.actionOpen, false, '请求可能已提交，取消不能证明旧基准仍有效');
  });

  it('缺运行标识头时释放响应体（reader 不泄漏）', async () => {
    let canceled = 0;
    const transport = fetchSseTransport({
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('event: start\ndata: {}\n\n'));
            },
            cancel() {
              canceled += 1;
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        ),
    });
    const { session } = makeSession(transport);
    const result = await session.generate({ catalogId: CATALOG_ID });
    assert.equal(result.status, 'desync');
    assert.equal(canceled, 1, '提前拒绝也必须关闭 reader');
  });

  it('dispose：在途运行取消、surface 跟踪清空、入口拒绝', async () => {
    const t = scriptedTransport([{ runId: R1, makeFrames: hangingFrames }]);
    const { session } = makeSession(t.transport);
    const pending = session.generate({ catalogId: CATALOG_ID });
    let notified = 0;
    session.subscribe(() => {
      notified += 1;
    });
    session.dispose();
    assert.equal((await pending).status, 'canceled');
    assert.equal(session.disposed, true);
    assert.deepEqual(session.surfaces(), []);
    await assert.rejects(() => session.generate({ catalogId: CATALOG_ID }), /已销毁/);
    session.dispose();
    assert.equal(notified, 0, 'dispose 后订阅已清空');
  });
});

describe('S4.1 · 宿主边界', () => {
  it('订阅回调抛错不影响运行，异常经 onListenerError 上报', async () => {
    const errors: unknown[] = [];
    const t = scriptedTransport([{ runId: R1, frames: happyRun(R1, 'listener-1') }]);
    const { session } = makeSession(t.transport, {
      onListenerError: (error: unknown) => errors.push(error),
    });
    session.subscribe(() => {
      throw new Error('宿主渲染回调崩溃');
    });
    const result = await session.generate({ catalogId: CATALOG_ID });
    assert.equal(result.status, 'committed');
    assert.ok(errors.length > 0, '异常被上报而不是吞掉');
    assert.equal(session.getSurface('listener-1')?.phase, 'ready');
  });

  it('baseline 冻结：宿主改写不影响会话内部基准', async () => {
    const t = scriptedTransport([{ runId: R1, frames: happyRun(R1, 'frozen-1') }]);
    const { session } = makeSession(t.transport);
    assert.ok((await session.generate({ catalogId: CATALOG_ID })).status === 'committed');
    const status = session.getSurface('frozen-1');
    assert.ok(status?.baseline);
    assert.throws(() => {
      (status.baseline as { surfaceRevision: number }).surfaceRevision = 999;
    }, TypeError);
    assert.equal(session.getSurface('frozen-1')?.baseline?.surfaceRevision, 1);
  });
});

const submit = (surfaceId: string) => ({ surfaceId, name: 'submit', sourceComponentId: 'confirm' });

function barrier(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('S4.1 · 复核整改反例', () => {
  for (const kind of ['generate', 'action'] as const) {
    for (const rejection of ['budget', 'catalog'] as const) {
      it(`${kind} 的 ${rejection} 本地拒绝不能被 done 提升或确认草稿`, async () => {
        const id = `reject-${kind}-${rejection}`;
        const registry = new CatalogRegistry([catalog()]);
        const runtime = new A2UIRuntime({ catalogRegistry: registry, maxDataModelBytes: 32 });
        const bad =
          rejection === 'budget'
            ? {
                version: 'v0.9',
                updateDataModel: { surfaceId: id, value: { note: 'x'.repeat(100) } },
              }
            : {
                version: 'v0.9',
                updateComponents: {
                  surfaceId: id,
                  components: [{ id: 'root', component: 'Unknown' }],
                },
              };
        const t = scriptedTransport([]);
        const { session } = makeSession(t.transport, { runtime });
        if (kind === 'action') {
          t.queue.push({ runId: R1, frames: happyRun(R1, id) });
          assert.equal((await session.generate({ catalogId: CATALOG_ID })).status, 'committed');
          assert.equal(runtime.setInputValue('label', id, 'text', 'draft'), true);
        }
        // 同 Catalog/路径的正常模型写入已在 happyRun 或本次生成消息中成功。
        t.queue.push({
          runId: R2,
          frames: framesOf([
            startFrame(R2, id),
            ...(kind === 'generate' ? messageFrames(id) : []),
            { event: 'message', data: bad },
            doneFrame(R2, id, 2),
          ]),
        });
        const draft = runtime.extractLatestInputDrafts(id);
        const result =
          kind === 'generate'
            ? await session.generate({ catalogId: CATALOG_ID })
            : await session.action(submit(id));
        assert.equal(result.status, 'desync');
        assert.match((result as { reason: string }).reason, /runtime 拒绝消息/);
        assert.notEqual(session.getSurface(id)?.actionOpen, true);
        if (kind === 'action') {
          assert.equal(session.getSurface(id)?.baseline?.surfaceRevision, 1);
          assert.deepEqual(runtime.extractLatestInputDrafts(id), draft, '拒绝后不确认发送草稿');
          assert.deepEqual(runtime.store.getState().dataModelBySurface[id], { note: 'draft' });
        } else {
          assert.equal(runtime.store.getState().surfaces[id], undefined, '失败生成预览丢弃');
        }
      });
    }
  }

  it('宿主已提交但响应头丢失时 open 抛错，不能继续使用旧 action 基准', async () => {
    const t = scriptedTransport([{ runId: R1, frames: happyRun(R1, 'network') }]);
    let authoritativeRevision = 1;
    const { session } = makeSession({
      open: async (request) => {
        if (authoritativeRevision === 1 && t.queue.length) return t.transport.open(request);
        authoritativeRevision++;
        throw new TypeError('response headers lost');
      },
    });
    assert.equal((await session.generate({ catalogId: CATALOG_ID })).status, 'committed');
    assert.equal((await session.action(submit('network'))).status, 'desync');
    assert.equal(authoritativeRevision, 2);
    assert.equal(session.getSurface('network')?.actionOpen, false);
    assert.equal(session.getSurface('network')?.baseline?.surfaceRevision, 1);
  });

  for (const beforeStart of [false, true]) {
    it(`准入拒绝关闭过期 revision/hash 的动作资格（beforeStart=${beforeStart}）`, async () => {
      const t = scriptedTransport([{ runId: R1, frames: happyRun(R1, 'stale') }]);
      const { session } = makeSession(t.transport);
      await session.generate({ catalogId: CATALOG_ID });
      t.queue.push({
        runId: R2,
        frames: framesOf([
          ...(beforeStart ? [] : [startFrame(R2, 'stale')]),
          {
            event: 'error',
            data: {
              sessionVersion: 1,
              runId: R2,
              surfaceId: 'stale',
              code: 'RUN_ADMISSION_REJECTED',
              commitState: 'notCommitted',
              ...(beforeStart ? { beforeStart: true } : {}),
            },
          },
        ]),
      });
      assert.equal((await session.action(submit('stale'))).status, 'desync');
      assert.equal(session.getSurface('stale')?.actionOpen, false);
      assert.equal(t.requests.length, 2);
      assert.equal((await session.action(submit('stale'))).status, 'desync');
      assert.equal(t.requests.length, 2, '旧基准不能再次发送');
    });
  }

  for (const identity of ['runId', 'surfaceId'] as const) {
    it(`beforeStart error 的 ${identity} 不符不能作为可信未提交事实`, async () => {
      const t = scriptedTransport([{ runId: R1, frames: happyRun(R1, 'binding') }]);
      const { session } = makeSession(t.transport);
      await session.generate({ catalogId: CATALOG_ID });
      t.queue.push({
        runId: R2,
        frames: framesOf([
          {
            event: 'error',
            data: {
              sessionVersion: 1,
              runId: R2,
              surfaceId: 'binding',
              beforeStart: true,
              code: 'RUN_FAILED',
              commitState: 'notCommitted',
              [identity]: identity === 'runId' ? R1 : 'other',
            },
          },
        ]),
      });
      assert.equal((await session.action(submit('binding'))).status, 'desync');
      assert.equal(session.getSurface('binding')?.actionOpen, false);
    });
  }

  for (const operation of ['cancel', 'dispose'] as const) {
    it(`busy 订阅内同步 ${operation}：不发送请求、不复活跟踪`, async () => {
      const t = scriptedTransport([{ runId: R1, frames: happyRun(R1, 'reentrant') }]);
      const { session } = makeSession(t.transport);
      await session.generate({ catalogId: CATALOG_ID });
      session.subscribe(() => {
        if (session.getSurface('reentrant')?.busy) session[operation]();
      });
      assert.equal((await session.action(submit('reentrant'))).status, 'canceled');
      assert.equal(t.requests.length, 1, '同步失效发生在 transport.open 之前');
      if (operation === 'dispose') assert.deepEqual(session.surfaces(), []);
      else assert.equal(session.getSurface('reentrant')?.actionOpen, true, '确定未发送可保留基准');
    });
  }

  it('已发送、未收到帧时取消 → desync，保留草稿', async () => {
    const sent = barrier();
    const t = scriptedTransport([{ runId: R1, frames: happyRun(R1, 'sent') }]);
    const { session, runtime } = makeSession({
      open: async (request) => {
        if (t.queue.length) return t.transport.open(request);
        const frames = hangingFrames(request);
        sent.resolve();
        return { runIdHeader: R2, frames };
      },
    });
    await session.generate({ catalogId: CATALOG_ID });
    runtime.setInputValue('label', 'sent', 'text', 'draft');
    const draft = runtime.extractLatestInputDrafts('sent');
    const pending = session.action(submit('sent'));
    await sent.promise;
    session.cancel();
    assert.equal((await pending).status, 'desync');
    assert.equal(session.getSurface('sent')?.actionOpen, false);
    assert.deepEqual(runtime.extractLatestInputDrafts('sent'), draft);
  });

  it('done 已解析但 EOF 未到时取消，正常 EOF 也不能推进基准或确认草稿', async () => {
    const afterDone = barrier();
    const t = scriptedTransport([{ runId: R1, frames: happyRun(R1, 'eof') }]);
    t.queue.push({
      runId: R2,
      makeFrames: (request) =>
        (async function* () {
          yield* framesOf([startFrame(R2, 'eof'), doneFrame(R2, 'eof', 2)]);
          const aborted = new Promise<void>((resolve) =>
            request.signal!.addEventListener('abort', () => resolve(), { once: true }),
          );
          afterDone.resolve();
          await aborted;
          // transport 在 abort 后正常结束，不抛 AbortError。
        })(),
    });
    const { session, runtime } = makeSession(t.transport);
    await session.generate({ catalogId: CATALOG_ID });
    runtime.setInputValue('label', 'eof', 'text', 'draft');
    const draft = runtime.extractLatestInputDrafts('eof');
    const pending = session.action(submit('eof'));
    await afterDone.promise;
    session.cancel();
    assert.equal((await pending).status, 'desync');
    assert.equal(session.getSurface('eof')?.baseline?.surfaceRevision, 1);
    assert.equal(session.getSurface('eof')?.actionOpen, false);
    assert.deepEqual(runtime.extractLatestInputDrafts('eof'), draft);
  });

  it('streaming 通知内取消，后续消息不得写入 runtime', async () => {
    const t = scriptedTransport([{ runId: R1, frames: happyRun(R1, 'write-guard') }]);
    const { session, runtime } = makeSession(t.transport);
    session.subscribe(() => {
      if (session.getSurface('write-guard')?.busy) session.cancel();
    });
    assert.equal((await session.generate({ catalogId: CATALOG_ID })).status, 'canceled');
    assert.equal(runtime.store.getState().surfaces['write-guard'], undefined);
  });

  it('异常报告回调抛错同样不打断会话', async () => {
    const t = scriptedTransport([{ runId: R1, frames: happyRun(R1, 'error-hook') }]);
    const { session } = makeSession(t.transport, {
      onListenerError: () => {
        throw new Error('report failed');
      },
    });
    session.subscribe(() => {
      throw new Error('listener failed');
    });
    assert.equal((await session.generate({ catalogId: CATALOG_ID })).status, 'committed');
    assert.equal(session.getSurface('error-hook')?.actionOpen, true);
  });
});

describe('S4.1.2-C · recover 完整恢复', () => {
  function desyncSurface() {
    const runId = 'f0000000-0000-4000-8000-000000000001';
    const t = scriptedTransport([
      {
        runId,
        frames: framesOf([
          startFrame(runId, 'rec-1'),
          ...messageFrames('rec-1'),
          doneFrame(runId, 'rec-1', 1),
        ]),
      },
      // desync 触发：EOF 无终态。
      { runId: 'f0000000-0000-4000-8000-000000000002', frames: [] },
    ]);
    const { session, runtime } = makeSession(t.transport);
    return { session, runtime, t };
  }

  it('合法恢复：desync surface 重新 ready，视图与基准一次到位', async () => {
    const { session, runtime } = desyncSurface();
    const setup = await session.generate({ catalogId: CATALOG_ID });
    if (setup.status !== 'committed') {
      console.log('SETUP:', JSON.stringify(setup));
      console.log('ERRORS:', JSON.stringify(runtime.store.getState().errors.slice(0, 2)));
    }
    assert.ok(setup.status === 'committed');
    const baseline = session.getSurface('rec-1')!.baseline!;
    // 先弄成 desync（第二个队列条目：EOF 无终态）。
    const bad = await session.action({
      surfaceId: 'rec-1',
      name: 'submit',
      sourceComponentId: 'confirm',
    });
    assert.equal(bad.status, 'desync');
    assert.equal(session.getSurface('rec-1')!.actionOpen, false);

    // 宿主提供可信快照 + 同一次提交身份：恢复。
    const view = runtime.getSurfaceView('rec-1')!;
    const recovered = session.recover({ view, commit: baseline });
    assert.equal(recovered.status, 'committed');
    const status = session.getSurface('rec-1')!;
    assert.equal(status.phase, 'ready');
    assert.equal(status.actionOpen, true);
    assert.equal(status.baseline?.surfaceRevision, 1);
  });

  it('身份错配/未注册 hash 的恢复被拒绝且原状态不变', async () => {
    const { session, runtime } = desyncSurface();
    const setup = await session.generate({ catalogId: CATALOG_ID });
    assert.ok(setup.status === 'committed');
    const before = session.getSurface('rec-1')!;
    const view = runtime.getSurfaceView('rec-1')!;
    // surface 错配（view 的 surfaceId 与 commit 不一致）。
    assert.throws(
      () =>
        session.recover({
          view: { ...view, surfaceId: 'other' },
          commit: {
            sessionVersion: 1,
            runId: 'x',
            surfaceId: 'rec-1',
            catalogId: CATALOG_ID,
            contractVersion: 2,
            catalogHash: HASH,
            surfaceRevision: 1,
          },
        }),
      /surface 与提交身份不一致/,
    );
    // hash 未在契约表。
    assert.throws(
      () =>
        session.recover({
          view,
          commit: {
            sessionVersion: 1,
            runId: 'x',
            surfaceId: 'rec-1',
            catalogId: CATALOG_ID,
            contractVersion: 2,
            catalogHash: 'sha256:' + 'b'.repeat(64),
            surfaceRevision: 1,
          },
        }),
      /契约不一致/,
    );
    const after = session.getSurface('rec-1')!;
    assert.equal(after.phase, before.phase);
    assert.equal(after.actionOpen, before.actionOpen);
  });

  it('恢复使在途旧 run 失效：晚到帧不再写入', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runId = 'f0000000-0000-4000-8000-000000000003';
    const hang: SessionTransport = {
      async open(request) {
        await gate;
        if (request.signal?.aborted) throw new DOMException('已取消', 'AbortError');
        return {
          runIdHeader: runId,
          frames: (async function* () {
            yield {
              event: 'message',
              data: JSON.stringify({
                version: 'v0.9',
                updateDataModel: { surfaceId: 'rec-2', value: { late: true } },
              }),
            };
          })(),
        };
      },
    };
    const registry = new CatalogRegistry([catalog()]);
    const runtime = new A2UIRuntime({ catalogRegistry: registry });
    // 预置已提交 surface（宿主本地残留的旧视图）。
    runtime.dispatch({
      version: 'v0.9',
      createSurface: { surfaceId: 'rec-2', catalogId: CATALOG_ID },
    } as never);
    const session = createClientSession({
      runtime,
      catalogHashes: new Map([[CATALOG_ID, HASH]]),
      transport: hang,
      endpoints: { generate: '/g', event: '/e' },
    });
    // 旧 run：desync surface 上发起的 action 被门控——直接用挂起 transport 的 generate 不可行
    //（generate 创建新 surface），改用 action：先本地把 rec-2 置为 ready。
    session.recover({
      view: {
        surfaceId: 'rec-2',
        catalogId: CATALOG_ID,
        components: [
          { id: 'root', component: 'Column', children: ['label'] },
          { id: 'label', component: 'Text', text: { path: '/note' } },
        ],
        dataModel: { note: 'base' },
      },
      commit: {
        sessionVersion: 1,
        runId: 'f0000000-0000-4000-8000-000000000009',
        surfaceId: 'rec-2',
        catalogId: CATALOG_ID,
        contractVersion: 2,
        catalogHash: HASH,
        surfaceRevision: 1,
      },
    });
    // 在途旧 action（挂起）。
    const inFlight = session.action({
      surfaceId: 'rec-2',
      name: 'submit',
      sourceComponentId: 'label',
    });
    // 再次恢复（新基准 revision 2）：旧 run 失效。
    const second = session.recover({
      view: {
        surfaceId: 'rec-2',
        catalogId: CATALOG_ID,
        components: [
          { id: 'root', component: 'Column', children: ['label'] },
          { id: 'label', component: 'Text', text: { path: '/note' } },
        ],
        dataModel: { note: 'restored-v2' },
      },
      commit: {
        sessionVersion: 1,
        runId: 'f0000000-0000-4000-8000-000000000004',
        surfaceId: 'rec-2',
        catalogId: CATALOG_ID,
        contractVersion: 2,
        catalogHash: HASH,
        surfaceRevision: 2,
      },
    });
    assert.equal(second.status, 'committed');
    release();
    const late = await inFlight;
    assert.ok(late.status !== 'committed', '旧响应不能覆盖恢复后的视图');
    assert.deepEqual(runtime.getSurfaceView('rec-2')!.dataModel, { note: 'restored-v2' });
  });
});

describe('S4 复核 · 隔离视图、恢复与稳定订阅', () => {
  const submit = (surfaceId: string) => ({
    surfaceId,
    name: 'submit',
    sourceComponentId: 'confirm',
  });
  const barrier = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };

  it('生成候选可观察但不写入公开 runtime；完整 done/EOF 后才发布', async () => {
    const ready = barrier(),
      release = barrier();
    const t = scriptedTransport([
      {
        runId: R1,
        makeFrames: () =>
          (async function* () {
            yield* happyRun(R1, 'preview').slice(0, -1);
            ready.resolve();
            await release.promise;
            yield framesOf([doneFrame(R1, 'preview', 1)])[0];
          })(),
      },
    ]);
    const { session, runtime } = makeSession(t.transport);
    const pending = session.generate({ catalogId: CATALOG_ID });
    await ready.promise;
    assert.equal(runtime.getSurfaceView('preview'), undefined);
    assert.deepEqual(session.getSurface('preview')?.preview?.dataModel, { note: 'v1' });
    assert.equal(session.getSurface('preview')?.actionOpen, false);
    assert.equal(session.getCommittedSurface('preview'), undefined);
    release.resolve();
    assert.equal((await pending).status, 'committed');
    assert.deepEqual(runtime.getSurfaceView('preview')?.dataModel, { note: 'v1' });
    assert.equal(session.getSurface('preview')?.preview, null);
  });

  for (const ending of ['notCommitted', 'unknown', 'eof', 'cancel'] as const) {
    it(`候选 patch 后 ${ending}：原视图、草稿和固定基准不被污染`, async () => {
      const ready = barrier(),
        release = barrier();
      const t = scriptedTransport([{ runId: R1, frames: happyRun(R1, 'isolated') }]);
      const { session, runtime } = makeSession(t.transport);
      await session.generate({ catalogId: CATALOG_ID });
      const committed = session.getCommittedSurface('isolated');
      assert.equal(runtime.setInputValue('label', 'isolated', 'text', 'sent'), true);
      t.queue.push({
        runId: R2,
        makeFrames: () =>
          (async function* () {
            yield* framesOf([
              startFrame(R2, 'isolated'),
              {
                event: 'message',
                data: {
                  version: 'v0.9',
                  updateDataModel: { surfaceId: 'isolated', value: { note: 'candidate' } },
                },
              },
            ]);
            ready.resolve();
            await release.promise;
            if (ending === 'notCommitted' || ending === 'unknown')
              yield framesOf([
                {
                  event: 'error',
                  data: {
                    sessionVersion: 1,
                    runId: R2,
                    surfaceId: 'isolated',
                    code: 'RUN_FAILED',
                    commitState: ending,
                  },
                },
              ])[0];
          })(),
      });
      const pending = session.action(submit('isolated'));
      await ready.promise;
      assert.deepEqual(runtime.getSurfaceView('isolated')?.dataModel, { note: 'sent' });
      assert.equal(runtime.setInputValue('label', 'isolated', 'text', 'later'), true);
      const drafts = runtime.extractLatestInputDrafts('isolated');
      if (ending === 'cancel') session.cancel();
      release.resolve();
      assert.equal((await pending).status, ending === 'notCommitted' ? 'failed' : 'desync');
      assert.deepEqual(runtime.getSurfaceView('isolated')?.dataModel, { note: 'later' });
      assert.deepEqual(runtime.extractLatestInputDrafts('isolated'), drafts);
      assert.equal(session.getCommittedSurface('isolated'), committed);
      assert.equal(session.getSurface('isolated')?.actionOpen, ending === 'notCommitted');
      assert.equal(session.getSurface('isolated')?.preview, null);
    });
  }

  it('真实请求期间新编辑在成功发布后保持可见，下次 inputs 与可见值一致', async () => {
    const ready = barrier(),
      release = barrier();
    const t = scriptedTransport([{ runId: R1, frames: happyRun(R1, 'edits') }]);
    const { session, runtime } = makeSession(t.transport);
    await session.generate({ catalogId: CATALOG_ID });
    runtime.setInputValue('label', 'edits', 'text', 'sent');
    t.queue.push({
      runId: R2,
      makeFrames: () =>
        (async function* () {
          yield* framesOf([startFrame(R2, 'edits')]);
          ready.resolve();
          await release.promise;
          yield* framesOf([
            {
              event: 'message',
              data: {
                version: 'v0.9',
                updateDataModel: { surfaceId: 'edits', value: { note: 'normalized' } },
              },
            },
            doneFrame(R2, 'edits', 2),
          ]);
        })(),
    });
    const pending = session.action(submit('edits'));
    await ready.promise;
    runtime.setInputValue('label', 'edits', 'text', 'later');
    release.resolve();
    assert.equal((await pending).status, 'committed');
    assert.deepEqual(runtime.getSurfaceView('edits')?.dataModel, { note: 'later' });
    assert.deepEqual(session.getCommittedSurface('edits')?.view.dataModel, { note: 'normalized' });
    t.queue.push({
      runId: R1,
      frames: framesOf([startFrame(R1, 'edits'), doneFrame(R1, 'edits', 3)]),
    });
    await session.action(submit('edits'));
    const body = t.requests[2].body as { nexus: { inputs: Array<{ value: unknown }> } };
    assert.equal(body.nexus.inputs[0].value, 'later');
  });

  it('成功终态前完整引用校验失败不发布候选或确认草稿', async () => {
    const t = scriptedTransport([
      { runId: R1, frames: happyRun(R1, 'refs') },
      {
        runId: R2,
        frames: framesOf([
          startFrame(R2, 'refs'),
          {
            event: 'message',
            data: {
              version: 'v0.9',
              updateComponents: {
                surfaceId: 'refs',
                components: [{ id: 'root', component: 'Column', children: ['missing'] }],
              },
            },
          },
          doneFrame(R2, 'refs', 2),
        ]),
      },
    ]);
    const { session, runtime } = makeSession(t.transport);
    await session.generate({ catalogId: CATALOG_ID });
    runtime.setInputValue('label', 'refs', 'text', 'keep');
    const before = runtime.getSurfaceView('refs'),
      drafts = runtime.extractLatestInputDrafts('refs');
    assert.equal((await session.action(submit('refs'))).status, 'desync');
    assert.equal(runtime.getSurfaceView('refs'), before);
    assert.deepEqual(runtime.extractLatestInputDrafts('refs'), drafts);
    assert.equal(session.getSurface('refs')?.baseline?.surfaceRevision, 1);
  });

  it('拒绝旧版本与同版本身份/内容冲突，恢复拒绝保留视图、基准及草稿', async () => {
    const t = scriptedTransport([
      { runId: R1, frames: happyRun(R1, 'recover') },
      { runId: R2, frames: framesOf([startFrame(R2, 'recover'), doneFrame(R2, 'recover', 2)]) },
    ]);
    const { session, runtime } = makeSession(t.transport);
    await session.generate({ catalogId: CATALOG_ID });
    const old = session.getCommittedSurface('recover')!;
    await session.action(submit('recover'));
    const current = session.getCommittedSurface('recover')!;
    runtime.setInputValue('label', 'recover', 'text', 'keep');
    const before = runtime.getSurfaceView('recover'),
      drafts = runtime.extractLatestInputDrafts('recover');
    for (const input of [
      old,
      { ...current, commit: { ...current.commit, runId: R1 } },
      { ...current, view: { ...current.view, dataModel: { note: 'forged' } } },
    ]) {
      assert.throws(() => session.recover(input), /过期|冲突/);
      assert.equal(runtime.getSurfaceView('recover'), before);
      assert.deepEqual(runtime.extractLatestInputDrafts('recover'), drafts);
      assert.equal(session.getCommittedSurface('recover'), current);
    }
    assert.equal(session.recover(current).status, 'committed');
    assert.deepEqual(runtime.getSurfaceView('recover')?.dataModel, current.view.dataModel);
    assert.equal(runtime.getLatestInputs('recover').length, 0);
  });

  it('状态快照稳定、按 surface 通知隔离且可解除；异常观察者不阻断恢复', async () => {
    const t = scriptedTransport([
      { runId: R1, frames: happyRun(R1, 'a') },
      { runId: R2, frames: happyRun(R2, 'b') },
    ]);
    const { session, runtime } = makeSession(t.transport);
    await session.generate({ catalogId: CATALOG_ID });
    const before = session.getSurface('a');
    assert.equal(session.getSurface('a'), before);
    let called = 0;
    const off = session.subscribeSurface('a', () => called++);
    await session.generate({ catalogId: CATALOG_ID });
    assert.equal(called, 0);
    assert.equal(session.getSurface('a'), before);
    runtime.subscribeSurface('a', () => {
      throw new Error('observer');
    });
    assert.equal(session.recover(session.getCommittedSurface('a')!).status, 'committed');
    assert.equal(called, 0, '身份与门控未变，不重复通知');
    t.queue.push({ runId: R2, frames: framesOf([startFrame(R2, 'a'), doneFrame(R2, 'a', 2)]) });
    await session.action(submit('a'));
    assert.ok(called > 0);
    off();
    off();
    const count = called;
    session.recover(session.getCommittedSurface('a')!);
    assert.equal(called, count);
    session.dispose();
    off();
  });
});

describe('S4 复核 · runtime 装配与所有权', () => {
  it('自建 runtime 接收声明和预算，dispose 清理自建视图；外部视图保留', async () => {
    const t = scriptedTransport([{ runId: R1, frames: happyRun(R1, 'owned') }]);
    const session = createClientSession({
      runtimeOptions: { catalogRegistry: new CatalogRegistry([catalog()]), maxDataModelBytes: 80 },
      catalogHashes: new Map([[CATALOG_ID, HASH]]),
      transport: t.transport,
      endpoints: { generate: '/g', event: '/e' },
    });
    assert.equal((await session.generate({ catalogId: CATALOG_ID })).status, 'committed');
    assert.equal(session.runtime.setInputValue('label', 'owned', 'text', 'editable'), true);
    assert.equal(session.runtime.setInputValue('label', 'owned', 'text', 'x'.repeat(100)), false);
    session.dispose();
    assert.equal(session.runtime.getSurfaceView('owned'), undefined);
    const external = makeSession(
      scriptedTransport([{ runId: R1, frames: happyRun(R1, 'external') }]).transport,
    );
    await external.session.generate({ catalogId: CATALOG_ID });
    external.session.dispose();
    assert.ok(external.runtime.getSurfaceView('external'));
  });
});

describe('S4 复核 · 发布观察者与固定身份', () => {
  it('恢复发布期间观察者改写传入 commit 不改变本次固定身份', async () => {
    const t = scriptedTransport([{ runId: R1, frames: happyRun(R1, 'identity') }]);
    const { session, runtime } = makeSession(t.transport);
    await session.generate({ catalogId: CATALOG_ID });
    const fixed = session.getCommittedSurface('identity')!;
    const commit = { ...fixed.commit, runId: R2, surfaceRevision: 2 };
    const off = runtime.subscribeSurface('identity', () => {
      commit.surfaceId = 'other';
      commit.surfaceRevision = 999;
    });
    const result = session.recover({ view: fixed.view, commit });
    off();
    assert.equal(result.status, 'committed');
    assert.equal(session.getSurface('identity')?.baseline?.surfaceRevision, 2);
    assert.equal(session.getSurface('other'), undefined);
    assert.equal(session.getCommittedSurface('identity')?.commit.runId, R2);
  });

  it('成功发布中的观察者取消不会把已发布事实改成 desync', async () => {
    const t = scriptedTransport([
      { runId: R1, frames: happyRun(R1, 'publish') },
      {
        runId: R2,
        frames: framesOf([
          startFrame(R2, 'publish'),
          {
            event: 'message',
            data: {
              version: 'v0.9',
              updateDataModel: { surfaceId: 'publish', value: { note: 'server' } },
            },
          },
          doneFrame(R2, 'publish', 2),
        ]),
      },
    ]);
    const { session, runtime } = makeSession(t.transport);
    await session.generate({ catalogId: CATALOG_ID });
    runtime.subscribeSurface('publish', () => session.cancel());
    assert.equal(
      (await session.action({ surfaceId: 'publish', name: 'submit', sourceComponentId: 'confirm' }))
        .status,
      'committed',
    );
    assert.equal(session.getSurface('publish')?.baseline?.surfaceRevision, 2);
    assert.equal(session.getSurface('publish')?.actionOpen, true);
    assert.deepEqual(runtime.getSurfaceView('publish')?.dataModel, { note: 'server' });
  });
});
