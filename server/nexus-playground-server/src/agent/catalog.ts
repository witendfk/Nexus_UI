import { CatalogRegistry } from '@nexus-ui/core';

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
 * MVP 仍只开放 Nexus Basic Task Profile 的 Basic-like 子集。后续自定义 catalog
 * 在这里注册，Agent guard 便可以按 catalogId 校验组件边界。
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

const customerSummarySchema = {
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

const basicComponentSchemas = {
  Image: {
    type: 'object',
    additionalProperties: false,
    required: ['url'],
    properties: {
      url: { type: 'string', dynamic: 'allowed' },
      description: { type: 'string', dynamic: 'allowed' },
      fit: { type: 'string', enum: ['cover', 'contain'] },
      variant: { type: 'string', enum: ['avatar'] },
    },
  },
  Video: {
    type: 'object',
    additionalProperties: false,
    required: ['url'],
    properties: { url: { type: 'string', dynamic: 'allowed' } },
  },
  AudioPlayer: {
    type: 'object',
    additionalProperties: false,
    required: ['url'],
    properties: {
      url: { type: 'string', dynamic: 'allowed' },
      description: { type: 'string', dynamic: 'allowed' },
    },
  },
  Text: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string', dynamic: 'allowed' },
      variant: {
        type: 'string',
        enum: ['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body'],
      },
    },
  },
  TextField: {
    type: 'object',
    additionalProperties: false,
    properties: {
      label: { type: 'string', dynamic: 'allowed' },
      value: { type: 'string', dynamic: 'required' },
      variant: { type: 'string', enum: ['longText', 'number', 'shortText', 'obscured'] },
      validationRegexp: { type: 'string', maxLength: 256 },
    },
  },
  CheckBox: {
    type: 'object',
    additionalProperties: false,
    properties: {
      label: { type: 'string', dynamic: 'allowed' },
      value: { type: 'boolean', dynamic: 'required' },
    },
  },
  ChoicePicker: {
    type: 'object',
    additionalProperties: false,
    properties: {
      label: { type: 'string', dynamic: 'allowed' },
      variant: { type: 'string', enum: ['multipleSelection', 'mutuallyExclusive'] },
      options: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            label: { type: 'string', dynamic: 'allowed' },
            value: { type: 'string', minLength: 1 },
          },
        },
      },
      value: { type: 'array', dynamic: 'required' },
      displayStyle: { type: 'string', enum: ['checkbox', 'chips'] },
      filterable: { type: 'boolean' },
    },
  },
  Slider: {
    type: 'object',
    additionalProperties: false,
    properties: {
      label: { type: 'string', dynamic: 'allowed' },
      min: { type: 'number', dynamic: 'forbidden' },
      max: { type: 'number', dynamic: 'forbidden' },
      value: { type: 'number', dynamic: 'required' },
    },
  },
  Button: {
    type: 'object',
    additionalProperties: false,
    properties: {
      variant: { type: 'string', enum: ['default', 'primary', 'borderless'] },
      disabled: { type: 'boolean', dynamic: 'forbidden', origin: 'nexus-extension' },
    },
  },
  DateTimeInput: {
    type: 'object',
    additionalProperties: false,
    properties: {
      label: { type: 'string', dynamic: 'allowed' },
      value: { type: 'string', dynamic: 'required' },
      enableDate: { type: 'boolean' },
      enableTime: { type: 'boolean' },
      min: { type: 'string', dynamic: 'allowed' },
      max: { type: 'string', dynamic: 'allowed' },
    },
  },
} as const;

const workbenchComponentSchemas = {
  Text: basicComponentSchemas.Text,
  TextField: basicComponentSchemas.TextField,
  ChoicePicker: basicComponentSchemas.ChoicePicker,
  DateTimeInput: basicComponentSchemas.DateTimeInput,
  Button: basicComponentSchemas.Button,
  ...customerSummarySchema,
} as const;

const basicCheckPolicy = {
  enabled: true,
  functions: ['required', 'regex', 'length', 'numeric', 'email'],
  maxRules: 8,
  maxMessageLength: 200,
  maxPatternLength: 256,
} as const;

