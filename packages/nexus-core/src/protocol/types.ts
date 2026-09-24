/**
 * @nexus-ui/core/protocol/types —— A2UI v0.9 协议契约（内核唯一类型源）。
 *
 * 派生自 `specification/v0_9`。本模块是「契约层 → 内核层」的唯一入口：所有协议 /
 * 运行时类型集中于此，其他子模块一律从此 re-export，避免双重定义。
 *
 * v0.9 要点：
 *   - 每条消息带 `version: "v0.9"`；
 *   - 组件扁平（id + 类型名 + 内联属性），容器用 children / child 引用子组件；
 *   - 数据模型为普通 JSON，按 JSON Pointer（RFC 6901）寻址；
 *   - 数据绑定 `{ path }` 指向数据模型中的值。
 */

/* ───────────────────────── 0. 版本 ───────────────────────── */

/** A2UI 协议版本字面量。 */
export const PROTOCOL_VERSION = 'v0.9' as const;
/** 信封 `version` 字段类型。 */
export type A2UIVersion = typeof PROTOCOL_VERSION;

/* ───────────────────────── 1. 通用类型 ───────────────────────── */

/** 组件实例唯一标识（同一 surface 内）。 */
export type ComponentId = string;

/** JSON Pointer（RFC 6901）。 */
export type DataPath = string;

/** 数据绑定：`{ path }` 指向数据模型中的值。 */
export interface DataBinding {
  path: DataPath;
}

/** 本地函数调用。Agent 线第一版不执行，仅保留协议形状。 */
export interface LocalFunctionCall {
  call: string;
  args?: Record<string, unknown>;
  returnType?: string;
}

/** DynamicBoolean：字面布尔、数据绑定，或返回布尔值的本地函数调用。 */
export type DynamicBoolean = boolean | DataBinding | LocalFunctionCall;

/** 服务端 action 事件定义。 */
export interface ServerActionEvent {
  name: string;
  /** 上下文键值对，值可为 DynamicValue（如 `{ path }` 绑定），由内核解析为真值。 */
  context?: Record<string, DynamicValue>;
}

/** 动态值：字面量 | `{ path }` 绑定。FunctionCall 求值后续由函数注册表接入。 */
export type DynamicValue = string | number | boolean | null | unknown[] | DataBinding;

/** Structured runtime diagnostic; catalog schema diagnostics use the same shape. */
export interface A2UIDiagnostic {
  /** Logical location, such as a component props path. */
  readonly path: string;
  readonly message: string;
  /** Present when the diagnostic concerns a dataModel path behind a `{ path }` binding. */
  dataPath?: DataPath;
}

/* ───────────────────────── 2. 扁平组件 ───────────────────────── */

/**
 * 组件交互处理器：触发事件（event）。functionCall 形式留待后续阶段。
 */
export interface Action {
  /** 服务端事件；Agent 线第一版仅支持该形式。 */
  event?: ServerActionEvent;
  /** 本地函数调用；协议形状保留，当前 runtime 不执行。 */
  functionCall?: LocalFunctionCall;
}

/**
 * 扁平组件（v0.9 邻接表元素）：`updateComponents.components[]` 的元素。
 *
 * `id` + 类型名 + 内联属性。容器用 `children`（静态子 id 列表）或 `child`（单子）
 * 引用子组件；其余属性（text/variant/...）由具体 catalog 组件约定，内核不解释，
 * 故用索引签名收容。
 */
export interface Component {
  /** 组件实例 id（同 surface 内唯一）。 */
  id: ComponentId;
  /** 组件类型名（须在 catalog 中存在，如 "Text"/"Column"）。 */
  component: string;
  /** 容器子节点：静态子 id 列表。 */
  children?: ComponentId[];
  /** 单子引用（如 Button 的 label）。 */
  child?: ComponentId;
  /** Tabs 组件的静态标签定义；每个 child 引用一个扁平组件。 */
  tabs?: TabItem[];
  /** 交互处理器（Button 等）。 */
  action?: Action;
  /** Checkable 组件的客户端校验规则。 */
  checks?: CheckRule[];
  /** 其余组件特定属性。 */
  [key: string]: unknown;
}

/** A2UI Checkable 规则；condition 为真表示校验通过。 */
export interface CheckRule {
  condition: DynamicBoolean;
  message: string;
}

/** Tabs 的静态标签定义。 */
export interface TabItem {
  title: DynamicValue;
  child: ComponentId;
}

