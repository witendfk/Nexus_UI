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

import { parseClientActionMessage } from './client-event';
import { isRecord } from './request';

/** Reject legacy messages; never reconstruct a client baseline from current server state. */
export function parseNexusActionRequest(value: unknown): NexusActionRequest | null {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'message' && key !== 'nexus'))
    return null;
  const message = parseClientActionMessage(value.message);
  const nexus = value.nexus;
  if (
    !message ||
    !isRecord(nexus) ||
    Object.keys(nexus).some(
      (key) =>
        !['sessionVersion', 'actionId', 'surfaceRevision', 'catalogHash', 'inputs'].includes(key),
    ) ||
    nexus.sessionVersion !== 1 ||
    typeof nexus.actionId !== 'string' ||
    nexus.actionId.trim() === '' ||
    !Number.isSafeInteger(nexus.surfaceRevision) ||
    (nexus.surfaceRevision as number) <= 0 ||
    typeof nexus.catalogHash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(nexus.catalogHash) ||
    !Array.isArray(nexus.inputs) ||
    (message.action.actionId !== undefined && message.action.actionId !== nexus.actionId)
  )
    return null;
  return { message, nexus: nexus as unknown as NexusActionMetadata };
}
