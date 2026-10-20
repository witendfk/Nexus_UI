process.env.NODE_ENV = 'test';
delete process.env.OPENAI_API_KEY;

import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import Koa from 'koa';
import type KoaType from 'koa';
import type { NexusSurfaceCommit } from '@nexus-ui/core';
import { sendAgentRun } from '../src/api/send-messages';
import type { AgentRun } from '../src/agent/adapter';
import { InMemoryAgentRunManager } from '../src/agent/run-manager';
import { CATALOG_CONTRACT_VERSION, createCatalogContractHash } from '../src/agent/catalog-contract';
import { TEST_CATALOG_ID, createTestRegistry } from './helpers/test-catalog';

const registry = createTestRegistry();
const TEST_CATALOG_HASH = createCatalogContractHash(registry.get(TEST_CATALOG_ID)!);

/**
 * sendAgentRun 的两条对外契约，都关于"响应什么时候属于这次 run"：
 *
 * 1. 占用时机：Koa 只在中间件链结束后的 respond() 阶段把 ctx.body 交给 socket，
 *    因此 ctx.body 必须在 sendAgentRun 返回前被同步赋值。否则同 surface 的第二个
 *    run 会被排进 per-surface 队列、响应却从未被占用，Koa 回落到 404 —— 而队列里
 *    的 run 依旧会继续流式输出并 commit，客户端看到失败、服务端已经成功。
 * 2. 生命周期归属：SDK 必须自己把流接到 socket 上（ctx.respond = false + pipe），
 *    不能依赖 respond()。否则宿主一旦 await sendAgentRun(...)，链结束被推迟到流
 *    末尾，整条流会被缓冲成一次下发，逐条可见预览退化为一次性到达。
 *
 * S2.5.1 迁移：自定义 AgentRun 必须携带运行创建方分配的 runId，且 commit 返回
 * 固定 NexusSurfaceCommit；发送层以 run.runId 作为唯一运行标识，不再改写。
 */

function commitFixture(runId: string, surfaceId: string): NexusSurfaceCommit {
  return {
    sessionVersion: 1,
    runId,
    surfaceId,
    catalogId: TEST_CATALOG_ID,
    contractVersion: CATALOG_CONTRACT_VERSION,
    catalogHash: TEST_CATALOG_HASH,
    surfaceRevision: 1,
  };
}

function createActionRun(
  surfaceId: string,
  runId: string,
  hold: Promise<void>,
  onCommit: () => void,
): AgentRun {
  return {
    runId,
    source: (async function* () {
      yield { version: 'v0.9', updateDataModel: { surfaceId, value: { step: 1 } } };
      await hold;
      yield { version: 'v0.9', updateDataModel: { surfaceId, value: { step: 2 } } };
    })(),
    sequence: {
      kind: 'action',
      surfaceId,
      catalogId: TEST_CATALOG_ID,
      registry,
      supportedActions: [],
    },
    commit: () => {
      onCommit();
      return commitFixture(runId, surfaceId);
    },
  };
}

function createPacedRun(surfaceId: string, runId: string): AgentRun {
  return {
    runId,
    source: (async function* () {
      for (let step = 1; step <= 3; step += 1) {
        yield { version: 'v0.9', updateDataModel: { surfaceId, value: { step } } };
      }
    })(),
    sequence: {
      kind: 'action',
      surfaceId,
      catalogId: TEST_CATALOG_ID,
      registry,
      supportedActions: [],
    },
    commit: () => commitFixture(runId, surfaceId),
  };
}

function createMockContext(): KoaType.Context {
  let body: unknown;
  return {
    status: 200,
    set: () => undefined,
    // res 必须是可写流：claimSseResponse 会 pipe 到它（ctx.respond = false）。
    res: new PassThrough(),
    get body() {
      return body;
    },
    set body(value: unknown) {
      body = value;
    },
  } as unknown as KoaType.Context;
}

