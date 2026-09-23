/**
 * @nexus-ui/core/runtime —— 协议运行时。
 *
 * 三个范式无关 seam 的交汇点：
 *   IN   push(chunk) / dispatch(message)   协议流入（两范式响应回流都进这）
 *   OUT  onRender(VNode)                   渲染出
 *   OUT  onAction(ActionEvent)             action 出口（两范式唯一差异点）
 *
 * 编排：push → JSONLBuffer 切行 → parse → applyMessage（四类分发，写 store）
 * → rerender（buildTree）→ onRender。组件 action 经 triggerAction → buildActionEvent
 * （core 解析 context）→ onAction。畸形 JSON → addError + onError，不中断后续流。
 */
import { JSONLBuffer } from '../buffer';
import type { CoreStore } from '../state';
import { createCoreStore } from '../state';
import { buildTree } from '../render';
import { buildActionEvent } from '../action';
import { validateA2UIMessage } from '../protocol/validator';
import type {
  A2UIDiagnostic,
  A2UIError,
  A2UIMessage,
  ActionEvent,
  Component,
  ParseResult,
  VNode,
} from '../protocol/types';
import { applyDataModelUpdate } from '../dataModel/index';
import type { CatalogRegistry, ComponentSchemaDiagnostic } from '../catalog/index';

export { isA2UIMessage } from '../protocol/validator';

export interface RuntimeOptions {
  /** VNode 根重建后回调（宿主框架在此挂载/重渲染）。surface 删除时 root 为 null。 */
  onRender?: (root: VNode | null, surfaceId: string) => void;
  /**
   * [seam] action 出口：组件触发交互后，内核解析完 context 吐出此事件。
   * 两范式差异仅在宿主如何处理：agent 线 → POST server；ToB 线 → 前端路由表。
   */
  onAction?: (event: ActionEvent) => void;
  /** 解析/消息异常回调；Catalog 校验失败时可携带结构化 diagnostics。 */
  onError?: (error: A2UIError) => void;
  /**
   * Optional host-owned catalog boundary. When supplied, every surface catalog
   * and component name is checked; registered props schemas are also enforced.
   */
  catalogRegistry?: CatalogRegistry;
}

/** 协议运行时：把 A2UI 流式协议渐进渲染成框架无关 VNode，并经 onAction 吐出交互。 */
export class A2UIRuntime {
  /** 内核 store（公开，供宿主按需订阅/读取 surface 状态）。 */
  readonly store: CoreStore = createCoreStore();
  private readonly buffer = new JSONLBuffer();
  private readonly options: RuntimeOptions;

  constructor(options: RuntimeOptions = {}) {
    this.options = options;
  }

  /** 喂入一段流文本（可含多条 JSONL，或跨 chunk 的半行）。 */
  push(chunk: string): void {
    for (const line of this.buffer.push(chunk)) this.handleLine(line);
  }

  /** 流结束，冲刷残留。 */
  end(): void {
    for (const line of this.buffer.flush()) this.handleLine(line);
  }

  /** 直接喂一条已解析的消息；与 push 走同一套结构和生命周期校验。 */
  dispatch(message: A2UIMessage): void {
    const raw = stringifyMessage(message);
    const result = validateA2UIMessage(message);
    const validatedMessage = result.message;
    if (!result.ok || !validatedMessage) {
      this.reportError({ message: result.error?.message ?? '非法消息结构', raw });
      return;
    }
    const catalogError = this.getCatalogIssue(validatedMessage);
    if (catalogError) {
      this.reportError({ ...catalogError, raw });
      return;
    }
    this.acceptMessage(validatedMessage, raw);
  }

