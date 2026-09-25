/**
 * @nexus-ui/core/catalog —— Catalog 注册表。
 *
 * core 登记 catalogId、组件名边界与可选 props 契约，但不感知渲染器。
 */
import type { Component } from '../protocol/types';
import {
  validateComponentPolicyDiagnostics,
  validateComponentPropsDiagnostics,
  type ComponentSchemaDiagnostic,
  validateComponentSchema,
  type ComponentPropsSchema,
  type CatalogComponentPolicy,
} from './schema';

export interface CatalogDefinition {
  readonly catalogId: string;
  readonly components: readonly string[];
  /** Optional host-declared action whitelist; display-only catalogs may use []. */
  readonly actions?: readonly string[];
  /** Catalog-specific props contracts; components without a schema are name-only. */
  readonly componentSchemas?: Readonly<Record<string, ComponentPropsSchema>>;
  /** Capability boundary for fields, action attachment, checks, and extension origin. */
  readonly componentPolicies?: Readonly<Record<string, CatalogComponentPolicy>>;
}

export type { ComponentSchemaDiagnostic } from './schema';

function validateDefinition(definition: CatalogDefinition): void {
  if (!definition.catalogId) throw new Error('Catalog catalogId 不能为空');
  if (definition.components.length === 0) throw new Error('Catalog components 不能为空');

  const components = new Set<string>();
  for (const component of definition.components) {
    if (!component) throw new Error('Catalog component 名称不能为空');
    if (components.has(component)) {
      throw new Error(`Catalog component 重复: ${component}`);
    }
    components.add(component);
  }

  for (const [component, schema] of Object.entries(definition.componentSchemas ?? {})) {
    if (!component) throw new Error('Catalog component schema 名称不能为空');
    if (!components.has(component)) {
      throw new Error(`Catalog component schema 引用了未注册组件: ${component}`);
    }
    validateComponentSchema(schema, `Catalog ${definition.catalogId}.${component} schema`);
  }

  const actions = new Set<string>();
  for (const action of definition.actions ?? []) {
    if (!action) throw new Error('Catalog action 名称不能为空');
    if (actions.has(action)) throw new Error(`Catalog action 重复: ${action}`);
    actions.add(action);
  }

  for (const [component, policy] of Object.entries(definition.componentPolicies ?? {})) {
    if (!component) throw new Error('Catalog component policy 名称不能为空');
    if (!components.has(component)) {
      throw new Error(`Catalog component policy 引用了未注册组件: ${component}`);
    }
    for (const field of Object.keys(policy.fields ?? {})) {
      if (!field)
        throw new Error(`Catalog ${definition.catalogId}.${component} field 名称不能为空`);
    }
    if (policy.checks?.maxRules !== undefined && policy.checks.maxRules < 0) {
      throw new Error(`Catalog ${definition.catalogId}.${component} checks.maxRules 不能为负数`);
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
    return this.get(catalogId)?.components.includes(component) ?? false;
  }

  getActions(catalogId: string): readonly string[] {
    return this.get(catalogId)?.actions ?? [];
  }

  supportsAction(catalogId: string, action: string): boolean {
    return this.getActions(catalogId).includes(action);
  }

  getComponentSchema(catalogId: string, component: string): ComponentPropsSchema | undefined {
    return this.get(catalogId)?.componentSchemas?.[component];
  }

  getComponentPolicy(catalogId: string, component: string): CatalogComponentPolicy | undefined {
    return this.get(catalogId)?.componentPolicies?.[component];
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
    const schema = this.getComponentSchema(catalogId, component.component);
    const policy = this.getComponentPolicy(catalogId, component.component);
    return [
      ...(policy ? validateComponentPolicyDiagnostics(component, policy) : []),
      ...(schema ? validateComponentPropsDiagnostics(component, schema, dataModel) : []),
    ];
  }

  validateComponent(catalogId: string, component: Component, dataModel?: unknown): string | null {
    return this.getComponentDiagnostics(catalogId, component, dataModel)[0]?.message ?? null;
  }

  list(): readonly CatalogDefinition[] {
    return [...this.catalogs.values()];
  }
}
