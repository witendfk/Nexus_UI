import { DEFAULT_STORAGE_BUDGETS, jsonBytes, type AgentRuntimeBudgets } from './budgets';
import type { NexusSurfaceCommit } from '@nexus-ui/core';
import {
  NEXUS_SESSION_DIAGNOSTIC_LIMIT,
  NEXUS_SESSION_VERSION,
  type NexusSessionDiagnostic,
  type NexusSessionErrorCode,
} from '@nexus-ui/core';
import type { AgentSequenceOptions } from '../agent/agent-guard';
import type { AgentRunManager } from '../agent/run-manager';
import type { RunIdentity } from '../agent/run-lifecycle';

/** Session 错误码枚举（SPEC §5.4）；枚举定义在 core，wire 与运行共用一份。 */
export type RuntimeErrorCode = NexusSessionErrorCode;

export type CommitState = 'committed' | 'notCommitted' | 'unknown';

export type RuntimeRunEvent =
  | {
      type: 'start';
      sessionVersion: 1;
      runId: string;
      surfaceId: string;
      catalogId: string;
      contractVersion: number;
      catalogHash: string;
      /** Action runs carry the in-task baseline revision; generation runs create the surface. */
      surfaceRevision?: number;
    }
  | { type: 'message'; message: unknown }
  | { type: 'done'; commit: NexusSurfaceCommit }
  | {
      type: 'error';
      sessionVersion: typeof NEXUS_SESSION_VERSION;
      runId: string;
      surfaceId: string;
      code: RuntimeErrorCode;
      commitState: 'notCommitted' | 'unknown';
      message?: string;
      diagnostics?: readonly NexusSessionDiagnostic[];
      actionId?: string;
      beforeStart?: true;
    };

export type RunOutcome =
  | {
      terminal: 'succeeded';
      commitState: 'committed';
      commit: NexusSurfaceCommit;
      messages: unknown[];
    }
  | {
      terminal: 'failed';
      commitState: 'notCommitted' | 'unknown';
      code: RuntimeErrorCode;
      message?: string;
      diagnostics?: readonly unknown[];
      messages: unknown[];
    }
  | {
      terminal: 'canceled';
      commitState: 'notCommitted' | 'unknown';
      diagnostics?: readonly unknown[];
      messages: unknown[];
    };

/** The task-facing lifecycle surface; satisfied by record facades and ManagedAgentRun. */
export interface RunLifecycle {
  start(): void;
  bindIdentity?(identity: RunIdentity): void;
  fail(error?: unknown): void;
  cancel(): void;
  dispose(): void;
}

export type RuntimeRunListener = (event: RuntimeRunEvent) => void;

/**
 * One run handle per scheduled run. Events emitted before the first
 * subscriber are buffered (the window is the enqueue-to-subscribe tick of the
 * HTTP route); hosts must subscribe, iterate `events()`, await `result`, or
 * `dispose()` the handle — an abandoned running handle keeps consuming.
 * Terminal events are emitted exactly once and nothing follows a terminal.
 */
export class RuntimeRunHandle {
  readonly runId: string;
  readonly surfaceId: string;
  readonly kind: 'generate' | 'action';
  readonly actionId?: string;
  /** @internal Record owner; sendAgentRun verifies sender-provided managers against it. */
  readonly manager: AgentRunManager;
  readonly result: Promise<RunOutcome>;

  /** @internal Task-facing lifecycle; not part of the public handle contract. */
  readonly lifecycle: RunLifecycle;
  /** @internal Validated messages observed by the task (reference-shared with events). */
  readonly sent: unknown[] = [];

