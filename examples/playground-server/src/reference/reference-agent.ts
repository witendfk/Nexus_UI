import { AgentAdapter } from '@nexus-ui/server';
import type {
  AgentActionHandler,
  AgentAdapterOptions,
  AgentGenerationCommitEvent,
  AgentGenerationSource,
} from '@nexus-ui/server';
import type { CatalogDefinition, CatalogRegistry } from '@nexus-ui/core';
import {
  agentCatalogRegistry,
  NEXUS_BASIC_TASK_CATALOG,
  TASK_CATALOG,
  WORKBENCH_CATALOG,
} from '../agent/catalog';
import {
  createActionResponse,
  createContactFixture,
  createContactFormFixture,
  createSearchActionResponse,
  createSubmitActionResponse,
  createTaskFixture,
  createWorkbenchFixture,
} from '../agent/mock-agent';
import { isLlmAgentEnabled, streamLlmMessages } from '../agent/llm-agent';
import { isFormRequest } from '../agent/policy/workflow-policy';
import { resolveAgentPolicy } from '../agent/policy';
import { TaskStateStore, createTaskActionHandler } from '../agent/task-agent';
import { WorkbenchTaskStore, createWorkbenchActionHandler } from '../agent/workbench-agent';

export interface ReferenceAgentAdapterOptions extends Omit<AgentAdapterOptions, 'registry'> {
  /** Defaults to the playground demo registry; hosts inject their own. */
  registry?: CatalogRegistry;
  taskStateStore?: TaskStateStore;
  workbenchTaskStore?: WorkbenchTaskStore;
}

const DEFAULT_REFERENCE_MESSAGE = '生成一张联系人卡片';

/** 参考服务实际发布并执行的全部 Catalog；发布列表由此取得（S2.6.1.1）。 */
const REFERENCE_CATALOG_IDS: readonly string[] = [
  NEXUS_BASIC_TASK_CATALOG,
  TASK_CATALOG,
  WORKBENCH_CATALOG,
];

/**
 * surface → catalog 映射容量。超限按插入序淘汰最旧条目：被淘汰 surface 的
 * 快照若仍存在，其非空输入回到 SDK 缺省拒绝（fail-closed），不会获得旧白名单。
 */
export const REFERENCE_SURFACE_CATALOG_CAPACITY = 512;

/**
 * 可信服务端装配的业务可编辑面（S2.6.1.2）：按 Catalog 精确声明，允许路径
 * 不从模型或浏览器推断。只读字段（customer/customerId、customerName、审批
 * 状态、联系人展示字段等）一律不开放；未记录的 surface 返回空数组。
 */
const REFERENCE_EDITABLE_PATHS: ReadonlyMap<string, readonly string[]> = new Map([
  [NEXUS_BASIC_TASK_CATALOG, ['/name', '/subscribed']],
  [TASK_CATALOG, []],
  [WORKBENCH_CATALOG, ['/taskTitle', '/priority', '/reminderAt']],
]);

export function referenceEditablePathsForCatalog(catalogId: string): readonly string[] {
  return REFERENCE_EDITABLE_PATHS.get(catalogId) ?? [];
}

/**
 * 只记录「该 surface 最近一次成功生成提交」的 Catalog：条目在生成提交边界
 * 刷新（删除重建同 surfaceId 会覆盖）；SDK 侧快照淘汰不做主动失效——缺失
 * 快照的 action 一律拒绝，旧条目不会放大权限。跨 Catalog 重生成的瞬时窗口
 * 内，两组 Catalog 的可编辑路径互不相交，旧白名单只会过度拒绝，不会过度接受。
 */
export class ReferenceSurfaceCatalogIndex {
  private readonly entries = new Map<string, string>();

