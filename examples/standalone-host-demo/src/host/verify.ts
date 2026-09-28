import type { Component } from '@nexus-ui/core';
import {
  fetchPublishedCatalogs,
  verifyExternalAgentOnboarding as verifyServerExternalAgentOnboarding,
  verifyExternalAgentIntegration as verifyServerExternalAgentIntegration,
  type AgentPolicy,
  type ExternalAgentOnboardingVerificationOptions,
  type ExternalAgentOnboardingVerificationReport,
  type ExternalAgentVerificationOptions,
  type ExternalAgentVerificationReport,
} from '@nexus-ui/server';
import { DEMO_AGENT_ACTION, DEMO_AGENT_CATALOG_ID } from '../contract';
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

export interface AgentDiscoveryOptions {
  discoveryUrl: string;
  catalogId?: string;
  discoveryHeaders?: Record<string, string>;
  discoveryTimeoutMs?: number;
  discoveryMaxBytes?: number;
  discoveryFetch?: typeof fetch;
}

export interface AgentOnboardingDiscovery {
  discoveryUrl: string;
  catalogId: string;
  contractVersion: number;
  contractHash: string;
  components: readonly string[];
  actions: readonly string[];
  catalogContractUrl: string;
  agentOnboardingUrl: string;
}

export type VerifyOnboardingByDiscoveryOptions = Omit<
  VerifyOnboardingOptions,
  'contractUrl' | 'expectedCatalogId'
> &
  AgentDiscoveryOptions;

export type VerifyOnboardingByDiscoveryReport = VerifyOnboardingReport & {
  discovery: AgentOnboardingDiscovery;
};

function assertHttpUrl(url: string, label: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} 只支持 http/https: ${url}`);
  }
}

/** Resolve a demo onboarding contract through the host's published-catalog discovery API. */
export async function resolveAgentOnboardingContract(
  options: AgentDiscoveryOptions,
): Promise<AgentOnboardingDiscovery> {
  assertHttpUrl(options.discoveryUrl, 'Published catalog discovery URL');
  const timeoutMs = options.discoveryTimeoutMs ?? 15_000;
  const maxBytes = options.discoveryMaxBytes ?? 1_000_000;

  const payload = await fetchPublishedCatalogs({
    url: options.discoveryUrl,
    ...(options.discoveryHeaders === undefined ? {} : { headers: options.discoveryHeaders }),
    timeoutMs,
    maxBytes,
    ...(options.discoveryFetch === undefined ? {} : { fetch: options.discoveryFetch }),
  });

  const catalogId = options.catalogId ?? DEMO_AGENT_CATALOG_ID;
  const catalog = payload.catalogs.find((item) => item.catalogId === catalogId);
  if (!catalog) throw new Error(`Published catalogs 不包含 catalog: ${catalogId}`);
  assertHttpUrl(catalog.catalogContractUrl, 'Catalog contract URL');
  assertHttpUrl(catalog.agentOnboardingUrl, 'Agent onboarding contract URL');

  return {
    discoveryUrl: options.discoveryUrl,
    catalogId,
    contractVersion: catalog.contractVersion,
    contractHash: catalog.contractHash,
    components: catalog.components,
    actions: catalog.actions ?? [],
    catalogContractUrl: catalog.catalogContractUrl,
    agentOnboardingUrl: catalog.agentOnboardingUrl,
  };
}

/**
 * Discover the demo onboarding contract, then run the same contract-driven acceptance.
 */
export async function verifyExternalAgentOnboardingByDiscovery(
  options: VerifyOnboardingByDiscoveryOptions,
): Promise<VerifyOnboardingByDiscoveryReport> {
  const { discoveryUrl, catalogId, ...verificationOptions } = options;
  const discovery = await resolveAgentOnboardingContract({
    discoveryUrl,
    ...(catalogId === undefined ? {} : { catalogId }),
  });
  const report = await verifyExternalAgentOnboarding({
    ...verificationOptions,
    contractUrl: discovery.agentOnboardingUrl,
    expectedCatalogId: discovery.catalogId,
  });
  return { ...report, discovery };
}
