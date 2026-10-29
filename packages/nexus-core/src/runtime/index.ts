import { setStrictPath } from '../dataModel/strict-path';
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
import { JSONLBuffer, MAX_JSONL_LINE_LENGTH } from '../buffer';
import type { CoreStore } from '../state';
import { createCoreStore } from '../state';
import { buildTree } from '../render';
import { validateRenderLimits } from '../render/limits';
import { buildActionEvent } from '../action';
import { validateNexusProfileMessage, validateProtocolMessage } from '../protocol/validator';
import type {
  A2UIDiagnostic,
  A2UIError,
  A2UIMessage,
  ActionEvent,
  Component,
  ParseResult,
  VNode,
} from '../protocol/types';
import {
  applyDataModelUpdate,
  DataModelResourceLimitError,
  isUnsafeDataPath,
} from '../dataModel/index';
import type { CatalogRegistry, ComponentSchemaDiagnostic } from '../catalog/index';
import { isDataBinding, validateInputValueDiagnostics } from '../catalog/index';
import { getFirstFailedCheck } from '../checks';
import type { NexusActionInput } from '../session/index';

export { isA2UIMessage } from '../protocol/validator';

interface InputDraft {
  readonly input: NexusActionInput;
  readonly catalogId: string;
  readonly componentType: string;
  readonly bindingPath: string;
  readonly declarationKey: string;
  /** 草稿代次：同 key 每次成功写回都取新的单调值；确认按它逐条比对。 */
  readonly serial: number;
}

/** 发送侧草稿快照中的单个条目：wire 输入 + 提取时的草稿代次。 */
export interface InputDraftSnapshotEntry {
  readonly input: NexusActionInput;
  readonly serial: number;
}

/**
 * S2.6.4.1 发送快照：一次成功提交只能确认「发送时」的草稿。确认按 surfaceId +
 * 逐条 `(componentId, property)` 的 serial 相等判定，不按值相等——请求期间的
 * 再次编辑（含改回同值）、改绑/替换组件与其他 surface 的草稿都不会被误删。
 * 快照只与创建它的同一 runtime 实例配合使用（token 含实例标识）。
 */
export interface InputDraftSnapshot {
  readonly surfaceId: string;
  readonly runtimeId: number;
  readonly entries: readonly InputDraftSnapshotEntry[];
}

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
   * and component name is checked; registered props schemas and checks/action
   * capabilities are also enforced. Without a registry, only Protocol/Profile
   * validation applies; standard declarations are not an implicit catalog.
   */
  catalogRegistry?: CatalogRegistry;
  /**
   * 单次渲染的 VNode 数量上限（防 Agent 构造超大树/共享子树爆炸）。默认 10000；
   * 占位节点一并计入。触发时以 FEATURE_UNSUPPORTED 诊断上报，超出部分按占位节点渲染。
   */
  maxNodes?: number;
  /** 链式深度上限（默认 1000）：保护宿主 React 递归消费路径，超深层以占位呈现。 */
  maxDepth?: number;
  /**
   * 单 surface 数据模型序列化字节上限（S4.0 资源边界；UTF-8 JSON，默认 1 MiB）。
   * 协议 updateDataModel 应用后超限：整条消息以结构化错误拒绝，状态不变；
   * 本地输入写回超限：写回失败返回 false，状态不变。非法值构造时抛错。
   */
  maxDataModelBytes?: number;
  /**
   * 单 surface 组件数量上限（S4.0 资源边界；现有+新增去重，默认 10000，与渲染
   * maxNodes 同量级）。updateComponents 超限整条消息拒绝，状态不变。
   */
  maxComponentsPerSurface?: number;
}

/** 单 surface 完整视图快照（S4.1.2-A）：出界深拷贝，恢复时整体验重验。 */
export interface SurfaceViewSnapshot {
  surfaceId: string;
  catalogId: string;
  components: Component[];
  dataModel: unknown;
  theme?: Record<string, unknown>;
  sendDataModel?: boolean;
}

/** 协议运行时：把 A2UI 流式协议渐进渲染成框架无关 VNode，并经 onAction 吐出交互。 */
export class A2UIRuntime {
  /** 内核 store（公开，供宿主按需订阅/读取 surface 状态）。 */
  readonly store: CoreStore = createCoreStore();
  private readonly buffer = new JSONLBuffer(({ length }) =>
    this.reportError({
      code: 'PROTOCOL_INVALID',
      message: `JSONL 行长度 ${length} 超过上限 ${MAX_JSONL_LINE_LENGTH}，已整行丢弃，后续行继续处理`,
    }),
  );
  private readonly options: RuntimeOptions;
  /** [S4.1.2-A] 稳定视图快照缓存：底层引用不变时重复读取返回同一对象。 */
  private readonly viewCache = new Map<
    string,
    {
      refs: { components: unknown; dataModel: unknown; catalogId: string };
      snapshot: SurfaceViewSnapshot;
    }
  >();
  /** [S4.1.2-A] per-surface 订阅与上次通知时的引用基线。 */
  private readonly surfaceListeners = new Map<string, Set<() => void>>();
  /** [S4.2] per-surface 渲染订阅：外部渲染层（如 React Provider）无需注入 onRender。 */
  private readonly renderListeners = new Map<string, Set<(root: VNode | null) => void>>();
  private readonly lastRoots = new Map<string, VNode | null>();
  private readonly lastSeenRefs = new Map<
    string,
    { surface: unknown; components: unknown; dataModel: unknown }
  >();