  private readonly controller = new AbortController();
  private readonly listeners = new Set<RuntimeRunListener>();
  private backlog: RuntimeRunEvent[] = [];
  private settled = false;
  private settle!: (outcome: RunOutcome) => void;
  private cancelQueued?: () => boolean;
  private errored = false;
  private sequenceValue?: AgentSequenceOptions;
  private terminalEmitted = false;
  private startEmitted = false;
  private lifecycleDisposed = false;
  private detachSignal?: () => void;
  private emitGate?: () => Promise<void>;
  private emitGateInterrupt?: () => void;
  private eventGate?: () => Promise<void>;
  private iteratorActive = false;
  private eventBudgets: {
    eventHighWaterMarkBytes: number;
    eventHighWaterMarkMessages: number;
    eventSlowConsumerTimeoutMs: number;
  } = { ...DEFAULT_STORAGE_BUDGETS };

  /** @internal Immutable per-run budget snapshot, installed before the task starts. */
  configureBudgets(budgets?: AgentRuntimeBudgets): void {
    this.eventBudgets = {
      eventHighWaterMarkBytes:
        budgets?.eventHighWaterMarkBytes ?? DEFAULT_STORAGE_BUDGETS.eventHighWaterMarkBytes,
      eventHighWaterMarkMessages:
        budgets?.eventHighWaterMarkMessages ?? DEFAULT_STORAGE_BUDGETS.eventHighWaterMarkMessages,
      eventSlowConsumerTimeoutMs:
        budgets?.eventSlowConsumerTimeoutMs ?? DEFAULT_STORAGE_BUDGETS.eventSlowConsumerTimeoutMs,
    };
  }

  /** @internal Await consumer capacity before pulling a new host candidate. */
  async waitForConsumer(): Promise<void> {
    await this.eventGate?.();
  }

  /** Guard sequence for diagnostics; set once the in-task preparation finished. */
  get sequence(): AgentSequenceOptions {
    if (!this.sequenceValue) {
      throw new Error('运行序列尚未在调度内准备完成');
    }
    return this.sequenceValue;
  }

  /** @internal Called by the task after preparation. */
  attachSequence(sequence: AgentSequenceOptions): void {
    this.sequenceValue = sequence;
  }

  constructor(
    spec: {
      runId: string;
      surfaceId: string;
      kind: 'generate' | 'action';
      manager: AgentRunManager;
      actionId?: string;
    },
    lifecycle: RunLifecycle,
    options?: { signal?: AbortSignal },
  ) {
    this.runId = spec.runId;
    this.surfaceId = spec.surfaceId;
    this.kind = spec.kind;
    this.actionId = spec.actionId;
    this.manager = spec.manager;
    this.lifecycle = lifecycle;
    this.result = new Promise<RunOutcome>((resolve) => {
      this.settle = resolve;
    });
    if (options?.signal) {
      if (options.signal.aborted) this.controller.abort();
      else {
        const signal = options.signal;
        const abort = () => this.cancel();
        signal.addEventListener('abort', abort, { once: true });
        this.detachSignal = () => signal.removeEventListener('abort', abort);
      }
    }
  }

  /** @internal Attached by the scheduler enqueue step for queued-run cancellation. */
  attachQueueCancel(cancel: () => boolean): void {
    this.cancelQueued = cancel;
    if (this.isAborted()) this.cancel();
  }

  /** @internal Task-only APIs below. */
  get abortSignal(): AbortSignal {
    return this.controller.signal;
  }

  isAborted(): boolean {
    return this.controller.signal.aborted;
  }

  /**
   * @internal 消费端背压闸门（S3.6.3）：安装后每个 message 事件在发出前等待
   * 闸门放行——SSE 发送层借此把 drain/慢消费暂停传导为任务侧的读取暂停，事件
   * 源按消费速率推进而非无限预取。onInterrupt 在 cancel() 时同步触发，保证
   * 取消不依赖消费推进即被观察（SPEC §6.1）；终态事件不受闸门约束。
   */
  setEmitGate(gate: (() => Promise<void>) | undefined, onInterrupt?: () => void): void {
    this.emitGate = gate;
    this.emitGateInterrupt = onInterrupt;
  }

