import type Koa from 'koa';
import { randomUUID } from 'node:crypto';
import { PassThrough, Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import type {
  A2UIErrorCode,
  A2UIMessage,
  CatalogDefinition,
  Component,
  NexusActionInput,
  NexusSurfaceCommit,
} from '@nexus-ui/core';
import {
  NEXUS_SESSION_VERSION,
  CatalogRegistry,
  applyDataModelUpdate,
  parseSurfaceCommit,
  resolveContext,
} from '@nexus-ui/core';
import type { AgentPolicy } from './policy';
import { AgentAdapter } from './adapter';
import { InMemorySurfaceHistoryStore } from './history';
import {
  createExternalAgentActionHandler,
  createExternalAgentGenerationSource,
  type ExternalAgentRpcConfig,
} from './external-agent';
import { sendAgentRun } from '../api/send-messages';
import type { RuntimeRunHandle } from '../runtime/run-handle';
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
  /**
   * 可信宿主夹具：按 surface 提供精确可编辑 JSON Pointer 白名单（缺省为空＝
   * 全部拒绝）。SDK 不按组件名猜输入；待编辑值只来自 actionInputs。
   */
  editablePaths?: (surfaceId: string) => readonly string[];
  /** 可信宿主夹具：随 action 提交的待编辑输入值（componentId/property/value）。 */
  actionInputs?: (component: Component) => readonly NexusActionInput[];
  /** Set false to skip the independent host-policy rejection probe. */
  verifyPolicyRejection?: boolean;
}

export interface ExternalAgentVerificationReport {
  endpoint: string;
  catalogId: string;
  surfaceId: string;
  message: string;
  generationMessages: number;
  /** 本次生成流成功 done 携带的固定提交结果（S2.5.6 起 verifier 的唯一基准来源）。 */
  generationCommit: NexusSurfaceCommit;
  actionName: string;
  actionComponentId: string;
  /** inputs 经权威准入及参数重算后，实际交给 RPC handler 的 context 隔离副本。 */
  actionContext: Record<string, unknown>;
  actionMessages: number;
  /** action 运行的固定提交结果；action 阶段因展示型 Catalog 跳过时为 null。 */
  actionCommit: NexusSurfaceCommit | null;
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
  /** 成功 done 携带的固定提交结果（原样 JSON，经 assertRunCommitPayload 校验后使用）。 */
  commit?: unknown;
  /** 全部 SSE 事件 id（含 done），用于与本次 runId 的传输关联核对。 */
  eventIds: string[];
  error?: {
    /** Session 错误码（SPEC §5.4 枚举；S2 过渡期恒为 AGENT_STREAM_ERROR 的形状已迁移）。 */
    code?: string;
    /** 兼容视图：首个结构化诊断条目的 code（边界分类归入 diagnostics）。 */
    boundaryCode?: A2UIErrorCode;
    commitState?: string;
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
  if (Object.keys(catalog.components).length === 0) {
    throw new Error('Verification catalog has no components');
  }
}

function createSseContext(): {
  ctx: Koa.Context;
  getOutput: () => string;
  waitForOutput: () => Promise<void>;
  dispose: () => void;
} {
  let output = '';
  let body: unknown;
  const decoder = new StringDecoder('utf8');
  // 消费实际响应目的流；只监听 body.data 会被未读取的 res 背压暂停。
  const response = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      output += decoder.write(chunk);
      callback();
    },
    final(callback) {
      output += decoder.end();
      callback();
    },
  });
  const ctx = {
    status: 200,
    set: () => undefined,
    res: response,
    get body() {
      return body;
    },
    set body(value: unknown) {
      body = value;
    },
  } as unknown as Koa.Context;
  return {
    ctx,
    getOutput: () => output,
    waitForOutput: () => finished(response, { cleanup: true }),
    dispose: () => {
      if (body instanceof PassThrough) {
        body.unpipe(response);
        body.destroy();
      }
      response.destroy();
    },
  };
}

