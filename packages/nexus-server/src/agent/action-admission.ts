/**
 * server 权威 action 准入（SPEC §4.3/§4.4，S2.4）。
 *
 * 职责：在 surface 锁内、handler 调用前，对 action 请求做一次性整批裁决——
 * nexus 元数据核对（必填；sessionVersion/actionId/surfaceRevision/catalogHash）、
 * action 来源能力（catalog actions.sources）、浏览器输入整批校验（声明、
 * 可编辑白名单、值 schema、重复/同路径/祖先-后代冲突）、用临时输入模型重算
 * 参数。任何拒绝都满足同一不变式：handler 未调用、已提交快照与 revision
 * 不变、无局部写入。准入产出「规范化输入写回」，由调用方在提交边界与
 * handler patch 一次原子落库。
 *
 * 组件/输入/绑定语义全部来自 core 共享纯规则（validateInputValueDiagnostics、
 * isDataBinding、isUnsafeDataPath、resolveContext、getStrictPath、setStrictPath），本模块只做
 * server 侧编排。声明解释一律使用快照固定的 Catalog 契约副本（提交边界随
 * hash 一并固定），不读当前 registry——宿主原地修改声明不能让同一
 * revision/hash/输入从拒绝翻转为接受。宿主业务授权（身份、对象归属、事务）
 * 仍由 handler 判断。
 */
import type {
  CatalogComponentDeclaration,
  ComponentSchemaDiagnostic,
  ComponentSchemaNode,
  NexusActionInput,
} from '@nexus-ui/core';
import {
  NEXUS_SESSION_VERSION,
  isDataBinding,
  isUnsafeDataPath,
  resolveContext,
  normalizeJsonPointer,
  getStrictPath,
  setStrictPath,
  validateInputValueDiagnostics,
} from '@nexus-ui/core';
import type { DynamicValue, ServerActionEvent } from '@nexus-ui/core';
import type { SurfaceActionSnapshot, SurfaceInputWrite } from './surface-action-state';
import { findSurfaceAction } from './surface-action-state';

/** 运行期拒绝类别（SPEC §4.4）；S2.5 的 HTTP 语义据此映射状态码。 */
export type ActionAdmissionCode =
  | 'nexus-invalid'
  | 'revision-mismatch'
  | 'hash-mismatch'
  | 'undeclared'
  | 'input-invalid'
  | 'input-conflict'
  | 'input-schema'
  | 'path-forbidden'
  | 'param-invalid';

/** nexus envelope 元数据（必填；字段语义见 core session 模块/SPEC §5.1）。 */
export interface ActionNexusMetadata {
  readonly sessionVersion: unknown;
  readonly actionId: unknown;
  readonly surfaceRevision: unknown;
  readonly catalogHash: unknown;
  readonly inputs?: readonly unknown[];
}

/** 待裁决的 action 请求（message 侧 v0.9 action 字段 + 必填 nexus 元数据）。 */
export interface ActionAdmissionRequest {
  readonly name: string;
  readonly surfaceId: string;
  readonly sourceComponentId: string;
  readonly context: unknown;
  readonly actionId: string;
  readonly nexus: ActionNexusMetadata;
}

export interface ActionAdmissionContext {
  readonly snapshot: SurfaceActionSnapshot;
  /** 规范化后的精确可编辑路径集合（默认拒绝；不做通配或前缀继承）。 */
  readonly editablePaths: ReadonlySet<string>;
}

/** 服务端重算后的参数。 */
export type ActionParams = Record<string, unknown>;

export type ActionAdmissionResult =
  | {
      ok: true;
      /** 从临时输入模型重算的 handler 参数（客户端 context 值不作为权威）。 */
      params: ActionParams;
      /** 应用整批输入后的临时模型；仅用于参数解析，不写入已提交状态。 */
      tempDataModel: unknown;
      /** 已准入输入的规范化写回（值快照）；提交边界与 handler patch 一次落库。 */
      inputWrites: readonly SurfaceInputWrite[];
    }
  | {
      ok: false;
      code: ActionAdmissionCode;
      message: string;
      diagnostics?: readonly ComponentSchemaDiagnostic[];
    };

interface AdmittedInput {
  readonly componentId: string;
  readonly property: string;
  readonly path: string;
  readonly value: unknown;
}

/** nexus 输入项只允许这三个键；其余（伪造写路径等）整批拒绝。 */
const INPUT_ITEM_KEYS: readonly string[] = ['componentId', 'property', 'value'];

function reject(
  code: ActionAdmissionCode,
  message: string,
  diagnostics?: readonly ComponentSchemaDiagnostic[],
): ActionAdmissionResult {
  return diagnostics === undefined
    ? { ok: false, code, message }
    : { ok: false, code, message, diagnostics };
}

