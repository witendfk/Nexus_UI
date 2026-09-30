import type { CatalogDefinition } from '@nexus-ui/core';

export const ORDEROPS_CATALOG_ID = 'https://example.com/catalogs/orderops/v1';

/**
 * 穿刺用最小 Catalog（T1.2）：只覆盖生成 → guard → 渲染 → action 回流链路验证。
 * M2 会替换为正式的 OrderOps Catalog v1（增加 OrderSummary / LogisticsTimeline 与 createTicket）。
 */
export const ORDEROPS_CATALOG: CatalogDefinition = {
  catalogId: ORDEROPS_CATALOG_ID,
  // Column 是布局组件：与 Nexus 内置目录一致，不声明 schema/policy，
  // registry 校验会跳过无 schema 组件的 props 检查（有意为之，非遗漏）。
  components: ['Column', 'Text', 'TextField', 'Button'],
  actions: ['ping'],
  componentSchemas: {
    Text: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string', dynamic: 'allowed' },
        variant: { type: 'string', enum: ['h1', 'h2', 'h3', 'body', 'caption'] },
      },
    },
    TextField: {
      type: 'object',
      additionalProperties: false,
      properties: {
        label: { type: 'string', dynamic: 'allowed' },
        value: { type: 'string', dynamic: 'required' },
        variant: { type: 'string', enum: ['longText', 'shortText'] },
      },
    },
    Button: {
      type: 'object',
      additionalProperties: false,
      properties: {
        child: { type: 'string' },
        disabled: { type: 'boolean', dynamic: 'forbidden' },
      },
    },
  },
  componentPolicies: {
    Text: {
      fields: {
        text: { binding: 'allowed' },
        variant: { binding: 'forbidden' },
      },
      action: { allowed: false },
    },
    TextField: {
      fields: {
        label: { binding: 'allowed' },
        value: { binding: 'required' },
        variant: { binding: 'forbidden' },
      },
      action: { allowed: false },
    },
    Button: {
      fields: {
        child: { componentRef: true, binding: 'forbidden' },
        disabled: { binding: 'forbidden' },
      },
      action: { allowed: true },
    },
  },
};
