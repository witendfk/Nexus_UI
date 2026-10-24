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
  AgentLlmStreamRequest,
  AgentLlmStreamSource,
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
export { FileSurfaceHistoryStore } from './agent/file-history';
export type { FileSurfaceHistoryStoreOptions } from './agent/file-history';
export { InMemoryAgentRunManager } from './agent/run-manager';
export type { AgentRunManager, AgentRunRecord, AgentRunState } from './agent/run-manager';
export type {
  ResolvedSurfaceAction,
  SurfaceActionLedger,
  SurfaceActionLedgerRecord,
  SurfaceActionSnapshot,
  SurfaceActionStateStore,
  SurfaceCommitOutcome,
  SurfaceCommitResult,
  SurfaceLedgerBegin,
} from './agent/surface-action-state';
export type { NexusRunDiagnostic } from './agent/run-diagnostic';
export type { AgentTurn } from './agent/agent-turn';
export {
  createAgentStreamState,
  validateAgentSequence,
  validateAgentStreamFinal,
  validateAgentStreamFinalDetailed,
  validateAgentStreamMessage,
  validateAgentStreamMessageDetailed,
} from './agent/agent-guard';
export type {
  AgentSequenceOptions,
  AgentStreamState,
  AgentStreamValidationIssue,
} from './agent/agent-guard';
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
export { createAgentRuntime } from './runtime/runtime-facade';
export type { AgentRuntime } from './runtime/runtime-facade';
export { DEFAULT_MAX_QUEUED_PER_SURFACE, SurfaceScheduler } from './runtime/surface-scheduler';
export type { AgentSchedulerOptions } from './runtime/agent-runtime';
export type { AgentRuntimeOptions, EnqueueOutcome } from './runtime/agent-runtime';
export type {
  CommitState,
  RunOutcome,
  RuntimeErrorCode,
  RuntimeRunEvent,
  RuntimeRunListener,
} from './runtime/run-handle';
export { RuntimeRunHandle } from './runtime/run-handle';
export { createAgentRouter } from './api/routes';
export type { NexusActionRequest } from './api/nexus-request';
export type { SurfaceStateBaseline } from './api/surface-state';
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
export type { SendMessagesResult, SendAgentRunOptions } from './api/send-messages';
export { NEXUS_RUN_ID_HEADER } from './transport/sse';
