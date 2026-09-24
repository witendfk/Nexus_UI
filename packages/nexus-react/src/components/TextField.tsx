/** TextField：官方 Basic Catalog 输入组件；value 绑定经 core 受控写回。 */
import { createElement } from 'react';
import { useMemo, useState } from 'react';
import type { ChangeEvent, FocusEvent } from 'react';
import { toDisplayString } from '@nexus-ui/core';
import type { RenderContext, RenderFn } from '../types';

const labelStyle = {
  display: 'grid',
  gap: 4,
  minWidth: 180,
  fontSize: 13,
  color: '#444',
} as const;

const inputStyle = {
  padding: '8px 10px',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: '#ccc',
  borderRadius: 4,
  font: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
} as const;

const invalidInputStyle = {
  ...inputStyle,
  borderColor: '#dc2626',
} as const;

const errorStyle = {
  color: '#dc2626',
  fontSize: 12,
  lineHeight: 1.4,
} as const;

interface TextFieldViewProps {
  id: string;
  surfaceId: string;
  label: string;
  value: string;
  variant: string;
  validationRegexp?: unknown;
  checkMessage?: string;
  setInputValue: RenderContext['setInputValue'];
}

function TextFieldView({
  id,
  surfaceId,
  label,
  value,
  variant,
  validationRegexp,
  checkMessage,
  setInputValue,
}: TextFieldViewProps) {
  const [touched, setTouched] = useState(false);
  const validationPattern = useMemo(() => {
    if (typeof validationRegexp !== 'string') return null;
    try {
      return new RegExp(validationRegexp);
    } catch {
      return null;
    }
  }, [validationRegexp]);
  const formatInvalid = touched && validationPattern !== null && !validationPattern.test(value);
  const invalid = Boolean(checkMessage) || formatInvalid;
  const onChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setInputValue(id, surfaceId, event.target.value);
  };
  const onBlur = (_event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setTouched(true);
  };

  const errorId = `${id}-error`;
  const describedBy = invalid ? errorId : undefined;
  const commonProps = {
    id,
    value,
    onChange,
    onBlur,
    'aria-invalid': invalid,
    'aria-describedby': describedBy,
  };
  const control =
    variant === 'longText'
      ? createElement('textarea', {
          ...commonProps,
          rows: 3,
          style: invalid
            ? { ...invalidInputStyle, resize: 'vertical' as const }
            : { ...inputStyle, resize: 'vertical' as const },
        })
      : createElement('input', {
          ...commonProps,
          type: variant === 'number' ? 'number' : variant === 'obscured' ? 'password' : 'text',
          style: invalid ? invalidInputStyle : inputStyle,
        });

  return createElement(
    'div',
    { key: id, style: labelStyle },
    createElement('label', { htmlFor: id }, label),
    control,
    invalid
      ? createElement('span', { id: errorId, style: errorStyle }, checkMessage || '格式不符合要求')
      : null,
  );
}

export const TextField: RenderFn = (vnode, _children, ctx) => {
  const label = toDisplayString(vnode.props.label);
  const value =
    vnode.props.value === undefined || vnode.props.value === null
      ? ''
      : toDisplayString(vnode.props.value);
  const variant = String(vnode.props.variant ?? 'shortText');

  return createElement(TextFieldView, {
    key: vnode.id,
    id: vnode.id,
    surfaceId: vnode.surfaceId,
    label,
    value,
    variant,
    validationRegexp: vnode.props.validationRegexp,
    checkMessage: vnode.validation?.message,
    setInputValue: (componentId, _surfaceId, nextValue) =>
      ctx.setInputValue(componentId, vnode.surfaceId, nextValue),
  });
};
