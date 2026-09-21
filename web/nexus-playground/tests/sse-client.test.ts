import { describe, expect, it, vi } from 'vitest';
import { parseSseFrame, streamSse } from '../src/lib/sse-client';

function response(body: ReadableStream<Uint8Array>): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'Content-Type': 'text/event-stream; charset=utf-8' }),
    body,
    async text() {
      return '';
    },
  } as Response;
}

describe('parseSseFrame', () => {
  it('解析 event、id 和多行 data', () => {
    expect(parseSseFrame('event: message\nid: 1\ndata: {"ok":true}\ndata: tail')).to.deep.equal({
      event: 'message',
      id: '1',
      data: '{"ok":true}\ntail',
    });
  });

  it('忽略注释、未知字段和空 data', () => {
    expect(parseSseFrame(': comment\nretry: 10\nid: 2')).to.equal(null);
  });
});

describe('streamSse', () => {
  it('跨 chunk 拼接 SSE frame 并回调事件', async () => {
    const events: unknown[] = [];
    const chunks = [
      new TextEncoder().encode('event: message\nda'),
      new TextEncoder().encode('ta: {"version":"v0.9"}\n\n'),
      new TextEncoder().encode('event: done\ndata: {}\n\n'),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(createChunkedStream(chunks))),
    );

    await streamSse({
      url: '/api/a2ui/generate',
      body: { message: 'hello' },
      onEvent: (event) => events.push(event),
    });

    expect(events).to.deep.equal([
      { event: 'message', data: '{"version":"v0.9"}' },
      { event: 'done', data: '{}' },
    ]);
  });

  it('拒绝非 SSE 响应', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad request', { status: 400 })),
    );

    await expect(
      streamSse({ url: '/api/a2ui/generate', onEvent: () => undefined }),
    ).rejects.toThrow('SSE 请求失败: HTTP 400');
  });
});

function createChunkedStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}
