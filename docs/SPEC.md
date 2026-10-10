# SPEC — Nexus / OrderOps 契约

状态：✅ 当前代码/既有测试可支撑；🚧 目标或待补验收。更新：2026-10-10。上游 [PRD](PRD.md)；拓扑 [ARCHITECTURE](ARCHITECTURE.md)；理由 [DESIGN](DESIGN.md)。协议/类型真值源是 `specification/v0_9`、`packages/nexus-core/src/protocol`、CatalogDefinition 和 `examples/orderops/packages/contracts`；本文是人可读的接入契约，冲突时先核实代码再同步本文。

## 0. 术语与两侧责任

| 术语 | 含义与权威 |
| --- | --- |
| surface | 一个任务界面的组件树、dataModel 和 action 上下文；`surfaceId` 标识 |
| Profile | Nexus 在 A2UI v0.9 上开放的有限能力，不等于官方 Basic Catalog |
| CatalogDefinition | 宿主声明组件、字段、绑定及 action 的可用集合 |
| Catalog Contract | 从 CatalogDefinition 生成的可发现版本/hash 与 prompt contract；hash 用于身份校验 |
| Host | 持有业务事实、授权、可编辑字段规则、领域事务与结果查询 |
| Agent | 提供候选分析/A2UI；不是事实和执行的权威 |

## 1. A2UI 流与校验（当前 Nexus 能力）

Server→client 是逐行 JSON 的 A2UI v0.9 消息（NDJSON）；每个信封恰好一个 payload。生成流先 `createSurface`（`surfaceId`、`catalogId`），再分别 `updateComponents` 建组件树及 `updateDataModel` 写初值；patch 复用相同 `surfaceId`。**v0.9 的 `createSurface` 不内嵌组件或 dataModel**。core 跨 TCP chunk 缓冲 JSONL。`deleteSurface` core 能处理，但 guarded Agent 流拒绝。

```jsonl
{"version":"v0.9","createSurface":{"surfaceId":"s-1","catalogId":"https://example.com/catalogs/orderops/v1"}}
{"version":"v0.9","updateComponents":{"surfaceId":"s-1","components":[{"id":"root","component":"Column","children":["title"]},{"id":"title","component":"Text","text":{"path":"/title"}}]}}
{"version":"v0.9","updateDataModel":{"surfaceId":"s-1","value":{"title":"物流异常"}}}
```

组件采用扁平 ID 表，容器以 `children`/`child` 引用；`{ path }` 使用 JSON Pointer。生成流须包含 `root` 组件；action 响应只更新原 surface 的组件或 dataModel。上例是消息形状示意，不代表这些字面值已经走过 OrderOps 业务校验。

校验链为 Protocol（结构）→ Nexus Profile（支持子集）→ Catalog（组件 schema、字段、绑定、action）→ Host Policy（工作流）。稳定诊断码：`PROTOCOL_INVALID`、`LIFECYCLE_INVALID`、`FEATURE_UNSUPPORTED`、`CATALOG_UNSUPPORTED`、`POLICY_REJECTED`；错误应带可定位的结构化 diagnostics。Client→server 的 `action`/`error` 不属于 core 的 server→client 流入校验；action 回流由 Host HTTP 边界处理。

官方 `specification/v0_9` 的 9 份 conformance 用例已建机器基线 `packages/nexus-core/tests/conformance-baseline.json`：33 pass、47 已决策偏差、0 fail。四类偏差：`profile-unsupported` 16（官方合法而 Profile 不支持）；`profile-catches-protocol-loose` 23（结构层偏松、Profile 拦截）；`degraded-value-constraint` 5（无效值降级渲染）；`scope-client-to-server` 3（方向不适用）。协议层必须保持“官方合法消息不被协议层误拒”的零 fail 不变量；Profile 拒绝不计为协议错误。上游 v1.0 或其他生成格式须单独评估，不能静默混入该基线。

## 2. Profile 与 Catalog（当前 Nexus 能力）

