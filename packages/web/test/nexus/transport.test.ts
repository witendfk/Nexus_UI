import { describe, expect, it, vi } from 'vitest';
import type { A2UIRuntime } from '@nexus-ui/core';
import { streamIntoRuntime } from '../../src/nexus/transport';

function fakeRuntime(): A2UIRuntime {
  return { push: vi.fn(), end: vi.fn() } as unknown as A2UIRuntime;
}

function sseResponse(blocks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const block of blocks) controller.enqueue(encoder.encode(block));
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

const messageBlock =
  'event: message\nid: t:0\ndata: {"version":"v0.9","createSurface":{"surfaceId":"s1","catalogId":"c"}}\n\n';
const doneBlock = 'event: done\nid: t:1\ndata: {}\n\n';
const errorBlock = 'event: error\nid: t:1\ndata: {"message":"guard 拒绝"}\n\n';

describe('streamIntoRuntime', () => {
  it('message → done：成功收尾，runtime.end 恰好一次', async () => {
    const runtime = fakeRuntime();
    const outcome = await streamIntoRuntime(sseResponse([messageBlock, doneBlock]), runtime);
    expect(outcome).toEqual({ ok: true });
    expect(runtime.end).toHaveBeenCalledTimes(1);
  });

  it('流提前断开（无 done/error）：不误报成功，报连接中断', async () => {
    const runtime = fakeRuntime();
    const outcome = await streamIntoRuntime(sseResponse([messageBlock]), runtime);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('连接中断');
  });

  it('服务端 error 事件：透出服务端 message，且视为已收尾', async () => {
    const runtime = fakeRuntime();
    const outcome = await streamIntoRuntime(sseResponse([messageBlock, errorBlock]), runtime);
    expect(outcome).toEqual({ ok: false, error: 'guard 拒绝' });
    expect(runtime.end).toHaveBeenCalledTimes(1);
  });

  it('reader 中途抛错（网络断开）：返回失败且不吞异常', async () => {
    const runtime = fakeRuntime();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(messageBlock));
        controller.error(new TypeError('network reset'));
      },
    });
    const outcome = await streamIntoRuntime(
      { ok: true, status: 200, body } as unknown as Response,
      runtime,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('network reset');
  });
});
