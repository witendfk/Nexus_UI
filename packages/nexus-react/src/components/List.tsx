import { createElement } from 'react';
import type { CSSProperties } from 'react';
import type { RenderFn } from '../types';

const alignItems = (value: unknown): CSSProperties['alignItems'] =>
  value === 'start'
    ? 'flex-start'
    : value === 'center'
      ? 'center'
      : value === 'end'
        ? 'flex-end'
        : 'stretch';

/** List：协议 Basic Catalog 的静态列表容器；ChildList template 属于后续版本。 */
export const List: RenderFn = (vnode, children) => {
  const direction = vnode.props.direction === 'horizontal' ? 'row' : 'column';
  return createElement(
    'ul',
    {
      key: vnode.id,
      style: {
        display: 'flex',
        flexDirection: direction,
        gap: 8,
        alignItems: alignItems(vnode.props.align),
        listStyle: 'none',
        margin: 0,
        padding: 0,
      },
    },
    ...children.map((child, index) =>
      createElement(
        'li',
        {
          key: `${vnode.id}-item-${index}`,
          style: direction === 'column' ? { width: '100%' } : undefined,
        },
        child,
      ),
    ),
  );
};
