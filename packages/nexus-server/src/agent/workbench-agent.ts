import type { AgentAction, AgentActionHandler } from './adapter';

interface WorkbenchTask {
  readonly id: string;
  readonly title: string;
  readonly priority: 'high' | 'normal' | 'low';
  readonly reminderAt: string;
}

/**
 * Workbench demo 的进程内 CRM 边界。真实宿主应把 create() 替换为
 * CRM / OA 调用，并把权限、审计、幂等和租户隔离放在同一层。
 */
export class WorkbenchTaskStore {
  private readonly tasks = new Map<string, WorkbenchTask>();
  private sequence = 0;

  initialize(surfaceId: string): void {
    this.tasks.set(
      surfaceId,
      this.tasks.get(surfaceId) ?? { id: '', title: '', priority: 'normal', reminderAt: '' },
    );
  }

  get(surfaceId: string): WorkbenchTask | undefined {
    return this.tasks.get(surfaceId);
  }

  create(
    surfaceId: string,
    title: string,
    priority: WorkbenchTask['priority'],
    reminderAt: string,
  ): WorkbenchTask {
    const current = this.tasks.get(surfaceId);
    if (current?.id) throw new Error('该客户的跟进任务已创建，不能重复提交');

    this.sequence += 1;
    const task: WorkbenchTask = {
      id: `followup-${String(this.sequence).padStart(4, '0')}`,
      title,
      priority,
      reminderAt,
    };
    this.tasks.set(surfaceId, task);
    return task;
  }
}

export const workbenchTaskStore = new WorkbenchTaskStore();

function readText(context: Record<string, unknown>, key: string): string {
  const value = context[key];
  return value === undefined || value === null ? '' : String(value).trim();
}

const PRIORITY_LABELS: Record<WorkbenchTask['priority'], string> = {
  high: '高',
  normal: '普通',
  low: '低',
};

function readPriority(context: Record<string, unknown>): WorkbenchTask['priority'] {
  const value = context.priority;
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    !value.every((item) => item === 'high' || item === 'normal' || item === 'low')
  ) {
    throw new Error('请选择有效的任务优先级');
  }
  return value[0];
}

function normalizeReminderAt(value: string): string {
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match) return value;
  return `${match[1]}T${match[2]}:${match[3]}:${match[4] ?? '00'}${match[5] ?? ''}`;
}

function readReminderAt(context: Record<string, unknown>): string {
  const value = readText(context, 'reminderAt');
  if (!value) throw new Error('请选择提醒时间');

  const normalized = normalizeReminderAt(value);
  if (Number.isNaN(new Date(normalized).getTime())) {
    throw new Error('请输入有效的提醒时间');
  }
  return normalized;
}

function createWorkbenchSubmitResponse(surfaceId: string, task: WorkbenchTask): unknown[] {
  const result = `任务已创建：${task.id} · ${task.title} · 优先级：${
    PRIORITY_LABELS[task.priority]
  } · 提醒时间：${task.reminderAt}`;
  return [
    {
      version: 'v0.9',
      updateDataModel: { surfaceId, path: '/status', value: '任务已创建' },
    },
    {
      version: 'v0.9',
      updateDataModel: { surfaceId, path: '/actionLabel', value: '任务已创建' },
    },
    {
      version: 'v0.9',
      updateDataModel: { surfaceId, path: '/result', value: result },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          {
            id: 'submitButton',
            component: 'Button',
            child: 'submitLabel',
            disabled: true,
            action: {
              event: {
                name: 'submit',
                context: {
                  taskTitle: { path: '/taskTitle' },
                  priority: { path: '/priority' },
                  reminderAt: { path: '/reminderAt' },
                  customerId: { path: '/customer/customerId' },
                  customerName: { path: '/customer/customerName' },
                },
              },
            },
          },
          {
            id: 'submitLabel',
            component: 'Text',
            text: { path: '/actionLabel' },
            variant: 'body',
          },
          {
            id: 'submitResult',
            component: 'Text',
            text: { path: '/result' },
            variant: 'body',
          },
        ],
      },
    },
  ];
}

export function createWorkbenchActionHandler(
  store: WorkbenchTaskStore = workbenchTaskStore,
): AgentActionHandler {
  return (action: AgentAction) => {
    if (action.name !== 'submit') throw new Error(`Workbench Agent 不支持 action: ${action.name}`);

    const taskTitle = readText(action.context, 'taskTitle');
    if (!taskTitle) throw new Error('请输入跟进任务标题');

    const customerId = readText(action.context, 'customerId');
    if (!customerId) throw new Error('客户上下文缺失，无法创建跟进任务');

    const priority = readPriority(action.context);
    const reminderAt = readReminderAt(action.context);
    const task = store.create(action.surfaceId, taskTitle, priority, reminderAt);
    return createWorkbenchSubmitResponse(action.surfaceId, task);
  };
}
