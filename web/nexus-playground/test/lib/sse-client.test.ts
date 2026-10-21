import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamSse } from '../../src/lib/sse-client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SSE 取消与资源清理', () => {
  it('一次读取中的多个 frame 在取消后不再交付，并释放 reader', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: first\n\ndata: second\n\n'));
      },
      cancel,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })),
    );
    const received: string[] = [];
    await expect(
      streamSse({
        url: '/run',
        signal: controller.signal,
        onEvent: (event) => {
          received.push(event.data);
          controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(received).toEqual(['first']);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it('reader.read 等待期间取消，忽略 signal 的响应体也及时结束', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })),
    );
    const task = streamSse({
      url: '/run',
      signal: controller.signal,
      onResponse: () => queueMicrotask(() => controller.abort()),
      onEvent: () => {
        throw new Error('不应有事件');
      },
    });
    await expect(task).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it('末尾无空行的 frame 处理异常也取消并释放 reader', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: tail'));
        c.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })),
    );
    await expect(
      streamSse({
        url: '/run',
        onEvent: () => {
          throw new Error('reject tail');
        },
      }),
    ).rejects.toThrow('reject tail');
    expect(body.locked).toBe(false);
  });
});
