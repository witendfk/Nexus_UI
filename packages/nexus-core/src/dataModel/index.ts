/**
 * @nexus-ui/core/dataModel —— 数据模型与 {path} 绑定解析（纯函数）。
 *
 * 全部无副作用（upsert/set/remove 返回新对象，不改入参），可独立测试与复用。覆盖：
 *   - JSON Pointer（RFC 6901）取值 / 不可变写入 / 删除（含 ~0/~1 转义）
 *   - updateDataModel 合并语义（无 path 整表替换；有 path upsert；无 value 删除）
 *   - `{ path }` 绑定解析为真值（resolveDynamic / resolveContext）
 *
 * FunctionCall 求值由渲染层/catalog 的函数注册表注入，本模块保持框架无关。
 */
import type { DataPath, DynamicValue, UpdateDataModelPayload } from '../protocol/types';

/* ───────────────────────── JSON Pointer ───────────────────────── */

/** 反转义段：`~1` → `/`，`~0` → `~`（顺序不可换）。 */
function unescapeSegment(seg: string): string {
  return seg.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** 把 JSON Pointer 切为段数组。`/a/b` → ['a','b']；`''` / `'/'` → []。 */
function parsePointer(path: DataPath): string[] {
  if (!path) return [];
  const stripped = path.startsWith('/') ? path.slice(1) : path;
  if (!stripped) return [];
  return stripped.split('/').map(unescapeSegment);
}

/** 段是否为数组索引（非负整数）。 */
function isArrayIndex(seg: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(seg);
}

/** 浅克隆：数组/对象复制身份隔离；undefined → {}；原始值原样。 */
function cloneShallow(value: unknown): unknown {
  if (Array.isArray(value)) return [...value];
  if (value && typeof value === 'object') return { ...(value as Record<string, unknown>) };
  if (value === undefined) return {};
  return value;
}

/* ───────────────────────── get ───────────────────────── */

/** 按 JSON Pointer 取值；路径不存在返回 undefined（渐进期数据未到达时正常）。 */
export function getByPath(model: unknown, path: DataPath): unknown {
  let cur: unknown = model;
  for (const seg of parsePointer(path)) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx)) return undefined;
      cur = cur[idx];
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

/* ───────────────────────── set（不可变 upsert） ───────────────────────── */

/**
 * 按 JSON Pointer **不可变**写入（upsert）：缺失中间节点自动创建（数字段建数组，
 * 否则建对象）；返回新根，不改入参。
 */
export function setValueAtPath(model: unknown, path: DataPath, value: unknown): unknown {
  const segments = parsePointer(path);
  if (segments.length === 0) return value;
  const root = cloneShallow(model);
  let current: Record<string, unknown> | unknown[] = root as Record<string, unknown> | unknown[];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] as string;
    const last = i === segments.length - 1;
    if (last) {
      if (Array.isArray(current)) (current as unknown[])[Number(seg)] = value;
      else (current as Record<string, unknown>)[seg] = value;
      break;
    }
    const wantArray = isArrayIndex(segments[i + 1] as string);
    let child: unknown = Array.isArray(current)
      ? (current as unknown[])[Number(seg)]
      : (current as Record<string, unknown>)[seg];
    if (child === undefined || child === null) child = wantArray ? [] : {};
    child = cloneShallow(child);
    if (Array.isArray(current)) (current as unknown[])[Number(seg)] = child;
    else (current as Record<string, unknown>)[seg] = child;
    current = child as Record<string, unknown> | unknown[];
  }
  return root;
}

/* ───────────────────────── remove（不可变） ───────────────────────── */

/**
 * 按 JSON Pointer **不可变**删除：对象删 key；数组把索引处置为 undefined（保留长度）。
 */
export function removeAtPath(model: unknown, path: DataPath): unknown {
  const segments = parsePointer(path);
  if (segments.length === 0) return undefined;
  const root = cloneShallow(model);
  let current: Record<string, unknown> | unknown[] = root as Record<string, unknown> | unknown[];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] as string;
    const last = i === segments.length - 1;
    if (last) {
      if (Array.isArray(current)) (current as unknown[])[Number(seg)] = undefined;
      else delete (current as Record<string, unknown>)[seg];
      break;
    }
    let child: unknown = Array.isArray(current)
      ? (current as unknown[])[Number(seg)]
      : (current as Record<string, unknown>)[seg];
    if (child === undefined || child === null) return root; // 无需删除
    child = cloneShallow(child);
    if (Array.isArray(current)) (current as unknown[])[Number(seg)] = child;
    else (current as Record<string, unknown>)[seg] = child;
    current = child as Record<string, unknown> | unknown[];
  }
  return root;
}

/* ───────────────────────── updateDataModel 合并语义 ───────────────────────── */

/**
 * 应用一次 updateDataModel，返回新的数据模型（不可变）：
 *  - 无 `path`（或为 `/`）：用 `value` 整表替换；`value` 缺省则清空为 undefined。
 *  - 有 `path` + `value`：upsert。
 *  - 有 `path` 无 `value`：删除。
 */
export function applyDataModelUpdate(model: unknown, update: UpdateDataModelPayload): unknown {
  const { path } = update;
  // 内联收窄：布尔变量无法沿控制流传递类型收窄，故直接在 if 里判定并早返回。
  if (typeof path !== 'string' || path.length === 0 || path === '/') {
    return update.value; // 整表替换（value 缺省 → undefined）
  }
  if (update.value === undefined) return removeAtPath(model, path);
  return setValueAtPath(model, path, update.value);
}

/* ───────────────────────── Dynamic 解析 ───────────────────────── */

function isDataBinding(value: unknown): value is { path: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'path' in value &&
    typeof (value as { path: unknown }).path === 'string'
  );
}

/** 解析动态值：字面量原样返回；`{ path }` 按数据模型取值。 */
export function resolveDynamic(value: unknown, model: unknown): unknown {
  if (isDataBinding(value)) return getByPath(model, value.path);
  return value;
}

/**
 * [seam] 批量解析 action.context 的 DynamicValue 键值对为真值（供 triggerAction 用）。
 * context 必须在 core 解析——数据模型在 core，宿主/渲染层不该碰。
 */
export function resolveContext(
  context: Record<string, DynamicValue> | undefined,
  model: unknown,
): Record<string, unknown> {
  if (!context) return {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(context)) {
    out[key] = resolveDynamic(context[key], model);
  }
  return out;
}

/* ───────────────────────── 展示字符串 ───────────────────────── */

/** 把任意值转为展示字符串（null/undefined → ""；对象 → JSON）。 */
export function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
