/**
 * Per-runtime, per-surface FIFO scheduler (S3.2, SPEC §6.1).
 *
 * Generation and action runs of the same surface share one queue and run
 * strictly serially — the queued task covers the whole chain from snapshot
 * read through admission, handler invocation and commit. Different surfaces
 * proceed concurrently; default runtime instances are isolated. Entrypoints
 * explicitly sharing a runManager reuse the same scheduler.
 *
 * Queue capacity and cancellation act before the task body starts, so a
 * canceled queued run never invokes a source factory or handler.
 */
export const DEFAULT_MAX_QUEUED_PER_SURFACE = 32;

export interface SurfaceSchedulerOptions {
  /** Positive safe integer; invalid values throw at construction. */
  maxQueuedPerSurface?: number;
}

export type SchedulerEnqueueResult =
  | { accepted: true; cancel: () => boolean }
  | { accepted: false; reason: 'capacity' };

interface QueuedTask {
  run: () => Promise<void>;
  canceled: boolean;
  started: boolean;
}

interface SurfaceQueue {
  queue: QueuedTask[];
  active: boolean;
}

export class SurfaceScheduler {
  private readonly maxQueuedPerSurface: number;
  private readonly surfaces = new Map<string, SurfaceQueue>();

  constructor(options: SurfaceSchedulerOptions = {}) {
    const value = options.maxQueuedPerSurface ?? DEFAULT_MAX_QUEUED_PER_SURFACE;
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`scheduler.maxQueuedPerSurface 必须为正安全整数，收到: ${String(value)}`);
    }
    this.maxQueuedPerSurface = value;
  }

  /** Synchronous capacity probe; caller must enqueue in the same tick. */
  hasCapacity(surfaceId: string): boolean {
    return this.pendingCount(surfaceId) < this.maxQueuedPerSurface;
  }

  pendingCount(surfaceId: string): number {
    return this.surfaces.get(surfaceId)?.queue.length ?? 0;
  }

  /** True while a task is running or queued for this surface (activity protection input). */
  isBusy(surfaceId: string): boolean {
    const surface = this.surfaces.get(surfaceId);
    return Boolean(surface && (surface.active || surface.queue.length > 0));
  }

  /**
   * Enqueue one task. The task never starts synchronously inside enqueue;
   * `cancel()` removes it before its first await and returns whether it was
   * still queued.
   */
  enqueue(surfaceId: string, task: () => Promise<void>): SchedulerEnqueueResult {
    if (!this.hasCapacity(surfaceId)) return { accepted: false, reason: 'capacity' };
    let surface = this.surfaces.get(surfaceId);
    if (!surface) {
      surface = { queue: [], active: false };
      this.surfaces.set(surfaceId, surface);
    }
    const queued: QueuedTask = { run: task, canceled: false, started: false };
    surface.queue.push(queued);
    if (!surface.active) {
      queueMicrotask(() => this.pump(surfaceId));
    }
    return {
      accepted: true,
      cancel: () => {
        if (queued.canceled || queued.started) return false;
        queued.canceled = true;
        const index = surface.queue.indexOf(queued);
        if (index !== -1) surface.queue.splice(index, 1);
        if (!surface.active && surface.queue.length === 0) {
          this.surfaces.delete(surfaceId);
        }
        return true;
      },
    };
  }

  private pump(surfaceId: string): void {
    const surface = this.surfaces.get(surfaceId);
    if (!surface || surface.active) return;
    surface.active = true;
    void (async () => {
      while (surface.queue.length > 0) {
        const task = surface.queue.shift();
        if (!task) continue;
        task.started = true;
        if (task.canceled) continue;
        try {
          await task.run();
        } catch {
          // Tasks own their failure paths; the scheduler never drops its slot on a throw.
        }
      }
      surface.active = false;
      // 排空后回收条目：generation 每次 mint 新 surfaceId，不回收则按运行数无界增长。
      if (surface.queue.length === 0) {
        this.surfaces.delete(surfaceId);
      }
    })();
  }
}