  async emitMessage(message: unknown): Promise<void> {
    const gate = this.emitGate;
    if (gate) await gate();
    if (this.isAborted() || this.settled) throw new RunTaskError('RUN_CANCELLED', '运行已取消');
    this.sent.push(message);
    this.emit({ type: 'message', message });
  }

  emitStart(event: Extract<RuntimeRunEvent, { type: 'start' }>): void {
    if (this.startEmitted || this.terminalEmitted) return;
    this.startEmitted = true;
    this.emit(event);
  }

  emitDone(commit: NexusSurfaceCommit): void {
    this.settleOutcome({
      terminal: 'succeeded',
      commitState: 'committed',
      commit,
      messages: [...this.sent],
    });
    this.emit({ type: 'done', commit });
  }

  /** Commit facts come from the commit boundary, independently of cancellation. */
  emitFailure(error: RunTaskError | Error, stage: { canceled: boolean }): void {
    const commitState: 'notCommitted' | 'unknown' =
      error instanceof RunTaskError && error.code === 'RUN_COMMIT_UNKNOWN'
        ? 'unknown'
        : 'notCommitted';
    const diagnostics = normalizeRunDiagnostics(error);
    const message =
      error instanceof Error && error.message ? truncateDiagnostic(error.message) : undefined;
    if (stage.canceled) {
      this.settleOutcome({
        terminal: 'canceled',
        commitState,
        messages: [...this.sent],
        ...(diagnostics ? { diagnostics } : {}),
      });
      this.emitError({
        code: 'RUN_CANCELLED',
        commitState,
        ...(message ? { message } : {}),
        ...(diagnostics ? { diagnostics } : {}),
      });
      return;
    }
    const code = error instanceof RunTaskError ? error.code : 'RUN_FAILED';
    this.settleOutcome({
      terminal: 'failed',
      commitState,
      code,
      ...(message ? { message } : {}),
      ...(diagnostics ? { diagnostics } : {}),
      messages: [...this.sent],
    });
    this.emitError({
      code,
      commitState,
      ...(message ? { message } : {}),
      ...(diagnostics ? { diagnostics } : {}),
      ...(error instanceof RunTaskError && error.actionId ? { actionId: error.actionId } : {}),
    });
  }

  /** @internal Record/extension failures cannot prevent the local terminal. */
  finishFailure(error: RunTaskError | Error, stage: { canceled: boolean }): void {
    if (this.settled) return;
    const diagnostics: unknown[] = [];
    const phase = stage.canceled ? 'cancel' : 'fail';
    try {
      if (stage.canceled) this.lifecycle.cancel();
      else this.lifecycle.fail(error);
    } catch (cause) {
      diagnostics.push(lifecycleDiagnostic(phase, cause));
    }
    diagnostics.push(...this.disposeLifecycle());
    const failure =
      diagnostics.length === 0
        ? error
        : new RunTaskError(
            error instanceof RunTaskError ? error.code : 'RUN_FAILED',
            error.message,
            {
              ...(error instanceof RunTaskError
                ? { actionId: error.actionId, boundaryCode: error.boundaryCode }
                : {}),
              diagnostics: [
                ...(error instanceof RunTaskError ? (error.diagnostics ?? []) : []),
                ...diagnostics,
              ],
            },
          );
    this.failure = failure;
    this.emitFailure(failure, stage);
  }

  /** @internal Cleanup is attempted once, including when the record store throws. */
  disposeLifecycle(): readonly unknown[] {
    if (this.lifecycleDisposed) return [];
    this.lifecycleDisposed = true;
    try {
      this.lifecycle.dispose();
      return [];
    } catch (cause) {
      return [lifecycleDiagnostic('dispose', cause)];
    }
  }