/* ───────────────────── 可编辑白名单（可信装配配置） ───────────────────── */

export { normalizeJsonPointer } from '@nexus-ui/core';

/**
 * 装配期白名单：规范化后重复即配置错误（抛错）；白名单自身允许嵌套重叠
 * （/profile 与 /profile/name 可同时存在），准入按解析出的目标路径精确匹配。
 */
export function createEditablePathWhitelist(pointers: readonly string[]): ReadonlySet<string> {
  if (!Array.isArray(pointers)) throw new Error('可编辑路径白名单必须是字符串数组');
  const normalized = new Set<string>();
  for (const pointer of pointers) {
    const canonical = normalizeJsonPointer(pointer);
    if (normalized.has(canonical)) {
      throw new Error(`可编辑路径白名单规范化后重复: ${pointer}`);
    }
    normalized.add(canonical);
  }
  return normalized;
}

/* ───────────────────── 参数校验（默认路径与 resolver 共用） ───────────────────── */

/**
 * 按已提交 Catalog 声明校验最终参数：paramSchema 存在时按值 schema 逐字段
 * 校验；缺省即参数必须为空对象（默认拒绝）。参数值是已解析的字面值
 * （context 绑定已经 resolveContext 解析）。默认路径校验共享重算参数，
 * resolver 路径校验 resolver 输出；拒绝时返回首个诊断消息。
 */
export function validateActionParams(
  params: ActionParams,
  actionDeclaration: { readonly paramSchema?: CatalogComponentDeclaration['schema'] } | undefined,
): string | null {
  if (actionDeclaration?.paramSchema !== undefined) {
    return (
      validateInputValueDiagnostics(params, actionDeclaration.paramSchema, 'action.params')[0]
        ?.message ?? null
    );
  }
  return Object.keys(params).length === 0 ? null : 'paramSchema 缺省即参数必须为空对象';
}

function declaredContextKeys(declaration: ServerActionEvent): ReadonlySet<string> {
  return new Set(Object.keys((declaration.context ?? {}) as Record<string, unknown>));
}

/** 客户端 context 键必须是已声明绑定字段；值不作为参数权威（服务端重算）。 */
export function findUndeclaredClientContextKeys(
  declaration: ServerActionEvent,
  clientContext: Record<string, unknown>,
): readonly string[] {
  const declared = declaredContextKeys(declaration);
  return Object.keys(clientContext).filter((key) => !declared.has(key));
}

/** resolver 输出的未声明键拒绝（准入拒绝类别之一）。 */
export function rejectUndeclaredClientContext(
  declaration: ServerActionEvent,
  clientContext: Record<string, unknown>,
): string | null {
  const extra = findUndeclaredClientContextKeys(declaration, clientContext);
  return extra.length === 0 ? null : `Action context 包含未声明的客户端字段: ${extra.join(', ')}`;
}

/* ───────────────────── 快照固定契约的声明读取（只读自有属性） ───────────────────── */

function catalogComponentDeclaration(
  catalog: SurfaceActionSnapshot['contract']['catalog'],
  component: string,
): CatalogComponentDeclaration | undefined {
  const components = catalog.components;
  if (!components || !Object.prototype.hasOwnProperty.call(components, component)) return undefined;
  return components[component];
}

function declaredInputValueSchema(
  declaration: CatalogComponentDeclaration,
  property: string,
): ComponentSchemaNode | undefined {
  const inputs = declaration.inputs;
  if (!inputs || !Object.prototype.hasOwnProperty.call(inputs, property)) return undefined;
  return inputs[property];
}

