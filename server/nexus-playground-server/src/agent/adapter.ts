import { randomUUID } from 'node:crypto';
import type { CatalogDefinition, CatalogRegistry } from '@nexus-ui/core';
import {
  agentCatalogRegistry,
  BASIC_CATALOG,
  getCatalogActions,
  TASK_CATALOG,
  WORKBENCH_CATALOG,
} from './catalog';
import type { AgentSequenceOptions } from './agent-guard';
import type { AgentTurn } from './llm-agent';
import { defaultSurfaceHistoryStore, findSurfaceCatalog } from './history';
import type { SurfaceHistoryStore } from './history';
import { isLlmAgentEnabled, streamLlmMessages } from './llm-agent';
import {
  createActionResponse,
  createContactFixture,
  createSearchActionResponse,
  createSubmitActionResponse,
  createTaskFixture,
  createWorkbenchFixture,
} from './mock-agent';
import type { TaskStateStore } from './task-agent';
import { createTaskActionHandler, taskStateStore } from './task-agent';
import type { WorkbenchTaskStore } from './workbench-agent';
import { createWorkbenchActionHandler, workbenchTaskStore } from './workbench-agent';

export interface AgentAction {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  timestamp: string;
  context: Record<string, unknown>;
}

export interface AgentGenerateRequest {
  message?: string;
  catalogId?: string;
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
}

export type AgentGenerationSource = (request: AgentGenerationSourceRequest) => AgentMessageSource;

export interface AgentActionContext {
  catalogId: string;
  catalog: CatalogDefinition;
  supportedActions: readonly string[];
  history: readonly AgentTurn[];
}

export interface AgentAdapterOptions {
  registry?: CatalogRegistry;
  actionHandlers?: Map<string, AgentActionHandler>;
  historyStore?: SurfaceHistoryStore;
  useLlm?: () => boolean;
  streamLlm?: typeof streamLlmMessages;
  createGenerationSource?: AgentGenerationSource;
  createSurfaceId?: () => string;
  taskStateStore?: TaskStateStore;
  workbenchTaskStore?: WorkbenchTaskStore;
}

function createActionHandlerKey(catalogId: string, actionName: string): string {
  return `${catalogId}:${actionName}`;
}

function createDefaultActionHandlers(
  store: TaskStateStore,
  workbenchStore: WorkbenchTaskStore,
): Map<string, AgentActionHandler> {
  const handlers = new Map<string, AgentActionHandler>();
  handlers.set(createActionHandlerKey(BASIC_CATALOG, 'call'), (action) =>
    createActionResponse(action.surfaceId),
  );
  handlers.set(createActionHandlerKey(BASIC_CATALOG, 'search'), (action) =>
    createSearchActionResponse(action.surfaceId, action.context),
  );
  handlers.set(createActionHandlerKey(BASIC_CATALOG, 'submit'), (action) =>
    createSubmitActionResponse(action.surfaceId, action.context),
  );
  handlers.set(createActionHandlerKey(TASK_CATALOG, 'start'), createTaskActionHandler(store));
  handlers.set(createActionHandlerKey(TASK_CATALOG, 'complete'), createTaskActionHandler(store));
  handlers.set(
    createActionHandlerKey(WORKBENCH_CATALOG, 'submit'),
    createWorkbenchActionHandler(workbenchStore),
  );
  return handlers;
}

