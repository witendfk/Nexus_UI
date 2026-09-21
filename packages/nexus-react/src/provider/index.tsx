/**
 * @nexus-ui/react/provider —— A2UIProvider + useA2UI。
 *
 * Provider 持有 runtime，把 onRender(VNode) 经 ReactRenderer + renderMap 映射成 React 元素；
 * 经 Context 暴露 runtime，供宿主 push 流。action 经 ctx.triggerAction → runtime.triggerAction
 * → onAction 出口（范式无关）。
 */
import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { A2UIRuntime } from '@nexus-ui/core';
import type { A2UIError, ActionEvent, CatalogRegistry, VNode } from '@nexus-ui/core';
import { ReactRenderer } from '../renderer';
import type { RenderMap } from '../types';

const RuntimeContext = createContext<A2UIRuntime | null>(null);

export interface A2UIProviderProps {
  children?: ReactNode;
  /** 自定义 renderMap（默认标准组件）。 */
  renderMap?: RenderMap;
  /** 按 catalogId 选择 renderMap；未匹配 catalog 回退到 renderMap。 */
  catalogRenderMaps?: Record<string, RenderMap>;
  /** 可选 catalog 边界；传入后 runtime 会校验 catalog 与已注册组件 props。 */
  catalogRegistry?: CatalogRegistry;
  /** [seam] action 出口回调（范式无关）；默认不处理。 */
  onAction?: (event: ActionEvent) => void;
  /** 解析/校验异常出口；Catalog 诊断会随 `diagnostics` 透出。 */
  onError?: (error: A2UIError) => void;
}

/**
 * A2UIProvider：持有 runtime，把 onRender 的 VNode 树渲染到 React。
 */
export function A2UIProvider({
  children,
  renderMap,
  catalogRenderMaps,
  catalogRegistry,
  onAction,
  onError,
}: A2UIProviderProps): ReactNode {
  const [tree, setTree] = useState<ReactNode>(null);

  const fallbackRenderer = useMemo(() => new ReactRenderer(renderMap), [renderMap]);
  const renderersByCatalog = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(catalogRenderMaps ?? {}).map(([catalogId, catalogRenderMap]) => [
          catalogId,
          new ReactRenderer(catalogRenderMap),
        ]),
      ),
    [catalogRenderMaps],
  );
  const actionRef = useRef(onAction);
  actionRef.current = onAction;
  const errorRef = useRef(onError);
  errorRef.current = onError;
  // ctx 需引用 runtime、runtime.onRender 需引用 ctx —— 用 ref 解循环依赖。
  const ctxRef = useRef<{
    triggerAction: (id: string, sid: string) => void;
    setInputValue: (id: string, sid: string, value: string | boolean | string[]) => boolean;
  }>({
    triggerAction: () => {},
    setInputValue: () => false,
  });

  const runtime = useMemo(() => {
    const currentRuntime: { current?: A2UIRuntime } = {};
    const runtime = new A2UIRuntime({
      onRender: (root: VNode | null, surfaceId: string) => {
        const catalogId = currentRuntime.current?.store.getState().surfaces[surfaceId]?.catalogId;
        const renderer = (catalogId && renderersByCatalog[catalogId]) || fallbackRenderer;
        setTree(renderer.renderTree(root, ctxRef.current));
      },
      onAction: (e) => actionRef.current?.(e),
      onError: (error) => errorRef.current?.(error),
      catalogRegistry,
    });
    currentRuntime.current = runtime;
    return runtime;
  }, [fallbackRenderer, renderersByCatalog, catalogRegistry]);

  const ctx = useMemo(
    () => ({
      triggerAction: (id: string, surfaceId: string) => runtime.triggerAction(id, surfaceId),
      setInputValue: (id: string, surfaceId: string, value: string | boolean | string[]) =>
        runtime.setInputValue(id, surfaceId, value),
    }),
    [runtime],
  );
  ctxRef.current = ctx;

  return createElement(
    RuntimeContext.Provider,
    { value: runtime },
    createElement('div', { className: 'nexus-surface' }, tree),
    children,
  );
}

/** 取当前 runtime（须在 A2UIProvider 内使用）。 */
export function useA2UI(): A2UIRuntime {
  const rt = useContext(RuntimeContext);
  if (!rt) throw new Error('useA2UI 必须在 <A2UIProvider> 内使用');
  return rt;
}
