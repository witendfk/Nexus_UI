import type { CatalogDefinition } from '@nexus-ui/core';
import {
  AGENT_ONBOARDING_BOUNDARY_CODES,
  AGENT_ONBOARDING_CHECKS,
  AGENT_ONBOARDING_CONTRACT_VERSION,
  type AgentOnboardingContractPayload,
} from '../api/agent-onboarding';
import { SERVER_API_VERSION } from '../version';
import {
  verifyExternalAgentIntegration,
  type ExternalAgentVerificationOptions,
  type ExternalAgentVerificationReport,
} from './verification';

export interface ExternalAgentOnboardingVerificationOptions extends Omit<
  ExternalAgentVerificationOptions,
  'catalog' | 'endpoint'
> {
  /** Read-only Agent Onboarding Contract URL published by the host. */
  contractUrl: string;
  /** Required when the host chose not to disclose the Agent RPC endpoint. */
  endpoint?: string;
  /** Optional guard against accidentally verifying a different published catalog. */
  expectedCatalogId?: string;
  contractHeaders?: Record<string, string>;
  contractTimeoutMs?: number;
  contractMaxBytes?: number;
  contractFetch?: typeof fetch;
}

export interface ExternalAgentOnboardingVerificationReport extends ExternalAgentVerificationReport {
  contractUrl: string;
  contract: AgentOnboardingContractPayload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertHttpUrl(url: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label}: ${url} (${reason})`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid ${label}: ${url} (protocol must be http or https)`);
  }
  return parsed;
}