  private emitError(
    event: Omit<
      Extract<RuntimeRunEvent, { type: 'error' }>,
      'type' | 'sessionVersion' | 'runId' | 'surfaceId'
    >,
  ): void {
    if (this.errored) return;
    this.errored = true;
    this.emit({
      type: 'error',
      sessionVersion: NEXUS_SESSION_VERSION,
      runId: this.runId,
      surfaceId: this.surfaceId,
      ...event,
      ...(this.actionId ? { actionId: this.actionId } : {}),
      ...(!this.startEmitted ? { beforeStart: true as const } : {}),
    });
  }

  private settleOutcome(outcome: RunOutcome): void {
    if (this.settled) return;
    this.settled = true;
    this.detachSignal?.();
    this.detachSignal = undefined;
    this.settle(outcome);
  }

  private emit(event: RuntimeRunEvent): void {
    // 终态守卫（SPEC §5.4）：终态之后不得再有任何事件；在飞拉取的迟到产出
    // 一律丢弃，避免直接订阅者看到 error 后的 message。
    if (this.terminalEmitted) return;
    if (event.type === 'done' || event.type === 'error') this.terminalEmitted = true;
    if (this.listeners.size === 0) {
      this.backlog.push(event);
      return;
    }
    for (const listener of [...this.listeners]) listener(event);
  }

  /** @internal Transport failure interrupts work without disguising it as user cancellation. */
  interrupt(error: RunTaskError): void {
    if (this.settled) return;
    this.controller.abort(error);
    this.emitGateInterrupt?.();
  }

  /** Host cancellation: queued runs are dropped before their task starts. */
  cancel(): void {
    if (this.settled) return;
    if (!this.isAborted()) this.controller.abort();
    // 背压闸门同步放行：取消不依赖消费推进才被观察（SPEC §6.1）。
    this.emitGateInterrupt?.();
    if (this.cancelQueued?.()) {
      this.finishFailure(new RunTaskError('RUN_CANCELLED', '运行在排队期间被取消'), {
        canceled: true,
      });
    }
    // The task's abort listener converges pre-commit cancellation immediately;
    // host operations retain bounded ownership until exit. In-flight commits
    // still await the store and a confirmed commit wins (SPEC §6.3).
  }

  dispose(): void {
    if (this.settled) {
      this.controller.abort();
      return;
    }
    // 与 cancel 同一收敛路径：排队 → 丢弃；运行中 → 只发取消信号，终态由
    // 调度任务收敛（评审 P1-1：句柄侧直接 fail 会把在途提交倒写为未提交）。
    this.cancel();
  }