function parseSseRun(output: string): SseRun {
  const run: SseRun = { messages: [], done: false, eventIds: [] };
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
      if (field === 'id' && value !== '') run.eventIds.push(value);
      if (field === 'data') data.push(value);
    }
    if (data.length === 0) continue;

    if (eventName === 'done') {
      run.done = true;
      // 成功 done 直接承载固定提交结果；verifier 消费它并与本次运行关联。
      run.commit = JSON.parse(data.join('\n')) as unknown;
    } else if (eventName === 'error') {
      // S3.4 锁定形状（SPEC §5.4）：身份/code/commitState 在顶层，边界分类
      // （POLICY_REJECTED 等）在结构化 diagnostics 条目中。
      const payload = JSON.parse(data.join('\n')) as {
        code?: string;
        commitState?: string;
        message?: string;
        diagnostics?: readonly { code?: unknown }[];
      };
      const diagnosticCode = payload.diagnostics?.find(
        (diagnostic) =>
          typeof diagnostic === 'object' &&
          diagnostic !== null &&
          typeof diagnostic.code === 'string',
      )?.code;
      run.error = {
        code: payload.code,
        commitState: payload.commitState,
        boundaryCode:
          typeof diagnosticCode === 'string' ? (diagnosticCode as A2UIErrorCode) : undefined,
        message: payload.message ?? 'Agent stream failed',
      };
    } else if (eventName === 'message') {
      run.messages.push(JSON.parse(data.join('\n')) as unknown);
    }
  }

  return run;
}

