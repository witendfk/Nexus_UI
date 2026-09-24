/** Button：child（单子，通常 Text）作 label；点击 → ctx.triggerAction（范式无关出口）。 */
import { createElement } from 'react';
import type { RenderFn } from '../types';

export const Button: RenderFn = (vnode, children, ctx) =>
  createElement(
    'button',
    {
      key: vnode.id,
      disabled: vnode.props.disabled === true || vnode.validation?.valid === false,
      onClick: () => ctx.triggerAction(vnode.id, vnode.surfaceId),
    },
    ...children,
  );