/* ───────────────────────── 3. server → client 消息 ───────────────────────── */

/** createSurface 载荷：创建 surface（catalogId 必填）。 */
export interface CreateSurfacePayload {
  surfaceId: string;
  catalogId: string;
  theme?: Record<string, unknown>;
  /** Agent 线第一版要求为 false 或省略。 */
  sendDataModel?: boolean;
}

/** updateComponents 载荷：扁平组件列表（其中须含 id="root"）。 */
export interface UpdateComponentsPayload {
  surfaceId: string;
  components: Component[];
}

/** updateDataModel 载荷：按 JSON Pointer upsert；省略 path 视为 /；省略 value 则删除。 */
export interface UpdateDataModelPayload {
  surfaceId: string;
  path?: DataPath;
  value?: unknown;
}

/** deleteSurface 载荷。 */
export interface DeleteSurfacePayload {
  surfaceId: string;
}

export interface CreateSurfaceMessage {
  version: A2UIVersion;
  createSurface: CreateSurfacePayload;
}
export interface UpdateComponentsMessage {
  version: A2UIVersion;
  updateComponents: UpdateComponentsPayload;
}
export interface UpdateDataModelMessage {
  version: A2UIVersion;
  updateDataModel: UpdateDataModelPayload;
}
export interface DeleteSurfaceMessage {
  version: A2UIVersion;
  deleteSurface: DeleteSurfacePayload;
}

/**
 * `[契约]` server→client 信封联合类型。每条消息恰含上述其一键 + `version: "v0.9"`。
 * 经 JSONL / SSE / WebSocket 等任意 transport 以「JSON 对象流」送达。
 */
export type A2UIMessage =
  | CreateSurfaceMessage
  | UpdateComponentsMessage
  | UpdateDataModelMessage
  | DeleteSurfaceMessage;

/** 解析一条 JSONL 文本的结果。 */
export interface ParseResult {
  ok: boolean;
  message?: A2UIMessage;
  error?: { message: string; raw?: string; diagnostics?: readonly A2UIDiagnostic[] };
}

/* ───────────────────────── 4. 主题 ───────────────────────── */

/** createSurface.theme：基础 catalog 主题（primaryColor 为 6 位十六进制）。 */
export interface Theme {
  primaryColor?: string;
  iconUrl?: string;
  agentDisplayName?: string;
  [key: string]: unknown;
}

/* ───────────────────────── 5. 运行时类型（实现定义） ───────────────────────── */

/**
 * `[契约]` VNode —— 框架无关的渲染中间表示（全仓库唯一定义）。
 * 由 TreeBuilder 从邻接表构建，供 Renderer 转成具体框架元素。
 * 未到达的子组件占位为 `type: "__placeholder__"`。
 */
export interface VNode {
  id: ComponentId;
  type: string;
  props: Record<string, unknown>;
  children: VNode[] | null;
  surfaceId: string;
  /** core 根据 checks 与当前 dataModel 派生的校验状态。 */
  validation?: ComponentValidation;
}

/** 渲染层消费的 checks 派生状态。 */
export interface ComponentValidation {
  valid: boolean;
  message?: string;
}

/** Surface：渲染隔离单元（独立 root / 组件表 / 数据模型）。 */
export interface Surface {
  id: string;
  catalogId: string;
  theme?: Record<string, unknown>;
  sendDataModel?: boolean;
}

/** 渲染函数：把一个 VNode（含已渲染的子元素）映射为某框架元素。 */
export type RenderFn = (vnode: VNode, children: unknown[]) => unknown;
/** 组件名 → 渲染函数 的映射表，由渲染层注入。 */
export type RenderMap = Record<string, RenderFn>;

/** 内核错误记录（避免与全局 Error 构造器冲突）。 */
export interface A2UIError {
  message: string;
  raw?: string;
  surfaceId?: string;
  diagnostics?: readonly A2UIDiagnostic[];
}

/**
 * `[seam]` 已解析的 action 事件——内核经 `onAction` 回调吐出。
 * context 已由内核按数据模型解析为真值（不再是 `{ path }` 绑定）。
 * 两个范式（agent / ToB）的差异仅在于宿主如何处理此事件，内核不关心。
 */
export interface ActionEvent {
  name: string;
  surfaceId: string;
  sourceComponentId: ComponentId;
  context: Record<string, unknown>;
}
