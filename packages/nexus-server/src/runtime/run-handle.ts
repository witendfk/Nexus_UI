import type { NexusSurfaceCommit } from '@nexus-ui/core';
import type { AgentSequenceOptions } from '../agent/agent-guard';
import type { AgentRunManager } from '../agent/run-manager';
import type { RunIdentity } from '../agent/run-lifecycle';

/** Nexus session run-level error codes (SPEC §5.4); wire exposure lands with S3.4/S3.5. */
export type RuntimeErrorCode =
  | 'RUN_ADMISSION_REJECTED'
  | 'RUN_FAILED'
  | 'RUN_COMMIT_UNKNOWN'
  | 'RUN_CANCELLED'
  | 'RESOURCE_LIMIT_EXCEEDED'
  | 'AGENT_STREAM_ERROR';

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
      code: RuntimeErrorCode;
      commitState: 'notCommitted' | 'unknown';
      message?: string;
      diagnostics?: readonly unknown[];
      actionId?: string;
      boundaryCode?: string;
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
  private lifecycleDisposed = false;
  private detachSignal?: () => void;

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
    },
    lifecycle: RunLifecycle,
    options?: { signal?: AbortSignal },
  ) {
    this.runId = spec.runId;
    this.surfaceId = spec.surfaceId;
    this.kind = spec.kind;
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

  emitMessage(message: unknown): void {
    this.sent.push(message);
    this.emit({ type: 'message', message });
  }

  emitStart(event: Extract<RuntimeRunEvent, { type: 'start' }>): void {
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

  /**
   * S3.2 mapping (SPEC §6.3): failures report notCommitted — the in-memory
   * store throws only on deterministic rejections in this slice. Only a
   * cancellation racing an in-flight store write reports unknown, because the
   * write's outcome cannot be proven. S3.3 replaces this with the store
   * result contract.
   */
  emitFailure(
    error: RunTaskError | Error,
    stage: { committing: boolean; canceled: boolean },
  ): void {
    const commitState: 'notCommitted' | 'unknown' =
      stage.canceled && stage.committing ? 'unknown' : 'notCommitted';
    const diagnostics = error instanceof RunTaskError ? error.diagnostics : undefined;
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
        ...(error instanceof Error && error.message ? { message: error.message } : {}),
        ...(diagnostics ? { diagnostics } : {}),
      });
      return;
    }
    const code = error instanceof RunTaskError ? error.code : 'RUN_FAILED';
    this.settleOutcome({
      terminal: 'failed',
      commitState,
      code,
      ...(error.message ? { message: error.message } : {}),
      ...(error instanceof RunTaskError && error.diagnostics
        ? { diagnostics: error.diagnostics }
        : {}),
      messages: [...this.sent],
    });
    this.emitError({
      code,
      commitState,
      ...(error.message ? { message: error.message } : {}),
      ...(error instanceof RunTaskError && error.diagnostics
        ? { diagnostics: error.diagnostics }
        : {}),
      ...(error instanceof RunTaskError && error.actionId ? { actionId: error.actionId } : {}),
      ...(error instanceof RunTaskError && error.boundaryCode
        ? { boundaryCode: error.boundaryCode }
        : {}),
    });
  }

  /** @internal Record/extension failures cannot prevent the local terminal. */
  finishFailure(
    error: RunTaskError | Error,
    stage: { committing: boolean; canceled: boolean },
  ): void {
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

  private emitError(event: Omit<Extract<RuntimeRunEvent, { type: 'error' }>, 'type'>): void {
    if (this.errored) return;
    this.errored = true;
    this.emit({ type: 'error', ...event });
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

  /** Host cancellation: queued runs are dropped before their task starts. */
  cancel(): void {
    if (this.settled) return;
    if (!this.isAborted()) this.controller.abort();
    if (this.cancelQueued?.()) {
      this.finishFailure(new RunTaskError('RUN_CANCELLED', '运行在排队期间被取消'), {
        committing: false,
        canceled: true,
      });
    }
    // Running runs observe the aborted signal at their next checkpoint and the
    // task side converges the terminal: a store-confirmed commit wins (succeeded),
    // everything else settles canceled/unknown. The handle itself never rewrites
    // a terminal (SPEC §6.3).
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
    const queue: RuntimeRunEvent[] = [];
    let notify: (() => void) | undefined;
    let terminalDelivered = false;
    let closed = false;
    const unsubscribe = this.subscribe((event) => {
      queue.push(event);
      const wake = notify;
      notify = undefined;
      wake?.();
    });
    const take = (): IteratorResult<RuntimeRunEvent> => {
      const value = queue.shift()!;
      if (value.type === 'done' || value.type === 'error') terminalDelivered = true;
      return { done: false, value };
    };
    const finish = (): IteratorResult<RuntimeRunEvent> => {
      if (!closed) {
        closed = true;
        unsubscribe();
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
    super(message);
    this.code = code;
    if (extra?.diagnostics) this.diagnostics = extra.diagnostics;
    if (extra?.actionId) this.actionId = extra.actionId;
    if (extra?.boundaryCode) this.boundaryCode = extra.boundaryCode;
  }
}
