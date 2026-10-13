# ARCHITECTURE — 架构视图：拓扑、运行时与渲染

状态：本文回答"系统怎么组织、一条消息怎么跑完运行时与渲染、服务端怎么准入与提交、失败落在哪里"。上游需求见 [PRD](PRD.md)，wire/API 精确语义见 [SPEC](SPEC.md)，设计理由见 [DESIGN](DESIGN.md)，进度证据见 [CURRENT](tasks/CURRENT.md)。文中"已接通/目标"等进度注记以 CURRENT 为准。更新：2026-10-13。

## 1. 视图索引：怎么读这套文档

文档五件套各答一类问题，一类事实只有一个家。架构信息在本文内按三个高度组织：**静态视图**（§2 包与依赖）→ **SDK 动态视图**（§3–§7 运行时流水线、渲染管线、服务端准入、状态机、资源边界）→ **业务时序视图**（§8–§9 OrderOps 生成/执行闭环）。

| 问题 | 去处 |
| --- | --- |
| SDK 解决什么问题、为谁、验收线是什么 | [PRD](PRD.md) |
| 消息/字段/端点在 wire 上的精确语义、诊断码、上限数值 | [SPEC](SPEC.md) |
| 系统怎么组织、运行时/渲染/提交怎么流转 | 本文 §2–§7 |
| 业务闭环端到端时序（生成、执行与恢复） | 本文 §8–§9 |
| 为什么选这条路、代价是什么（ADR） | [DESIGN](DESIGN.md) |
| 现在做到哪、下一步、门禁 | [CURRENT](tasks/CURRENT.md) |

## 2. 系统上下文与包拓扑（静态视图）

SDK 面向 Web 宿主：core 独立于框架和传输，React 将 VNode 映射到宿主组件，有限 server 入口装配 guard/Agent/action。当前浏览器 transport 由示例实现；是否抽成 client/组合层取决于独立宿主的接入重复点。包边界、兼容和产物在独立宿主验收；下图的 OrderOps 只是其中一个消费方。

```text
Agent（候选 NDJSON，不可信）
   │ POST /rpc：caseId + Catalog Contract
   ▼
Host server guard（Protocol → Profile → Catalog / Policy 逐条准入；依据 Host Catalog + Policy 声明）
   │ 通过才发 SSE message（可见预览 ≠ 提交；快照提交成功才 done）
   ▼
core runtime（浏览器：JSONL 切行 → 校验 → surface 状态 → VNode）
   │ onRender
   ▼
React renderMap（宿主组件渲染；受控输入即时写回 dataModel）
   │ 用户输入 / 按钮 action
   ▼
action transport（构造 v0.9 action 信封）
   │ POST /api/a2ui/event
   ▼
Nexus adapter（surface 锁 → 快照核对 → ledger 去重 → resolver 提纯）
   │ 已声明输入 + surfaceId
   ▼
Host handler（领域事务：SQLite 写工单/操作/审计 —— 业务事实唯一权威）
   │ 同 surface patch
   └──▶ patch 重过 guard → SSE → core 原位更新 → done（业务终态以 Host 查询为准）
```

### 2.1 包内模块与依赖方向

| 层 / 代码位置 | 负责的状态与接口 | 依赖约束 |
| --- | --- | --- |
| `packages/nexus-core/src/buffer` | JSONL 跨 chunk 切行、单行长度上限与溢出丢弃 | 纯文本层，不感知协议语义 |
| `packages/nexus-core/src/{protocol,catalog,checks}` | v0.9 信封/Profile 校验、Catalog schema/policy、prompt contract、safe regex | 不感知 HTTP、Koa、DOM、React 或业务对象 |
| `packages/nexus-core/src/{state,runtime,render,dataModel,action}` | CoreStore、消息分发与生命周期、VNode 树构建、绑定解析、action 事件构造 | 可替换渲染器，运行时不执行领域 action |
| `packages/nexus-react/src/{provider,renderer,components}` | Provider（持有 runtime）、renderMap 映射、17 个标准组件、输入与无障碍状态 | 依赖 core 公开入口；不拥有业务事实或 transport |
| `server/nexus-playground-server/src/agent` | AgentAdapter、Catalog Contract、guard、Policy、run/ledger/surface 快照 | 以有限 `@nexus-ui/server` 根入口提供装配，不反向 import OrderOps |
| `server/nexus-playground-server/src/{api,transport}` | guarded router、外部 RPC、SSE 与 client action 入口 | 参考 HTTP 装配；自定义宿主可组合公开 API |
| 浏览器接入逻辑（示例中） | 解析 SSE、区分终态、构造 action 信封并挂载 surface | 目前不是 SDK 公共 API；抽取前先核对两个消费方的重复逻辑 |

