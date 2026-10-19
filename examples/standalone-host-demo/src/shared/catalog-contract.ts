import type { CatalogDefinition } from '@nexus-ui/core';
import { DEMO_AGENT_ACTION, DEMO_AGENT_CATALOG_ID } from '../contract';

export const standaloneHostCatalog: CatalogDefinition = {
  catalogId: DEMO_AGENT_CATALOG_ID,
  components: {
    ApprovalSummary: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'amount'],
        properties: {
          title: { type: 'string', dynamic: 'required' },
          amount: { type: 'string', dynamic: 'required' },
        },
      },
      origin: 'host-extension',
    },
    Text: { schema: { type: 'object' } },
    Button: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { disabled: { type: 'boolean', dynamic: 'forbidden' } },
      },
      fields: {
        child: { componentRef: true, origin: 'official-basic' },
        disabled: { origin: 'host-extension' },
      },
      origin: 'host-extension',
    },
  },
  actions: [
    {
      name: DEMO_AGENT_ACTION,
      sources: ['Button'],
      // S2.4 参数准入：服务端从已提交声明重算并按 paramSchema 校验，
      // 缺省即参数必须为空对象——demo 的审批参数在此显式声明。
      paramSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['approvalId', 'amount'],
        properties: {
          approvalId: { type: 'string' },
          amount: { type: 'string' },
        },
      },
    },
  ],
};
