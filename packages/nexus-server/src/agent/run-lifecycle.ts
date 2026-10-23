import type { NexusSurfaceCommit } from '@nexus-ui/core';
import type { AgentMessageSource, AgentRun } from './adapter';
import { createCatalogContractHash } from './catalog-contract';
import { assertRunCommit, type AgentRunManager } from './run-manager';

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

  /** Validate against the bound identity, retain the result, finish succeeded. */
  async commitValidated(commit: NexusSurfaceCommit): Promise<NexusSurfaceCommit> {
    const fixed = assertRunCommit(commit, {
      id: this.runId,
      surfaceId: this.surfaceId,
      ...this.requireIdentity(),
    });
    // Never let an injected manager mutate the result that is returned/published.
    this.manager.recordCommit(this.runId, structuredClone(fixed));
    this.finish('succeeded');
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

  constructor(run: AgentRun, manager: AgentRunManager, signal?: AbortSignal) {
    this.run = run;
    this.signal = signal;
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
      const commit = await this.record.commitValidated(await this.run.commit(messages));
      return commit;
    } catch (error) {
      this.fail(error);
      throw error;
    } finally {
      this.dispose();
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
): ManagedAgentRun {
  if (run instanceof ManagedAgentRun) {
    if (manager !== undefined && manager !== run.manager) {
      throw new Error('sendAgentRun manager 必须与 adapter 的 runManager 所有者一致');
    }
    return run;
  }
  if (!manager) throw new Error('自定义 AgentRun 需要显式传入 manager（AgentRunManager）');
  return new ManagedAgentRun(run, manager, signal);
}
