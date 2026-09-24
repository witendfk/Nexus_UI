/** A2UI Checkable 最小求值器：只实现 Basic Catalog 的确定性校验函数。 */
import { getByPath, resolveDynamic } from '../dataModel';
import type { CheckRule, LocalFunctionCall } from '../protocol/types';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isDataBinding(value: unknown): value is { path: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as { path?: unknown }).path === 'string'
  );
}

function isFunctionCall(value: unknown): value is LocalFunctionCall {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { call?: unknown }).call === 'string'
  );
}

function evaluateRequired(value: unknown): boolean {
  return (
    value !== null &&
    value !== undefined &&
    value !== '' &&
    !(Array.isArray(value) && value.length === 0)
  );
}

function evaluateRegex(value: unknown, pattern: unknown): boolean {
  if (typeof value !== 'string' || typeof pattern !== 'string') return false;
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

function evaluateLength(value: unknown, min: unknown, max: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (min !== undefined && (typeof min !== 'number' || value.length < min)) return false;
  if (max !== undefined && (typeof max !== 'number' || value.length > max)) return false;
  return true;
}

function evaluateNumeric(value: unknown, min: unknown, max: unknown): boolean {
  const numericValue =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(numericValue)) return false;
  if (min !== undefined && (typeof min !== 'number' || numericValue < min)) return false;
  if (max !== undefined && (typeof max !== 'number' || numericValue > max)) return false;
  return true;
}

function evaluateFunction(condition: LocalFunctionCall, model: unknown): boolean {
  const args = condition.args ?? {};
  const value = resolveDynamic(args.value, model);
  switch (condition.call) {
    case 'required':
      return evaluateRequired(value);
    case 'regex':
      return evaluateRegex(value, args.pattern);
    case 'length':
      return evaluateLength(value, args.min, args.max);
    case 'numeric':
      return evaluateNumeric(value, args.min, args.max);
    case 'email':
      return typeof value === 'string' && EMAIL_PATTERN.test(value);
    default:
      return false;
  }
}

/** 返回第一条失败的 CheckRule；没有 checks 或全部通过时返回 null。 */
export function getFirstFailedCheck(checks: unknown, model: unknown): CheckRule | null {
  if (!Array.isArray(checks)) return null;

  for (const check of checks) {
    if (!check || typeof check !== 'object' || Array.isArray(check)) continue;
    const rule = check as CheckRule;
    const condition = rule.condition;
    const valid = isFunctionCall(condition)
      ? evaluateFunction(condition, model)
      : isDataBinding(condition)
        ? getByPath(model, condition.path) === true
        : condition === true;
    if (!valid) return rule;
  }
  return null;
}
