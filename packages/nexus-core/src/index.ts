/**
 * @nexus-ui/core —— 框架无关的 A2UI v0.9 流式协议运行时（内核）。
 *
 * 三个范式无关 seam（预埋 agent 线 + ToB 线）：
 *   IN   push(chunk) / dispatch(message)    协议流入（两范式响应回流都进这）
 *   OUT  onRender(VNode)                    渲染出
 *   OUT  onAction(ActionEvent)              action 出口（两范式唯一差异点）
 *
 * 渲染由宿主框架（@nexus-ui/react 等）通过 onRender 挂载；交互经 onAction 出口交宿主。
 */
export const VERSION = '0.1.0';
/** Root-entry API contract version. Internal module paths are not public. */
export const CORE_API_VERSION = 1;

export {
  PROTOCOL_VERSION,
  isA2UIMessage,
  isSafeMediaUrl,
  validateA2UIMessage,
  validateNexusProfileMessage,
  validateProtocolMessage,
} from './protocol';
export type {
  A2UIVersion,
  ComponentId,
  DataPath,
  DataBinding,
  LocalFunctionCall,
  ServerActionEvent,
  DynamicValue,
  DynamicBoolean,
  Action,
  Component,
  CheckRule,
  TabItem,
  CreateSurfacePayload,
  UpdateComponentsPayload,
  UpdateDataModelPayload,
  DeleteSurfacePayload,
  CreateSurfaceMessage,
  UpdateComponentsMessage,
  UpdateDataModelMessage,
  DeleteSurfaceMessage,
  A2UIMessage,
  ParseResult,
  Theme,
  VNode,
  ComponentValidation,
  Surface,
  RenderFn,
  RenderMap,
  A2UIError,
  A2UIDiagnostic,
  A2UIErrorCode,
  ActionEvent,
} from './protocol';
export { JSONLBuffer } from './buffer/index';
export { createCoreStore } from './state/index';
export type { CoreState, CoreStore, A2UIErrorRecord } from './state';
export {
  getByPath,
  setValueAtPath,
  removeAtPath,
  applyDataModelUpdate,
  resolveDynamic,
  resolveContext,
  toDisplayString,
  isUnsafeDataPath,
} from './dataModel/index';
export { buildTree } from './render/index';
export { buildActionEvent } from './action/index';
export { A2UIRuntime } from './runtime/index';
export type { InputDraftSnapshot, InputDraftSnapshotEntry, RuntimeOptions } from './runtime/index';
export { compileSafeRegExp } from './checks/index';
export type { SafeRegExp } from './checks/index';
export { CatalogRegistry } from './catalog/index';
export { standardCatalogComponentDeclarations } from './catalog/standard';
export type {
  CatalogActionDeclaration,
  CatalogChecksPolicy,
  CatalogComponentActionRequirement,
  CatalogComponentDeclaration,
  CatalogFieldOrigin,
  CatalogFieldPolicy,
} from './catalog/schema';
export type { CatalogDefinition } from './catalog/index';
export { createCatalogPromptContract } from './catalog/prompt';
export {
  isDataBinding,
  validateComponentPolicyDiagnostics,
  validateComponentProps,
  validateComponentPropsDiagnostics,
  validateComponentSchema,
  validateInputValueDiagnostics,
  validateInputValueSchema,
} from './catalog/schema';
export type {
  ComponentPropsSchema,
  ComponentSchemaDiagnostic,
  ComponentSchemaNode,
  DynamicBindingPolicy,
  SchemaValueType,
} from './catalog/schema';
export { NEXUS_SESSION_VERSION } from './session/index';
export type { NexusActionInput, NexusActionMetadata, NexusSurfaceCommit } from './session/index';

export { normalizeJsonPointer, getStrictPath, setStrictPath } from './dataModel/strict-path';
export { parseSurfaceCommit } from './session';

export { CATALOG_CONTRACT_VERSION } from './catalog';
export {
  CATALOG_CONTRACT_HASH_PATTERN,
  getCatalogContractHashInput,
  isCatalogContractHash,
} from './catalog/contract-hash';
