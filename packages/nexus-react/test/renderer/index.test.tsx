import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { A2UIRuntime } from '@nexus-ui/core';
import type { VNode } from '@nexus-ui/core';
import { ReactRenderer } from '../../src/renderer';
import type { RenderContext, RenderMap } from '../../src/types';

afterEach(cleanup);
const ctx: RenderContext = { triggerAction() {}, setInputValue: () => false };
const vnode = (type: string): VNode => ({
  id: 'root',
  type,
  props: {},
  children: null,
  surfaceId: 's',
});

describe('ReactRenderer lookup and configuration boundaries', () => {
  it.each(['__proto__', 'constructor', 'toString'])(
    'degrades inherited name %s from runtime',
    (type) => {
      const runtime = new A2UIRuntime({
        onRender(root) {
          if (root) render(createElement('div', null, new ReactRenderer().renderTree(root, ctx)));
        },
      });
      runtime.dispatch({ version: 'v0.9', createSurface: { surfaceId: 's', catalogId: 'custom' } });
      runtime.dispatch({
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's',
          components: [{ id: 'root', component: type }],
        },
      });
      expect(screen.getByText(`未知组件: ${type}`)).toBeTruthy();
    },
  );

  it('does not invoke inherited custom renderers or non-function entries', () => {
    const inherited = Object.create({
      Widget: () => {
        throw new Error('must not execute');
      },
    }) as RenderMap;
    render(
      createElement('div', null, new ReactRenderer(inherited).renderTree(vnode('Widget'), ctx)),
    );
    expect(screen.getByText('未知组件: Widget')).toBeTruthy();
    const invalid = { Bad: {} } as unknown as RenderMap;
    render(createElement('div', null, new ReactRenderer(invalid).renderTree(vnode('Bad'), ctx)));
    expect(screen.getByText('未知组件: Bad')).toBeTruthy();
  });

  it('allows explicitly registered own names even when Object.prototype has the same name', () => {
    const renderer = new ReactRenderer({
      ['__proto__']: () => createElement('span', null, 'custom renderer'),
    });
    render(createElement('div', null, renderer.renderTree(vnode('__proto__'), ctx)));
    expect(screen.getByText('custom renderer')).toBeTruthy();
  });

  it.each([NaN, Infinity, -Infinity, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid maxElements %s even for an empty tree',
    (maxElements) => {
      expect(() => new ReactRenderer().renderTree(null, ctx, { maxElements })).toThrow(
        /maxElements/,
      );
    },
  );
});

it('共享引用、占位与预算降级无重复 key；patch/重排保持各出现位置的 DOM 身份', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const leaf = { ...vnode('TextField'), id: 'shared', props: { value: 'before' } };
    const sibling = { ...vnode('Text'), id: 'other', props: { text: 'other' } };
    const tree: VNode = { ...vnode('Column'), children: [leaf, sibling, leaf] };
    const renderer = new ReactRenderer();
    const { container, rerender } = render(
      createElement('div', null, renderer.renderTree(tree, ctx)),
    );
    const before = [...container.querySelectorAll('input')];
    expect(before).toHaveLength(2);
    expect(before[0]).not.toBe(before[1]);
    const changed = { ...leaf, props: { value: 'after' } };
    rerender(
      createElement(
        'div',
        null,
        renderer.renderTree({ ...tree, children: [sibling, changed, changed] }, ctx),
      ),
    );
    const after = [...container.querySelectorAll('input')];
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after.map((input) => input.value)).toEqual(['after', 'after']);
    const missing = { ...vnode('__placeholder__'), id: 'missing' };
    const unknown = { ...vnode('Unknown'), id: 'unknown' };
    rerender(
      createElement(
        'div',
        null,
        renderer.renderTree({ ...tree, children: [missing, missing, unknown, unknown] }, ctx),
      ),
    );
    rerender(createElement('div', null, renderer.renderTree(tree, ctx, { maxElements: 1 })));
    expect(
      error.mock.calls.filter((args) =>
        args.some((arg) => /same key|unique.*key/i.test(String(arg))),
      ),
    ).toEqual([]);
  } finally {
    error.mockRestore();
  }
});
