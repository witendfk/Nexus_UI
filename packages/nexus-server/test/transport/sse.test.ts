import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Context } from 'koa';
import { prepareSseResponse } from '../../src/transport/sse';

/**
 * S2.5.4：SSE 运行标识响应头在响应头准备阶段（flushHeaders 之前）写入。
 * - 提供 runId 时写入 `X-Nexus-Run-Id`，值为该次运行的唯一不可变 ID；
 * - 非 SDK 运行路径（原始 sendMessages）不携带该头；
 * - 非法 runId 显式报错，且不得留下已部分写入的 SSE 响应头。
 */

const RUN_ID_HEADER = 'X-Nexus-Run-Id';

function createHeaderRecorderCtx(): { ctx: Context; headers: Map<string, string> } {
  const headers = new Map<string, string>();
  const ctx = {
    status: 200,
    set: (key: string, value: string) => {
      headers.set(key, value);
    },
  } as unknown as Context;
  return { ctx, headers };
}

describe('SSE 运行标识响应头（S2.5.4）', () => {
  it('prepareSseResponse 写入 X-Nexus-Run-Id，与既有 SSE 头同批生效', () => {
    const { ctx, headers } = createHeaderRecorderCtx();
    prepareSseResponse(ctx, { runId: 'run-header-1' });
    assert.equal(headers.get(RUN_ID_HEADER), 'run-header-1');
    assert.equal(headers.get('Content-Type'), 'text/event-stream; charset=utf-8');
    assert.equal(headers.get('Cache-Control'), 'no-cache, no-transform');
  });

  it('无 runId（原始 sendMessages 非 SDK 运行路径）不携带运行标识头', () => {
    const { ctx, headers } = createHeaderRecorderCtx();
    prepareSseResponse(ctx);
    assert.equal(headers.has(RUN_ID_HEADER), false);
    assert.equal(headers.get('Content-Type'), 'text/event-stream; charset=utf-8');
  });

  it('空运行标识显式报错，且不写入任何响应头', () => {
    const { ctx, headers } = createHeaderRecorderCtx();
    assert.throws(() => prepareSseResponse(ctx, { runId: '' }), /非空字符串/);
    assert.equal(headers.size, 0, '报错不得留下半占用的 SSE 响应头');
  });
});
