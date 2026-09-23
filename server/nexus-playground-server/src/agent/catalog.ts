import { CatalogRegistry } from '@nexus-ui/core';

export const BASIC_CATALOG = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
export const TASK_CATALOG = 'https://example.com/catalogs/nexus-task/v1';
export const WORKBENCH_CATALOG = 'https://example.com/catalogs/nexus-workbench/v1';

/**
 * MVP 仍只开放 Basic Catalog 的已实现子集。后续自定义 catalog 在这里注册，
 * Agent guard 便可以按 catalogId 校验组件边界。
 */
export const BASIC_CATALOG_COMPONENTS = [
  'Text',
  'TextField',
  'CheckBox',
  'ChoicePicker',
  'DateTimeInput',
  'Button',
  'Column',
  'Row',
  'List',
  'Tabs',
  'Image',
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

const taskComponentSchemas = {
  TaskSummary: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'description', 'status'],
    properties: {
      title: { type: 'string', dynamic: 'required' },
      description: { type: 'string', dynamic: 'required' },
      status: { type: 'string', dynamic: 'required' },
    },
  },
  TaskButton: {
    type: 'object',
    additionalProperties: false,
    required: ['label'],
    properties: {
      label: { type: 'string', dynamic: 'required' },
      disabled: { type: 'boolean', dynamic: 'allowed' },
    },
  },
} as const;

const workbenchComponentSchemas = {
  CustomerSummary: {
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
} as const;

export function getCatalogActions(
  catalogId: string,
  catalog?: { actions?: readonly string[] },
): readonly string[] {
  if (catalog?.actions !== undefined) return catalog.actions;
  if (catalogId === TASK_CATALOG) return TASK_CATALOG_ACTIONS;
  if (catalogId === WORKBENCH_CATALOG) return WORKBENCH_CATALOG_ACTIONS;
  return BASIC_CATALOG_ACTIONS;
}

export const agentCatalogRegistry = new CatalogRegistry([
  {
    catalogId: BASIC_CATALOG,
    components: BASIC_CATALOG_COMPONENTS,
    actions: BASIC_CATALOG_ACTIONS,
  },
  {
    catalogId: TASK_CATALOG,
    components: TASK_CATALOG_COMPONENTS,
    actions: TASK_CATALOG_ACTIONS,
    componentSchemas: taskComponentSchemas,
  },
  {
    catalogId: WORKBENCH_CATALOG,
    components: WORKBENCH_CATALOG_COMPONENTS,
    actions: WORKBENCH_CATALOG_ACTIONS,
    componentSchemas: workbenchComponentSchemas,
  },
]);