  /**
   * 按 surface 记录的最新输入草稿（组件 + 绑定属性 → 最新合法值）。这是本地编辑
   * 日志，不是已提交状态：仅声明驱动写回成功时更新，deleteSurface 时清理；
   * S4 client 经 getLatestInputs 读取后组装 action 请求。
   */
  private readonly latestInputs = new Map<string, Map<string, InputDraft>>();
  /** 草稿代次计数器（runtime 实例内单调递增）。 */
  private nextInputDraftSerial = 0;
  /** runtime 实例标识：草稿快照只与创建它的实例配合确认。 */
  private static nextRuntimeId = 0;
  private readonly runtimeId = ++A2UIRuntime.nextRuntimeId;

  constructor(options: RuntimeOptions = {}) {
    validateRenderLimits(options);
    if (
      options.maxDataModelBytes !== undefined &&
      (!Number.isSafeInteger(options.maxDataModelBytes) || options.maxDataModelBytes <= 0)
    ) {
      throw new Error('maxDataModelBytes 必须是正安全整数');
    }
    if (
      options.maxComponentsPerSurface !== undefined &&
      (!Number.isSafeInteger(options.maxComponentsPerSurface) ||
        options.maxComponentsPerSurface <= 0)
    ) {
      throw new Error('maxComponentsPerSurface 必须是正安全整数');
    }
    this.options = { ...options };
    // [S4.1.2-A] 内部订阅一次 store：按 surface 比较引用，只通知有专属订阅且
    // 该 surface 确实发生变化的监听器；同步失效稳定快照缓存。
    // runtime 与 store 同生命周期；订阅句柄无需显式退订。
    this.store.subscribe(() => this.dispatchSurfaceChanges());
  }

