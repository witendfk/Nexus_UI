import { CatalogRegistry, createCatalogPromptContract } from '@nexus-ui/core';
import type { CatalogDefinition } from '@nexus-ui/core';
import { SERVER_API_VERSION } from '../version';
import type { CatalogContractPayload } from './routes';
import {
  CATALOG_CONTRACT_VERSION,
  createCatalogContractHash,
  isCatalogContractHash,
} from '../agent/catalog-contract';

export const AGENT_ONBOARDING_CONTRACT_VERSION = 1;

export const AGENT_ONBOARDING_BOUNDARY_CODES = [
  'PROTOCOL_INVALID',
  'LIFECYCLE_INVALID',
  'CATALOG_UNSUPPORTED',
  'FEATURE_UNSUPPORTED',
  'POLICY_REJECTED',
] as const;

export type AgentOnboardingBoundaryCode = (typeof AGENT_ONBOARDING_BOUNDARY_CODES)[number];

export const AGENT_ONBOARDING_CHECKS = [
  {
    id: 'generation-lifecycle',
    requirement: 'generation starts with createSurface and ends with done',
  },
  {
    id: 'catalog-stability',
    requirement: 'catalogId remains stable across the stream',
  },
  {
    id: 'generation-root',
    requirement: 'a component with id root is rendered',
  },
  {
    id: 'action-same-surface',
    requirement: 'action response uses the same surfaceId and does not create or delete it',
  },
  {
    id: 'action-root-stability',
    requirement: 'root remains available for same-surface patching',
  },
  {
    id: 'policy-rejection',
    requirement: 'host policy rejection returns POLICY_REJECTED',
  },
] as const;

export type AgentOnboardingCheckId = (typeof AGENT_ONBOARDING_CHECKS)[number]['id'];

export interface AgentOnboardingContractOptions {
  catalogContract: CatalogContractPayload;
  /** Publish only when the host intentionally wants to disclose its Agent endpoint. */
  rpcEndpoint?: string;
  /** A host-owned command external Agent developers can run for acceptance. */
  verificationCommand?: string;
}

