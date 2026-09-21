/** DateTimeInput：官方 Basic Catalog 时间输入；ISO 字符串经 core 受控写回。 */
import { createElement } from 'react';
import type { ChangeEvent } from 'react';
import { toDisplayString } from '@nexus-ui/core';
import type { RenderContext, RenderFn } from '../types';

type NativeControlType = 'date' | 'time' | 'datetime-local';

interface DateTimeInputViewProps {
  id: string;
  surfaceId: string;
  label: string;
  value: string;
  type: NativeControlType;
  min: string;
  max: string;
  setInputValue: RenderContext['setInputValue'];
}

const labelStyle = {
  display: 'grid',
  gap: 4,
  minWidth: 190,
  fontSize: 13,
  color: '#444',
} as const;

const inputStyle = {
  minHeight: 32,
  padding: '6px 8px',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: '#ccc',
  borderRadius: 4,
  fontFamily: 'inherit',
  fontSize: 'inherit',
  lineHeight: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
} as const;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toNativeValue(value: string, type: NativeControlType): string {
  if (value === '') return '';
  if (type === 'date') return value.slice(0, 10);
  if (type === 'time') return value.slice(0, 5);

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 16);
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(
    parsed.getHours(),
  )}:${pad(parsed.getMinutes())}`;
}

function toIsoValue(value: string, type: NativeControlType): string {
  if (value === '') return '';
  if (type === 'time' && value.length === 5) return `${value}:00`;
  if (type === 'datetime-local' && value.length === 16) return `${value}:00`;
  return value;
}

function DateTimeInputView({
  id,
  surfaceId,
  label,
  value,
  type,
  min,
  max,
  setInputValue,
}: DateTimeInputViewProps) {
  return createElement(
    'label',
    { key: id, style: labelStyle },
    label,
    createElement('input', {
      type,
      value: toNativeValue(value, type),
      min: min === '' ? undefined : toNativeValue(min, type),
      max: max === '' ? undefined : toNativeValue(max, type),
      onChange: (event: ChangeEvent<HTMLInputElement>) =>
        setInputValue(id, surfaceId, toIsoValue(event.target.value, type)),
      style: inputStyle,
      'aria-label': label || '日期时间',
    }),
  );
}

export const DateTimeInput: RenderFn = (vnode, _children, ctx) => {
  const enableDate = vnode.props.enableDate === true;
  const enableTime = vnode.props.enableTime === true;
  const type: NativeControlType =
    enableDate && enableTime ? 'datetime-local' : enableDate ? 'date' : 'time';

  return createElement(DateTimeInputView, {
    key: vnode.id,
    id: vnode.id,
    surfaceId: vnode.surfaceId,
    label: toDisplayString(vnode.props.label),
    value: toDisplayString(vnode.props.value),
    type,
    min: toDisplayString(vnode.props.min),
    max: toDisplayString(vnode.props.max),
    setInputValue: (componentId, _surfaceId, nextValue) =>
      ctx.setInputValue(componentId, vnode.surfaceId, nextValue),
  });
};