const basicComponentPolicies = {
  Text: {
    origin: 'official-basic',
    fields: {
      text: { binding: 'allowed', origin: 'official-basic' },
      variant: { binding: 'forbidden', origin: 'official-basic' },
    },
    action: { allowed: false },
  },
  Image: {
    origin: 'official-basic',
    fields: {
      url: { binding: 'allowed', origin: 'official-basic' },
      description: { binding: 'allowed', origin: 'official-basic' },
      fit: { binding: 'forbidden', origin: 'official-basic' },
      variant: { binding: 'forbidden', origin: 'official-basic' },
    },
    action: { allowed: false },
  },
  Video: {
    origin: 'official-basic',
    fields: { url: { binding: 'allowed', origin: 'official-basic' } },
    action: { allowed: false },
  },
  AudioPlayer: {
    origin: 'official-basic',
    fields: {
      url: { binding: 'allowed', origin: 'official-basic' },
      description: { binding: 'allowed', origin: 'official-basic' },
    },
    action: { allowed: false },
  },
  TextField: {
    origin: 'official-basic',
    fields: {
      label: { binding: 'allowed', origin: 'official-basic' },
      value: { binding: 'required', origin: 'official-basic' },
      variant: { binding: 'forbidden', origin: 'official-basic' },
      validationRegexp: { binding: 'forbidden', origin: 'official-basic' },
    },
    action: { allowed: false },
    checks: basicCheckPolicy,
  },
  CheckBox: {
    origin: 'official-basic',
    fields: {
      label: { binding: 'allowed', origin: 'official-basic' },
      value: { binding: 'required', origin: 'official-basic' },
    },
    action: { allowed: false },
  },
  ChoicePicker: {
    origin: 'official-basic',
    fields: {
      label: { binding: 'allowed', origin: 'official-basic' },
      variant: { binding: 'forbidden', origin: 'official-basic' },
      options: { binding: 'forbidden', origin: 'official-basic' },
      value: { binding: 'required', origin: 'official-basic' },
      displayStyle: { binding: 'forbidden', origin: 'official-basic' },
      filterable: { binding: 'forbidden', origin: 'official-basic' },
    },
    action: { allowed: false },
  },
  Slider: {
    origin: 'official-basic',
    fields: {
      label: { binding: 'allowed', origin: 'official-basic' },
      min: { binding: 'forbidden', origin: 'official-basic' },
      max: { binding: 'forbidden', origin: 'official-basic' },
      value: { binding: 'required', origin: 'official-basic' },
    },
    action: { allowed: false },
    checks: basicCheckPolicy,
  },
  Button: {
    origin: 'nexus-extension',
    fields: {
      child: { componentRef: true, binding: 'forbidden', origin: 'official-basic' },
      variant: { binding: 'forbidden', origin: 'official-basic' },
      disabled: { binding: 'forbidden', origin: 'nexus-extension' },
    },
    action: { allowed: true },
    checks: basicCheckPolicy,
  },
  DateTimeInput: {
    origin: 'official-basic',
    fields: {
      label: { binding: 'allowed', origin: 'official-basic' },
      value: { binding: 'required', origin: 'official-basic' },
      enableDate: { binding: 'forbidden', origin: 'official-basic' },
      enableTime: { binding: 'forbidden', origin: 'official-basic' },
      min: { binding: 'allowed', origin: 'official-basic' },
      max: { binding: 'allowed', origin: 'official-basic' },
    },
    action: { allowed: false },
  },
} as const;

const workbenchComponentPolicies = {
  Text: basicComponentPolicies.Text,
  TextField: {
    ...basicComponentPolicies.TextField,
    checks: { enabled: false },
  },
  ChoicePicker: basicComponentPolicies.ChoicePicker,
  DateTimeInput: basicComponentPolicies.DateTimeInput,
  Button: {
    ...basicComponentPolicies.Button,
    checks: { enabled: false },
    action: { allowed: true, required: true },
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
    components: BASIC_CATALOG_COMPONENTS,
    actions: BASIC_CATALOG_ACTIONS,
    componentSchemas: basicComponentSchemas,
    componentPolicies: basicComponentPolicies,
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
    componentPolicies: workbenchComponentPolicies,
  },
]);
