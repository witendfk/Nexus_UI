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
    Button: {
      type: 'object',
      additionalProperties: false,
      properties: {
        disabled: { type: 'boolean', dynamic: 'forbidden' },
      },
    },
  },
  componentPolicies: {
    ApprovalSummary: {
      origin: 'host-extension',
      fields: {
        title: { binding: 'required', origin: 'host-extension' },
        amount: { binding: 'required', origin: 'host-extension' },
      },
      action: { allowed: false },
    },
    Button: {
      origin: 'host-extension',
      fields: {
        child: { componentRef: true, binding: 'forbidden', origin: 'official-basic' },
        disabled: { binding: 'forbidden', origin: 'host-extension' },
      },
      action: { allowed: true },
    },
  },
};