  subscribe(listener: RuntimeRunListener): () => void {
    this.listeners.add(listener);
    const buffered = this.backlog;
    this.backlog = [];
    for (const event of buffered) listener(event);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Ordered event iteration; the iterator completes after the terminal event. */
  events(): AsyncIterable<RuntimeRunEvent> {
    if (this.iteratorActive) throw new Error('同一 run 只允许一个活动事件迭代器；先 return 再接续');
    this.iteratorActive = true;
    const queue: RuntimeRunEvent[] = [];
    let queuedBytes = 0;
    let wakeCapacity: (() => void) | undefined;
    const releaseCapacity = (): void => {
      wakeCapacity?.();
    };
    const gate = async (): Promise<void> => {
      if (closed || this.isAborted() || this.settled) return;
      if (
        queue.length < this.eventBudgets.eventHighWaterMarkMessages &&
        queuedBytes < this.eventBudgets.eventHighWaterMarkBytes
      )
        return;
      await new Promise<void>((resolve, reject) => {
        const release = (): void => {
          clearTimeout(timer);
          this.abortSignal.removeEventListener('abort', release);
          wakeCapacity = undefined;
          resolve();
        };
        const timer = setTimeout(() => {
          this.abortSignal.removeEventListener('abort', release);
          wakeCapacity = undefined;
          reject(new RunTaskError('AGENT_STREAM_ERROR', '非 HTTP 事件消费等待超时'));
        }, this.eventBudgets.eventSlowConsumerTimeoutMs);
        wakeCapacity = release;
        this.abortSignal.addEventListener('abort', release, { once: true });
        if (this.isAborted()) release();
      });
    };
    this.eventGate = gate;
    let notify: (() => void) | undefined;
    let terminalDelivered = false;
    let closed = false;
    const unsubscribe = this.subscribe((event) => {
      queue.push(event);
      queuedBytes += jsonBytes(event);
      const wake = notify;
      notify = undefined;
      wake?.();
    });
    const take = (): IteratorResult<RuntimeRunEvent> => {
      const value = queue.shift()!;
      queuedBytes -= jsonBytes(value);
      if (
        queue.length < this.eventBudgets.eventHighWaterMarkMessages &&
        queuedBytes < this.eventBudgets.eventHighWaterMarkBytes
      )
        releaseCapacity();
      if (value.type === 'done' || value.type === 'error') {
        terminalDelivered = true;
        finish();
      }
      return { done: false, value };
    };
    const finish = (): IteratorResult<RuntimeRunEvent> => {
      if (!closed) {
        closed = true;
        unsubscribe();
        this.iteratorActive = false;
        if (this.eventGate === gate) this.eventGate = undefined;
        releaseCapacity();
        // 未投递给调用者的事件仍属于同一条逻辑流。同步移交给句柄，供下个
        // 订阅者接续；旧迭代器清空后不能再次消费它们。
        this.backlog = [...queue.splice(0), ...this.backlog];
        const wake = notify;
        notify = undefined;
        wake?.();
      }
      return { done: true, value: undefined };
    };
    // 返回的迭代器对象自有 this，迟到的 next() 需要句柄上的终态标记。
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const handle: RuntimeRunHandle = this;
    return {
      [Symbol.asyncIterator]() {
        return {
          next: (): Promise<IteratorResult<RuntimeRunEvent>> => {
            if (closed) return Promise.resolve({ done: true, value: undefined });
            if (queue.length > 0) return Promise.resolve(take());
            // Late subscribers (or iterators created after the run ended) must
            // not wait for events that can never come.
            if (terminalDelivered || closed || handle.terminalEmitted || handle.settled) {
              return Promise.resolve(finish());
            }
            return new Promise<IteratorResult<RuntimeRunEvent>>((resolve) => {
              notify = () => resolve(queue.length > 0 ? take() : finish());
            });
          },
          return: (): Promise<IteratorResult<RuntimeRunEvent>> => Promise.resolve(finish()),
        };
      },
    };
  }

  /**
   * S3.2 compat view over the scheduled consumption: drains the same validated
   * messages the task emits and ends at the terminal. Direct `commit` no longer
   * drives validation or the store — the scheduled task already did — so it
   * only verifies the caller collected exactly this run's messages and returns
   * the fixed commit.
   */
  get source(): AsyncIterable<unknown> {
    return {
      [Symbol.asyncIterator]: () => {
        const iterator = this.events()[Symbol.asyncIterator]();
        return {
          next: async (): Promise<IteratorResult<unknown>> => {
            for (;;) {
              const step = await iterator.next();
              if (step.done) return { done: true, value: undefined };
              if (step.value.type === 'message') return { done: false, value: step.value.message };
              if (step.value.type === 'done') return { done: true, value: undefined };
              if (step.value.type === 'error') {
                throw this.failure ?? new Error(step.value.message ?? 'Agent 运行失败');
              }
            }
          },
          return: async (): Promise<IteratorResult<unknown>> => {
            await iterator.return?.();
            return { done: true, value: undefined };
          },
        };
      },
    };
  }

  /** @internal Set by the task so the compat commit can fail with the real error. */
  failure?: RunTaskError | Error;

  async commit(messages: unknown[]): Promise<NexusSurfaceCommit> {
    const outcome = await this.result;
    if (outcome.terminal === 'failed') {
      throw this.failure ?? new Error(outcome.message ?? 'Agent 运行失败');
    }
    if (outcome.terminal === 'canceled') {
      throw new Error('Agent 运行已取消，没有可确认的提交结果');
    }
    const same =
      messages.length === outcome.messages.length &&
      messages.every((message, index) => message === outcome.messages[index]);
    if (!same) {
      throw new Error('运行已由调度提交：直接提交仅接受本次运行实际产出的消息');
    }
    return outcome.commit;
  }
}

function lifecycleDiagnostic(phase: string, cause: unknown) {
  return {
    code: 'RUN_LIFECYCLE_ERROR',
    phase,
    message: (cause instanceof Error ? cause.message : String(cause)).slice(0, 512),
  };
}

function truncateDiagnostic(text: string): string {
  return text.length > NEXUS_SESSION_DIAGNOSTIC_LIMIT
    ? text.slice(0, NEXUS_SESSION_DIAGNOSTIC_LIMIT)
    : text;
}

/**
 * 结构化诊断（SPEC §5.4）：边界码（Protocol/Profile/Catalog/Policy 分类）与
 * guard/component 诊断合并为会话诊断条目，文本截断至共享上限；空集返回
 * undefined，wire 上不出现空数组。
 */
function normalizeRunDiagnostics(
  error: RunTaskError | Error,
): readonly NexusSessionDiagnostic[] | undefined {
  const boundaryCode = error instanceof RunTaskError ? error.boundaryCode : undefined;
  const raw = error instanceof RunTaskError ? error.diagnostics : undefined;
  if (boundaryCode === undefined && raw === undefined) return undefined;
  const entries: NexusSessionDiagnostic[] = [];
  if (boundaryCode !== undefined) {
    entries.push({ code: boundaryCode, message: truncateDiagnostic(error.message) });
  }
  for (const entry of (raw ?? []).slice(0, 64 - entries.length)) {
    entries.push(toSessionDiagnostic(entry, boundaryCode));
  }
  return entries.length > 0 ? entries : undefined;
}

function toSessionDiagnostic(
  entry: unknown,
  fallbackCode: string | undefined,
): NexusSessionDiagnostic {
  if (typeof entry !== 'object' || entry === null) {
    return { code: fallbackCode ?? 'PROTOCOL_INVALID', message: truncateDiagnostic(String(entry)) };
  }
  const record = entry as Record<string, unknown>;
  const message = typeof record.message === 'string' ? record.message : String(entry);
  const phase = typeof record.phase === 'string' ? record.phase : undefined;
  return {
    code:
      typeof record.code === 'string'
        ? record.code.slice(0, 128)
        : (fallbackCode ?? 'PROTOCOL_INVALID'),
    message: truncateDiagnostic(phase !== undefined ? `${phase}: ${message}` : message),
    ...(typeof record.path === 'string' ? { path: truncateDiagnostic(record.path) } : {}),
    ...(typeof record.dataPath === 'string'
      ? { dataPath: truncateDiagnostic(record.dataPath) }
      : {}),
  };
}

/** Structured task-level failure carrying the session error taxonomy. */
export class RunTaskError extends Error {
  readonly code: RuntimeErrorCode;
  readonly diagnostics?: readonly unknown[];
  readonly actionId?: string;
  readonly boundaryCode?: string;

  constructor(
    code: RuntimeErrorCode,
    message: string,
    extra?: {
      diagnostics?: readonly unknown[];
      actionId?: string;
      boundaryCode?: string;
    },
  ) {
    super(truncateDiagnostic(message));
    this.code = code;
    if (extra?.diagnostics)
      this.diagnostics = extra.diagnostics
        .slice(0, 64)
        .map((entry) => toSessionDiagnostic(entry, extra.boundaryCode));
    if (extra?.actionId) this.actionId = extra.actionId;
    if (extra?.boundaryCode) this.boundaryCode = extra.boundaryCode;
  }
}

/** Missing/invalid write confirmation cannot prove notCommitted (SPEC §6.3). */
export class UnknownCommitError extends RunTaskError {
  constructor(message: string) {
    super('RUN_COMMIT_UNKNOWN', message);
  }
}
