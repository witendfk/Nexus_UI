import type { ActionEvent } from '@nexus-ui/core';

export interface ClientAction {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  timestamp: string;
  context: Record<string, unknown>;
}

export interface ClientActionMessage {
  version: 'v0.9';
  action: ClientAction;
}

/** 把 core 的范式无关 ActionEvent 包装成 v0.9 client-to-server 消息。 */
export function toClientActionMessage(
  event: ActionEvent,
  timestamp = new Date().toISOString(),
): ClientActionMessage {
  return {
    version: 'v0.9',
    action: {
      name: event.name,
      surfaceId: event.surfaceId,
      sourceComponentId: event.sourceComponentId,
      timestamp,
      context: event.context,
    },
  };
}
