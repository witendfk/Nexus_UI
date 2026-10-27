import { randomUUID } from 'node:crypto';
import type {
  CatalogDefinition,
  CatalogRegistry,
  NexusActionInput,
  NexusSurfaceCommit,
} from '@nexus-ui/core';
import { CatalogRegistry as FixedCatalogRegistry } from '@nexus-ui/core';
import type { AgentSequenceOptions } from './agent-guard';
import type { AgentPolicy } from './policy';
import { reportRunDiagnostic, type NexusRunDiagnostic } from './run-diagnostic';
export type { NexusRunDiagnostic } from './run-diagnostic';
import type { AgentTurn } from './agent-turn';
import { InMemorySurfaceHistoryStore, findSurfaceCatalog } from './history';
import type { SurfaceHistoryStore } from './history';
import { isOfficialBasicCatalog } from './catalog-identity';
import { InMemoryAgentRunManager, type AgentRunManager } from './run-manager';
import { createCatalogContractReference } from './catalog-contract';
import type { CatalogContractReference } from './catalog-contract';
import {
  InMemorySurfaceActionLedger,
  InMemorySurfaceActionStateStore,
  findSurfaceAction,
} from './surface-action-state';
import type {
  ResolvedSurfaceAction,
  SurfaceActionLedger,
  SurfaceActionStateStore,
  SurfaceLedgerBegin,
} from './surface-action-state';
import {
  admitAction,
  createEditablePathWhitelist,
  rejectUndeclaredClientContext,
  validateActionParams,
  type ActionAdmissionCode,
} from './action-admission';
import { validateAgentCandidateSequence } from '../runtime/stream-inspect';
import {
  enqueueScheduledRun,
  type EnqueueOutcome,
  type PreparedRun,
  type ScheduledRunPrepareContext,
} from '../runtime/agent-runtime';
import type { SurfaceScheduler } from '../runtime/surface-scheduler';
import { schedulerForOwner } from '../runtime/scheduler-owner';
import { RunTaskError, type RuntimeRunHandle } from '../runtime/run-handle';
import { commitSurface } from '../runtime/commit-result';
export interface AgentAction {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  timestamp: string;
  /** 一次用户提交的客户端标识；与 nexus.actionId 一致，作 ledger 重放键。 */
  actionId: string;
  context: Record<string, unknown>;
  /**
   * nexus 元数据必填：HTTP 从客户端 envelope 透传，非 HTTP 消费方也必须
   * 使用其实际消费运行的固定提交结果，不能用当前快照为旧视图刷新资格。
   */
  sessionVersion: number;
  surfaceRevision: number;
  catalogHash: string;
  inputs?: readonly NexusActionInput[];
}

export interface AgentGenerateRequest {
  message?: string;
  catalogId?: string;
}

export interface AgentPrepareOptions {
  signal?: AbortSignal;
  /**
   * 传输适配传入的可信上下文（HTTP 为 Koa Context，非 HTTP 为宿主自定义值）；
   * 仅透传给宿主 access 钩子，运行模块不解释其内容（SPEC §6.5）。
   */
  context?: unknown;
}

/** 宿主访问钩子的返回；只有显式 `true` 放行，其余值一律拒绝（缺省拒绝原则）。 */
export type AgentAccessDecision = boolean | Promise<boolean>;

export type AgentAccessReadHook = (surfaceId: string, context?: unknown) => AgentAccessDecision;
export type AgentAccessGenerateHook = (
  request: Readonly<AgentGenerateRequest>,
  context?: unknown,
) => AgentAccessDecision;
export type AgentAccessActionHook = (
  request: Readonly<AgentAction>,
  context?: unknown,
) => AgentAccessDecision;

/**
 * 宿主访问准入钩子（SPEC §6.5，DESIGN D9）：read/generate/action 缺省一律
 * 拒绝；拒绝发生在入队前，不启动 source/resolver/handler、不创建运行记录。
 * request 是隔离且递归冻结的 JSON 请求快照，不是可修改的参数解析入口。
 * 可信身份由宿主闭包从自己的上下文提取，surfaceId/catalogHash/context 都不是凭据。
 */
export interface AgentAccessHooks {
  read?: AgentAccessReadHook;
  generate?: AgentAccessGenerateHook;
  action?: AgentAccessActionHook;
}

/** 入队前访问准入的拒绝码；HTTP 路由映射为 403（SPEC §5.4 状态码表）。 */
export type AgentAccessRejectionCode =
  | 'GENERATE_ACCESS_NOT_CONFIGURED'
  | 'GENERATE_ACCESS_DENIED'
  | 'ACTION_ACCESS_NOT_CONFIGURED'
  | 'ACTION_ACCESS_DENIED';

