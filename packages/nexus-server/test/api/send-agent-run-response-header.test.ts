import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import Koa from 'koa';
import type KoaType from 'koa';
import {
  CatalogRegistry,
  parseSurfaceCommit,
  standardCatalogComponentDeclarations,
} from '@nexus-ui/core';
import type { CatalogDefinition, NexusSurfaceCommit } from '@nexus-ui/core';
import { AgentAdapter } from '../../src/agent/adapter';
import type { AgentRun } from '../../src/agent/adapter';
import {
  CATALOG_CONTRACT_VERSION,
  createCatalogContractHash,
} from '../../src/agent/catalog-contract';
import { InMemoryAgentRunManager } from '../../src/agent/run-manager';
import { sendAgentRun } from '../../src/api/send-messages';

/**
 * S2.5.4 响应头与传输关联（真实 HTTP 断言）：
 * - 生成与 action 均在同步占用 SSE 响应（flushHeaders）之前携带 `X-Nexus-Run-Id`，
 *   值为该次运行的唯一不可变 ID，与 SSE event id 前缀、成功 done 载荷同值；
 * - 排队 run 同样在被占用时就带头，且不先于排队等待启动；
 * - 取消后运行终止、释放同 surface 队列，晚到的旧运行帧不能复活旧标识；
 * - 兼容签名的字符串实参仍被忽略，响应头只取 `run.runId`。
 * 消费者以响应头与成功 done 关联本次运行；SDK 不提供解析 event id 猜 runId 的途径。
 */

const RUN_ID_HEADER = 'X-Nexus-Run-Id';

const HEADER_CATALOG_ID = 'https://example.com/catalogs/run-header/v1';
const headerCatalog: CatalogDefinition = {
  catalogId: HEADER_CATALOG_ID,
  components: standardCatalogComponentDeclarations(),
  actions: [
    {
      name: 'refresh',
      sources: ['Button'],
      paramSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { note: { type: 'string' } },
      },
    },
  ],
};
const registry = new CatalogRegistry([headerCatalog]);
const catalogHash = createCatalogContractHash(headerCatalog);

const SURFACE = 's-run-header';

function generationMessages(): unknown[] {
  return [
    { version: 'v0.9', createSurface: { surfaceId: SURFACE, catalogId: HEADER_CATALOG_ID } },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: SURFACE,
        components: [
          { id: 'root', component: 'Column', children: ['note', 'button', 'label'] },
          { id: 'note', component: 'TextField', label: 'Note', value: { path: '/note' } },
          {
            id: 'button',
            component: 'Button',
            child: 'label',
            action: { event: { name: 'refresh', context: { note: { path: '/note' } } } },
          },
          { id: 'label', component: 'Text', text: 'Refresh' },
        ],
      },
    },
    { version: 'v0.9', updateDataModel: { surfaceId: SURFACE, value: { note: '' } } },
  ];
}

function createAdapter(): AgentAdapter {
  let handlerCalls = 0;
  const adapter = new AgentAdapter({
    registry,
    createSurfaceId: () => SURFACE,
    createGenerationSource: () => generationMessages()[Symbol.iterator](),
  });
  adapter.registerActionHandler(HEADER_CATALOG_ID, 'refresh', async (action) => {
    handlerCalls += 1;
    return (async function* () {
      yield {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: action.surfaceId,
          value: { note: `refreshed-${handlerCalls}` },
        },
      };
    })();
  });
  return adapter;
}

function commitFixture(runId: string, surfaceId: string): NexusSurfaceCommit {
  return {
    sessionVersion: 1,
    runId,
    surfaceId,
    catalogId: HEADER_CATALOG_ID,
    contractVersion: CATALOG_CONTRACT_VERSION,
    catalogHash,
    surfaceRevision: 1,
  };
}

/** 持等待 promise 的自定义 action run：首条消息后挂起，release 后继续。 */
function createHeldActionRun(
  surfaceId: string,
  runId: string,
  started: string[],
  holds: Array<() => void>,
  onFirstMessage?: () => void,
): AgentRun {
  return {
    runId,
    source: (async function* () {
      started.push(runId);
      yield { version: 'v0.9', updateDataModel: { surfaceId, value: { step: 1 } } };
      onFirstMessage?.();
      await new Promise<void>((resolve) => holds.push(resolve));
      yield { version: 'v0.9', updateDataModel: { surfaceId, value: { step: 2 } } };
    })(),
    sequence: {
      kind: 'action',
      surfaceId,
      catalogId: HEADER_CATALOG_ID,
      registry,
      supportedActions: [],
    },
    commit: () => commitFixture(runId, surfaceId),
  };
}

