/**
 * @nexus-ui/core/catalog —— Catalog 注册表与 v2 注册闸门。
 *
 * CatalogDefinition 为 S2 定型的 v2 形状：单一组件声明表 + 必填 actions。
 * 注册闸门执行 SPEC §4.2 的全部拒绝规则（未知键、不支持 schema 语法、
 * 矛盾声明、受支持范围越界）；注册期失败即抛错，不做静默兼容。
 */
import { SUPPORTED_CHECK_FUNCTIONS } from '../checks';
import type { Component } from '../protocol/types';
import {
  CATALOG_FIELD_ORIGINS,
  validateComponentPolicyDiagnostics,
  validateComponentPropsDiagnostics,
  validateComponentSchema,
  validateInputValueSchema,
  type CatalogActionDeclaration,
  type CatalogChecksPolicy,
  type CatalogComponentActionRequirement,
  type CatalogComponentDeclaration,
  type CatalogFieldOrigin,
  type ComponentPropsSchema,
  type ComponentSchemaDiagnostic,
  type ComponentSchemaNode,
} from './schema';

/** Version of the published Catalog contract interpreted by this SDK. */
export const CATALOG_CONTRACT_VERSION = 2 as const;

export interface CatalogDefinition {
  readonly catalogId: string;
  /** 组件名到声明的表；每个发布组件必须携带完整声明，name-only 条目不存在。 */
  readonly components: Readonly<Record<string, CatalogComponentDeclaration>>;
  /** 必填；展示型 Catalog 显式 `[]`。 */
  readonly actions: readonly CatalogActionDeclaration[];
}

export type {
  CatalogActionDeclaration,
  CatalogChecksPolicy,
  CatalogComponentActionRequirement,
  CatalogComponentDeclaration,
  CatalogFieldOrigin,
  CatalogFieldPolicy,
  ComponentSchemaDiagnostic,
} from './schema';
export { isDataBinding, validateInputValueDiagnostics } from './schema';

