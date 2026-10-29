/**
 * @nexus-ui/react/provider —— A2UIProvider + useA2UI（S4.2 重写，DESIGN D7）。
 *
 * Provider 只提供上下文与订阅所有权：持有稳定 runtime（外部注入或首次挂载自建），
 * 把渲染输出按 surfaceId 分发给 `A2UISurface`；不隐式输出任何 surface DOM。
 * renderMap/回调/父组件重渲经 ref 读取，不重置 runtime（外部 runtime 的 onError
 * 与渲染出口由创建者装配，经 `subscribeSurfaceRender` 接入）。
 */
import { createContext, createElement, useContext, useMemo, useRef, type ReactNode } from 'react';
import { A2UIRuntime } from '@nexus-ui/core';
import type {
  A2UIError,
  ActionEvent,
  CatalogRegistry,
  RuntimeOptions,
  VNode,
} from '@nexus-ui/core';
import { standardRenderMap } from '../components';
import { ReactRenderer } from '../renderer';
import type { RenderContext, RenderMap } from '../types';

interface A2UIContextValue {
  runtime: A2UIRuntime;
  /** 订阅 surface 的 VNode 根更新（含删除时的 null）；返回解除函数。 */
  subscribeRender(surfaceId: string, listener: (root: VNode | null) => void): () => void;
  /** 读取最近一次渲染的 VNode 根（挂载晚于渲染的 Surface 补拉）。 */
  getLastRoot(surfaceId: string): VNode | null;
  /** 用 Provider 当前 renderMap 配置渲染（ref 读取，不触发 runtime 重建）。 */
  renderTree(
    root: VNode | null,
    surfaceId: string,
    maxElements?: number,
    context?: RenderContext,
  ): ReactNode;
  triggerAction(componentId: string, surfaceId: string): void;
  setInputValue(componentId: string, surfaceId: string, property: string, value: unknown): boolean;
}

const A2UIContext = createContext<A2UIContextValue | null>(null);

export interface A2UIProviderProps {
  children?: ReactNode;
  /**
   * 外部 runtime：销毁归创建者，Provider 卸载不触碰。缺省自建 runtime，
   * 其视图状态随 Provider 卸载释放（GC）。
   */
  runtime?: A2UIRuntime;
  /** 自建 runtime 的选项（外部 runtime 时忽略）；仅首次挂载读取。onError 经 ref 生效。 */
  runtimeOptions?: RuntimeOptions;
  /** 默认 renderMap（可被 catalogRenderMaps 按 catalogId 覆盖）。变更即时生效，不重置 runtime。 */
  renderMap?: RenderMap;
  /** 按 catalogId 选择 renderMap；未匹配 catalog 回退到 renderMap。 */
  catalogRenderMaps?: Record<string, RenderMap>;
  catalogRegistry?: CatalogRegistry;
  /**
   * [seam] action 出口回调（范式无关）；默认不处理。自建 runtime 经 ref 生效；
   * 外部 runtime 的 onAction 由创建者装配，本 prop 不重复接入。
   */
  onAction?: (event: ActionEvent) => void;
  /**
   * 解析/校验异常出口。自建 runtime 经此上报；外部 runtime 的错误出口由创建者
   * 装配（RuntimeOptions.onError），本 prop 不重复接入。
   */
  onError?: (error: A2UIError) => void;
}

export function A2UIProvider({
  children,
  runtime: externalRuntime,
  runtimeOptions,
  renderMap,
  catalogRenderMaps,
  catalogRegistry,
  onAction,
  onError,
}: A2UIProviderProps): ReactNode {
  // runtime 只创建一次：renderMap/回调/父重渲变化一律不重建（DESIGN D7）。
  const runtimeRef = useRef<A2UIRuntime | null>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const actionRef = useRef(onAction);
  actionRef.current = onAction;
  if (runtimeRef.current === null) {
    runtimeRef.current =
      externalRuntime ??
      new A2UIRuntime({
        ...(runtimeOptions ?? {}),
        catalogRegistry: catalogRegistry ?? runtimeOptions?.catalogRegistry,
        onAction: (event) => actionRef.current?.(event),
        onError: (error) => errorRef.current?.(error),
      });
  }
  const runtime = runtimeRef.current;

  const ctxRef = useRef<{
    triggerAction: (id: string, sid: string) => void;
    setInputValue: (id: string, sid: string, property: string, value: unknown) => boolean;
  }>({
    triggerAction: () => {},
    setInputValue: () => false,
  });

  // renderMap 缓存按对象引用复用 ReactRenderer；变更即时生效且不重建 runtime。
  const rendererCacheRef = useRef(new WeakMap<RenderMap, ReactRenderer>());
  const rendererFor = (map: RenderMap): ReactRenderer => {
    let renderer = rendererCacheRef.current.get(map);
    if (!renderer) {
      renderer = new ReactRenderer(map);
      rendererCacheRef.current.set(map, renderer);
    }
    return renderer;
  };

  const ctx = useMemo<A2UIContextValue>(
    () => ({
      runtime,
      subscribeRender: (surfaceId, listener) => runtime.subscribeSurfaceRender(surfaceId, listener),
      getLastRoot: (surfaceId) => runtime.getLastRoot(surfaceId),
      renderTree: (root, surfaceId, maxElements, context) => {
        const catalogId = runtime.store.getState().surfaces[surfaceId]?.catalogId;
        const byCatalog =
          catalogRenderMaps && Object.prototype.hasOwnProperty.call(catalogRenderMaps, catalogId)
            ? catalogRenderMaps[catalogId]
            : undefined;
        const renderer = rendererFor(byCatalog ?? renderMap ?? standardRenderMap);
        return renderer.renderTree(root, context ?? ctxRef.current, { maxElements });
      },
      triggerAction: (id, surfaceId) => runtime.triggerAction(id, surfaceId),
      setInputValue: (id, surfaceId, property, value) =>
        runtime.setInputValue(id, surfaceId, property, value),
    }),
    // 配置变更通知消费者重新渲染，但不重建 runtime。
    [runtime, renderMap, catalogRenderMaps],
  );
  ctxRef.current = ctx;

  return createElement(A2UIContext.Provider, { value: ctx }, children);
}

/** 取渲染上下文（须在 A2UIProvider 内使用）。 */
export function useA2UIContext(): A2UIContextValue {
  const ctx = useContext(A2UIContext);
  if (!ctx) throw new Error('useA2UIContext 必须在 <A2UIProvider> 内使用');
  return ctx;
}

/** 取当前 runtime（须在 A2UIProvider 内使用）；兼容既有消费方。 */
export function useA2UI(): A2UIRuntime {
  return useA2UIContext().runtime;
}
