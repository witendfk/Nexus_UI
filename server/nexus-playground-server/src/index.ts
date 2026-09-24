export { SERVER_API_VERSION, VERSION } from './version';

export { AgentAdapter } from './agent/adapter';
export type {
  AgentAction,
  AgentActionContext,
  AgentActionHandler,
  AgentAdapterOptions,
  AgentGenerateRequest,
  AgentGenerationSource,
  AgentGenerationSourceRequest,
  AgentMessageSource,
  AgentPlan,
  AgentRun,
} from './agent/adapter';
export {
  createExternalAgentActionHandler,
  createExternalAgentGenerationSource,
} from './agent/external-agent';
export type { ExternalAgentRpcConfig } from './agent/external-agent';
export { InMemorySurfaceHistoryStore } from './agent/history';
export type { InMemorySurfaceHistoryStoreOptions, SurfaceHistoryStore } from './agent/history';
export type { AgentTurn } from './agent/llm-agent';
export { createAgentRouter } from './api/routes';
export type { AgentRouterOptions, CatalogContractPayload } from './api/routes';
export { sendAgentRun } from './api/send-messages';
export type { SendMessagesResult } from './api/send-messages';
