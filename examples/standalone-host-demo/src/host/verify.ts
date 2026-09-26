import type { Component } from '@nexus-ui/core';
import {
  verifyExternalAgentOnboarding as verifyServerExternalAgentOnboarding,
  verifyExternalAgentIntegration as verifyServerExternalAgentIntegration,
  type AgentPolicy,
  type ExternalAgentOnboardingVerificationOptions,
  type ExternalAgentOnboardingVerificationReport,
  type ExternalAgentVerificationOptions,
  type ExternalAgentVerificationReport,
  type PublishedCatalogsPayload,
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

function assertPositiveNumber(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} 必须是正数`);
}

function isJsonContentType(contentType: string | null): boolean {
  return /^application\/(?:[a-z0-9.+-]+\+)?json(?:;|$)/i.test(contentType ?? '');
}

/** Resolve a demo onboarding contract through the host's published-catalog discovery API. */
export async function resolveAgentOnboardingContract(
  options: AgentDiscoveryOptions,
): Promise<AgentOnboardingDiscovery> {
  assertHttpUrl(options.discoveryUrl, 'Published catalog discovery URL');
  const timeoutMs = options.discoveryTimeoutMs ?? 15_000;
  const maxBytes = options.discoveryMaxBytes ?? 1_000_000;
  assertPositiveNumber('discoveryTimeoutMs', timeoutMs);
  assertPositiveNumber('discoveryMaxBytes', maxBytes);

  const fetchImpl = options.discoveryFetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(options.discoveryUrl, {
      method: 'GET',
      headers: { ...options.discoveryHeaders, Accept: 'application/json' },
      signal: controller.signal,
    });
    const body = await response.arrayBuffer();
    if (!response.ok) {
      throw new Error(
        `Published catalog discovery 请求失败 (${response.status}): ${new TextDecoder()
          .decode(body)
          .slice(0, 200)}`,
      );
    }
    if (!isJsonContentType(response.headers.get('content-type'))) {
      throw new Error('Published catalog discovery 必须返回 JSON');
    }
    if (body.byteLength > maxBytes) {
      throw new Error(`Published catalog discovery 超过 ${maxBytes} 字节上限`);
    }

    const payload = JSON.parse(new TextDecoder().decode(body)) as PublishedCatalogsPayload;
    if (payload.kind !== 'published-catalog-list' || !Array.isArray(payload.catalogs)) {
      throw new Error('Published catalog discovery payload 无效');
    }
    const catalogId = options.catalogId ?? DEMO_AGENT_CATALOG_ID;
    const catalog = payload.catalogs.find((item) => item.catalogId === catalogId);
    if (!catalog) throw new Error(`Published catalogs 不包含 catalog: ${catalogId}`);
    if (
      !Array.isArray(catalog.components) ||
      typeof catalog.catalogContractUrl !== 'string' ||
      typeof catalog.agentOnboardingUrl !== 'string'
    ) {
      throw new Error(`Published catalog 缺少可用的 contract URL: ${catalogId}`);
    }
    assertHttpUrl(catalog.catalogContractUrl, 'Catalog contract URL');
    assertHttpUrl(catalog.agentOnboardingUrl, 'Agent onboarding contract URL');

    return {
      discoveryUrl: options.discoveryUrl,
      catalogId,
      components: catalog.components,
      actions: catalog.actions ?? [],
      catalogContractUrl: catalog.catalogContractUrl,
      agentOnboardingUrl: catalog.agentOnboardingUrl,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Published catalog discovery 请求超过 ${timeoutMs}ms 未完成`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
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
