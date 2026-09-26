import type { CatalogContractPayload } from './routes';

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

export function createAgentOnboardingContract({
  catalogContract,
  rpcEndpoint,
  verificationCommand,
}: AgentOnboardingContractOptions): AgentOnboardingContractPayload {
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
    catalogContract,
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
          requiredFields: ['version', 'kind', 'surfaceId', 'message', 'catalogId'],
          catalogBoundFields: ['catalogId', 'supportedComponents', 'supportedActions'],
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
          ],
          catalogBoundFields: ['catalogId', 'supportedComponents', 'supportedActions'],
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
