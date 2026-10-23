import type { AgentRunManager } from '../agent/run-manager';
import { SurfaceScheduler } from './surface-scheduler';

// The owner is the identity boundary shared by adapter and custom-run entrypoints.
// Weak keys do not keep a discarded runtime alive.
const schedulers = new WeakMap<AgentRunManager, SurfaceScheduler>();

export function schedulerForOwner(
  owner: AgentRunManager,
  configured?: SurfaceScheduler,
): SurfaceScheduler {
  const existing = schedulers.get(owner);
  if (existing) {
    if (configured && configured !== existing) {
      throw new Error('同一 runManager 只能绑定一个 scheduler，不能分裂运行调度所有权');
    }
    return existing;
  }
  const scheduler = configured ?? new SurfaceScheduler();
  schedulers.set(owner, scheduler);
  return scheduler;
}
