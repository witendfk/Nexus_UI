import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { buildTree } from '@nexus-ui/core';
import type { Component, VNode } from '@nexus-ui/core';
import { ReactRenderer } from '../src/renderer';
import type { RenderContext } from '../src/types';

afterEach(cleanup);

const ctx: RenderContext = {
  triggerAction: () => {},
  setInputValue: () => false,
};

const mount = (root: VNode | null, options?: Parameters<ReactRenderer['renderTree']>[2]) => {
  const renderer = new ReactRenderer();
  const onLimit = vi.fn();
  const tree = renderer.renderTree(root, ctx, { ...options, onLimit });
  render(createElement('div', null, tree));
  return { onLimit };
};

/** depth 层菱形 DAG：唯一 VNode 线性（2·depth+1），引用数 2^depth 指数。 */
function diamondComponents(depth: number): Record<string, Component> {
  const components: Record<string, Component> = {
    root: { id: 'root', component: 'Column', children: [`a0`, `b0`] },
  };
  const id = (level: number, branch: 'a' | 'b') =>
    level >= depth ? 'leaf' : `${branch}${level}`;
  for (let level = 0; level < depth; level++) {
    for (const branch of ['a', 'b'] as const) {
      components[id(level, branch)] = {
        id: id(level, branch),
        component: 'Column',
        children: [id(level + 1, 'a'), id(level + 1, 'b')],
      };
    }
  }
  components['leaf'] = { id: 'leaf', component: 'Text', text: 'bottom-reached' };
  return components;
}

describe('ReactRenderer · L0-03 元素展开预算', () => {
  it('证伪：22 层菱形 DAG（>4M 引用）在有界预算下完成渲染并恰好上报一次', () => {
    // 旧实现按引用逐个 createElement：2^22 ≈ 4.2M 元素，测试必然挂起/崩溃
    const root = buildTree(diamondComponents(22), 's', undefined);
    const { onLimit } = mount(root);
    expect(onLimit).toHaveBeenCalledTimes(1);
    expect(onLimit.mock.calls[0]![0]!.limit).toBe(10_000);
    // 预算内 DFS 先深入到叶：共享子树内容仍正确呈现
    expect(screen.getAllByText('bottom-reached').length).toBeGreaterThan(0);
  });

  it('预算内普通共享子树在两个引用处都正确显示', () => {
    const components: Record<string, Component> = {
      root: { id: 'root', component: 'Column', children: ['x', 'y'] },
      x: { id: 'x', component: 'Column', child: 'shared' },
      y: { id: 'y', component: 'Column', child: 'shared' },
      shared: { id: 'shared', component: 'Text', text: 'shared-content' },
    };
    const root = buildTree(components, 's', undefined);
    const { onLimit } = mount(root);
    expect(onLimit).not.toHaveBeenCalled();
    expect(screen.getAllByText('shared-content')).toHaveLength(2);
  });

  it('小预算：超限引用统一降级为「预算已用尽」占位且 onLimit 恰好一次', () => {
    const components: Record<string, Component> = {
      root: { id: 'root', component: 'Column', children: ['a', 'b', 'c', 'd', 'e'] },
      a: { id: 'a', component: 'Text', text: 'A' },
      b: { id: 'b', component: 'Text', text: 'B' },
      c: { id: 'c', component: 'Text', text: 'C' },
      d: { id: 'd', component: 'Text', text: 'D' },
      e: { id: 'e', component: 'Text', text: 'E' },
    };
    const root = buildTree(components, 's', undefined);
    const { onLimit } = mount(root, { maxElements: 3 });
    expect(onLimit).toHaveBeenCalledTimes(1);
    expect(onLimit.mock.calls[0]![0]!.limit).toBe(3);
    // 超限引用各自降级为预算占位，内容统一
    const exhausted = screen.getAllByText('渲染元素预算已用尽');
    expect(exhausted.length).toBeGreaterThan(0);
  });

  it('占位/未知组件同样计入预算（缺失引用与未知类型不能绕过）', () => {
    const components: Record<string, Component> = {
      root: { id: 'root', component: 'Column', children: ['ghost', 'mystery', 't'] },
      mystery: { id: 'mystery', component: 'NotInCatalog' },
      t: { id: 't', component: 'Text', text: 'T' },
    };
    const root = buildTree(components, 's', undefined);
    const { onLimit } = mount(root, { maxElements: 3 });
    expect(onLimit).toHaveBeenCalledTimes(1);
  });
});