/** 立即完成的自定义 action run：单条消息后提交。 */
function createInstantActionRun(surfaceId: string, runId: string, started: string[]): AgentRun {
  return {
    runId,
    source: (async function* () {
      started.push(runId);
      yield { version: 'v0.9', updateDataModel: { surfaceId, value: { final: true } } };
    })(),
    sequence: {
      kind: 'action',
      surfaceId,
      catalogId: HEADER_CATALOG_ID,
      registry,
      supportedActions: [],
    },
    commit: () => commitFixture(runId, surfaceId),
  };
}

async function withServer(app: Koa, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = app.listen(0) as Server;
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
}

function doneCommit(text: string): NexusSurfaceCommit {
  const frame = text.split('\n\n').find((candidate) => candidate.startsWith('event: done'));
  assert.ok(frame, `缺少 done 帧：\n${text}`);
  const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
  assert.ok(dataLine, 'done 帧缺少 data 行');
  const commit = parseSurfaceCommit(JSON.parse(dataLine.slice(6)));
  assert.ok(commit, 'done 载荷必须是合法 NexusSurfaceCommit');
  return commit;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 记录型 mock ctx：`set` 写入 headers 表，`flushHeaders` 快照当时的运行标识头。
 * runToCompletion 保持 res 处于 flowing 模式并等待发送 promise 结束，避免挂起。
 */
function createRecordingClaimContext(): {
  headers: Map<string, string>;
  seenAtFlush: () => string | undefined;
  ctx: KoaType.Context;
  runToCompletion: (queued: Promise<unknown>) => Promise<void>;
} {
  const headers = new Map<string, string>();
  let snapshotAtFlush: string | undefined;
  // mock res 只需要 flushHeaders 可写（send-messages 以可选调用触发快照断言）。
  const res = new PassThrough() as PassThrough & { flushHeaders?: () => void };
  res.flushHeaders = function flush(): void {
    snapshotAtFlush = headers.get(RUN_ID_HEADER);
  };
  let body: unknown;
  const ctx = {
    status: 200,
    set: (key: string, value: string) => {
      headers.set(key, value);
    },
    res,
    get body() {
      return body;
    },
    set body(value: unknown) {
      body = value;
    },
  } as unknown as KoaType.Context;
  return {
    headers,
    seenAtFlush: () => snapshotAtFlush,
    ctx,
    runToCompletion: async (queued) => {
      res.resume(); // 保持 flowing，流数据可丢弃
      await queued;
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    assert.ok(Date.now() <= deadline, '等待条件超时');
    await sleep(10);
  }
}

describe('X-Nexus-Run-Id 响应头与传输关联（S2.5.4）', () => {
  it('生成路径：SSE 响应携带运行标识头，与 event id 前缀、done 载荷同值', async () => {
    const adapter = createAdapter();
    const app = new Koa();
    app.use(async (ctx) => {
      if (ctx.path !== '/generate') {
        ctx.status = 404;
        return;
      }
      const plan = await adapter.prepareGeneration({ catalogId: HEADER_CATALOG_ID });
      assert.ok(plan.ok);
      void sendAgentRun(ctx, plan.run, { streamDelayMs: 0 });
    });

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/generate`, { method: 'POST' });
      assert.equal(response.status, 200);
      const header = response.headers.get(RUN_ID_HEADER);
      assert.ok(header, '响应必须在 flushHeaders 前携带 X-Nexus-Run-Id');

      const text = await response.text();
      assert.match(text, /event: done/);
      assert.ok(text.includes(`id: ${header}:0`), '首个 event id 与响应头同值');
      assert.ok(text.includes(`id: ${header}:done`), 'done event id 与响应头同值');
      const commit = doneCommit(text);
      assert.equal(commit.runId, header, 'done 载荷 runId 与响应头一致');

      const record = adapter.runManager.get(header);
      assert.equal(record?.state, 'succeeded');
      assert.deepEqual(record?.commit, commit);
    });
  });

  it('action 路径：同一不变式成立，且 handler 实际执行', async () => {
    const adapter = createAdapter();
    let latestRevision = 0;
    let actionCounter = 0;
    const app = new Koa();
    app.use(async (ctx) => {
      if (ctx.path === '/generate') {
        const plan = await adapter.prepareGeneration({ catalogId: HEADER_CATALOG_ID });
        assert.ok(plan.ok);
        void sendAgentRun(ctx, plan.run, { streamDelayMs: 0 });
        return;
      }
      if (ctx.path === '/action') {
        const plan = await adapter.prepareAction({
          name: 'refresh',
          surfaceId: SURFACE,
          sourceComponentId: 'button',
          timestamp: new Date().toISOString(),
          context: { note: '' },
          actionId: `header-action-${actionCounter++}`,
          sessionVersion: 1,
          surfaceRevision: latestRevision,
          catalogHash,
        });
        assert.ok(plan.ok);
        void sendAgentRun(ctx, plan.run, { streamDelayMs: 0 });
        return;
      }
      ctx.status = 404;
    });

    await withServer(app, async (base) => {
      const generation = await fetch(`${base}/generate`, { method: 'POST' });
      const generationCommit = doneCommit(await generation.text());
      latestRevision = generationCommit.surfaceRevision;

      const response = await fetch(`${base}/action`, { method: 'POST' });
      assert.equal(response.status, 200);
      const header = response.headers.get(RUN_ID_HEADER);
      assert.ok(header, 'action SSE 响应必须在 flushHeaders 前携带 X-Nexus-Run-Id');
      assert.notEqual(header, generationCommit.runId, 'action 运行标识独立于生成运行');

      const text = await response.text();
      assert.ok(text.includes(`id: ${header}:0`));
      const commit = doneCommit(text);
      assert.equal(commit.runId, header);
      assert.equal(commit.surfaceRevision, latestRevision + 1);
      assert.match(text, /refreshed-1/, 'action handler 必须实际执行');
      assert.equal(adapter.runManager.get(header)?.state, 'succeeded');
    });
  });

  it('排队 run 在响应被占用时即带头，先于其排队等待启动', async () => {
    const manager = new InMemoryAgentRunManager();
    const surface = 's-header-queued';
    const started: string[] = [];
    const holds: Array<() => void> = [];
    let requestIndex = 0;
    let notifyFirstMessage: () => void = () => undefined;
    const firstMessageSeen = new Promise<void>((resolve) => {
      notifyFirstMessage = resolve;
    });

    const app = new Koa();
    app.use(async (ctx) => {
      if (ctx.path !== '/stream') {
        ctx.status = 404;
        return;
      }
      const index = requestIndex++;
      // run 0 挂起以维持队列；run 1 一旦出队即可自行完成。
      const run =
        index === 0
          ? createHeldActionRun(
              surface,
              `header-queued-${index}`,
              started,
              holds,
              notifyFirstMessage,
            )
          : createInstantActionRun(surface, `header-queued-${index}`, started);
      void sendAgentRun(ctx, run, { manager, streamDelayMs: 0 });
    });

    await withServer(app, async (base) => {
      const firstResponsePromise = fetch(`${base}/stream`);
      await firstMessageSeen; // run 0 已产出首条消息并挂起

      const firstResponse = await firstResponsePromise;
      // run 1 排队中：fetch 解析即代表响应已被同步占用（带头）。
      const secondResponse = await fetch(`${base}/stream`);
      assert.equal(secondResponse.status, 200, '排队 run 的响应同样被同步占用，不回落 404');

      const firstHeader = firstResponse.headers.get(RUN_ID_HEADER);
      const secondHeader = secondResponse.headers.get(RUN_ID_HEADER);
      assert.ok(firstHeader, '运行中的 run 响应带头');
      assert.ok(secondHeader, '排队 run 的响应在占用时即带头');
      assert.notEqual(firstHeader, secondHeader, '同 surface 两次运行标识互不相同');
      assert.equal(secondHeader, 'header-queued-1');
      assert.deepEqual(started, ['header-queued-0'], '排队 run 不得在等待期间启动');

      for (const release of holds) release();
      const [firstText, secondText] = await Promise.all([
        firstResponse.text(),
        secondResponse.text(),
      ]);
      assert.equal(doneCommit(firstText).runId, firstHeader);
      assert.equal(doneCommit(secondText).runId, secondHeader);
    });
  });

  it('取消：客户端断开后运行终止，后续 run 获得新标识（晚到帧不复活旧运行）', async () => {
    const manager = new InMemoryAgentRunManager();
    const surface = 's-header-cancel';
    const started: string[] = [];
    const holds: Array<() => void> = [];
    let requestIndex = 0;
    let serverSawClose = false;

    const app = new Koa();
    app.use(async (ctx) => {
      if (ctx.path !== '/stream') {
        ctx.status = 404;
        return;
      }
      const index = requestIndex++;
      if (index === 0)
        ctx.res.once('close', () => {
          serverSawClose = true;
        });
      const run =
        index === 0
          ? createHeldActionRun(surface, 'header-cancel-a', started, holds)
          : createInstantActionRun(surface, 'header-cancel-b', started);
      void sendAgentRun(ctx, run, { manager, streamDelayMs: 0 });
    });

    await withServer(app, async (base) => {
      const controller = new AbortController();
      const response = await fetch(`${base}/stream`, { signal: controller.signal });
      const headerA = response.headers.get(RUN_ID_HEADER);
      assert.equal(headerA, 'header-cancel-a', '被取消的 run 在断开前已携带响应头');
      const reader = response.body?.getReader();
      assert.ok(reader, 'SSE 响应必须有可读流');
      const decoder = new TextDecoder();
      let raw = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        if (raw.includes('event: message')) break;
      }

      controller.abort();
      await assert.rejects(() => reader.read(), /abort/i, '客户端断开后连接终止');
      // 服务端已观察到断开、源已挂起到等待点，再释放以触发取消检查点。
      await waitFor(() => serverSawClose && holds.length > 0);
      for (const release of holds) release();
      await waitFor(() => manager.get('header-cancel-a')?.state === 'canceled');

      // 晚到/取消回归：同 surface 的后续 run 正常执行，并携带自己的新标识。
      const responseB = await fetch(`${base}/stream`);
      const headerB = responseB.headers.get(RUN_ID_HEADER);
      assert.equal(headerB, 'header-cancel-b');
      assert.notEqual(headerA, headerB);
      const textB = await responseB.text();
      const commitB = doneCommit(textB);
      assert.equal(commitB.runId, headerB);
      assert.equal(manager.get(headerA)?.state, 'canceled', '旧运行保持取消终态');
    });
  });

  it('运行标识头在 flushHeaders 之前写入（占用时序单测）', async () => {
    const { headers, ctx, runToCompletion, seenAtFlush } = createRecordingClaimContext();
    const started: string[] = [];
    const run = createInstantActionRun('s-header-flush', 'header-flush-run', started);
    const queued = sendAgentRun(ctx, run, {
      manager: new InMemoryAgentRunManager(),
      streamDelayMs: 0,
    });
    // claimSseResponse 同步返回：此刻 flushHeaders 已经执行过。
    assert.equal(seenAtFlush(), 'header-flush-run', 'flushHeaders 执行时运行标识头必须已写入');
    assert.equal(headers.get(RUN_ID_HEADER), 'header-flush-run');
    await runToCompletion(queued);
  });

  it('兼容签名的字符串实参仍被忽略：响应头取 run.runId 而非 idPrefix', async () => {
    const { headers, ctx, runToCompletion, seenAtFlush } = createRecordingClaimContext();
    const started: string[] = [];
    const run = createInstantActionRun('s-header-legacy', 'header-legacy-run', started);
    const manager = new InMemoryAgentRunManager();
    const queued = sendAgentRun(ctx, run, 'legacy-prefix-not-an-id', {
      manager,
      streamDelayMs: 0,
    });
    assert.equal(seenAtFlush(), 'header-legacy-run', '不得以兼容 idPrefix 作为响应头身份');
    assert.equal(headers.get(RUN_ID_HEADER), 'header-legacy-run');
    await runToCompletion(queued);
    assert.equal(manager.get('header-legacy-run')?.commit?.runId, 'header-legacy-run');
  });
});
