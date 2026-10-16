import type { Component } from '@nexus-ui/core';

export type MediaComponent = 'Image' | 'Video' | 'AudioPlayer';
export type RequiredMediaPolicy = Record<MediaComponent, boolean>;

export interface AgentPolicyContext {
  readonly kind: 'generate' | 'action';
  readonly surfaceId: string;
  readonly catalogId: string;
  readonly message?: string;
}

export interface AgentPolicy {
  /** Optional label for diagnostics, tests, and host observability. */
  readonly name?: string;
  validateComponent?(component: Component, context: AgentPolicyContext): string | null;
  validateLiteralMedia?(component: Component, context: AgentPolicyContext): string | null;
  validateDynamicMedia?(
    component: Component,
    dataModel: unknown,
    context: AgentPolicyContext,
  ): string | null;
  getRequiredMedia?(context: AgentPolicyContext): RequiredMediaPolicy;
  validateFinal?(context: AgentPolicyContext, components: readonly Component[]): string | null;
}

/** Fully resolved hooks; the diagnostic label stays optional. */
export type ResolvedAgentPolicy = Omit<Required<AgentPolicy>, 'name'> & {
  readonly name?: string;
};

/**
 * The SDK ships no business rules: an unset policy rejects nothing and requires
 * no media. Hosts pass their own AgentPolicy (per adapter, run, or verifier).
 */
const neutralPolicy: ResolvedAgentPolicy = {
  validateComponent: () => null,
  validateLiteralMedia: () => null,
  validateDynamicMedia: () => null,
  getRequiredMedia: () => ({ Image: false, Video: false, AudioPlayer: false }),
  validateFinal: () => null,
};

/** Merge a host policy over the neutral no-op defaults. Internal SDK seam. */
export function resolveAgentPolicy(policy?: AgentPolicy): ResolvedAgentPolicy {
  return { ...neutralPolicy, ...policy };
}
