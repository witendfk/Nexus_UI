/**
 * @nexus-ui/react/renderer —— ReactRenderer。
 *
 * 把 VNode 树经 renderMap 映射为 React 元素。占位/未知类型不抛错，降级为提示元素
 * （对齐需求文档兜底策略）。mount/update/unmount 全交 React，不自研 reconciler。
 *
 * 元素预算：core 的 memo 复用 VNode 实例，但 React 仍会按「引用」逐个展开共享
 * 子树——不设防时少量唯一组件即可指数级 createElement（菱形 DAG 2ⁿ）。renderTree
 * 对单次渲染实际创建的元素总数设上限，预算耗尽后停止扩展，剩余引用渲染为统一的
 * 「预算已用尽」占位，onLimit 恰好上报一次。
 */
import { createElement } from 'react';
import type { ReactNode } from 'react';
import type { VNode } from '@nexus-ui/core';
import { standardRenderMap } from '../components';
import type { RenderContext, RenderMap } from '../types';

const placeholderStyle = { opacity: 0.4, fontStyle: 'italic', color: '#888' } as const;
const unknownStyle = { color: '#c00', border: '1px dashed #c00', padding: 4 } as const;
const budgetStyle = { color: '#a16207', border: '1px dashed #a16207', padding: 4 } as const;

/** 单次 renderTree 允许创建的 React 元素数上限（默认 10000，与 core maxNodes 对齐）。 */
export const DEFAULT_MAX_ELEMENTS = 10_000;

export interface RenderTreeOptions {
  /** 元素预算；超出后停止扩展。 */
  maxElements?: number;
  /** 预算触发回调（每次渲染至多一次），供宿主转结构化诊断。 */
  onLimit?: (info: { limit: number }) => void;
}

/** 跨递归共享的可变预算；null 表示不限量（render 单点入口）。 */
interface Budget {
  remaining: number;
  reported: boolean;
}

export class ReactRenderer {
  constructor(private readonly renderMap: RenderMap = standardRenderMap) {}

  /** 渲染 VNode 根树为 React 节点；root 为 null 返回 null。 */
  renderTree(root: VNode | null, ctx: RenderContext, options: RenderTreeOptions = {}): ReactNode {
    if (!root) return null;
    const limit = options.maxElements ?? DEFAULT_MAX_ELEMENTS;
    return this.renderBounded(root, ctx, { remaining: limit, reported: false }, limit, options.onLimit);
  }

  /** 渲染单个 VNode（不设预算——正常路径请走 renderTree，由预算统一兜底）。 */
  render(vnode: VNode, ctx: RenderContext): ReactNode {
    return this.renderBounded(vnode, ctx, null, 0, undefined);
  }

  private renderBounded(
    vnode: VNode,
    ctx: RenderContext,
    budget: Budget | null,
    limit: number,
    onLimit: RenderTreeOptions['onLimit'],
  ): ReactNode {
    if (budget) {
      if (budget.remaining <= 0) {
        if (!budget.reported) {
          budget.reported = true;
          onLimit?.({ limit });
        }
        return createElement(
          'div',
          { key: `${vnode.id}-budget-exhausted`, style: budgetStyle },
          '渲染元素预算已用尽',
        );
      }
      budget.remaining -= 1;
    }

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
    const children = vnode.children
      ? vnode.children.map((c) => this.renderBounded(c, ctx, budget, limit, onLimit))
      : [];
    return fn(vnode, children, ctx);
  }
}