服务端 guard 是 Agent 输出进浏览器前的主准入点；core 在浏览器再次执行协议/Profile/生命周期校验（可选注入 CatalogRegistry 加组件级校验；Catalog/Policy 的权威准入在 Host guard，OrderOps Web 未注入浏览器侧 registry）。`createCatalogPromptContract` 只帮助 Agent 生成，不能替代 guard。四层职责：Protocol 识别结构、Profile 裁剪特性、Catalog 限定组件/字段/action、Policy 应用宿主工作流。React 只负责展示，不替 Host 认定业务事实。

```text
Browser / OrderOps Web (:3200)
  ├─ @nexus-ui/react → @nexus-ui/core
  └─ HTTP + SSE ↔ OrderOps Host (:3201)
                    ├─ @nexus-ui/server → @nexus-ui/core
                    ├─ cases / tools / actions → SQLite
                    └─ /rpc → OrderOps Agent (:3202) → read-only Host tool / model

OrderOps Agent / Host / Web → @orderops/contracts
OrderOps → Nexus public root entries only; Nexus → no OrderOps dependency
```

Nexus core 负责 JSONL、协议/Profile/Catalog 校验、surface 状态与 dataModel；React 负责受控渲染和输入事件；server 提供有限装配 API、生成/action guard、SSE 与进程内 surface 快照/ledger。`server/src/main.ts` 是参考程序，不是业务后端。业务事实、持久化、权限、领域事务和恢复由 OrderOps Host 负责。三包仍是私有包，`dist` 根入口可供 workspace 消费；公开发行须先通过 SDK 的独立安装、兼容和失败语义门禁。

OrderOps 位于 `examples/orderops/`，包含 `packages/contracts`、`host-server`、`agent-server`、`web`。这是阶段性 subtree 同居，拆分出口为 `git subtree split --prefix=examples/orderops`。同居期只通过 `workspace:*` 消费 Nexus 公开根入口；拆分时恢复版本化 tarball/包依赖。

### 2.2 OrderOps 包职责（验证拓扑）

| 包 | 当前模块 | 目标模块 / 阶段 |
| --- | --- | --- |
| `contracts` | `CaseSnapshot`、只读上下文、分析结果、建单输入 schema、**Catalog v1 定义**（Host 发布 / Agent 编译共用） | M4 增加退款契约，版本化字段变更 |
| `host-server` | SQLite migration、fixture、停滞检测、队列/详情、内部只读工具、Nexus 装配（外部 Agent 生成源 + `surface_bindings`；`createTicket` 领域事务已接） | 已交付至 T4.3；T4.4 失败样本矩阵 |
| `agent-server` | `/rpc`、Catalog Contract 缓存、只读快照客户端、分析引擎（deterministic/model）、A2UI 编译器 | 模型适配真实冒烟（凭证就绪后） |
| `web` | 队列、详情、业务 renderMap（证据锚点回查）、SSE 终态门控、三结局提交反馈（成功 / 可重试失败 / 结果未知锁定）与终态案件恢复 | 已交付 T4.3；真浏览器走查（录屏点） |

## 3. core 运行时：一条候选消息的一生

core 是框架无关的协议运行时，对外只有三个 seam：**IN**（`push(chunk)` / `dispatch(message)`，两个入口走同一管道）、**OUT**（`onRender(VNode)`）、**OUT**（`onAction(ActionEvent)`），外加 `onError` 诊断出口。宿主框架只在这四个点上与 core 接触。

### 3.1 流水线全景

