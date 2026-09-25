import {
  AgentAdapter,
  createExternalAgentActionHandler,
  createExternalAgentGenerationSource,
  InMemorySurfaceHistoryStore,
} from '@nexus-ui/server';
import type { AgentActionHandler, AgentPolicy, ExternalAgentRpcConfig } from '@nexus-ui/server';
import { DEMO_AGENT_CATALOG_ID, DEMO_AGENT_ACTION } from '../contract';
import { createStandaloneHostRegistry } from '../shared/catalog';

export interface StandaloneHostAdapterOptions extends ExternalAgentRpcConfig {
  createSurfaceId?: () => string;
  actionHandler?: AgentActionHandler;
  policy?: AgentPolicy;
}

/**
 * Assemble a host-owned Agent Adapter with a custom catalog and external JSONL RPC Agent.
 * Every remote message still passes the same server guard as the playground.
 */
export function createStandaloneHostAdapter(options: StandaloneHostAdapterOptions): AgentAdapter {
  const actionHandler = options.actionHandler ?? createExternalAgentActionHandler(options);
  const adapter = new AgentAdapter({
    registry: createStandaloneHostRegistry(),
    actionHandlers: new Map(),
    historyStore: new InMemorySurfaceHistoryStore(),
    useLlm: () => false,
    createSurfaceId: options.createSurfaceId,
    createGenerationSource: createExternalAgentGenerationSource(options),
    policy: options.policy,
  });
  adapter.registerActionHandler(DEMO_AGENT_CATALOG_ID, DEMO_AGENT_ACTION, actionHandler);
  return adapter;
}
