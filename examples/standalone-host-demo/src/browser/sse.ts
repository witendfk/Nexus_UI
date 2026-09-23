export interface SseEvent {
  event: string;
  data: string;
}

const FRAME_BOUNDARY = /\r\n\r\n|\n\n|\r\r/;

function parseSseFrame(frame: string): SseEvent | null {
  let eventName = 'message';
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
  }
  return data.length === 0 ? null : { event: eventName, data: data.join('\n') };
}

export async function streamSse({
  url,
  body,
  signal,
  onEvent,
}: {
  url: string;
  body?: unknown;
  signal?: AbortSignal;
  onEvent: (event: SseEvent) => void;
}): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

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
      if (!boundary) break;
      const frame = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      deliver(frame);
    }
  };

  let streamDone = false;
  while (!streamDone) {
    const { done, value } = await reader.read();
    if (done) {
      streamDone = true;
      continue;
    }
    consume(decoder.decode(value, { stream: true }));
  }
  consume(decoder.decode());
  if (buffer.trim()) deliver(buffer);
}
