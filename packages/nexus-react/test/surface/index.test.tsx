import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, Fragment, StrictMode, useLayoutEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { A2UIRuntime } from '@nexus-ui/core';
import { A2UIProvider, A2UISurface, useA2UI } from '../../src';
import type { RenderMap } from '../../src';

afterEach(cleanup);
function runtimeWithViews(onAction = () => {}) {
  const runtime = new A2UIRuntime({ onAction });
  for (const id of ['a', 'b'])
    runtime.restoreSurfaceView({
      surfaceId: id,
      catalogId: 'basic',
      components: [
        {
          id: 'root',
          component: 'Button',
          child: 'label',
          action: { event: { name: 'submit', context: {} } },
        },
        { id: 'label', component: 'Text', text: id },
      ],
      dataModel: {},
    });
  return runtime;
}

describe('S4 复核 · Provider/Surface', () => {
  it('默认与按 Catalog renderMap 更新即时生效，runtime 和已有视图不重建', () => {
    const runtime = runtimeWithViews();
    const first: RenderMap = { Button: () => createElement('span', null, 'OLD') };
    const second: RenderMap = { Button: () => createElement('span', null, 'NEW') };
    const view = runtime.getSurfaceView('a');
    const tree = (renderMap: RenderMap, catalogRenderMaps?: Record<string, RenderMap>) =>
      createElement(
        A2UIProvider,
        { runtime, renderMap, catalogRenderMaps },
        createElement(A2UISurface, { surfaceId: 'a' }),
      );
    const result = render(tree(first));
    expect(result.container.textContent).to.equal('OLD');
    result.rerender(tree(second));
    expect(result.container.textContent).to.equal('NEW');
    result.rerender(tree(second, { basic: first }));
    expect(result.container.textContent).to.equal('OLD');
    result.rerender(tree(first, { basic: second }));
    expect(result.container.textContent).to.equal('NEW');
    expect(runtime.getSurfaceView('a')).to.equal(view);
  });

  for (const override of [false, true]) {
    it(`自定义 keyboard/change action 统一门控；surface override=${override}`, () => {
      const onAction = vi.fn();
      const runtime = runtimeWithViews(onAction);
      const map: RenderMap = {
        Button: (vnode, _children, ctx) =>
          createElement('input', {
            'aria-label': 'custom',
            'aria-disabled': ctx.actionsEnabled === false,
            onKeyDown: () => ctx.triggerAction(vnode.id, vnode.surfaceId),
            onChange: () => ctx.triggerAction(vnode.id, vnode.surfaceId),
          }),
      };
      const tree = (enabled: boolean) =>
        createElement(
          A2UIProvider,
          { runtime, renderMap: override ? undefined : map },
          createElement(A2UISurface, {
            surfaceId: 'a',
            actionsEnabled: enabled,
            renderMap: override ? map : undefined,
          }),
        );
      const result = render(tree(false));
      const field = screen.getByLabelText('custom');
      expect(field.getAttribute('aria-disabled')).to.equal('true');
      fireEvent.keyDown(field, { key: 'Enter' });
      fireEvent.change(field, { target: { value: 'one' } });
      expect(onAction).not.toHaveBeenCalled();
      result.rerender(tree(true));
      fireEvent.keyDown(field, { key: 'Enter' });
      fireEvent.change(field, { target: { value: 'two' } });
      expect(onAction).toHaveBeenCalledTimes(2);
    });
  }

  it('标准按钮显示禁用且不触发 action；另一个 surface 仍可交互', () => {
    const onAction = vi.fn();
    const runtime = runtimeWithViews(onAction);
    render(
      createElement(
        A2UIProvider,
        { runtime },
        createElement(
          Fragment,
          null,
          createElement(A2UISurface, { surfaceId: 'a', actionsEnabled: false }),
          createElement(A2UISurface, { surfaceId: 'b' }),
        ),
      ),
    );
    expect((screen.getByRole('button', { name: 'a' }) as HTMLButtonElement).disabled).to.equal(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'a' }));
    fireEvent.click(screen.getByRole('button', { name: 'b' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][0].surfaceId).to.equal('b');
  });

  it('受控删除实时卸载，surface 切换直接读取新快照；StrictMode 卸载释放订阅', () => {
    const runtime = runtimeWithViews();
    const subscribe = runtime.subscribeSurfaceRender.bind(runtime);
    let active = 0;
    vi.spyOn(runtime, 'subscribeSurfaceRender').mockImplementation((id, callback) => {
      active++;
      const off = subscribe(id, callback);
      return () => {
        active--;
        off();
      };
    });
    const tree = (id: string) =>
      createElement(
        StrictMode,
        null,
        createElement(A2UIProvider, { runtime }, createElement(A2UISurface, { surfaceId: id })),
      );
    const result = render(tree('a'));
    expect(active).to.equal(1);
    result.rerender(tree('b'));
    expect(screen.queryByRole('button', { name: 'a' })).to.equal(null);
    expect(screen.getByRole('button', { name: 'b' })).to.exist;
    act(() => runtime.removeSurfaceView('b'));
    expect(result.container.textContent).to.equal('');
    result.unmount();
    expect(active).to.equal(0);
    expect(runtime.getSurfaceView('a')).to.exist;
  });

  it('render 与订阅建立间发生更新也能读取新状态', () => {
    const runtime = runtimeWithViews();
    function UpdateBeforeEffects() {
      useLayoutEffect(() => {
        runtime.dispatch({
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'a',
            components: [{ id: 'label', component: 'Text', text: 'latest' }],
          },
        });
      }, []);
      return null;
    }
    render(
      createElement(
        A2UIProvider,
        { runtime },
        createElement(
          Fragment,
          null,
          createElement(A2UISurface, { surfaceId: 'a' }),
          createElement(UpdateBeforeEffects),
        ),
      ),
    );
    expect(screen.getByRole('button', { name: 'latest' })).to.exist;
  });

  it('自建 runtime 的 callbacks 更新后生效，配置重渲不替换 runtime', () => {
    const first = vi.fn(),
      second = vi.fn();
    let observed: A2UIRuntime | undefined;
    function Capture() {
      observed = useA2UI();
      return null;
    }
    const tree = (onAction: () => void) =>
      createElement(A2UIProvider, { onAction }, createElement(Capture));
    const result = render(tree(first));
    const runtime = observed!;
    runtime.restoreSurfaceView(runtimeWithViews().getSurfaceView('a')!);
    result.rerender(tree(second));
    expect(observed).to.equal(runtime);
    runtime.triggerAction('root', 'a');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