```text
push(chunk) / dispatch(message)（两入口走同一管道）
   │
   ▼
JSONLBuffer（跨 chunk 切行 · 单行 1MB 上限 · 超长整行丢弃）
   │
   ▼
JSON.parse → Protocol 结构校验 → Profile 子集校验 → Catalog 预校验（可选 CatalogRegistry）
   │              任一层拒绝 ─▶ addError + onError：该消息不落 store，同 chunk 后续行照常处理
   ▼
生命周期门（createSurface 仅一次 · update*/delete 的 surface 必须已存在）
   │
   ▼
applyMessage 写 CoreStore（组件表 · dataModel · errors 环形缓冲，按 surfaceId 全维度隔离）
   │
   ▼
buildTree：扁平表 → VNode 树（栈式 DFS · {path} 绑定取真值 · 环检测 · memo 复用 · 双预算 10k/1k）
   │
   ▼
onRender(root, surfaceId)（框架无关出口；deleteSurface → 级联清理，onRender(null)）
```

任一层拒绝（结构、Profile、Catalog、生命周期）都只产生一条结构化错误进 `errors` 环形缓冲并回调 `onError`，**该消息不落 store，同一 chunk 内的后续消息照常处理**——这是对 Agent 逐行输出的容错基线。Catalog 预校验中计算下一模型快照可能抛出异常（如保留路径），runtime 统一收敛为结构化拒绝，绝不让异常穿出 `parse/dispatch`。

### 3.2 状态中心与 surface 生命周期

CoreStore 是 zustand vanilla store（每 runtime 一个），四个顶层槽全部按 `surfaceId` 隔离：

| 状态槽 | 内容 | 写入路径 |
| --- | --- | --- |
| `surfaces` | surface 元信息（catalogId、theme 等） | `createSurface` / `deleteSurface` |
| `componentsBySurface` | 每 surface 一张扁平组件表（`id → Component`，upsert 语义） | `updateComponents` / 受控写回不涉及 |
| `dataModelBySurface` | 每 surface 一个 JSON dataModel | `updateDataModel`、`setInputValue`（见 §3.4） |
| `errors` | 结构化错误环形缓冲（200 条，raw 截断 2000 字符） | 任一层拒绝 |

生命周期规则：`createSurface` 幂等性为"仅一次"（重复即 `LIFECYCLE_INVALID`）；`updateComponents` / `updateDataModel` / `deleteSurface` 要求 surface 已存在；组件树与数据更新的先后不做强制——`updateComponents` 先到时 `{path}` 引用解析为 undefined，数据到达后下次 rerender 填充。`deleteSurface` 级联清理该 surface 的全部状态。dataModel 写入是不可变 upsert（copy-on-write），读取按 JSON Pointer；保留段（`__proto__`/`constructor`/`prototype`）在读路径静默返回 undefined、写路径显式抛错，宿主对象（Date/Map/class 实例）不视作数据容器，防止写入导向继承链。

### 3.3 VNode 树构建（buildTree）

`buildTree` 把扁平邻接表渲染成 VNode 树，是"乱序到达、渐进填充"的实现点：

- 从 `id="root"` 起按 `children`/`child`/`tabs` 展开，**显式栈 DFS 不用递归**——深链不耗调用栈；
- 子 id 未到达（后续消息才会带来）→ 占位 VNode，数据/组件到齐后下次构建自然填充；
- 组件 props 里的 `{ path }` 经 `resolveDynamic` 解析为 dataModel 真值（展示绑定）；`action` 原样保留——context 在点击时才按当前模型解析（§3.4）；
- 组件级 `checks` 结果以 `validation` 挂在 VNode 上（渲染层据此禁用按钮、显示错误）；
- 环检测（子 id 命中当前路径祖先）→ 占位；共享子树（DAG 合法）经后序 memo 复用，防菱形链 2ⁿ 爆炸；
- 双预算：`maxNodes`（默认 10,000，含占位）与 `maxDepth`（默认 1,000），任一耗尽后其余引用以占位呈现并恰好上报一次 `FEATURE_UNSUPPORTED`。

### 3.4 交互出口：受控写回与 action

core 的两个交互 seam 都在 core 内完成解释，渲染层只上报意图：