  /** 解析一条 JSONL 文本。 */
  parse(line: string): ParseResult {
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      return { ok: false, error: { message: 'JSON 解析失败', raw: line } };
    }
    const result = validateA2UIMessage(obj);
    const parsedMessage = result.message;
    if (!result.ok || !parsedMessage) {
      return {
        ok: false,
        error: { message: result.error?.message ?? '非法消息结构', raw: line },
      };
    }
    const catalogError = this.getCatalogIssue(parsedMessage);
    if (catalogError) {
      return { ok: false, error: { ...catalogError, raw: line } };
    }
    return result;
  }

  /**
   * [seam] 触发某组件的 action：查其 action 定义 → core 解析 context（{path} 绑定）
   * → 经 onAction 吐出 ActionEvent。范式无关。组件不存在或无 action 则静默。
   */
  triggerAction(sourceComponentId: string, surfaceId: string): void {
    const st = this.store.getState();
    const component = st.componentsBySurface[surfaceId]?.[sourceComponentId];
    if (!component) return;
    const model = st.dataModelBySurface[surfaceId];
    const event = buildActionEvent(component, surfaceId, model);
    if (event) this.options.onAction?.(event);
  }

  /** [seam] 受控输入写回：渲染层只上报组件与新值，绑定路径仍由 core 解释。 */
  setInputValue(
    componentId: string,
    surfaceId: string,
    value: string | boolean | string[],
  ): boolean {
    const st = this.store.getState();
    const component = st.componentsBySurface[surfaceId]?.[componentId];
    const binding = component?.value;
    const bindingPath =
      typeof binding === 'object' &&
      binding !== null &&
      !Array.isArray(binding) &&
      'path' in binding
        ? (binding as { path: unknown }).path
        : undefined;
    if (
      !component ||
      !(
        component.component === 'TextField' ||
        component.component === 'CheckBox' ||
        component.component === 'ChoicePicker' ||
        component.component === 'DateTimeInput'
      ) ||
      (component.component === 'TextField' && typeof value !== 'string') ||
      (component.component === 'CheckBox' && typeof value !== 'boolean') ||
      (component.component === 'ChoicePicker' &&
        (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))) ||
      (component.component === 'DateTimeInput' && typeof value !== 'string') ||
      Object.keys(binding ?? {}).length !== 1 ||
      typeof bindingPath !== 'string'
    ) {
      return false;
    }

    st.setDataModelValueAtPath(surfaceId, bindingPath, value);
    this.rerender(surfaceId);
    return true;
  }

  private handleLine(line: string): void {
    const result = this.parse(line);
    if (!result.ok || !result.message) {
      this.reportError({ ...(result.error ?? { message: '解析失败' }), raw: line });
      return;
    }
    this.acceptMessage(result.message, line);
  }

  private acceptMessage(message: A2UIMessage, raw: string): void {
    const surfaceId = getSurfaceId(message);
    const lifecycleError = this.getLifecycleError(message, surfaceId);
    if (lifecycleError) {
      this.reportError({ message: lifecycleError, raw, surfaceId });
      return;
    }

    try {
      this.applyMessage(message);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      this.reportError({ message: `处理 A2UI 消息失败: ${messageText}`, raw, surfaceId });
    }
  }

  private getLifecycleError(message: A2UIMessage, surfaceId: string): string | null {
    const exists = Object.prototype.hasOwnProperty.call(this.store.getState().surfaces, surfaceId);
    if ('createSurface' in message) return exists ? `Surface 已存在: ${surfaceId}` : null;
    return exists ? null : `Surface 尚未创建: ${surfaceId}`;
  }

  private getCatalogIssue(message: A2UIMessage): A2UIError | null {
    const registry = this.options.catalogRegistry;
    if (!registry) return null;

    if ('createSurface' in message) {
      const catalogId = message.createSurface.catalogId;
      return registry.has(catalogId) ? null : { message: `Agent catalog 未注册: ${catalogId}` };
    }

    const state = this.store.getState();
    let diagnostics: readonly ComponentSchemaDiagnostic[] = [];

    if ('updateComponents' in message) {
      const surfaceId = message.updateComponents.surfaceId;
      const surface = state.surfaces[surfaceId];
      const catalogId = surface?.catalogId;
      if (!catalogId) return null;
      const dataModel = state.dataModelBySurface[surfaceId];
      diagnostics = message.updateComponents.components.flatMap((component) => [
        ...registry.getComponentDiagnostics(catalogId, component, dataModel),
        ...this.getActionDiagnostics(registry, catalogId, component),
      ]);
    } else if ('updateDataModel' in message) {
      const surfaceId = message.updateDataModel.surfaceId;
      const surface = state.surfaces[surfaceId];
      const catalogId = surface?.catalogId;
      if (!catalogId) return null;

      const nextDataModel = applyDataModelUpdate(
        state.dataModelBySurface[surfaceId],
        message.updateDataModel,
      );
      diagnostics = Object.values(state.componentsBySurface[surfaceId] ?? {}).flatMap((component) =>
        registry.getComponentDiagnostics(catalogId, component, nextDataModel),
      );
    }

    return diagnostics.length > 0 ? { message: formatDiagnostics(diagnostics), diagnostics } : null;
  }

  private getActionDiagnostics(
    registry: CatalogRegistry,
    catalogId: string,
    component: Component,
  ): readonly ComponentSchemaDiagnostic[] {
    const actions = registry.get(catalogId)?.actions;
    if (actions === undefined) return [];

    const actionName = component.action?.event?.name;
    if (actionName === undefined || actions.includes(actionName)) return [];

    return [
      {
        path: `components.${component.id}.action.event.name`,
        message: `Catalog ${catalogId} 不支持 action: ${actionName}`,
      },
    ];
  }

  private reportError(error: A2UIError): void {
    reportRuntimeError(this.store, this.options, error);
  }

  private applyMessage(message: A2UIMessage): void {
    const st = this.store.getState();
    if ('createSurface' in message) {
      const p = message.createSurface;
      st.createSurface({
        id: p.surfaceId,
        catalogId: p.catalogId,
        theme: p.theme,
        sendDataModel: p.sendDataModel,
      });
    } else if ('updateComponents' in message) {
      const p = message.updateComponents;
      st.upsertComponents(p.surfaceId, p.components);
      this.rerender(p.surfaceId);
    } else if ('updateDataModel' in message) {
      const p = message.updateDataModel;
      st.applyDataModel(p);
      this.rerender(p.surfaceId);
    } else {
      const p = message.deleteSurface;
      st.deleteSurface(p.surfaceId);
      this.options.onRender?.(null, p.surfaceId);
    }
  }

  private rerender(surfaceId: string): void {
    const st = this.store.getState();
    const components = st.componentsBySurface[surfaceId];
    if (!components) return; // surface 尚无组件
    const model = st.dataModelBySurface[surfaceId];
    const root = buildTree(components, surfaceId, model);
    this.options.onRender?.(root, surfaceId);
  }
}

/** 统一记录解析、生命周期和处理异常，保证单条坏消息不中断流。 */
function reportRuntimeError(store: CoreStore, options: RuntimeOptions, error: A2UIError): void {
  store.getState().addError(error);
  options.onError?.(error);
}

function getSurfaceId(message: A2UIMessage): string {
  if ('createSurface' in message) return message.createSurface.surfaceId;
  if ('updateComponents' in message) return message.updateComponents.surfaceId;
  if ('updateDataModel' in message) return message.updateDataModel.surfaceId;
  return message.deleteSurface.surfaceId;
}

function formatDiagnostics(diagnostics: readonly A2UIDiagnostic[]): string {
  return diagnostics.map((diagnostic) => diagnostic.message).join('; ');
}

function stringifyMessage(message: A2UIMessage): string {
  try {
    return JSON.stringify(message);
  } catch {
    return '[无法序列化的 A2UI 消息]';
  }
}
