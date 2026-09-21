/**
 * @nexus-ui/react/renderer —— ReactRenderer。
 *
 * 把 VNode 树经 renderMap 映射为 React 元素。占位/未知类型不抛错，降级为提示元素
 * （对齐需求文档兜底策略）。mount/update/unmount 全交 React，不自研 reconciler。
 */
import { createElement } from 'react';
import type { ReactNode } from 'react';
import type { VNode } from '@nexus-ui/core';
import { standardRenderMap } from '../components';
import type { RenderContext, RenderMap } from '../types';

const placeholderStyle = { opacity: 0.4, fontStyle: 'italic', color: '#888' } as const;
const unknownStyle = { color: '#c00', border: '1px dashed #c00', padding: 4 } as const;

export class ReactRenderer {
  constructor(private readonly renderMap: RenderMap = standardRenderMap) {}

  /** 渲染 VNode 根树为 React 节点；root 为 null 返回 null。 */
  renderTree(root: VNode | null, ctx: RenderContext): ReactNode {
    return root ? this.render(root, ctx) : null;
  }

  render(vnode: VNode, ctx: RenderContext): ReactNode {
    if (vnode.type === '__placeholder__') {
      return createElement('div', { key: vnode.id, style: placeholderStyle }, '…');
    }
    const fn = this.renderMap[vnode.type];
    if (!fn) {
      return createElement(
        'div',
        { key: vnode.id, style: unknownStyle },
        `未知组件: ${vnode.type}`,
      );
    }
    const children = vnode.children ? vnode.children.map((c) => this.render(c, ctx)) : [];
    return fn(vnode, children, ctx);
  }
}
