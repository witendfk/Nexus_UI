import type { NexusSurfaceCommit } from '@nexus-ui/core';
import type { AgentMessageSource, AgentRun } from './adapter';
import { createCatalogContractHash } from './catalog-contract';
import { assertRunCommit, type AgentRunManager } from './run-manager';
import { UnknownCommitError, RunTaskError } from '../runtime/run-handle';
import {
  reportRunDiagnostic,
  type NexusRunDiagnostic,
  type RunDiagnosticReporter,
} from './run-diagnostic';

export interface RunIdentity {
  catalogId: string;
  catalogHash: string;
}

/**
 * Transport-neutral record lifecycle core (S3.2). The record (and therefore
 * queue capacity) is reserved at enqueue time, before any transport claims a
 * response; the catalog identity binds later, inside the scheduled task, from
 * the actually-read snapshot (SPEC §5.4: start binds the in-task baseline).
 * Normal source EOF still requires an explicit commit.
 */
export class RunRecordHandle {
  readonly runId: string;
  readonly surfaceId: string;
  readonly kind: AgentRun['sequence']['kind'];
  readonly manager: AgentRunManager;
  private reserved = false;
  private started = false;
  private terminal = false;
  private disposed = false;
  private identity?: RunIdentity;

  constructor(
    spec: { runId: string; surfaceId: string; kind: 'generate' | 'action' },
    manager: AgentRunManager,
  ) {
    if (typeof spec.runId !== 'string' || spec.runId === '') {
      throw new Error('AgentRun.runId 必须由运行创建方分配（非空字符串）');
    }
    this.runId = spec.runId;
    this.surfaceId = spec.surfaceId;
    this.kind = spec.kind;
    this.manager = manager;
  }

  /** Bind the fixed catalog identity from the in-task snapshot; binding once is final. */
  bindIdentity(identity: RunIdentity): void {
    if (this.identity) {
      if (
        this.identity.catalogId !== identity.catalogId ||
        this.identity.catalogHash !== identity.catalogHash
      ) {
        throw new Error('运行身份只能绑定一次，且不能改变');
      }
      return;
    }
    this.identity = identity;
  }

  requireIdentity(): RunIdentity {
    if (!this.identity) {
      throw new Error('运行身份尚未绑定：调度内快照读取完成前不能提交');
    }
    return this.identity;
  }

