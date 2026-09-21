/** Row：横向 flex 容器；支持 align（交叉轴）/ justify（主轴）。 */
import { createElement } from 'react';
import type { CSSProperties } from 'react';
import type { RenderFn } from '../types';

const alignItems = (a: unknown): CSSProperties['alignItems'] =>
  a === 'center' ? 'center' : a === 'end' ? 'flex-end' : a === 'start' ? 'flex-start' : undefined;
const justifyContent = (j: unknown): CSSProperties['justifyContent'] =>
  j === 'center'
    ? 'center'
    : j === 'end'
      ? 'flex-end'
      : j === 'between'
        ? 'space-between'
        : undefined;

export const Row: RenderFn = (vnode, children) =>
  createElement(
    'div',
    {
      key: vnode.id,
      style: {
        display: 'flex',
        flexDirection: 'row',
        gap: 8,
        alignItems: alignItems(vnode.props.align),
        justifyContent: justifyContent(vnode.props.justify),
      },
    },
    ...children,
  );
