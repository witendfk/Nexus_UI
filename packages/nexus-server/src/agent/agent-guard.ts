import type { A2UIErrorCode, A2UIMessage, Component } from '@nexus-ui/core';
import type { CatalogRegistry } from '@nexus-ui/core';
import { applyDataModelUpdate } from '@nexus-ui/core';
import type { ComponentSchemaDiagnostic } from '@nexus-ui/core';
import {
  BASIC_CATALOG_ACTIONS,
  NEXUS_BASIC_TASK_CATALOG,
  TASK_CATALOG,
  agentCatalogRegistry,
} from './catalog';
import { resolveAgentPolicy, type AgentPolicy } from './policy';

export interface AgentSequenceOptions {
  kind: 'generate' | 'action';
  surfaceId: string;
  catalogId?: string;
  registry?: CatalogRegistry;
  supportedActions?: readonly string[];
  message?: string;
  policy?: AgentPolicy;
}

function getMessageInfo(message: A2UIMessage): { key: string; surfaceId: string } {
  if ('createSurface' in message) {
    return { key: 'createSurface', surfaceId: message.createSurface.surfaceId };
  }
  if ('updateComponents' in message) {
    return { key: 'updateComponents', surfaceId: message.updateComponents.surfaceId };
  }
  if ('updateDataModel' in message) {
    return { key: 'updateDataModel', surfaceId: message.updateDataModel.surfaceId };
  }
  return { key: 'deleteSurface', surfaceId: message.deleteSurface.surfaceId };
}

interface AgentSequenceValidationIssue {
  readonly message: string;
  readonly boundaryCode?: A2UIErrorCode;
}

function validateAgentSequenceDetailed(
  message: A2UIMessage,
  index: number,
  sequence: AgentSequenceOptions,
): AgentSequenceValidationIssue | null {
  const kind = sequence.kind;
  const surfaceId = sequence.surfaceId;
  const catalogId = sequence.catalogId ?? NEXUS_BASIC_TASK_CATALOG;
  const registry = sequence.registry ?? agentCatalogRegistry;
  const supportedActions = sequence.supportedActions ?? BASIC_CATALOG_ACTIONS;
  const resolvedPolicy = resolveAgentPolicy(sequence.policy);
  const policyContext = {
    kind,
    surfaceId,
    catalogId,
    message: sequence.message,
  };
  const info = getMessageInfo(message);
  if (info.surfaceId !== surfaceId) {
    return {
      boundaryCode: 'LIFECYCLE_INVALID',
      message: `消息 surfaceId 必须保持为 ${surfaceId}`,
    };
  }
  const catalog = registry.get(catalogId);
  if (!catalog) {
    return {
      boundaryCode: 'CATALOG_UNSUPPORTED',
      message: `Agent catalog 未注册: ${catalogId}`,
    };
  }

  if ('createSurface' in message && message.createSurface.catalogId !== catalogId) {
    return {
      boundaryCode: 'LIFECYCLE_INVALID',
      message: `createSurface.catalogId 必须保持为 ${catalogId}`,
    };
  }
  if ('updateComponents' in message) {
    for (const component of message.updateComponents.components) {
      if (!catalog.components.includes(component.component)) {
        return {
          boundaryCode: 'CATALOG_UNSUPPORTED',
          message: `当前 Agent 线不支持组件: ${String(component.component)}`,
        };
      }
      const capabilityError = registry.getComponentDiagnostics(catalogId, component)[0];
      if (capabilityError) {
        return {
          boundaryCode: 'CATALOG_UNSUPPORTED',
          message: capabilityError.message,
        };
      }

      const componentPolicyError = resolvedPolicy.validateComponent(component, policyContext);
      if (componentPolicyError) {
        return { boundaryCode: 'POLICY_REJECTED', message: componentPolicyError };
      }
      const mediaPolicyError = resolvedPolicy.validateLiteralMedia(component, policyContext);
      if (mediaPolicyError) {
        return { boundaryCode: 'POLICY_REJECTED', message: mediaPolicyError };
      }
      const actionName = component.action?.event?.name;
      if (actionName !== undefined && !supportedActions.includes(actionName)) {
        return {
          boundaryCode: 'CATALOG_UNSUPPORTED',
          message: `当前 Agent 线不支持 action: ${actionName}`,
        };
      }
      if (actionName !== undefined) {
        const actionComponent = catalogId === TASK_CATALOG ? 'TaskButton' : 'Button';
        if (component.component !== actionComponent) {
          return {
            boundaryCode: 'CATALOG_UNSUPPORTED',
            message: `当前 Agent 线 action 只能挂载在 ${actionComponent} 组件上`,
          };
        }
      }
    }
  }
  if (kind === 'action') {
    if (info.key === 'createSurface' || info.key === 'deleteSurface') {
      return {
        boundaryCode: 'LIFECYCLE_INVALID',
        message: 'action 响应只能包含 updateComponents 或 updateDataModel',
      };
    }
    return null;
  }
  if (index === 0 && info.key !== 'createSurface') {
    return {
      boundaryCode: 'LIFECYCLE_INVALID',
      message: '生成流第一条消息必须是 createSurface',
    };
  }
  if (index > 0 && info.key !== 'updateComponents' && info.key !== 'updateDataModel') {
    return {
      boundaryCode: 'LIFECYCLE_INVALID',
      message: 'createSurface 之后只能包含 updateComponents 或 updateDataModel',
    };
  }
  return null;
}