- **受控输入写回** `setInputValue(componentId, surfaceId, value)`：仅接受五类输入组件（TextField / CheckBox / ChoicePicker / DateTimeInput / Slider），值类型按组件校验，绑定必须恰为 `{path}` 形态，保留段路径拒绝；通过后经 `setDataModelValueAtPath` 写本地模型并触发该 surface rerender。**绑定路径由 core 解释，宿主组件不直接碰 dataModel。**
- **action 出口** `triggerAction(sourceComponentId, surfaceId)`：组件存在且 `checks` 全过 → `buildActionEvent` 把 action 声明中的 `{path}` context 按当前模型解析为真值 → `onAction(ActionEvent)`。组件不存在或校验不过则静默（不产生事件）。事件去向由宿主决定：agent 线 POST 回 Host，前端线走路由表。

## 4. React 渲染管线：VNode → 宿主组件

```text
runtime.onRender(root, surfaceId)
   │
   ▼
选 renderer（catalogRenderMaps[catalogId] ?? renderMap prop）
   │
   ▼
ReactRenderer.renderTree（VNode → React 元素；maxElements=10k 预算，耗尽停止扩展）
   │
   ▼
renderMap[type] 查表 ── 未知类型 → 红框提示 · 占位 → 弱化省略号（降级不抛错，不白屏）
   │ 命中
   ▼
标准 17 组件 / 宿主自定义组件（props 已由 core 解析 {path}；validation 驱动禁用与错误提示）
   │
   ▼
setTree 整树替换（每条消息全量重渲；mount/update/unmount 全交 React，不自研 reconciler）
   │
   ├── 输入 onChange ─▶ ctx.setInputValue → core 校验并写 dataModel → rerender（受控闭环）
   └── 按钮 onClick ──▶ ctx.triggerAction → core 解析 context → onAction → 宿主 transport
```

要点：

- **不自研 reconciler**。VNode 树每条消息全量重建，React 负责 mount/update/unmount；core 侧 memo 复用 VNode 实例、React 侧 `maxElements` 预算（默认 10,000）共同把"引用展开共享子树"的成本封顶，预算耗尽渲染统一的占位提示。
- **renderMap 是宿主接自身设计系统的唯一扩展点**：`renderMap` prop 整体替换标准 17 组件；`catalogRenderMaps` 按 catalogId 选择（未匹配回退 `renderMap`）。OrderOps Web 用"业务组件 + 标准组件显式合并"的 renderMap（T3.7）。
- **降级不抛错**：未知组件类型、占位、预算耗尽都有兜底元素，宿主界面不会因一条坏组件白屏。
- **输入可访问性**由标准组件内建（label/`aria-invalid`/`aria-describedby`/禁用态）；TextField 的本地格式校验用 `compileSafeRegExp` 线性引擎，不受信 pattern 不经 `new RegExp`（杜绝灾难性回溯）。
- 每次击键都走"写 dataModel → 整树重渲"的受控闭环；这是当前有意为之的简单模型，渲染性能不在首发门禁内（PRD §4）。

## 5. 服务端准入与提交

server 侧的两条 run 管线共享同一套 guard 与序列化机制。guard 每条候选消息按 **Protocol → Profile → 序列/组件级 Catalog/Policy** 执行（SPEC §1 的四层在代码中是每消息一次的准入检查，而非流前/流后两次）：surfaceId/catalogId 全程一致，生成流首条必须 `createSurface`、此后只能 `updateComponents`/`updateDataModel`，action 流只允许后两者；组件须在 Catalog 白名单内并通过 props schema、component policy 与 media policy；action 只能挂 Button 且在 action 白名单内。

### 5.1 生成 run：逐条 guard → 可见预览 → 提交 → done

```text
prepareGenerate（本地 fixture / LLM / 外部 Agent RPC → AgentRun：source + sequence + commit）
   │
   ▼
sendAgentRun：登记 run(queued)，挂 per-surface promise 队列（同 surface 串行）
   │              浏览器断开 → req/res close → AbortController 取消
   ▼
sendMessages 循环：每条候选 Protocol → Profile → 序列 / Catalog / Policy
   │              通过即写 SSE message（可见预览，≠ 提交成功）
   ▼
流尽终态校验（≥1 条消息 · 生成流含 id=root · Policy validateFinal；
   │            动态绑定/媒体策略在每条消息到达时即对累积状态校验）
   ▼
run.commit（事务性提交）：整条流重放进权威 action 快照（version=1）
   │            → onGenerationCommitted 钩子（OrderOps：写 surface_bindings）
   │            → history；任一步失败 → removeSnapshot 回滚
   ▼
SSE done；任一步失败 → SSE error（AGENT_STREAM_ERROR + boundaryCode + diagnostics），不提交
```

