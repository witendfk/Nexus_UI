import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as publicApi from '../src/index';

describe('server host-assembly public API surface', () => {
  it('exports only the documented root-entry contract', () => {
    assert.deepEqual(Object.keys(publicApi).sort(), [
      'AGENT_ONBOARDING_BOUNDARY_CODES',
      'AGENT_ONBOARDING_CHECKS',
      'AGENT_ONBOARDING_CONTRACT_VERSION',
      'AgentAdapter',
      'InMemorySurfaceHistoryStore',
      'SERVER_API_VERSION',
      'VERSION',
      'createAgentOnboardingContract',
      'createAgentRouter',
      'createExternalAgentActionHandler',
      'createExternalAgentGenerationSource',
      'nexusAgentPolicy',
      'resolveAgentPolicy',
      'sendAgentRun',
      'verifyExternalAgentIntegration',
      'verifyExternalAgentOnboarding',
    ]);
  });

  it('marks the limited assembly API without starting the reference server', () => {
    assert.equal(publicApi.VERSION, '0.1.0');
    assert.equal(publicApi.SERVER_API_VERSION, 1);
    assert.equal('app' in publicApi, false);
    assert.equal('router' in publicApi, false);
  });
});
