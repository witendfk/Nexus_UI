/** ChoicePicker：官方 Basic Catalog 选项输入；value 绑定经 core 受控写回。 */
import { createElement } from 'react';
import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { toDisplayString } from '@nexus-ui/core';
import type { RenderContext, RenderFn } from '../types';

interface ChoiceOption {
  label: string;
  value: string;
}

interface ChoicePickerViewProps {
  id: string;
  surfaceId: string;
  label: string;
  options: ChoiceOption[];
  selectedValues: string[];
  variant: 'multipleSelection' | 'mutuallyExclusive';
  displayStyle: 'checkbox' | 'chips';
  filterable: boolean;
  setInputValue: RenderContext['setInputValue'];
}

const groupStyle = {
  display: 'grid',
  gap: 8,
  minWidth: 180,
  margin: 0,
  padding: 0,
  border: 'none',
} as const;

const legendStyle = {
  padding: 0,
  marginBottom: 2,
  fontSize: 13,
  color: '#444',
} as const;

const optionListStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  margin: 0,
  padding: 0,
  listStyle: 'none',
} as const;

const optionButtonStyle = {
  minHeight: 32,
  padding: '6px 10px',
  borderWidth: 1,
  borderStyle: 'solid',
  borderRadius: 4,
  fontFamily: 'inherit',
  fontSize: 'inherit',
  lineHeight: 'inherit',
  cursor: 'pointer',
} as const;

const checkboxOptionStyle = {
  ...optionButtonStyle,
  borderColor: '#cbd5e1',
  backgroundColor: '#fff',
  color: '#334155',
} as const;

const chipOptionStyle = {
  ...optionButtonStyle,
  borderColor: 'transparent',
  borderRadius: 999,
  backgroundColor: '#e2e8f0',
  color: '#1e293b',
} as const;

const selectedCheckboxStyle = {
  ...checkboxOptionStyle,
  borderColor: '#0f766e',
  backgroundColor: '#ccfbf1',
  color: '#0f766e',
  fontWeight: 650,
} as const;

const selectedChipStyle = {
  ...chipOptionStyle,
  backgroundColor: '#0f766e',
  color: '#fff',
  fontWeight: 650,
} as const;

const filterInputStyle = {
  padding: '7px 10px',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: '#cbd5e1',
  borderRadius: 4,
  fontFamily: 'inherit',
  fontSize: 'inherit',
  lineHeight: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
} as const;

function selectValues(
  current: string[],
  nextValue: string,
  variant: ChoicePickerViewProps['variant'],
): string[] {
  if (variant === 'mutuallyExclusive') return [nextValue];
  return current.includes(nextValue)
    ? current.filter((value) => value !== nextValue)
    : [...current, nextValue];
}

function ChoicePickerView({
  id,
  surfaceId,
  label,
  options,
  selectedValues,
  variant,
  displayStyle,
  filterable,
  setInputValue,
}: ChoicePickerViewProps) {
  const [filter, setFilter] = useState('');
  const visibleOptions = useMemo(() => {
    if (!filterable || filter.trim() === '') return options;
    const keyword = filter.trim().toLowerCase();
    return options.filter((option) => option.label.toLowerCase().includes(keyword));
  }, [filter, filterable, options]);

  return createElement(
    'fieldset',
    { key: id, style: groupStyle },
    label ? createElement('legend', { style: legendStyle }, label) : null,
    filterable
      ? createElement('input', {
          type: 'search',
          value: filter,
          onChange: (event: ChangeEvent<HTMLInputElement>) => setFilter(event.target.value),
          placeholder: '筛选选项',
          'aria-label': `${label || '选项'}筛选`,
          style: filterInputStyle,
        })
      : null,
    createElement(
      'ul',
      { style: optionListStyle },
      ...visibleOptions.map((option) => {
        const selected = selectedValues.includes(option.value);
        return createElement(
          'li',
          { key: option.value },
          createElement(
            'button',
            {
              type: 'button',
              'aria-pressed': selected,
              style: selected
                ? displayStyle === 'chips'
                  ? selectedChipStyle
                  : selectedCheckboxStyle
                : displayStyle === 'chips'
                  ? chipOptionStyle
                  : checkboxOptionStyle,
              onClick: () =>
                setInputValue(id, surfaceId, selectValues(selectedValues, option.value, variant)),
            },
            option.label,
          ),
        );
      }),
    ),
  );
}

export const ChoicePicker: RenderFn = (vnode, _children, ctx) => {
  const rawOptions = Array.isArray(vnode.props.options) ? vnode.props.options : [];
  const options = rawOptions.map((option, index) => {
    const record = option as Record<string, unknown>;
    return {
      label: toDisplayString(record.label) || `选项 ${index + 1}`,
      value: typeof record.value === 'string' ? record.value : String(index),
    };
  });
  const rawValue = vnode.props.value;

  return createElement(ChoicePickerView, {
    key: vnode.id,
    id: vnode.id,
    surfaceId: vnode.surfaceId,
    label: toDisplayString(vnode.props.label),
    options,
    selectedValues:
      Array.isArray(rawValue) && rawValue.every((item) => typeof item === 'string') ? rawValue : [],
    variant:
      vnode.props.variant === 'multipleSelection' ? 'multipleSelection' : 'mutuallyExclusive',
    displayStyle: vnode.props.displayStyle === 'chips' ? 'chips' : 'checkbox',
    filterable: vnode.props.filterable === true,
    setInputValue: (componentId, _surfaceId, nextValue) =>
      ctx.setInputValue(componentId, vnode.surfaceId, nextValue),
  });
};
