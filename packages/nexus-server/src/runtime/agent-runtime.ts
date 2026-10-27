import type { NexusSurfaceCommit } from '@nexus-ui/core';
import { NEXUS_SESSION_VERSION } from '@nexus-ui/core';
import type { RunDiagnosticReporter } from '../agent/run-diagnostic';
import { CATALOG_CONTRACT_VERSION, createCatalogContractHash } from '../agent/catalog-contract';
import type { AgentRunManager } from '../agent/run-manager';
import type { AgentAdapterOptions, AgentAccessRejectionCode, AgentRun } from '../agent/adapter';
import {
  RunRecordHandle,
  manageAgentRun,
  type ManagedAgentRun,
  type RunIdentity,
} from '../agent/run-lifecycle';
import type { NexusRunDiagnostic } from '../agent/run-diagnostic';
import { reportRunDiagnostic } from '../agent/run-diagnostic';
import { schedulerForOwner } from './scheduler-owner';
import { RunTaskError, RuntimeRunHandle, type RunLifecycle } from './run-handle';
import type { SurfaceScheduler } from './surface-scheduler';
import { createAgentStreamState, type AgentSequenceOptions } from '../agent/agent-guard';
import { AgentCandidateError, finalizeCandidates, inspectCandidate } from './stream-inspect';

/**
 * Transport-neutral SDK run entry (S3.2, SPEC §6.1). Every run of a runtime —
 * generation or action, HTTP or non-Koa — is enqueued here: capacity is
 * reserved (queue slot + run record) before the caller receives the handle,
 * and the scheduled task covers snapshot read, admission, resolver, handler,
 * candidate guard and commit as one serial section per surface.
 */

export interface AgentSchedulerOptions {
  maxQueuedPerSurface?: number;
}

export interface AgentRuntimeOptions extends Omit<AgentAdapterOptions, 'scheduler'> {
  scheduler?: AgentSchedulerOptions;
}

export type EnqueueOutcome =
  | { accepted: true; run: RuntimeRunHandle }
  | {
      accepted: false;
      stage: 'request' | 'capacity';
      code?: 'RUN_CAPACITY_REJECTED' | AgentAccessRejectionCode;
      message: string;
    };

/** Prepared inside the scheduled task, after the surface slot is acquired. */
export interface PreparedRun {
  identity?: RunIdentity;
  /** Action baseline revision for the start event; generation runs omit it. */
  surfaceRevision?: number;
  actionId?: string;
  source: AsyncIterable<unknown> | Iterable<unknown>;
  sequence: AgentSequenceOptions;
  /** Authoritative commit step: validation, store write, ledger bookkeeping. */
  commitStep: (sent: unknown[]) => Promise<NexusSurfaceCommit>;
  /** Idempotent ledger write-off, including final validation failures inside commitStep. */
  onAbort?: () => void;
  /** 诊断面（S3.3.2）：留存/身份失败经此报告，不改写终态。 */
  onDiagnostic?: RunDiagnosticReporter;
}

export interface ScheduledRunPrepareContext {
  signal: AbortSignal;
  /**
   * 绑定调度内实际身份并发出唯一 start 事件（SPEC §5.4 与 fixtures/session-v1
   * oracle：start 取实际读取快照的基准，先于准入裁决与候选消息；排队取消不产生
   * start）。准备完成后未绑定的运行由任务侧以 prepared.identity 兜底补发。
   */
  bindBaseline: (identity: RunIdentity, surfaceRevision?: number) => void;
}

export type ScheduledRunPreparation = (ctx: ScheduledRunPrepareContext) => Promise<PreparedRun>;

/** Adapter-run lifecycle facade over the record created at enqueue time. */
class AdapterRunLifecycle implements RunLifecycle {
  constructor(readonly record: RunRecordHandle) {}

  start(): void {
    this.record.start();
  }

  bindIdentity(identity: RunIdentity): void {
    this.record.bindIdentity(identity);
  }

  fail(error?: unknown): void {
    this.record.fail(error);
  }

  cancel(): void {
    this.record.cancel();
  }

  dispose(): void {
    this.record.dispose();
  }
}

/**
 * One scheduled run: reserve queue slot + record, attach the handle, hand the
 * task to the per-surface queue. Capacity rejections happen before the record
 * exists, so a rejected request has no run record and no response claim.
 */
