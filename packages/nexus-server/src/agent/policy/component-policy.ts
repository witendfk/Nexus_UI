import type { Component } from '@nexus-ui/core';

export function getDataBindingPath(value: unknown): string | null {
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as { path?: unknown }).path === 'string'
  ) {
    return (value as { path: string }).path;
  }
  return null;
}

function isDynamicString(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    (typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      typeof (value as { path?: unknown }).path === 'string')
  );
}

function isIsoDateTimeLiteral(value: string): boolean {
  const date = /^\d{4}-\d{2}-\d{2}$/;
  const time = /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
  const dateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
  return date.test(value) || time.test(value) || dateTime.test(value);
}

/** Host semantic constraints not yet expressible by the deterministic props schema. */
export function validateComponentPolicy(component: Component): string | null {
  if (component.component === 'TextField') {
    const validationRegexp = component.validationRegexp;
    if (validationRegexp === undefined) return null;
    if (typeof validationRegexp !== 'string') {
      return 'TextField.validationRegexp 必须是字符串';
    }
    try {
      new RegExp(validationRegexp);
    } catch {
      return 'TextField.validationRegexp 必须是合法正则表达式';
    }
    return null;
  }

  if (component.component === 'Slider') {
    const min = component.min;
    const max = component.max;
    if (
      typeof min === 'number' &&
      Number.isFinite(min) &&
      typeof max === 'number' &&
      Number.isFinite(max) &&
      min >= max
    ) {
      return 'Slider.min 必须小于 max';
    }
    return null;
  }

  if (component.component === 'DateTimeInput') {
    const enableDate = component.enableDate;
    const enableTime = component.enableTime;
    if (enableDate !== true && enableTime !== true) {
      return 'DateTimeInput.enableDate/enableTime 至少一个为 true';
    }
    for (const key of ['min', 'max'] as const) {
      const value = component[key];
      if (value === undefined) continue;
      if (!isDynamicString(value)) {
        return `DateTimeInput.${key} 必须是 ISO 8601 字符串或 { path } 绑定`;
      }
      if (typeof value === 'string' && !isIsoDateTimeLiteral(value)) {
        return `DateTimeInput.${key} 必须是 ISO 8601 date/time/date-time 字符串`;
      }
    }
  }

  return null;
}
