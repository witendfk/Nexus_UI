import type { SessionTransport, SseFrame, TransportRequest, TransportResponse } from './index';
import { NEXUS_RUN_ID_HEADER } from './index';

// CRLF 是一个换行；禁止回溯将它拆成两个换行（也支持混合换行）。
const FRAME_BOUNDARY = /(?:\r\n|\r(?!\n)|(?<!\r)\n){2}/;

/** 默认资源预算与超时（S4.1.3）。0 表示关闭该项；非法值在工厂入口显式报错。 */
export interface SseTransportOptions {
  /** 注入 fetch（默认取 `globalThis.fetch`，调用时解析，便于宿主替换与测试）。 */
  fetch?: typeof fetch;
  /** 单帧上限（UTF-16 字符数）。默认 1_000_000；0 关闭。 */
  maxFrameChars?: number;
  /** 单次响应总字节上限（按原始分片 `byteLength` 累计）。默认 16 MiB；0 关闭。 */
  maxTotalBytes?: number;
  /** 建连超时（毫秒）。默认 30_000；0 关闭。 */
  connectTimeoutMs?: number;
  /** 两次数据之间的空闲超时（毫秒）。默认 60_000；0 关闭。 */
  idleTimeoutMs?: number;
  /** 单次响应总时长上限（毫秒）。默认 600_000；0 关闭。 */
  totalTimeoutMs?: number;
}

const DEFAULTS = {
  maxFrameChars: 1_000_000,
  maxTotalBytes: 16 * 1024 * 1024,
  connectTimeoutMs: 30_000,
  idleTimeoutMs: 60_000,
  totalTimeoutMs: 600_000,
} as const;

function parseSseFrame(frame: string): SseFrame | null {
  let eventName = 'message';
  let id: string | undefined;
  const data: string[] = [];
  for (const rawLine of frame.split(/\r\n|\n|\r/)) {
    if (!rawLine || rawLine.startsWith(':')) continue;
    const colon = rawLine.indexOf(':');
    if (colon === -1) continue;
    const field = rawLine.slice(0, colon);
    let value = rawLine.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') eventName = value || 'message';
    if (field === 'data') data.push(value);
    if (field === 'id' && !value.includes('\0')) id = value;
  }
  return data.length === 0 ? null : { event: eventName, data: data.join('\n'), id };
}

function assertBudget(name: string, value: number | undefined, fallback: number): number {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new Error(`fetchSseTransport 的 ${name} 必须是非负安全整数，收到 ${String(value)}`);
  }
  return resolved;
}

function withLimits<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = (): void => {
      if (timer !== null) clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    const abort = (): void => {
      cleanup();
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException('运行已取消', 'AbortError'),
      );
    };
    const timer = Number.isFinite(ms)
      ? setTimeout(
          () => {
            cleanup();
            reject(new Error(message));
          },
          Math.max(1, ms),
        )
      : null;
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else if (ms <= 0) {
      cleanup();
      reject(new Error(message));
    }
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** 读取错误响应体用于诊断，但不超过给定字符数，避免错误体本身成为资源风险。 */
async function readTextCapped(
  read: () => Promise<ReadableStreamReadResult<Uint8Array>>,
  limit: number,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  while (text.length < limit) {
    const { done, value } = await read();
    if (done) break;
    // 诊断只保留有界前缀，不为一个超大 chunk 解码整段字符串。
    text += decoder.decode(value.subarray(0, (limit - text.length) * 4), { stream: true });
  }
  return text.slice(0, limit);
}

/**
 * 默认 transport：POST fetch + SSE 帧解析（浏览器 fetch streams；Node 18+ 同构）。
 * 只做连接、帧切分与资源边界：运行标识取自响应头，语义解释归会话状态机。
 * 建连/空闲/总时长超时、单帧与总字节预算越界均以异常终止本次运行；
 * `close()` 幂等释放 reader、监听与定时器。
 */
