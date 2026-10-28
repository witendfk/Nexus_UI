/**
 * 会话 transport 契约（S4.1，SPEC §7）：一次运行 = 一次 POST + SSE 帧序列。
 * transport 只负责 HTTP/连接/帧切分，不解释事件语义——解释权在会话状态机；
 * 默认实现 `fetchSseTransport`，宿主可注入替身或其他传输。
 */

/**
 * 运行标识响应头（与 server 写入值同源，定义在 core）。
 * client 只读该头并与 `start`/`done` 的运行标识比对。
 */
export { NEXUS_RUN_ID_HEADER } from '@nexus-ui/core';

export interface SseFrame {
  event: string;
  data: string;
  id?: string;
}

export interface TransportRequest {
  url: string;
  /** JSON 请求体（generate: `{ message?, catalogId }`；action: `{ message, nexus }`）。 */
  body: unknown;
  signal?: AbortSignal;
}

export interface TransportResponse {
  /**
   * 权威运行标识（`NEXUS_RUN_ID_HEADER` 响应头）。缺失时本次运行不可关联，
   * 成功 done 不被采信（会话层门控）。
   */
  runIdHeader: string | null;
  /**
   * SSE 帧异步序列。实现须在流结束（含服务端 EOF、断连、abort）后正常返回；
   * HTTP 非 2xx / 中途错误以异常抛出。
   */
  frames: AsyncIterable<SseFrame>;
  /**
   * 释放底层连接、reader、监听与定时器。必须幂等：会话在运行结束时（含异常、
   * 取消、未开始消费帧的提前拒绝）都会调用，实现可与 `frames` 的收尾重复执行。
   */
  close?(): Promise<void> | void;
}

export interface SessionTransport {
  open(request: TransportRequest): Promise<TransportResponse>;
}