Nexus Basic Task Profile 支持 17 个标准组件：`Text`、`Image`、`Icon`、`Row`、`Column`、`List`、`Card`、`Tabs`、`Divider`、`Button`、`TextField`、`CheckBox`、`ChoicePicker`、`DateTimeInput`、`Slider`、`Video`、`AudioPlayer`。`List` 仅静态 children；`Button` 只支持 `action.event`；绑定使用 `{ path }`。`TextField`/`Slider`/`Button` 的最小 checks 支持 `required`、`regex`、`length`、`numeric`、`email`。不支持 checks 的 `and/or/not`、跨字段校验、`action.functionCall`、ChildList 模板、`sendDataModel` 端到端、Modal、WebSocket/A2A/MCP transport；Theme 被 core 保存但标准 React 组件尚不消费；playground 仅显示一个 active surface。

宿主 `CatalogDefinition` 声明组件名单和 action 白名单；需要字段验证的组件同时声明 `componentSchemas`（props 结构）和 `componentPolicies`（字段/绑定/action 权限）。当前 OrderOps `Column` 是无 props 的根容器，未声明 schema/policy；不能笼统声称六个组件都双声明。`createCatalogPromptContract` 从同一声明生成提示，但 prompt 只是建议，guard 才是最终裁决。Catalog Contract 带 `contractVersion` 与内容 `contractHash`；公开 discovery `GET /api/a2ui/published-catalogs` 可找到契约 URL，Agent 可按 hash 缓存。

OrderOps Catalog v1 当前只允许 `Column`、`Text`、`TextField`、`Button`、`OrderSummary`、`LogisticsTimeline` 六种组件和 `createTicket` 一个 action。`OrderSummary`/`LogisticsTimeline` 是展示组件，不挂 action；`Button.disabled` 只接受字面布尔。**当前 Catalog 只能要求 `TextField.value` 是 `{path}`，不能限制其路径必须为 `/draft/note`**；该路径的白名单由 M3 Host 自定义 resolver/handler 执行，现阶段尚未闭合。第二流程的组件/action 在 M4 再声明。

| Catalog 字段 | 当前可核对的约束 |
| --- | --- |
| `components` / `actions` | 组件/action 白名单；未声明的候选消息拒绝 |
| `componentSchemas` | props 结构、必填、枚举、类型、额外字段规则 |
| `componentPolicies.fields` | 动态绑定允许/必须/禁止、子组件引用、Host 扩展来源 |
| `componentPolicies.action` | 该组件是否允许挂载 action |
| `contractHash` | 对规范化 CatalogDefinition 计算 SHA-256，Agent 缓存命中须同 hash |

## 3. Nexus transport 与 action（当前能力）

Host 逐条校验候选消息，通过才发 SSE `message`；整条流完成并提交 Nexus 快照后发 `done`。此前的 `message` 是可见预览，后续校验或提交失败仍会发 `error`，本次失败流不会提交 history 或新的可执行 action 快照；浏览器必须在 `done` 前禁用业务 action，并在 `error` 后清理预览。现有 `sendMessages` 不是先缓存全流再一次性发给浏览器，不能把收到首条 `message` 当作提交成功。

回流端点 `POST /api/a2ui/event` 接 A2UI `action` 信封。必填 `version: 'v0.9'`、`name`、`surfaceId`、`sourceComponentId`、可解析的 `timestamp` 和对象 `context`；`actionId` 在服务端解析器中可选，OrderOps Web 当前会生成并携带。服务端顺序为 surface 锁 → 已提交 action 快照及组件/action 归属校验 → ledger 去重 → 解析声明过的 context → Host handler → patch 重新过 guard → SSE。同一 surface 的 handler 串行，第二个读第一个提交后的 dataModel。ledger 有 `actionId` 时按它与 surface/组件/action 标识去重；缺失时按时间戳和 context 等字段组成键。Nexus 快照与内存 ledger 不等于持久化业务事务；默认 resolver 使用服务端提交时的 dataModel，不能拿到浏览器后续编辑值；自定义 `resolveActionContext` 必须自己拒绝未声明字段并验证类型。