export function fetchSseTransport(options: SseTransportOptions = {}): SessionTransport {
  const maxFrameChars = assertBudget(
    'maxFrameChars',
    options.maxFrameChars,
    DEFAULTS.maxFrameChars,
  );
  const maxTotalBytes = assertBudget(
    'maxTotalBytes',
    options.maxTotalBytes,
    DEFAULTS.maxTotalBytes,
  );
  const connectTimeoutMs = assertBudget(
    'connectTimeoutMs',
    options.connectTimeoutMs,
    DEFAULTS.connectTimeoutMs,
  );
  const idleTimeoutMs = assertBudget(
    'idleTimeoutMs',
    options.idleTimeoutMs,
    DEFAULTS.idleTimeoutMs,
  );
  const totalTimeoutMs = assertBudget(
    'totalTimeoutMs',
    options.totalTimeoutMs,
    DEFAULTS.totalTimeoutMs,
  );

  return {
    async open(request: TransportRequest): Promise<TransportResponse> {
      const fetchImpl =
        options.fetch ??
        ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
      const controller = new AbortController();
      const deadline = totalTimeoutMs > 0 ? Date.now() + totalTimeoutMs : Number.POSITIVE_INFINITY;
      const onExternalAbort = (): void => controller.abort(request.signal?.reason);
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      let released = false;
      let totalTimer: ReturnType<typeof setTimeout> | null = null;
      const release = (): void => {
        if (released) return;
        released = true;
        if (totalTimer !== null) clearTimeout(totalTimer);
        request.signal?.removeEventListener('abort', onExternalAbort);
        controller.signal.removeEventListener('abort', release);
        controller.abort();
        if (reader) {
          // cancel 可由宿主自定义且永不 resolve；本地退出不等待其完成。
          void reader.cancel().catch(() => undefined);
          try {
            reader.releaseLock();
          } catch {
            /* 已释放或读取尚在结束。 */
          }
        }
      };
      controller.signal.addEventListener('abort', release, { once: true });
      if (totalTimeoutMs > 0) {
        totalTimer = setTimeout(
          () => controller.abort(new Error(`SSE 响应超过总时长上限（${totalTimeoutMs}ms）`)),
          totalTimeoutMs,
        );
      }
      if (request.signal?.aborted) controller.abort(request.signal.reason);
      else request.signal?.addEventListener('abort', onExternalAbort, { once: true });
      const waitLimit = (phase: 'connect' | 'read'): { ms: number; message: string } => {
        const remaining = deadline - Date.now();
        const budget = phase === 'connect' ? connectTimeoutMs : idleTimeoutMs;
        const phaseLimit = budget > 0 ? budget : Number.POSITIVE_INFINITY;
        return remaining <= phaseLimit
          ? { ms: remaining, message: `SSE 响应超过总时长上限（${totalTimeoutMs}ms）` }
          : {
              ms: phaseLimit,
              message:
                phase === 'connect'
                  ? `SSE 建连超时（${connectTimeoutMs}ms）`
                  : `SSE 读取空闲超时（${idleTimeoutMs}ms）`,
            };
      };
      let totalBytes = 0;
      const read = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
        controller.signal.throwIfAborted();
        const { ms, message } = waitLimit('read');
        const result = await withLimits(reader!.read(), controller.signal, ms, message);
        if (!result.done) {
          totalBytes += result.value.byteLength;
          if (maxTotalBytes > 0 && totalBytes > maxTotalBytes) {
            throw new Error(`SSE 响应超过总字节预算（${maxTotalBytes} 字节）`);
          }
        }
        return result;
      };
      let runIdHeader: string | null;
      try {
        controller.signal.throwIfAborted();
        const { ms, message } = waitLimit('connect');
        const pending = fetchImpl(request.url, {
          method: 'POST',
          headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
          body: JSON.stringify(request.body ?? {}),
          signal: controller.signal,
        });
        // 自定义 fetch 可能忽略 signal，晚到的响应也须释放。
        void pending.then(
          (late) => {
            if (released) void late.body?.cancel().catch(() => undefined);
          },
          () => undefined,
        );
        const response = await withLimits(pending, controller.signal, ms, message);
        // fetch 已 resolve、await 接续尚未执行时也可能发生取消。
        if (controller.signal.aborted) {
          void response.body?.cancel().catch(() => undefined);
          controller.signal.throwIfAborted();
        }
        reader = response.body?.getReader() ?? null;
        if (!response.ok || !reader) {
          let detail = '';
          try {
            if (!response.ok && reader) detail = await readTextCapped(read, 500);
          } catch (error) {
            throw new Error(
              `SSE 请求失败: HTTP ${response.status}（${error instanceof Error ? error.message : String(error)}）`,
            );
          }
          throw new Error(`SSE 请求失败: HTTP ${response.status}${detail ? ` ${detail}` : ''}`);
        }
        const contentType = response.headers.get('Content-Type')?.split(';')[0]?.trim();
        if (contentType !== 'text/event-stream') {
          throw new Error(`SSE 响应 content-type 非法: ${contentType ?? '缺失'}`);
        }
        runIdHeader = response.headers.get(NEXUS_RUN_ID_HEADER);
      } catch (error) {
        release();
        throw error;
      }
      const decoder = new TextDecoder();
      const checkFrame = (frame: string): void => {
        if (maxFrameChars > 0 && frame.length > maxFrameChars) {
          throw new Error(`SSE 单帧超过字符预算（${maxFrameChars} 字符）`);
        }
      };

      async function* frames(): AsyncGenerator<SseFrame> {
        let buffer = '';
        try {
          for (;;) {
            const { done, value } = await read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            for (;;) {
              const boundary = FRAME_BOUNDARY.exec(buffer);
              if (!boundary) break;
              // 末尾 CR 可能与下一 chunk 的 LF 组成同一换行，先保留。
              if (boundary.index + boundary[0].length === buffer.length && buffer.endsWith('\r'))
                break;
              const frame = buffer.slice(0, boundary.index);
              buffer = buffer.slice(boundary.index + boundary[0].length);
              checkFrame(frame);
              const parsed = parseSseFrame(frame);
              if (parsed) {
                controller.signal.throwIfAborted();
                yield parsed;
              }
            }
            // 只扣除可能属于未完整空行分隔符的后缀，最多暂存三个字符。
            checkFrame(buffer.replace(/[\r\n]{1,3}$/, ''));
          }
          buffer += decoder.decode();
          const boundary = FRAME_BOUNDARY.exec(buffer);
          if (boundary) buffer = buffer.slice(0, boundary.index);
          checkFrame(buffer);
          const tail = buffer.trim() ? parseSseFrame(buffer) : null;
          if (tail) {
            controller.signal.throwIfAborted();
            yield tail;
          }
        } finally {
          await release();
        }
      }

      return { runIdHeader, frames: frames(), close: release };
    },
  };
}
