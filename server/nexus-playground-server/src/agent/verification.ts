import type Koa from 'koa';
import { PassThrough } from 'stream';
import type { A2UIErrorCode, A2UIMessage, CatalogDefinition, Component } from '@nexus-ui/core';
import { CatalogRegistry, applyDataModelUpdate, resolveContext } from '@nexus-ui/core';
import type { AgentPolicy } from './policy';
import { AgentAdapter } from './adapter';
import { InMemorySurfaceHistoryStore } from './history';
import {
  createExternalAgentActionHandler,
  createExternalAgentGenerationSource,
  type ExternalAgentRpcConfig,
} from './external-agent';
import { sendAgentRun } from '../api/send-messages';
import type { AgentRun } from './adapter';
import { AGENT_ONBOARDING_CHECKS, type AgentOnboardingCheckId } from '../api/agent-onboarding';

export interface ExternalAgentVerificationOptions extends ExternalAgentRpcConfig {
  /** The catalog this external Agent is expected to implement. */
  catalog: CatalogDefinition;
  /** Optional host policy; it also becomes the final workflow boundary. */
  policy?: AgentPolicy;
  /** Natural-language task sent to the external Agent. */
  message?: string;
  /** Select the component whose action should be exercised. */
  actionSelector?: (components: readonly Component[]) => Component | null;
  /** Set false to skip the independent host-policy rejection probe. */
  verifyPolicyRejection?: boolean;
}

export interface ExternalAgentVerificationReport {
  endpoint: string;
  catalogId: string;
  surfaceId: string;
  message: string;
  generationMessages: number;
  actionName: string;
  actionComponentId: string;
  actionContext: Record<string, unknown>;
  actionMessages: number;
  componentIdsAfterGeneration: string[];
  componentIdsAfterAction: string[];
  policyRejection: {
    rejected: boolean;
    boundaryCode?: A2UIErrorCode;
    message?: string;
  };
  checks: ExternalAgentVerificationCheck[];
}

export interface ExternalAgentVerificationCheck {
  id: AgentOnboardingCheckId;
  status: 'passed' | 'skipped';
  detail: string;
}

interface SseRun {
  messages: unknown[];
  done: boolean;
  error?: {
    boundaryCode?: A2UIErrorCode;
    message: string;
  };
}

const FRAME_BOUNDARY = /\r\n\r\n|\n\n|\r\r/;

