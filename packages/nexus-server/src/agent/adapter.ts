import { randomUUID } from 'node:crypto';
import type { CatalogDefinition, CatalogRegistry } from '@nexus-ui/core';
import {
  agentCatalogRegistry,
  NEXUS_BASIC_TASK_CATALOG,
  getCatalogActions,
  isOfficialBasicCatalog,
  normalizeLegacyBasicCatalog,
} from './catalog';
import type { AgentSequenceOptions } from './agent-guard';
import { resolveAgentPolicy, type AgentPolicy } from './policy';
import type { AgentTurn } from './llm-agent';
import { defaultSurfaceHistoryStore, findSurfaceCatalog } from './history';
import type { SurfaceHistoryStore } from './history';
import { isLlmAgentEnabled, streamLlmMessages } from './llm-agent';
import { createCatalogContractReference } from './catalog-contract';
import type { CatalogContractReference } from './catalog-contract';
import {
  InMemorySurfaceActionLedger,
  InMemorySurfaceActionStateStore,
  findSurfaceAction,
  resolveDeclaredActionContext,
} from './surface-action-state';
import type {
  ResolvedSurfaceAction,
  SurfaceActionLedger,
  SurfaceActionStateStore,
} from './surface-action-state';
export interface AgentAction {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  timestamp: string;
  actionId?: string;
  context: Record<string, unknown>;
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
  source: AgentMessageSource;
  sequence: AgentSequenceOptions;
  commit(messages: unknown[]): void | Promise<void>;
  /** Called when the SSE stream fails after the run was dispatched; use to close side-effect state. */
  onError?(error?: unknown): void;
  /** Called by sendAgentRun in finally; use to release per-surface locks. */
  dispose?: () => void;
  /**
   * Set by sendAgentRun before consuming the source: per-surface lock release
   * moves to commit/onError/dispose, so source exhaustion must not release the
   * lock while the action result is not yet committed.
   */
  streamClaimed?: boolean;
}

export type AgentPlan = { ok: true; run: AgentRun } | { ok: false; message: string };

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
}