  /**
   * [S4.1.2-A] store 变化后按 surface 精确分发：仅通知「有专属订阅且该 surface
   * 三维引用（surface 元数据/组件表/数据模型）发生变化」的监听器。基线在订阅时
   * 捕获；getSurfaceView 的稳定缓存按底层引用自校验，无需此处失效。
   */
  private dispatchSurfaceChanges(): void {
    const st = this.store.getState();
    for (const [surfaceId, listeners] of [...this.surfaceListeners]) {
      const current = {
        surface: st.surfaces[surfaceId],
        components: st.componentsBySurface[surfaceId],
        dataModel: st.dataModelBySurface[surfaceId],
      };
      const seen = this.lastSeenRefs.get(surfaceId);
      if (
        seen !== undefined &&
        seen.surface === current.surface &&
        seen.components === current.components &&
        seen.dataModel === current.dataModel
      ) {
        continue;
      }
      this.lastSeenRefs.set(surfaceId, current);
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          /* 观察者不改变已发布事实或阻断其他订阅。 */
        }
      }
    }
  }

  /** [S4.1.2-A] 读取单 surface 完整视图快照（深拷贝出界，底层未变时引用稳定）。 */
  getSurfaceView(surfaceId: string): SurfaceViewSnapshot | undefined {
    const st = this.store.getState();
    if (
      !Object.prototype.hasOwnProperty.call(st.surfaces, surfaceId) ||
      !Object.prototype.hasOwnProperty.call(st.componentsBySurface, surfaceId)
    )
      return undefined;
    const surface = st.surfaces[surfaceId];
    const components = st.componentsBySurface[surfaceId];
    const dataModel = st.dataModelBySurface[surfaceId] ?? null;
    const cached = this.viewCache.get(surfaceId);
    if (
      cached &&
      cached.refs.components === components &&
      cached.refs.dataModel === dataModel &&
      cached.refs.catalogId === surface.catalogId
    ) {
      return cached.snapshot;
    }
    const refs = { components, dataModel, catalogId: surface.catalogId };
    const snapshot = deepFreeze({
      surfaceId,
      catalogId: surface.catalogId,
      components: Object.values(components).map((component) => structuredClone(component)),
      dataModel: structuredClone(dataModel),
      ...(surface.theme === undefined ? {} : { theme: structuredClone(surface.theme) }),
      ...(surface.sendDataModel === undefined ? {} : { sendDataModel: surface.sendDataModel }),
    } as SurfaceViewSnapshot);
    this.viewCache.set(surfaceId, { refs, snapshot });
    return snapshot;
  }

  /**
   * [S4.1.2-A] 校验后原子恢复单 surface 完整视图：入界深拷贝 → 资源预算 →
   * 完整 Catalog 重验（组件声明/checks 一致性 + root 存在 + id 唯一）→ 一次
   * 原子替换三维并清除该 surface 本地草稿（恢复视图即权威状态；恢复拒绝时
   * 原视图、基准与草稿完全不变）。已存在 surface 的 catalogId 不允许变更。
   */
  restoreSurfaceView(snapshot: SurfaceViewSnapshot): void {
    const owned = this.validateSurfaceView(snapshot);
    this.latestInputs.delete(owned.surfaceId);
    this.publishView(owned);
  }

  /** 创建同 Catalog/预算的独立视图运行时；不继承宿主回调、状态或草稿。 */
  createViewRuntime(): A2UIRuntime {
    return new A2UIRuntime({
      ...this.options,
      onRender: undefined,
      onAction: undefined,
      onError: undefined,
    });
  }

  /**
   * 发布完整候选视图并原子协调本地草稿：只确认发送代次，保留仍有效的新编辑。
   * 所有校验与模型合并先完成，失败不发布视图或确认草稿。
   */
  commitSurfaceView(snapshot: SurfaceViewSnapshot, sent: InputDraftSnapshot): void {
    if (sent.runtimeId !== this.runtimeId || sent.surfaceId !== snapshot.surfaceId) {
      throw new Error('草稿快照与运行时/surface 不一致');
    }
    const owned = this.validateSurfaceView(snapshot);
    const confirmed = new Map(
      sent.entries.map((entry) => [
        JSON.stringify([entry.input.componentId, entry.input.property]),
        entry.serial,
      ]),
    );
    const remaining = new Map<string, InputDraft>();
    const components = Object.fromEntries(owned.components.map((c) => [c.id, c]));
    for (const [key, draft] of this.latestInputs.get(owned.surfaceId) ?? []) {
      if (confirmed.get(key) === draft.serial) continue;
      const component = components[draft.input.componentId];
      const binding = component?.[draft.input.property];
      const registry = this.options.catalogRegistry;
      if (
        !component ||
        !registry ||
        draft.catalogId !== owned.catalogId ||
        component.component !== draft.componentType ||
        !isDataBinding(binding) ||
        binding.path !== draft.bindingPath ||
        isUnsafeDataPath(binding.path) ||
        registry.getInputValueSchema(owned.catalogId, component.component, draft.input.property) ===
          undefined ||
        JSON.stringify(registry.getComponentDeclaration(owned.catalogId, component.component)) !==
          draft.declarationKey
      )
        continue;
      owned.dataModel = setStrictPath(
        owned.dataModel,
        binding.path,
        structuredClone(draft.input.value),
      );
      remaining.set(key, draft);
    }
    if (
      jsonByteLength(owned.dataModel) >
      (this.options.maxDataModelBytes ?? DEFAULT_MAX_DATA_MODEL_BYTES)
    ) {
      throw new DataModelResourceLimitError('候选视图与本地草稿合并超过模型字节上限');
    }
    // 草稿先协调，所有观察者读取的都是同一次发布的视图/草稿。
    if (remaining.size) this.latestInputs.set(owned.surfaceId, remaining);
    else this.latestInputs.delete(owned.surfaceId);
    this.publishView(owned);
  }

  private validateSurfaceView(snapshot: SurfaceViewSnapshot): SurfaceViewSnapshot {
    if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new Error('恢复快照必须是 SurfaceViewSnapshot 对象');
    }
    const owned = structuredClone(snapshot);
    const { surfaceId, catalogId, components } = owned;
    if (
      typeof surfaceId !== 'string' ||
      !surfaceId ||
      typeof catalogId !== 'string' ||
      !catalogId
    ) {
      throw new Error('恢复快照缺少非空 surfaceId/catalogId');
    }
    if (!Array.isArray(components)) throw new Error('恢复快照 components 必须是数组');
    owned.dataModel = owned.dataModel ?? null;
    const surfaces = this.store.getState().surfaces;
    const existing = Object.prototype.hasOwnProperty.call(surfaces, surfaceId)
      ? surfaces[surfaceId]
      : undefined;
    if (existing && existing.catalogId !== catalogId) {
      throw new Error(`恢复快照 catalogId 与既有 surface 绑定不一致: ${surfaceId}`);
    }
    const componentCap = this.options.maxComponentsPerSurface ?? DEFAULT_MAX_COMPONENTS_PER_SURFACE;
    if (components.length > componentCap) {
      throw new DataModelResourceLimitError(`恢复视图组件数量超过上限 ${componentCap}`);
    }
    if (
      jsonByteLength(owned.dataModel) >
      (this.options.maxDataModelBytes ?? DEFAULT_MAX_DATA_MODEL_BYTES)
    ) {
      throw new DataModelResourceLimitError('恢复视图数据模型字节超过上限');
    }
    // 完整复用协议与 Profile；不借临时 store 中间态的 Catalog 检查否决合法绑定。
    const messages: unknown[] = [
      {
        version: 'v0.9',
        createSurface: {
          surfaceId,
          catalogId,
          ...(owned.theme === undefined ? {} : { theme: owned.theme }),
          ...(owned.sendDataModel === undefined ? {} : { sendDataModel: owned.sendDataModel }),
        },
      },
      { version: 'v0.9', updateComponents: { surfaceId, components } },
      { version: 'v0.9', updateDataModel: { surfaceId, value: owned.dataModel } },
    ];
    for (const message of messages) {
      const protocol = validateProtocolMessage(message);
      if (!protocol.ok) throw new Error(`恢复视图 Protocol 校验失败: ${protocol.error?.message}`);
      const profile = validateNexusProfileMessage(message);
      if (profile) throw new Error(`恢复视图 Profile 校验失败: ${profile.message}`);
    }
    const componentMap = new Map<string, Component>();
    for (const component of components) {
      if (componentMap.has(component.id))
        throw new Error(`恢复视图存在重复组件 id: ${component.id}`);
      componentMap.set(component.id, component);
    }
    if (!componentMap.has('root')) throw new Error('恢复视图缺少 id 为 root 的组件');
    validateReferences(componentMap);
    const registry = this.options.catalogRegistry;
    if (registry) {
      if (!registry.has(catalogId)) throw new Error(`恢复快照的 Catalog 未注册: ${catalogId}`);
      const diagnostics = components.flatMap((component) =>
        registry.getComponentDiagnostics(catalogId, component, owned.dataModel),
      );
      if (diagnostics.length)
        throw new Error(`恢复视图未通过 Catalog 校验: ${formatDiagnostics(diagnostics)}`);
    }
    return owned;
  }

  private publishView(view: SurfaceViewSnapshot): void {
    this.viewCache.delete(view.surfaceId);
    this.store.getState().replaceSurfaceView({
      ...view,
      components: Object.fromEntries(view.components.map((component) => [component.id, component])),
    });
    this.rerender(view.surfaceId);
  }

  /**
   * [S4.1.2-A] 按 surface 订阅：仅该 surface 三维引用变化时通知；解除后不再
   * 通知。监听器内经 `getSurfaceView` 读取稳定快照。
   */
  subscribeSurface(surfaceId: string, listener: () => void): () => void {
    let listeners = this.surfaceListeners.get(surfaceId);
    if (!listeners) {
      listeners = new Set();
      this.surfaceListeners.set(surfaceId, listeners);
      const st = this.store.getState();
      this.lastSeenRefs.set(surfaceId, {
        surface: st.surfaces[surfaceId],
        components: st.componentsBySurface[surfaceId],
        dataModel: st.dataModelBySurface[surfaceId],
      });
    }
    listeners.add(listener);
    return () => {
      const set = this.surfaceListeners.get(surfaceId);
      if (!set) return;
      set.delete(listener);
      if (set.size === 0) {
        this.surfaceListeners.delete(surfaceId);
        this.lastSeenRefs.delete(surfaceId);
      }
    };
  }

  /**
   * [S4.1.2-A] 受控删除单 surface（级联清理组件表/数据模型/本地草稿）；受订阅
   * 的监听器经引用变化收到通知。删除是确定性的：目标不存在时无操作。
   */
  removeSurfaceView(surfaceId: string): void {
    this.latestInputs.delete(surfaceId);
    this.store.getState().deleteSurface(surfaceId);
    this.viewCache.delete(surfaceId);
    this.dropRoot(surfaceId);
    try {
      this.options.onRender?.(null, surfaceId);
    } catch {
      /* 观察者异常隔离。 */
    }
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
    this.dispatchChecked(message);
  }

  /** 单条消息的完整准入结果（含生命周期/资源校验）；不依赖有界错误日志。 */
  dispatchChecked(message: unknown): ParseResult {
    const raw = stringifyMessage(message);
    const result = validateProtocolMessage(message);
    const validatedMessage = result.message;
    if (!result.ok || !validatedMessage) {
      return this.rejectMessage({
        ...(result.error ?? { message: '非法消息结构' }),
        raw,
      });
    }
    const profileError = validateNexusProfileMessage(validatedMessage);
    if (profileError) {
      return this.rejectMessage({ ...profileError, raw });
    }
    const catalogError = this.getCatalogIssue(validatedMessage);
    if (catalogError) {
      return this.rejectMessage({ ...catalogError, raw });
    }
    return this.acceptMessage(validatedMessage, raw);
  }

  /** 解析一条 JSONL 文本。 */
  parse(line: string): ParseResult {
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      return {
        ok: false,
        error: { code: 'PROTOCOL_INVALID', message: 'JSON 解析失败', raw: line },
      };
    }
    const result = validateProtocolMessage(obj);
    const parsedMessage = result.message;
    if (!result.ok || !parsedMessage) {
      return {
        ok: false,
        error: {
          ...(result.error ?? { message: '非法消息结构' }),
          raw: line,
        },
      };
    }
    const profileError = validateNexusProfileMessage(parsedMessage);
    if (profileError) {
      return { ok: false, error: { ...profileError, raw: line } };
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
    if (getFirstFailedCheck(component.checks, model) !== null) return;
    const event = buildActionEvent(component, surfaceId, model);
    if (event) this.options.onAction?.(event);
  }

  /**
   * [seam] 受控输入写回：渲染层只上报组件、绑定属性与新值；写回目标路径与值域
   * 由当前宿主 Catalog 的 `inputs` 声明解释（属性必须是 inputs 键，值经声明值
   * schema 校验，路径取自组件的 `{ path }` 绑定并拒绝保留段）。未注入 registry、
   * 组件/属性未声明、值不符、绑定缺失或危险路径一律返回 false 且状态不变；
   * 标准输入与自定义输入走同一路径，不存在按组件名的值类型分支。
   */
  setInputValue(componentId: string, surfaceId: string, property: string, value: unknown): boolean {
    const st = this.store.getState();
    const component = st.componentsBySurface[surfaceId]?.[componentId];
    const valueSchema =
      component !== undefined
        ? this.options.catalogRegistry?.getInputValueSchema(
            st.surfaces[surfaceId]?.catalogId ?? '',
            component.component,
            property,
          )
        : undefined;
    if (!component || valueSchema === undefined) return false;
    if (
      validateInputValueDiagnostics(value, valueSchema, `${component.component}.${property}`)
        .length > 0
    ) {
      return false;
    }

    const binding = (component as unknown as Record<string, unknown>)[property];
    if (!isDataBinding(binding) || isUnsafeDataPath(binding.path)) return false;

    const catalogId = st.surfaces[surfaceId].catalogId;
    const declarationKey = JSON.stringify(
      this.options.catalogRegistry!.getComponentDeclaration(catalogId, component.component),
    );
    // 模型、草稿和调用方分别持有快照；所有克隆在写入前完成，失败不留下局部状态。
    let written: unknown;
    let draftValue: unknown;
    try {
      written = structuredClone(value);
      draftValue = structuredClone(written);
    } catch {
      return false;
    }
    try {
      const candidate = setStrictPath(st.dataModelBySurface[surfaceId], binding.path, written);
      const cap = this.options.maxDataModelBytes ?? DEFAULT_MAX_DATA_MODEL_BYTES;
      if (jsonByteLength(candidate) > cap) return false;
      st.setDataModelValueAtPath(surfaceId, '', candidate);
    } catch {
      // 中间节点非容器、数组越界等写失败：状态未变，与显式拒绝同一语义
      return false;
    }
    this.recordLatestInput(surfaceId, {
      input: { componentId, property, value: draftValue },
      catalogId,
      componentType: component.component,
      bindingPath: binding.path,
      declarationKey,
    });
    this.rerender(surfaceId);
    return true;
  }

  /**
   * 读取某 surface 的最新输入草稿（`NexusActionInput[]`，数组顺序不携带语义）。
   * 返回独立快照；组件类型、绑定或 Catalog 声明变化后清除草稿。S2 不组装 action 请求，
   * 服务端权威准入（S2.4/S2.5）照常整批校验，本地草稿不替代它。
   */
  getLatestInputs(surfaceId: string): readonly NexusActionInput[] {
    this.pruneLatestInputs(surfaceId);
    return Array.from(this.latestInputs.get(surfaceId)?.values() ?? [], ({ input }) =>
      structuredClone(input),
    );
  }

  /**
   * S2.6.4.1 发送快照：与 getLatestInputs 同一套失效清理，另携带逐条草稿代次。
   * 消费方在组装 action 请求时提取一次；请求成功且通过本地完整性校验后，把同一
   * 快照交给 confirmInputDrafts。wire 形状（`nexus.inputs`）只取 entries 的 input。
   */
  extractLatestInputDrafts(surfaceId: string): InputDraftSnapshot {
    this.pruneLatestInputs(surfaceId);
    return {
      surfaceId,
      runtimeId: this.runtimeId,
      entries: Array.from(
        this.latestInputs.get(surfaceId)?.values() ?? [],
        ({ input, serial }) => ({
          input: structuredClone(input),
          serial,
        }),
      ),
    };
  }

  /**
   * 确认本次已提交的草稿：仅删除「代次仍与快照一致」的条目。发送期间的新编辑
   * （serial 已变化，含改回同值）、改绑/替换组件（已被失效清理删除）、其他
   * surface 与其他 runtime 的草稿一律保留。剩余草稿恢复到本地编辑模型，serial
   * 不变；已发送且未再编辑的字段保留服务端归一化结果。恢复写路径失败返回 false，
   * 不确认任何条目、不部分写回；调用方不得开放 action。幂等。
   */
  confirmInputDrafts(snapshot: InputDraftSnapshot): boolean {
    if (snapshot.runtimeId !== this.runtimeId) return false;
    this.pruneLatestInputs(snapshot.surfaceId);
    const byKey = this.latestInputs.get(snapshot.surfaceId);
    if (!byKey) return true;
    const confirmed = new Set<string>();
    for (const entry of snapshot.entries) {
      const key = JSON.stringify([entry.input.componentId, entry.input.property]);
      const draft = byKey.get(key);
      if (draft !== undefined && draft.serial === entry.serial) confirmed.add(key);
    }
    const remaining = [...byKey].filter(([key]) => !confirmed.has(key));
    const st = this.store.getState();
    let model = st.dataModelBySurface[snapshot.surfaceId];
    try {
      for (const [, draft] of remaining) {
        model = setStrictPath(model, draft.bindingPath, structuredClone(draft.input.value));
      }
      const cap = this.options.maxDataModelBytes ?? DEFAULT_MAX_DATA_MODEL_BYTES;
      if (remaining.length > 0 && jsonByteLength(model) > cap) return false;
    } catch {
      return false;
    }
    if (remaining.length > 0) st.setDataModelValueAtPath(snapshot.surfaceId, '', model);
    for (const key of confirmed) byKey.delete(key);
    if (byKey.size === 0) this.latestInputs.delete(snapshot.surfaceId);
    if (remaining.length > 0) this.rerender(snapshot.surfaceId);
    return true;
  }

  private pruneLatestInputs(surfaceId: string): void {
    const byKey = this.latestInputs.get(surfaceId);
    if (!byKey) return;
    const registry = this.options.catalogRegistry;
    const st = this.store.getState();
    const catalogId = st.surfaces[surfaceId]?.catalogId;
    const components = st.componentsBySurface[surfaceId];
    if (!registry || catalogId === undefined || !components) {
      this.latestInputs.delete(surfaceId);
      return;
    }
    for (const [key, draft] of byKey) {
      const { input } = draft;
      const component = components[input.componentId];
      const binding = (component as unknown as Record<string, unknown> | undefined)?.[
        input.property
      ];
      if (
        !component ||
        draft.catalogId !== catalogId ||
        draft.componentType !== component.component ||
        !isDataBinding(binding) ||
        binding.path !== draft.bindingPath ||
        isUnsafeDataPath(binding.path) ||
        registry.getInputValueSchema(catalogId, component.component, input.property) ===
          undefined ||
        JSON.stringify(registry.getComponentDeclaration(catalogId, component.component)) !==
          draft.declarationKey
      ) {
        byKey.delete(key);
      }
    }
    if (byKey.size === 0) this.latestInputs.delete(surfaceId);
  }

  private recordLatestInput(surfaceId: string, draft: Omit<InputDraft, 'serial'>): void {
    let byKey = this.latestInputs.get(surfaceId);
    if (!byKey) {
      byKey = new Map();
      this.latestInputs.set(surfaceId, byKey);
    }
    const { componentId, property } = draft.input;
    byKey.set(JSON.stringify([componentId, property]), {
      ...draft,
      serial: ++this.nextInputDraftSerial,
    });
  }

  private handleLine(line: string): void {
    const result = this.parse(line);
    if (!result.ok || !result.message) {
      this.reportError({ ...(result.error ?? { message: '解析失败' }), raw: line });
      return;
    }
    this.acceptMessage(result.message, line);
  }

  private rejectMessage(error: A2UIError): ParseResult {
    this.reportError(error);
    return { ok: false, error };
  }

  private acceptMessage(message: A2UIMessage, raw: string): ParseResult {
    const surfaceId = getSurfaceId(message);
    const lifecycleError = this.getLifecycleError(message, surfaceId);
    if (lifecycleError) {
      return this.rejectMessage({ ...lifecycleError, raw, surfaceId });
    }

    try {
      this.applyMessage(message);
      return { ok: true, message };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      if (error instanceof DataModelResourceLimitError) {
        // 资源边界拒绝是确定性分类，不是处理故障：与渲染限额同用
        // FEATURE_UNSUPPORTED 上报（Nexus 会话资源码归 server 提交映射）。
        return this.rejectMessage({
          code: 'FEATURE_UNSUPPORTED',
          message: messageText,
          raw,
          surfaceId,
        });
      }
      return this.rejectMessage({ message: `处理 A2UI 消息失败: ${messageText}`, raw, surfaceId });
    }
  }

  private getLifecycleError(
    message: A2UIMessage,
    surfaceId: string,
  ): { code: 'LIFECYCLE_INVALID'; message: string } | null {
    const exists = Object.prototype.hasOwnProperty.call(this.store.getState().surfaces, surfaceId);
    if ('createSurface' in message) {
      return exists ? { code: 'LIFECYCLE_INVALID', message: `Surface 已存在: ${surfaceId}` } : null;
    }
    return exists ? null : { code: 'LIFECYCLE_INVALID', message: `Surface 尚未创建: ${surfaceId}` };
  }

  /**
   * Catalog 预校验。预计算（如 updateDataModel 的下一模型快照）可能因保留路径等
   * 抛出异常——这里统一收敛为结构化拒绝，绝不让异常穿出 parse/dispatch，
   * 保证同一 chunk 内的后续消息继续处理。
   */
  private getCatalogIssue(message: A2UIMessage): A2UIError | null {
    const registry = this.options.catalogRegistry;
    if (!registry) return null;

    try {
      if ('createSurface' in message) {
        const catalogId = message.createSurface.catalogId;
        return registry.has(catalogId)
          ? null
          : { code: 'CATALOG_UNSUPPORTED', message: `Agent catalog 未注册: ${catalogId}` };
      }

      const state = this.store.getState();
      let diagnostics: readonly ComponentSchemaDiagnostic[] = [];

      if ('updateComponents' in message) {
        const surfaceId = message.updateComponents.surfaceId;
        const surface = state.surfaces[surfaceId];
        const catalogId = surface?.catalogId;
        if (!catalogId) return null;
        const dataModel = state.dataModelBySurface[surfaceId];
        diagnostics = message.updateComponents.components.flatMap((component) =>
          registry.getComponentDiagnostics(catalogId, component, dataModel),
        );
      } else if ('updateDataModel' in message) {
        const surfaceId = message.updateDataModel.surfaceId;
        const surface = state.surfaces[surfaceId];
        const catalogId = surface?.catalogId;
        if (!catalogId) return null;

        const nextDataModel = applyDataModelUpdate(
          state.dataModelBySurface[surfaceId],
          message.updateDataModel,
        );
        diagnostics = Object.values(state.componentsBySurface[surfaceId] ?? {}).flatMap(
          (component) => registry.getComponentDiagnostics(catalogId, component, nextDataModel),
        );
      }

      return diagnostics.length > 0
        ? { code: 'CATALOG_UNSUPPORTED', message: formatDiagnostics(diagnostics), diagnostics }
        : null;
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      return {
        code: 'CATALOG_UNSUPPORTED',
        message: `Catalog 预校验失败，消息被拒绝: ${messageText}`,
      };
    }
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
      // 组件数量上限（S4.0）：现有 + 新增去重，超限整条消息拒绝，状态不变。
      const cap = this.options.maxComponentsPerSurface ?? DEFAULT_MAX_COMPONENTS_PER_SURFACE;
      const existing = st.componentsBySurface[p.surfaceId] ?? {};
      let incoming = 0;
      for (const component of p.components) {
        if (!Object.prototype.hasOwnProperty.call(existing, component.id)) incoming += 1;
      }
      if (Object.keys(existing).length + incoming > cap) {
        throw new DataModelResourceLimitError(
          `Surface ${p.surfaceId} 组件数量超过上限 ${cap}，消息被拒绝`,
        );
      }
      st.upsertComponents(p.surfaceId, p.components);
      // 在每次已接受的组件更新后清理，不能等提取时才过滤，否则替换再恢复会复活旧值。
      this.pruneLatestInputs(p.surfaceId);
      this.rerender(p.surfaceId);
    } else if ('updateDataModel' in message) {
      const p = message.updateDataModel;
      // 数据模型字节上限（S4.0）：应用后序列化超限整条消息拒绝，状态不变。
      const next = applyDataModelUpdate(st.dataModelBySurface[p.surfaceId], p);
      const cap = this.options.maxDataModelBytes ?? DEFAULT_MAX_DATA_MODEL_BYTES;
      if (jsonByteLength(next) > cap) {
        throw new DataModelResourceLimitError(
          `Surface ${p.surfaceId} 数据模型字节超过上限 ${cap}，消息被拒绝`,
        );
      }
      st.setDataModelValueAtPath(p.surfaceId, '', next);
      this.rerender(p.surfaceId);
    } else {
      const p = message.deleteSurface;
      this.removeSurfaceView(p.surfaceId);
    }
  }

  private rerender(surfaceId: string): void {
    const st = this.store.getState();
    const components = st.componentsBySurface[surfaceId];
    if (!components) return; // surface 尚无组件
    const model = st.dataModelBySurface[surfaceId];
    const root = buildTree(components, surfaceId, model, {
      maxNodes: this.options.maxNodes,
      maxDepth: this.options.maxDepth,
      onLimit: ({ reason, limit }) =>
        reportRuntimeError(this.store, this.options, {
          code: 'FEATURE_UNSUPPORTED',
          message:
            reason === 'depth'
              ? `Surface ${surfaceId} 渲染深度超过上限 ${limit}，更深层以占位呈现`
              : `Surface ${surfaceId} 渲染节点数超过上限 ${limit}，超出部分以占位呈现`,
          surfaceId,
        }),
    });
    // 渲染订阅（S4.2）与遗留 onRender 出口并行分发；任一侧异常互不影响。
    this.lastRoots.set(surfaceId, root);
    const renderListeners = this.renderListeners.get(surfaceId);
    if (renderListeners) {
      for (const listener of [...renderListeners]) {
        try {
          listener(root);
        } catch {
          // 渲染层回调失败不阻断 runtime 状态机。
        }
      }
    }
    try {
      this.options.onRender?.(root, surfaceId);
    } catch (error) {
      try {
        this.reportError({
          message: `渲染观察者失败: ${error instanceof Error ? error.message : String(error)}`,
          surfaceId,
        });
      } catch {
        /* 诊断观察者异常隔离。 */
      }
    }
  }

  /**
   * [S4.2] 订阅单 surface 的渲染输出（VNode 根树）：外部渲染层无需在构造时注入
   * onRender 即可接入既有 runtime。解除后不再通知。
   */
  subscribeSurfaceRender(surfaceId: string, listener: (root: VNode | null) => void): () => void {
    let listeners = this.renderListeners.get(surfaceId);
    if (!listeners) {
      listeners = new Set();
      this.renderListeners.set(surfaceId, listeners);
    }
    listeners.add(listener);
    return () => {
      const set = this.renderListeners.get(surfaceId);
      if (!set) return;
      set.delete(listener);
      if (set.size === 0) this.renderListeners.delete(surfaceId);
    };
  }

  /** [S4.2] 读取某 surface 最近一次渲染的 VNode 根（无渲染记录返回 null）。 */
  getLastRoot(surfaceId: string): VNode | null {
    return this.lastRoots.get(surfaceId) ?? null;
  }

  /** [S4.2] 删除 surface 时同步清空渲染缓存并通知渲染层卸载。 */
  private dropRoot(surfaceId: string): void {
    this.lastRoots.delete(surfaceId);
    const listeners = this.renderListeners.get(surfaceId);
    if (listeners) {
      for (const listener of [...listeners]) {
        try {
          listener(null);
        } catch {
          // 同上：渲染层回调失败不阻断。
        }
      }
    }
  }
}

