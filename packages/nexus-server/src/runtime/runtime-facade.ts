import { AgentAdapter } from '../agent/adapter';
import type { AgentPrepareOptions } from '../agent/adapter';
import type { AgentRunManager, AgentRunRecord } from '../agent/run-manager';
import { SurfaceScheduler } from './surface-scheduler';
import { validateBudgets, type AgentRuntimeBudgets } from './budgets';
import type { AgentRuntimeOptions } from './agent-runtime';
import type { AgentSchedulerOptions, EnqueueOutcome } from './agent-runtime';

/**
 * High-level transport-neutral entry (S3.2, SPEC §6.1; DESIGN D12). The
 * factory assembles one isolated runtime: its own adapter (fixed catalog
 * copies, handlers, stores), its own scheduler and its own run records.
 * `generate`/`action` return enqueue outcomes; run-scoped admission failures
 * surface as handle terminals, not entry rejections.
 *
 * S3.6：`budgets` 是预算的单一装配入口——队列容量/排队超时映射进调度器，
 * 其余预算经 adapter 下发到调度任务与发送层；显式 `scheduler` 选项优先于
 * budgets 的队列项。
 */
export interface AgentRuntime {
  /** The owning adapter; publication/describe helpers keep their adapter semantics. */
  readonly adapter: AgentAdapter;
  readonly runManager: AgentRunManager;
  generate(
    request: Parameters<AgentAdapter['prepareGeneration']>[0],
    options?: AgentPrepareOptions,
  ): Promise<EnqueueOutcome>;
  action(
    action: Parameters<AgentAdapter['prepareAction']>[0],
    options?: AgentPrepareOptions,
  ): Promise<EnqueueOutcome>;
  queryRun(surfaceId: string, runId: string): AgentRunRecord | undefined;
  listRuns(surfaceId: string): readonly AgentRunRecord[];
}

function schedulerOptionsFromBudgets(
  budgets: AgentRuntimeBudgets | undefined,
): AgentSchedulerOptions | undefined {
  if (!budgets) return undefined;
  const options: AgentSchedulerOptions = {};
  if (budgets.maxTrackedSurfaces !== undefined)
    options.maxTrackedSurfaces = budgets.maxTrackedSurfaces;
  if (budgets.maxQueuedPerSurface !== undefined) {
    options.maxQueuedPerSurface = budgets.maxQueuedPerSurface;
  }
  if (budgets.queueTimeoutMs !== undefined) {
    options.queueTimeoutMs = budgets.queueTimeoutMs;
  }
  return Object.keys(options).length > 0 ? options : undefined;
}

export class AgentRuntimeImpl implements AgentRuntime {
  readonly adapter: AgentAdapter;
  readonly runManager: AgentRunManager;
  constructor(options: AgentRuntimeOptions) {
    if (options.budgets) validateBudgets(options.budgets);
    const { scheduler: schedulerOption, ...adapterOptions } = options;
    const schedulerOptions = {
      ...schedulerOptionsFromBudgets(options.budgets),
      ...schedulerOption,
    };
    this.adapter = new AgentAdapter({
      ...adapterOptions,
      ...(Object.keys(schedulerOptions).length > 0
        ? { scheduler: new SurfaceScheduler(schedulerOptions) }
        : {}),
    });
    this.runManager = this.adapter.runManager;
  }

  async generate(
    request: Parameters<AgentAdapter['prepareGeneration']>[0],
    options: AgentPrepareOptions = {},
  ): Promise<EnqueueOutcome> {
    return this.adapter.enqueueGeneration(request, options);
  }

  async action(
    action: Parameters<AgentAdapter['prepareAction']>[0],
    options: AgentPrepareOptions = {},
  ): Promise<EnqueueOutcome> {
    return this.adapter.enqueueAction(action, options);
  }

  queryRun(surfaceId: string, runId: string): AgentRunRecord | undefined {
    const record = this.runManager.get(runId);
    if (!record || record.surfaceId !== surfaceId) return undefined;
    return record;
  }

  listRuns(surfaceId: string): readonly AgentRunRecord[] {
    return this.runManager.listBySurface(surfaceId);
  }
}

export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  return new AgentRuntimeImpl(options);
}

export type { AgentSchedulerOptions };
