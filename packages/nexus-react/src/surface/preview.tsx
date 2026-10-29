import { createElement, useMemo, type ReactNode } from 'react';
import { buildTree, type SurfaceViewSnapshot } from '@nexus-ui/core';
import { ReactRenderer } from '../renderer';
import type { RenderContext, RenderMap } from '../types';

const readOnlyContext: RenderContext = Object.freeze({
  actionsEnabled: false,
  triggerAction: () => {},
  setInputValue: () => false,
});

export interface A2UIPreviewProps {
  /** 已经 runtime 准入的只读候选；允许组件尚未全部到达。 */
  view: SurfaceViewSnapshot;
  renderMap?: RenderMap;
  maxElements?: number;
}

/** 纯展示，不订阅或写入 Provider/runtime，不授予输入或 action 资格。 */
export function A2UIPreview({ view, renderMap, maxElements }: A2UIPreviewProps): ReactNode {
  const renderer = useMemo(() => new ReactRenderer(renderMap), [renderMap]);
  const root = useMemo(
    () =>
      buildTree(
        Object.fromEntries(view.components.map((c) => [c.id, c])),
        view.surfaceId,
        view.dataModel,
      ),
    [view],
  );
  return createElement(
    'fieldset',
    { className: 'nexus-preview', disabled: true, 'aria-disabled': true, 'aria-label': '界面预览' },
    renderer.renderTree(root, readOnlyContext, { maxElements }),
  );
}
