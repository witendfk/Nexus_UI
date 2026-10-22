import { randomUUID } from 'node:crypto';
import type {
  CatalogDefinition,
  CatalogRegistry,
  NexusActionInput,
  NexusSurfaceCommit,
} from '@nexus-ui/core';
import {
  createAgentStreamState,
  validateAgentStreamMessageDetailed,
  validateAgentStreamFinalDetailed,
  type AgentSequenceOptions,
} from './agent-guard';
import {
  CatalogRegistry as FixedCatalogRegistry,
  validateProtocolMessage,
  validateNexusProfileMessage,
} from '@nexus-ui/core';
import type { AgentPolicy } from './policy';
import type { AgentTurn } from './agent-turn';
import { InMemorySurfaceHistoryStore, findSurfaceCatalog } from './history';
import type { SurfaceHistoryStore } from './history';
import { isOfficialBasicCatalog } from './catalog-identity';
import { manageAgentRun } from './run-lifecycle';
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
  SurfaceActionSnapshot,
} from './surface-action-state';
import {
  admitAction,
  createEditablePathWhitelist,
  rejectUndeclaredClientContext,
  validateActionParams,
  type ActionAdmissionCode,
} from './action-admission';
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

export type AgentPlan =
  | { ok: true; run: AgentRun }
  | { ok: false; message: string; code?: ActionAdmissionCode };

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
  onGenerationCommitted?: (event: AgentGenerationCommitEvent) => void | Promise<void>;
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
  private readonly onGenerationCommitted?: (
    event: AgentGenerationCommitEvent,
  ) => void | Promise<void>;
  private readonly surfaceActionLocks = new Map<string, Promise<void>>();

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
    this.onGenerationCommitted = options.onGenerationCommitted;
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
    if (typeof request.catalogId !== 'string' || request.catalogId === '') {
      return {
        ok: false,
        message: '生成请求必须显式提供 catalogId；SDK 不回落任何默认 Catalog',
      };
    }
    const catalogId = request.catalogId;
    if (isOfficialBasicCatalog(catalogId)) {
      return {
        ok: false,
        message:
          'Nexus 不注册官方 Basic Catalog；请使用 Nexus Basic Task Profile 或宿主自定义 catalog',
      };
    }
    const catalog = this.describeCatalog(catalogId);
    if (!catalog) {
      return { ok: false, message: `Agent catalog 未注册: ${catalogId}` };
    }

    const surfaceId = this.createSurfaceId();
    const message =
      typeof request.message === 'string' && request.message.trim()
        ? request.message
        : this.defaultGenerationMessage;
    const useLlm = this.useLlm();
    if (useLlm && !this.createGenerationSource && !this.streamLlm) {
      throw new Error('useLlm 启用时必须显式注入 streamLlm 生成源；SDK 不再默认绑定模型 SDK');
    }
    const supportedActions = catalog.actions.map((action) => action.name);
    const supportedComponents = Object.keys(catalog.components);
    const catalogContract = createCatalogContractReference(catalog);
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
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
    if (!this.createGenerationSource && !useLlm && !this.fallbackGeneration) {
      return {
        ok: false,
        message:
          'Generation source 未配置；宿主需注入 createGenerationSource、fallbackGeneration 或启用 LLM',
      };
    }
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
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
      else yield* fallbackGeneration!(sourceRequest);
    })();
    const shouldRecordHistory = Boolean(this.createGenerationSource) || useLlm;
    const generationRunId = randomUUID();
    return {
      ok: true,
      run: manageAgentRun(
        {
          runId: generationRunId,
          source,
          sequence: {
            kind: 'generate',
            surfaceId,
            catalogId,
            registry: new FixedCatalogRegistry([structuredClone(catalog)]),
            supportedActions,
            message,
            policy: this.policy,
          },
          commit: async (messages) => {
            const surfaceCatalog = findSurfaceCatalog(messages);
            if (!surfaceCatalog) throw new Error('生成流缺少 createSurface，不能提交 history');
            const committed = await this.actionStateStore.commitGeneration(
              surfaceCatalog.surfaceId,
              surfaceCatalog.catalogId,
              messages,
              {
                catalogHash: catalogContract.hash,
                contractVersion: catalogContract.version,
                catalog,
              },
            );
            try {
              await this.onGenerationCommitted?.({
                surfaceId: surfaceCatalog.surfaceId,
                catalogId: surfaceCatalog.catalogId,
                messages,
              });
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
              await this.actionStateStore.removeSnapshot(surfaceCatalog.surfaceId);
              throw error;
            }
            return commitResult(committed, generationRunId);
          },
        },
        this.runManager,
        options.signal,
      ),
    };
  }

  async prepareAction(action: AgentAction, options: AgentPrepareOptions = {}): Promise<AgentPlan> {
    const releaseLock = await this.acquireSurfaceLock(action.surfaceId);
    let transferred = false;
    try {
      const snapshot = await this.actionStateStore.get(action.surfaceId);
      if (!snapshot) {
        return { ok: false, message: `Action surface 不存在或已过期: ${action.surfaceId}` };
      }
      // 准入与 guard 解释一律使用提交边界固定的契约副本，不读当前 registry：
      // 宿主原地修改声明不能让同一 revision/hash/输入从拒绝翻转为接受
      const catalogId = snapshot.catalogId;
      const catalog = snapshot.contract.catalog;

      const surfaceAction = findSurfaceAction(snapshot, action.name, action.sourceComponentId);
      if (!surfaceAction) {
        return {
          ok: false,
          message: `Action 与服务端 surface 状态不匹配: ${action.surfaceId}/${action.sourceComponentId}/${action.name}`,
        };
      }

      const handler = this.actionHandlers.get(createActionHandlerKey(catalogId, action.name));
      if (!handler) {
        return {
          ok: false,
          message: `Action handler 未注册: ${catalogId}/${action.name}`,
        };
      }

      const ledgerKey = createActionLedgerKey(action);
      const ledgerStarted = this.actionLedger.begin({
        key: ledgerKey,
        surfaceId: action.surfaceId,
        actionName: action.name,
        sourceComponentId: action.sourceComponentId,
      });
      if (!ledgerStarted) {
        return { ok: false, message: 'Action 重放或重复提交已被拒绝' };
      }

      const clientContext = { ...action.context };
      const clientContextError = rejectUndeclaredClientContext(
        surfaceAction.declaration,
        clientContext,
      );
      if (clientContextError !== null) {
        this.actionLedger.complete(ledgerKey, 'failed');
        return { ok: false, message: clientContextError, code: 'param-invalid' };
      }

      // 共享权威准入先于一切参数解释：nexus 必填核对、action 来源能力、浏览器
      // 输入整批校验与临时模型重算。拒绝即 handler 未调用、快照与 revision 不变。
      let editable: ReadonlySet<string>;
      try {
        editable = createEditablePathWhitelist(this.editablePaths?.(action.surfaceId) ?? []);
      } catch (error) {
        this.actionLedger.complete(ledgerKey, 'failed');
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
        this.actionLedger.complete(ledgerKey, 'failed');
        return { ok: false, message: admission.message, code: admission.code };
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
        const paramError = validateActionParams(
          context,
          findActionDeclaration(catalog, action.name),
        );
        if (paramError !== null) throw new Error(paramError);
      } catch (error) {
        this.actionLedger.complete(ledgerKey, 'failed');
        return {
          ok: false,
          message: error instanceof Error ? error.message : 'Action context 解析失败',
          code: 'param-invalid',
        };
      }

      let history: AgentTurn[];
      try {
        history = (await this.historyStore.getHistory(action.surfaceId)).map((turn) => ({
          ...turn,
        }));
      } catch (error) {
        this.actionLedger.complete(ledgerKey, 'failed');
        return {
          ok: false,
          message: `Action 历史读取失败: ${
            error instanceof Error ? error.message : 'history store unavailable'
          }`,
        };
      }

      const authoritativeAction: AgentAction = { ...action, context };

      // Invoke the host handler only after the common record owner has reserved capacity.
      const source: AgentMessageSource = (async function* () {
        yield* await handler(authoritativeAction, {
          catalogId,
          catalog: structuredClone(catalog),
          supportedActions: catalog.actions.map((action) => action.name),
          catalogContract: createCatalogContractReference(catalog),
          history,
          surfaceAction: structuredClone(surfaceAction),
          clientContext: structuredClone(clientContext),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
      })();
      let released = false;
      const releaseOnce = (): void => {
        if (released) return;
        released = true;
        releaseLock();
      };

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
      const runId = randomUUID();
      let finished = false;
      const abortRun = (): void => {
        if (finished) return;
        finished = true;
        try {
          this.actionLedger.complete(ledgerKey, 'failed');
        } finally {
          releaseOnce();
        }
      };
      const run: AgentRun = {
        runId,
        // Publish the admitted input model before patches so consumers see the same composition.
        source: (async function* () {
          try {
            if (admission.inputWrites.length > 0) {
              yield {
                version: 'v0.9',
                updateDataModel: {
                  surfaceId: action.surfaceId,
                  value: structuredClone(admission.tempDataModel),
                },
              };
            }
            yield* source;
          } catch (error) {
            abortRun();
            throw error;
          }
        })(),
        sequence,
        commit: async (messages) => {
          if (finished) throw new Error('Action run 已终止，不能再次提交');
          finished = true;
          try {
            const candidates = structuredClone(messages);
            const state = createAgentStreamState(sequence);
            for (const [index, candidate] of candidates.entries()) {
              const protocol = validateProtocolMessage(candidate);
              if (!protocol.ok || !protocol.message)
                throw new Error(protocol.error?.message ?? '非法 patch');
              const issue =
                validateNexusProfileMessage(protocol.message) ??
                validateAgentStreamMessageDetailed(protocol.message, index, sequence, state);
              if (issue) throw new Error(issue.message);
            }
            const finalIssue = validateAgentStreamFinalDetailed(sequence, state);
            if (finalIssue) throw new Error(finalIssue.message);
            const committed = await this.actionStateStore.commitAction(candidates, {
              surfaceId: action.surfaceId,
              expectedEpoch: snapshot.epoch,
              expectedRevision: snapshot.version,
              inputWrites: admission.inputWrites,
            });
            this.actionLedger.complete(ledgerKey, 'succeeded');
            return commitResult(committed, runId);
          } catch (error) {
            this.actionLedger.complete(ledgerKey, 'failed');
            throw error;
          } finally {
            releaseOnce();
          }
        },
        onError: abortRun,
        dispose: abortRun,
      };

      const managed = manageAgentRun(run, this.runManager, options.signal);
      transferred = true;
      return { ok: true, run: managed };
    } finally {
      if (!transferred) releaseLock();
    }
  }

  private async acquireSurfaceLock(surfaceId: string): Promise<() => void> {
    const previous = this.surfaceActionLocks.get(surfaceId) ?? Promise.resolve();
    let releaseLock!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.surfaceActionLocks.set(surfaceId, current);
    await previous;
    return () => {
      releaseLock();
      if (this.surfaceActionLocks.get(surfaceId) === current) {
        this.surfaceActionLocks.delete(surfaceId);
      }
    };
  }
}

function commitResult(snapshot: SurfaceActionSnapshot, runId: string): NexusSurfaceCommit {
  return {
    sessionVersion: 1,
    runId,
    surfaceId: snapshot.surfaceId,
    catalogId: snapshot.catalogId,
    contractVersion: snapshot.contract.contractVersion,
    catalogHash: snapshot.contract.catalogHash,
    surfaceRevision: snapshot.version,
  };
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
