import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import Koa from 'koa';
import {
  CatalogRegistry,
  parseSessionEvent,
  createSessionStreamCheck,
  type NexusSessionEvent,
  type CatalogDefinition,
} from '@nexus-ui/core';
import { createAgentRuntime } from '../../src/runtime/runtime-facade';
import type { AgentRuntimeOptions } from '../../src/runtime/agent-runtime';
import type { RuntimeRunEvent, RuntimeRunHandle } from '../../src/runtime/run-handle';
import { createAgentRouter } from '../../src/api/routes';
import { sendAgentRun } from '../../src/api/send-messages';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';
import { InMemorySurfaceActionStateStore } from '../../src/agent/surface-action-state';
import type { AgentAction } from '../../src/agent/adapter';
import {
  TEST_CATALOG_ID,
  TEST_CATALOG_ACTIONS,
  createTestRegistry,
} from '../../tests/helpers/test-catalog';
import { allowAllAccess } from '../../tests/helpers/access';

/**
 * S3.5.4 真实 HTTP 与非 Koa 对测（SPEC §5.4/§6.7）：
 * - 同一输入在 Koa SSE 与非 Koa events() 上产生同一 Session 事件序列与结论
 *  （事件名、message 载荷、done 固定提交、error code/commitState）；
 * - HTTP 必须读取实际响应至终态（真实 socket + fetch，非 PassThrough 夹具）；
 * - 排队 run 的响应被占用即 200 + 运行标识头，不回落 404；容量拒绝 503；
 * - 查询路由 400/403/404/409/200 与两条路径一致；
 * - 非 Koa 路径全程不构造 Koa Context（直接调用 runtime 入口）。
 */

const registry = createTestRegistry();
const HASH = createCatalogContractHash(registry.require(TEST_CATALOG_ID));
const ACTION_NAME = TEST_CATALOG_ACTIONS[0];

function surfaceMessages(surfaceId: string): unknown[] {
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
    { version: 'v0.9', updateDataModel: { surfaceId, value: { note: 'generated' } } },
  ];
}

interface RuntimeFixture {
  options?: Partial<AgentRuntimeOptions>;
  /** handler 产出（默认合法空 action）。 */
  actionMessages?: (action: AgentAction) => unknown[];
  failCommitAction?: boolean;
}

function makeRuntime(fixture: RuntimeFixture = {}) {
  let surfaceCounter = 0;
  let handlerCalls = 0;
  const store = new InMemorySurfaceActionStateStore();
  const runtime = createAgentRuntime({
    access: allowAllAccess,
    registry,
    actionStateStore: fixture.failCommitAction
      ? {
          get: (id) => store.get(id),
          removeSnapshot: (id) => store.removeSnapshot(id),
          commitGeneration: (...args) => store.commitGeneration(...args),
          commitAction: async (...args) => {
            await store.commitAction(...args);
            // 写入已发生、确认丢失：无法证明未提交（SPEC §6.3 unknown）。
            throw new Error('confirmation lost after write');
          },
        }
      : store,
    createSurfaceId: () => `parity-${++surfaceCounter}`,
    createGenerationSource: (request) => surfaceMessages(request.surfaceId),
    actionHandlers: new Map([
      [
        `${TEST_CATALOG_ID}:${ACTION_NAME}`,
        (action: AgentAction) => {
          handlerCalls += 1;
          return fixture.actionMessages ? fixture.actionMessages(action) : [];
        },
      ],
    ]),
    ...fixture.options,
  });
  return { runtime, handlerCalls: () => handlerCalls };
}

/** 排队/容量用例共用固定 surface：generate 不再各自新建，构造同 surface 竞争。 */
function makeSharedSurfaceRuntime(fixture: RuntimeFixture & { sharedSurface?: string } = {}) {
  const shared = fixture.sharedSurface ?? 'parity-shared';
  const inner = makeRuntime({
    ...fixture,
    options: {
      ...fixture.options,
      createSurfaceId: () => shared,
      createGenerationSource: (request) => {
        const override = fixture.options?.createGenerationSource;
        if (override) return override(request);
        return surfaceMessages(request.surfaceId);
      },
    },
  });
  return { ...inner, sharedSurface: shared };
}

async function startApp(
  runtime: ReturnType<typeof makeRuntime>['runtime'],
  routerOptions: { streamDelayMs?: number } = {},
): Promise<{ baseUrl: string; server: Server }> {
  const app = new Koa();
  app.use(createAgentRouter({ adapter: runtime.adapter, ...routerOptions }).routes());
  const server = app.listen(0, '127.0.0.1') as Server;
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, server };
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

