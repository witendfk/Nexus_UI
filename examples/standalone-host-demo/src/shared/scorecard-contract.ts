import type { CatalogDefinition } from '@nexus-ui/core';

/**
 * S2.6.2 第二个中立交互 Catalog 夹具：展示摘要 + 自定义整数输入（非 value
 * 属性）+ 布尔输入 + 非 Button 提交触发器。命名与布局仅属本夹具，SDK 内核
 * 没有对应名字分支；原审批 Catalog 不参与本场景，保持独立。
 */
export const SCORECARD_CATALOG_ID = 'https://example.com/catalogs/host-scorecard/v1';
export const SCORECARD_ACTION = 'record';

const SCORE_RANGE = { minimum: 0, maximum: 100 } as const;

export const scorecardHostCatalog: CatalogDefinition = {
  catalogId: SCORECARD_CATALOG_ID,
  components: {
    FeedbackSummary: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'note'],
        properties: {
          title: { type: 'string', dynamic: 'required' },
          note: { type: 'string', dynamic: 'required' },
        },
      },
      origin: 'host-extension',
    },
    ScoreDial: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['score'],
        properties: {
          score: { type: 'integer', dynamic: 'required', ...SCORE_RANGE },
        },
      },
      // 自定义输入走与非 value 属性同一条声明机制：inputs 键即绑定属性名。
      inputs: { score: { type: 'integer', ...SCORE_RANGE } },
      origin: 'host-extension',
    },
    PinnedToggle: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['pinned'],
        properties: {
          pinned: { type: 'boolean', dynamic: 'required' },
        },
      },
      inputs: { pinned: { type: 'boolean' } },
      origin: 'host-extension',
    },
    SubmitCard: {
      schema: { type: 'object' },
      action: { required: true },
      origin: 'host-extension',
    },
    Text: { schema: { type: 'object' } },
    Column: { schema: { type: 'object' } },
  },
  actions: [
    {
      name: SCORECARD_ACTION,
      sources: ['SubmitCard'],
      // 服务端从临时模型重算 score/pinned；客户端 context 不是权威值。
      paramSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['score', 'pinned'],
        properties: {
          score: { type: 'integer', ...SCORE_RANGE },
          pinned: { type: 'boolean' },
        },
      },
    },
  ],
};
