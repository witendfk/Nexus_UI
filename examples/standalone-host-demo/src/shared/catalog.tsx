import { createElement } from 'react';
import { CatalogRegistry, toDisplayString } from '@nexus-ui/core';
import { standardRenderMap } from '@nexus-ui/react';
import type { RenderMap } from '@nexus-ui/react';
import { standaloneHostCatalog } from './catalog-contract';

export { standaloneHostCatalog } from './catalog-contract';

export function createStandaloneHostRegistry(): CatalogRegistry {
  return new CatalogRegistry([standaloneHostCatalog]);
}

const summaryStyle = {
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  padding: 20,
  display: 'grid',
  gap: 10,
  width: 'min(360px, 100%)',
  backgroundColor: '#fff',
  boxShadow: '0 12px 30px rgba(15, 23, 42, 0.08)',
} as const;

const titleStyle = { margin: 0, fontSize: 17, lineHeight: 1.4 } as const;

const amountStyle = { margin: 0, color: '#475569', fontSize: 14 } as const;

const buttonStyle = {
  justifySelf: 'start',
  border: 'none',
  padding: '9px 14px',
  borderRadius: 6,
  backgroundColor: '#0f766e',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 14,
} as const;

export const standaloneHostRenderMap: RenderMap = {
  ApprovalSummary: (vnode, children) =>
    createElement(
      'section',
      { key: vnode.id, style: summaryStyle },
      createElement(
        'h2',
        { key: `${vnode.id}-title`, style: titleStyle },
        toDisplayString(vnode.props.title),
      ),
      createElement(
        'p',
        { key: `${vnode.id}-amount`, style: amountStyle },
        toDisplayString(vnode.props.amount),
      ),
      ...children,
    ),
  Text: standardRenderMap.Text,
  Button: (vnode, children, context) =>
    createElement(
      'button',
      {
        key: vnode.id,
        type: 'button',
        style: buttonStyle,
        disabled: vnode.props.disabled === true,
        onClick: () => context.triggerAction(vnode.id, vnode.surfaceId),
      },
      ...children,
    ),
};
