import { createElement } from 'react';
import { toDisplayString } from '@nexus-ui/core';
import { standardRenderMap } from '@nexus-ui/react';
import type { RenderMap } from '@nexus-ui/react';

export const WORKBENCH_CATALOG_ID = 'https://example.com/catalogs/nexus-workbench/v1';

const summaryStyle = {
  border: '1px solid #cfd8dc',
  borderLeft: '4px solid #0f766e',
  borderRadius: 6,
  padding: 16,
  display: 'grid',
  gap: 10,
  backgroundColor: '#f8fafc',
} as const;

const nameStyle = {
  margin: 0,
  fontSize: 18,
  fontWeight: 650,
} as const;

const metaStyle = {
  margin: 0,
  color: '#64748b',
  fontSize: 13,
  lineHeight: 1.6,
} as const;

const statusStyle = {
  justifySelf: 'start',
  borderRadius: 999,
  padding: '3px 8px',
  backgroundColor: '#e0f2f1',
  color: '#00695c',
  fontSize: 12,
  fontWeight: 650,
} as const;

const buttonStyle = {
  justifySelf: 'start',
  border: 'none',
  borderRadius: 4,
  padding: '8px 12px',
  backgroundColor: '#0f766e',
  color: '#fff',
  cursor: 'pointer',
} as const;

export const workbenchRenderMap: RenderMap = {
  ...standardRenderMap,
  CustomerSummary: (vnode) =>
    createElement(
      'section',
      { key: vnode.id, style: summaryStyle },
      createElement(
        'h3',
        { key: `${vnode.id}-name`, style: nameStyle },
        toDisplayString(vnode.props.customerName),
      ),
      createElement(
        'p',
        { key: `${vnode.id}-company`, style: metaStyle },
        toDisplayString(vnode.props.company),
      ),
      createElement(
        'p',
        { key: `${vnode.id}-owner`, style: metaStyle },
        `负责人：${toDisplayString(vnode.props.owner)}`,
      ),
      createElement(
        'p',
        { key: `${vnode.id}-note`, style: metaStyle },
        toDisplayString(vnode.props.recentNote),
      ),
      createElement(
        'span',
        { key: `${vnode.id}-status`, style: statusStyle },
        toDisplayString(vnode.props.status),
      ),
    ),
  Button: (vnode, children, ctx) =>
    createElement(
      'button',
      {
        key: vnode.id,
        style: buttonStyle,
        disabled: vnode.props.disabled === true,
        onClick: () => ctx.triggerAction(vnode.id, vnode.surfaceId),
      },
      ...children,
    ),
};
