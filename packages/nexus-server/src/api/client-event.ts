import { isRecord } from './request';
import type { AgentAction } from '../agent/adapter';

/**
 * 浏览器提交的 v0.9 action 载荷（SDK 元数据由客户端在 nexus envelope 携带；
 * HTTP 层原样传递提交基准和 actionId，不从最新快照重建）。
 */
export type ClientActionPayload = Pick<
  AgentAction,
  'name' | 'surfaceId' | 'sourceComponentId' | 'timestamp' | 'context'
> & { actionId?: string };

export interface ClientActionMessage {
  version: 'v0.9';
  action: ClientActionPayload;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

/** 校验 Agent 线需要的 v0.9 client-to-server action 子集。 */
export function parseClientActionMessage(value: unknown): ClientActionMessage | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['version', 'action'])) return null;
  if (value.version !== 'v0.9') return null;

  const action = value.action;
  if (
    !isRecord(action) ||
    !hasOnlyKeys(action, [
      'name',
      'surfaceId',
      'sourceComponentId',
      'timestamp',
      'actionId',
      'context',
    ])
  ) {
    return null;
  }
  if (
    typeof action.name !== 'string' ||
    typeof action.surfaceId !== 'string' ||
    typeof action.sourceComponentId !== 'string' ||
    typeof action.timestamp !== 'string' ||
    Number.isNaN(Date.parse(action.timestamp)) ||
    (action.actionId !== undefined &&
      (typeof action.actionId !== 'string' || action.actionId.trim() === '')) ||
    !isRecord(action.context)
  ) {
    return null;
  }

  return {
    version: 'v0.9',
    action: {
      name: action.name,
      surfaceId: action.surfaceId,
      sourceComponentId: action.sourceComponentId,
      timestamp: action.timestamp,
      ...(action.actionId === undefined ? {} : { actionId: action.actionId }),
      context: action.context,
    },
  };
}