/** Backward-compatible string wrapper for sequence validation. */
export function validateAgentSequence(
  message: A2UIMessage,
  index: number,
  sequence: AgentSequenceOptions,
): string | null {
  return validateAgentSequenceDetailed(message, index, sequence)?.message ?? null;
}

export interface AgentStreamState {
  componentsById: Map<string, Component>;
  dataModel: unknown;
  hasRoot: boolean;
  hasBasicMedia: Record<'Image' | 'Video' | 'AudioPlayer', boolean>;
}

export interface AgentStreamValidationIssue {
  readonly message: string;
  readonly boundaryCode?: A2UIErrorCode;
  readonly diagnostics?: readonly ComponentSchemaDiagnostic[];
}

export function createAgentStreamState(): AgentStreamState {
  return {
    componentsById: new Map(),
    dataModel: undefined,
    hasRoot: false,
    hasBasicMedia: { Image: false, Video: false, AudioPlayer: false },
  };
}

function collectCatalogDiagnostics(
  components: Iterable<Component>,
  dataModel: unknown,
  sequence: AgentSequenceOptions,
): ComponentSchemaDiagnostic[] {
  const registry = sequence.registry ?? agentCatalogRegistry;
  const catalogId = sequence.catalogId ?? NEXUS_BASIC_TASK_CATALOG;
  const diagnostics: ComponentSchemaDiagnostic[] = [];

  for (const component of components) {
    diagnostics.push(...registry.getComponentDiagnostics(catalogId, component, dataModel));
  }
  return diagnostics;
}

function formatDiagnostics(diagnostics: readonly ComponentSchemaDiagnostic[]): string {
  return diagnostics.map((diagnostic) => diagnostic.message).join('; ');
}

function createIssue(
  message: string,
  diagnostics: readonly ComponentSchemaDiagnostic[] = [],
  boundaryCode?: A2UIErrorCode,
): AgentStreamValidationIssue {
  return {
    ...(boundaryCode === undefined ? {} : { boundaryCode }),
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    message,
  };
}

/**
 * Validate cross-message bindings while preserving A2UI streaming semantics.
 * A text component and its URL value can arrive in different messages.
 */
