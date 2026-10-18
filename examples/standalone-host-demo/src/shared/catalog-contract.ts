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
  actions: [{ name: DEMO_AGENT_ACTION, sources: ['Button'] }],
};
