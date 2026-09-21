import type { A2UIDiagnostic, Component } from '../protocol/types';
import { getByPath } from '../dataModel/index';

export type SchemaValueType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'array'
  | 'object'
  | 'null';

export type DynamicBindingPolicy = 'forbidden' | 'allowed' | 'required';

/**
 * A deterministic JSON-Schema-like subset for catalog component props.
 *
 * `dynamic` is the A2UI extension: a value may be a literal, or `{ path }`
 * pointing to a value in the surface dataModel. Structural fields (`children`,
 * `child`, `tabs`, and `action`) remain owned by the protocol validator.
 */
export interface ComponentSchemaNode {
  readonly type?: SchemaValueType;
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly items?: ComponentSchemaNode;
  readonly properties?: Readonly<Record<string, ComponentSchemaNode>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly dynamic?: DynamicBindingPolicy;
}

export interface ComponentPropsSchema extends ComponentSchemaNode {
  readonly type?: 'object';
}

export interface ComponentSchemaDiagnostic extends A2UIDiagnostic {
  // Intentionally structural: protocol diagnostics remain transport-neutral.
}

const SCHEMA_TYPES: readonly SchemaValueType[] = [
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
  'null',
];

const DYNAMIC_POLICIES: readonly DynamicBindingPolicy[] = ['forbidden', 'allowed', 'required'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDataBinding(value: unknown): value is { path: string } {
  return (
    isObject(value) &&
    Object.keys(value).length === 1 &&
    typeof value.path === 'string' &&
    value.path.length > 0
  );
}

function describeEnum(values: readonly unknown[]): string {
  return values.map((value) => JSON.stringify(value) ?? 'null').join('/');
}

function typeMatches(value: unknown, type: SchemaValueType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isObject(value);
    case 'null':
      return value === null;
  }
}

function deepEquals(left: unknown, right: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item, index) => deepEquals(item, right[index], depth + 1))
    );
  }
  if (!isObject(left) || !isObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        deepEquals(left[key], right[key], depth + 1),
    )
  );
}

type DiagnosticCollector = (path: string, message: string, dataPath?: string) => void;

function validateSchemaNode(node: unknown, path: string, depth = 0): string | null {
  if (depth > 32) return `${path} 嵌套深度不能超过 32`;
  if (!isObject(node)) return `${path} 必须是 schema 对象`;

  if (node.type !== undefined && !SCHEMA_TYPES.includes(node.type as SchemaValueType)) {
    return `${path}.type 只支持 ${SCHEMA_TYPES.join('/')}`;
  }
  if (
    node.dynamic !== undefined &&
    !DYNAMIC_POLICIES.includes(node.dynamic as DynamicBindingPolicy)
  ) {
    return `${path}.dynamic 只支持 ${DYNAMIC_POLICIES.join('/')}`;
  }
  if (node.enum !== undefined) {
    if (!Array.isArray(node.enum) || node.enum.length === 0) {
      return `${path}.enum 必须是非空数组`;
    }
    if (
      new Set(node.enum.map((value) => JSON.stringify(value) ?? 'null')).size !== node.enum.length
    ) {
      return `${path}.enum 不能包含重复值`;
    }
  }

  for (const key of ['minLength', 'maxLength'] as const) {
    const value = node[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      return `${path}.${key} 必须是非负整数`;
    }
  }
  if (
    typeof node.minLength === 'number' &&
    typeof node.maxLength === 'number' &&
    node.minLength > node.maxLength
  ) {
    return `${path}.minLength 不能大于 maxLength`;
  }

  for (const key of ['minimum', 'maximum'] as const) {
    const value = node[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return `${path}.${key} 必须是数字`;
    }
  }
  if (
    typeof node.minimum === 'number' &&
    typeof node.maximum === 'number' &&
    node.minimum > node.maximum
  ) {
    return `${path}.minimum 不能大于 maximum`;
  }

  if (node.pattern !== undefined) {
    if (typeof node.pattern !== 'string') return `${path}.pattern 必须是字符串`;
    try {
      new RegExp(node.pattern);
    } catch {
      return `${path}.pattern 必须是合法正则表达式`;
    }
  }

  if (node.items !== undefined) {
    const itemError = validateSchemaNode(node.items, `${path}.items`, depth + 1);
    if (itemError) return itemError;
  }

  if (node.properties !== undefined) {
    if (!isObject(node.properties)) return `${path}.properties 必须是对象`;
    for (const [key, property] of Object.entries(node.properties)) {
      if (!key) return `${path}.properties 的字段名不能为空`;
      const propertyError = validateSchemaNode(property, `${path}.properties.${key}`, depth + 1);
      if (propertyError) return propertyError;
    }
  }

  if (node.required !== undefined) {
    if (
      !Array.isArray(node.required) ||
      node.required.length === 0 ||
      node.required.some((key) => typeof key !== 'string' || key.length === 0)
    ) {
      return `${path}.required 必须是非空字符串数组`;
    }
    const required = new Set(node.required as string[]);
    if (required.size !== node.required.length) {
      return `${path}.required 不能包含重复字段`;
    }
    if (node.properties) {
      for (const key of required) {
        if (!(key in node.properties)) return `${path}.required 引用了未定义字段: ${key}`;
      }
    }
  }

  if (node.additionalProperties !== undefined && typeof node.additionalProperties !== 'boolean') {
    return `${path}.additionalProperties 只支持 true/false`;
  }

  return null;
}