export function validateAgentStreamMessageDetailed(
  message: A2UIMessage,
  index: number,
  sequence: AgentSequenceOptions,
  state: AgentStreamState,
): AgentStreamValidationIssue | null {
  const resolvedPolicy = resolveAgentPolicy(sequence.policy);
  const policyContext = {
    kind: sequence.kind,
    surfaceId: sequence.surfaceId,
    catalogId: sequence.catalogId ?? NEXUS_BASIC_TASK_CATALOG,
    message: sequence.message,
  };
  const sequenceError = validateAgentSequenceDetailed(message, index, sequence);

  if ('updateComponents' in message) {
    const nextComponents = new Map(state.componentsById);
    for (const component of message.updateComponents.components) {
      nextComponents.set(component.id, component);
    }
    const components = [...nextComponents.values()];

    const catalogDiagnostics = collectCatalogDiagnostics(components, state.dataModel, sequence);
    if (sequenceError) {
      return createIssue(sequenceError.message, catalogDiagnostics, sequenceError.boundaryCode);
    }
    if (catalogDiagnostics.length > 0) {
      return {
        message: formatDiagnostics(catalogDiagnostics),
        diagnostics: catalogDiagnostics,
      };
    }

    for (const component of components) {
      const textError = resolvedPolicy.validateDynamicMedia(
        component,
        state.dataModel,
        policyContext,
      );
      if (textError) return createIssue(textError, undefined, 'POLICY_REJECTED');
    }

    const hasRoot = state.hasRoot || components.some((component) => component.id === 'root');
    const hasBasicMedia = { ...state.hasBasicMedia };
    for (const mediaComponent of ['Image', 'Video', 'AudioPlayer'] as const) {
      hasBasicMedia[mediaComponent] ||= components.some(
        (component) => component.component === mediaComponent,
      );
    }
    const requiredBasicMedia = resolvedPolicy.getRequiredMedia(policyContext);
    const mediaLabels = {
      Image: '图片',
      Video: '视频',
      AudioPlayer: '音频',
    } as const;
    for (const mediaComponent of ['Image', 'Video', 'AudioPlayer'] as const) {
      if (requiredBasicMedia[mediaComponent] && hasRoot && !hasBasicMedia[mediaComponent]) {
        return createIssue(
          `请求${mediaLabels[mediaComponent]}内容的生成流必须包含 Basic Catalog ${mediaComponent} 组件`,
          undefined,
          'POLICY_REJECTED',
        );
      }
    }

    state.componentsById = nextComponents;
    state.hasRoot = hasRoot;
    state.hasBasicMedia = hasBasicMedia;
    return null;
  }

  if ('updateDataModel' in message) {
    const nextDataModel = applyDataModelUpdate(state.dataModel, message.updateDataModel);
    const catalogDiagnostics = collectCatalogDiagnostics(
      state.componentsById.values(),
      nextDataModel,
      sequence,
    );
    if (sequenceError) {
      return createIssue(sequenceError.message, catalogDiagnostics, sequenceError.boundaryCode);
    }
    if (catalogDiagnostics.length > 0) {
      return {
        message: formatDiagnostics(catalogDiagnostics),
        diagnostics: catalogDiagnostics,
      };
    }

    for (const component of state.componentsById.values()) {
      const textError = resolvedPolicy.validateDynamicMedia(
        component,
        nextDataModel,
        policyContext,
      );
      if (textError) return createIssue(textError, undefined, 'POLICY_REJECTED');
    }
    state.dataModel = nextDataModel;
  }

  if (sequenceError) {
    return createIssue(sequenceError.message, undefined, sequenceError.boundaryCode);
  }
  return null;
}

/** Backward-compatible string guard; detailed callers receive diagnostics. */
export function validateAgentStreamMessage(
  message: A2UIMessage,
  index: number,
  sequence: AgentSequenceOptions,
  state: AgentStreamState,
): string | null {
  return validateAgentStreamMessageDetailed(message, index, sequence, state)?.message ?? null;
}

export function validateAgentStreamFinal(
  sequence: AgentSequenceOptions,
  state: AgentStreamState,
): string | null {
  return validateAgentStreamFinalDetailed(sequence, state)?.message ?? null;
}

export function validateAgentStreamFinalDetailed(
  sequence: AgentSequenceOptions,
  state: AgentStreamState,
): AgentStreamValidationIssue | null {
  if (sequence.kind !== 'generate' || !state.hasRoot) return null;
  const policyContext = {
    kind: sequence.kind,
    surfaceId: sequence.surfaceId,
    catalogId: sequence.catalogId ?? NEXUS_BASIC_TASK_CATALOG,
    message: sequence.message,
  };
  const finalError = resolveAgentPolicy(sequence.policy).validateFinal(policyContext, [
    ...state.componentsById.values(),
  ]);
  return finalError ? { boundaryCode: 'POLICY_REJECTED', message: finalError } : null;
}