export function enqueueScheduledRun(
  host: { runManager: AgentRunManager; scheduler: SurfaceScheduler },
  spec: {
    kind: 'generate' | 'action';
    runId: string;
    surfaceId: string;
    prepare: ScheduledRunPreparation;
    actionId?: string;
  },
  options?: { signal?: AbortSignal },
): EnqueueOutcome {
  if (!host.scheduler.hasCapacity(spec.surfaceId)) {
    return {
      accepted: false,
      stage: 'capacity',
      code: 'RUN_CAPACITY_REJECTED',
      message: '同 surface 排队运行已达上限，请稍后重试',
    };
  }
  const record = new RunRecordHandle(
    { runId: spec.runId, surfaceId: spec.surfaceId, kind: spec.kind },
    host.runManager,
  );
  try {
    record.reserve();
  } catch (error) {
    record.dispose();
    return {
      accepted: false,
      stage: 'capacity',
      code: 'RUN_CAPACITY_REJECTED',
      message: `运行记录容量已满：${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const handle = new RuntimeRunHandle(
    {
      runId: spec.runId,
      surfaceId: spec.surfaceId,
      kind: spec.kind,
      manager: host.runManager,
      actionId: spec.actionId,
    },
    new AdapterRunLifecycle(record),
    options,
  );
  const queued = host.scheduler.enqueue(spec.surfaceId, () =>
    executeScheduledRun(handle, async (ctx) => {
      const prepared = await spec.prepare(ctx);
      const rawStep = prepared.commitStep;
      return {
        ...prepared,
        // 与自定义 run 共用提交身份、留存与终态失败隔离。
        commitStep: async (sent) =>
          record.commitValidated(await rawStep(sent), prepared.onDiagnostic),
      };
    }),
  );
  if (!queued.accepted) {
    // Capacity was probed in the same synchronous block; defensive release only.
    record.dispose();
    return {
      accepted: false,
      stage: 'capacity',
      code: 'RUN_CAPACITY_REJECTED',
      message: '同 surface 排队运行已达上限，请稍后重试',
    };
  }
  handle.attachQueueCancel(queued.cancel);
  return { accepted: true, run: handle };
}

/**
 * Wrap a raw custom `AgentRun` into the same scheduled task machinery. The managed run stays the record
 * owner. Without a scheduler the task starts on the next microtask; with one
 * (per-owner serialization for the send layer) it queues like any other run.
 */
export function startManagedRunTask(
  managed: ManagedAgentRun,
  options?: { signal?: AbortSignal },
  scheduler?: SurfaceScheduler,
): RuntimeRunHandle {
  const catalog = managed.sequence.registry.require(managed.sequence.catalogId);
  const handle = new RuntimeRunHandle(
    {
      runId: managed.runId,
      surfaceId: managed.sequence.surfaceId,
      kind: managed.sequence.kind,
      manager: managed.manager,
    },
    managed,
    options,
  );
  const preparation: ScheduledRunPreparation = async () => ({
    identity: {
      catalogId: managed.sequence.catalogId,
      catalogHash: createCatalogContractHash(catalog),
    },
    source: managed.source,
    sequence: managed.sequence,
    commitStep: (sent) => managed.commit(sent),
  });
  const task = () => executeScheduledRun(handle, preparation);
  if (scheduler) {
    if (!scheduler.hasCapacity(managed.sequence.surfaceId)) {
      const error = new RunTaskError(
        'RESOURCE_LIMIT_EXCEEDED',
        '同 surface 排队运行已达上限，请稍后重试',
      );
      handle.finishFailure(error, { canceled: false });
      return handle;
    }
    const queued = scheduler.enqueue(managed.sequence.surfaceId, task);
    if (queued.accepted) handle.attachQueueCancel(queued.cancel);
  } else {
    queueMicrotask(task);
  }
  return handle;
}

/**
 * Custom-run entry for the transport layer (S3.5.1): wrapping, owner-bound
 * scheduling and capacity admission live with the runtime, so the SSE sender
 * only claims the response and forwards Session events. Capacity rejection
 * throws before any response claim; the managed run is finalized exactly once
 * (`fail` converges record, host onError and host dispose).
 */
export function startCustomRunTask(
  run: AgentRun,
  options: {
    manager?: AgentRunManager;
    signal?: AbortSignal;
    onRunDiagnostic?: (diagnostic: NexusRunDiagnostic) => void;
  } = {},
): RuntimeRunHandle {
  let managed: ManagedAgentRun | undefined;
  try {
    managed = manageAgentRun(run, options.manager, options.signal, options.onRunDiagnostic);
    const scheduler = schedulerForOwner(managed.manager);
    if (!scheduler.hasCapacity(managed.sequence.surfaceId)) {
      throw new Error('同 surface 排队运行已达上限，请稍后重试');
    }
    managed.reserve();
    return startManagedRunTask(managed, { signal: options.signal }, scheduler);
  } catch (error) {
    try {
      if (managed) {
        try {
          managed.fail(error);
        } finally {
          // reserve 失败可能已终结 record；fail 的终态短路不能跳过宿主清理。
          managed.dispose();
        }
      } else {
        run.dispose?.();
      }
    } catch (cause) {
      reportRunDiagnostic(options.onRunDiagnostic, {
        runId: run.runId,
        surfaceId: run.sequence.surfaceId,
        stage: 'run-dispose',
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
    // 清理失败仅诊断，不覆盖容量/装配/准备阶段的原始错误。
    throw error;
  }
}

/** Uniform async iteration over sync or async message sources. */
function iterateSource(source: AsyncIterable<unknown> | Iterable<unknown>): AsyncIterator<unknown> {
  if (Symbol.asyncIterator in source) {
    return (source as AsyncIterable<unknown>)[Symbol.asyncIterator]();
  }
  const sync = (source as Iterable<unknown>)[Symbol.iterator]();
  return {
    next: async () => sync.next(),
    return: async (value?: unknown) =>
      sync.return ? sync.return(value) : { done: true, value: undefined },
  };
}

/**
 * The unified consumption task: preparation → start event → per-candidate
 * guard → final validation → commit. Cancel and queue capacity act before the
 * source factory or handler body; a store-confirmed commit always wins over a
 * racing cancellation (SPEC §6.3).
 */
async function executeScheduledRun(
  handle: RuntimeRunHandle,
  prepare: ScheduledRunPreparation,
): Promise<void> {
  let prepared: PreparedRun | undefined;
  // start 恰发一次（SPEC §5.4）：基准由调度内实际快照绑定，准入裁决与候选
  // 消费都不得早于它；排队取消的 run 不进任务体，天然没有 start。
  let baselineBound = false;
  const bindBaseline = (identity: RunIdentity, surfaceRevision?: number): void => {
    handle.lifecycle.bindIdentity?.(identity);
    if (baselineBound) return;
    baselineBound = true;
    handle.emitStart({
      type: 'start',
      sessionVersion: NEXUS_SESSION_VERSION,
      runId: handle.runId,
      surfaceId: handle.surfaceId,
      catalogId: identity.catalogId,
      contractVersion: CATALOG_CONTRACT_VERSION,
      catalogHash: identity.catalogHash,
      ...(surfaceRevision === undefined ? {} : { surfaceRevision }),
    });
  };
  try {
    handle.lifecycle.start();
    if (handle.isAborted()) {
      throw new RunTaskError('RUN_CANCELLED', '运行在启动前被取消');
    }
    prepared = await prepare({ signal: handle.abortSignal, bindBaseline });
    if (!baselineBound && prepared.identity) {
      bindBaseline(prepared.identity, prepared.surfaceRevision);
    }
    handle.attachSequence(prepared.sequence);

    const state = createAgentStreamState(prepared.sequence);
    let hasRoot = prepared.sequence.kind === 'action';
    let index = 0;
    // 手动迭代：取消检查先于每次拉取——排队取消不得唤醒 source 工厂，
    // 取消也不依赖下一条消息才被观察（SPEC §6.1）。
    const sourceIterator = iterateSource(prepared.source);
    let sourceExhausted = false;
    try {
      for (;;) {
        if (handle.isAborted()) {
          throw new RunTaskError('RUN_CANCELLED', '客户端断开，Agent 流已取消');
        }
        const step = await sourceIterator.next();
        if (step.done) {
          sourceExhausted = true;
          break;
        }
        if (handle.isAborted()) {
          // 拉取在飞期间被取消：丢弃迟到产出，由 finally 关闭源。
          throw new RunTaskError('RUN_CANCELLED', '客户端断开，Agent 流已取消');
        }
        const inspected = inspectCandidate(step.value, index, prepared.sequence, state);
        hasRoot = hasRoot || inspected.hasRootUpdate;
        handle.emitMessage(inspected.message);
        index += 1;
      }
    } finally {
      if (!sourceExhausted) {
        // 早退（拒绝/取消/异常）必须关闭宿主生成器：finally 清理不依赖 GC。
        try {
          await sourceIterator.return?.();
        } catch {
          // 扩展面关闭失败不影响运行终态归属。
        }
      }
    }
    finalizeCandidates(handle.sent.length, hasRoot, prepared.sequence, state);
    if (handle.isAborted()) {
      throw new RunTaskError('RUN_CANCELLED', '客户端断开，Agent 流已取消');
    }

    const commit = await prepared.commitStep(handle.sent);
    handle.emitDone(commit);
  } catch (error) {
    const failure =
      error instanceof RunTaskError
        ? error
        : error instanceof AgentCandidateError
          ? new RunTaskError('RUN_FAILED', error.message, {
              diagnostics: error.diagnostics,
              boundaryCode: error.boundaryCode,
            })
          : new Error(error instanceof Error ? error.message : String(error));
    const canceled =
      (failure instanceof RunTaskError && failure.code === 'RUN_CANCELLED') || handle.isAborted();
    if (prepared?.onAbort) {
      try {
        prepared.onAbort();
      } catch {
        // 扩展面的失败不改变运行终态归属（SPEC §6.3）。
      }
    }
    handle.finishFailure(failure, { canceled });
  } finally {
    handle.disposeLifecycle();
  }
}