外部 Agent 生成源是 Host→Agent HTTP RPC。请求字段为 `{ version: 1, kind: 'generate', surfaceId, message, catalogId, supportedComponents, supportedActions, catalogContract, history }`；`catalogContract` 至少含 `version: 1` 与 `hash`，可含 URL。成功返回 `application/x-ndjson`，每行一个候选 A2UI 消息；错误为非 2xx + `{error:{message}}`。OrderOps 把 `message` 规范化为 caseId。当前 T3.3 handler 正在工作区开发，会先缓冲输出再一次性返回，尚不能声称逐条实时生成。Host 侧连接真实模型时把默认 15s 超时提高至其设定的 120s，并继续逐条 guard。

| HTTP / RPC 边界 | 当前默认上限与结果 |
| --- | --- |
| Nexus JSON 请求读取 | `application/json` 或 `+json`，默认 1 MiB、10 s；非法媒体类型/超限/超时拒绝 |
| 外部 Agent 客户端 | 默认 15 s、2,000,000 bytes，仅接受 `application/x-ndjson`/`application/jsonl`，零消息拒绝；取消经 AbortSignal 传播 |
| `sendMessages` | 候选消息先 guard 后 SSE；参考默认逐条延迟 200 ms，OrderOps 明确配置 `streamDelayMs: 0` |
| OrderOps Agent `/rpc`（T3.3 工作区） | 当前请求读取上限 1 MB；生成器先缓冲再写 NDJSON，失败时返回 JSON 错误体 |

参考 Host 路由还提供 `POST /api/a2ui/generate`（请求仅允许 `message?`/`catalogId?`）、`GET /api/a2ui/catalog-contract?catalogId=`、`GET /api/a2ui/published-catalogs`、`GET /api/a2ui/agent-onboarding?catalogId=` 和 `GET /api/a2ui/runs?surfaceId=`。业务宿主须校验自己的案件约束：当前 OrderOps 专用 analyze 路由尚未验证 caseId/状态，且通用 generate 路由仍挂载；在 M2 接线前应修正，见 [CURRENT](tasks/CURRENT.md)。

## 4. 公开包与兼容性（当前能力）

可依赖的只有 `@nexus-ui/core`、`@nexus-ui/react`、`@nexus-ui/server` 根入口；`packages/*/src/**`、`server/*/src/**` 与 `*/dist/*` 深路径不承诺兼容。core 根入口覆盖 runtime、协议/Profile 校验、Catalog/schema/policy、状态/VNode 和交互辅助；React 覆盖 Provider、renderer、标准 renderMap 和兼容检查；server 仅承诺 AgentAdapter、guarded router、生成/action/Policy 注入、Catalog Contract/discovery、外部 RPC、verifier、history/run、`sendAgentRun` 等有限装配 API。参考程序的内置 Catalog、LLM、mock handler、全局 store 和 listener 不属于包契约。

线协议版本为 `v0.9`；三包实现版本为 `0.1.x`；core/react/server 根 API 版本各为 `1`。React `0.1.x` 支持 core `0.1.x` 且要求 core API 1、协议 v0.9。移除/改变根导出需提升 API 版本；新增导出须有意更新公开面快照。三包当前私有，同居期 OrderOps 经 `workspace:*` 消费。浏览器终态/错误处理与服务端准入的可复用行为是 [PRD](PRD.md) 的产品目标；transport client、`NexusSurface` 或独立 guard 包是待验证的实现选项，不属于本版公开契约。Vue renderer 是可选扩展。

生产级设计门禁还要求当前产物在仓外干净宿主安装，只通过根入口完成生成、受控渲染、输入、action 和 patch；验证类型/exports/依赖、版本兼容、取消与错误状态、资源上限和坏输出诊断。历史 tarball 冒烟及当前 workspace 直链只能证明对应时点的接入，不能替代当前版本的独立安装结果。SDK 门禁与 OrderOps Agent 的生产能力分开，具体任务见 [CURRENT](tasks/CURRENT.md)。

