import type { Component } from '@nexus-ui/core';
import type { AgentPolicy, AgentPolicyContext, ResolvedAgentPolicy } from '@nexus-ui/server';
import { NEXUS_BASIC_TASK_CATALOG, WORKBENCH_CATALOG } from '../catalog';
import { validateComponentPolicy, getDataBindingPath } from './component-policy';
import {
  getRequiredMediaPolicy,
  validateDynamicMediaPolicy,
  validateLiteralMediaPolicy,
} from './media-policy';
import { validateWorkflowPolicy } from './workflow-policy';

export type { MediaComponent, RequiredMediaPolicy } from '@nexus-ui/server';
export type { AgentPolicy, AgentPolicyContext, ResolvedAgentPolicy };
export { getDataBindingPath };

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

/** Playground demo policy: media semantics plus search/form/Workbench flow rules. */
export const nexusAgentPolicy: ResolvedAgentPolicy = {
  name: 'playground-demo',
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

/** Demo policies may override any subset; unset hooks stay playground defaults. */
export function resolveAgentPolicy(policy?: AgentPolicy): ResolvedAgentPolicy {
  return { ...nexusAgentPolicy, ...policy };
}