function assertPositiveNumber(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} 必须是正数`);
  }
}

function isJsonContentType(contentType: string | null): boolean {
  return /^application\/(?:[a-z0-9.+-]+\+)?json(?:;|$)/i.test(contentType ?? '');
}

async function readErrorResponse(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 200);
  } catch {
    return '';
  }
}

async function fetchOnboardingContract(
  contractUrl: string,
  options: ExternalAgentOnboardingVerificationOptions,
): Promise<AgentOnboardingContractPayload> {
  assertHttpUrl(contractUrl, 'Agent onboarding contract URL');
  const timeoutMs = options.contractTimeoutMs ?? 15_000;
  const maxBytes = options.contractMaxBytes ?? 1_000_000;
  assertPositiveNumber('contractTimeoutMs', timeoutMs);
  assertPositiveNumber('contractMaxBytes', maxBytes);

  const fetchImpl = options.contractFetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(contractUrl, {
      method: 'GET',
      headers: {
        ...options.contractHeaders,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `Agent onboarding contract 请求失败 (${response.status}): ${await readErrorResponse(response)}`,
      );
    }
    if (!isJsonContentType(response.headers.get('content-type'))) {
      throw new Error('Agent onboarding contract 必须返回 JSON');
    }
    const body = await response.arrayBuffer();
    if (body.byteLength > maxBytes) {
      throw new Error(`Agent onboarding contract 超过 ${maxBytes} 字节上限`);
    }
    return JSON.parse(new TextDecoder().decode(body)) as AgentOnboardingContractPayload;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Agent onboarding contract 请求超过 ${timeoutMs}ms 未完成`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function validateContract(
  value: unknown,
  contractUrl: string,
  expectedCatalogId?: string,
): AgentOnboardingContractPayload {
  if (!isRecord(value)) {
    throw new Error(`Agent onboarding contract 无效: ${contractUrl}`);
  }
  if (value.serverApiVersion !== SERVER_API_VERSION) {
    throw new Error(`Agent onboarding contract serverApiVersion 必须是 ${SERVER_API_VERSION}`);
  }
  if (value.contractVersion !== AGENT_ONBOARDING_CONTRACT_VERSION) {
    throw new Error(
      `Agent onboarding contract contractVersion 必须是 ${AGENT_ONBOARDING_CONTRACT_VERSION}`,
    );
  }
  if (value.kind !== 'agent-onboarding-contract') {
    throw new Error('Agent onboarding contract kind 必须是 agent-onboarding-contract');
  }

  const protocol = value.protocol;
  if (
    !isRecord(protocol) ||
    protocol.name !== 'A2UI' ||
    protocol.version !== 'v0.9' ||
    protocol.wireFormat !== 'JSONL'
  ) {
    throw new Error('Agent onboarding contract 必须声明 A2UI v0.9 JSONL');
  }

  const catalogContract = value.catalogContract;
  if (!isRecord(catalogContract) || catalogContract.kind !== 'catalog-contract') {
    throw new Error('Agent onboarding contract 缺少 catalog-contract');
  }
  const catalog = catalogContract.catalog as CatalogDefinition | undefined;
  if (
    !isRecord(catalog) ||
    typeof catalog.catalogId !== 'string' ||
    catalog.catalogId === '' ||
    !Array.isArray(catalog.components) ||
    catalog.components.length === 0
  ) {
    throw new Error('Agent onboarding contract 缺少可用 catalog');
  }
  if (expectedCatalogId !== undefined && catalog.catalogId !== expectedCatalogId) {
    throw new Error(
      `Agent onboarding contract catalogId 不匹配：预期 ${expectedCatalogId}，实际 ${catalog.catalogId}`,
    );
  }

  const rpc = value.rpc;
  const endpoint = isRecord(rpc) ? rpc.endpoint : undefined;
  if (
    !isRecord(endpoint) ||
    endpoint.method !== 'POST' ||
    typeof endpoint.disclosed !== 'boolean' ||
    (endpoint.disclosed &&
      (typeof endpoint.url !== 'string' ||
        (() => {
          try {
            const url = new URL(endpoint.url);
            return url.protocol !== 'http:' && url.protocol !== 'https:';
          } catch {
            return true;
          }
        })()))
  ) {
    throw new Error('Agent onboarding contract RPC endpoint 无效');
  }

  const errors = value.errors;
  const boundaryCodes = isRecord(errors) ? errors.boundaryCodes : undefined;
  if (
    !Array.isArray(boundaryCodes) ||
    boundaryCodes.length !== AGENT_ONBOARDING_BOUNDARY_CODES.length ||
    !AGENT_ONBOARDING_BOUNDARY_CODES.every((code) => boundaryCodes.includes(code))
  ) {
    throw new Error('Agent onboarding contract 错误边界码不完整');
  }

  const verification = value.verification;
  const checks = isRecord(verification) ? verification.checks : undefined;
  if (
    !isRecord(verification) ||
    verification.required !== true ||
    verification.type !== 'external-agent' ||
    !Array.isArray(checks) ||
    checks.length !== AGENT_ONBOARDING_CHECKS.length ||
    !AGENT_ONBOARDING_CHECKS.every((check, index) => {
      const candidate = checks[index];
      return (
        isRecord(candidate) &&
        candidate.id === check.id &&
        candidate.requirement === check.requirement
      );
    })
  ) {
    throw new Error('Agent onboarding contract verification checks 不匹配');
  }

  return value as unknown as AgentOnboardingContractPayload;
}

/**
 * Fetch a host-published onboarding contract, validate its v1 shape, and verify the Agent it names.
 */
export async function verifyExternalAgentOnboarding(
  options: ExternalAgentOnboardingVerificationOptions,
): Promise<ExternalAgentOnboardingVerificationReport> {
  const contract = validateContract(
    await fetchOnboardingContract(options.contractUrl, options),
    options.contractUrl,
    options.expectedCatalogId,
  );
  const endpoint = options.endpoint ?? contract.rpc.endpoint.url;
  if (!endpoint) {
    throw new Error('onboarding contract 未披露 Agent endpoint，且验收调用没有提供 endpoint');
  }

  const report = await verifyExternalAgentIntegration({
    ...options,
    endpoint,
    catalog: contract.catalogContract.catalog,
  });
  return { ...report, contractUrl: options.contractUrl, contract };
}
