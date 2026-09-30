/** A2UI Checkable 最小求值器：只实现 Basic Catalog 的确定性校验函数。 */
import { getByPath, resolveDynamic } from '../dataModel';
import type { CheckRule, LocalFunctionCall } from '../protocol/types';
import {
  checkRegexSyntax,
  compileBoundedRegExp,
  type SafeRegExp,
} from './safe-regex';

export { MAX_REGEX_INPUT_LENGTH, checkRegexSyntax } from './safe-regex';
export type { SafeRegExp } from './safe-regex';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Agent 侧正则的长度上限：灾难性回溯的 pattern 往往很短，超长一律拒绝。 */
export const MAX_REGEX_PATTERN_LENGTH = 200;
/** 编译缓存上限：pattern 来自不受信输入，超限整体清空防内存增长。 */
const REGEX_CACHE_LIMIT = 512;
const regexCache = new Map<string, SafeRegExp | null>();

/**
 * 保守的灾难性回溯启发式：一个组内含无界量词（`+`/`*`/`{n,}`）或反向引用，
 * 而该组整体又被 `+`/`*` 修饰 —— 典型如 `(a+)+`。属 Nexus Profile 限制，
 * 误报可接受（被拒的 pattern 换等价写法即可）。求值侧另有线性时间引擎兜底
 * （见 safe-regex），此启发式继续作为更严的准入面，保持两仓验收口径不变。
 */
export function hasNestedQuantifierRisk(pattern: string): boolean {
  const groups: number[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      i += 1; // 跳过转义字符
      continue;
    }
    if (ch === '(') {
      groups.push(i);
      continue;
    }
    if (ch !== ')') continue;
    const start = groups.pop();
    if (start === undefined) continue;
    const next = pattern[i + 1];
    if (next !== '+' && next !== '*') continue;
    const body = pattern.slice(start + 1, i);
    if (/[+*]|\\[1-9]|\{\d+,/.test(body)) return true;
  }
  return false;
}

/**
 * 编译正则并按 pattern 缓存（checks 每次渲染都会求值）。
 * 求值走 safe-regex 的 Thompson NFA 线性引擎：即使启发式漏报歧义 pattern，
 * `.test()` 耗时仍有 O(输入长度 × NFA 状态数) 上界，不会灾难性回溯。
 * 超长 / 含嵌套量词风险 / 语法非法或 Profile 不支持一律返回 null，不向调用方抛异常。
 */
export function compileSafeRegExp(pattern: string): SafeRegExp | null {
  if (typeof pattern !== 'string' || pattern.length > MAX_REGEX_PATTERN_LENGTH) return null;
  if (hasNestedQuantifierRisk(pattern)) return null;
  const cached = regexCache.get(pattern);
  if (cached !== undefined) return cached;
  let compiled: SafeRegExp | null = null;
  compiled = compileBoundedRegExp(pattern);
  if (regexCache.size >= REGEX_CACHE_LIMIT) regexCache.clear();
  regexCache.set(pattern, compiled);
  return compiled;
}

/**
 * 校验与求值共用的 pattern 受支持判定。
 * 返回 null 表示可用；否则给出面向用户的拒绝原因。
 */
export function getRegexPatternRejection(pattern: string): string | null {
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    return `长度不得超过 ${MAX_REGEX_PATTERN_LENGTH}`;
  }
  if (hasNestedQuantifierRisk(pattern)) return '含嵌套量词，属不安全正则';
  const status = checkRegexSyntax(pattern);
  if (status === 'syntax') return '必须是合法正则表达式';
  if (status === 'unsupported') return '含当前 Profile 不支持的正则语法（反向引用/环视等）';
  return null;
}

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
  if (typeof value !== 'string') return false;
  const compiled = compileSafeRegExp(pattern as string);
  return compiled !== null && compiled.test(value);
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