describe('SSE 响应占用时机', () => {
  it('sendAgentRun 在返回前就占用 ctx.body', () => {
    const ctx = createMockContext();
    const never = new Promise<void>(() => undefined);

    void sendAgentRun(
      ctx,
      createActionRun('surface-claim-unit', 'claim-unit-run', never, () => undefined),
      {
        streamDelayMs: 0,
        manager: new InMemoryAgentRunManager(),
      },
    );

    assert.ok(
      ctx.body instanceof PassThrough,
      'ctx.body 必须在 sendAgentRun 返回前同步装配；晚一个微任务，Koa 就会在链结束时回落到 404',
    );
  });

  it('同 surface 的并发请求都拿到 SSE 流，且各自提交一次', { timeout: 10_000 }, async () => {
    const surfaceId = 'surface-claim-concurrent';
    const releases: Array<() => void> = [];
    let started = 0;
    let commits = 0;
    let firstMessageResolve: () => void = () => undefined;
    const firstMessage = new Promise<void>((resolve) => {
      firstMessageResolve = resolve;
    });

    const app = new Koa();
    app.use(async (ctx) => {
      if (ctx.path !== '/stream') {
        ctx.status = 404;
        return;
      }
      const index = started++;
      let release: () => void = () => undefined;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      releases.push(release);
      const run = createActionRun(surfaceId, `claim-run-${index}`, hold, () => {
        commits += 1;
      });
      const source = run.source;
      run.source = (async function* () {
        for await (const message of source) {
          if (index === 0 && 'updateDataModel' in (message as object)) firstMessageResolve();
          yield message;
        }
      })();
      void sendAgentRun(ctx, run, {
        streamDelayMs: 0,
        manager: new InMemoryAgentRunManager(),
      });
    });

    const server = app.listen(0) as Server;
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const firstResponsePromise = fetch(`${baseUrl}/stream?surface=${surfaceId}`);
      await firstMessage;

      const secondResponse = await fetch(`${baseUrl}/stream?surface=${surfaceId}`);

      assert.equal(
        secondResponse.status,
        200,
        '第二个同 surface 请求必须同样拿到 SSE 响应，而不是 Koa 的 404 兜底',
      );
      assert.match(secondResponse.headers.get('content-type') ?? '', /text\/event-stream/);

      for (const release of releases) release();

      const [firstText, secondText] = await Promise.all([
        firstResponsePromise.then((response) => response.text()),
        secondResponse.text(),
      ]);

      assert.match(firstText, /event: done/, '第一个 run 必须收到 done');
      assert.match(secondText, /event: done/, '第二个 run 必须收到 done');
      assert.equal(commits, 2, '两个 run 都必须提交；修复不能以丢弃第二个 run 为代价');
    } finally {
      for (const release of releases) release();
      server.closeAllConnections?.();
      server.close();
    }
  });

  it('宿主 await sendAgentRun 也必须保持逐条到达', { timeout: 10_000 }, async () => {
    const surfaceId = 'surface-claim-await';

    const app = new Koa();
    app.use(async (ctx) => {
      if (ctx.path !== '/await') {
        ctx.status = 404;
        return;
      }
      // 反例形态：处理器 await 到流结束。若 SDK 依赖 Koa 的 respond() 才 pipe，
      // 链结束被推迟到流末尾，整条流会缓冲成一次读取。
      await sendAgentRun(ctx, createPacedRun(surfaceId, 'claim-await-run'), {
        streamDelayMs: 60,
        manager: new InMemoryAgentRunManager(),
      });
    });

    const server = app.listen(0) as Server;
    const { port } = server.address() as AddressInfo;

    try {
      const startedAt = Date.now();
      const response = await fetch(`http://127.0.0.1:${port}/await`);
      assert.equal(response.status, 200);

      const reader = response.body?.getReader();
      assert.ok(reader, 'SSE 响应必须有可读流');
      const decoder = new TextDecoder();
      const arrivals: Array<{ at: number; frames: number }> = [];
      let raw = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        arrivals.push({ at: Date.now() - startedAt, frames: raw.split('\n\n').length - 1 });
      }
      const totalMs = Date.now() - startedAt;

      assert.ok(
        arrivals.length > 1,
        `宿主 await 时整条流被缓冲成 ${arrivals.length} 次读取，逐条可见预览失效`,
      );
      assert.ok(
        arrivals[0]!.at < totalMs / 2,
        `首帧 ${arrivals[0]!.at}ms 与流结束 ${totalMs}ms 几乎同时到达，说明没有增量下发`,
      );
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });
});
