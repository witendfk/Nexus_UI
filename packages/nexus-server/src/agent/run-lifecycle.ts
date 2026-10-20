import type { NexusSurfaceCommit } from '@nexus-ui/core';
import type { AgentMessageSource, AgentRun } from './adapter';
import { createCatalogContractHash } from './catalog-contract';
import { assertRunCommit, type AgentRunManager } from './run-manager';

/** Transport-neutral record lifecycle. Normal source EOF still requires an explicit commit. */
export class ManagedAgentRun implements AgentRun {
  readonly sequence: AgentRun['sequence'];
  source: AgentMessageSource;
  private reserved = false;
  private started = false;
  private terminal = false;
  private disposed = false;
  private committing = false;
  private readonly identity: {
    id: string;
    surfaceId: string;
    catalogId: string;
    catalogHash: string;
  };

  constructor(
    private readonly run: AgentRun,
    readonly manager: AgentRunManager,
    private readonly signal?: AbortSignal,
  ) {
    if (typeof run.runId !== 'string' || run.runId === '') {
      throw new Error('AgentRun.runId 必须由运行创建方分配（非空字符串）');
    }
    this.sequence = run.sequence;
    const catalog = run.sequence.registry.require(run.sequence.catalogId);
    this.identity = {
      id: run.runId,
      surfaceId: run.sequence.surfaceId,
      catalogId: run.sequence.catalogId,
      catalogHash: createCatalogContractHash(catalog),
    };
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
    return this.identity.id;
  }

  /** Reserve capacity before a transport claims its response, without starting the source. */
  reserve(): void {
    if (this.terminal) throw new Error('Agent run 已终止，不能再次执行');
    if (this.reserved) return;
    try {
      this.manager.create({
        id: this.runId,
        surfaceId: this.identity.surfaceId,
        kind: this.sequence.kind,
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

  async commit(messages: unknown[]): Promise<NexusSurfaceCommit> {
    if (this.committing) throw new Error('Agent run 不能重复提交');
    this.start();
    this.committing = true;
    try {
      const commit = assertRunCommit(await this.run.commit(messages), this.identity);
      // Never let an injected manager mutate the result that is returned/published.
      this.manager.recordCommit(this.runId, structuredClone(commit));
      this.finish('succeeded');
      return commit;
    } catch (error) {
      this.fail(error);
      throw error;
    } finally {
      this.dispose();
    }
  }

  fail(error?: unknown): void {
    if (this.terminal) return;
    try {
      this.finish('failed', error);
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
      this.finish('canceled');
    } finally {
      this.dispose();
    }
  }

  onError(error?: unknown): void {
    this.fail(error);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.finish('canceled');
    } finally {
      this.run.dispose?.();
    }
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
