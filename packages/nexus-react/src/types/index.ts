/**
 * @nexus-ui/react/types —— React 渲染层契约。
 *
 * RenderContext 提供 action 出口（范式无关）；RenderFn 把 VNode + 已渲染子节点 → React 元素。
 */
import type { ReactNode } from 'react';
import type { VNode } from '@nexus-ui/core';

/** 渲染上下文：供 renderMap 函数触发 action 与受控输入写回。 */
export interface RenderContext {
  triggerAction: (componentId: string, surfaceId: string) => void;
  setInputValue: (
    componentId: string,
    surfaceId: string,
    value: string | boolean | string[],
  ) => boolean;
}

/** 标准组件渲染函数：VNode + 已渲染子节点 + ctx → React 元素。 */
export type RenderFn = (vnode: VNode, children: ReactNode[], ctx: RenderContext) => ReactNode;

/** 组件名 → 渲染函数。 */
export type RenderMap = Record<string, RenderFn>;
