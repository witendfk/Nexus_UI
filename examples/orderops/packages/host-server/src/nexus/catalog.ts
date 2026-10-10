import type { CatalogDefinition } from '@nexus-ui/core';

export const ORDEROPS_CATALOG_ID = 'https://example.com/catalogs/orderops/v1';

/**
 * OrderOps Catalog v1（M2/T3.2，docs/SPEC.md §2）。
 *
 * - 首条切片允许 6 组件，唯一 action 为 `createTicket`；
 * - Column 是根布局：不声明 schema/policy，registry 跳过无 schema 组件的 props
 *   检查（与 Nexus 内置目录一致，有意为之）；
 * - OrderSummary / LogisticsTimeline 是宿主扩展组件：只展示事实、不挂 action，
 *   schema 与 componentPolicies.fields 双声明（缺一不进 prompt contract）；
 * - Button.disabled 只能字面布尔（binding forbidden），child 是组件引用；
 * - TextField 仅绑定 `/draft/note`：catalog 的绑定策略只能表达"必须是 {path} 绑定"，
 *   具体 path 白名单由 Agent prompt contract 声明、并在 T4.1 本地 handler 的
 *   resolveActionContext 中强制——guard 无法表达 path 级约束，此处诚实分层。
 */
export const ORDEROPS_CATALOG: CatalogDefinition = {
  catalogId: ORDEROPS_CATALOG_ID,
  components: ['Column', 'Text', 'OrderSummary', 'LogisticsTimeline', 'TextField', 'Button'],
  actions: ['createTicket'],
  componentSchemas: {
    Text: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string', dynamic: 'allowed' },
        variant: { type: 'string', enum: ['h1', 'h2', 'h3', 'body', 'caption'] },
      },
    },
    OrderSummary: {
      type: 'object',
      additionalProperties: false,
      required: ['orderId', 'product', 'currency', 'amountMinor', 'customerSummary'],
      properties: {
        orderId: { type: 'string', dynamic: 'allowed' },
        product: { type: 'string', dynamic: 'allowed' },
        currency: { type: 'string', dynamic: 'allowed', pattern: '^[A-Z]{3}$' },
        amountMinor: { type: 'integer', dynamic: 'allowed', minimum: 0 },
        customerSummary: { type: 'string', dynamic: 'allowed' },
      },
    },
    LogisticsTimeline: {
      type: 'object',
      additionalProperties: false,
      required: ['events'],
      properties: {
        events: {
          type: 'array',
          dynamic: 'allowed',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'status', 'occurredAt', 'source'],
            properties: {
              id: { type: 'string' },
              status: { type: 'string' },
              occurredAt: { type: 'string' },
              source: { type: 'string' },
            },
          },
        },
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
    OrderSummary: {
      origin: 'host-extension',
      fields: {
        orderId: { binding: 'allowed' },
        product: { binding: 'allowed' },
        currency: { binding: 'allowed' },
        amountMinor: { binding: 'allowed' },
        customerSummary: { binding: 'allowed' },
      },
      action: { allowed: false },
    },
    LogisticsTimeline: {
      origin: 'host-extension',
      fields: {
        events: { binding: 'allowed' },
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
