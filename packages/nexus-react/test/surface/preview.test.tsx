import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { A2UIPreview } from '../../src';
import type { SurfaceViewSnapshot } from '@nexus-ui/core';
import type { RenderMap } from '../../src';

afterEach(cleanup);

it('只读预览支持未到齐的引用，标准控件可见禁用', () => {
  const view: SurfaceViewSnapshot = {
    surfaceId: 'candidate',
    catalogId: 'custom',
    dataModel: { name: 'preview' },
    components: [
      { id: 'root', component: 'Column', children: ['input', 'button', 'missing'] },
      { id: 'input', component: 'TextField', value: { path: '/name' } },
      { id: 'button', component: 'Button', child: 'missing' },
    ],
  };
  const { container } = render(createElement(A2UIPreview, { view }));
  expect((screen.getByRole('group') as HTMLFieldSetElement).disabled).toBe(true);
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  expect((container.querySelector('input') as HTMLInputElement).value).toBe('preview');
  expect(container.querySelector('.nexus-surface')).toBeNull();
});

it('自定义控件的 click/key/change 只能得到关闭的出口，无需 Provider 或 client', () => {
  const writeResults: boolean[] = [];
  const observed = vi.fn();
  const map: RenderMap = {
    Custom: (node, _children, ctx) => {
      observed(ctx.actionsEnabled);
      return createElement('input', {
        'aria-label': 'custom preview',
        onClick: () => ctx.triggerAction(node.id, node.surfaceId),
        onKeyDown: () => ctx.triggerAction(node.id, node.surfaceId),
        onChange: () => writeResults.push(ctx.setInputValue(node.id, node.surfaceId, 'score', 4)),
      });
    },
  };
  render(
    createElement(A2UIPreview, {
      view: {
        surfaceId: 's',
        catalogId: 'custom',
        dataModel: {},
        components: [{ id: 'root', component: 'Custom' }],
      },
      renderMap: map,
    }),
  );
  const input = screen.getByLabelText('custom preview');
  fireEvent.click(input);
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.change(input, { target: { value: '4' } });
  expect(observed).toHaveBeenCalledWith(false);
  expect(writeResults).toEqual([false]);
});