export interface AgentOnboardingContractPayload {
  readonly serverApiVersion: 1;
  readonly contractVersion: 1;
  readonly kind: 'agent-onboarding-contract';
  readonly protocol: {
    readonly name: 'A2UI';
    readonly version: 'v0.9';
    readonly wireFormat: 'JSONL';
    readonly surfaceModel: 'flat components + dataModel + stable component ids';
  };
  readonly catalogContract: CatalogContractPayload;
  readonly rpc: {
    readonly endpoint: {
      readonly method: 'POST';
      readonly disclosed: boolean;
      readonly url?: string;
    };
    readonly request: {
      readonly contentType: 'application/json';
      readonly generate: {
        readonly version: 1;
        readonly kind: 'generate';
        readonly requiredFields: readonly string[];
        readonly catalogBoundFields: readonly string[];
      };
      readonly action: {
        readonly version: 1;
        readonly kind: 'action';
        readonly requiredFields: readonly string[];
        readonly catalogBoundFields: readonly string[];
      };
    };
    readonly response: {
      readonly status: '2xx';
      readonly contentType: readonly ('application/x-ndjson' | 'application/jsonl')[];
      readonly body: 'one A2UI v0.9 JSON object per line';
    };
  };
  readonly errors: {
    readonly transport: 'SSE error event';
    readonly boundaryCodes: readonly AgentOnboardingBoundaryCode[];
  };
  readonly verification: {
    readonly required: true;
    readonly type: 'external-agent';
    readonly checks: typeof AGENT_ONBOARDING_CHECKS;
    readonly command?: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * S2.5.5：onboarding 只内嵌已校验且与发布一致的 catalog contract。版本、hash
 * 格式、catalog 形状与 hash↔内容一致性在此核对；hash 复用 server 既有实现，
 * 不复制解释器。非法输入在装配期显式失败，不生成自相矛盾的 onboarding 契约。
 */
function assertValidCatalogContractPayload(payload: CatalogContractPayload): void {
  const label = 'agent onboarding 的 catalog contract 无效';
  if (!isRecord(payload)) throw new Error(`${label}: 必须是 catalog contract 对象`);
  if (payload.serverApiVersion !== SERVER_API_VERSION) {
    throw new Error(`${label}: serverApiVersion 必须是 ${SERVER_API_VERSION}`);
  }
  if (payload.kind !== 'catalog-contract') {
    throw new Error(`${label}: kind 必须是 catalog-contract`);
  }
  if (payload.contractVersion !== CATALOG_CONTRACT_VERSION) {
    throw new Error(`${label}: contractVersion 必须是 ${CATALOG_CONTRACT_VERSION}`);
  }
  if (!isCatalogContractHash(payload.contractHash)) {
    throw new Error(`${label}: contractHash 必须是 sha256:<64 hex> 格式`);
  }
  if (
    !isRecord(payload.catalog) ||
    typeof payload.catalog.catalogId !== 'string' ||
    payload.catalog.catalogId === ''
  ) {
    throw new Error(`${label}: catalog 必须是带非空 catalogId 的对象`);
  }
  new CatalogRegistry([payload.catalog as CatalogDefinition]);
  if (
    payload.promptContract !== createCatalogPromptContract(payload.catalog as CatalogDefinition)
  ) {
    throw new Error(`${label}: promptContract 与 catalog 内容不一致`);
  }
  if (typeof payload.promptContract !== 'string' || payload.promptContract === '') {
    throw new Error(`${label}: promptContract 必须是非空字符串`);
  }
  if (payload.contractHash !== createCatalogContractHash(payload.catalog as CatalogDefinition)) {
    throw new Error(`${label}: contractHash 与 catalog 内容不一致`);
  }
}

export function createAgentOnboardingContract({
  catalogContract,
  rpcEndpoint,
  verificationCommand,
}: AgentOnboardingContractOptions): AgentOnboardingContractPayload {
  catalogContract = structuredClone(catalogContract);
  assertValidCatalogContractPayload(catalogContract);
  return {
    serverApiVersion: 1,
    contractVersion: 1,
    kind: 'agent-onboarding-contract',
    protocol: {
      name: 'A2UI',
      version: 'v0.9',
      wireFormat: 'JSONL',
      surfaceModel: 'flat components + dataModel + stable component ids',
    },
    catalogContract: structuredClone(catalogContract),
    rpc: {
      endpoint: {
        method: 'POST',
        disclosed: rpcEndpoint !== undefined,
        ...(rpcEndpoint === undefined ? {} : { url: rpcEndpoint }),
      },
      request: {
        contentType: 'application/json',
        generate: {
          version: 1,
          kind: 'generate',
          requiredFields: [
            'version',
            'kind',
            'surfaceId',
            'message',
            'catalogId',
            'catalogContract',
          ],
          catalogBoundFields: [
            'catalogId',
            'supportedComponents',
            'supportedActions',
            'catalogContract.hash',
            'catalogContract.url?',
          ],
        },
        action: {
          version: 1,
          kind: 'action',
          requiredFields: [
            'version',
            'kind',
            'surfaceId',
            'action.name',
            'action.surfaceId',
            'action.sourceComponentId',
            'action.timestamp',
            'action.context',
            'catalogId',
            'catalogContract',
          ],
          catalogBoundFields: [
            'catalogId',
            'supportedComponents',
            'supportedActions',
            'catalogContract.hash',
            'catalogContract.url?',
          ],
        },
      },
      response: {
        status: '2xx',
        contentType: ['application/x-ndjson', 'application/jsonl'],
        body: 'one A2UI v0.9 JSON object per line',
      },
    },
    errors: {
      transport: 'SSE error event',
      boundaryCodes: AGENT_ONBOARDING_BOUNDARY_CODES,
    },
    verification: {
      required: true,
      type: 'external-agent',
      checks: AGENT_ONBOARDING_CHECKS,
      ...(verificationCommand === undefined ? {} : { command: verificationCommand }),
    },
  };
}