## 5. OrderOps 领域契约（部分已实现，M2/M3 待闭合）

`packages/contracts` 的跨包 zod 契约包括 `CaseSnapshot`、`ReadContextResponse`、`AgentAnalysis` 判别联合和 `CreateTicketInput`。分析成功分支有 `verdict: 'analysis'`、`summary`（≤500）、`reason`（≤1000）、`evidenceEventIds`（≤20）、`recommendation`（≤500）、`uncertainties`（≤10）；证据不足分支为 `verdict: 'insufficient_evidence'`、`reason`、`missingInformation`。Agent 不 import Host 数据库模块。`evidenceEventIds` 必须属于只读快照；不满足时输出明确的证据不足结果而非可执行 surface（M2 待实现）。

| 持久化表（M1 已建） | 关键字段/约束 | 权威用途 |
| --- | --- | --- |
| `orders` | ID、客户、币种、整数最小货币单位金额、承诺时间、状态、版本 | 订单事实 |
| `logistics_events` | ID、订单 ID、状态、发生时间、来源 | 可回查的原始证据 |
| `anomaly_cases` | 订单、type、occurrence_key、severity、status、version、last_event_id；`UNIQUE(order_id, occurrence_key)` | 案件与重复扫描幂等 |
| `tickets` | `case_id UNIQUE`、order_id、note、status | M3 模拟工单领域幂等 |
| `action_attempts` / `audit_events` | 请求键唯一索引、操作状态/结果；事件种类、actor、payload | M3 查询与审计 |
| `surface_bindings` | surface_id 主键、case_id、case_version、catalog_hash | M3 以服务端关联决定 action 业务对象 |

| 端点 | 现状 / 目标 |
| --- | --- |
| `GET /api/cases?status=&severity=&q=`、`GET /api/cases/:id` | M1 已实现；过滤/搜索、事实与事件时间线可回查，非法枚举 400 |
| `GET /internal/cases/:id/context` | M2 T3.1 已实现；Bearer 内部 token fail-closed，出口校验 schema，最近 200 事件升序 |
| `POST /api/cases/:id/analyze` | 目前是玩具生成源且未核对 caseId/状态；M2 目标接校验后的 Agent RPC 与真实分析 |
| `POST /api/a2ui/event` | 目前是回显 patch；M3 目标接本地业务事务 |
| `GET /api/actions/:actionId` | M3 待实现；操作终态与断线恢复 |
| Agent `POST /rpc`、`GET /health` | T3.3 开发中；仅 Host 可达，无浏览器面 |

M3 案件状态目标为 `open → in_review → ticket_created`，另可 `dismissed`；状态变更加 `case_version`，过期 surface 拒绝。操作状态目标为 `pending → succeeded | failed | needs_reconcile`。领域幂等键为 `caseId + operationType`，`tickets.case_id` 唯一约束兜底；请求 `actionId` 用于识别同请求重放，缺失时 SDK 退回时间戳与 context 等字段组合，均不代替领域幂等。备注不参与领域幂等键。Host 先提交工单/案件/操作/审计事务，再编译 patch；SSE 或 patch 失败不回滚已提交事务，真实结果由案件及操作查询确认。

M4 的退款类型、金额字段、限额和状态迁移目前没有 schema/handler；实施前在 contracts/Catalog/Host 三处同时定义，并补跨包正常/越权/重复/断线测试。不能把 PRD 的模拟退款流程视作当前 wire 契约。

## 6. 契约治理

协议/Profile/Catalog/Policy 行为变更用同一 fixture 做 Nexus conformance 与 OrderOps guard 双端验证，根 `pnpm test` 覆盖。改变官方基线时显式再生 `packages/nexus-core/tests/conformance-baseline.json`，在 §1 记录新分类、数量和接受理由；不静默漂移。contracts schema 改动须 Agent/Host/Web typecheck、合法与非法边界测试同过。已实现的对外契约应由测试锁定，目标契约在交付时补测试。执行任务与门禁见 [CURRENT](tasks/CURRENT.md)。
