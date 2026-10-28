import type { Context } from 'koa';
import { NEXUS_RUN_ID_HEADER } from '@nexus-ui/core';

export type SseEventName = 'start' | 'message' | 'error' | 'done';

/**
 * SSE 运行标识响应头（S2.5.4）。常量定义在 core（`NEXUS_RUN_ID_HEADER`），
 * server 写入、client 读取，两端按值比对，避免同一契约出现两份字面量。
 * 跨源读取须由宿主 CORS 装配显式 `Access-Control-Expose-Headers` 暴露并合并
 * 其已有暴露配置。消费者以该头与成功 `done` 关联本次运行；SDK 不提供解析
 * event id 格式猜 runId 的任何途径，按 run 查询以显式参数提交（SPEC §5.3）。
 */
export { NEXUS_RUN_ID_HEADER };

export interface PrepareSseResponseOptions {
  /**
   * 本次运行标识。提供时写入 `NEXUS_RUN_ID_HEADER`；必须是已在运行准备阶段
   * 分配的非空不可变 ID，且不得晚于 `flushHeaders`（由调用方在本函数内一并完成）。
   */
  runId?: string;
}

/** 将一个事件格式化为符合 SSE 规范的帧。 */
export function formatSseEvent(event: SseEventName, data: unknown, id?: string): string {
  const lines = [`event: ${event}`];
  if (id !== undefined) lines.push(`id: ${id}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  return `${lines.join('\n')}\n\n`;
}

/** 写入 SSE 必需响应头；代理链路不做响应缓冲。 */
export function prepareSseResponse(ctx: Context, options?: PrepareSseResponseOptions): void {
  const runId = options?.runId;
  if (runId !== undefined && (typeof runId !== 'string' || runId === '')) {
    // 先于任何响应头写入显式报错，不留半占用的 SSE 响应。
    throw new Error('SSE 运行标识头必须是非空字符串（运行准备阶段分配的 runId）');
  }
  ctx.status = 200;
  ctx.set('Content-Type', 'text/event-stream; charset=utf-8');
  ctx.set('Cache-Control', 'no-cache, no-transform');
  ctx.set('Connection', 'keep-alive');
  ctx.set('X-Accel-Buffering', 'no');
  if (runId !== undefined) ctx.set(NEXUS_RUN_ID_HEADER, runId);
}
