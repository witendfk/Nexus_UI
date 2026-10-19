import {
  CatalogRegistry,
  standardCatalogComponentDeclarations,
  type CatalogComponentDeclaration,
} from '@nexus-ui/core';

/** Google A2UI v0.9 官方 Basic Catalog 身份；Nexus 当前不注册该完整 Catalog。 */
export const OFFICIAL_BASIC_CATALOG = 'https://a2ui.org/specification/v0_9/basic_catalog.json';

/** Nexus Basic Task Profile 的稳定宿主身份。它可以包含 Nexus 场景扩展（如 disabled）。 */
export const NEXUS_BASIC_TASK_CATALOG = 'https://example.com/catalogs/nexus-basic-task/v1';

/** P14-b 前使用的错误 URL；仅用于兼容历史 surface 记录。 */
export const LEGACY_BASIC_TASK_CATALOG =
  'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

/** Backward-compatible internal alias. New code should use NEXUS_BASIC_TASK_CATALOG. */
export const BASIC_CATALOG = NEXUS_BASIC_TASK_CATALOG;
export const TASK_CATALOG = 'https://example.com/catalogs/nexus-task/v1';
export const WORKBENCH_CATALOG = 'https://example.com/catalogs/nexus-workbench/v1';

/**
 * MVP 仍只开放 Nexus Basic Task Profile 的 Basic-like 子集。标准组件声明
 * 复用 SDK 提供的同型声明；TaskSummary/TaskButton/CustomerSummary 为宿主
 * 自定义组件，随 Catalog v2 显式声明能力边界。
 */
export const BASIC_CATALOG_COMPONENTS = [
  'Text',
  'TextField',
  'CheckBox',
  'ChoicePicker',
  'Slider',
  'DateTimeInput',
  'Button',
  'Column',
  'Row',
  'List',
  'Tabs',
  'Image',
  'Video',
  'AudioPlayer',
  'Card',
  'Icon',
  'Divider',
] as const;

export const TASK_CATALOG_COMPONENTS = ['TaskSummary', 'TaskButton'] as const;
export const WORKBENCH_CATALOG_COMPONENTS = [
  'CustomerSummary',
  'Text',
  'TextField',
  'ChoicePicker',
  'DateTimeInput',
  'Button',
  'Column',
  'Row',
  'Divider',
] as const;
export const BASIC_CATALOG_ACTIONS = ['call', 'search', 'submit'] as const;
export const TASK_CATALOG_ACTIONS = ['start', 'complete'] as const;
export const WORKBENCH_CATALOG_ACTIONS = ['submit'] as const;

const standard = standardCatalogComponentDeclarations();

const taskSummary: CatalogComponentDeclaration = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'description', 'status'],
    properties: {
      title: { type: 'string', dynamic: 'required' },
      description: { type: 'string', dynamic: 'required' },
      status: { type: 'string', dynamic: 'required' },
    },
  },
  origin: 'host-extension',
};

const taskButton: CatalogComponentDeclaration = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['label'],
    properties: {
      label: { type: 'string', dynamic: 'required' },
      disabled: { type: 'boolean', dynamic: 'allowed' },
    },
  },
  action: { required: true },
  origin: 'host-extension',
};

const customerSummary: CatalogComponentDeclaration = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['customerName', 'company', 'owner', 'status', 'recentNote'],
    properties: {
      customerName: { type: 'string', dynamic: 'required' },
      company: { type: 'string', dynamic: 'required' },
      owner: { type: 'string', dynamic: 'required' },
      status: { type: 'string', dynamic: 'required' },
      recentNote: { type: 'string', dynamic: 'required' },
    },
  },
  origin: 'host-extension',
};

/** 与演示 Agent 真实生成的 action context 一一对应的参数 schema。 */
const submitWorkbenchParamSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['taskTitle', 'priority', 'reminderAt', 'customerId', 'customerName'],
  properties: {
    taskTitle: { type: 'string' },
    // 形状仅约束「字符串数组」；恰选其一与取值合法性是演示 Policy 的业务规则
    priority: { type: 'array', items: { type: 'string' } },
    reminderAt: { type: 'string' },
    customerId: { type: 'string' },
    customerName: { type: 'string' },
  },
} as const;

export function getCatalogActions(
  catalogId: string,
  catalog?: { actions?: readonly string[] },
): readonly string[] {
  if (catalog?.actions !== undefined) return catalog.actions;
  if (catalogId === NEXUS_BASIC_TASK_CATALOG || catalogId === LEGACY_BASIC_TASK_CATALOG) {
    return BASIC_CATALOG_ACTIONS;
  }
  if (catalogId === TASK_CATALOG) return TASK_CATALOG_ACTIONS;
  if (catalogId === WORKBENCH_CATALOG) return WORKBENCH_CATALOG_ACTIONS;
  return BASIC_CATALOG_ACTIONS;
}

/** Turn pre-P14-b stored catalog IDs into the canonical Nexus profile ID. */
export function normalizeLegacyBasicCatalog(catalogId: string): string {
  return catalogId === LEGACY_BASIC_TASK_CATALOG ? NEXUS_BASIC_TASK_CATALOG : catalogId;
}
/** Explicitly reject the official Basic identity unless Nexus later registers a conformant catalog. */
export function isOfficialBasicCatalog(catalogId: string): boolean {
  return catalogId === OFFICIAL_BASIC_CATALOG;
}

export const agentCatalogRegistry = new CatalogRegistry([
  {
    catalogId: BASIC_CATALOG,
    components: standard,
    actions: [
      {
        name: 'call',
        sources: ['Button'],
        paramSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['phone'],
          properties: { phone: { type: 'string' } },
        },
      },
      {
        name: 'search',
        sources: ['Button'],
        paramSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['keyword'],
          properties: { keyword: { type: 'string' } },
        },
      },
      {
        name: 'submit',
        sources: ['Button'],
        paramSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'subscribed'],
          properties: { name: { type: 'string' }, subscribed: { type: 'boolean' } },
        },
      },
    ],
  },
  {
    catalogId: TASK_CATALOG,
    components: { TaskSummary: taskSummary, TaskButton: taskButton },
    actions: [
      {
        name: 'start',
        sources: ['TaskButton'],
        paramSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['taskId'],
          properties: { taskId: { type: 'string' } },
        },
      },
      {
        name: 'complete',
        sources: ['TaskButton'],
        paramSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['taskId'],
          properties: { taskId: { type: 'string' } },
        },
      },
    ],
  },
  {
    catalogId: WORKBENCH_CATALOG,
    components: {
      CustomerSummary: customerSummary,
      Text: standard.Text,
      TextField: { ...standard.TextField, checks: { enabled: false } },
      ChoicePicker: standard.ChoicePicker,
      DateTimeInput: standard.DateTimeInput,
      Button: { ...standard.Button, action: { required: true }, checks: { enabled: false } },
      Column: standard.Column,
      Row: standard.Row,
      Divider: standard.Divider,
    },
    actions: [{ name: 'submit', sources: ['Button'], paramSchema: submitWorkbenchParamSchema }],
  },
]);