  constructor(private readonly capacity: number = REFERENCE_SURFACE_CATALOG_CAPACITY) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new Error('ReferenceSurfaceCatalogIndex capacity 必须是正安全整数');
    }
  }

  record(surfaceId: string, catalogId: string): void {
    this.entries.delete(surfaceId);
    this.entries.set(surfaceId, catalogId);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  catalogOf(surfaceId: string): string | undefined {
    return this.entries.get(surfaceId);
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * S2.6.1.1：发布列表取自 adapter 的固定执行声明（describeCatalog 首次调用即
 * 捕获并固定副本）。router 装配期会再与执行声明核对 hash——registry 里的对象
 * 本身不直接对外发布。
 */
export function listReferencePublishedCatalogs(adapter: AgentAdapter): CatalogDefinition[] {
  const published: CatalogDefinition[] = [];
  for (const catalogId of REFERENCE_CATALOG_IDS) {
    const catalog = adapter.describeCatalog(catalogId);
    if (catalog) published.push(catalog);
  }
  return published;
}

function createReferenceFallbackGeneration(): AgentGenerationSource {
  return (request) => {
    if (request.catalogId === NEXUS_BASIC_TASK_CATALOG) {
      if (isFormRequest(request.message)) return createContactFormFixture(request.surfaceId);
      return createContactFixture(request.surfaceId);
    }
    if (request.catalogId === TASK_CATALOG) return createTaskFixture(request.surfaceId);
    if (request.catalogId === WORKBENCH_CATALOG) {
      return createWorkbenchFixture(request.surfaceId);
    }
    throw new Error(`Reference fallback 未支持 catalog: ${request.catalogId}`);
  };
}

function createReferenceActionHandlers(
  taskStateStore: TaskStateStore,
  workbenchTaskStore: WorkbenchTaskStore,
): Map<string, AgentActionHandler> {
  const handlers = new Map<string, AgentActionHandler>();
  handlers.set(`${NEXUS_BASIC_TASK_CATALOG}:call`, (action) =>
    createActionResponse(action.surfaceId),
  );
  handlers.set(`${NEXUS_BASIC_TASK_CATALOG}:search`, (action) =>
    createSearchActionResponse(action.surfaceId, action.context),
  );
  handlers.set(`${NEXUS_BASIC_TASK_CATALOG}:submit`, (action) =>
    createSubmitActionResponse(action.surfaceId, action.context),
  );
  handlers.set(`${TASK_CATALOG}:start`, createTaskActionHandler(taskStateStore));
  handlers.set(`${TASK_CATALOG}:complete`, createTaskActionHandler(taskStateStore));
  handlers.set(`${WORKBENCH_CATALOG}:submit`, createWorkbenchActionHandler(workbenchTaskStore));
  return handlers;
}

/**
 * Assemble the repository's deterministic playground examples. This factory is
 * playground-server-only; hosts should inject their own sources and handlers.
 * The demo catalog registry and model stream are wired explicitly here — the
 * SDK no longer provides them implicitly.
 */
export function createReferenceAgentAdapter(
  options: ReferenceAgentAdapterOptions = {},
): AgentAdapter {
  const taskStateStore = options.taskStateStore ?? new TaskStateStore();
  const workbenchTaskStore = options.workbenchTaskStore ?? new WorkbenchTaskStore();
  const surfaceCatalogIndex = new ReferenceSurfaceCatalogIndex();
  const actionHandlers = createReferenceActionHandlers(taskStateStore, workbenchTaskStore);
  for (const [key, handler] of options.actionHandlers ?? []) {
    actionHandlers.set(key, handler);
  }

  const callerHook = options.onGenerationCommitted;
  const onGenerationCommitted = async (event: AgentGenerationCommitEvent): Promise<void> => {
    // 先记录 surface↔catalog 关系再触发演示业务初始化；后续失败时快照会被
    // adapter 回滚，孤立的映射条目只会让输入回到缺省拒绝。
    surfaceCatalogIndex.record(event.surfaceId, event.catalogId);
    if (event.catalogId === TASK_CATALOG) taskStateStore.initialize(event.surfaceId);
    if (event.catalogId === WORKBENCH_CATALOG) workbenchTaskStore.initialize(event.surfaceId);
    await callerHook?.(event);
  };

  return new AgentAdapter({
    ...options,
    registry: options.registry ?? agentCatalogRegistry,
    policy: resolveAgentPolicy(options.policy),
    actionHandlers,
    useLlm: options.useLlm ?? isLlmAgentEnabled,
    streamLlm: options.streamLlm ?? streamLlmMessages,
    fallbackGeneration: options.fallbackGeneration ?? createReferenceFallbackGeneration(),
    defaultGenerationMessage: options.defaultGenerationMessage ?? DEFAULT_REFERENCE_MESSAGE,
    // 宿主可显式收窄可编辑面（测试/更严环境）；缺省用可信 Catalog 级白名单。
    editablePaths:
      options.editablePaths ??
      ((surfaceId) => {
        const catalogId = surfaceCatalogIndex.catalogOf(surfaceId);
        return catalogId === undefined ? [] : referenceEditablePathsForCatalog(catalogId);
      }),
    onGenerationCommitted,
  });
}
