import type { AgentAction, AgentActionHandler } from './adapter';

export type TaskStatus = 'pending' | 'active' | 'completed';

/**
 * MVP 业务 Agent 样例：状态按 surface 隔离，只保存在当前 server 进程内。
 * 它证明 Adapter 可以接入真实业务状态，不表示生产级任务系统边界。
 */
export class TaskStateStore {
  private readonly statuses = new Map<string, TaskStatus>();

  initialize(surfaceId: string): TaskStatus {
    const current = this.statuses.get(surfaceId);
    if (current) return current;

    this.statuses.set(surfaceId, 'pending');
    while (this.statuses.size > 128) {
      const oldest = this.statuses.keys().next().value;
      if (oldest === undefined) break;
      this.statuses.delete(oldest);
    }
    return 'pending';
  }

  get(surfaceId: string): TaskStatus | undefined {
    return this.statuses.get(surfaceId);
  }

  start(surfaceId: string): TaskStatus {
    const current = this.initialize(surfaceId);
    if (current !== 'pending') {
      throw new Error(`任务不能从 ${current} 状态开始`);
    }
    this.statuses.set(surfaceId, 'active');
    return 'active';
  }

  complete(surfaceId: string): TaskStatus {
    const current = this.statuses.get(surfaceId);
    if (current !== 'active') {
      throw new Error(current ? `任务不能从 ${current} 状态完成` : '任务不存在或尚未开始');
    }
    this.statuses.set(surfaceId, 'completed');
    return 'completed';
  }
}

export const taskStateStore = new TaskStateStore();

function createTaskUpdate(
  surfaceId: string,
  status: string,
  actionLabel: string,
  nextAction: 'complete',
  disabled: boolean,
): unknown[] {
  return [
    {
      version: 'v0.9',
      updateDataModel: { surfaceId, path: '/status', value: status },
    },
    {
      version: 'v0.9',
      updateDataModel: { surfaceId, path: '/actionLabel', value: actionLabel },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          {
            id: 'button',
            component: 'TaskButton',
            label: { path: '/actionLabel' },
            disabled,
            action: {
              event: {
                name: nextAction,
                context: { taskId: { path: '/taskId' } },
              },
            },
          },
        ],
      },
    },
  ];
}

export function createTaskActionHandler(
  store: TaskStateStore = taskStateStore,
): AgentActionHandler {
  return (action: AgentAction) => {
    if (action.name === 'start') {
      store.start(action.surfaceId);
      return createTaskUpdate(action.surfaceId, '进行中', '完成任务', 'complete', false);
    }
    if (action.name === 'complete') {
      store.complete(action.surfaceId);
      return createTaskUpdate(action.surfaceId, '已完成', '已完成', 'complete', true);
    }
    throw new Error(`Task Agent 不支持 action: ${action.name}`);
  };
}