function assertEndpoint(endpoint: string): void {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('protocol must be http or https');
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid external Agent endpoint: ${endpoint} (${reason})`);
  }
}

function assertCatalog(catalog: CatalogDefinition): void {
  if (!catalog.catalogId) throw new Error('Verification catalog is missing catalogId');
  if (catalog.components.length === 0) {
    throw new Error('Verification catalog has no components');
  }
}

function createSseContext(): {
  ctx: Koa.Context;
  getOutput: () => string;
} {
  let output = '';
  let body: unknown;
  const ctx = {
    status: 200,
    set: () => undefined,
    res: { flushHeaders: () => undefined },
    get body() {
      return body;
    },
    set body(value: unknown) {
      body = value;
      if (value instanceof PassThrough) {
        value.on('data', (chunk: Buffer) => {
          output += chunk.toString('utf8');
        });
      }
    },
  } as unknown as Koa.Context;
  return { ctx, getOutput: () => output };
}

function parseSseRun(output: string): SseRun {
  const run: SseRun = { messages: [], done: false };
  let buffer = output;

  for (;;) {
    const boundary = FRAME_BOUNDARY.exec(buffer);
    if (!boundary) break;
    const frame = buffer.slice(0, boundary.index);
    buffer = buffer.slice(boundary.index + boundary[0].length);

    const data: string[] = [];
    let eventName = 'message';
    for (const rawLine of frame.split(/\r\n|\n|\r/)) {
      if (!rawLine || rawLine.startsWith(':')) continue;
      const colon = rawLine.indexOf(':');
      if (colon === -1) continue;
      const field = rawLine.slice(0, colon);
      let value = rawLine.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') eventName = value || 'message';
      if (field === 'data') data.push(value);
    }
    if (data.length === 0) continue;

    if (eventName === 'done') {
      run.done = true;
    } else if (eventName === 'error') {
      const payload = JSON.parse(data.join('\n')) as {
        boundaryCode?: A2UIErrorCode;
        message?: string;
      };
      run.error = {
        boundaryCode: payload.boundaryCode,
        message: payload.message ?? 'Agent stream failed',
      };
    } else if (eventName === 'message') {
      run.messages.push(JSON.parse(data.join('\n')) as unknown);
    }
  }

  return run;
}

async function sendAgentMessages(run: AgentRun, idPrefix: string): Promise<SseRun> {
  const { ctx, getOutput } = createSseContext();
  try {
    const result = await sendAgentRun(ctx, run, idPrefix);
    const parsed = parseSseRun(getOutput());
    if (!result.ok && !parsed.error) {
      parsed.error = { message: 'Agent verification stream failed' };
    }
    return parsed;
  } catch (error) {
    const parsed = parseSseRun(getOutput());
    if (!parsed.error) {
      parsed.error = {
        message: error instanceof Error ? error.message : 'Agent verification stream failed',
      };
    }
    return parsed;
  }
}

function createAdapter(options: ExternalAgentVerificationOptions, policy: AgentPolicy) {
  const registry = new CatalogRegistry([options.catalog]);
  return new AgentAdapter({
    registry,
    actionHandlers: new Map(),
    historyStore: new InMemorySurfaceHistoryStore(),
    useLlm: () => false,
    createGenerationSource: createExternalAgentGenerationSource(options),
    policy,
  });
}

function applyVerificationMessages(messages: A2UIMessage[]): {
  components: Map<string, Component>;
  dataModel: unknown;
} {
  const components = new Map<string, Component>();
  let dataModel: unknown;

  for (const message of messages) {
    if ('updateComponents' in message) {
      for (const component of message.updateComponents.components) {
        components.set(component.id, component);
      }
    }
    if ('updateDataModel' in message) {
      dataModel = applyDataModelUpdate(dataModel, message.updateDataModel);
    }
  }

  return { components, dataModel };
}

function getMessageSurfaceId(message: A2UIMessage): string {
  if ('createSurface' in message) return message.createSurface.surfaceId;
  if ('updateComponents' in message) return message.updateComponents.surfaceId;
  if ('updateDataModel' in message) return message.updateDataModel.surfaceId;
  return message.deleteSurface.surfaceId;
}

function createCheck(
  id: AgentOnboardingCheckId,
  status: 'passed' | 'skipped',
  detail: string,
): ExternalAgentVerificationCheck {
  return { id, status, detail };
}

function defaultActionSelector(components: readonly Component[]): Component | null {
  return components.find((component) => typeof component.action?.event?.name === 'string') ?? null;
}

function selectActionComponent(
  components: Map<string, Component>,
  options: ExternalAgentVerificationOptions,
): { component: Component; name: string } {
  const selector = options.actionSelector ?? defaultActionSelector;
  const component = selector([...components.values()]);
  const name = component?.action?.event?.name;
  if (!component || typeof name !== 'string' || name.length === 0) {
    throw new Error('外部 Agent 生成流没有可供验收的 action');
  }
  return { component, name };
}

/**
 * Verify a real external JSONL Agent through the same guarded host API used by browsers.
 * This checks generation, host policy, action dispatch, and same-surface patching.
 */
export async function verifyExternalAgentIntegration(
  options: ExternalAgentVerificationOptions,
): Promise<ExternalAgentVerificationReport> {
  assertEndpoint(options.endpoint);
  assertCatalog(options.catalog);
  const catalogId = options.catalog.catalogId;
  const message = options.message ?? 'Create an Agent task surface';
  const verifyPolicyRejection = options.verifyPolicyRejection ?? true;

  const generationAdapter = createAdapter(options, options.policy ?? {});
  const generationPlan = await generationAdapter.prepareGeneration({ message, catalogId });
  if (!generationPlan.ok) throw new Error(generationPlan.message);
  const generation = await sendAgentMessages(generationPlan.run, 'verification-generation');
  if (generation.error) {
    throw new Error(`生成流验收失败: ${generation.error.message}`);
  }
  if (!generation.done) throw new Error('生成流验收失败：没有 SSE done');

  const surfaceId = (generation.messages as A2UIMessage[]).find(
    (message) => 'createSurface' in message,
  )?.createSurface.surfaceId;
  if (!surfaceId) throw new Error('生成流验收失败：缺少 createSurface.surfaceId');

  const generatedMessages = generation.messages as A2UIMessage[];
  const generationStartsCorrectly =
    generation.done &&
    generatedMessages.length > 0 &&
    'createSurface' in generatedMessages[0] &&
    generatedMessages[0].createSurface.surfaceId === surfaceId;
  if (!generationStartsCorrectly) {
    throw new Error('生成流验收失败：必须以 createSurface 开始并以 done 结束');
  }

  const catalogIdIsStable = generatedMessages.every((message) => {
    const observedCatalogId =
      'createSurface' in message ? message.createSurface.catalogId : catalogId;
    return observedCatalogId === catalogId;
  });
  if (!catalogIdIsStable) {
    throw new Error(`生成流验收失败：catalogId 必须保持为 ${catalogId}`);
  }

  const generated = applyVerificationMessages(generatedMessages);
  const selectedAction = selectActionComponent(generated.components, options);
  const actionContext = resolveContext(
    selectedAction.component.action?.event?.context,
    generated.dataModel,
  );
  if (!generated.components.has('root')) {
    throw new Error('生成流验收失败：缺少 id 为 root 的组件');
  }

  generationAdapter.registerActionHandler(
    catalogId,
    selectedAction.name,
    createExternalAgentActionHandler(options),
  );
  const actionPlan = await generationAdapter.prepareAction({
    name: selectedAction.name,
    surfaceId,
    sourceComponentId: selectedAction.component.id,
    timestamp: new Date().toISOString(),
    context: actionContext,
  });
  if (!actionPlan.ok) throw new Error(`action 验收准备失败: ${actionPlan.message}`);

  const action = await sendAgentMessages(actionPlan.run, 'verification-action');
  if (action.error) throw new Error(`action 流验收失败: ${action.error.message}`);
  if (!action.done) throw new Error('action 流验收失败：没有 SSE done');
  const actionMessages = action.messages as A2UIMessage[];
  const actionSurfaceIsStable = actionMessages.every(
    (message) => getMessageSurfaceId(message) === surfaceId,
  );
  const actionLifecycleIsPatchOnly = actionMessages.every(
    (message) => !('createSurface' in message || 'deleteSurface' in message),
  );
  if (!actionSurfaceIsStable || !actionLifecycleIsPatchOnly) {
    throw new Error('action 流验收失败：必须 patch 同一 surfaceId，不能 create 或 delete');
  }

  const actionState = applyVerificationMessages([...generatedMessages, ...actionMessages]);
  if (!actionState.components.has('root')) {
    throw new Error('action 流验收失败：root 组件丢失');
  }

  let policyRejection: ExternalAgentVerificationReport['policyRejection'] = {
    rejected: false,
  };
  if (verifyPolicyRejection) {
    const rejectionPolicy: AgentPolicy = {
      ...options.policy,
      name: 'verification-policy-rejection',
      getRequiredMedia: () => ({ Image: false, Video: false, AudioPlayer: true }),
      validateFinal: () => 'verification policy rejection probe',
    };
    const rejectionAdapter = createAdapter(options, rejectionPolicy);
    const rejectionPlan = await rejectionAdapter.prepareGeneration({ message, catalogId });
    if (!rejectionPlan.ok) throw new Error(rejectionPlan.message);
    const rejection = await sendAgentMessages(rejectionPlan.run, 'verification-policy-rejection');
    if (!rejection.error || rejection.done) {
      throw new Error('policy rejection 验收失败：预期 POLICY_REJECTED 且没有 done');
    }
    policyRejection = {
      rejected: true,
      boundaryCode: rejection.error.boundaryCode,
      message: rejection.error.message,
    };
    if (policyRejection.boundaryCode !== 'POLICY_REJECTED') {
      throw new Error(
        `policy rejection 验收失败：预期 POLICY_REJECTED，实际 ${policyRejection.boundaryCode ?? '未提供边界码'}`,
      );
    }
  }

  const checks: ExternalAgentVerificationCheck[] = [
    createCheck(
      'generation-lifecycle',
      'passed',
      `${generatedMessages.length} messages ended with SSE done`,
    ),
    createCheck('catalog-stability', 'passed', catalogId),
    createCheck('generation-root', 'passed', 'root component is present'),
    createCheck(
      'action-same-surface',
      'passed',
      `${actionMessages.length} patch messages used ${surfaceId}`,
    ),
    createCheck('action-root-stability', 'passed', 'root component remains present'),
    createCheck(
      'policy-rejection',
      verifyPolicyRejection ? 'passed' : 'skipped',
      verifyPolicyRejection
        ? 'POLICY_REJECTED boundary was returned'
        : 'policy rejection probe was skipped',
    ),
  ];
  if (checks.length !== AGENT_ONBOARDING_CHECKS.length) {
    throw new Error('Agent onboarding verification checks are incomplete');
  }

  return {
    endpoint: options.endpoint,
    catalogId,
    surfaceId,
    message,
    generationMessages: generation.messages.length,
    actionName: selectedAction.name,
    actionComponentId: selectedAction.component.id,
    actionContext,
    actionMessages: action.messages.length,
    componentIdsAfterGeneration: [...generated.components.keys()],
    componentIdsAfterAction: [...actionState.components.keys()],
    policyRejection,
    checks,
  };
}