`sendMessages` 逐条转发而非先缓存全流——**收到首条 `message` 只代表"可见预览"，`done` 才代表提交成功**；浏览器必须在 `done` 前禁用业务 action（SPEC §3）。run 状态机见 §6。

### 5.2 action run：锁 → 快照 → ledger → resolver → handler → patch

`POST /api/a2ui/event` 收到 client action 信封后：

1. `parseClientActionMessage` 信封校验（`version`/`name`/`surfaceId`/`sourceComponentId`/可解析 `timestamp`/对象 `context`；`actionId` 可选，OrderOps Web 总是携带）。
2. `prepareAction` 按固定顺序执行：**surface 锁** → 读已提交 action 快照（无则拒：surface 过期）→ `findSurfaceAction` 核对组件存在且 action 名与快照声明一致 → handler 注册表查找（`catalogId + action`）→ **ledger 去重**（同 key 已有非 failed 记录 → 拒"重放或重复提交"）→ **context 解析**：默认 resolver 以服务端快照 dataModel 为权威解析声明过的绑定、拒绝客户端未声明字段；自定义 `resolveActionContext` 完全接管（OrderOps 限定 `/draft/note` 提纯浏览器最新备注）→ 读 history → 调 Host handler 得 patch 消息源。
3. 返回 `AgentRun(kind='action')` 进**同一 per-surface 队列**：patch 逐条重过同一 guard（action 流不允许 `createSurface`/`deleteSurface`），全部通过后 `commitAction`（快照 version+1）→ SSE done。surface 锁在队列结算后才释放，同 surface 的 handler 因此串行——第二个请求读到第一个提交后的 dataModel。

### 5.3 提交语义与回滚边界

Nexus 的提交边界是"action 快照 + ledger + history"的进程内结算；**领域事务在 Host**。生成失败可整体回滚快照；action 的领域副作用一旦由 Host 提交，不因 SSE/patch 失败回滚（D5）。ledger 记录仅终态（succeeded/failed）可被容量淘汰，运行中记录被淘汰会静默放开重放保护——这是有意的不变量。权威数据所有权见 §10。

## 6. 状态机与并发模型

| 状态机 | 状态与迁移 | 载体与重启语义 |
| --- | --- | --- |
| 浏览器 surface | 不存在 → 已创建（组件表/dataModel 渐进填充）→ 已删除；无"半提交"态——被拒消息不落 store | core store，随页面生命周期 |
| 服务端 action 快照 | 生成提交建立（version=1）→ 每次 action patch 提交 version+1 | server 进程内存；重启即失，旧 surface 不可再提交，须按案件重建 |
| Agent run | `queued → running → succeeded \| failed \| canceled` | run-manager 进程内存，512 条上限 |
| action ledger 记录 | `running → succeeded \| failed`；仅终态可淘汰 | 进程内存，1,024 条上限 |
| OrderOps 领域案件/操作 | `open → in_review → ticket_created`（或 `dismissed`）；操作 `pending → succeeded \| failed \| needs_reconcile`（目标） | Host SQLite，跨重启权威（SPEC §5） |

并发模型：同 surface 的生成/patch run 经 promise 队列串行，action 处理经 surface 锁 + 快照核对串行，ledger 按 `actionId`（缺失时按时间戳 + context 组合键）去重——三层都只保障**单进程界面层**行为；跨重启的领域幂等由 Host 唯一约束（`tickets.case_id UNIQUE`）与 `caseId + operationType` 领域键负责。跨 surface 互不阻塞。

## 7. 资源与防御边界

不可信输入（Agent 候选、浏览器 action、HTTP 请求）在每个边界都有预算与降级路径；超限是**结构化拒绝或占位降级**，不挂死宿主：

