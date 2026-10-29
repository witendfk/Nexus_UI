/**
 * Button：child（单子，通常 Text）作 label；variant 样式 hint（官方枚举
 * default/primary/borderless）映射为基线设计令牌；点击 → ctx.triggerAction（范式无关出口）。
 */
import { createElement } from 'react';
import type { CSSProperties } from 'react';
import type { RenderFn } from '../types';

const baseStyle: CSSProperties = {
  padding: '6px 14px',
  borderRadius: 6,
  fontSize: 'inherit',
  fontFamily: 'inherit',
  lineHeight: 1.4,
  cursor: 'pointer',
};

const variantStyles: Record<string, CSSProperties> = {
  default: { ...baseStyle, background: '#f3f4f6', border: '1px solid #e3e3e3', color: 'inherit' },
  primary: { ...baseStyle, background: '#2563eb', border: '1px solid #2563eb', color: '#fff' },
  borderless: {
    ...baseStyle,
    background: 'none',
    border: 'none',
    padding: '2px 4px',
    color: '#2563eb',
    textDecoration: 'underline',
  },
};

export const Button: RenderFn = (vnode, children, ctx) =>
  createElement(
    'button',
    {
      key: vnode.id,
      type: 'button',
      style: variantStyles[String(vnode.props.variant)] ?? variantStyles.default,
      disabled:
        ctx.actionsEnabled === false ||
        vnode.props.disabled === true ||
        vnode.validation?.valid === false,
      onClick: () => ctx.triggerAction(vnode.id, vnode.surfaceId),
    },
    ...children,
  );
