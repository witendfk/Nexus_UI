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

/** 以这些段为键写普通对象会命中 Object.prototype 访问器/构造链（原型污染）。 */
const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function hasUnsafeSegment(segments: string[]): boolean {
  return segments.some((seg) => UNSAFE_SEGMENTS.has(seg));
}

/**
 * 单个键/路径段是否为保留段（__proto__/constructor/prototype）。
 * dataModel、协议准入（validator）与渲染层（buildProps）共用此判断，
 * 常量在定义处导出，避免多处复制造成口径漂移。
 */
export function isUnsafeSegment(segment: string): boolean {
  return UNSAFE_SEGMENTS.has(segment);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * 数据容器：可安全遍历/写入的中间节点（普通对象或数组）。
 * 函数、原始值与宿主对象（Date/Map/class 实例等）不是容器——沿它们继续遍历会把
 * 写入导向共享对象（如继承来的 `Object.prototype.toString` 函数），一律显式拒绝。
 */
function isDataContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return Array.isArray(value) || isPlainObject(value);
}

/**
 * 路径是否含保留段；组件绑定等下游消费方据此在边界层拒绝。
 * 读路径（getByPath）静默拒绝返回 undefined，写路径（setValueAtPath/removeAtPath）抛错。
 */
export function isUnsafeDataPath(path: DataPath): boolean {
  return hasUnsafeSegment(parsePointer(path));
}

/** 浅克隆：数组/对象复制身份隔离；undefined/null → {}；原始值原样。 */
function cloneShallow(value: unknown): unknown {
  if (Array.isArray(value)) return [...value];
  if (value && typeof value === 'object') return { ...(value as Record<string, unknown>) };
  if (value === undefined || value === null) return {};
  return value;
}

/** 取对象「自身」属性：继承链上的成员（如 toString/valueOf）不视作数据。 */
function getOwnProperty(target: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(target, key) ? target[key] : undefined;
}

/** 非容器根/中间节点的统一拒绝信息（get/set/remove 语义一致）。 */
function nonContainerMessage(path: DataPath): string {
  return `数据路径中间节点不是受支持的数据容器（普通对象/数组）: ${path}`;
}

/* ───────────────────────── get ───────────────────────── */

/** 按 JSON Pointer 取值；路径不存在返回 undefined（渐进期数据未到达时正常）。 */
export function getByPath(model: unknown, path: DataPath): unknown {
  const segments = parsePointer(path);
  if (hasUnsafeSegment(segments)) return undefined;
  let cur: unknown = model;
  for (const seg of segments) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx)) return undefined;
      cur = cur[idx];
    } else if (isPlainObject(cur)) {
      cur = getOwnProperty(cur, seg);
    } else {
      // 函数/原始值/宿主对象不是数据容器：不再沿其遍历（含继承成员）
      return undefined;
    }
  }
  return cur;
}

/* ───────────────────────── set（不可变 upsert） ───────────────────────── */

/**
 * 数据模型资源边界拒绝（S4.0）：数组越界/规模超限等确定性拒绝携带会话资源
 * 错误码，server 提交失败映射与 runtime 结构化上报共用同一分类。
 */
export class DataModelResourceLimitError extends Error {
  readonly code = 'RESOURCE_LIMIT_EXCEEDED' as const;
}

/**
 * 数组容器写入的确定性拒绝：只允许修改界内元素或在末尾紧凑追加（index ===
 * length），越界跳写（会造稀疏空洞）一律抛错（S4.0 资源边界）。
 */
function requireArrayIndexWritable(container: unknown[], index: number, path: DataPath): void {
  if (!Number.isInteger(index) || index < 0 || index > container.length) {
    throw new DataModelResourceLimitError(
      `数组下标越界: ${path}（下标 ${String(index)}，当前长度 ${container.length}）`,
    );
  }
}

