/** Slider：官方 Basic Catalog 数值输入；value 绑定经 core 受控写回。 */
import { createElement } from 'react';
import type { ChangeEvent } from 'react';
import { toDisplayString } from '@nexus-ui/core';
import type { RenderContext, RenderFn } from '../types';

interface SliderViewProps {
  id: string;
  surfaceId: string;
  label: string;
  value: number;
  min: number;
  max: number;
  checkMessage?: string;
  setInputValue: RenderContext['setInputValue'];
}

const labelStyle = {
  display: 'grid',
  gap: 6,
  minWidth: 190,
  fontSize: 13,
  color: '#444',
} as const;

const controlRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
} as const;

const sliderStyle = {
  flex: 1,
  minWidth: 140,
  margin: 0,
  accentColor: '#0f766e',
} as const;

const valueStyle = {
  minWidth: 44,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  color: '#334155',
} as const;

const errorStyle = {
  color: '#dc2626',
  fontSize: 12,
  lineHeight: 1.4,
} as const;

function SliderView({
  id,
  surfaceId,
  label,
  value,
  min,
  max,
  checkMessage,
  setInputValue,
}: SliderViewProps) {
  return createElement(
    'label',
    { key: id, style: labelStyle },
    label,
    createElement(
      'span',
      { style: controlRowStyle },
      createElement('input', {
        type: 'range',
        value,
        min,
        max,
        step: 'any',
        onChange: (event: ChangeEvent<HTMLInputElement>) =>
          setInputValue(id, surfaceId, Number(event.target.value)),
        style: sliderStyle,
        'aria-label': label || '数值',
        'aria-invalid': Boolean(checkMessage),
        'aria-describedby': checkMessage ? `${id}-error` : undefined,
      }),
      createElement('output', { style: valueStyle }, String(value)),
    ),
    checkMessage
      ? createElement('span', { id: `${id}-error`, style: errorStyle }, checkMessage)
      : null,
  );
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export const Slider: RenderFn = (vnode, _children, ctx) => {
  const min = toFiniteNumber(vnode.props.min, 0);
  const max = toFiniteNumber(vnode.props.max, min + 1);
  const value = toFiniteNumber(vnode.props.value, min);

  return createElement(SliderView, {
    key: vnode.id,
    id: vnode.id,
    surfaceId: vnode.surfaceId,
    label: toDisplayString(vnode.props.label),
    value,
    min,
    max,
    checkMessage: vnode.validation?.message,
    setInputValue: (componentId, _surfaceId, nextValue) =>
      ctx.setInputValue(componentId, vnode.surfaceId, nextValue),
  });
};
