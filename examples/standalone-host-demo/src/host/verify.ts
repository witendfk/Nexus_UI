import type { Component } from '@nexus-ui/core';
import {
  verifyExternalAgentOnboarding as verifyServerExternalAgentOnboarding,
  verifyExternalAgentIntegration as verifyServerExternalAgentIntegration,
  type AgentPolicy,
  type ExternalAgentOnboardingVerificationOptions,
  type ExternalAgentOnboardingVerificationReport,
  type ExternalAgentVerificationOptions,
  type ExternalAgentVerificationReport,
} from '@nexus-ui/server';
import { DEMO_AGENT_ACTION } from '../contract';
import { standaloneHostCatalog } from '../shared/catalog-contract';

export type VerifyHostOptions = Omit<
  ExternalAgentVerificationOptions,
  'actionSelector' | 'catalog' | 'policy'
>;

export type VerifyHostReport = ExternalAgentVerificationReport;

const approvalPolicy: AgentPolicy = {
  name: 'nexus-verify-approval',
  validateFinal: (_context, components: readonly Component[]) => {
    const root = components.find((component) => component.id === 'root');
    const action = components.find((component) => component.action?.event);
    if (!root || root.component !== 'ApprovalSummary') {
      return '验收策略要求 root 是 ApprovalSummary';
    }
    if (!action) return '验收策略要求至少一个可执行 action';
    return null;
  },
};

function selectApprovalAction(components: readonly Component[]): Component | null {
  return (
    components.find((component) => component.action?.event?.name === DEMO_AGENT_ACTION) ?? null
  );
}

/**
 * Bind the standalone demo catalog and approval workflow to the reusable server verifier.
 */
export async function verifyExternalAgentIntegration(
  options: VerifyHostOptions,
): Promise<VerifyHostReport> {
  return verifyServerExternalAgentIntegration({
    ...options,
    catalog: standaloneHostCatalog,
    policy: approvalPolicy,
    actionSelector: selectApprovalAction,
  });
}

export type VerifyOnboardingOptions = Omit<
  ExternalAgentOnboardingVerificationOptions,
  'actionSelector' | 'policy'
>;

export type VerifyOnboardingReport = ExternalAgentOnboardingVerificationReport;

/**
 * Verify through the host-published contract while retaining the demo approval policy.
 */
export async function verifyExternalAgentOnboarding(
  options: VerifyOnboardingOptions,
): Promise<VerifyOnboardingReport> {
  return verifyServerExternalAgentOnboarding({
    ...options,
    policy: approvalPolicy,
    actionSelector: selectApprovalAction,
  });
}