/** access 钩子评估：未配置与拒绝分别报告，由调用方映射为不同错误码。 */
async function evaluateAccessHook<T>(
  hook: ((request: T, context?: unknown) => AgentAccessDecision) | undefined,
  request: T,
  context: unknown,
): Promise<{ configured: boolean; allowed: boolean }> {
  if (!hook) return { configured: false, allowed: false };
  // 鉴权与执行基于同一入口快照；不给钩子持有任务引用或改写判定对象的能力。
  const snapshot = structuredClone(request);
  freezeAccessRequest(snapshot);
  // 钩子是宿主可信代码：抛错按装配/编程错误向上传播，不静默改为拒绝。
  return { configured: true, allowed: (await hook(snapshot, context)) === true };
}

/** JSON 请求可包含嵌套数组/对象；循环防护避免非法非 HTTP 输入使冻结递归失控。 */
function freezeAccessRequest(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const child of Object.values(value)) freezeAccessRequest(child, seen);
  Object.freeze(value);
}

export type AgentMessageSource = AsyncIterable<unknown> | Iterable<unknown>;

export type AgentActionHandler = (
  action: AgentAction,
  context: AgentActionContext,
) => AgentMessageSource | Promise<AgentMessageSource>;

export interface AgentRun {
  /**
   * 运行创建方分配的不可变运行标识（S2.5.1）：非 HTTP commit、SSE 事件前缀、
   * 成功 done 与后续按 run 查询共用同值；发送层只透传，不再生成或改写。
   * 与 actionId（客户端一次提交的标识、ledger 重放键）语义不同，不得互相替代。
   */
  readonly runId: string;
  source: AgentMessageSource;
  sequence: AgentSequenceOptions;
  /**
   * 提交边界必须返回固定的 `NexusSurfaceCommit`（S2.5.1 起不再接受 void）：
   * 没有可确认提交结果的运行不能伪造成功 done，只能以流错误终态收场。
   */
  commit(messages: unknown[]): NexusSurfaceCommit | Promise<NexusSurfaceCommit>;
  /** Called when the SSE stream fails after the run was dispatched; use to close side-effect state. */
  onError?(error?: unknown): void;
  /** Called by sendAgentRun in finally; use to release per-surface locks. */
  dispose?: () => void;
}

/**
 * S3.2 起 prepare* 返回调度句柄：入队成功即建立 queued 记录；运行内
 * 准入/校验失败是句柄终态而非 plan 拒绝。`ok:false` 仅限入队前错误
 * （请求级校验、装配检查、排队/记录容量），不再是运行内准入结论。
 */
export type AgentPlan =
  | { ok: true; run: RuntimeRunHandle }
  | {
      ok: false;
      message: string;
      code?: ActionAdmissionCode | 'capacity-limit' | AgentAccessRejectionCode;
    };

export interface AgentGenerationSourceRequest {
  kind: 'generate';
  surfaceId: string;
  message: string;
  catalogId: string;
  catalog: CatalogDefinition;
  supportedComponents: readonly string[];
  supportedActions: readonly string[];
  history: readonly AgentTurn[];
  catalogContract: CatalogContractReference;
  signal?: AbortSignal;
}

export type AgentGenerationSource = (request: AgentGenerationSourceRequest) => AgentMessageSource;

export interface AgentGenerationCommitEvent {
  surfaceId: string;
  catalogId: string;
  messages: readonly unknown[];
}

/** Host-injected model/LLM streaming seam; the SDK never constructs one itself. */
export interface AgentLlmStreamRequest {
  kind: 'generate' | 'action';
  surfaceId: string;
  message: string;
  catalogId: string;
  supportedComponents: readonly string[];
  supportedActions: readonly string[];
  history: readonly AgentTurn[];
  signal?: AbortSignal;
}

export type AgentLlmStreamSource = (request: AgentLlmStreamRequest) => AgentMessageSource;

