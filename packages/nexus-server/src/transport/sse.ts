import type { Context } from 'koa';

export type SseEventName = 'message' | 'error' | 'done';

/** 将一个事件格式化为符合 SSE 规范的帧。 */
export function formatSseEvent(event: SseEventName, data: unknown, id?: string): string {
  const lines = [`event: ${event}`];
  if (id !== undefined) lines.push(`id: ${id}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  return `${lines.join('\n')}\n\n`;
}

/** 写入 SSE 必需响应头；代理链路不做响应缓冲。 */
export function prepareSseResponse(ctx: Context): void {
  ctx.status = 200;
  ctx.set('Content-Type', 'text/event-stream; charset=utf-8');
  ctx.set('Cache-Control', 'no-cache, no-transform');
  ctx.set('Connection', 'keep-alive');
  ctx.set('X-Accel-Buffering', 'no');
}
