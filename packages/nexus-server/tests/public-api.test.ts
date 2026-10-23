import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as publicApi from '../src/index';
// S3.2 迁移：新增运行时句柄契约导出。类型导出在 Object.keys 快照中不可见，
// 以 type-only 再导出在 typecheck 时锚定其存在于公开入口。
export type {
  AgentRuntime,
  AgentRuntimeOptions,
  AgentSchedulerOptions,
  CommitState,
  EnqueueOutcome,
  RunOutcome,
  RuntimeErrorCode,
  RuntimeRunEvent,
  RuntimeRunListener,
} from '../src/index';

describe('server host-assembly public API surface', () => {
  it('exports only the documented root-entry contract', () => {
    assert.deepEqual(Object.keys(publicApi).sort(), [
      'AGENT_ONBOARDING_BOUNDARY_CODES',
      'AGENT_ONBOARDING_CHECKS',
      'AGENT_ONBOARDING_CONTRACT_VERSION',
      'AgentAdapter',
      'CATALOG_CONTRACT_VERSION',
      'DEFAULT_MAX_QUEUED_PER_SURFACE',
      'FileSurfaceHistoryStore',
      'InMemoryAgentRunManager',
      'InMemorySurfaceHistoryStore',
      'NEXUS_RUN_ID_HEADER',
      'RuntimeRunHandle',
      'SERVER_API_VERSION',
      'SurfaceScheduler',
      'VERSION',
      'createAgentOnboardingContract',
      'createAgentRouter',
      'createAgentRuntime',
      'createAgentStreamState',
      'createCatalogContractHash',
      'createCatalogContractReference',
      'createExternalAgentActionHandler',
      'createExternalAgentGenerationSource',
      'fetchPublishedCatalogs',
      'sendAgentRun',
      'validateAgentSequence',
      'validateAgentStreamFinal',
      'validateAgentStreamFinalDetailed',
      'validateAgentStreamMessage',
      'validateAgentStreamMessageDetailed',
      'verifyExternalAgentIntegration',
      'verifyExternalAgentOnboarding',
    ]);
  });

  it('exposes no demo policy, reference server, or default singletons', () => {
    assert.equal('nexusAgentPolicy' in publicApi, false);
    assert.equal('resolveAgentPolicy' in publicApi, false);
    assert.equal('app' in publicApi, false);
    assert.equal('router' in publicApi, false);
    assert.equal('defaultAgentRunManager' in publicApi, false);
    assert.equal('defaultSurfaceHistoryStore' in publicApi, false);
    assert.equal('agentCatalogRegistry' in publicApi, false);
  });

  it('marks the limited assembly API without starting the reference server', () => {
    assert.equal(publicApi.VERSION, '0.1.0');
    assert.equal(publicApi.SERVER_API_VERSION, 1);
    assert.equal(publicApi.NEXUS_RUN_ID_HEADER, 'X-Nexus-Run-Id');
  });
});