/** 数组删除的确定性拒绝：只允许界内置 undefined，不允许稀疏扩长（S4.0）。 */
function requireArrayIndexInBounds(container: unknown[], index: number, path: DataPath): void {
  if (!Number.isInteger(index) || index < 0 || index >= container.length) {
    throw new DataModelResourceLimitError(
      `数组下标越界: ${path}（下标 ${String(index)}，当前长度 ${container.length}）`,
    );
  }
}

/**
 * 按 JSON Pointer **不可变**写入（upsert）：缺失中间节点自动创建（数字段建数组，
 * 否则建对象）；返回新根，不改入参。数组容器内的下标必须落在当前长度内。
 */
export function setValueAtPath(model: unknown, path: DataPath, value: unknown): unknown {
  const segments = parsePointer(path);
  if (segments.length === 0) return value;
  if (hasUnsafeSegment(segments)) {
    throw new Error(`数据路径包含保留段（__proto__/constructor/prototype）: ${path}`);
  }
  if (model !== undefined && model !== null && !isDataContainer(model)) {
    throw new Error(`数据模型根不是受支持的数据容器（普通对象/数组）: ${path}`);
  }
  const root = cloneShallow(model);
  let current: Record<string, unknown> | unknown[] = root as Record<string, unknown> | unknown[];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] as string;
    const last = i === segments.length - 1;
    if (last) {
      if (Array.isArray(current)) {
        requireArrayIndexWritable(current, Number(seg), path);
        (current as unknown[])[Number(seg)] = value;
      } else (current as Record<string, unknown>)[seg] = value;
      break;
    }
    const wantArray = isArrayIndex(segments[i + 1] as string);
    let child: unknown;
    if (Array.isArray(current)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx)) throw new Error(nonContainerMessage(path));
      requireArrayIndexWritable(current, idx, path);
      child = (current as unknown[])[idx];
    } else {
      child = getOwnProperty(current as Record<string, unknown>, seg);
    }
    if (child === undefined || child === null) child = wantArray ? [] : {};
    else if (!isDataContainer(child)) throw new Error(nonContainerMessage(path));
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
  if (hasUnsafeSegment(segments)) {
    throw new Error(`数据路径包含保留段（__proto__/constructor/prototype）: ${path}`);
  }
  if (model !== undefined && model !== null && !isDataContainer(model)) {
    throw new Error(`数据模型根不是受支持的数据容器（普通对象/数组）: ${path}`);
  }
  const root = cloneShallow(model);
  let current: Record<string, unknown> | unknown[] = root as Record<string, unknown> | unknown[];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] as string;
    const last = i === segments.length - 1;
    if (last) {
      if (Array.isArray(current)) {
        // 越界删除同样拒绝：置 undefined 保留长度，但不允许稀疏扩长（S4.0）。
        requireArrayIndexInBounds(current, Number(seg), path);
        (current as unknown[])[Number(seg)] = undefined;
      } else delete (current as Record<string, unknown>)[seg];
      break;
    }
    let child: unknown;
    if (Array.isArray(current)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx)) throw new Error(nonContainerMessage(path));
      requireArrayIndexInBounds(current, idx, path);
      child = (current as unknown[])[idx];
    } else {
      child = getOwnProperty(current as Record<string, unknown>, seg);
    }
    if (child === undefined || child === null) return root; // 无需删除
    if (!isDataContainer(child)) throw new Error(nonContainerMessage(path));
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
 * 保留段键（含 JSON.parse 注入的自有 __proto__）显式抛错：写入返回对象会命中
 * `__proto__` 访问器，把返回对象的原型改写为攻击者值（原型污染）。
 */
export function resolveContext(
  context: Record<string, DynamicValue> | undefined,
  model: unknown,
): Record<string, unknown> {
  if (!context) return {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(context)) {
    if (isUnsafeSegment(key)) {
      throw new Error(`context 键包含保留段（__proto__/constructor/prototype）: ${key}`);
    }
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
