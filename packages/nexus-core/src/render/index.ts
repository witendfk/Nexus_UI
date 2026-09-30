/**
 * @nexus-ui/core/render —— 扁平邻接表 → VNode 树。
 *
 * 从 id="root" 起，按 `children`（id 列表）/ `child`（单子）/ `tabs` 迭代构建 VNode
 * （显式栈 DFS，不用递归——深链不会耗尽调用栈）：
 *   - 子 id 未到达 → 占位 VNode（`type: "__placeholder__"`），实现「乱序到达、渐进填充」；
 *   - 组件属性里的 `{ path }` 经 `resolveDynamic` 解析为真值（展示类绑定）；
 *   - `action` 保持原样（不预解析）——点击时由 runtime.triggerAction 按当前模型解析 context；
 *   - 环检测：子 id 命中当前路径上的祖先（含自身）→ 占位，避免无限构建；
 *   - 共享子树 memoize：同一组件 id 在一次构建内只展开一次（扁平表合法允许 DAG，
 *     不设防时菱形链成本 2ⁿ，小消息即可 OOM）；
 *   - 双预算：maxNodes 限制「唯一 VNode + 占位」的创建总数（缺失引用与超限占位同样
 *     计入），maxDepth 限制链式深度——React 消费路径按引用展开的成本由此有界。
 *   - 任一预算耗尽后其余引用以占位呈现，onLimit 恰好上报一次。
 */
import { resolveDynamic } from '../dataModel';
import { getFirstFailedCheck } from '../checks';
import type { Component, VNode } from '../protocol/types';

const PLACEHOLDER_TYPE = '__placeholder__';
const SKIP_KEYS = new Set(['id', 'component', 'children', 'child', 'checks']);

export interface BuildTreeLimitInfo {
  limit: number;
  /** nodes：VNode（含占位）总数触顶；depth：链式深度触顶。 */
  reason: 'nodes' | 'depth';
}

export interface BuildTreeOptions {
  /**
   * 单次构建允许创建的 VNode 数量上限（默认 10000）。占位节点（未到达引用、
   * 环、超限降级）一并计入。超出后其余引用以占位节点呈现，并通过 onLimit
   * 恰好上报一次；已建成的节点经 memo 共享，不受影响。
   */
  maxNodes?: number;
  /** 链式深度上限（默认 1000）：超深链的更深层以占位呈现，保证下游 React 消费路径安全。 */
  maxDepth?: number;
  /** 构建触发数量/深度上限时回调（每次构建至多一次），供运行时转为结构化诊断。 */
  onLimit?: (info: BuildTreeLimitInfo) => void;
}

const DEFAULT_MAX_NODES = 10_000;
const DEFAULT_MAX_DEPTH = 1_000;

/** 构建中的栈帧：children 数组由子节点完成后回填（后序 memo.set）。 */
interface Frame {
  childIds: string[];
  index: number;
  vnode: VNode;
  depth: number;
}

/** 由某 surface 的扁平组件表构建 VNode 根树；无 root 返回 null。 */
export function buildTree(
  components: Record<string, Component>,
  surfaceId: string,
  model: unknown,
  options: BuildTreeOptions = {},
): VNode | null {
  const root = components['root'];
  if (!root) return null;

  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const memo = new Map<string, VNode>();
  const inPath = new Set<string>();
  let built = 0;
  let limitReported = false;

  const reportLimit = (reason: BuildTreeLimitInfo['reason'], limit: number): void => {
    if (limitReported) return;
    limitReported = true;
    options.onLimit?.({ reason, limit });
  };

  /** 预算内创建占位（占位同样消耗 VNode 预算）；超预算后仍以占位降级，但不再计数。 */
  const allocatePlaceholder = (id: string): VNode => {
    if (built < maxNodes) built += 1;
    else reportLimit('nodes', maxNodes);
    return placeholder(id, surfaceId);
  };

  // 解析属性：跳过结构键；{path} 绑定取真值；action 等复杂对象原样保留（不是 {path} 形）。
  const buildProps = (component: Component): Record<string, unknown> => {
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
    return props;
  };

  const childIdsOf = (component: Component): string[] =>
    Array.isArray(component.children)
      ? component.children
      : component.child
        ? [component.child]
        : component.tabs
          ? component.tabs.map((tab) => tab.child)
          : [];

  const buildShell = (component: Component): VNode => {
    built += 1;
    const failedCheck = getFirstFailedCheck(component.checks, model);
    const validation =
      component.checks === undefined
        ? undefined
        : { valid: failedCheck === null, message: failedCheck?.message };
    const childIds = childIdsOf(component);
    return {
      id: component.id,
      type: component.component,
      props: buildProps(component),
      children: childIds.length ? [] : null,
      surfaceId,
      ...(validation === undefined ? {} : { validation }),
    };
  };

  const rootVNode = buildShell(root);
  inPath.add(root.id);
  const stack: Frame[] = [
    { childIds: childIdsOf(root), index: 0, vnode: rootVNode, depth: 1 },
  ];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    if (frame.index >= frame.childIds.length) {
      // 子树完成：后序入 memo，保证 memo 命中的节点一定是完整子树
      memo.set(frame.vnode.id, frame.vnode);
      inPath.delete(frame.vnode.id);
      stack.pop();
      continue;
    }
    const childId = frame.childIds[frame.index]!;
    frame.index += 1;

    if (inPath.has(childId)) {
      frame.vnode.children!.push(placeholder(childId, surfaceId)); // 环：指向祖先/自身
      continue;
    }
    const memoized = memo.get(childId);
    if (memoized) {
      frame.vnode.children!.push(memoized); // 共享子树（DAG 合法）
      continue;
    }
    const childComponent = components[childId];
    if (!childComponent) {
      frame.vnode.children!.push(allocatePlaceholder(childId)); // 未到达
      continue;
    }
    const childDepth = frame.depth + 1;
    if (childDepth > maxDepth) {
      reportLimit('depth', maxDepth);
      frame.vnode.children!.push(placeholder(childId, surfaceId));
      continue;
    }
    if (built >= maxNodes) {
      reportLimit('nodes', maxNodes);
      frame.vnode.children!.push(placeholder(childId, surfaceId));
      continue;
    }

    const childVNode = buildShell(childComponent);
    frame.vnode.children!.push(childVNode);
    inPath.add(childId);
    stack.push({ childIds: childIdsOf(childComponent), index: 0, vnode: childVNode, depth: childDepth });
  }

  return rootVNode;
}

function placeholder(id: string, surfaceId: string): VNode {
  return { id, type: PLACEHOLDER_TYPE, props: {}, children: null, surfaceId };
}
