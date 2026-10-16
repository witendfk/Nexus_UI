import { BASIC_CATALOG, TASK_CATALOG, WORKBENCH_CATALOG } from './catalog';

export { BASIC_CATALOG };
const AVATAR = 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop';

/**
 * 第一条 Agent 线的确定性 mock 输出。
 *
 * 无 LLM key 或演示链路使用该 fallback，用于锁死传输、渲染和 action 回流契约。
 * surfaceId 由服务端生成，避免客户端重复点击生成时撞上 createSurface 的生命周期校验。
 */
export function createContactFixture(surfaceId: string): unknown[] {
  return [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId,
        catalogId: BASIC_CATALOG,
        theme: { primaryColor: '#4a90d9' },
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Card', child: 'col' },
          {
            id: 'col',
            component: 'Column',
            children: ['avatar', 'name', 'role', 'divider', 'phoneRow', 'actions'],
            align: 'center',
          },
        ],
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          {
            id: 'avatar',
            component: 'Image',
            url: { path: '/avatar' },
            variant: 'avatar',
            fit: 'cover',
          },
          { id: 'name', component: 'Text', text: { path: '/name' }, variant: 'h2' },
          { id: 'role', component: 'Text', text: { path: '/role' }, variant: 'body' },
        ],
      },
    },
    {
      version: 'v0.9',
      updateDataModel: {
        surfaceId,
        value: {
          avatar: AVATAR,
          name: 'David Park',
          role: 'Engineering Manager',
          phone: '+1 (555) 234-5678',
        },
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          { id: 'divider', component: 'Divider' },
          { id: 'phoneIcon', component: 'Icon', name: 'phone' },
          { id: 'phoneText', component: 'Text', text: { path: '/phone' }, variant: 'body' },
          {
            id: 'phoneRow',
            component: 'Row',
            children: ['phoneIcon', 'phoneText'],
            align: 'center',
          },
          { id: 'actions', component: 'Row', children: ['callBtn'] },
          { id: 'callBtnText', component: 'Text', text: '联系' },
          {
            id: 'callBtn',
            component: 'Button',
            child: 'callBtnText',
            action: {
              event: {
                name: 'call',
                context: { phone: { path: '/phone' } },
              },
            },
          },
        ],
      },
    },
  ];
}

/** 用户点击 action 后，对同一 surface 返回数据和组件的原地更新。 */
export function createActionResponse(surfaceId: string): unknown[] {
  return [
    {
      version: 'v0.9',
      updateDataModel: {
        surfaceId,
        path: '/status',
        value: '联系请求已发送',
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          {
            id: 'col',
            component: 'Column',
            children: ['avatar', 'name', 'role', 'statusText', 'divider', 'phoneRow', 'actions'],
            align: 'center',
          },
          {
            id: 'statusText',
            component: 'Text',
            text: { path: '/status' },
            variant: 'caption',
          },
        ],
      },
    },
  ];
}

/** 搜索 action 的确定性响应，用于验收 TextField 双向绑定回流。 */
export function createSearchActionResponse(
  surfaceId: string,
  context: Record<string, unknown>,
): unknown[] {
  const raw = context.keyword ?? context.query ?? context.value;
  const keyword = raw === undefined || raw === null ? '' : String(raw);
  return [
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          {
            id: 'searchResult',
            component: 'Text',
            text: `搜索：${keyword || '（空关键词）'}`,
            variant: 'body',
          },
        ],
      },
    },
  ];
}

/** 提交 action 的确定性响应，用于验收 TextField + CheckBox 的表单回流。 */
export function createSubmitActionResponse(
  surfaceId: string,
  context: Record<string, unknown>,
): unknown[] {
  const rawName = context.name ?? context.keyword ?? context.value;
  const name = rawName === undefined || rawName === null ? '' : String(rawName);
  const subscribed = context.subscribed === true;
  return [
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          {
            id: 'submitResult',
            component: 'Text',
            text: `已提交：name=${name || '（空）'}，subscribed=${subscribed}`,
            variant: 'body',
          },
        ],
      },
    },
  ];
}

/** Task catalog 的确定性输出，用于验收自定义组件端到端链路。 */
export function createTaskFixture(surfaceId: string): unknown[] {
  return [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId,
        catalogId: TASK_CATALOG,
        theme: { primaryColor: '#2563eb' },
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          {
            id: 'root',
            component: 'TaskSummary',
            title: { path: '/title' },
            description: { path: '/description' },
            status: { path: '/status' },
            children: ['button'],
          },
        ],
      },
    },
    {
      version: 'v0.9',
      updateDataModel: {
        surfaceId,
        value: {
          title: '接入自定义 Catalog',
          description: 'TaskSummary 与 TaskButton 走同一套 A2UI 消息链路。',
          status: '待处理',
          actionLabel: '开始任务',
          taskId: 'task-001',
        },
      },
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
            action: {
              event: {
                name: 'start',
                context: { taskId: { path: '/taskId' } },
              },
            },
          },
        ],
      },
    },
  ];
}

/** Workbench catalog 的确定性输出，用于证明宿主 App 内嵌 Agent Task Surface 的业务闭环。 */
export function createWorkbenchFixture(surfaceId: string): unknown[] {
  return [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId,
        catalogId: WORKBENCH_CATALOG,
        theme: { primaryColor: '#2563eb' },
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          {
            id: 'root',
            component: 'Column',
            children: [
              'customer',
              'taskTitle',
              'priority',
              'reminderAt',
              'submitButton',
              'submitResult',
            ],
          },
          {
            id: 'customer',
            component: 'CustomerSummary',
            customerName: { path: '/customer/customerName' },
            company: { path: '/customer/company' },
            owner: { path: '/customer/owner' },
            status: { path: '/status' },
            recentNote: { path: '/customer/recentNote' },
          },
        ],
      },
    },
    {
      version: 'v0.9',
      updateDataModel: {
        surfaceId,
        value: {
          customer: {
            customerId: 'customer-1024',
            customerName: '华云科技',
            company: 'Nexus Enterprise Buyer',
            owner: 'Linda',
            recentNote: '上次会议确认希望补齐任务自动化能力',
          },
          status: '待跟进',
          taskTitle: '',
          priority: ['normal'],
          reminderAt: '',
          actionLabel: '创建跟进任务',
          result: '等待提交',
        },
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          {
            id: 'taskTitle',
            component: 'TextField',
            label: '跟进任务',
            value: { path: '/taskTitle' },
            variant: 'shortText',
          },
          {
            id: 'priority',
            component: 'ChoicePicker',
            label: '优先级',
            variant: 'mutuallyExclusive',
            options: [
              { label: '高', value: 'high' },
              { label: '普通', value: 'normal' },
              { label: '低', value: 'low' },
            ],
            value: { path: '/priority' },
            displayStyle: 'chips',
          },
          {
            id: 'reminderAt',
            component: 'DateTimeInput',
            label: '提醒时间',
            value: { path: '/reminderAt' },
            enableDate: true,
            enableTime: true,
          },
          {
            id: 'submitLabel',
            component: 'Text',
            text: { path: '/actionLabel' },
            variant: 'body',
          },
          {
            id: 'submitButton',
            component: 'Button',
            child: 'submitLabel',
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
