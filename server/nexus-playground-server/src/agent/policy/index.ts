import type { Component } from '@nexus-ui/core';
import { NEXUS_BASIC_TASK_CATALOG, WORKBENCH_CATALOG } from '../catalog';
import { validateComponentPolicy, getDataBindingPath } from './component-policy';
import {
  getRequiredMediaPolicy,
  validateDynamicMediaPolicy,
  validateLiteralMediaPolicy,
  type MediaComponent,
  type RequiredMediaPolicy,
} from './media-policy';
import { validateWorkflowPolicy } from './workflow-policy';

export type { MediaComponent, RequiredMediaPolicy };

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

export type ResolvedAgentPolicy = Required<AgentPolicy>;

function validateWorkbenchButtonPolicy(component: Component): string | null {
  if (component.component !== 'Button') return null;
  const allowedKeys = new Set(['id', 'component', 'child', 'disabled', 'action']);
  if (!Object.keys(component).every((key) => allowedKeys.has(key))) {
    return 'Workbench Button 只支持 id/component/child/disabled/action';
  }
  if (typeof component.child !== 'string') return 'Workbench Button.child 必须是组件 id';
  if (component.disabled !== undefined && typeof component.disabled !== 'boolean') {
    return 'Workbench Button.disabled 必须是布尔值';
  }
  if (component.action?.event === undefined) return 'Workbench Button 必须挂载 submit action';
  return null;
}

function isMediaPolicyCatalog(catalogId: string): boolean {
  return catalogId === NEXUS_BASIC_TASK_CATALOG || catalogId === WORKBENCH_CATALOG;
}

export const nexusAgentPolicy: ResolvedAgentPolicy = {
  name: 'nexus-default',
  validateComponent(component, context) {
    if (context.catalogId === WORKBENCH_CATALOG) {
      const workbenchError = validateWorkbenchButtonPolicy(component);
      if (workbenchError) return workbenchError;
    }
    if (isMediaPolicyCatalog(context.catalogId)) {
      return validateComponentPolicy(component);
    }
    return null;
  },
  validateLiteralMedia(component, context) {
    if (!isMediaPolicyCatalog(context.catalogId)) return null;
    return validateLiteralMediaPolicy(component);
  },
  validateDynamicMedia(component, dataModel) {
    return validateDynamicMediaPolicy(component, dataModel);
  },
  getRequiredMedia(context) {
    if (context.catalogId !== NEXUS_BASIC_TASK_CATALOG) {
      return { Image: false, Video: false, AudioPlayer: false };
    }
    return getRequiredMediaPolicy(context.message);
  },
  validateFinal(context, components) {
    return validateWorkflowPolicy(context, [...components]);
  },
};

/** Host policies may override any subset; unset hooks retain Nexus defaults. */
export function resolveAgentPolicy(policy?: AgentPolicy): ResolvedAgentPolicy {
  return { ...nexusAgentPolicy, ...policy };
}

export { getDataBindingPath };