function createFallbackGeneration(
  surfaceId: string,
  catalog: CatalogDefinition,
): AgentMessageSource {
  if (catalog.catalogId === BASIC_CATALOG) return createContactFixture(surfaceId);
  if (catalog.catalogId === TASK_CATALOG) return createTaskFixture(surfaceId);
  if (catalog.catalogId === WORKBENCH_CATALOG) return createWorkbenchFixture(surfaceId);
  throw new Error(`Fallback Agent 未支持 catalog: ${catalog.catalogId}`);
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
  private readonly createSurfaceId: () => string;
  private readonly taskStateStore: TaskStateStore;
  private readonly workbenchTaskStore: WorkbenchTaskStore;

  constructor(options: AgentAdapterOptions = {}) {
    this.registry = options.registry ?? agentCatalogRegistry;
    this.taskStateStore = options.taskStateStore ?? taskStateStore;
    this.workbenchTaskStore = options.workbenchTaskStore ?? workbenchTaskStore;
    this.actionHandlers =
      options.actionHandlers ??
      createDefaultActionHandlers(this.taskStateStore, this.workbenchTaskStore);
    this.historyStore = options.historyStore ?? defaultSurfaceHistoryStore;
    this.useLlm = options.useLlm ?? isLlmAgentEnabled;
    this.streamLlm = options.streamLlm ?? streamLlmMessages;
    this.createGenerationSource = options.createGenerationSource;
    this.createSurfaceId = options.createSurfaceId ?? (() => `surface-${randomUUID()}`);
  }

  registerActionHandler(catalogId: string, actionName: string, handler: AgentActionHandler): void {
    const key = createActionHandlerKey(catalogId, actionName);
    if (this.actionHandlers.has(key)) {
      throw new Error(`Action handler 已注册: ${key}`);
    }
    this.actionHandlers.set(key, handler);
  }

  async prepareGeneration(request: AgentGenerateRequest): Promise<AgentPlan> {
    const catalogId = request.catalogId ?? BASIC_CATALOG;
    const catalog = this.registry.get(catalogId);
    if (!catalog) {
      return { ok: false, message: `Agent catalog 未注册: ${catalogId}` };
    }

    const surfaceId = this.createSurfaceId();
    const message =
      typeof request.message === 'string' && request.message.trim()
        ? request.message
        : '生成一张联系人卡片';
    const useLlm = this.useLlm();
    const supportedActions = getCatalogActions(catalogId);
    const history = (await this.historyStore.getHistory(surfaceId)).map((turn) => ({ ...turn }));
    let source: AgentMessageSource;
    try {
      source = this.createGenerationSource
        ? this.createGenerationSource({
            kind: 'generate',
            surfaceId,
            message,
            catalogId,
            catalog,
            supportedComponents: catalog.components,
            supportedActions,
            history,
          })
        : useLlm
          ? this.streamLlm({
              kind: 'generate',
              surfaceId,
              message,
              catalogId,
              supportedComponents: catalog.components,
              supportedActions,
              history,
            })
          : createFallbackGeneration(surfaceId, catalog);
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
          supportedActions: getCatalogActions(catalogId),
          message,
        },
        commit: async (messages) => {
          const surfaceCatalog = findSurfaceCatalog(messages);
          if (!surfaceCatalog) throw new Error('生成流缺少 createSurface，不能提交 history');
          if (catalogId === TASK_CATALOG) this.taskStateStore.initialize(surfaceId);
          if (catalogId === WORKBENCH_CATALOG) this.workbenchTaskStore.initialize(surfaceId);
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
        },
      },
    };
  }

  async prepareAction(action: AgentAction): Promise<AgentPlan> {
    const catalogId = (await this.historyStore.getCatalogId(action.surfaceId)) ?? BASIC_CATALOG;
    const catalog = this.registry.get(catalogId);
    if (!catalog) {
      return { ok: false, message: `Agent catalog 未注册: ${catalogId}` };
    }

    const handler = this.actionHandlers.get(createActionHandlerKey(catalogId, action.name));
    if (!handler) {
      return {
        ok: false,
        message: `Action handler 未注册: ${catalogId}/${action.name}`,
      };
    }

    const history = (await this.historyStore.getHistory(action.surfaceId)).map((turn) => ({
      ...turn,
    }));
    let source: AgentMessageSource;
    try {
      source = await handler(action, {
        catalogId,
        catalog,
        supportedActions: getCatalogActions(catalogId),
        history,
      });
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '业务 action 处理失败',
      };
    }

    return {
      ok: true,
      run: {
        source,
        sequence: {
          kind: 'action',
          surfaceId: action.surfaceId,
          catalogId,
          registry: this.registry,
          supportedActions: getCatalogActions(catalogId),
        },
        commit: () => undefined,
      },
    };
  }
}
