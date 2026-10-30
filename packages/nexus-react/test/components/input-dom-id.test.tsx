import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { VNode } from '@nexus-ui/core';
import { Slider, TextField, type RenderFn } from '../../dist/index.js';

afterEach(cleanup);

for (const [name, renderControl, props] of [
  ['TextField', TextField, { value: 'before' }],
  ['TextField longText', TextField, { value: 'before', variant: 'longText' }],
  ['Slider', Slider, { value: 1, min: 0, max: 10 }],
] as const satisfies ReadonlyArray<readonly [string, RenderFn, Record<string, unknown>]>) {
  it(`${name}：同名组件跨 surface/重复挂载的标签和错误关联独立，patch 保持 DOM 身份`, () => {
    const setInputValue = vi.fn(() => true);
    const ctx = { triggerAction() {}, setInputValue };
    const tree = (updated: boolean) =>
      createElement(
        'div',
        null,
        ...['a', 'b', 'a'].map((surfaceId, index) => {
          const node: VNode = {
            id: 'field',
            type: name === 'Slider' ? 'Slider' : 'TextField',
            surfaceId,
            children: null,
            props: { ...props, label: `field-${index}`, ...(updated ? { value: 2 } : {}) },
            validation: { valid: false, message: `error-${index}` },
          };
          return createElement('div', { key: index }, renderControl(node, [], ctx));
        }),
      );
    const result = render(tree(false));
    const controls = [...result.container.querySelectorAll('input, textarea')];
    const ids = controls.map((control) => control.id);
    const errors = controls.map((control) => control.getAttribute('aria-describedby'));
    expect(new Set(errors).size).to.equal(3);
    controls.forEach((control, index) => {
      const wrapper = control.closest('label') ?? control.parentElement!;
      const label = wrapper.matches('label') ? wrapper : wrapper.querySelector('label');
      expect((label as HTMLLabelElement).control).to.equal(control);
      expect(document.getElementById(errors[index]!)?.textContent).to.equal(`error-${index}`);
    });
    if (name !== 'Slider') expect(new Set(ids).size).to.equal(3);
    fireEvent.change(controls[1], { target: { value: name === 'Slider' ? '4' : 'typed' } });
    expect(setInputValue).toHaveBeenCalledWith(
      'field',
      'b',
      'value',
      name === 'Slider' ? 4 : 'typed',
    );
    result.rerender(tree(true));
    const after = [...result.container.querySelectorAll('input, textarea')];
    after.forEach((control, index) => {
      expect(control).to.equal(controls[index]);
      expect(control.id).to.equal(ids[index]);
      expect(control.getAttribute('aria-describedby')).to.equal(errors[index]);
    });
  });
}