/* ───────────────────── 整批输入准入 ───────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pointerSegments(pointer: string): readonly string[] {
  // 规范形先按 '/' 切段，再反转义 `~1`/`~0`：段比较必须基于真实键
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function admitInputs(
  context: ActionAdmissionContext,
  rawInputs: readonly unknown[],
): { ok: true; inputs: readonly AdmittedInput[] } | { ok: false; failure: ActionAdmissionResult } {
  const { snapshot, editablePaths } = context;
  const catalog = snapshot.contract.catalog;
  const admitted: AdmittedInput[] = [];
  const seenItems = new Set<string>();
  const seenPaths = new Map<string, readonly string[]>();

  for (const [index, item] of rawInputs.entries()) {
    const label = `inputs[${index}]`;
    if (!isRecord(item))
      return { ok: false, failure: reject('input-invalid', `${label} 必须是对象`) };
    const keys = Object.keys(item);
    for (const key of keys) {
      if (!INPUT_ITEM_KEYS.includes(key)) {
        return {
          ok: false,
          failure: reject(
            'input-invalid',
            `${label} 含未允许的字段: ${key}（只能提交 componentId/property/value）`,
          ),
        };
      }
    }
    for (const key of INPUT_ITEM_KEYS) {
      if (!keys.includes(key)) {
        return { ok: false, failure: reject('input-invalid', `${label} 缺少 ${key}`) };
      }
    }
    const { componentId, property } = item as { componentId: unknown; property: unknown };
    if (typeof componentId !== 'string' || componentId === '') {
      return {
        ok: false,
        failure: reject('input-invalid', `${label}.componentId 必须是非空字符串`),
      };
    }
    if (typeof property !== 'string' || property === '') {
      return { ok: false, failure: reject('input-invalid', `${label}.property 必须是非空字符串`) };
    }

    const itemKey = `${componentId}\u0000${property}`;
    if (seenItems.has(itemKey)) {
      return {
        ok: false,
        failure: reject(
          'input-conflict',
          `${label} 与同批输入重复（同组件同属性）: ${componentId}/${property}`,
        ),
      };
    }
    seenItems.add(itemKey);

    const component = snapshot.components.get(componentId);
    if (!component) {
      return {
        ok: false,
        failure: reject('undeclared', `${label} 的组件未在已提交 surface 中: ${componentId}`),
      };
    }
    const declaration = catalogComponentDeclaration(catalog, component.component);
    if (declaration === undefined) {
      return {
        ok: false,
        failure: reject(
          'undeclared',
          `${label} 的组件未在固定 Catalog 契约中声明: ${component.component}`,
        ),
      };
    }
    const valueSchema = declaredInputValueSchema(declaration, property);
    if (valueSchema === undefined) {
      return {
        ok: false,
        failure: reject(
          'undeclared',
          `${label} 的可写属性未在 Catalog inputs 中声明: ${component.component}.${property}`,
        ),
      };
    }

    const binding = (component as unknown as Record<string, unknown>)[property];
    if (!isDataBinding(binding)) {
      return {
        ok: false,
        failure: reject(
          'input-invalid',
          `${label} 的目标属性缺少 { path } 绑定（流式未到达或字面值）: ${componentId}.${property}`,
        ),
      };
    }
    if (isUnsafeDataPath(binding.path)) {
      return {
        ok: false,
        failure: reject('path-forbidden', `${label} 的绑定路径包含保留段: ${binding.path}`),
      };
    }
    let canonical: string;
    try {
      canonical = normalizeJsonPointer(binding.path);
      getStrictPath(snapshot.dataModel, canonical);
    } catch (error) {
      return {
        ok: false,
        failure: reject(
          'input-invalid',
          `${label} 的绑定路径非法: ${error instanceof Error ? error.message : String(error)}`,
        ),
      };
    }
    if (!editablePaths.has(canonical)) {
      return {
        ok: false,
        failure: reject(
          'path-forbidden',
          `${label} 的目标路径不可编辑（精确白名单外）: ${canonical}`,
        ),
      };
    }

    const diagnostics = validateInputValueDiagnostics(item.value, valueSchema, label);
    if (diagnostics.length > 0) {
      return {
        ok: false,
        failure: reject('input-schema', `${label} 值不符合声明 schema`, diagnostics),
      };
    }

    const segments = pointerSegments(canonical);
    for (const existingSegments of seenPaths.values()) {
      const common = Math.min(existingSegments.length, segments.length);
      let prefix = true;
      for (let k = 0; k < common; k += 1) {
        if (existingSegments[k] !== segments[k]) {
          prefix = false;
          break;
        }
      }
      if (prefix) {
        return {
          ok: false,
          failure: reject(
            'input-conflict',
            `${label} 的目标路径与同批输入冲突（同路径或祖先/后代）: ${canonical}`,
          ),
        };
      }
    }
    seenPaths.set(canonical, segments);

    admitted.push({ componentId, property, path: canonical, value: item.value });
  }
  return { ok: true, inputs: admitted };
}

/* ───────────────────── 主管线 ───────────────────── */

