/**
 * @nexus-ui/react/surface —— A2UISurface（S4.2，DESIGN D7）。
 *
 * 按 surfaceId 独立订阅渲染输出，把 VNode 树渲染到宿主选择的位置；两个 Surface
 * 的状态、删除与生命周期互不影响（runtime 按 surfaceId 全维度隔离）。订阅在
 * 卸载时解除；挂载晚于渲染时补拉最近一次 VNode 根。
 *
 * 动作出口门控：`actionsEnabled` 为 false 时，Surface 在 renderer 的 action 回调统一门控，
 * 自定义事件同样不能进入 runtime；上下文同时提供可见禁用态。默认 true。
 */
import { createElement, useCallback, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { ReactRenderer } from '../renderer';
import { useA2UIContext } from '../provider';
import type { RenderContext, RenderMap } from '../types';

export interface A2UISurfaceProps {
  surfaceId: string;
  /** 覆盖 Provider 的 renderMap（按 surface 定制渲染）。引用变更即时生效。 */
  renderMap?: RenderMap;
  /** 动作出口门控（S4.2）：false 时拦截该 surface 内全部 action 触发。默认 true。 */
  actionsEnabled?: boolean;
  /** 根元素 class（默认 `nexus-surface`，可叠加宿主样式）。 */
  className?: string;
  /** 单次渲染元素预算（与 renderer 预算同口径；默认 10000）。 */
  maxElements?: number;
}

export function A2UISurface({
  surfaceId,
  renderMap: surfaceRenderMap,
  actionsEnabled = true,
  className = 'nexus-surface',
  maxElements,
}: A2UISurfaceProps): ReactNode {
  const ctx = useA2UIContext();
  const subscribe = useCallback(
    (notify: () => void) => ctx.subscribeRender(surfaceId, notify),
    [ctx, surfaceId],
  );
  const getSnapshot = useCallback(() => ctx.getLastRoot(surfaceId), [ctx, surfaceId]);
  const root = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const renderContext = useMemo<RenderContext>(
    () => ({
      actionsEnabled,
      triggerAction: (id, sid) => {
        if (actionsEnabled && sid === surfaceId) ctx.triggerAction(id, sid);
      },
      setInputValue: (id, sid, property, value) =>
        sid === surfaceId && ctx.setInputValue(id, sid, property, value),
    }),
    [ctx, actionsEnabled, surfaceId],
  );

  // surface 级 renderMap 覆盖：按引用复用 ReactRenderer；未提供时走 Provider
  // 的 catalog 分派渲染。
  const surfaceRenderer = useMemo(
    () => (surfaceRenderMap ? new ReactRenderer(surfaceRenderMap) : null),
    [surfaceRenderMap],
  );

  if (root === null) return null;
  const elements =
    surfaceRenderer !== null
      ? surfaceRenderer.renderTree(root, renderContext, { maxElements })
      : ctx.renderTree(root, surfaceId, maxElements, renderContext);
  return createElement(
    'div',
    {
      className,
      'data-surface-id': surfaceId,
      'aria-disabled': !actionsEnabled,
    },
    elements,
  );
}
