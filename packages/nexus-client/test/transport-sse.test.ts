import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchSseTransport } from '../src/transport/fetch-sse';
import { NEXUS_RUN_ID_HEADER } from '../src/transport';

/**
 * fetch/SSE 适配（S4.1.3）：帧切分、运行标识头、content-type/非 2xx 拒绝、
 * 单帧与总字节预算、建连/空闲/总时长超时、close 幂等与 reader 释放。
 * 全部通过注入 fetch 与假 Response 完成，无网络、不改全局。
 */

function sseResponse(chunks: string[], headers: Record<string, string> = {}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', ...headers },
  });
}

/** 永不结束的流（用于超时用例）。 */
function openEndedResponse(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start() {
        // 保持打开且不下发数据。
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

async function collect(frames: AsyncIterable<{ event: string; data: string }>): Promise<string[]> {
  const seen: string[] = [];
  for await (const frame of frames) seen.push(`${frame.event}:${frame.data}`);
  return seen;
}

describe('fetchSseTransport · 连接与帧', () => {
  it('切分 SSE 帧（含跨 chunk 半行拼接）并暴露运行标识头', async () => {
    const transport = fetchSseTransport({
      fetch: async () =>
        sseResponse(
          [
            'event: start\ndata: {"type":"start"}\n\nevent: mess',
            'age\ndata: {"n":1}\n\n',
            'event: done\ndata: {"ok":true}\n\n',
          ],
          { [NEXUS_RUN_ID_HEADER]: 'run-1' },
        ),
    });
    const response = await transport.open({ url: '/g', body: { catalogId: 'c' } });
    assert.equal(response.runIdHeader, 'run-1');
    assert.deepEqual(await collect(response.frames), [
      'start:{"type":"start"}',
      'message:{"n":1}',
      'done:{"ok":true}',
    ]);
  });

  it('content-type 非 text/event-stream 明确拒绝', async () => {
    const transport = fetchSseTransport({
      fetch: async () =>
        new Response('{"ok":true}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    await assert.rejects(
      () => transport.open({ url: '/g', body: {} }),
      /content-type 非法: application\/json/,
    );
  });

  it('非 2xx 抛出并携带状态与响应体', async () => {
    const transport = fetchSseTransport({
      fetch: async () => new Response('{"error":"RUN_CAPACITY_REJECTED"}', { status: 503 }),
    });
    await assert.rejects(
      () => transport.open({ url: '/g', body: {} }),
      /HTTP 503.*RUN_CAPACITY_REJECTED/,
    );
  });

  it('请求体以 JSON 序列化发送并携带 SSE 头', async () => {
    let captured: RequestInit | undefined;
    const transport = fetchSseTransport({
      fetch: async (_url, init) => {
        captured = init;
        return sseResponse(['event: done\ndata: {}\n\n']);
      },
    });
    const response = await transport.open({
      url: '/e',
      body: { message: { version: 'v0.9' } },
    });
    await collect(response.frames);
    assert.equal(captured?.method, 'POST');
    assert.equal((captured?.headers as Record<string, string>)['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(String(captured?.body)), { message: { version: 'v0.9' } });
  });
});

describe('fetchSseTransport · 资源边界', () => {
  it('单帧超过字符预算即终止，不继续缓冲', async () => {
    const transport = fetchSseTransport({
      maxFrameChars: 100,
      fetch: async () => sseResponse(['a'.repeat(200)]),
    });
    const response = await transport.open({ url: '/g', body: {} });
    await assert.rejects(() => collect(response.frames), /单帧超过字符预算（100 字符）/);
  });

  it('总字节超过预算即终止', async () => {
    const transport = fetchSseTransport({
      maxTotalBytes: 10,
      fetch: async () => sseResponse(['b'.repeat(64)]),
    });
    const response = await transport.open({ url: '/g', body: {} });
    await assert.rejects(() => collect(response.frames), /总字节预算（10 字节）/);
  });

  it('空闲超时终止挂起的流', async () => {
    const transport = fetchSseTransport({
      idleTimeoutMs: 10,
      fetch: async () => openEndedResponse(),
    });
    const response = await transport.open({ url: '/g', body: {} });
    await assert.rejects(() => collect(response.frames), /空闲超时（10ms）/);
  });

  it('总时长上限优先于空闲超时', async () => {
    const transport = fetchSseTransport({
      idleTimeoutMs: 0,
      totalTimeoutMs: 10,
      fetch: async () => openEndedResponse(),
    });
    const response = await transport.open({ url: '/g', body: {} });
    await assert.rejects(() => collect(response.frames), /总时长上限（10ms）/);
  });

  it('建连超时与外部取消区分', async () => {
    const hangingFetch = (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    const timedOut = fetchSseTransport({ connectTimeoutMs: 10, fetch: hangingFetch });
    await assert.rejects(() => timedOut.open({ url: '/g', body: {} }), /建连超时（10ms）/);

    const controller = new AbortController();
    const canceled = fetchSseTransport({ connectTimeoutMs: 0, fetch: hangingFetch });
    const pending = canceled.open({ url: '/g', body: {}, signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (error: unknown) => {
      assert.ok(error instanceof DOMException);
      assert.equal(error.name, 'AbortError');
      return true;
    });
  });

  it('close 幂等并释放 reader；未消费帧也不会泄漏', async () => {
    let canceled = 0;
    const transport = fetchSseTransport({
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
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
    const response = await transport.open({ url: '/g', body: {} });
    await response.close?.();
    await response.close?.();
    assert.equal(canceled, 1, '重复 close 只释放一次');
  });

  it('非法预算配置在工厂入口显式报错', () => {
    assert.throws(() => fetchSseTransport({ maxTotalBytes: -1 }), /maxTotalBytes/);
    assert.throws(() => fetchSseTransport({ idleTimeoutMs: Number.NaN }), /idleTimeoutMs/);
    assert.throws(() => fetchSseTransport({ maxFrameChars: 1.5 }), /maxFrameChars/);
    assert.throws(() => fetchSseTransport({ maxTotalBytes: null as never }), /maxTotalBytes/);
  });
});

async function bounded<T>(pending: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('测试看门狗：操作未有界退出')), 500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('fetchSseTransport · 复核整改反例', () => {
  for (const mode of ['idle', 'total', 'abort', 'content-type'] as const) {
    it(`挂起的错误响应体受 ${mode} 约束，取消并释放 reader`, async () => {
      let canceled = 0;
      let bodyController!: ReadableStreamDefaultController<Uint8Array>;
      const enteredRead = deferred<void>();
      const signal = new AbortController();
      const response = new Response(
        new ReadableStream<Uint8Array>(
          {
            start(controller) {
              bodyController = controller;
            },
            pull() {
              enteredRead.resolve();
            },
            cancel() {
              canceled++;
            },
          },
          { highWaterMark: 0 },
        ),
        {
          status: mode === 'content-type' ? 200 : 503,
          headers: { 'Content-Type': 'application/json' },
        },
      );
      const transport = fetchSseTransport({
        idleTimeoutMs: mode === 'idle' ? 15 : 0,
        totalTimeoutMs: mode === 'total' ? 15 : 0,
        fetch: async () => response,
      });
      const pending = transport.open({ url: '/g', body: {}, signal: signal.signal });
      try {
        if (mode === 'abort') {
          await enteredRead.promise;
          signal.abort();
        }
        const expected =
          mode === 'idle'
            ? /HTTP 503.*空闲超时/
            : mode === 'total'
              ? /HTTP 503.*总时长上限/
              : mode === 'abort'
                ? /HTTP 503.*(?:取消|aborted)/
                : /content-type 非法/;
        await assert.rejects(bounded(pending), expected);
        assert.equal(canceled, 1);
        assert.equal(response.body?.locked, false);
      } finally {
        signal.abort();
        try {
          bodyController.close();
        } catch {
          /* 已取消。 */
        }
      }
    });
  }

  it('错误体取消钩子不退出，也不能阻塞 open 的超时收敛', async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({ cancel: () => new Promise(() => {}) }),
      { status: 503 },
    );
    const transport = fetchSseTransport({ idleTimeoutMs: 10, fetch: async () => response });
    await assert.rejects(bounded(transport.open({ url: '/g', body: {} })), /空闲超时/);
    assert.equal(response.body?.locked, false);
  });

  for (const newline of ['\n', '\r\n', '\r', '\r\n\n']) {
    it(`单帧边界与 UTF-8 分片无关（换行 ${JSON.stringify(newline)}）`, async () => {
      const separator = newline === '\r\n\n' ? newline : newline + newline;
      const lineEnd = newline === '\r\n\n' ? '\r\n' : newline;
      const frame = `event: message${lineEnd}data: 汉😀`;
      const stream = `${frame}${separator}${frame}${separator}`;
      const bytes = new TextEncoder().encode(stream);
      const expected = ['message:汉😀', 'message:汉😀'];
      // 所有单切点（含 CRLF、UTF-8 字符内部）及逐字节分片，和合并响应对照。
      const variants: Uint8Array[][] = [
        [bytes],
        ...Array.from({ length: bytes.length - 1 }, (_, i) => [
          bytes.slice(0, i + 1),
          bytes.slice(i + 1),
        ]),
        Array.from(bytes, (b) => Uint8Array.of(b)),
      ];
      for (const chunks of variants) {
        const transport = fetchSseTransport({
          maxFrameChars: frame.length,
          fetch: async () =>
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  chunks.forEach((chunk) => controller.enqueue(chunk));
                  controller.close();
                },
              }),
              { headers: { 'Content-Type': 'text/event-stream' } },
            ),
        });
        const response = await transport.open({ url: '/g', body: {} });
        assert.deepEqual(await collect(response.frames), expected);
      }
      for (const chunks of [[stream], [...stream]]) {
        const transport = fetchSseTransport({
          maxFrameChars: frame.length - 1,
          fetch: async () => sseResponse(chunks),
        });
        const response = await transport.open({ url: '/g', body: {} });
        await assert.rejects(() => collect(response.frames), /单帧超过字符预算/);
      }
    });
  }

  it('自定义 fetch 忽略 abort 仍有界退出，晚到响应被取消', async () => {
    const late = deferred<Response>();
    let canceled = 0;
    const transport = fetchSseTransport({ connectTimeoutMs: 10, fetch: () => late.promise });
    await assert.rejects(bounded(transport.open({ url: '/g', body: {} })), /建连超时/);
    late.resolve(
      new Response(
        new ReadableStream({
          cancel() {
            canceled++;
          },
        }),
      ),
    );
    await Promise.resolve();
    assert.equal(canceled, 1);
  });

  it('fetch 已 resolve、reader 尚未接管时取消，同样释放响应体', async () => {
    const fetched = deferred<Response>();
    const signal = new AbortController();
    let canceled = 0;
    const response = new Response(
      new ReadableStream({
        cancel() {
          canceled++;
        },
      }),
    );
    const transport = fetchSseTransport({ fetch: () => fetched.promise });
    const pending = transport.open({ url: '/g', body: {}, signal: signal.signal });
    fetched.resolve(response);
    queueMicrotask(() => signal.abort());
    await assert.rejects(bounded(pending), /aborted/);
    assert.equal(canceled, 1);
    assert.equal(response.body?.locked, false);
  });
});

it('总时长也覆盖消费暂停：到期关闭底层流，继续读取明确拒绝', async () => {
  const canceled = deferred<void>();
  const transport = fetchSseTransport({
    totalTimeoutMs: 15,
    idleTimeoutMs: 0,
    fetch: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: first\n\ndata: buffered\n\n'));
          },
          cancel() {
            canceled.resolve();
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
  });
  const response = await transport.open({ url: '/g', body: {} });
  const iterator = response.frames[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value?.data, 'first');
  await bounded(canceled.promise);
  await assert.rejects(() => iterator.next(), /总时长上限/);
});

it('迁移的 SSE metadata/多行 data/尾帧解析语义由公开 transport 承担', async () => {
  const transport = fetchSseTransport({
    fetch: async () =>
      sseResponse([
        ': comment\nretry: 10\nid: ignored\n\n',
        'event: message\nid: frame-1\ndata: first\nda',
        'ta: second\n\ndata: tail',
      ]),
  });
  const response = await transport.open({ url: '/g', body: {} });
  const frames = [];
  for await (const frame of response.frames) frames.push(frame);
  assert.deepEqual(frames, [
    { event: 'message', id: 'frame-1', data: 'first\nsecond' },
    { event: 'message', data: 'tail', id: undefined },
  ]);
});