/** Validate a schema definition before it is allowed to enter a registry. */
export function validateComponentSchema(schema: unknown, label: string): void {
  const error = validateSchemaNode(schema, label);
  if (error) throw new Error(error);
  if (isObject(schema) && schema.type !== undefined && schema.type !== 'object') {
    throw new Error(`${label}.type 必须是 object`);
  }
}

function collectLiteralErrors(
  value: unknown,
  schema: ComponentSchemaNode,
  path: string,
  add: DiagnosticCollector,
  dataPath: string | undefined,
  depth: number,
  dataModel: unknown | undefined,
): void {
  if (depth > 64) {
    add(path, `${path} 嵌套深度不能超过 64`, dataPath);
    return;
  }

  if (schema.type !== undefined && !typeMatches(value, schema.type)) {
    add(path, `${path} 必须是 ${schema.type}`, dataPath);
    return;
  }
  if (schema.enum !== undefined) {
    if (!schema.enum.some((candidate) => deepEquals(candidate, value))) {
      add(path, `${path} 只支持 ${describeEnum(schema.enum)}`, dataPath);
    }
  }
  if (schema.const !== undefined && !deepEquals(schema.const, value)) {
    add(path, `${path} 必须等于 ${JSON.stringify(schema.const) ?? 'null'}`, dataPath);
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      add(path, `${path} 长度不能小于 ${schema.minLength}`, dataPath);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      add(path, `${path} 长度不能超过 ${schema.maxLength}`, dataPath);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      add(path, `${path} 不符合 schema.pattern`, dataPath);
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      add(path, `${path} 不能小于 ${schema.minimum}`, dataPath);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      add(path, `${path} 不能超过 ${schema.maximum}`, dataPath);
    }
  }

  if (Array.isArray(value) && schema.items) {
    for (const [index, item] of value.entries()) {
      collectValueErrors(
        item,
        schema.items,
        `${path}[${index}]`,
        dataModel,
        add,
        depth + 1,
        dataPath,
      );
    }
  }

  if (!isObject(value)) return;

  const properties = schema.properties ?? {};
  for (const key of schema.required ?? []) {
    if (!(key in value)) add(`${path}.${key}`, `${path}.${key} 是必填字段`, dataPath);
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!(key in properties)) {
        add(`${path}.${key}`, `${path}.${key} 不是允许的字段`, dataPath);
      }
    }
  }
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!(key in value)) continue;
    collectValueErrors(
      value[key],
      propertySchema,
      `${path}.${key}`,
      dataModel,
      add,
      depth + 1,
      dataPath,
    );
  }
}

function collectValueErrors(
  value: unknown,
  schema: ComponentSchemaNode,
  path: string,
  dataModel: unknown | undefined,
  add: DiagnosticCollector,
  depth: number,
  inheritedDataPath: string | undefined = undefined,
): void {
  if (depth > 64) {
    add(path, `${path} 嵌套深度不能超过 64`);
    return;
  }

  const dynamic = schema.dynamic ?? 'forbidden';
  if (isDataBinding(value)) {
    if (dynamic === 'forbidden') {
      add(path, `${path} 不支持 { path } 绑定`);
      return;
    }
    if (dataModel === undefined) return;

    const resolved = getByPath(dataModel, value.path);
    if (resolved === undefined) return;
    collectLiteralErrors(resolved, schema, path, add, value.path, depth + 1, dataModel);
    return;
  }

  if (dynamic === 'required') {
    add(path, `${path} 必须是 { path } 绑定`);
    return;
  }
  collectLiteralErrors(value, schema, path, add, inheritedDataPath, depth, dataModel);
}

/**
 * Validate catalog-specific props. Protocol-owned fields are intentionally
 * omitted so this validator composes with, rather than duplicates, A2UI checks.
 */
export function validateComponentProps(
  component: Component,
  schema: ComponentPropsSchema,
  dataModel?: unknown,
): string | null {
  return validateComponentPropsDiagnostics(component, schema, dataModel)[0]?.message ?? null;
}

/** Validate props and return every deterministic schema violation. */
export function validateComponentPropsDiagnostics(
  component: Component,
  schema: ComponentPropsSchema,
  dataModel?: unknown,
): readonly ComponentSchemaDiagnostic[] {
  const {
    id: _id,
    component: _component,
    children: _children,
    child: _child,
    tabs: _tabs,
    action: _action,
    ...props
  } = component;

  const diagnostics: ComponentSchemaDiagnostic[] = [];
  collectValueErrors(
    props,
    schema,
    component.component,
    dataModel,
    (path, message, dataPath) => {
      diagnostics.push(dataPath === undefined ? { path, message } : { path, message, dataPath });
    },
    0,
  );
  return diagnostics;
}
