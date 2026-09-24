import type { CatalogDefinition } from '@nexus-ui/core';
import { DEMO_AGENT_ACTION, DEMO_AGENT_CATALOG_ID } from '../contract';

export const standaloneHostCatalog: CatalogDefinition = {
  catalogId: DEMO_AGENT_CATALOG_ID,
  components: ['ApprovalSummary', 'Text', 'Button'],
  actions: [DEMO_AGENT_ACTION],
  componentSchemas: {
    ApprovalSummary: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'amount'],
      properties: {
        title: { type: 'string', dynamic: 'required' },
        amount: { type: 'string', dynamic: 'required' },
      },
    },
  },
};