async function sendAgentMessages(run: AgentRun | RuntimeRunHandle): Promise<SseRun> {
  const { ctx, getOutput, waitForOutput, dispose } = createSseContext();
  try {
    // 运行标识只来自 run.runId：SSE event id、响应头与成功 done 同值（S2.5.1/.4）。
    const result = await sendAgentRun(ctx, run, {});
    // sender 完成写入不等于目的流已收完全部字节，解析须等到响应 finish。
    await waitForOutput();
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
  } finally {
    dispose();
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
    // 可编辑白名单是可信宿主夹具配置；缺省为空＝拒绝一切输入写回。
    ...(options.editablePaths === undefined ? {} : { editablePaths: options.editablePaths }),
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
 * 成功 done 的固定结果必须可解析且与本次运行身份一致（S2.5.6）。
 * 不可对账即失败：不虚构通过，也不借 describeSurfaceContract 最新值补基准。
 */
function assertRunCommitPayload(
  raw: unknown,
  label: string,
  expected: { runId: string; surfaceId: string; catalogId: string },
): NexusSurfaceCommit {
  const commit = parseSurfaceCommit(raw);
  if (!commit) {
    throw new Error(`${label}验收失败：done 没有携带可确认的 NexusSurfaceCommit 固定结果`);
  }
  if (
    commit.runId !== expected.runId ||
    commit.surfaceId !== expected.surfaceId ||
    commit.catalogId !== expected.catalogId
  ) {
    throw new Error(`${label}验收失败：done 固定结果与本次运行不一致（runId/surfaceId/catalogId）`);
  }
  return commit;
}

/** SSE event id 与响应头一样以本次 runId 为前缀（SPEC §5.3 的传输关联口径）。 */
function assertTransportCorrelation(run: SseRun, runId: string, label: string): void {
  if (!run.eventIds.every((id) => id.startsWith(`${runId}:`))) {
    throw new Error(`${label}验收失败：SSE event id 未与本次 runId 关联`);
  }
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
  const generation = await sendAgentMessages(generationPlan.run);
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

  // 传输关联与固定结果核对（S2.5.6）：event id 前缀、done.runId/surfaceId/catalogId
  // 都必须与本次运行一致；不可对账按失败处理，不虚报通过。
  assertTransportCorrelation(generation, generationPlan.run.runId, '生成流');
  const generationCommit = assertRunCommitPayload(generation.commit, '生成流', {
    runId: generationPlan.run.runId,
    surfaceId,
    catalogId,
  });

  const generated = applyVerificationMessages(generatedMessages);
  if (!generated.components.has('root')) {
    throw new Error('生成流验收失败：缺少 id 为 root 的组件');
  }

  // 展示型 Catalog（actions 显式为空）没有可执行的 action：适用检查按 skipped
  // 记录并给出原因；声明了 action 的 Catalog 仍必须提供可验收的 action 组件。
  const catalogDeclaresActions = options.catalog.actions.length > 0;
  let selectedAction: { component: Component; name: string } | null = null;
  let actionContext: Record<string, unknown> = {};
  let actionMessages: A2UIMessage[] = [];
  let actionCommit: NexusSurfaceCommit | null = null;
  let componentIdsAfterAction = [...generated.components.keys()];

  if (catalogDeclaresActions) {
    selectedAction = selectActionComponent(generated.components, options);
    const clientContext = resolveContext(
      selectedAction.component.action?.event?.context,
      generated.dataModel,
    );

    const externalHandler = createExternalAgentActionHandler(options);
    generationAdapter.registerActionHandler(catalogId, selectedAction.name, (action, context) => {
      // 观察真实准入结果，不在 verifier 另写一套 inputs/参数解释逻辑。
      actionContext = structuredClone(action.context);
      return externalHandler(action, context);
    });
    // 待编辑值来自可信宿主夹具（缺省空批）；基准只取本次 done 固定结果，
    // 不读 describeSurfaceContract 的最新快照。
    const inputs = options.actionInputs?.(selectedAction.component) ?? [];
    const actionPlan = await generationAdapter.prepareAction({
      name: selectedAction.name,
      surfaceId,
      sourceComponentId: selectedAction.component.id,
      timestamp: new Date().toISOString(),
      context: clientContext,
      actionId: `verification-${randomUUID()}`,
      sessionVersion: NEXUS_SESSION_VERSION,
      surfaceRevision: generationCommit.surfaceRevision,
      catalogHash: generationCommit.catalogHash,
      inputs,
    });
    if (!actionPlan.ok) throw new Error(`action 验收准备失败: ${actionPlan.message}`);

    const action = await sendAgentMessages(actionPlan.run);
    if (action.error) throw new Error(`action 流验收失败: ${action.error.message}`);
    if (!action.done) throw new Error('action 流验收失败：没有 SSE done');
    actionMessages = action.messages as A2UIMessage[];
    const actionSurfaceIsStable = actionMessages.every(
      (message) => getMessageSurfaceId(message) === surfaceId,
    );
    const actionLifecycleIsPatchOnly = actionMessages.every(
      (message) => !('createSurface' in message || 'deleteSurface' in message),
    );
    if (!actionSurfaceIsStable || !actionLifecycleIsPatchOnly) {
      throw new Error('action 流验收失败：必须 patch 同一 surfaceId，不能 create 或 delete');
    }
    assertTransportCorrelation(action, actionPlan.run.runId, 'action 流');
    actionCommit = assertRunCommitPayload(action.commit, 'action 流', {
      runId: actionPlan.run.runId,
      surfaceId,
      catalogId,
    });

    const actionState = applyVerificationMessages([...generatedMessages, ...actionMessages]);
    if (!actionState.components.has('root')) {
      throw new Error('action 流验收失败：root 组件丢失');
    }
    componentIdsAfterAction = [...actionState.components.keys()];
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
    const rejection = await sendAgentMessages(rejectionPlan.run);
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
    catalogDeclaresActions
      ? createCheck(
          'action-same-surface',
          'passed',
          `${actionMessages.length} patch messages used ${surfaceId}`,
        )
      : createCheck(
          'action-same-surface',
          'skipped',
          'catalog declares no actions; action flow not applicable',
        ),
    catalogDeclaresActions
      ? createCheck('action-root-stability', 'passed', 'root component remains present')
      : createCheck(
          'action-root-stability',
          'skipped',
          'catalog declares no actions; action flow not applicable',
        ),
    createCheck(
      'policy-rejection',
      verifyPolicyRejection ? 'passed' : 'skipped',
      verifyPolicyRejection
        ? 'POLICY_REJECTED boundary was returned'
        : 'policy rejection probe was skipped',
    ),
  ];
  // 检查项与 onboarding 声明一致：数量与 id/顺序都必须对齐。
  if (
    checks.length !== AGENT_ONBOARDING_CHECKS.length ||
    !checks.every((check, index) => check.id === AGENT_ONBOARDING_CHECKS[index].id)
  ) {
    throw new Error('Agent onboarding verification checks are incomplete');
  }

  return {
    endpoint: options.endpoint,
    catalogId,
    surfaceId,
    message,
    generationMessages: generation.messages.length,
    generationCommit,
    actionName: selectedAction?.name ?? '',
    actionComponentId: selectedAction?.component.id ?? '',
    actionContext,
    actionMessages: actionMessages.length,
    actionCommit,
    componentIdsAfterGeneration: [...generated.components.keys()],
    componentIdsAfterAction,
    policyRejection,
    checks,
  };
}
