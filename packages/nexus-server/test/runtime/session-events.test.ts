import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PassThrough } from 'node:stream';
import type Koa from 'koa';
import {
  createSessionStreamCheck,
  parseSessionEvent,
  type NexusSessionEvent,
  type NexusSessionEventName,
} from '@nexus-ui/core';
import { createAgentRuntime } from '../../src/runtime/runtime-facade';
import type { AgentRuntimeOptions } from '../../src/runtime/agent-runtime';
import type { RuntimeRunEvent, RuntimeRunHandle } from '../../src/runtime/run-handle';
import { sendAgentRun } from '../../src/api/send-messages';
import { InMemorySurfaceActionStateStore } from '../../src/agent/surface-action-state';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';
import { createTestRegistry, TEST_CATALOG_ID } from '../../tests/helpers/test-catalog';

/**
 * S3.4：Session v1 事件与结构化诊断。
 *
 * - runtime 事件源是唯一事实源：非 Koa events() 与 SSE 发送共用同一事件序列；
 * - 全部事件经 core `parseSessionEvent` + `createSessionStreamCheck` 对拍
 *   （fixtures/session-v1 的 oracle 结论：start→message*→恰一终态、排队取消例外）；
 * - 锁定 wire 形状回归：error 携带 sessionVersion/runId/surfaceId/code/commitState，
 *   不再出现 S2 过渡的 runCode/顶层 boundaryCode。
 */

const registry = createTestRegistry();
const HASH = createCatalogContractHash(registry.require(TEST_CATALOG_ID));
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function generationSource(surfaceId: string): unknown[] {
  return [
    { version: 'v0.9', createSurface: { surfaceId, catalogId: TEST_CATALOG_ID } },
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
          { id: 'label', component: 'Text', text: '提交' },
        ],
      },
    },
    { version: 'v0.9', updateDataModel: { surfaceId, value: { note: 'ok' } } },
  ];
}

function actionRequest(surfaceId: string, surfaceRevision: number, actionId: string) {
  return {
    name: 'submit',
    surfaceId,
    sourceComponentId: 'confirm',
    timestamp: new Date().toISOString(),
    context: {},
    actionId,
    sessionVersion: 1,
    surfaceRevision,
    catalogHash: HASH,
  };
}

function runtime(options: Partial<AgentRuntimeOptions> = {}) {
  return createAgentRuntime({
    registry,
    createGenerationSource: (request) => generationSource(request.surfaceId),
    actionHandlers: new Map([[`${TEST_CATALOG_ID}:submit`, () => []]]),
    ...options,
  });
}

const WIRE_NAME: Record<RuntimeRunEvent['type'], NexusSessionEventName> = {
  start: 'start',
  message: 'message',
  done: 'done',
  error: 'error',
};

/** 事件 → (SSE 事件名, wire data)；进程内判别字段 type 不上 wire（error/start 除外约定）。 */
function toWire(event: RuntimeRunEvent): { name: NexusSessionEventName; data: unknown } {
  switch (event.type) {
    case 'start':
      return { name: 'start', data: event };
    case 'message':
      return { name: 'message', data: event.message };
    case 'done':
      return { name: 'done', data: event.commit };
    case 'error': {
      const { type: _discriminator, ...payload } = event;
      return { name: 'error', data: payload };
    }
  }
}

/** core/server 对拍：每个事件必须能被 core 解析，序列必须满足 §5.4。 */
function validateWithCore(events: readonly RuntimeRunEvent[]): void {
  const check = createSessionStreamCheck();
  for (const event of events) {
    const wire = toWire(event);
    const parsed = parseSessionEvent(wire.name, wire.data);
    assert.equal(
      parsed.ok,
      true,
      `事件 ${wire.name} 必须通过 core 解析: ${JSON.stringify(wire.data)}`,
    );
    if (parsed.ok) {
      assert.equal(check.push(parsed.event as NexusSessionEvent), null);
    }
  }
  assert.equal(check.end(), null, 'runtime 流必须以唯一终态收尾');
}

async function collect(handle: RuntimeRunHandle): Promise<RuntimeRunEvent[]> {
  const events: RuntimeRunEvent[] = [];
  for await (const event of handle.events()) events.push(event);
  return events;
}