  /** Reserve capacity before a transport claims its response, without starting the run. */
  reserve(): void {
    if (this.terminal) throw new Error('Agent run 已终止，不能再次执行');
    if (this.reserved) return;
    try {
      this.manager.create({
        id: this.runId,
        surfaceId: this.surfaceId,
        kind: this.kind,
      });
      this.reserved = true;
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  start(): void {
    try {
      this.reserve();
      if (this.started) return;
      this.manager.transition(this.runId, 'running');
      this.started = true;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  /** Validate the raw commit against the bound identity; returns an isolated fixed copy. */
  assertFixed(commit: NexusSurfaceCommit): NexusSurfaceCommit {
    return assertRunCommit(commit, {
      id: this.runId,
      surfaceId: this.surfaceId,
      ...this.requireIdentity(),
    });
  }

  /** Retain the fixed result with the record owner (exactly-once, pre-terminal). */
  retain(fixed: NexusSurfaceCommit): void {
    // Never let an injected manager mutate the result that is returned/published.
    this.manager.recordCommit(this.runId, structuredClone(fixed));
  }

  /**
   * Success terminal without retention. Used when the store confirmed the UI
   * commit but the record owner failed to retain it (S3.3.2): the published
   * fact stands, the run is succeeded, and the query side reports 409.
   */
  finishSucceeded(): void {
    this.finish('succeeded');
  }

  /** Validate against the bound identity, retain the result, finish succeeded. */
  async commitValidated(
    commit: NexusSurfaceCommit,
    report?: RunDiagnosticReporter,
  ): Promise<NexusSurfaceCommit> {
    let fixed: NexusSurfaceCommit;
    try {
      fixed = this.assertFixed(commit);
    } catch (error) {
      report?.('commit-identity', errorMessage(error));
      throw new UnknownCommitError(`提交身份核对失败: ${errorMessage(error)}`);
    }
    try {
      this.retain(fixed);
    } catch (error) {
      report?.('record-commit', errorMessage(error));
    }
    try {
      this.finishSucceeded();
    } catch (error) {
      report?.('record-transition', errorMessage(error));
    }
    return fixed;
  }

  fail(error?: unknown): void {
    if (this.terminal) return;
    this.finish('failed', error);
  }

  cancel(): void {
    this.finish('canceled');
  }

  /** Terminal write-off of a never-finished run; safe to call after a terminal. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.finish('canceled');
  }

  isTerminal(): boolean {
    return this.terminal;
  }

  private finish(state: 'succeeded' | 'failed' | 'canceled', error?: unknown): void {
    if (this.terminal) return;
    this.terminal = true;
    if (this.reserved) {
      this.manager.transition(
        this.runId,
        state,
        error instanceof Error ? error.message : undefined,
      );
    }
  }
}

/** Transport-neutral record lifecycle. Normal source EOF still requires an explicit commit. */
export class ManagedAgentRun implements AgentRun {
  readonly sequence: AgentRun['sequence'];
  source: AgentMessageSource;
  readonly record: RunRecordHandle;
  private readonly run: AgentRun;
  private committing = false;
  private readonly signal?: AbortSignal;
  private readonly report: RunDiagnosticReporter;

  constructor(
    run: AgentRun,
    manager: AgentRunManager,
    signal?: AbortSignal,
    onDiagnostic?: (diagnostic: NexusRunDiagnostic) => void,
  ) {
    this.run = run;
    this.signal = signal;
    this.report = (stage, message) =>
      reportRunDiagnostic(onDiagnostic, {
        runId: run.runId,
        surfaceId: this.record.surfaceId,
        stage,
        message,
      });
    this.sequence = run.sequence;
    const catalog = run.sequence.registry.require(run.sequence.catalogId);
    this.record = new RunRecordHandle(
      { runId: run.runId, surfaceId: run.sequence.surfaceId, kind: run.sequence.kind },
      manager,
    );
    this.record.bindIdentity({
      catalogId: run.sequence.catalogId,
      catalogHash: createCatalogContractHash(catalog),
    });
    this.source = this.readSource();
  }

  private async *readSource(): AsyncGenerator<unknown> {
    this.start();
    try {
      yield* this.run.source;
    } catch (error) {
      if (this.signal?.aborted) this.cancel();
      else this.fail(error);
      throw error;
    }
    // EOF/iterator return alone is not a terminal: direct consumers must commit/onError/dispose.
  }

  get runId(): string {
    return this.record.runId;
  }

  get manager(): AgentRunManager {
    return this.record.manager;
  }

  /** Reserve capacity before a transport claims its response, without starting the source. */
  reserve(): void {
    this.record.reserve();
  }

  start(): void {
    this.record.start();
  }

  async commit(messages: unknown[]): Promise<NexusSurfaceCommit> {
    if (this.committing) throw new Error('Agent run 不能重复提交');
    this.start();
    this.committing = true;
    try {
      let raw: NexusSurfaceCommit;
      try {
        raw = await this.run.commit(messages);
      } catch (error) {
        // 自定义提交函数也可能已写入后失去确认，普通异常不能证明未提交。
        throw error instanceof RunTaskError ? error : new UnknownCommitError(errorMessage(error));
      }
      return await this.record.commitValidated(raw, this.report);
    } catch (error) {
      try {
        this.fail(error);
      } catch (cause) {
        this.report('record-transition', errorMessage(cause));
      }
      throw error;
    } finally {
      try {
        this.dispose();
      } catch (error) {
        this.report('run-dispose', errorMessage(error));
      }
    }
  }

  fail(error?: unknown): void {
    if (this.record.isTerminal()) return;
    try {
      this.record.fail(error);
    } finally {
      try {
        this.run.onError?.(error);
      } finally {
        this.dispose();
      }
    }
  }

  cancel(): void {
    try {
      this.record.cancel();
    } finally {
      this.dispose();
    }
  }

  onError(error?: unknown): void {
    this.fail(error);
  }

  private hostDisposed = false;

  dispose(): void {
    if (!this.record.isTerminal()) this.record.dispose();
    if (this.hostDisposed) return;
    this.hostDisposed = true;
    this.run.dispose?.();
  }
}

/** SDK runs retain their owner across transports; custom runs must supply one explicitly. */
export function manageAgentRun(
  run: AgentRun,
  manager?: AgentRunManager,
  signal?: AbortSignal,
  onDiagnostic?: (diagnostic: NexusRunDiagnostic) => void,
): ManagedAgentRun {
  if (run instanceof ManagedAgentRun) {
    if (manager !== undefined && manager !== run.manager) {
      throw new Error('sendAgentRun manager 必须与 adapter 的 runManager 所有者一致');
    }
    return run;
  }
  if (!manager) throw new Error('自定义 AgentRun 需要显式传入 manager（AgentRunManager）');
  return new ManagedAgentRun(run, manager, signal, onDiagnostic);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