| 边界 | 默认值与行为 | 代码位置 |
| --- | --- | --- |
| JSONL 单行 | 1MB；超长整行拒绝丢弃，永不换行的流转入溢出丢弃态；同一字节流任意 chunk 切分产出一致的行/错误序列 | core `buffer` |
| VNode 数量 / 链深 | 10,000 / 1,000；超限占位降级 + 一次 `FEATURE_UNSUPPORTED` 诊断 | core `render` |
| React 元素 | 10,000；预算耗尽停止扩展，统一占位提示 | react `renderer` |
| 错误记录 | 环形 200 条；raw 截断 2000 字符，防恶意超长行常驻内存 | core `state` |
| run / ledger / surface 快照 | 512 / 1,024（仅终态可淘汰）/ 256 | server `agent` |
| 正则 | `compileSafeRegExp` 线性时间引擎，不受信 pattern 不经 `new RegExp` | core `checks` |
| dataModel 路径 | 保留段拒绝（读 undefined / 写抛错）；宿主对象不作容器 | core `dataModel` |
| HTTP 请求 / 外部 Agent RPC | 1 MiB·10s / 15s·2MB、媒体类型白名单、AbortSignal 传播 | 数值以 [SPEC](SPEC.md) §3 表为准 |

## 8. 业务时序：生成路径（M2）

以 OrderOps 为例的端到端生成闭环（deterministic 管线已端到端接通；真实模型冒烟待凭证）：

1. Web 请求 `POST /api/cases/:id/analyze`；Host 查询并验证案件状态，固定 `caseId`、`surfaceId` 和 Catalog 身份。
2. Host 经 Nexus 公开的 `createExternalAgentGenerationSource` 调 Agent `/rpc`。Agent 依据 Catalog Contract 取能力边界，并从 Host `GET /internal/cases/:id/context` 取得只读快照。
3. Agent 用确定性 fixture 或真实模型得到结构化分析；代码校验证据 ID 属于快照，再编译 `createSurface`、`updateComponents`、`updateDataModel`。模型不直接决定可执行 action 或任意组件 JSON。
4. Host 逐条跑 §5.1 的 guard 管线，通过才发 SSE `message`。提交成功后记录 `surface_bindings(surface_id, case_id, case_version, catalog_hash)` 并发 `done`；错误回滚 Nexus action 快照并发 `error`。
5. Web 在 `done` 前禁用业务 action；证据可点击回查原始事件。

```text
运营人员打开案件，Web 请求 POST /api/cases/:id/analyze（前置案件门禁：未知 404 · 状态 409 · 未接线 503）
   │
   ▼
Host 经 createExternalAgentGenerationSource 调 Agent POST /rpc（caseId + Catalog Contract）
   │
   ▼
Agent GET /internal/cases/:id/context（Bearer fail-closed）◀─ 只读快照：订单 · 物流事件 · caseVersion
   │
   ▼
Agent：schema 校验 + 证据 ID ⊆ 快照 → 代码编译 A2UI（createSurface → updateComponents → updateDataModel）
   │  NDJSON 候选消息
   ▼
Host guard 逐条准入（协议 → Profile → 序列 → Catalog / Policy）──▶ SSE message（可见预览）
   │
   ▼
commit：action 快照 + surface_bindings(surface_id, case_id, case_version, catalog_hash) + history
   │
   ▼
SSE done（失败 → error，回滚 Nexus 快照）；Web 在 done 前禁用业务 action，证据锚点页内可回查
```

## 9. 业务时序：执行与恢复路径（M3）

Web 把最新备注作为声明过的可编辑 context 送到 `/api/a2ui/event`，走 §5.2 的 action run 管线。OrderOps Host 自定义 resolver 拒绝未声明字段，handler 通过 `surface_bindings` 重读案件事实及版本，在 SQLite 事务内写唯一工单、状态、操作结果和审计，然后产生同 surface patch。提交事务先于 patch 下发；patch/SSE 失败不回滚工单，Web 从案件或 `GET /api/actions/:actionId` 恢复。

```text
运营人员编辑备注并确认 createTicket（按钮在 done 前禁用）
   │
   ▼
POST /api/a2ui/event（actionId · timestamp · context.note）
   │
   ▼
Nexus adapter：surface 锁 → 已提交快照核对组件/action 归属 → ledger 去重（actionId 防传输重放）
   │
   ▼
resolver 提纯：只接受声明过的 /draft/note（换 path / 伪造字段在此被拒）
   │
   ▼
Host handler：经 surface_bindings 重读案件与版本 → SQLite 事务写唯一工单 · 案件推进 · 操作 · 审计
   │              重复检查先于版本检查（双击答"已建单"）；事务先提交
   ▼
patch 编译（禁用按钮 + /result 定点写工单号）→ 重过 guard → commitAction → SSE done
   │
   ▼
断线 / 刷新恢复：Web 查询案件或 GET /api/actions/:actionId（事务已提交不回滚、不盲目重发）
```