function assertIdentity(
  event: Extract<RuntimeRunEvent, { type: 'start' | 'error' }>,
  run: RuntimeRunHandle,
): void {
  assert.equal(event.sessionVersion, 1);
  assert.equal(event.runId, run.runId);
  assert.equal(event.surfaceId, run.surfaceId);
}

function parseSseFrames(output: string): { event: string; id?: string; data: unknown }[] {
  const frames: { event: string; id?: string; data: unknown }[] = [];
  for (const block of output.split('\n\n')) {
    if (!block.trim()) continue;
    let event = 'message';
    let id: string | undefined;
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('id: ')) id = line.slice(4);
      else if (line.startsWith('data: ')) data.push(line.slice(6));
    }
    if (data.length > 0) frames.push({ event, id, data: JSON.parse(data.join('\n')) });
  }
  return frames;
}

function createSseContext(): Koa.Context & { getOutput(): string } {
  let body: unknown;
  let output = '';
  const context = {
    status: 200,
    set: () => undefined,
    res: new PassThrough(),
    getOutput: () => output,
  };
  Object.defineProperty(context, 'body', {
    set(value: unknown) {
      body = value;
      if (value instanceof PassThrough) {
        value.on('data', (chunk: Buffer) => {
          output += chunk.toString('utf8');
        });
      }
    },
    get(): unknown {
      return body;
    },
  });
  return context as unknown as Koa.Context & { getOutput(): string };
}

/** 归一化身份后做深比较：跨运行的 runId/surfaceId 不同是预期的。 */
function normalize(value: unknown, surfaceId: string, runId: string): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => {
      if (typeof v !== 'string') return v;
      return v.split(surfaceId).join('<SURFACE>').split(runId).join('<RUN>');
    }),
  );
}

