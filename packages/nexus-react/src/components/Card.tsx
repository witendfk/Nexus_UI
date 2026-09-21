/** Card：单子（child）容器，带边框/圆角/内边距/轻阴影。 */
import { createElement } from 'react';
import type { RenderFn } from '../types';

export const Card: RenderFn = (vnode, children) =>
  createElement(
    'div',
    {
      key: vnode.id,
      style: {
        border: '1px solid #e3e3e3',
        borderRadius: 12,
        padding: 20,
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        background: '#fff',
        maxWidth: 360,
      },
    },
    ...children,
  );