const DEFAULT_MAX_DATA_MODEL_BYTES = 1_048_576;
const DEFAULT_MAX_COMPONENTS_PER_SURFACE = 10_000;
const textEncoder = new TextEncoder();

/** 深冻结快照：消费方误改在严格模式下直接暴露，而非静默撕裂状态。 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/** UTF-8 JSON 序列化字节（与 wire 预算同口径）；不可序列化按超限拒绝。 */
function jsonByteLength(value: unknown): number {
  try {
    return textEncoder.encode(JSON.stringify(value) ?? '').length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
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

function stringifyMessage(message: unknown): string {
  try {
    return JSON.stringify(message);
  } catch {
    return '[无法序列化的 A2UI 消息]';
  }
}

/** 完整视图引用必须存在且无环；共享子树合法，迭代 DFS 不受链深影响。 */
function validateReferences(components: Map<string, Component>): void {
  const edges = new Map<string, string[]>();
  for (const component of components.values()) {
    const refs = [
      ...(component.children ?? []),
      ...(component.child === undefined ? [] : [component.child]),
      ...(component.tabs ?? []).map((tab) => tab.child),
    ];
    for (const id of refs)
      if (!components.has(id)) throw new Error(`恢复视图引用不存在: ${component.id} → ${id}`);
    edges.set(component.id, refs);
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  for (const id of components.keys()) {
    if (visited.has(id)) continue;
    const stack = [{ id, index: 0 }];
    active.add(id);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const refs = edges.get(frame.id)!;
      if (frame.index === refs.length) {
        visited.add(frame.id);
        active.delete(frame.id);
        stack.pop();
        continue;
      }
      const child = refs[frame.index++];
      if (active.has(child)) throw new Error(`恢复视图存在引用环: ${child}`);
      if (!visited.has(child)) {
        active.add(child);
        stack.push({ id: child, index: 0 });
      }
    }
  }
}
