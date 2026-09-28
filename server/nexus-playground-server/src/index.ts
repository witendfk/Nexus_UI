export { SERVER_API_VERSION, VERSION } from './version';

export { AgentAdapter } from './agent/adapter';
export type {
  AgentAction,
  AgentActionContext,
  AgentActionHandler,
  AgentAdapterOptions,
  AgentActionContextResolution,
  AgentActionContextResolver,
  AgentGenerateRequest,
  AgentGenerationSource,
  AgentGenerationSourceRequest,
  AgentGenerationCommitEvent,
  AgentMessageSource,
  AgentPlan,
  AgentRun,
  AgentPrepareOptions,
} from './agent/adapter';
export {
  createExternalAgentActionHandler,
  createExternalAgentGenerationSource,
} from './agent/external-agent';
export type { ExternalAgentRpcConfig } from './agent/external-agent';
export {
  CATALOG_CONTRACT_VERSION,
  createCatalogContractHash,
  createCatalogContractReference,
} from './agent/catalog-contract';
export type { CatalogContractReference } from './agent/catalog-contract';
export { InMemorySurfaceHistoryStore } from './agent/history';
export type { InMemorySurfaceHistoryStoreOptions, SurfaceHistoryStore } from './agent/history';
export { InMemoryAgentRunManager } from './agent/run-manager';
export type { AgentRunManager, AgentRunRecord, AgentRunState } from './agent/run-manager';
export type {
  ResolvedSurfaceAction,
  SurfaceActionLedger,
  SurfaceActionLedgerRecord,
  SurfaceActionSnapshot,
  SurfaceActionStateStore,
} from './agent/surface-action-state';
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
  AgentRunListPayload,
  AgentOnboardingContractPayload,
  AgentRouterOptions,
  CatalogContractPayload,
  PublishedCatalogsPayload,
  PublishedCatalogSummary,
} from './api/routes';
export { fetchPublishedCatalogs } from './api/catalog-discovery-client';
export type { PublishedCatalogsClientOptions } from './api/catalog-discovery-client';
export {
  AGENT_ONBOARDING_BOUNDARY_CODES,
  AGENT_ONBOARDING_CHECKS,
  AGENT_ONBOARDING_CONTRACT_VERSION,
  createAgentOnboardingContract,
} from './api/agent-onboarding';
export type { AgentOnboardingBoundaryCode, AgentOnboardingCheckId } from './api/agent-onboarding';
export { sendAgentRun } from './api/send-messages';
export type { SendMessagesResult } from './api/send-messages';
