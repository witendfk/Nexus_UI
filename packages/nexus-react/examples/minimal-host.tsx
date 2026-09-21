import { useEffect } from 'react';
import { CatalogRegistry, toDisplayString } from '@nexus-ui/core';
import type { ActionEvent } from '@nexus-ui/core';
import { A2UIProvider, useA2UI } from '../src';
import type { RenderMap } from '../src';

export const MINIMAL_CATALOG_ID = 'https://example.com/catalogs/nexus-minimal/v1';

const minimalCatalogRegistry = new CatalogRegistry([
  {
    catalogId: MINIMAL_CATALOG_ID,
    components: ['ApprovalSummary', 'ApprovalButton'],
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
      ApprovalButton: {
        type: 'object',
        additionalProperties: false,
        required: ['label'],
        properties: {
          label: { type: 'string', dynamic: 'required' },
        },
      },
    },
  },
]);

const sectionStyle = {
  border: '1px solid #d8dee9',
  borderRadius: 6,
  padding: 16,
  display: 'grid',
  gap: 8,
  width: 320,
  backgroundColor: '#fff',
} as const;

const titleStyle = { margin: 0, fontSize: 17 } as const;

const detailStyle = { margin: 0, color: '#4b5563', fontSize: 13 } as const;

const buttonStyle = {
  justifySelf: 'start',
  border: 'none',
  padding: '8px 12px',
  borderRadius: 4,
  backgroundColor: '#2563eb',
  color: '#fff',
  cursor: 'pointer',
} as const;

const minimalRenderMap: RenderMap = {
  ApprovalSummary: (vnode, children) => (
    <section key={vnode.id} style={sectionStyle}>
      <h2 key={`${vnode.id}-title`} style={titleStyle}>
        {toDisplayString(vnode.props.title)}
      </h2>
      <p key={`${vnode.id}-amount`} style={detailStyle}>
        {toDisplayString(vnode.props.amount)}
      </p>
      {children}
    </section>
  ),
  ApprovalButton: (vnode, _children, context) => (
    <button
      key={vnode.id}
      type="button"
      style={buttonStyle}
      onClick={() => context.triggerAction(vnode.id, vnode.surfaceId)}
    >
      {toDisplayString(vnode.props.label)}
    </button>
  ),
};

const MINIMAL_A2UI_JSONL = [
  JSON.stringify({
    version: 'v0.9',
    createSurface: { surfaceId: 'approval-001', catalogId: MINIMAL_CATALOG_ID },
  }),
  JSON.stringify({
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'approval-001',
      components: [
        {
          id: 'root',
          component: 'ApprovalSummary',
          title: { path: '/title' },
          amount: { path: '/amount' },
          children: ['approve'],
        },
        {
          id: 'approve',
          component: 'ApprovalButton',
          label: { path: '/actionLabel' },
          action: {
            event: {
              name: 'approve',
              context: {
                approvalId: { path: '/approvalId' },
                amount: { path: '/amount' },
              },
            },
          },
        },
      ],
    },
  }),
  JSON.stringify({
    version: 'v0.9',
    updateDataModel: {
      surfaceId: 'approval-001',
      value: {
        title: 'Marketing campaign approval',
        amount: 'USD 12,000',
        approvalId: 'approval-001',
        actionLabel: 'Approve',
      },
    },
  }),
].join('\n');

/**
 * A minimal host assembly: feed transport text into core and render the custom catalog.
 * Replace MINIMAL_A2UI_JSONL with an SSE/WebSocket reader in a real application.
 */
export function MinimalA2UIHost({ onAction }: { onAction?: (event: ActionEvent) => void }) {
  return (
    <A2UIProvider
      catalogRegistry={minimalCatalogRegistry}
      catalogRenderMaps={{ [MINIMAL_CATALOG_ID]: minimalRenderMap }}
      onAction={onAction}
    >
      <MinimalHostTransport />
    </A2UIProvider>
  );
}

function MinimalHostTransport() {
  const runtime = useA2UI();

  useEffect(() => {
    runtime.push(`${MINIMAL_A2UI_JSONL}\n`);
    runtime.end();
  }, [runtime]);

  return null;
}
