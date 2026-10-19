import { isUnsafeSegment } from './index';

/** Absolute RFC 6901 input path. Document-root aliases are excluded for input bindings. */
export function normalizeJsonPointer(path: string): string {
  if (typeof path !== 'string' || !path.startsWith('/') || path === '/') {
    throw new Error('输入路径必须是绝对 JSON Pointer，拒绝空串根指针与 /');
  }
  for (const raw of path.slice(1).split('/')) {
    if (/~(?:[^01]|$)/.test(raw)) throw new Error(`JSON Pointer 非法转义: ${path}`);
    const segment = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (isUnsafeSegment(segment)) throw new Error(`JSON Pointer 含保留段: ${path}`);
  }
  return path;
}

function segments(path: string): string[] {
  return normalizeJsonPointer(path)
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function container(value: unknown): value is Record<string, unknown> | unknown[] {
  if (Array.isArray(value)) return true;
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function keyOf(value: Record<string, unknown> | unknown[], segment: string): string | number {
  if (!Array.isArray(value)) return segment;
  if (!/^(0|[1-9][0-9]*)$/.test(segment) || Number(segment) >= 0xffffffff) {
    throw new Error(`数组下标必须是规范十进制索引: ${segment}`);
  }
  return Number(segment);
}

export function getStrictPath(model: unknown, path: string): unknown {
  let value = model;
  for (const segment of segments(path)) {
    if (value === undefined || value === null) return undefined;
    if (!container(value)) throw new Error(`路径中间节点不是容器: ${path}`);
    const key = keyOf(value, segment);
    value = Object.prototype.hasOwnProperty.call(value, key)
      ? (value as Record<string | number, unknown>)[key]
      : undefined;
  }
  return value;
}

/** Immutable input write; array addressing is validated against the actual container. */
export function setStrictPath(model: unknown, path: string, input: unknown): unknown {
  const parts = segments(path);
  const write = (value: unknown, index: number): unknown => {
    const current = value === undefined || value === null ? {} : value;
    if (!container(current)) throw new Error(`路径中间节点不是容器: ${path}`);
    const segment = parts[index] as string;
    const key = keyOf(current, segment);
    const result = (Array.isArray(current) ? [...current] : { ...current }) as Record<
      string | number,
      unknown
    >;
    const child = Object.prototype.hasOwnProperty.call(current, key)
      ? (current as Record<string | number, unknown>)[key]
      : undefined;
    result[key] = index === parts.length - 1 ? input : write(child, index + 1);
    return result;
  };
  return write(model, 0);
}
