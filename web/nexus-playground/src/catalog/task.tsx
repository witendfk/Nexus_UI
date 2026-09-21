import { createElement } from 'react';
import { toDisplayString } from '@nexus-ui/core';
import type { RenderMap } from '@nexus-ui/react';

export const TASK_CATALOG_ID = 'https://example.com/catalogs/nexus-task/v1';

const summaryStyle = {
  border: '1px solid #d8dee9',
  borderRadius: 6,
  padding: 16,
  display: 'grid',
  gap: 8,
  maxWidth: 420,
  backgroundColor: '#fff',
} as const;

const statusStyle = {
  fontSize: 12,
  color: '#2563eb',
  textTransform: 'uppercase',
} as const;

const buttonStyle = {
  justifySelf: 'start',
  border: 'none',
  padding: '8px 12px',
  borderRadius: 4,
  backgroundColor: '#2563eb',
  color: '#fff',
  cursor: 'pointer',
} as const;

export const taskRenderMap: RenderMap = {
  TaskSummary: (vnode, children) =>
    createElement(
      'section',
      { key: vnode.id, style: summaryStyle },
      createElement('h3', { key: `${vnode.id}-title` }, toDisplayString(vnode.props.title)),
      createElement(
        'p',
        { key: `${vnode.id}-description` },
        toDisplayString(vnode.props.description),
      ),
      createElement(
        'span',
        { key: `${vnode.id}-status`, style: statusStyle },
        toDisplayString(vnode.props.status),
      ),
      ...children,
    ),
  TaskButton: (vnode, _children, ctx) =>
    createElement(
      'button',
      {
        key: vnode.id,
        style: buttonStyle,
        disabled: vnode.props.disabled === true,
        onClick: () => ctx.triggerAction(vnode.id, vnode.surfaceId),
      },
      toDisplayString(vnode.props.label),
    ),
};

export const catalogRenderMaps = {
  [TASK_CATALOG_ID]: taskRenderMap,
} as const;
