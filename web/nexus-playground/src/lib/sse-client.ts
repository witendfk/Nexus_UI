export interface SseEvent {
  event: string;
  data: string;
  id?: string;
}

export interface SseStreamOptions {
  url: string;
  body?: unknown;
  signal?: AbortSignal;
  onEvent: (event: SseEvent) => void;
}

const FRAME_BOUNDARY = /\r\n\r\n|\n\n|\r\r/;

/** 解析一个已完整到达的 SSE frame；没有 data 字段时返回 null。 */
export function parseSseFrame(frame: string): SseEvent | null {
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
    else if (field === 'data') data.push(value);
    else if (field === 'id' && !value.includes('\0')) id = value;
  }

  if (data.length === 0) return null;
  const parsed: SseEvent = { event: eventName, data: data.join('\n') };
  if (id !== undefined) parsed.id = id;
  return parsed;
}

/**
 * 通过 fetch 消费 POST SSE。
 *
 * EventSource 只支持 GET 且不能携带 JSON body，因此 Agent 生成接口使用 fetch streaming；
 * core 仍只接收 JSONL 字符串，不感知 SSE。
 */
export async function streamSse({ url, body, signal, onEvent }: SseStreamOptions): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
    signal,
  });

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();
  if (!response.ok || !response.body || contentType !== 'text/event-stream') {
    let detail = '';
    try {
      detail = await response.text();
    } catch {
      detail = '';
    }
    throw new Error(`SSE 请求失败: HTTP ${response.status}${detail ? ` ${detail}` : ''}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deliver = (frame: string): void => {
    const event = parseSseFrame(frame);
    if (event) onEvent(event);
  };

  const consume = (text: string): void => {
    buffer += text;
    for (;;) {
      const boundary = FRAME_BOUNDARY.exec(buffer);
      if (!boundary || boundary.index === undefined) break;
      const frame = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      deliver(frame);
    }
  };

  try {
    let done = false;
    while (!done) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) {
        done = true;
        continue;
      }
      consume(decoder.decode(value, { stream: true }));
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  consume(decoder.decode());
  if (buffer.trim()) deliver(buffer);
}
