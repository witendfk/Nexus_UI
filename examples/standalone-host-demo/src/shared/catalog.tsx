import { createElement } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { CatalogRegistry, toDisplayString } from '@nexus-ui/core';
import { standardRenderMap } from '@nexus-ui/react';
import type { RenderMap } from '@nexus-ui/react';
import { standaloneHostCatalog } from './catalog-contract';
import { scorecardHostCatalog } from './scorecard-contract';

export { standaloneHostCatalog } from './catalog-contract';
export { scorecardHostCatalog, SCORECARD_ACTION, SCORECARD_CATALOG_ID } from './scorecard-contract';

export function createStandaloneHostRegistry(): CatalogRegistry {
  return new CatalogRegistry([standaloneHostCatalog, scorecardHostCatalog]);
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

const inputRowStyle = { display: 'grid', gap: 4, fontSize: 14 } as const;

const submitCardStyle = {
  justifySelf: 'start',
  border: '1px dashed #0f766e',
  borderRadius: 8,
  padding: '10px 14px',
  cursor: 'pointer',
  fontSize: 14,
  backgroundColor: '#f0fdfa',
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
        disabled: vnode.props.disabled === true || context.actionsEnabled === false,
        onClick: () => context.triggerAction(vnode.id, vnode.surfaceId),
      },
      ...children,
    ),
};

/** S2.6.2.3：中立夹具的 React 映射；控件只上报 componentId/surfaceId/property/value。 */
export const scorecardHostRenderMap: RenderMap = {
  Column: standardRenderMap.Column,
  Text: standardRenderMap.Text,
  FeedbackSummary: (vnode, children) =>
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
        { key: `${vnode.id}-note`, style: amountStyle },
        toDisplayString(vnode.props.note),
      ),
      ...children,
    ),
  ScoreDial: (vnode, _children, context) =>
    createElement(
      'label',
      { key: vnode.id, style: inputRowStyle },
      '评分（0-100 整数）',
      createElement('input', {
        key: `${vnode.id}-input`,
        type: 'number',
        min: 0,
        max: 100,
        value: typeof vnode.props.score === 'number' ? vnode.props.score : '',
        onChange: (event: ChangeEvent<HTMLInputElement>) => {
          if (event.target.value === '') return;
          // 只上报用户新值；整数/范围校验由 core 按声明解释，拒绝时不写回。
          context.setInputValue(vnode.id, vnode.surfaceId, 'score', Number(event.target.value));
        },
      }),
    ),
  PinnedToggle: (vnode, _children, context) =>
    createElement(
      'label',
      { key: vnode.id, style: inputRowStyle },
      createElement('input', {
        key: `${vnode.id}-input`,
        type: 'checkbox',
        checked: vnode.props.pinned === true,
        onChange: (event: ChangeEvent<HTMLInputElement>) => {
          context.setInputValue(vnode.id, vnode.surfaceId, 'pinned', event.target.checked);
        },
      }),
      '置顶本次反馈',
    ),
  SubmitCard: (vnode, children, context) =>
    createElement(
      'div',
      {
        key: vnode.id,
        role: 'button',
        tabIndex: context.actionsEnabled === false ? -1 : 0,
        'aria-disabled': context.actionsEnabled === false,
        style: { ...submitCardStyle, opacity: context.actionsEnabled === false ? 0.5 : 1 },
        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            context.triggerAction(vnode.id, vnode.surfaceId);
          }
        },
        onClick: () => context.triggerAction(vnode.id, vnode.surfaceId),
      },
      ...children,
    ),
};
