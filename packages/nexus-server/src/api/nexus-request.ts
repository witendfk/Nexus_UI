import type { NexusActionMetadata } from '@nexus-ui/core';
import type { ClientActionMessage } from './client-event';

/**
 * 目标 action HTTP 请求 envelope：v0.9 action 信封与 SDK 元数据分离（SPEC §5.1）。
 * 缺失 nexus 或 sessionVersion 非 1 的请求在解析入口显式拒绝，不按旧语义解释。
 * 元数据类型定义在 core 的 session 契约模块，S3 流事件复用同一版本基线。
 */
export interface NexusActionRequest {
  readonly message: ClientActionMessage;
  readonly nexus: NexusActionMetadata;
}