export type AgentActionContextResolver = (
  resolution: AgentActionContextResolution,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

export interface AgentAdapterOptions {
  registry?: CatalogRegistry;
  actionHandlers?: Map<string, AgentActionHandler>;
  historyStore?: SurfaceHistoryStore;
  useLlm?: () => boolean;
  streamLlm?: typeof streamLlmMessages;
  createGenerationSource?: AgentGenerationSource;
  fallbackGeneration?: AgentGenerationSource;
  createSurfaceId?: () => string;
  policy?: AgentPolicy;
  actionStateStore?: SurfaceActionStateStore;
  actionLedger?: SurfaceActionLedger;
  resolveActionContext?: AgentActionContextResolver;
  defaultGenerationMessage?: string;
  onGenerationCommitted?: (event: AgentGenerationCommitEvent) => void | Promise<void>;
}

function createActionHandlerKey(catalogId: string, actionName: string): string {
  return `${catalogId}:${actionName}`;
}

/**
 * Transport-neutral seam for generation sources and business action handlers.
 * Koa stays responsible for HTTP envelopes; this class owns agent dispatch.
 */
export class AgentAdapter {
  private readonly registry: CatalogRegistry;
  private readonly actionHandlers: Map<string, AgentActionHandler>;
  private readonly historyStore: SurfaceHistoryStore;
  private readonly useLlm: () => boolean;
  private readonly streamLlm: typeof streamLlmMessages;
  private readonly createGenerationSource?: AgentGenerationSource;
  private readonly fallbackGeneration?: AgentGenerationSource;
  private readonly createSurfaceId: () => string;
  private readonly policy = resolveAgentPolicy();
  private readonly actionStateStore: SurfaceActionStateStore;
  private readonly actionLedger: SurfaceActionLedger;
  private readonly resolveActionContext?: AgentActionContextResolver;
  private readonly defaultGenerationMessage: string;
  private readonly onGenerationCommitted?: (
    event: AgentGenerationCommitEvent,
  ) => void | Promise<void>;
  private readonly surfaceActionLocks = new Map<string, Promise<void>>();

  constructor(options: AgentAdapterOptions = {}) {
    this.registry = options.registry ?? agentCatalogRegistry;
    this.policy = resolveAgentPolicy(options.policy);
    this.actionHandlers = options.actionHandlers ?? new Map();
    this.historyStore = options.historyStore ?? defaultSurfaceHistoryStore;
    this.actionStateStore = options.actionStateStore ?? new InMemorySurfaceActionStateStore();
    this.actionLedger = options.actionLedger ?? new InMemorySurfaceActionLedger();
    this.resolveActionContext = options.resolveActionContext;
    this.useLlm = options.useLlm ?? isLlmAgentEnabled;
    this.streamLlm = options.streamLlm ?? streamLlmMessages;
    this.createGenerationSource = options.createGenerationSource;
    this.fallbackGeneration = options.fallbackGeneration;
    this.createSurfaceId = options.createSurfaceId ?? (() => `surface-${randomUUID()}`);
    this.defaultGenerationMessage = options.defaultGenerationMessage ?? '';
    this.onGenerationCommitted = options.onGenerationCommitted;
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
    const requestedCatalogId = request.catalogId ?? NEXUS_BASIC_TASK_CATALOG;
    const catalogId = normalizeLegacyBasicCatalog(requestedCatalogId);
    if (isOfficialBasicCatalog(requestedCatalogId)) {
      return {
        ok: false,
        message:
          'Nexus 不注册官方 Basic Catalog；请使用 Nexus Basic Task Profile 或宿主自定义 catalog',
      };
    }
    const catalog = this.registry.get(catalogId);
    if (!catalog) {
      return { ok: false, message: `Agent catalog 未注册: ${catalogId}` };
    }

    const surfaceId = this.createSurfaceId();
    const message =
      typeof request.message === 'string' && request.message.trim()
        ? request.message
        : this.defaultGenerationMessage;
    const useLlm = this.useLlm();
    const supportedActions = getCatalogActions(catalogId, catalog);
    const catalogContract = createCatalogContractReference(catalog);
    const history = (await this.historyStore.getHistory(surfaceId)).map((turn) => ({ ...turn }));
    const sourceRequest: AgentGenerationSourceRequest = {
      kind: 'generate',
      surfaceId,
      message,
      catalogId,
      catalog,
      supportedComponents: catalog.components,
      supportedActions,
      catalogContract,
      history,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
    let source: AgentMessageSource;
    try {
      if (this.createGenerationSource) {
        source = this.createGenerationSource(sourceRequest);
      } else if (useLlm) {
        source = this.streamLlm({
          kind: 'generate',
          surfaceId,
          message,
          catalogId,
          supportedComponents: catalog.components,
          supportedActions,
          history,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
      } else if (this.fallbackGeneration) {
        source = this.fallbackGeneration(sourceRequest);
      } else {
        return {
          ok: false,
          message:
            'Generation source 未配置；宿主需注入 createGenerationSource、fallbackGeneration 或启用 LLM',
        };
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '自定义 Agent 生成源创建失败',
      };
    }
    const shouldRecordHistory = Boolean(this.createGenerationSource) || useLlm;
    return {
      ok: true,
      run: {
        source,
        sequence: {
          kind: 'generate',
          surfaceId,
          catalogId,
          registry: this.registry,
          supportedActions: getCatalogActions(catalogId, catalog),
          message,
          policy: this.policy,
        },
        commit: async (messages) => {
          const surfaceCatalog = findSurfaceCatalog(messages);
          if (!surfaceCatalog) throw new Error('生成流缺少 createSurface，不能提交 history');
          await this.actionStateStore.commitGeneration(
            surfaceCatalog.surfaceId,
            surfaceCatalog.catalogId,
            messages,
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
        },
      },
    };
  }

  async prepareAction(action: AgentAction, options: AgentPrepareOptions = {}): Promise<AgentPlan> {
    const releaseLock = await this.acquireSurfaceLock(action.surfaceId);
    const snapshot = await this.actionStateStore.get(action.surfaceId);
    if (!snapshot) {
      releaseLock();
      return { ok: false, message: `Action surface 不存在或已过期: ${action.surfaceId}` };
    }
    const historyCatalogId = snapshot.catalogId;
    const catalogId = normalizeLegacyBasicCatalog(historyCatalogId);
    const catalog = this.registry.get(catalogId);
    if (!catalog) {
      releaseLock();
      return { ok: false, message: `Agent catalog 未注册: ${catalogId}` };
    }

    const surfaceAction = findSurfaceAction(snapshot, action.name, action.sourceComponentId);
    if (!surfaceAction) {
      releaseLock();
      return {
        ok: false,
        message: `Action 与服务端 surface 状态不匹配: ${action.surfaceId}/${action.sourceComponentId}/${action.name}`,
      };
    }

    const handler = this.actionHandlers.get(createActionHandlerKey(catalogId, action.name));
    if (!handler) {
      releaseLock();
      return {
        ok: false,
        message: `Action handler 未注册: ${catalogId}/${action.name}`,
      };
    }

    const ledgerKey = createActionLedgerKey(action);
    if (
      !this.actionLedger.begin({
        key: ledgerKey,
        surfaceId: action.surfaceId,
        actionName: action.name,
        sourceComponentId: action.sourceComponentId,
      })
    ) {
      releaseLock();
      return { ok: false, message: 'Action 重放或重复提交已被拒绝' };
    }

    const clientContext = { ...action.context };
    let context: Record<string, unknown>;
    let contextFromDeclaredBindings = false;
    try {
      if (this.resolveActionContext) {
        context = await this.resolveActionContext({
          action,
          surfaceAction,
          clientContext,
        });
      } else {
        // Without a custom resolver the server dataModel is authoritative; reject
        // any client-supplied field that is not declared in the action binding.
        contextFromDeclaredBindings = true;
        context = resolveDeclaredActionContext(surfaceAction.declaration, snapshot.dataModel);
      }
      if (typeof context !== 'object' || context === null || Array.isArray(context)) {
        throw new Error('Action context resolver 必须返回 JSON 对象');
      }
      if (contextFromDeclaredBindings) {
        const declaredFields = new Set(Object.keys(surfaceAction.declaration.context ?? {}));
        const extraFields = Object.keys(clientContext).filter((key) => !declaredFields.has(key));
        if (Object.keys(clientContext).length > 0 && extraFields.length > 0) {
          throw new Error(`Action context 包含未声明的客户端字段: ${extraFields.join(', ')}`);
        }
      }
    } catch (error) {
      this.actionLedger.complete(ledgerKey, 'failed');
      releaseLock();
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Action context 解析失败',
      };
    }

    let history: AgentTurn[];
    try {
      history = (await this.historyStore.getHistory(action.surfaceId)).map((turn) => ({
        ...turn,
      }));
    } catch (error) {
      this.actionLedger.complete(ledgerKey, 'failed');
      releaseLock();
      return {
        ok: false,
        message: `Action 历史读取失败: ${
          error instanceof Error ? error.message : 'history store unavailable'
        }`,
      };
    }

    const authoritativeAction: AgentAction = { ...action, context };

    let source: AgentMessageSource;
    try {
      source = await handler(authoritativeAction, {
        catalogId,
        catalog,
        supportedActions: getCatalogActions(catalogId, catalog),
        catalogContract: createCatalogContractReference(catalog),
        history,
        surfaceAction,
        clientContext,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    } catch (error) {
      this.actionLedger.complete(ledgerKey, 'failed');
      releaseLock();
      return {
        ok: false,
        message: error instanceof Error ? error.message : '业务 action 处理失败',
      };
    }
    let released = false;
    const releaseOnce = (): void => {
      if (released) return;
      released = true;
      releaseLock();
    };

    // The lock must outlive source exhaustion: the next same-surface action may
    // only read its snapshot after this run's commit (or failure) has settled.
    // sendAgentRun claims the run before streaming, so release happens in the
    // commit/onError wrappers below; direct source consumers (tests, in-process
    // assemblies) keep the exhaustion fallback.
    const run: AgentRun = {
      source: createLockGuardedSource(source, () => {
        if (!run.streamClaimed) releaseOnce();
      }),
      sequence: {
        kind: 'action',
        surfaceId: action.surfaceId,
        catalogId,
        registry: this.registry,
        supportedActions: getCatalogActions(catalogId, catalog),
        policy: this.policy,
      },
      commit: async (messages) => {
        await this.actionStateStore.commitAction(messages);
        this.actionLedger.complete(ledgerKey, 'succeeded');
        releaseOnce();
      },
      onError: () => {
        this.actionLedger.complete(ledgerKey, 'failed');
        releaseOnce();
      },
      dispose: releaseOnce,
    };

    return { ok: true, run };
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

async function* createLockGuardedSource(
  source: AgentMessageSource,
  release: () => void,
): AsyncGenerator<unknown> {
  try {
    yield* source;
  } finally {
    release();
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