export interface AgentActionContext {
  catalogId: string;
  catalog: CatalogDefinition;
  supportedActions: readonly string[];
  catalogContract: CatalogContractReference;
  history: readonly AgentTurn[];
  surfaceAction: ResolvedSurfaceAction;
  clientContext: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface AgentActionContextResolution {
  action: AgentAction;
  surfaceAction: ResolvedSurfaceAction;
  clientContext: Record<string, unknown>;
  /** 共享准入从临时输入模型重算的参数；resolver 输出仍须通过声明与 paramSchema。 */
  params: Record<string, unknown>;
  /** 整批输入应用后的临时模型（未提交）；resolver 可读取但不得绕过共享准入。 */
  tempDataModel: unknown;
}

export type AgentActionContextResolver = (
  resolution: AgentActionContextResolution,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

export interface AgentAdapterOptions {
  /** Required host-owned catalog boundary; the SDK registers no default catalog. */
  registry: CatalogRegistry;
  actionHandlers?: Map<string, AgentActionHandler>;
  /** Optional host-injected store; each adapter creates its own isolated in-memory store by default. */
  historyStore?: SurfaceHistoryStore;
  /** Transport-neutral records owner, isolated per adapter by default. */
  runManager?: AgentRunManager;
  /** Defaults to always false; enabling it requires an explicit streamLlm seam. */
  useLlm?: () => boolean;
  /** Host-provided model stream; required when useLlm returns true. */
  streamLlm?: AgentLlmStreamSource;
  createGenerationSource?: AgentGenerationSource;
  fallbackGeneration?: AgentGenerationSource;
  createSurfaceId?: () => string;
  /** Host policy; without one the SDK applies no business rules. */
  policy?: AgentPolicy;
  actionStateStore?: SurfaceActionStateStore;
  actionLedger?: SurfaceActionLedger;
  resolveActionContext?: AgentActionContextResolver;
  /**
   * 宿主按 surface 提供的精确可编辑 JSON Pointer 白名单（可信装配；缺省即
   * 全部拒绝）。规范化后重复属配置错误，准入时显式抛出。返回规范化前的
   * 原始指针数组即可，装配器内部归一化。
   */
  editablePaths?: (surfaceId: string) => readonly string[];
  defaultGenerationMessage?: string;
  /**
   * 宿主访问准入钩子（SPEC §6.5）：generate/action 在入队前强制评估，未配置
   * 即拒绝；read 由查询路由评估。缺省（未配置）无任何放行路径。
   */
  access?: AgentAccessHooks;
  onGenerationCommitted?: (event: AgentGenerationCommitEvent) => void | Promise<void>;
  /**
   * 宿主观测回调（S3.3.2，ARCHITECTURE §8）：发布点之后的扩展面失败
   * （generation hook/history、recordCommit、ledger complete）经此报告；
   * 运行终态与已发布 UI 事实不因这些失败改写。缺省即静默（诊断面缺席）。
   */
  onRunDiagnostic?: (diagnostic: NexusRunDiagnostic) => void;
  /**
   * @internal 每 runtime 一份的调度器（S3.2）。runtime 工厂注入其调度器；
   * 默认每 adapter 隔离；显式共用 runManager 的入口复用同一调度器。
   */
  scheduler?: SurfaceScheduler;
}

function createActionHandlerKey(catalogId: string, actionName: string): string {
  return `${catalogId}:${actionName}`;
}

function findActionDeclaration(catalog: CatalogDefinition, actionName: string) {
  return catalog.actions.find((action) => action.name === actionName);
}

/**
 * Transport-neutral seam for generation sources and business action handlers.
 * Koa stays responsible for HTTP envelopes; this class owns agent dispatch.
 * Every dependency is explicit: no demo catalog, model SDK, business policy, or
 * shared history singleton is selected implicitly.
 *
 * S3.2: prepareGeneration/prepareAction are enqueue shells over the shared
 * per-surface scheduler. Snapshot read, admission, resolver, handler
 * invocation and commit all happen inside the scheduled task (SPEC §6.2);
 * there is no second surface lock and no module-global run queue.
 */
export class AgentAdapter {
  private readonly registry: CatalogRegistry;
  private readonly catalogs = new Map<string, CatalogDefinition>();
  readonly runManager: AgentRunManager;
  private readonly actionHandlers: Map<string, AgentActionHandler>;
  private readonly historyStore: SurfaceHistoryStore;
  private readonly useLlm: () => boolean;
  private readonly streamLlm?: AgentLlmStreamSource;
  private readonly createGenerationSource?: AgentGenerationSource;
  private readonly fallbackGeneration?: AgentGenerationSource;
  private readonly createSurfaceId: () => string;
  private readonly policy?: AgentPolicy;
  private readonly actionStateStore: SurfaceActionStateStore;
  private readonly actionLedger: SurfaceActionLedger;
  private readonly resolveActionContext?: AgentActionContextResolver;
  private readonly editablePaths?: (surfaceId: string) => readonly string[];
  private readonly defaultGenerationMessage: string;
  private readonly accessHooks?: AgentAccessHooks;
  private readonly onGenerationCommitted?: (
    event: AgentGenerationCommitEvent,
  ) => void | Promise<void>;
  private readonly onRunDiagnostic?: (diagnostic: NexusRunDiagnostic) => void;
  private readonly scheduler: SurfaceScheduler;

  constructor(options: AgentAdapterOptions) {
    if (!options.registry) {
      throw new Error(
        'AgentAdapter 需要宿主显式注入 registry（CatalogRegistry）；SDK 不再内置示例 Catalog',
      );
    }
    this.registry = options.registry;
    this.runManager = options.runManager ?? new InMemoryAgentRunManager();
    this.policy = options.policy;
    this.actionHandlers = options.actionHandlers ?? new Map();
    // Per-instance store on purpose: two adapters must never share surface history.
    this.historyStore = options.historyStore ?? new InMemorySurfaceHistoryStore();
    this.actionStateStore = options.actionStateStore ?? new InMemorySurfaceActionStateStore();
    this.actionLedger = options.actionLedger ?? new InMemorySurfaceActionLedger();
    this.resolveActionContext = options.resolveActionContext;
    this.editablePaths = options.editablePaths;
    this.useLlm = options.useLlm ?? (() => false);
    this.streamLlm = options.streamLlm;
    this.createGenerationSource = options.createGenerationSource;
    this.fallbackGeneration = options.fallbackGeneration;
    this.createSurfaceId = options.createSurfaceId ?? (() => `surface-${randomUUID()}`);
    this.defaultGenerationMessage = options.defaultGenerationMessage ?? '';
    this.accessHooks = options.access;
    this.onGenerationCommitted = options.onGenerationCommitted;
    this.onRunDiagnostic = options.onRunDiagnostic;
    this.scheduler = schedulerForOwner(this.runManager, options.scheduler);
  }

  /** The per-adapter (or injected runtime) scheduler; single dispatch owner. */
  get dispatchScheduler(): SurfaceScheduler {
    return this.scheduler;
  }

  /** 宿主访问准入钩子；查询路由以其 read 钩子为缺省准入（未配置即 403）。 */
  get access(): AgentAccessHooks | undefined {
    return this.accessHooks;
  }

  /** Capture the actual execution definition on first use; later host mutations cannot change it. */
  describeCatalog(catalogId: string): CatalogDefinition | undefined {
    let catalog = this.catalogs.get(catalogId);
    if (!catalog) {
      const registered = this.registry.get(catalogId);
      if (!registered) return undefined;
      catalog = structuredClone(registered);
      new FixedCatalogRegistry([catalog]);
      this.catalogs.set(catalogId, catalog);
    }
    return structuredClone(catalog);
  }

  /**
   * 服务端诊断/确定性夹具读取当前快照摘要。
   * 不是客户端提交基准来源；客户端必须保留实际消费运行返回的固定 commit。
   */
  async describeSurfaceContract(
    surfaceId: string,
  ): Promise<{ surfaceRevision: number; catalogHash: string } | undefined> {
    const snapshot = await this.actionStateStore.get(surfaceId);
    if (!snapshot) return undefined;
    return {
      surfaceRevision: snapshot.version,
      catalogHash: snapshot.contract.catalogHash,
    };
  }

  registerActionHandler(catalogId: string, actionName: string, handler: AgentActionHandler): void {
    const key = createActionHandlerKey(catalogId, actionName);
    if (this.actionHandlers.has(key)) {
      throw new Error(`Action handler 已注册: ${key}`);
    }
    this.actionHandlers.set(key, handler);
  }

  async prepareGeneration(
    request: AgentGenerateRequest,
    options: AgentPrepareOptions = {},
  ): Promise<AgentPlan> {
    return this.toPlan(await this.enqueueGeneration(request, options));
  }

  /** @internal Runtime entry: enqueue one generation run, capacity/record rejections included. */
  async enqueueGeneration(
    request: AgentGenerateRequest,
    options: AgentPrepareOptions = {},
  ): Promise<EnqueueOutcome> {
    if (typeof request.catalogId !== 'string' || request.catalogId === '') {
      return {
        accepted: false,
        stage: 'request',
        message: '生成请求必须显式提供 catalogId；SDK 不回落任何默认 Catalog',
      };
    }
    // 请求原语在任何 await 之前捕获：调用方在入队等待期修改引用不能改写本次
    // 请求的 Catalog 与消息（入队入口隔离，SPEC §6.1）。
    const catalogId = request.catalogId;
    const accessRequest = { catalogId, message: request.message };
    const message =
      typeof accessRequest.message === 'string' && accessRequest.message.trim()
        ? accessRequest.message
        : this.defaultGenerationMessage;
    // 访问准入先于 Catalog 解析：未授权调用方不能借 catalogId 探测注册状态。
    const access = await evaluateAccessHook(
      this.accessHooks?.generate,
      accessRequest,
      options.context,
    );
    if (!access.allowed) {
      return {
        accepted: false,
        stage: 'request',
        code: access.configured ? 'GENERATE_ACCESS_DENIED' : 'GENERATE_ACCESS_NOT_CONFIGURED',
        message: access.configured
          ? '生成请求被宿主 access.generate 准入策略拒绝'
          : '宿主未配置 access.generate 准入回调；SDK 缺省拒绝生成请求',
      };
    }
    if (isOfficialBasicCatalog(catalogId)) {
      return {
        accepted: false,
        stage: 'request',
        message:
          'Nexus 不注册官方 Basic Catalog；请使用 Nexus Basic Task Profile 或宿主自定义 catalog',
      };
    }
    const catalog = this.describeCatalog(catalogId);
    if (!catalog) {
      return { accepted: false, stage: 'request', message: `Agent catalog 未注册: ${catalogId}` };
    }
    const useLlm = this.useLlm();
    if (useLlm && !this.createGenerationSource && !this.streamLlm) {
      throw new Error('useLlm 启用时必须显式注入 streamLlm 生成源；SDK 不再默认绑定模型 SDK');
    }
    if (!this.createGenerationSource && !useLlm && !this.fallbackGeneration) {
      return {
        accepted: false,
        stage: 'request',
        message:
          'Generation source 未配置；宿主需注入 createGenerationSource、fallbackGeneration 或启用 LLM',
      };
    }
    const surfaceId = this.createSurfaceId();
    const runId = randomUUID();
    const outcome = enqueueScheduledRun(
      { runManager: this.runManager, scheduler: this.scheduler },
      {
        kind: 'generate',
        runId,
        surfaceId,
        prepare: async ({ signal, bindBaseline }) =>
          this.prepareGenerationInTask({
            catalogId,
            catalog,
            message,
            surfaceId,
            runId,
            useLlm,
            signal,
            bindBaseline,
          }),
      },
      options,
    );
    return outcome;
  }

  /**
   * 调度内生成准备（SPEC §6.2）：history 读取与生成源构造发生在获得 surface
   * 槽位之后；commit 闭包先做完整候选校验，任何传输/直接调用路径都无法绕过。
   */
  private async prepareGenerationInTask(ctx: {
    catalogId: string;
    catalog: CatalogDefinition;
    message: string;
    surfaceId: string;
    runId: string;
    useLlm: boolean;
    signal?: AbortSignal;
    bindBaseline: ScheduledRunPrepareContext['bindBaseline'];
  }): Promise<PreparedRun> {
    const { catalogId, catalog, message, surfaceId, runId, useLlm, signal } = ctx;
    const supportedActions = catalog.actions.map((action) => action.name);
    const supportedComponents = Object.keys(catalog.components);
    const catalogContract = createCatalogContractReference(catalog);
    ctx.bindBaseline({ catalogId, catalogHash: catalogContract.hash });
    const history = (await this.historyStore.getHistory(surfaceId)).map((turn) => ({ ...turn }));
    const sourceRequest: AgentGenerationSourceRequest = {
      kind: 'generate',
      surfaceId,
      message,
      catalogId,
      catalog: structuredClone(catalog),
      supportedComponents,
      supportedActions,
      catalogContract,
      history,
      ...(signal === undefined ? {} : { signal }),
    };
    const createGenerationSource = this.createGenerationSource;
    const streamLlm = this.streamLlm;
    const fallbackGeneration = this.fallbackGeneration;
    const source: AgentMessageSource = (async function* () {
      if (createGenerationSource) yield* createGenerationSource(sourceRequest);
      else if (useLlm)
        yield* streamLlm!({
          kind: 'generate',
          surfaceId,
          message,
          catalogId,
          supportedComponents,
          supportedActions,
          history,
          ...(signal === undefined ? {} : { signal }),
        });
      else yield* fallbackGeneration!(sourceRequest);
    })();
    const shouldRecordHistory = Boolean(this.createGenerationSource) || useLlm;
    const sequence: AgentSequenceOptions = {
      kind: 'generate',
      surfaceId,
      catalogId,
      registry: new FixedCatalogRegistry([structuredClone(catalog)]),
      supportedActions,
      message,
      policy: this.policy,
    };
    return {
      identity: { catalogId, catalogHash: catalogContract.hash },
      source,
      sequence,
      onDiagnostic: (stage, diagMessage) =>
        this.reportDiagnostic(runId, surfaceId, stage, diagMessage),
      commitStep: async (messages) => {
        // S3.2：完整候选与最终校验是所有提交路径的权威闸门（含直接消费），
        // 非 HTTP generation 不再缺同等保证。
        validateAgentCandidateSequence(messages, sequence);
        const surfaceCatalog = findSurfaceCatalog(messages);
        if (!surfaceCatalog) throw new Error('生成流缺少 createSurface，不能提交 history');
        const committed = await commitSurface(
          () =>
            this.actionStateStore.commitGeneration(
              surfaceCatalog.surfaceId,
              surfaceCatalog.catalogId,
              messages,
              {
                catalogHash: catalogContract.hash,
                contractVersion: catalogContract.version,
                catalog,
              },
            ),
          {
            runId,
            surfaceId,
            catalogId,
            contract: {
              catalogHash: catalogContract.hash,
              contractVersion: catalogContract.version,
              catalog,
            },
          },
          (stage, message) => this.reportDiagnostic(runId, surfaceId, stage, message),
        );
        // 发布点之后的扩展失败（S3.3.2）：不删除快照、不改写成功事实，
        // 经诊断面报告后照常返回固定提交。
        try {
          await this.onGenerationCommitted?.({
            surfaceId: surfaceCatalog.surfaceId,
            catalogId: surfaceCatalog.catalogId,
            messages,
          });
        } catch (error) {
          this.reportDiagnostic(
            runId,
            surfaceCatalog.surfaceId,
            'generation-hook',
            error instanceof Error ? error.message : String(error),
          );
        }
        try {
          await this.historyStore.commitGeneration(
            surfaceCatalog.surfaceId,
            surfaceCatalog.catalogId,
            shouldRecordHistory
              ? [
                  { role: 'user', content: message },
                  { role: 'assistant', content: JSON.stringify(messages) },
                ]
              : [],
          );
        } catch (error) {
          this.reportDiagnostic(
            runId,
            surfaceCatalog.surfaceId,
            'history-commit',
            error instanceof Error ? error.message : String(error),
          );
        }
        return committed;
      },
    };
  }

  async prepareAction(action: AgentAction, options: AgentPrepareOptions = {}): Promise<AgentPlan> {
    return this.toPlan(await this.enqueueAction(action, options));
  }

  /** @internal Runtime entry: enqueue one action run; admission failures are run terminals. */
  async enqueueAction(
    action: AgentAction,
    options: AgentPrepareOptions = {},
  ): Promise<EnqueueOutcome> {
    // surfaceId 是调度队列与运行记录的键：入队前拒绝垃圾键，不建记录。
    if (typeof action.surfaceId !== 'string' || action.surfaceId === '') {
      return {
        accepted: false,
        stage: 'request',
        message: 'Action 请求必须提供非空 surfaceId',
      };
    }
    // Capture before enqueue: caller mutation must never redirect the task to
    // another surface or alter the inputs/context while it waits for its slot.
    // 克隆在任何 await 之前完成（入队入口隔离，SPEC §6.1）。
    const request = structuredClone(action);
    // 访问准入先于快照读取与记录建立：拒绝不泄露 surface 存在性（SPEC §6.5）；
    // 钩子收到同一入口快照的只读副本，不能受调用方修改影响或改写任务请求。
    const access = await evaluateAccessHook(this.accessHooks?.action, request, options.context);
    if (!access.allowed) {
      return {
        accepted: false,
        stage: 'request',
        code: access.configured ? 'ACTION_ACCESS_DENIED' : 'ACTION_ACCESS_NOT_CONFIGURED',
        message: access.configured
          ? 'Action 请求被宿主 access.action 准入策略拒绝'
          : '宿主未配置 access.action 准入回调；SDK 缺省拒绝 action 请求',
      };
    }
    const runId = randomUUID();
    return enqueueScheduledRun(
      { runManager: this.runManager, scheduler: this.scheduler },
      {
        kind: 'action',
        runId,
        surfaceId: request.surfaceId,
        actionId: request.actionId,
        prepare: async (ctx) => this.prepareActionInTask(request, runId, ctx),
      },
      options,
    );
  }

  /**
   * 调度内 action 准入与执行准备：快照读取 → start（实际快照基准）→ action/
   * handler 查找 → ledger → 客户端 context/白名单/整批输入准入 → resolver →
   * paramSchema → history。任何拒绝都转换为运行失败终态（RUN_ADMISSION_
   * REJECTED），handler 未调用、快照与 revision 不变；ledger 由 onAbort 统一记
   * failed。
   */
  private async prepareActionInTask(
    action: AgentAction,
    runId: string,
    ctx: ScheduledRunPrepareContext,
  ): Promise<PreparedRun> {
    const snapshot = await this.actionStateStore.get(action.surfaceId);
    if (!snapshot) {
      throw new RunTaskError(
        'RUN_ADMISSION_REJECTED',
        `Action surface 不存在或已过期: ${action.surfaceId}`,
        {
          actionId: action.actionId,
        },
      );
    }
    // 准入与 guard 解释一律使用提交边界固定的契约副本，不读当前 registry：
    // 宿主原地修改声明不能让同一 revision/hash/输入从拒绝翻转为接受
    const catalogId = snapshot.catalogId;
    const catalog = snapshot.contract.catalog;

    // SPEC §5.4 与 fixtures/session-v1 oracle：start 先于准入裁决发出，基准是
    // 本次调度内实际读取的快照——准入失败因此也是 start（带基准）→ error 序列。
    ctx.bindBaseline({ catalogId, catalogHash: snapshot.contract.catalogHash }, snapshot.version);

    const surfaceAction = findSurfaceAction(snapshot, action.name, action.sourceComponentId);
    if (!surfaceAction) {
      throw new RunTaskError(
        'RUN_ADMISSION_REJECTED',
        `Action 与服务端 surface 状态不匹配: ${action.surfaceId}/${action.sourceComponentId}/${action.name}`,
        { actionId: action.actionId },
      );
    }

    const handler = this.actionHandlers.get(createActionHandlerKey(catalogId, action.name));
    if (!handler) {
      throw new RunTaskError(
        'RUN_ADMISSION_REJECTED',
        `Action handler 未注册: ${catalogId}/${action.name}`,
        {
          actionId: action.actionId,
        },
      );
    }

    const ledgerKey = createActionLedgerKey(action);
    let ledgerBegin: SurfaceLedgerBegin;
    try {
      ledgerBegin = this.actionLedger.begin({
        key: ledgerKey,
        surfaceId: action.surfaceId,
        actionName: action.name,
        sourceComponentId: action.sourceComponentId,
      });
    } catch (error) {
      // ledger 是扩展面：入账基础设施故障不冒充准入拒绝，也不泄漏调度权
      //（终态由任务收敛；complete 失败由下方安全封装吞掉并报告）。
      throw new RunTaskError(
        'RUN_FAILED',
        `Action ledger 不可用: ${error instanceof Error ? error.message : String(error)}`,
        { actionId: action.actionId },
      );
    }
    if (!ledgerBegin.admitted) {
      if (ledgerBegin.reason === 'capacity') {
        throw new RunTaskError(
          'RESOURCE_LIMIT_EXCEEDED',
          'Action ledger 容量已满（全部记录活动中），不执行 handler',
          { actionId: action.actionId },
        );
      }
      throw new RunTaskError('RUN_ADMISSION_REJECTED', 'Action 重放或重复提交已被拒绝', {
        actionId: action.actionId,
      });
    }
    // ledger complete 的失败不改写 UI 提交事实，也不得中断任务（S3.3.3）。
    let ledgerCompleted = false;
    const completeLedger = (status: 'succeeded' | 'failed'): void => {
      if (ledgerCompleted) return;
      ledgerCompleted = true;
      try {
        this.actionLedger.complete(ledgerKey, status);
      } catch (error) {
        this.reportDiagnostic(
          runId,
          action.surfaceId,
          'ledger-complete',
          error instanceof Error ? error.message : String(error),
        );
      }
    };
    const completeLedgerFailed = (): void => {
      completeLedger('failed');
    };

    const clientContext = { ...action.context };
    const clientContextError = rejectUndeclaredClientContext(
      surfaceAction.declaration,
      clientContext,
    );
    if (clientContextError !== null) {
      completeLedgerFailed();
      throw new RunTaskError('RUN_ADMISSION_REJECTED', clientContextError, {
        actionId: action.actionId,
      });
    }

    // 共享权威准入先于一切参数解释：nexus 必填核对、action 来源能力、浏览器
    // 输入整批校验与临时模型重算。拒绝即 handler 未调用、快照与 revision 不变。
    let editable: ReadonlySet<string>;
    try {
      editable = createEditablePathWhitelist(this.editablePaths?.(action.surfaceId) ?? []);
    } catch (error) {
      completeLedgerFailed();
      // 白名单来自宿主可信装配：配置错误必须显式暴露，不得伪装成业务拒绝
      throw error;
    }
    const admission = admitAction(
      { snapshot, editablePaths: editable },
      {
        name: action.name,
        surfaceId: action.surfaceId,
        sourceComponentId: action.sourceComponentId,
        context: action.context,
        actionId: action.actionId,
        nexus: {
          sessionVersion: action.sessionVersion,
          actionId: action.actionId,
          surfaceRevision: action.surfaceRevision,
          catalogHash: action.catalogHash,
          inputs: action.inputs,
        },
      },
    );
    if (!admission.ok) {
      completeLedgerFailed();
      throw new RunTaskError('RUN_ADMISSION_REJECTED', admission.message, {
        actionId: action.actionId,
      });
    }

    let context: Record<string, unknown>;
    try {
      if (this.resolveActionContext) {
        // resolver 后置：只能在共享准入之后扩展参数，输出仍须通过未声明字段
        // 拒绝与 paramSchema，不得把被拒输入重新变为可执行 action。
        context = await this.resolveActionContext({
          action: structuredClone(action),
          surfaceAction: structuredClone(surfaceAction),
          clientContext: structuredClone(clientContext),
          params: structuredClone(admission.params),
          tempDataModel: structuredClone(admission.tempDataModel),
        });
        if (typeof context !== 'object' || context === null || Array.isArray(context)) {
          throw new Error('Action context resolver 必须返回 JSON 对象');
        }
        const resolverError = rejectUndeclaredClientContext(surfaceAction.declaration, context);
        if (resolverError !== null) throw new Error(resolverError);
      } else {
        context = structuredClone(admission.params);
      }
      // paramSchema 校验作用于最终交给 handler 的参数（默认=重算值，
      // resolver=其输出），缺省即参数必须为空对象
      const paramError = validateActionParams(context, findActionDeclaration(catalog, action.name));
      if (paramError !== null) throw new Error(paramError);
    } catch (error) {
      completeLedgerFailed();
      throw new RunTaskError(
        'RUN_ADMISSION_REJECTED',
        error instanceof Error ? error.message : 'Action context 解析失败',
        { actionId: action.actionId },
      );
    }

    let history: AgentTurn[];
    try {
      history = (await this.historyStore.getHistory(action.surfaceId)).map((turn) => ({
        ...turn,
      }));
    } catch (error) {
      completeLedgerFailed();
      throw new RunTaskError(
        'RUN_FAILED',
        `Action 历史读取失败: ${error instanceof Error ? error.message : 'history store unavailable'}`,
        { actionId: action.actionId },
      );
    }

    const authoritativeAction: AgentAction = { ...action, context };
    const sequence: AgentSequenceOptions = {
      kind: 'action',
      surfaceId: action.surfaceId,
      catalogId,
      registry: new FixedCatalogRegistry([structuredClone(catalog)]),
      supportedActions: catalog.actions.map((entry) => entry.name),
      policy: this.policy,
      initialState: {
        components: [...snapshot.components.values()],
        dataModel: structuredClone(admission.tempDataModel),
      },
    };

    // Invoke the host handler only after the surface slot is acquired (in-task).
    const source: AgentMessageSource = (async function* () {
      if (admission.inputWrites.length > 0) {
        yield {
          version: 'v0.9',
          updateDataModel: {
            surfaceId: action.surfaceId,
            value: structuredClone(admission.tempDataModel),
          },
        };
      }
      yield* await handler(authoritativeAction, {
        catalogId,
        catalog: structuredClone(catalog),
        supportedActions: catalog.actions.map((entry) => entry.name),
        catalogContract: createCatalogContractReference(catalog),
        history,
        surfaceAction: structuredClone(surfaceAction),
        clientContext: structuredClone(clientContext),
        ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
      });
    })();

    let committed = false;
    return {
      identity: { catalogId, catalogHash: snapshot.contract.catalogHash },
      surfaceRevision: snapshot.version,
      actionId: action.actionId,
      source,
      sequence,
      onAbort: completeLedgerFailed,
      onDiagnostic: (stage, diagMessage) =>
        this.reportDiagnostic(runId, action.surfaceId, stage, diagMessage),
      commitStep: async (messages) => {
        if (committed) throw new Error('Action run 已终止，不能再次提交');
        committed = true;
        const candidates = structuredClone(messages);
        // 与生成路径共用同一份权威闸门（S3.2 评审 P2-4），避免双份实现漂移。
        validateAgentCandidateSequence(candidates, sequence);
        let result: NexusSurfaceCommit;
        try {
          result = await commitSurface(
            () =>
              this.actionStateStore.commitAction(candidates, {
                surfaceId: action.surfaceId,
                expectedEpoch: snapshot.epoch,
                expectedRevision: snapshot.version,
                inputWrites: admission.inputWrites,
              }),
            {
              runId,
              surfaceId: action.surfaceId,
              catalogId,
              contract: snapshot.contract,
              baseline: snapshot,
            },
            (stage, message) => this.reportDiagnostic(runId, action.surfaceId, stage, message),
          );
        } catch (error) {
          completeLedger('failed');
          throw error;
        }
        completeLedger('succeeded');
        return result;
      },
    };
  }

  /** 同步、吞异常的诊断面：观测回调自身的失败绝不影响运行终态。 */
  private reportDiagnostic(
    runId: string,
    surfaceId: string,
    stage: NexusRunDiagnostic['stage'],
    message: string,
  ): void {
    reportRunDiagnostic(this.onRunDiagnostic, { runId, surfaceId, stage, message });
  }

  private toPlan(outcome: EnqueueOutcome): AgentPlan {
    if (outcome.accepted) return { ok: true, run: outcome.run };
    if (outcome.stage === 'capacity') {
      return { ok: false, message: outcome.message, code: 'capacity-limit' };
    }
    // request 阶段的 code 只会是访问准入拒绝码（RUN_CAPACITY_REJECTED 仅随
    // capacity 阶段出现）。
    return {
      ok: false,
      message: outcome.message,
      ...(outcome.code ? { code: outcome.code as AgentAccessRejectionCode } : {}),
    };
  }
}

function createActionLedgerKey(action: AgentAction): string {
  if (action.actionId) {
    return [`id:${action.actionId}`, action.surfaceId, action.sourceComponentId, action.name].join(
      '\u0000',
    );
  }
  return [
    action.surfaceId,
    action.sourceComponentId,
    action.name,
    action.timestamp,
    stableStringify(action.context),
  ].join('\u0000');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value !== 'object' || value === null) return JSON.stringify(value) ?? 'null';
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
    )
    .join(',')}}`;
}
