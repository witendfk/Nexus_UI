export interface SseEvent {
  event: string;
  data: string;
  id?: string;
}

const FRAME_BOUNDARY = /\r\n\r\n|\n\n|\r\r/;

function parseSseFrame(frame: string): SseEvent | null {
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
  return data.length === 0
    ? null
    : { event: eventName, data: data.join('\n'), ...(id === undefined ? {} : { id }) };
}

export async function streamSse({
  url,
  body,
  signal,
  onResponse,
  onEvent,
}: {
  url: string;
  body?: unknown;
  signal?: AbortSignal;
  /** S2.6.3.2：把实际响应交给消费方（运行标识从响应头读取，不解析事件 id）。 */
  onResponse?: (response: Response) => void;
  onEvent: (event: SseEvent) => void;
}): Promise<void> {
  const assertActive = (): void => {
    if (signal?.aborted) throw new DOMException('运行已取消', 'AbortError');
  };
  assertActive();
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  if (signal?.aborted) {
    await response.body?.cancel().catch(() => undefined);
    assertActive();
  }
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deliver = (frame: string): void => {
    assertActive();
    const event = parseSseFrame(frame);
    if (event) onEvent(event);
  };
  const consume = (text: string): void => {
    buffer += text;
    for (;;) {
      const boundary = FRAME_BOUNDARY.exec(buffer);
      if (!boundary) break;
      const frame = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      deliver(frame);
    }
  };

  const cancelReader = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', cancelReader, { once: true });
  try {
    assertActive();
    onResponse?.(response);
    let streamDone = false;
    while (!streamDone) {
      const { done, value } = await reader.read();
      assertActive();
      if (done) {
        streamDone = true;
        continue;
      }
      consume(decoder.decode(value, { stream: true }));
    }
    assertActive();
    consume(decoder.decode());
    if (buffer.trim()) deliver(buffer);
  } catch (error) {
    // 异常时取消读取并释放连接，不让半途的流挂住宿主资源。
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancelReader);
    reader.releaseLock();
  }
}
