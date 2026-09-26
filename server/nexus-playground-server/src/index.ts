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
export { verifyExternalAgentIntegration } from './agent/verification';
export type {
  ExternalAgentVerificationOptions,
  ExternalAgentVerificationCheck,
  ExternalAgentVerificationReport,
} from './agent/verification';
export { verifyExternalAgentOnboarding } from './agent/onboarding-verification';
export type {
  ExternalAgentOnboardingVerificationOptions,
  ExternalAgentOnboardingVerificationReport,
} from './agent/onboarding-verification';
export type {
  AgentPolicy,
  AgentPolicyContext,
  MediaComponent,
  RequiredMediaPolicy,
  ResolvedAgentPolicy,
} from './agent/policy';
export { nexusAgentPolicy, resolveAgentPolicy } from './agent/policy';
export { createAgentRouter } from './api/routes';
export type {
  AgentOnboardingContractPayload,
  AgentRouterOptions,
  CatalogContractPayload,
} from './api/routes';
export {
  AGENT_ONBOARDING_BOUNDARY_CODES,
  AGENT_ONBOARDING_CHECKS,
  AGENT_ONBOARDING_CONTRACT_VERSION,
  createAgentOnboardingContract,
} from './api/agent-onboarding';
export type { AgentOnboardingBoundaryCode, AgentOnboardingCheckId } from './api/agent-onboarding';
export { sendAgentRun } from './api/send-messages';
export type { SendMessagesResult } from './api/send-messages';
