/** CheckBox：官方 Basic Catalog 布尔输入组件；value 绑定经 core 受控写回。 */
import { createElement } from 'react';
import type { ChangeEvent } from 'react';
import { toDisplayString } from '@nexus-ui/core';
import type { RenderContext, RenderFn } from '../types';

interface CheckBoxViewProps {
  id: string;
  surfaceId: string;
  label: string;
  checked: boolean;
  setInputValue: RenderContext['setInputValue'];
}

const labelStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 180,
  minHeight: 32,
  fontSize: 13,
  color: '#444',
  cursor: 'pointer',
} as const;

const inputStyle = {
  width: 16,
  height: 16,
  margin: 0,
  flex: '0 0 auto',
  accentColor: '#2563eb',
} as const;

function CheckBoxView({ id, surfaceId, label, checked, setInputValue }: CheckBoxViewProps) {
  return createElement(
    'label',
    { key: id, style: labelStyle },
    createElement('input', {
      type: 'checkbox',
      checked,
      onChange: (event: ChangeEvent<HTMLInputElement>) =>
        setInputValue(id, surfaceId, event.target.checked),
      style: inputStyle,
    }),
    createElement('span', null, label),
  );
}

export const CheckBox: RenderFn = (vnode, _children, ctx) =>
  createElement(CheckBoxView, {
    key: vnode.id,
    id: vnode.id,
    surfaceId: vnode.surfaceId,
    label: toDisplayString(vnode.props.label),
    checked: vnode.props.value === true,
    setInputValue: (componentId, _surfaceId, nextValue) =>
      ctx.setInputValue(componentId, vnode.surfaceId, nextValue),
  });
