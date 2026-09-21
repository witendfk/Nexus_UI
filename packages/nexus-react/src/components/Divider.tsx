/** Divider：分隔线（无属性）。 */
import { createElement } from 'react';
import type { RenderFn } from '../types';

export const Divider: RenderFn = (vnode) =>
  createElement('hr', {
    key: vnode.id,
    style: { border: 'none', borderTop: '1px solid #e3e3e3', width: '100%', margin: '4px 0' },
  });
