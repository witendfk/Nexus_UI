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

export { PROTOCOL_VERSION, isA2UIMessage, validateA2UIMessage } from './protocol';
export type {
  A2UIVersion,
  ComponentId,
  DataPath,
  DataBinding,
  LocalFunctionCall,
  ServerActionEvent,
  DynamicValue,
  Action,
  Component,
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
  Surface,
  RenderFn,
  RenderMap,
  A2UIError,
  A2UIDiagnostic,
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
} from './dataModel/index';
export { buildTree } from './render/index';
export { buildActionEvent } from './action/index';
export { A2UIRuntime } from './runtime/index';
export type { RuntimeOptions } from './runtime/index';
export { CatalogRegistry } from './catalog/index';
export type { CatalogDefinition } from './catalog/index';
export {
  validateComponentProps,
  validateComponentPropsDiagnostics,
  validateComponentSchema,
} from './catalog/schema';
export type {
  ComponentPropsSchema,
  ComponentSchemaDiagnostic,
  ComponentSchemaNode,
  DynamicBindingPolicy,
  SchemaValueType,
} from './catalog/schema';
