/**
 * @nexus-ui/core/catalog/v2 —— Catalog Contract v2 声明契约。
 *
 * S2.1 锁定形状（SPEC §4.1）；注册闸门、共享解释器与 server 权威准入
 * 分别由 S2.2/S2.4 实施。注册闸门切换后 CatalogDefinitionV2 将替换
 * 现有 v1 CatalogDefinition 形状并移除 V2 后缀。
 */
import type {
  CatalogChecksPolicy,
  CatalogFieldOrigin,
  CatalogFieldPolicy,
  ComponentPropsSchema,
  ComponentSchemaNode,
} from './schema';

/** 组件级 action 声明；挂载来源由 CatalogActionDeclaration.sources 统一决定。 */
export interface CatalogComponentActionRequirement {
  /**
   * 为 true 时组件必须携带 action，且必须出现在至少一个 action 的
   * sources 中；矛盾组合在注册时拒绝。
   */
  readonly required?: boolean;
}

/**
 * v2 字段策略：绑定能力由 schema 节点的 `dynamic` 唯一声明（未声明即
 * forbidden），字段策略不再承载 `binding`，只保留来源与组件引用元数据。
 * 注册闸门切换后该类型并回 CatalogFieldPolicy 并移除 v1 的 binding 成员。
 */
export type CatalogFieldPolicyV2 = Pick<CatalogFieldPolicy, 'origin' | 'componentRef'>;

export interface CatalogComponentDeclaration {
  /** 必填 props schema（受限 JSON-Schema-like 子集）；标准组件复用 SDK 提供的同型声明。 */
  readonly schema: ComponentPropsSchema;
  /** 字段元数据（origin/componentRef）；键必须是 schema.properties 已声明字段，未声明字段默认拒绝。 */
  readonly fields?: Readonly<Record<string, CatalogFieldPolicyV2>>;
  /**
   * 可写输入绑定：绑定属性名 → 值 schema。缺省或空表示该组件无本地输入。
   * 键必须是 schema.properties 中 dynamic 非 forbidden 的可绑定字段；
   * 值 schema 描述浏览器提交的字面值，不得声明 dynamic。
   */
  readonly inputs?: Readonly<Record<string, ComponentSchemaNode>>;
  readonly action?: CatalogComponentActionRequirement;
  /** checks 能力边界（沿用 v1 语义）；enabled 为 true 时 functions 必须非空。 */
  readonly checks?: CatalogChecksPolicy;
  readonly origin?: CatalogFieldOrigin;
}

export interface CatalogActionDeclaration {
  /** action 名称；与组件挂载的 action.event.name 匹配，单个 Catalog 内唯一。 */
  readonly name: string;
  /**
   * 允许挂载该 action 的组件名。由声明决定 action 来源，不按组件名特判；
   * 必须非空、无重复且均为已声明组件。
   */
  readonly sources: readonly string[];
  /**
   * 服务端重算后的参数对象 schema；缺省表示该 action 不接受任何参数，
   * 重算结果必须是空对象。
   */
  readonly paramSchema?: ComponentPropsSchema;
}

/**
 * Catalog Contract v2 宿主声明。actions 必填（展示型 Catalog 显式 `[]`）；
 * 每个发布组件必须携带完整声明，name-only 条目不再存在。
 * 注册期拒绝范围（未知键、不支持 schema 语法、矛盾声明等）见 SPEC §4.1。
 */
export interface CatalogDefinitionV2 {
  readonly catalogId: string;
  readonly components: Readonly<Record<string, CatalogComponentDeclaration>>;
  readonly actions: readonly CatalogActionDeclaration[];
}
