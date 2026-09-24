/**
 * @nexus-ui/core/render —— 扁平邻接表 → VNode 树。
 *
 * 从 id="root" 起，按 `children`（id 列表）/ `child`（单子）递归构建 VNode：
 *   - 子 id 未到达 → 占位 VNode（`type: "__placeholder__"`），实现「乱序到达、渐进填充」；
 *   - 组件属性里的 `{ path }` 经 `resolveDynamic` 解析为真值（展示类绑定）；
 *   - `action` 保持原样（不预解析）——点击时由 runtime.triggerAction 按当前模型解析 context；
 *   - 环检测：子 id 命中当前路径上的祖先（含自身）→ 占位，避免无限递归。
 */
import { resolveDynamic } from '../dataModel';
import { getFirstFailedCheck } from '../checks';
import type { Component, VNode } from '../protocol/types';

const PLACEHOLDER_TYPE = '__placeholder__';
const SKIP_KEYS = new Set(['id', 'component', 'children', 'child', 'checks']);

/** 由某 surface 的扁平组件表构建 VNode 根树；无 root 返回 null。 */
export function buildTree(
  components: Record<string, Component>,
  surfaceId: string,
  model: unknown,
): VNode | null {
  const root = components['root'];
  if (!root) return null;
  return buildNode(root, components, surfaceId, model, new Set([root.id]));
}

function placeholder(id: string, surfaceId: string): VNode {
  return { id, type: PLACEHOLDER_TYPE, props: {}, children: null, surfaceId };
}

function buildNode(
  component: Component,
  all: Record<string, Component>,
  surfaceId: string,
  model: unknown,
  path: Set<string>,
): VNode {
  // 解析属性：跳过结构键；{path} 绑定取真值；action 等复杂对象原样保留（不是 {path} 形）。
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(component)) {
    if (SKIP_KEYS.has(k)) continue;
    props[k] =
      k === 'tabs' && Array.isArray(v)
        ? v.map((tab) =>
            tab && typeof tab === 'object' && 'title' in tab
              ? { ...tab, title: resolveDynamic(tab.title, model) }
              : tab,
          )
        : resolveDynamic(v, model);
  }

  // 子节点：children / child / tabs 都使用扁平组件 id 引用。
  const childIds: string[] = Array.isArray(component.children)
    ? component.children
    : component.child
      ? [component.child]
      : component.tabs
        ? component.tabs.map((tab) => tab.child)
        : [];
  const children: VNode[] | null = childIds.length
    ? childIds.map((id) => {
        if (path.has(id)) return placeholder(id, surfaceId); // 环：指向祖先/自身
        const child = all[id];
        if (!child) return placeholder(id, surfaceId); // 未到达
        const nextPath = new Set(path);
        nextPath.add(id);
        return buildNode(child, all, surfaceId, model, nextPath);
      })
    : null;

  const failedCheck = getFirstFailedCheck(component.checks, model);
  const validation =
    component.checks === undefined
      ? undefined
      : { valid: failedCheck === null, message: failedCheck?.message };
  return {
    id: component.id,
    type: component.component,
    props,
    children,
    surfaceId,
    ...(validation === undefined ? {} : { validation }),
  };
}