const DEFINITION_KEYS: readonly string[] = ['catalogId', 'components', 'actions'];
const DECLARATION_KEYS: readonly string[] = [
  'schema',
  'fields',
  'inputs',
  'action',
  'checks',
  'origin',
];
const ACTION_DECLARATION_KEYS: readonly string[] = ['name', 'sources', 'paramSchema'];
const FIELD_POLICY_KEYS: readonly string[] = ['origin', 'componentRef'];
const CHECKS_POLICY_KEYS: readonly string[] = [
  'enabled',
  'functions',
  'maxRules',
  'maxMessageLength',
  'maxPatternLength',
];
const ACTION_REQUIREMENT_KEYS: readonly string[] = ['required'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label} 含未知键: ${key}`);
  }
}

function validateChecksPolicy(checks: CatalogChecksPolicy, label: string): void {
  rejectUnknownKeys(
    checks as unknown as Record<string, unknown>,
    CHECKS_POLICY_KEYS,
    `${label} checks`,
  );
  if (checks.enabled !== undefined && typeof checks.enabled !== 'boolean') {
    throw new Error(`${label} checks.enabled 必须是布尔值`);
  }
  for (const key of ['maxRules', 'maxMessageLength', 'maxPatternLength'] as const) {
    const value = checks[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`${label} checks.${key} 必须是非负安全整数`);
    }
  }
  if (checks.functions !== undefined) {
    if (!Array.isArray(checks.functions))
      throw new Error(`${label} checks.functions 必须是字符串数组`);
    for (const fn of checks.functions) {
      if (typeof fn !== 'string' || !SUPPORTED_CHECK_FUNCTIONS.includes(fn)) {
        throw new Error(
          `${label} checks.functions 含不受支持函数: ${String(fn)}（支持：${SUPPORTED_CHECK_FUNCTIONS.join('/')}）`,
        );
      }
    }
  }
  if (checks.enabled === true && (checks.functions ?? []).length === 0) {
    throw new Error(`${label} checks.enabled 为 true 时 functions 必须非空`);
  }
}

function validateDefinition(definition: CatalogDefinition): void {
  if (!isPlainObject(definition)) throw new Error('Catalog 定义必须是对象');
  rejectUnknownKeys(
    definition as unknown as Record<string, unknown>,
    DEFINITION_KEYS,
    'Catalog 定义',
  );
  if (typeof definition.catalogId !== 'string' || definition.catalogId === '') {
    throw new Error('Catalog catalogId 必须是非空字符串');
  }
  if (!definition.catalogId) throw new Error('Catalog catalogId 不能为空');
  const label = `Catalog ${definition.catalogId}`;
  if (!isPlainObject(definition.components))
    throw new Error(`${label} components 必须是组件声明表`);
  const componentNames = Object.keys(definition.components);
  if (componentNames.length === 0) throw new Error(`${label} components 不能为空`);
  if (!Array.isArray(definition.actions)) {
    throw new Error(`${label} actions 必填；展示型 Catalog 使用 []`);
  }

  for (const name of componentNames) {
    if (!name) throw new Error(`${label} component 名称不能为空`);
    const declaration = definition.components[name];
    if (!isPlainObject(declaration)) throw new Error(`${label}.${name} 声明必须是对象`);
    rejectUnknownKeys(declaration, DECLARATION_KEYS, `${label}.${name} 声明`);
    if (declaration.schema === undefined) throw new Error(`${label}.${name} 缺少 schema`);
    validateComponentSchema(declaration.schema, `${label}.${name} schema`);

    if (declaration.origin !== undefined && !CATALOG_FIELD_ORIGINS.includes(declaration.origin)) {
      throw new Error(`${label}.${name} origin 只支持 ${CATALOG_FIELD_ORIGINS.join('/')}`);
    }

    const props = declaration.schema.properties ?? {};
    if (declaration.fields !== undefined) {
      if (!isPlainObject(declaration.fields)) throw new Error(`${label}.${name} fields 必须是对象`);
      for (const [field, meta] of Object.entries(declaration.fields)) {
        if (!field) throw new Error(`${label}.${name} fields 键不能为空`);
        if (!isPlainObject(meta)) throw new Error(`${label}.${name} fields.${field} 必须是对象`);
        rejectUnknownKeys(meta, FIELD_POLICY_KEYS, `${label}.${name} fields.${field}`);
        if (meta.componentRef !== undefined && typeof meta.componentRef !== 'boolean') {
          throw new Error(`${label}.${name} fields.${field}.componentRef 必须是布尔值`);
        }
        // child/children/tabs 是协议拥有的结构字段，允许携带 componentRef 元数据。
        const isStructuralField = field === 'child' || field === 'children' || field === 'tabs';
        if (!isStructuralField && !Object.prototype.hasOwnProperty.call(props, field)) {
          throw new Error(
            `${label}.${name} fields.${field} 引用未声明字段：fields 键必须是 schema.properties 已声明字段`,
          );
        }
        if (
          meta.origin !== undefined &&
          !CATALOG_FIELD_ORIGINS.includes(meta.origin as CatalogFieldOrigin)
        ) {
          throw new Error(
            `${label}.${name} fields.${field} origin 只支持 ${CATALOG_FIELD_ORIGINS.join('/')}`,
          );
        }
      }
    }

    if (declaration.inputs !== undefined) {
      if (!isPlainObject(declaration.inputs)) throw new Error(`${label}.${name} inputs 必须是对象`);
      for (const [property, valueSchema] of Object.entries(declaration.inputs)) {
        if (!property) throw new Error(`${label}.${name} inputs 键不能为空`);
        if (!Object.prototype.hasOwnProperty.call(props, property)) {
          throw new Error(`${label}.${name} inputs.${property} 引用未声明字段`);
        }
        const propertySchema = props[property];
        // 绑定能力缺省即 forbidden：未声明 dynamic 的字段同样不可作为可写输入。
        const dynamic = isPlainObject(propertySchema)
          ? (propertySchema.dynamic ?? 'forbidden')
          : 'forbidden';
        if (dynamic === 'forbidden') {
          throw new Error(
            `${label}.${name} inputs.${property} 与 schema 矛盾：该字段绑定能力为 forbidden，不支持 { path } 绑定`,
          );
        }
        if (!isPlainObject(valueSchema)) {
          throw new Error(`${label}.${name} inputs.${property} 值 schema 必须是对象`);
        }
        validateInputValueSchema(valueSchema, `${label}.${name} inputs.${property}`);
      }
    }

    if (declaration.action !== undefined) {
      if (!isPlainObject(declaration.action)) throw new Error(`${label}.${name} action 必须是对象`);
      rejectUnknownKeys(declaration.action, ACTION_REQUIREMENT_KEYS, `${label}.${name} action`);
      const requirement: CatalogComponentActionRequirement = declaration.action;
      if (requirement.required !== undefined && typeof requirement.required !== 'boolean') {
        throw new Error(`${label}.${name} action.required 必须是布尔值`);
      }
    }

    if (declaration.checks !== undefined) {
      if (!isPlainObject(declaration.checks)) throw new Error(`${label}.${name} checks 必须是对象`);
      validateChecksPolicy(declaration.checks, `${label}.${name}`);
    }
  }

  const seenActions = new Set<string>();
  for (const action of definition.actions) {
    if (!isPlainObject(action)) throw new Error(`${label} action 声明必须是对象`);
    rejectUnknownKeys(action, ACTION_DECLARATION_KEYS, `${label} action 声明`);
    if (typeof action.name !== 'string' || action.name === '') {
      throw new Error(`${label} action 名称不能为空`);
    }
    if (seenActions.has(action.name)) throw new Error(`${label} action 重复: ${action.name}`);
    seenActions.add(action.name);
    if (!Array.isArray(action.sources) || action.sources.length === 0) {
      throw new Error(`${label} action ${action.name} 的 sources 必须是非空组件名数组`);
    }
    const uniqueSources = new Set<string>();
    for (const source of action.sources) {
      if (typeof source !== 'string' || source === '') {
        throw new Error(`${label} action ${action.name} sources 含空组件名`);
      }
      if (uniqueSources.has(source)) {
        throw new Error(`${label} action ${action.name} sources 重复: ${source}`);
      }
      uniqueSources.add(source);
      if (!Object.prototype.hasOwnProperty.call(definition.components, source)) {
        throw new Error(`${label} action ${action.name} sources 引用未声明组件: ${source}`);
      }
    }
    if (action.paramSchema !== undefined) {
      validateComponentSchema(action.paramSchema, `${label}.${action.name} paramSchema`);
    }
  }

  for (const name of componentNames) {
    if (definition.components[name].action?.required === true) {
      const covered = definition.actions.some((action) => action.sources.includes(name));
      if (!covered) {
        throw new Error(
          `${label} 组件 ${name} 声明 action.required 但不在任何 action 的 sources 中`,
        );
      }
    }
  }
}

/** 注册并查询 A2UI catalog；实例可复用，注册过程只在宿主初始化时发生。 */
export class CatalogRegistry {
  private readonly catalogs = new Map<string, CatalogDefinition>();

  constructor(definitions: readonly CatalogDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: CatalogDefinition): void {
    validateDefinition(definition);
    if (this.catalogs.has(definition.catalogId)) {
      throw new Error(`Catalog 已注册: ${definition.catalogId}`);
    }
    this.catalogs.set(definition.catalogId, definition);
  }

  has(catalogId: string): boolean {
    return this.catalogs.has(catalogId);
  }

  get(catalogId: string): CatalogDefinition | undefined {
    return this.catalogs.get(catalogId);
  }

  require(catalogId: string): CatalogDefinition {
    const definition = this.get(catalogId);
    if (!definition) throw new Error(`Catalog 未注册: ${catalogId}`);
    return definition;
  }

  supportsComponent(catalogId: string, component: string): boolean {
    const components = this.get(catalogId)?.components;
    // 查表只读自有属性，防止 __proto__/constructor/toString 借原型链冒充已注册组件。
    return components !== undefined && Object.prototype.hasOwnProperty.call(components, component);
  }

  /** action 名白名单（由声明推导）；展示型 Catalog 返回 []。 */
  getActions(catalogId: string): readonly string[] {
    return (this.get(catalogId)?.actions ?? []).map((action) => action.name);
  }

  supportsAction(catalogId: string, action: string): boolean {
    return this.getActions(catalogId).includes(action);
  }

  getComponentDeclaration(
    catalogId: string,
    component: string,
  ): CatalogComponentDeclaration | undefined {
    const components = this.get(catalogId)?.components;
    return components && Object.prototype.hasOwnProperty.call(components, component)
      ? components[component]
      : undefined;
  }

  getComponentSchema(catalogId: string, component: string): ComponentPropsSchema | undefined {
    return this.getComponentDeclaration(catalogId, component)?.schema;
  }

  /**
   * 可写输入绑定属性的值 schema（`inputs` 声明键）；未声明即 undefined，
   * 表示该属性不可本地写回。成员判断只读自有属性，`toString`/`__proto__`
   * 等原型键不得借声明冒充可写输入。
   */
  getInputValueSchema(
    catalogId: string,
    component: string,
    property: string,
  ): ComponentSchemaNode | undefined {
    const inputs = this.getComponentDeclaration(catalogId, component)?.inputs;
    if (!inputs || !Object.prototype.hasOwnProperty.call(inputs, property)) return undefined;
    return inputs[property];
  }

  getActionDeclaration(catalogId: string, action: string): CatalogActionDeclaration | undefined {
    return this.get(catalogId)?.actions.find((declaration) => declaration.name === action);
  }

  getComponentDiagnostics(
    catalogId: string,
    component: Component,
    dataModel?: unknown,
  ): readonly ComponentSchemaDiagnostic[] {
    if (!this.supportsComponent(catalogId, component.component)) {
      return [
        {
          path: component.component,
          message: `Catalog ${catalogId} 不支持组件: ${component.component}`,
        },
      ];
    }
    // v2 保证注册组件必有声明；策略与 props 诊断始终执行。
    const declaration = this.getComponentDeclaration(catalogId, component.component);
    if (!declaration) {
      return [
        {
          path: component.component,
          message: `Catalog ${catalogId} 组件声明缺失: ${component.component}`,
        },
      ];
    }
    const diagnostics: ComponentSchemaDiagnostic[] = [
      ...validateComponentPolicyDiagnostics(component, declaration),
      ...validateComponentPropsDiagnostics(component, declaration.schema, dataModel),
    ];
    const actionName = component.action?.event?.name;
    if (actionName !== undefined) {
      const actionDeclaration = this.getActionDeclaration(catalogId, actionName);
      if (!actionDeclaration) {
        // 未注册 action 名：共享诊断统一报告（runtime 不再另设一套）。
        diagnostics.push({
          path: `components.${component.id}.action.event.name`,
          message: `Catalog ${catalogId} 不支持 action: ${actionName}`,
        });
      } else if (!actionDeclaration.sources.includes(component.component)) {
        diagnostics.push({
          path: `${component.component}.action`,
          message: `Catalog ${catalogId} 的 action ${actionName} 不允许挂载在组件 ${component.component} 上（sources 不含该组件）`,
        });
      }
    }
    return diagnostics;
  }

  validateComponent(catalogId: string, component: Component, dataModel?: unknown): string | null {
    return this.getComponentDiagnostics(catalogId, component, dataModel)[0]?.message ?? null;
  }

  list(): readonly CatalogDefinition[] {
    return [...this.catalogs.values()];
  }
}
