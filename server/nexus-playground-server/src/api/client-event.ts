import { isRecord } from './request';
import type { AgentAction } from '../agent/adapter';

export interface ClientActionMessage {
  version: 'v0.9';
  action: AgentAction;
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
    !hasOnlyKeys(action, ['name', 'surfaceId', 'sourceComponentId', 'timestamp', 'context'])
  ) {
    return null;
  }
  if (
    typeof action.name !== 'string' ||
    typeof action.surfaceId !== 'string' ||
    typeof action.sourceComponentId !== 'string' ||
    typeof action.timestamp !== 'string' ||
    Number.isNaN(Date.parse(action.timestamp)) ||
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
      context: action.context,
    },
  };
}