其中 T4.1/T4.2 已实现：同一请求的 actionId 由 ledger 处理传输重放；不同 actionId 的重复建单由 `tickets.case_id` 唯一约束与先于版本检查的重复检查阻止；建单 patch 在 `/result` 定点写工单号（官方可选 `path` 语义），`GET /api/actions/:actionId` 提供断线恢复查询，客户端中断流后事务不回滚有证伪测试。浏览器侧：OrderOps transport 把 SSE `message` 逐条 `runtime.push`，`done`/`error` 事件才算流收尾（网络中断不误报成功），`done` 前丢弃 action 事件。T4.3 前端恢复接线与 T4.4 的"事务成功但 patch 失败"反例（锁定 D5）待做——进度见 [CURRENT](tasks/CURRENT.md)。

Nexus 的内存 ledger 和锁只保障本进程的界面层行为；领域幂等、重启恢复和审计在 Host SQLite。Agent 不 import Host 数据库模块，通用 Nexus 包不引入订单、物流或退款模型。若 Host 事务已提交而 patch 校验或 SSE 失败，SDK run 可能标为 failed；这只表示界面回流失败。Web 必须查询 Host 的操作/案件结果，不能根据 SDK run 状态重试业务动作。

## 10. 数据所有权与失败边界

| 数据/状态 | 权威所在 | 重启/故障处理 |
| --- | --- | --- |
| 订单、物流事件、案件、工单、审计 | OrderOps Host SQLite；模拟数据也遵守领域约束 | migration + 唯一约束；业务结果查询 |
| Agent 分析候选与证据引用 | Agent 输出不可信；Host 快照为引用校验依据 | 无效证据拒绝，必要时 `insufficient_evidence` |
| surface 组件/dataModel 与 action 快照 | Nexus runtime/Host action state store | 默认内存；重启后旧 surface 不可直接提交，按案件重建 |
| surface ↔ case 关联 | M3 `surface_bindings`，Host 持有 | action 时核对案件版本，过期需重新分析 |
| request ledger/run 状态 | Nexus 默认进程内 | 不代替跨重启的领域幂等或操作查询 |

生成失败可以回滚 Nexus 快照；**已提交的领域副作用不能因 SSE 断开而回滚**。Host 的事务边界与 Nexus 的消息提交边界分开，业务终态由 Host 数据库决定。具体字段、端点、状态机见 [SPEC](SPEC.md)。

## 11. SDK 演进拓扑

当前三包 `core → react` 与 `core → server` 是可消费基础。近期先用已有根入口完成独立 React + Node 宿主和 OrderOps M3；记录各自的 SSE/交互接线量与 guard 调用位置。若两侧重复承担终态解析、信封构造或错误清理，再抽取浏览器 API；若非 Koa 宿主无法复用准入行为，再从现有 server 边界提取框架无关 guard。是否新增包、组合组件或高层 API 由这些证据决定，首版不预定 `@nexus-ui/client` 或 `NexusSurface`。无论包图如何变化，core 的协议/状态逻辑只保留一份；React/Vue 不重写 guard；浏览器接入层不持有业务事务；server 不 import OrderOps。

发行前用仓外干净宿主从实际产物安装，验证 types/exports/peer 兼容、Catalog 扩展、生成/action/patch、坏输出诊断及版本升级。OrderOps 同居的 workspace 链接仅是开发便利，不替代该验收。

## 12. 部署与验证边界

本地单机三服务、Node 24、pnpm workspace 和 SQLite 足够完成 OrderOps M3/M4。Agent 端口只对 Host 开放；浏览器只访问 Host。认证、租户隔离和领域数据持久化由实际宿主部署负责；SDK 仍须提供输入/资源边界、可诊断失败、取消与兼容契约，不能因为验证 Agent 简单而降低这些要求。详细 HTTP/RPC、Catalog 和状态机见 [SPEC](SPEC.md)；SDK 与验证任务见 [CURRENT](tasks/CURRENT.md)。
