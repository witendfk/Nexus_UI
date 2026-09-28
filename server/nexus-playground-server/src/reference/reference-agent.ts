import { AgentAdapter } from '../agent/adapter';
import type {
  AgentActionHandler,
  AgentAdapterOptions,
  AgentGenerationCommitEvent,
  AgentGenerationSource,
} from '../agent/adapter';
import { NEXUS_BASIC_TASK_CATALOG, TASK_CATALOG, WORKBENCH_CATALOG } from '../agent/catalog';
import {
  createActionResponse,
  createContactFixture,
  createSearchActionResponse,
  createSubmitActionResponse,
  createTaskFixture,
  createWorkbenchFixture,
} from '../agent/mock-agent';
import { TaskStateStore, createTaskActionHandler } from '../agent/task-agent';
import { WorkbenchTaskStore, createWorkbenchActionHandler } from '../agent/workbench-agent';

export interface ReferenceAgentAdapterOptions extends AgentAdapterOptions {
  taskStateStore?: TaskStateStore;
  workbenchTaskStore?: WorkbenchTaskStore;
}

const DEFAULT_REFERENCE_MESSAGE = '生成一张联系人卡片';

function createReferenceFallbackGeneration(): AgentGenerationSource {
  return (request) => {
    if (request.catalogId === NEXUS_BASIC_TASK_CATALOG) {
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
 * reference-server-only; hosts should inject their own sources and handlers.
 */
export function createReferenceAgentAdapter(
  options: ReferenceAgentAdapterOptions = {},
): AgentAdapter {
  const taskStateStore = options.taskStateStore ?? new TaskStateStore();
  const workbenchTaskStore = options.workbenchTaskStore ?? new WorkbenchTaskStore();
  const actionHandlers = createReferenceActionHandlers(taskStateStore, workbenchTaskStore);
  for (const [key, handler] of options.actionHandlers ?? []) {
    actionHandlers.set(key, handler);
  }

  const callerHook = options.onGenerationCommitted;
  const onGenerationCommitted = async (event: AgentGenerationCommitEvent): Promise<void> => {
    if (event.catalogId === TASK_CATALOG) taskStateStore.initialize(event.surfaceId);
    if (event.catalogId === WORKBENCH_CATALOG) workbenchTaskStore.initialize(event.surfaceId);
    await callerHook?.(event);
  };

  return new AgentAdapter({
    ...options,
    actionHandlers,
    fallbackGeneration: options.fallbackGeneration ?? createReferenceFallbackGeneration(),
    defaultGenerationMessage: options.defaultGenerationMessage ?? DEFAULT_REFERENCE_MESSAGE,
    onGenerationCommitted,
  });
}
