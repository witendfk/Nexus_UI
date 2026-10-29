/**
 * @nexus-ui/react/types —— React 渲染层契约。
 *
 * RenderContext 提供 action 出口（范式无关）；RenderFn 把 VNode + 已渲染子节点 → React 元素。
 */
import type { ReactNode } from 'react';
import type { VNode } from '@nexus-ui/core';

/** 渲染上下文：供 renderMap 函数触发 action 与受控输入写回。 */
export interface RenderContext {
  /** false 表示此 surface 不允许 action；自定义控件据此展示禁用态。 */
  actionsEnabled?: boolean;
  triggerAction: (componentId: string, surfaceId: string) => void;
  /**
   * 受控输入写回：上报组件、绑定属性与用户新值。绑定路径与值域由 core 按当前
   * Catalog 的 inputs 声明解释；React 不解释可信写路径，拒绝时返回 false。
   */
  setInputValue: (
    componentId: string,
    surfaceId: string,
    property: string,
    value: unknown,
  ) => boolean;
}

/** 标准组件渲染函数：VNode + 已渲染子节点 + ctx → React 元素。 */
export type RenderFn = (vnode: VNode, children: ReactNode[], ctx: RenderContext) => ReactNode;

/** 组件名 → 渲染函数。 */
export type RenderMap = Record<string, RenderFn>;
