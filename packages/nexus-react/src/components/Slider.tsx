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

function SliderView({ id, surfaceId, label, value, min, max, setInputValue }: SliderViewProps) {
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
      }),
      createElement('output', { style: valueStyle }, String(value)),
    ),
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
    setInputValue: (componentId, _surfaceId, nextValue) =>
      ctx.setInputValue(componentId, vnode.surfaceId, nextValue),
  });
};