interface SseFrame {
  event: string;
  id?: string;
  data: unknown;
}

interface PostResult {
  status: number;
  runIdHeader?: string;
  frames: SseFrame[];
  text: string;
}

function jsonError(result: PostResult): { error?: string; message?: string } {
  return JSON.parse(result.text) as { error?: string; message?: string };
}

/** 发起 POST，不等待 body——排队 run 的响应在释放前不会结束。 */
function postStart(baseUrl: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** 读取完整响应并解析为 SSE 帧（响应未结束时调用会等待至终态）。 */
async function readResponse(response: Response): Promise<PostResult> {
  const text = await response.text();
  const frames: SseFrame[] = [];
  if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    for (const block of text.split('\n\n').filter(Boolean)) {
      const event = block.match(/^event: (.*)$/m)?.[1] ?? 'message';
      const data = block.match(/^data: (.*)$/m)?.[1];
      const id = block.match(/^id: (.*)$/m)?.[1];
      frames.push({ event, data: data === undefined ? undefined : JSON.parse(data), id });
    }
  }
  return {
    status: response.status,
    runIdHeader: response.headers.get('x-nexus-run-id') ?? undefined,
    frames,
    text,
  };
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<PostResult> {
  return readResponse(await postStart(baseUrl, path, body));
}

const generateBody = (catalogId = TEST_CATALOG_ID) => ({ message: '对测生成', catalogId });

function actionEnvelope(
  surfaceId: string,
  surfaceRevision: number,
  actionId: string,
  inputs: unknown[] = [],
) {
  return {
    message: {
      version: 'v0.9',
      action: {
        name: ACTION_NAME,
        surfaceId,
        sourceComponentId: 'confirm',
        timestamp: new Date().toISOString(),
        context: {},
        actionId,
      },
    },
    nexus: { sessionVersion: 1, actionId, surfaceRevision, catalogHash: HASH, inputs },
  };
}

function makeAction(
  commit: { surfaceId: string; surfaceRevision: number },
  actionId: string,
  inputs?: Array<{ componentId: string; property: string; value: unknown }>,
  surfaceRevisionOverride?: number,
): AgentAction {
  return {
    name: ACTION_NAME,
    surfaceId: commit.surfaceId,
    sourceComponentId: 'confirm',
    timestamp: new Date().toISOString(),
    context: {},
    actionId,
    sessionVersion: 1,
    surfaceRevision: surfaceRevisionOverride ?? commit.surfaceRevision,
    catalogHash: HASH,
    ...(inputs ? { inputs } : {}),
  };
} /** 非 Koa 直消费：events() 逐条经 core 解析与序列检查（同一事实源对拍）。 */
async function directEvents(handle: RuntimeRunHandle): Promise<RuntimeRunEvent[]> {
  const check = createSessionStreamCheck();
  const events: RuntimeRunEvent[] = [];
  for await (const event of handle.events()) {
    const wire =
      event.type === 'message'
        ? event.message
        : event.type === 'done'
          ? event.commit
          : (() => {
              const { type: _discriminator, ...payload } = event;
              return payload;
            })();
    const parsed = parseSessionEvent(
      event.type,
      JSON.parse(JSON.stringify(wire ?? {})) as Record<string, unknown>,
    );
    assert.ok(parsed.ok, `非 Koa 事件必须通过 core 解析: ${event.type}`);
    check.push(parsed.event as NexusSessionEvent);
    events.push(event);
  }
  assert.equal(check.end(), null, '非 Koa 流必须满足 Session 序列规则');
  return events;
}

/** HTTP SSE 帧逐条经 core 解析（wire 形状与事件名分派）。 */
function parseHttpEvents(frames: SseFrame[]): NexusSessionEvent[] {
  const check = createSessionStreamCheck();
  const events = frames.map((frame) => {
    const parsed = parseSessionEvent(frame.event, frame.data as Record<string, unknown>);
    assert.ok(parsed.ok, `SSE 帧必须通过 core 解析: ${frame.event}`);
    check.push(parsed.event as NexusSessionEvent);
    return parsed.event as NexusSessionEvent;
  });
  assert.equal(check.end(), null, 'HTTP 流必须满足 Session 序列规则');
  return events;
}

function shapeOf(events: readonly NexusSessionEvent[] | readonly RuntimeRunEvent[]): unknown[] {
  // runId/surfaceId 是每次运行的局部身份；对拍形状只保留结构与结论字段。
  return events.map((event) => {
    switch (event.type) {
      case 'start':
        return {
          type: event.type,
          contractVersion: event.contractVersion,
          catalogHash: event.catalogHash,
          surfaceRevision: event.surfaceRevision ?? null,
        };
      case 'message':
        return { type: event.type };
      case 'done':
        return {
          type: event.type,
          surfaceRevision: event.commit.surfaceRevision,
          catalogHash: event.commit.catalogHash,
        };
      case 'error':
        return {
          type: event.type,
          code: event.code,
          commitState: event.commitState,
          beforeStart: event.beforeStart ?? null,
        };
    }
  });
}

async function directBaseline(
  runtime: ReturnType<typeof makeRuntime>['runtime'],
): Promise<{ surfaceId: string; surfaceRevision: number }> {
  const setup = await runtime.generate({ catalogId: TEST_CATALOG_ID });
  assert.ok(setup.accepted);
  const outcome = await setup.run.result;
  assert.ok(outcome.terminal === 'succeeded');
  return outcome.commit;
}

/** 挂起首个真实读取的共享 surface runtime（排队/容量/409 用例）。 */
function makeHeldRuntime(options?: Partial<AgentRuntimeOptions>) {
  let releaseFirst!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let first = true;
  const held = makeSharedSurfaceRuntime({
    options: {
      ...options,
      createGenerationSource: (request) => {
        if (first) {
          first = false;
          return (async function* () {
            await gate;
            yield* surfaceMessages(request.surfaceId);
          })();
        }
        return surfaceMessages(request.surfaceId);
      },
    },
  });
  return { held, releaseFirst };
}

describe('S3.5.4 真实 HTTP 与非 Koa 同输入对测', () => {
  it('正常生成：事件序列、message 载荷、done 固定提交、查询 200 两条路径一致', async () => {
    const viaHttp = makeRuntime();
    const direct = makeRuntime();
    const { baseUrl, server } = await startApp(viaHttp.runtime);
    try {
      const { status, runIdHeader, frames } = await postJson(
        baseUrl,
        '/api/a2ui/generate',
        generateBody(),
      );
      assert.equal(status, 200);
      assert.ok(runIdHeader, 'HTTP 响应被占用即带运行标识头');
      const httpEvents = parseHttpEvents(frames);
      assert.equal(httpEvents.at(-1)?.type, 'done');

      const setup = await direct.runtime.generate({
        message: '对测生成',
        catalogId: TEST_CATALOG_ID,
      });
      assert.ok(setup.accepted);
      const directList = await directEvents(setup.run);

      assert.deepEqual(shapeOf(httpEvents), shapeOf(directList), '两条路径事件形状一致');
      const httpMessages = httpEvents.filter((e) => e.type === 'message').map((e) => e.message);
      const directMessages = directList.filter((e) => e.type === 'message').map((e) => e.message);
      assert.deepEqual(httpMessages, JSON.parse(JSON.stringify(directMessages)));

      const httpDone = httpEvents.at(-1)!;
      const directDone = directList.at(-1)!;
      assert.ok(httpDone.type === 'done' && directDone.type === 'done');
      assert.equal(httpDone.commit.runId, runIdHeader, 'done.runId ≡ 响应头');
      assert.equal(httpDone.commit.catalogHash, directDone.commit.catalogHash);
      assert.equal(httpDone.commit.surfaceRevision, directDone.commit.surfaceRevision);

      const query = await fetch(
        `${baseUrl}/api/a2ui/surface-state?surfaceId=${encodeURIComponent(httpDone.commit.surfaceId)}&runId=${encodeURIComponent(httpDone.commit.runId)}`,
      );
      assert.equal(query.status, 200);
      assert.deepEqual(await query.json(), JSON.parse(JSON.stringify(httpDone.commit)));
    } finally {
      await closeServer(server);
    }
  });

  it('带输入 action：start 实际基准、revision 前进与 done 载荷两条路径一致', async () => {
    // 共享 session-v1 fixture Catalog：RatingInput 声明 score 输入（integer 1..5），
    // 组件携带 { path: '/score' } 绑定，宿主白名单精确开放 /score。
    const fixtureRoot = new URL('../../../../fixtures/session-v1/', import.meta.url);
    const fixtureCatalog = (
      JSON.parse(readFileSync(new URL('catalog.json', fixtureRoot), 'utf8')) as {
        catalog: CatalogDefinition;
      }
    ).catalog;
    const fixtureHash = createCatalogContractHash(fixtureCatalog);
    const setupMessages = (surfaceId: string): unknown[] => [
      { version: 'v0.9', createSurface: { surfaceId, catalogId: fixtureCatalog.catalogId } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId,
          components: [
            { id: 'root', component: 'Column', children: ['rating-1', 'confirm-1'] },
            {
              id: 'rating-1',
              component: 'RatingInput',
              score: { path: '/score' },
              label: '评分',
              action: { event: { name: 'rate', context: { score: { path: '/score' } } } },
            },
            {
              id: 'confirm-1',
              component: 'ConfirmTrigger',
              label: '提交',
              action: { event: { name: 'submit' } },
            },
          ],
        },
      },
      { version: 'v0.9', updateDataModel: { surfaceId, value: { score: 3 } } },
    ];
    const makeInputRuntime = () => {
      let surfaceCounter = 0;
      return createAgentRuntime({
        access: allowAllAccess,
        registry: new CatalogRegistry([structuredClone(fixtureCatalog)]),
        createSurfaceId: () => `parity-input-${++surfaceCounter}`,
        editablePaths: () => ['/score'],
        createGenerationSource: (request) => setupMessages(request.surfaceId),
        actionHandlers: new Map([
          [
            `${fixtureCatalog.catalogId}:rate`,
            (action: AgentAction) => [
              {
                version: 'v0.9',
                updateDataModel: { surfaceId: action.surfaceId, value: { score: 4 } },
              },
            ],
          ],
        ]),
      });
    };
    const viaHttp = makeInputRuntime();
    const direct = makeInputRuntime();
    const { baseUrl, server } = await startApp(viaHttp);
    try {
      const setupDone = parseHttpEvents(
        (
          await postJson(baseUrl, '/api/a2ui/generate', {
            message: '对测生成',
            catalogId: fixtureCatalog.catalogId,
          })
        ).frames,
      ).at(-1)!;
      assert.ok(setupDone.type === 'done');
      const baseline = setupDone.commit;

      const { status, runIdHeader, frames } = await postJson(baseUrl, '/api/a2ui/event', {
        message: {
          version: 'v0.9',
          action: {
            name: 'rate',
            surfaceId: baseline.surfaceId,
            sourceComponentId: 'rating-1',
            timestamp: new Date().toISOString(),
            context: { score: { path: '/score' } },
            actionId: 'parity-input-1',
          },
        },
        nexus: {
          sessionVersion: 1,
          actionId: 'parity-input-1',
          surfaceRevision: baseline.surfaceRevision,
          catalogHash: fixtureHash,
          inputs: [{ componentId: 'rating-1', property: 'score', value: 4 }],
        },
      });
      assert.equal(status, 200);
      assert.ok(runIdHeader);
      const httpEvents = parseHttpEvents(frames);

      const directSetup = await direct.generate({ catalogId: fixtureCatalog.catalogId });
      assert.ok(directSetup.accepted);
      const directBaselineOutcome = await directSetup.run.result;
      assert.ok(directBaselineOutcome.terminal === 'succeeded');
      const directCommit = directBaselineOutcome.commit;
      const directAction = await direct.action({
        name: 'rate',
        surfaceId: directCommit.surfaceId,
        sourceComponentId: 'rating-1',
        timestamp: new Date().toISOString(),
        context: { score: { path: '/score' } },
        actionId: 'parity-input-1',
        sessionVersion: 1,
        surfaceRevision: directCommit.surfaceRevision,
        catalogHash: fixtureHash,
        inputs: [{ componentId: 'rating-1', property: 'score', value: 4 }],
      });
      assert.ok(directAction.accepted);
      const directList = await directEvents(directAction.run);

      assert.deepEqual(shapeOf(httpEvents), shapeOf(directList));
      const httpStart = httpEvents[0];
      const httpDone = httpEvents.at(-1)!;
      assert.ok(httpStart.type === 'start');
      assert.ok(httpDone.type === 'done');
      assert.equal(httpStart.surfaceRevision, baseline.surfaceRevision, 'start 携带实际基准');
      assert.ok(httpStart.surfaceRevision !== undefined);
      assert.equal(
        httpDone.commit.surfaceRevision,
        baseline.surfaceRevision + 1,
        'action 提交推进 revision',
      );
    } finally {
      await closeServer(server);
    }
  });

  it('准入拒绝（旧 revision）：RUN_ADMISSION_REJECTED parity、handler 零调用、查询 409', async () => {
    // 共享 surface：两次生成推进 revision 到 2，再以 revision 1 提交旧基准
    //（revision 0 不是合法正整数，会在 envelope 解析被 400，不入调度）。
    const viaHttp = makeSharedSurfaceRuntime();
    const direct = makeSharedSurfaceRuntime();
    const { baseUrl, server } = await startApp(viaHttp.runtime);
    try {
      const firstDone = parseHttpEvents(
        (await postJson(baseUrl, '/api/a2ui/generate', generateBody())).frames,
      ).at(-1)!;
      assert.ok(firstDone.type === 'done');
      const rebuildDone = parseHttpEvents(
        (await postJson(baseUrl, '/api/a2ui/generate', generateBody())).frames,
      ).at(-1)!;
      assert.ok(rebuildDone.type === 'done');
      assert.equal(rebuildDone.commit.surfaceRevision, firstDone.commit.surfaceRevision + 1);
      const staleRevision = firstDone.commit.surfaceRevision;
      const { status, runIdHeader, frames } = await postJson(
        baseUrl,
        '/api/a2ui/event',
        actionEnvelope(rebuildDone.commit.surfaceId, staleRevision, 'stale-http'),
      );
      assert.equal(status, 200, '已接受运行的调度内失败经 SSE error 报告');
      assert.ok(runIdHeader);
      const httpEvents = parseHttpEvents(frames);
      const httpError = httpEvents.at(-1)!;
      assert.ok(httpError.type === 'error');
      assert.equal(httpError.code, 'RUN_ADMISSION_REJECTED');
      assert.equal(httpError.commitState, 'notCommitted');

      await directBaseline(direct.runtime);
      const directRebuild = await direct.runtime.generate({ catalogId: TEST_CATALOG_ID });
      assert.ok(directRebuild.accepted);
      const directRebuildOutcome = await directRebuild.run.result;
      assert.ok(directRebuildOutcome.terminal === 'succeeded');
      const directAction = await direct.runtime.action(
        makeAction({ ...directRebuildOutcome.commit }, 'stale-direct', undefined, staleRevision),
      );
      // 旧 revision 在直接入口同样是已接受运行：失败在调度内收敛。
      assert.ok(directAction.accepted);
      const directList = await directEvents(directAction.run);

      assert.deepEqual(shapeOf(httpEvents), shapeOf(directList), '准入拒绝两条路径一致');
      assert.equal(viaHttp.handlerCalls(), 0, 'HTTP 路径 handler 未调用');
      assert.equal(direct.handlerCalls(), 0, '非 Koa 路径 handler 未调用');

      const failedQuery = await fetch(
        `${baseUrl}/api/a2ui/surface-state?surfaceId=${encodeURIComponent(rebuildDone.commit.surfaceId)}&runId=${encodeURIComponent(runIdHeader!)}`,
      );
      assert.equal(failedQuery.status, 409, '失败运行存在记录且无已确认结果');
    } finally {
      await closeServer(server);
    }
  });

  it('提交失败（非法候选）与提交不确定（store 确认丢失）两条路径 parity', async () => {
    const invalidPatch = () => [
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'x',
          components: [{ id: 'ghost', component: 'Ghost', child: 't' }],
        },
      },
    ];
    const httpFixture = makeRuntime({ actionMessages: invalidPatch });
    const directFixture = makeRuntime({ actionMessages: invalidPatch });
    const { baseUrl, server } = await startApp(httpFixture.runtime);
    try {
      const setupDone = parseHttpEvents(
        (await postJson(baseUrl, '/api/a2ui/generate', generateBody())).frames,
      ).at(-1)!;
      assert.ok(setupDone.type === 'done');
      const { frames } = await postJson(
        baseUrl,
        '/api/a2ui/event',
        actionEnvelope(
          setupDone.commit.surfaceId,
          setupDone.commit.surfaceRevision,
          'invalid-http',
        ),
      );
      const httpEvents = parseHttpEvents(frames);

      const directBase = await directBaseline(directFixture.runtime);
      const directAction = await directFixture.runtime.action(
        makeAction(directBase, 'invalid-direct'),
      );
      assert.ok(directAction.accepted);
      const directList = await directEvents(directAction.run);

      assert.deepEqual(shapeOf(httpEvents), shapeOf(directList));
      const terminal = httpEvents.at(-1)!;
      assert.ok(terminal.type === 'error');
      assert.equal(terminal.code, 'RUN_FAILED');
      assert.equal(terminal.commitState, 'notCommitted');
    } finally {
      await closeServer(server);
    }

    const unknownHttp = makeRuntime({ failCommitAction: true });
    const unknownDirect = makeRuntime({ failCommitAction: true });
    const unknownServer = await startApp(unknownHttp.runtime);
    try {
      const setupDone = parseHttpEvents(
        (await postJson(unknownServer.baseUrl, '/api/a2ui/generate', generateBody())).frames,
      ).at(-1)!;
      assert.ok(setupDone.type === 'done');
      const { frames } = await postJson(
        unknownServer.baseUrl,
        '/api/a2ui/event',
        actionEnvelope(
          setupDone.commit.surfaceId,
          setupDone.commit.surfaceRevision,
          'unknown-http',
        ),
      );
      const httpEvents = parseHttpEvents(frames);
      const terminal = httpEvents.at(-1)!;
      assert.ok(terminal.type === 'error');
      assert.equal(terminal.code, 'RUN_COMMIT_UNKNOWN');
      assert.equal(terminal.commitState, 'unknown');

      const directBase = await directBaseline(unknownDirect.runtime);
      const directAction = await unknownDirect.runtime.action(
        makeAction(directBase, 'unknown-direct'),
      );
      assert.ok(directAction.accepted);
      const directList = await directEvents(directAction.run);
      assert.deepEqual(shapeOf(httpEvents), shapeOf(directList), 'unknown 两条路径一致');
    } finally {
      await closeServer(unknownServer.server);
    }
  });

  it('空输出 action：合法一次提交，两条路径 done 一致', async () => {
    const viaHttp = makeRuntime();
    const direct = makeRuntime();
    const { baseUrl, server } = await startApp(viaHttp.runtime);
    try {
      const setupDone = parseHttpEvents(
        (await postJson(baseUrl, '/api/a2ui/generate', generateBody())).frames,
      ).at(-1)!;
      assert.ok(setupDone.type === 'done');
      const { frames } = await postJson(
        baseUrl,
        '/api/a2ui/event',
        actionEnvelope(setupDone.commit.surfaceId, setupDone.commit.surfaceRevision, 'empty-http'),
      );
      const httpEvents = parseHttpEvents(frames);

      const directBase = await directBaseline(direct.runtime);
      const directAction = await direct.runtime.action(makeAction(directBase, 'empty-direct'));
      assert.ok(directAction.accepted);
      const directList = await directEvents(directAction.run);

      assert.deepEqual(shapeOf(httpEvents), shapeOf(directList));
      assert.equal(httpEvents.at(-1)?.type, 'done');
    } finally {
      await closeServer(server);
    }
  });

  it('排队 HTTP 不回落 404：响应被占用即 200 + 运行标识头，先于前序运行完成', async () => {
    const { held, releaseFirst } = makeHeldRuntime();
    const { baseUrl, server } = await startApp(held.runtime);
    try {
      const firstResponse = await postStart(baseUrl, '/api/a2ui/generate', generateBody());
      assert.equal(firstResponse.status, 200);
      const firstRunId = firstResponse.headers.get('x-nexus-run-id');
      assert.ok(firstRunId);

      // 排队请求：headers 同步可得，body 在前序完成前不产出帧。
      const secondResponse = await postStart(baseUrl, '/api/a2ui/generate', generateBody());
      assert.equal(secondResponse.status, 200, '排队 run 不回落 404');
      const secondRunId = secondResponse.headers.get('x-nexus-run-id');
      assert.ok(secondRunId, '排队 run 同步带头');
      assert.notEqual(secondRunId, firstRunId);

      releaseFirst();
      const [first, second] = await Promise.all([
        readResponse(firstResponse),
        readResponse(secondResponse),
      ]);
      assert.match(first.text, /event: done/);
      assert.match(second.text, /event: done/, '排队 run 在获得槽位后完整执行并提交');
    } finally {
      releaseFirst();
      await closeServer(server);
    }
  });

  it('排队容量拒绝 503（RUN_CAPACITY_REJECTED）且无运行标识头', async () => {
    const { held, releaseFirst } = makeHeldRuntime({
      scheduler: { maxQueuedPerSurface: 1 },
    });
    const { baseUrl, server } = await startApp(held.runtime);
    try {
      void postStart(baseUrl, '/api/a2ui/generate', generateBody());
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      const queuedResponse = await postStart(baseUrl, '/api/a2ui/generate', generateBody());
      assert.equal(queuedResponse.status, 200, '第一席排队仍被接受');

      const rejected = await postJson(baseUrl, '/api/a2ui/generate', generateBody());
      assert.equal(rejected.status, 503);
      assert.equal(rejected.runIdHeader, undefined, '容量拒绝在占用前，无运行头');
      assert.equal(jsonError(rejected).error, 'RUN_CAPACITY_REJECTED');

      releaseFirst();
      const queued = await readResponse(queuedResponse);
      assert.match(queued.text, /event: done/, '排队 run 在释放后正常完成');
    } finally {
      releaseFirst();
      await closeServer(server);
    }
  });

  it('access 门禁：403 错误码区分未配置/拒绝，钩子收到 Koa Context，无运行标识头', async () => {
    const contexts: unknown[] = [];
    const denied = makeRuntime({
      options: {
        access: {
          generate: (_request, context) => {
            contexts.push(context);
            return false;
          },
          action: () => false,
        },
      },
    });
    const unconfigured = makeRuntime({ options: { access: undefined } });
    const deniedApp = await startApp(denied.runtime);
    const unconfiguredApp = await startApp(unconfigured.runtime);
    try {
      const deniedResponse = await postJson(
        deniedApp.baseUrl,
        '/api/a2ui/generate',
        generateBody(),
      );
      assert.equal(deniedResponse.status, 403);
      assert.equal(jsonError(deniedResponse).error, 'GENERATE_ACCESS_DENIED');
      assert.equal(deniedResponse.runIdHeader, undefined);
      const context = contexts[0] as { url?: string };
      assert.ok(context?.url?.includes('/api/a2ui/generate'), '钩子收到传输的 Koa Context');

      const unconfiguredResponse = await postJson(
        unconfiguredApp.baseUrl,
        '/api/a2ui/generate',
        generateBody(),
      );
      assert.equal(unconfiguredResponse.status, 403);
      assert.equal(jsonError(unconfiguredResponse).error, 'GENERATE_ACCESS_NOT_CONFIGURED');
    } finally {
      await closeServer(deniedApp.server);
      await closeServer(unconfiguredApp.server);
    }
  });

  it('查询路由：400 缺参数、403 read 准入、404 未知 runId、409 排队中', async () => {
    const readDenied = makeRuntime({
      options: { access: { ...allowAllAccess, read: () => false } },
    });
    const deniedApp = await startApp(readDenied.runtime);
    try {
      const missing = await fetch(`${deniedApp.baseUrl}/api/a2ui/surface-state?surfaceId=s`);
      assert.equal(missing.status, 400, '参数缺失先于准入');

      const forbidden = await fetch(
        `${deniedApp.baseUrl}/api/a2ui/surface-state?surfaceId=s&runId=r`,
      );
      assert.equal(forbidden.status, 403);
      assert.equal(((await forbidden.json()) as { error?: string }).error, 'RUNS_ACCESS_DENIED');

      const runsDenied = await fetch(`${deniedApp.baseUrl}/api/a2ui/runs?surfaceId=s`);
      assert.equal(runsDenied.status, 403);
      assert.equal(((await runsDenied.json()) as { error?: string }).error, 'RUNS_ACCESS_DENIED');
    } finally {
      await closeServer(deniedApp.server);
    }

    const openApp = await startApp(makeRuntime().runtime);
    try {
      const notFound = await fetch(`${openApp.baseUrl}/api/a2ui/surface-state?surfaceId=s&runId=r`);
      assert.equal(notFound.status, 404);
    } finally {
      await closeServer(openApp.server);
    }

    const { held, releaseFirst } = makeHeldRuntime();
    const queuedApp = await startApp(held.runtime);
    try {
      void postStart(queuedApp.baseUrl, '/api/a2ui/generate', generateBody());
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      const queuedResponse = await postStart(
        queuedApp.baseUrl,
        '/api/a2ui/generate',
        generateBody(),
      );
      assert.equal(queuedResponse.status, 200);
      const queuedRunId = queuedResponse.headers.get('x-nexus-run-id');
      assert.ok(queuedRunId);
      const record = held.runtime.runManager.get(queuedRunId);
      assert.ok(record, '入队成功即建立 queued 记录');
      const conflict = await fetch(
        `${queuedApp.baseUrl}/api/a2ui/surface-state?surfaceId=${encodeURIComponent(record.surfaceId)}&runId=${encodeURIComponent(queuedRunId)}`,
      );
      assert.equal(conflict.status, 409, '排队中运行无可确认结果，不回退最新快照');

      releaseFirst();
      const queued = await readResponse(queuedResponse);
      assert.match(queued.text, /event: done/);
    } finally {
      releaseFirst();
      await closeServer(queuedApp.server);
    }
  });

  it('真实 HTTP 断连在路由向 sender 交接后取消运行，阻止晚到提交并释放 surface', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let observeAbort!: () => void;
    const aborted = new Promise<void>((resolve) => {
      observeAbort = resolve;
    });
    let observeTerminal!: () => void;
    const terminal = new Promise<void>((resolve) => {
      observeTerminal = resolve;
    });
    let first = true;
    let sourceClosed = false;
    let observeSourceExit!: () => void;
    const sourceExited = new Promise<void>((resolve) => {
      observeSourceExit = resolve;
    });
    const { runtime } = makeSharedSurfaceRuntime({
      options: {
        createGenerationSource: (request) => {
          if (!first) return surfaceMessages(request.surfaceId);
          first = false;
          assert.ok(request.signal);
          request.signal.addEventListener('abort', observeAbort, { once: true });
          return (async function* () {
            try {
              await gate;
              yield* surfaceMessages(request.surfaceId);
            } finally {
              sourceClosed = true;
              observeSourceExit();
            }
          })();
        },
      },
    });
    const transition = runtime.runManager.transition.bind(runtime.runManager);
    runtime.runManager.transition = (id, state, message) => {
      transition(id, state, message);
      if (state === 'canceled') observeTerminal();
    };
    const { baseUrl, server } = await startApp(runtime, { streamDelayMs: 0 });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('HTTP disconnect did not cancel run')), 5000);
    });
    try {
      const response = await postStart(baseUrl, '/api/a2ui/generate', generateBody());
      assert.equal(response.status, 200);
      const runId = response.headers.get('x-nexus-run-id');
      assert.ok(runId);
      assert.ok(response.body);
      const reader = response.body.getReader();
      const firstFrame = await reader.read();
      assert.equal(firstFrame.done, false, '实际读取已接管响应的 Session 数据');
      await reader.cancel();
      await Promise.race([aborted, expired]);
      release();
      await Promise.race([terminal, expired]);
      assert.equal(runtime.runManager.get(runId)?.state, 'canceled');
      await sourceExited;
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.ok(sourceClosed);
      assert.equal(await runtime.adapter.describeSurfaceContract('parity-shared'), undefined);
      const recovered = await postJson(baseUrl, '/api/a2ui/generate', generateBody());
      assert.equal(parseHttpEvents(recovered.frames).at(-1)?.type, 'done');
    } finally {
      clearTimeout(timeout);
      release();
      await closeServer(server);
    }
  });

  it('void 调用风格下事件仍逐条流式到达（真实 socket 增量投递）', async () => {
    const paced = makeRuntime();
    const { baseUrl, server } = await startApp(paced.runtime, { streamDelayMs: 120 });
    try {
      const response = await fetch(`${baseUrl}/api/a2ui/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(generateBody()),
      });
      assert.equal(response.status, 200);
      assert.ok(response.body);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const arrivals: number[] = [];
      let buffer = '';
      const started = Date.now();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const at = Date.now();
        buffer += decoder.decode(value, { stream: true });
        let boundary: RegExpExecArray | null;
        while ((boundary = /\n\n/.exec(buffer)) !== null) {
          const frame = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + 2);
          if (frame.startsWith('event: message')) arrivals.push(at - started);
        }
        if (arrivals.length >= 3) break;
      }
      await reader.cancel().catch(() => undefined);
      assert.ok(arrivals.length >= 3, `应至少收到 3 条 message 帧，实际 ${arrivals.length}`);
      const spread = arrivals.at(-1)! - arrivals[0];
      assert.ok(spread >= 100, `message 帧应逐条到达（间隔 ≥100ms），实际首末差 ${spread}ms`);
    } finally {
      await closeServer(server);
    }
  });

  it('占用失败交回 Koa 错误处理：真实响应不是伪 SSE，源工厂不执行', async () => {
    let calls = 0;
    let flushCalls = 0;
    const { runtime } = makeRuntime({
      options: {
        createGenerationSource: (request) => {
          calls++;
          return surfaceMessages(request.surfaceId);
        },
      },
    });
    let handle: RuntimeRunHandle | undefined;
    const app = new Koa();
    app.on('error', () => undefined); // Expected injected transport failure.
    app.use(async (ctx) => {
      const queued = await runtime.generate({ catalogId: TEST_CATALOG_ID });
      assert.ok(queued.accepted);
      handle = queued.run;
      ctx.res.flushHeaders = () => {
        flushCalls++;
        throw new Error('injected response claim failure');
      };
      await sendAgentRun(ctx, queued.run);
    });
    const server = app.listen(0, '127.0.0.1');
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(response.status, 500);
      assert.doesNotMatch(response.headers.get('content-type') ?? '', /text\/event-stream/);
      assert.equal(response.headers.get('X-Nexus-Run-Id'), null);
      assert.equal(await response.text(), 'Internal Server Error');
      assert.equal(flushCalls, 1, 'failure must reach the injected response claim boundary');
      assert.ok(handle);
      assert.equal((await handle.result).terminal, 'canceled');
      assert.equal(calls, 0);
      assert.equal(await runtime.adapter.describeSurfaceContract(handle.surfaceId), undefined);
    } finally {
      handle?.dispose();
      await closeServer(server);
    }
  });
});