describe('S3.4 Session v1 事件：唯一事实源与锁定 wire 形状', () => {
  for (const transport of ['direct', 'sse'] as const) {
    it(`${transport}: missing surface and store read failure produce explicit beforeStart terminals`, async () => {
      for (const fault of ['missing', 'read-failure'] as const) {
        const store = new InMemorySurfaceActionStateStore();
        const r = runtime({
          actionStateStore: {
            get: async (id) => {
              if (fault === 'read-failure') throw new Error('store offline');
              return store.get(id);
            },
            removeSnapshot: (id) => store.removeSnapshot(id),
            commitGeneration: (...args) => store.commitGeneration(...args),
            commitAction: (...args) => store.commitAction(...args),
          },
        });
        const request = actionRequest('missing', 1, `before-${fault}`);
        const q = await r.action(request);
        assert.ok(q.accepted);
        let events: RuntimeRunEvent[];
        if (transport === 'direct') events = await collect(q.run);
        else {
          const ctx = createSseContext();
          assert.equal((await sendAgentRun(ctx, q.run, { streamDelayMs: 0 })).ok, false);
          events = parseSseFrames(ctx.getOutput()).map((frame) => {
            const p = parseSessionEvent(frame.event, frame.data);
            assert.ok(p.ok);
            return p.event as RuntimeRunEvent;
          });
        }
        assert.deepEqual(
          events.map((e) => e.type),
          ['error'],
        );
        const error = events[0];
        assert.ok(error.type === 'error');
        assert.equal('beforeStart' in error && error.beforeStart, true);
        assert.equal(error.actionId, request.actionId);
        validateWithCore(events);
        assert.equal(r.queryRun('missing', q.run.runId)?.state, 'failed');
      }
    });
  }

  it('generation start precedes a failing history read with a known identity', async () => {
    const r = runtime({
      historyStore: {
        getHistory: async () => {
          throw new Error('history offline');
        },
        getCatalogId: async () => undefined,
        commitGeneration: async () => undefined,
      },
    });
    const q = await r.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(q.accepted);
    const events = await collect(q.run);
    assert.deepEqual(
      events.map((e) => e.type),
      ['start', 'error'],
    );
    validateWithCore(events);
  });

  it('iterator return preserves unread buffered messages and terminal after producer completion', async () => {
    const r = runtime();
    const q = await r.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(q.accepted);
    const iterator = q.run.events()[Symbol.asyncIterator]();
    const first = await iterator.next();
    await q.run.result;
    await iterator.return!();
    const suffix = await collect(q.run);
    assert.deepEqual(
      suffix.map((e) => e.type),
      ['message', 'message', 'message', 'done'],
    );
    validateWithCore([first.value, ...suffix]);
    assert.deepEqual(await collect(q.run), [], 'consumed terminal is not replayed');
    assert.equal(
      (await iterator.next()).done,
      true,
      'closed iterator cannot steal returned events',
    );
  });

  for (const fault of ['handler', 'cancel-queued', 'cancel-running'] as const) {
    it(`retains fixed actionId on ${fault}`, async () => {
      const entered = deferred();
      const release = deferred();
      const r = runtime({
        createSurfaceId: () => 'action-id',
        actionHandlers: new Map([
          [
            `${TEST_CATALOG_ID}:submit`,
            async () => {
              entered.resolve();
              if (fault === 'handler') throw new Error('handler failure');
              await release.promise;
              return [];
            },
          ],
        ]),
      });
      const gen = await r.generate({ catalogId: TEST_CATALOG_ID });
      assert.ok(gen.accepted);
      await gen.run.result;
      const request = actionRequest('action-id', 1, 'fixed-action-id');
      const q = await r.action(request);
      request.actionId = 'mutated-by-caller';
      assert.ok(q.accepted);
      let target = q.run;
      try {
        if (fault !== 'handler') {
          await entered.promise;
          if (fault === 'cancel-queued') {
            const queued = await r.action(actionRequest('action-id', 1, 'queued-action-id'));
            assert.ok(queued.accepted);
            target = queued.run;
          }
          target.cancel();
          release.resolve();
        }
        const events = await collect(target);
        const error = events.at(-1);
        assert.ok(error?.type === 'error');
        assert.equal(
          error.actionId,
          fault === 'cancel-queued' ? 'queued-action-id' : 'fixed-action-id',
        );
        validateWithCore(events);
      } finally {
        release.resolve();
        await q.run.result;
      }
    });
  }

  it('非 Koa 生成流：start（无基准）→ message* → done，与 core 解析/序列对拍', async () => {
    const r = runtime({ createSurfaceId: () => 's-gen-events' });
    const q = await r.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(q.accepted);
    const events = await collect(q.run);
    assert.deepEqual(
      events.map((event) => event.type),
      ['start', 'message', 'message', 'message', 'done'],
    );
    validateWithCore(events);

    const start = events[0];
    assert.ok(start.type === 'start');
    assertIdentity(start, q.run);
    assert.equal(start.surfaceRevision, undefined, 'generation 不携带旧基准');
    assert.equal(start.catalogId, TEST_CATALOG_ID);
    assert.equal(start.contractVersion, 2);
    assert.match(start.catalogHash, /^sha256:[a-f0-9]{64}$/);

    const done = events[events.length - 1];
    assert.ok(done.type === 'done');
    const record = r.queryRun('s-gen-events', q.run.runId);
    assert.ok(record);
    assert.equal(record.state, 'succeeded');
    // done 即本次固定提交，与按 run 查询的留存结果同值。
    assert.deepEqual(done.commit, record.commit);
    const snapshot = await r.adapter.describeSurfaceContract('s-gen-events');
    assert.equal(snapshot?.surfaceRevision, 1);
    assert.equal(done.commit.surfaceRevision, 1);
  });

  it('action start 携带调度内实际快照基准；空输出 action 仍一次提交推进 revision', async () => {
    const r = runtime({ createSurfaceId: () => 's-action-events' });
    const gen = await r.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(gen.accepted);
    await gen.run.result;
    const act = await r.action(actionRequest('s-action-events', 1, 'act-events-1'));
    assert.ok(act.accepted);
    const events = await collect(act.run);
    assert.deepEqual(
      events.map((event) => event.type),
      ['start', 'done'],
    );
    validateWithCore(events);
    const start = events[0];
    assert.ok(start.type === 'start');
    assert.equal(start.surfaceRevision, 1, 'action start 绑定调度内快照 revision');
    const done = events[1];
    assert.ok(done.type === 'done');
    assert.equal(done.commit.surfaceRevision, 2, '合法空输出 action 推进 revision');
    assert.deepEqual(done.commit, r.queryRun('s-action-events', act.run.runId)?.commit);
  });

  it('HTTP SSE 与非 Koa 事件对拍：同配置输入产出同名同形状事件与终态', async () => {
    const http = runtime({ createSurfaceId: () => 's-pair-http' });
    const direct = runtime({ createSurfaceId: () => 's-pair-direct' });
    const httpRun = await http.generate({ catalogId: TEST_CATALOG_ID });
    const directRun = await direct.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(httpRun.accepted && directRun.accepted);

    const ctx = createSseContext();
    const sendPromise = sendAgentRun(ctx, httpRun.run, { streamDelayMs: 0 });
    const events = await collect(directRun.run);
    const result = await sendPromise;
    assert.equal(result.ok, true);
    const frames = parseSseFrames(ctx.getOutput());

    assert.deepEqual(
      frames.map((frame) => frame.event),
      events.map((event) => WIRE_NAME[event.type]),
    );
    // 每一帧都通过 core 解析，HTTP 与非 Koa 的 message/done 载荷同值（身份除外）。
    const check = createSessionStreamCheck();
    frames.forEach((frame, index) => {
      const parsed = parseSessionEvent(frame.event, frame.data);
      assert.ok(parsed.ok, `SSE 帧 ${frame.event} 必须通过 core 解析`);
      if (parsed.ok) assert.equal(check.push(parsed.event as NexusSessionEvent), null);
      const event = events[index];
      if (frame.event === 'message') {
        assert.ok(event.type === 'message');
        assert.deepEqual(
          normalize(frame.data, 's-pair-http', httpRun.run.runId),
          normalize(event.message, 's-pair-direct', directRun.run.runId),
        );
      }
      if (frame.event === 'done') {
        assert.ok(event.type === 'done');
        assert.deepEqual(
          normalize(frame.data, 's-pair-http', httpRun.run.runId),
          normalize(event.commit, 's-pair-direct', directRun.run.runId),
        );
      }
    });
    assert.equal(check.end(), null);
    // 终态帧之后没有更多帧（唯一终态）。
    const terminals = frames.filter((frame) => frame.event === 'done' || frame.event === 'error');
    assert.equal(terminals.length, 1);
    assert.equal(frames.indexOf(terminals[0]), frames.length - 1);

    // HTTP error 帧同样是锁定形状（SPEC §5.4），S2 过渡字段不再出现。
    const staleHttp = await http.action(actionRequest('s-pair-http', 99, 'pair-stale-1'));
    assert.ok(staleHttp.accepted);
    const staleCtx = createSseContext();
    const staleResult = await sendAgentRun(staleCtx, staleHttp.run, { streamDelayMs: 0 });
    assert.equal(staleResult.ok, false);
    const staleFrames = parseSseFrames(staleCtx.getOutput());
    assert.deepEqual(
      staleFrames.map((frame) => frame.event),
      ['start', 'error'],
    );
    const errorFrame = staleFrames[1];
    assert.ok(errorFrame.event === 'error');
    const errorPayload = errorFrame.data as Record<string, unknown>;
    assert.equal(errorPayload.sessionVersion, 1);
    assert.equal(errorPayload.runId, staleHttp.run.runId);
    assert.equal(errorPayload.surfaceId, 's-pair-http');
    assert.equal(errorPayload.code, 'RUN_ADMISSION_REJECTED');
    assert.equal(errorPayload.commitState, 'notCommitted');
    assert.equal(errorPayload.actionId, 'pair-stale-1');
    for (const legacyKey of ['runCode', 'boundaryCode', 'type']) {
      assert.equal(legacyKey in errorPayload, false, `S2 过渡字段 ${legacyKey} 不应出现`);
    }
    const parsedError = parseSessionEvent('error', errorPayload);
    assert.ok(parsedError.ok, 'HTTP error 载荷必须通过 core 解析');
  });

  it('调度内准入拒绝：error 携带身份/code/commitState/actionId，记录存在且无结果', async () => {
    let handlerCalls = 0;
    const r = runtime({
      createSurfaceId: () => 's-stale-events',
      actionHandlers: new Map([
        [
          `${TEST_CATALOG_ID}:submit`,
          () => {
            handlerCalls += 1;
            return [];
          },
        ],
      ]),
    });
    const gen = await r.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(gen.accepted);
    await gen.run.result;
    const act = await r.action(actionRequest('s-stale-events', 99, 'stale-events-1'));
    assert.ok(act.accepted);
    const events = await collect(act.run);
    assert.deepEqual(
      events.map((event) => event.type),
      ['start', 'error'],
    );
    validateWithCore(events);
    const error = events[1];
    assert.ok(error.type === 'error');
    assertIdentity(error, act.run);
    assert.equal(error.code, 'RUN_ADMISSION_REJECTED');
    assert.equal(error.commitState, 'notCommitted');
    assert.equal(error.actionId, 'stale-events-1');
    const start = events[0];
    assert.ok(start.type === 'start');
    // fixtures/session-v1/reject-admission-stale-revision：start 携带调度内实际
    // 读取快照的基准（1），不是客户端声明的过期 revision（99）。
    assert.equal(start.surfaceRevision, 1);
    assert.equal(handlerCalls, 0, '准入拒绝 handler 零调用');
    const record = r.queryRun('s-stale-events', act.run.runId);
    assert.ok(record, '调度内失败留下可查询记录（409 语义，非 404）');
    assert.equal(record.state, 'failed');
    assert.equal(record.commit, undefined, '无已确认 UI 提交结果');
  });

  it('store 提交异常：error RUN_COMMIT_UNKNOWN/unknown，不发布 done', async () => {
    const store = new InMemorySurfaceActionStateStore();
    const r = runtime({
      createSurfaceId: () => 's-unknown-events',
      actionStateStore: {
        get: (id) => store.get(id),
        removeSnapshot: (id) => store.removeSnapshot(id),
        commitGeneration: async () => ({ outcome: 'unknown', reason: 'write response lost' }),
        commitAction: (...args) => store.commitAction(...args),
      },
    });
    const q = await r.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(q.accepted);
    const events = await collect(q.run);
    assert.deepEqual(
      events.map((event) => event.type),
      ['start', 'message', 'message', 'message', 'error'],
    );
    validateWithCore(events);
    const error = events[events.length - 1];
    assert.ok(error.type === 'error');
    assert.equal(error.code, 'RUN_COMMIT_UNKNOWN');
    assert.equal(error.commitState, 'unknown');
    assert.ok(!events.some((event) => event.type === 'done'));
    assert.equal(r.queryRun('s-unknown-events', q.run.runId)?.state, 'failed');
  });

  it('排队取消：唯一事件是 error/RUN_CANCELLED，无 start，工厂零调用', async () => {
    const gate = deferred();
    let factoryCalls = 0;
    const r = runtime({
      createSurfaceId: () => 's-queued-cancel',
      createGenerationSource: (request) =>
        (async function* () {
          factoryCalls += 1;
          yield* generationSource(request.surfaceId);
          await gate.promise;
        })(),
    });
    const first = await r.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(first.accepted);
    // 第一条消息后第一个 run 挂起，第二个 run 进入同 surface 队列。
    await delay(10);
    const second = await r.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(second.accepted);
    second.run.cancel();
    const events = await collect(second.run);
    assert.deepEqual(
      events.map((event) => event.type),
      ['error'],
      '排队取消例外：唯一事件是 error',
    );
    validateWithCore(events);
    const error = events[0];
    assert.ok(error.type === 'error');
    assertIdentity(error, second.run);
    assert.equal(error.code, 'RUN_CANCELLED');
    assert.equal(error.commitState, 'notCommitted');
    assert.equal(factoryCalls, 1, '排队 run 的 source 工厂未调用（仅第一个 run 调用）');
    gate.resolve();
    assert.equal((await first.run.result).terminal, 'succeeded');
  });

  it('取消与提交竞态：store 确认提交胜出，done 是唯一终态且不倒写', async () => {
    const commitStarted = deferred();
    const releaseCommit = deferred();
    const store = new InMemorySurfaceActionStateStore();
    const r = runtime({
      createSurfaceId: () => 's-cancel-race',
      actionStateStore: {
        get: (id) => store.get(id),
        removeSnapshot: (id) => store.removeSnapshot(id),
        commitGeneration: (...args) => store.commitGeneration(...args),
        commitAction: async (...args) => {
          commitStarted.resolve();
          await releaseCommit.promise;
          return store.commitAction(...args);
        },
      },
    });
    const gen = await r.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(gen.accepted);
    await gen.run.result;
    const act = await r.action(actionRequest('s-cancel-race', 1, 'cancel-race-events'));
    assert.ok(act.accepted);
    const iterator = act.run.events()[Symbol.asyncIterator]();
    const firstStep = await iterator.next();
    assert.ok(firstStep.value.type === 'start');
    // handler 已返回、store 写入在飞时取消：确认提交必须胜出。
    await commitStarted.promise;
    act.run.cancel();
    releaseCommit.resolve();
    const doneStep = await iterator.next();
    assert.ok(doneStep.value.type === 'done', '确认提交后 done 是唯一终态');
    const outcome = await act.run.result;
    assert.equal(outcome.terminal, 'succeeded');
    assert.equal(outcome.commitState, 'committed');
    // 迟到的 next() 直接结束：终态后无事件。
    const lateStep = await iterator.next();
    assert.equal(lateStep.done, true);
    assert.equal((await store.get('s-cancel-race'))?.version, 2);
  });

  it('非法候选与缺 root 在非 Koa 路径同样被拒，错误携带结构化诊断分类', async () => {
    const r = runtime({
      createSurfaceId: () => 's-bad-candidate',
      createGenerationSource: (request) => [
        {
          version: 'v0.9',
          createSurface: { surfaceId: request.surfaceId, catalogId: TEST_CATALOG_ID },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: request.surfaceId,
            components: [{ id: 'root', component: 'Mystery', children: [] }],
          },
        },
      ],
    });
    const q = await r.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(q.accepted);
    const events = await collect(q.run);
    assert.equal(events[events.length - 1].type, 'error');
    validateWithCore(events);
    const error = events[events.length - 1];
    assert.ok(error.type === 'error');
    assert.equal(error.code, 'RUN_FAILED');
    assert.equal(error.commitState, 'notCommitted');
    assert.ok(error.diagnostics?.length, '候选拒绝携带结构化诊断');
    assert.equal(error.diagnostics?.[0]?.code, 'CATALOG_UNSUPPORTED', '诊断携带边界分类码');
    assert.equal(r.queryRun('s-bad-candidate', q.run.runId)?.commit, undefined);

    const empty = runtime({
      createSurfaceId: () => 's-empty-gen',
      createGenerationSource: () => [],
    });
    const emptyRun = await empty.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(emptyRun.accepted);
    const emptyEvents = await collect(emptyRun.run);
    assert.deepEqual(
      emptyEvents.map((event) => event.type),
      ['start', 'error'],
      'EOF/空输出不是终态：finalize 以失败收敛',
    );
    const emptyError = emptyEvents[1];
    assert.ok(emptyError.type === 'error');
    assert.equal(emptyError.code, 'RUN_FAILED');
    assert.equal(empty.queryRun('s-empty-gen', emptyRun.run.runId)?.state, 'failed');
  });

  it('提前退出与迟到订阅：return 不伪造成功，运行继续收敛真实终态', async () => {
    const r = runtime({ createSurfaceId: () => 's-early-return' });
    const q = await r.generate({ catalogId: TEST_CATALOG_ID });
    assert.ok(q.accepted);
    const iterator = q.run.events()[Symbol.asyncIterator]();
    const firstStep = await iterator.next(); // start
    const secondStep = await iterator.next(); // 第一条 message
    await iterator.return!();
    // 消费方退出不影响运行：任务继续并收敛真实终态，留存结果照常写入。
    const outcome = await q.run.result;
    assert.equal(outcome.terminal, 'succeeded');
    const record = r.queryRun('s-early-return', q.run.runId);
    assert.ok(record?.commit, '留存结果不受消费方提前退出影响');
    // 迟到订阅拿到的是缓冲重放（同一条流的接续，不是重头重放）：早退前已消费
    // 的前缀与重放拼接后必须仍是恰一终态的合法流。
    const late = await collect(q.run);
    validateWithCore([firstStep.value, secondStep.value, ...late]);
    const terminals = late.filter((event) => event.type === 'done' || event.type === 'error');
    assert.equal(terminals.length, 1, '重放不产生第二个终态');
    assert.equal(terminals[0].type, 'done');
  });
});