export function admitAction(
  context: ActionAdmissionContext,
  request: ActionAdmissionRequest,
): ActionAdmissionResult {
  const { snapshot } = context;
  const nexus = request.nexus;

  // nexus 元数据必填：缺失 nexus 即旧格式，显式拒绝，不设任何「缺元数据则跳过」开关
  if (nexus === undefined) {
    return reject('nexus-invalid', '缺失 nexus 元数据段（旧格式显式拒绝，不按旧语义解释）');
  }
  if (nexus.sessionVersion !== NEXUS_SESSION_VERSION) {
    return reject('nexus-invalid', `nexus.sessionVersion 只支持 ${NEXUS_SESSION_VERSION}`);
  }
  if (typeof nexus.actionId !== 'string' || nexus.actionId === '') {
    return reject('nexus-invalid', 'nexus.actionId 必须是非空字符串');
  }
  if (request.actionId !== nexus.actionId) {
    return reject('nexus-invalid', 'action.actionId 与 nexus.actionId 不一致');
  }
  if (
    typeof nexus.surfaceRevision !== 'number' ||
    !Number.isSafeInteger(nexus.surfaceRevision) ||
    nexus.surfaceRevision <= 0
  ) {
    return reject('revision-mismatch', 'nexus.surfaceRevision 必须是正安全整数');
  }
  if (nexus.surfaceRevision !== snapshot.version) {
    return reject(
      'revision-mismatch',
      `nexus.surfaceRevision 与服务端快照 revision 不一致: ${nexus.surfaceRevision} ≠ ${snapshot.version}`,
    );
  }
  if (typeof nexus.catalogHash !== 'string' || nexus.catalogHash === '') {
    return reject('hash-mismatch', 'nexus.catalogHash 必须是非空字符串');
  }
  if (nexus.catalogHash !== snapshot.contract.catalogHash) {
    return reject(
      'hash-mismatch',
      `nexus.catalogHash 与快照固定 hash 不一致: ${String(nexus.catalogHash)}`,
    );
  }

  // action 来源与声明：组件、event.name 与 catalog sources 三方一致（用固定契约副本）
  const surfaceAction = findSurfaceAction(snapshot, request.name, request.sourceComponentId);
  if (!surfaceAction) {
    return reject(
      'undeclared',
      `Action 与服务端 surface 状态不匹配: ${request.surfaceId}/${request.sourceComponentId}/${request.name}`,
    );
  }
  const actionDeclaration = snapshot.contract.catalog.actions.find(
    (entry) => entry.name === request.name,
  );
  if (actionDeclaration === undefined) {
    return reject('undeclared', `Catalog 未声明 action: ${request.name}`);
  }
  if (!actionDeclaration.sources.includes(surfaceAction.component.component)) {
    return reject(
      'undeclared',
      `Catalog 的 action ${request.name} 不允许挂载在组件 ${surfaceAction.component.component} 上（sources 不含该组件）`,
    );
  }

  // 浏览器输入整批准入：任一项失败即整批拒绝，不产生局部写入
  const rawInputs = nexus.inputs ?? [];
  if (!Array.isArray(rawInputs)) {
    return reject('nexus-invalid', 'nexus.inputs 必须是数组（静默忽略会放过非法元数据）');
  }
  let admitted: readonly AdmittedInput[] = [];
  if (rawInputs.length > 0) {
    const outcome = admitInputs(context, rawInputs);
    if (!outcome.ok) return outcome.failure;
    admitted = outcome.inputs;
  }

  // 临时输入模型：仅用于参数重算，不写入已提交状态、不递增 revision；
  // 每个写回值独立克隆，提交边界随 inputWrites 一次落库
  let tempDataModel: unknown = structuredClone(snapshot.dataModel);
  const inputWrites: SurfaceInputWrite[] = [];
  for (const input of admitted) {
    let value: unknown;
    try {
      value = structuredClone(input.value);
    } catch {
      return reject(
        'input-invalid',
        `inputs 值不可快照（非 JSON 数据）: ${input.componentId}/${input.property}`,
      );
    }
    try {
      tempDataModel = setStrictPath(tempDataModel, input.path, value);
    } catch (error) {
      return reject(
        'input-invalid',
        `写入临时模型失败（中间节点非容器等）: ${input.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    inputWrites.push({ path: input.path, value: structuredClone(value) });
  }

  // 参数由服务端从已提交 action 声明 + 临时输入模型重算；客户端值不作为权威。
  // paramSchema 校验发生在最终交给 handler 的参数上（默认路径即此返回值，
  // resolver 路径为 resolver 输出），由调用方按路径适用——共享准入不在此
  // 提前否决 resolver 的业务参数整形（SPEC §4.3/D8）。
  let params: ActionParams;
  try {
    const declaration = (surfaceAction.declaration.context ?? {}) as Record<string, DynamicValue>;
    // Keep reserved-key checks shared with core; resolve actual bindings strictly.
    params = resolveContext(declaration, undefined);
    for (const [key, value] of Object.entries(declaration)) {
      params[key] = isDataBinding(value)
        ? getStrictPath(tempDataModel, value.path)
        : structuredClone(value);
    }
  } catch (error) {
    return reject('param-invalid', error instanceof Error ? error.message : String(error));
  }

  return { ok: true, params, tempDataModel, inputWrites };
}

export type { NexusActionInput };
