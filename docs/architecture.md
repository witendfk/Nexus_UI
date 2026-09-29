# OrderOps Copilot：框架设计与实施方案

状态：目标设计，尚未实现。日期：2026-09-28。配套视图：[框架设计图](design.md)；实施顺序与任务清单：[implementation-plan.md](implementation-plan.md)。

## 1. 产品定位

OrderOps 是电商内部的**订单异常案件处理助手**。系统从订单和物流事实中发现异常、形成案件；Agent 解释证据并提出建议；运营人员审核和确认；Host 执行操作并记录可查询的结果。Nexus UI 是案件审核界面的受控运行时，不是订单数据库、决策引擎或业务事务管理器。

第一阶段证明一条完整流程：物流长时间无更新 -> 案件进入队列 -> Agent 解释 -> 人工确认建单 -> 同一 surface 展示工单结果。第二阶段用高金额退款请求检验复用性；退款先模拟，不连接支付系统。

验收分为两条：业务上，异常识别、证据引用和操作结果正确；集成上，独立宿主通过 Nexus 公开入口完成 Catalog、A2UI 流、输入绑定、action、guard 和同 surface patch。当前目标是单机、单用户、可复现演示。多租户、真实商户连接和生产权限平台不作为 MVP 前置条件。

## 2. 用户功能与范围

| 功能         | 用户体验                                 | 系统责任                                  | 阶段  |
| ------------ | ---------------------------------------- | ----------------------------------------- | ----- |
| 异常队列     | 按状态和严重度筛选，搜索订单号，打开案件 | Host 查询案件及最新事件                   | M1    |
| 案件详情     | 查看订单摘要、物流时间线、触发原因       | 展示可追溯事件 ID、时间与来源             | M1    |
| Agent 分析   | 查看原因、建议、引用证据和不确定性       | 只读工具取事实；校验模型引用              | M2    |
| 审核 surface | 修改备注，确认建单                       | Nexus 渲染受控组件、输入绑定、action 回流 | M2-M3 |
| 结果和审计   | 查看工单号、状态、谁在何时确认           | Host 事务、审计及同 surface patch         | M3    |
| 失败恢复     | 重试分析，查询中断操作结果               | 生成失败不可执行；已提交操作可重新查询    | M3    |
| 高金额退款   | 查看风险、编辑金额、模拟审批             | 第二种案件和独立 action 前置条件          | M4    |
| 日常简报     | 扫描今日待处理案件与关键指标             | 代码计算聚合值，模型只解释                | M5    |

案件队列、筛选、导航和历史记录是稳定的宿主 UI。Nexus surface 用于随异常类型变化的分析与审核区。第一切片至少包括一条停滞物流案例、一条正常对照案例和真实模型调用；确定性 fixture 用于回归测试和模型不可用时的演示降级。月度复盘与更多异常类型在两条流程稳定后实施。

## 3. 运行拓扑与职责

```text
React/Vite Web (:3200)
  ├── 宿主 UI：案件队列、导航、操作状态、审计
  └── Nexus React：当前案件的单个审核 surface
            │ REST / POST+SSE
            ▼
OrderOps Host (:3201, Koa)
  ├── 案件检测、查询及 Agent 只读工具 API
  ├── SQLite：订单、物流、案件、工单、操作与审计
  ├── Nexus Catalog / AgentAdapter / guard / SSE 装配
  ├── 输入与案件版本校验、领域事务
  └── 从已提交结果生成确定性 A2UI patch
            │ 外部 Agent JSONL RPC
            ▼
OrderOps Agent (:3202, TypeScript)
  ├── Catalog Contract 缓存与 hash 检查
  ├── 只读工具：getCaseContext(caseId)
  ├── 模型：结构化解释、证据、建议和不确定性
  └── 受约束的 A2UI 编译器，输出 NDJSON
```

两个服务进程用于验证外部 Agent 接入，但不引入微服务平台、消息队列或服务发现。Agent 不直接访问数据库，也不能执行建单、退款等写操作。

### 3.1 Host

- 载入 fixture、运行确定性异常检测、维护案件状态和版本。
- 发布唯一的 OrderOps CatalogDefinition；Web render map 和 Agent prompt contract 共享能力边界。
- 通过 Nexus 公开的 `AgentAdapter`、外部生成源和服务端 guard 处理候选 A2UI 并提供 SSE。
- 校验 action 来源组件、声明过的可编辑字段、案件状态和当前订单事实。
- 在 SQLite 事务中实现业务幂等、状态变化和审计；从事务结果生成 patch。
- 提供案件及操作结果查询，使页面刷新或 SSE 中断后仍能恢复真实状态。

### 3.2 Agent

- 接受 Host 选定的 `caseId`，通过 Host 只读工具取得案件快照；不从自由文本猜订单 ID。
- 模型仅输出受 schema 限制的 `summary`、`reason`、`evidenceEventIds`、`recommendation`、`uncertainties`。证据 ID 必须属于工具快照；证据不足时返回 `insufficient_evidence`。
- 代码将工具快照中的事实和校验后的分析编译为 A2UI。模型可在允许模块中选择展示内容和顺序，不能发明组件、action、金额、订单事实或新工具。
- 按 Nexus Catalog Contract 输出 `createSurface`、`updateComponents`、`updateDataModel` NDJSON；hash 变化后刷新契约。

首条流程的业务 action 由 Host 本地 handler 处理。Agent RPC 只作为生成源；未来支持 `kind: action` 时也只能生成展示内容，不能承担业务副作用。Nexus 外部 Agent 全流程 onboarding verifier 假定外部 action RPC；第一阶段应以宿主集成测试覆盖本地 action，不将其六项验收结果误报为已通过。

### 3.3 Nexus UI 能力边界

当前实现适合单个活动 surface、A2UI v0.9 的受限组件树、`{ path }` 绑定、Button action 和同 surface patch。多 surface 工作台、完整官方 Basic Catalog、通用工作流引擎不是现成能力。Host 只从公开入口接入，并通过独立安装产物验收；Nexus 源仓的包目前仍是私有参考实现，文档中的 `0.1.0` 不能视为已发布 npm 包。

Nexus guard 校验协议、Catalog 和生命周期，不证明模型叙述的订单事实为真，也不替代业务授权、输入校验和事务。其进程内锁及 ledger 可辅助单机演示，但数据库唯一约束与结果查询才是业务幂等和恢复依据。

## 4. 数据模型与状态机

| 表                 | 关键字段                                                                                                    | 用途                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `orders`           | `id`, `customer_id`, `currency`, `amount_minor`, `promised_at`, `status`, `version`                         | 订单事实；金额用整数最小货币单位 |
| `logistics_events` | `id`, `order_id`, `status`, `occurred_at`, `source`                                                         | 可追溯的物流事件                 |
| `anomaly_cases`    | `id`, `order_id`, `type`, `occurrence_key`, `severity`, `status`, `version`, `detected_at`, `last_event_id` | 一次异常发生对应一个案件         |
| `tickets`          | `id`, `case_id`, `order_id`, `note`, `status`, `created_at`                                                 | 模拟工单；`case_id` 唯一         |
| `action_attempts`  | `id`, `case_id`, `operation`, `request_key`, `status`, `result_id`, `error`, `created_at`                   | 请求重放与结果查询               |
| `audit_events`     | `id`, `case_id`, `kind`, `actor`, `payload`, `created_at`                                                   | 检测、分析、确认和执行记录       |
| `surface_bindings` | `surface_id`, `case_id`, `case_version`, `catalog_hash`, `created_at`                                       | 已生成 surface 与业务案件的关联  |

`orders` 和物流事件是 Host 权威事实；A2UI dataModel 仅是界面状态。Host 在 `surface_bindings` 中保存关联，不依赖浏览器回传的订单 ID 确定业务对象。Nexus 默认 action 快照仍是进程内状态；服务重启后旧 surface 不再允许提交，Web 根据案件结果重建新的 surface。要支持跨重启继续操作，再实现 Nexus 公开的持久化 action state store 接口。

首条检测规则仅针对运输中的订单：根据最新有效物流事件与当前时间的差值判断是否超过可配置阈值，再结合订单承诺送达时间确定严重度。时区、乱序事件和缺失事件由代码处理，不能交给模型补造。`occurrence_key` 标识一次停滞区间，避免重复扫描建案；之后的新停滞可以产生新案件。正常对照样本不能被误判。

案件状态：`open -> in_review -> ticket_created`，另有 `dismissed`。关键状态变化增加版本号；过期 surface 的提交必须被拒绝并提示重新加载。操作状态：`pending -> succeeded | failed | needs_reconcile`。领域幂等键为 `caseId + operationType`，请求 ID 另用于识别同一客户端请求重放；备注不参与幂等键。同一案件的两个不同请求 ID 仍不能创建两张工单。

## 5. 接口和执行流程

| Host API                              | 作用                                   |
| ------------------------------------- | -------------------------------------- |
| `GET /api/cases?status=&severity=&q=` | 队列筛选和搜索                         |
| `GET /api/cases/:caseId`              | 事实、分析、工单和操作状态，用于恢复   |
| `POST /api/cases/:caseId/analyze`     | 校验案件后启动生成，返回 SSE           |
| `POST /api/a2ui/event`                | Nexus action 回流与本地业务 handler    |
| `GET /api/actions/:actionId`          | 超时或断开后的确定结果查询             |
| `GET /api/a2ui/published-catalogs`    | Agent 发现 Catalog Contract            |
| `GET /internal/cases/:caseId/context` | Agent 的只读工具入口，仅内部进程可访问 |

2026-09-28 已对照 `@nexus-ui/server` 源码核实（详见第 10 节）：`createAgentRouter` 的 `POST /api/a2ui/generate` 只接受 `{ message?, catalogId? }` 并拒绝未知字段，无法携带案件约束。因此案件生成走 Host 自己的 `POST /api/cases/:caseId/analyze`，直接调用公开的 `adapter.prepareGeneration()` 与 `sendAgentRun()`，guard 与逐 surface 串行队列不变；同时整包挂载 `createAgentRouter` 以复用 `/api/a2ui/event`、`published-catalogs`、`catalog-contract`、`runs` 与 `health`。为防浏览器用通用 generate 路由绕过案件选择，注入 adapter 的 `createGenerationSource` 必须同步校验 `message` 是存在且状态允许分析的 `caseId`（`better-sqlite3` 为同步查询，校验失败抛错即返回 400）。发给标准外部 Agent RPC 的 `message` 是 Host 规范化后的 `caseId`；领域数据通过只读工具取得。

### 5.1 生成

1. 检测器建立案件；用户从队列打开详情，Host 读取订单和物流事实。
2. Host 选择 Catalog 和 `surfaceId`，保存案件关联与版本，向 Agent 发起生成 RPC。
3. Agent 获取只读快照，调用模型产生结构化分析，校验证据 ID，再由代码生成候选 NDJSON。
4. Nexus 服务端 guard 在每条消息写入 SSE 前完成协议、profile、序列与 Catalog schema 四层校验（已核实 `sendMessages` 实现）；`run.commit`（含 Host 的 `onGenerationCommitted` 持久化钩子）成功后才发送 `done`，失败先回滚快照再发送 `error` 事件。装配时必须显式传 `streamDelayMs: 0` 关闭演示用的逐消息 200ms 延迟；外部 Agent RPC 的 `timeoutMs` 默认 15 秒，接真实模型前必须上调。
5. Web 在 `done` 前禁用业务 action。失败时显示错误和重试，不将流式预览当成可执行的已提交界面。

### 5.2 人工建单

1. 浏览器提交 Nexus action：`surfaceId`、来源组件、action ID、最新备注。其他 context 字段一律不作为订单事实。
2. Host 检查已提交 surface 的 Button 声明和可编辑绑定，通过 `surfaceId` 找案件。Nexus 的 `AgentActionContextResolver` 扩展点已核实存在：客户端在点击时把 `{ path }` 绑定按当前 dataModel 解析成真值放入 `action.context`，编辑后的最新备注就在其中；Host 的 resolver 只接受其中已声明的备注字段并按类型和长度校验，其余客户端字段一律拒绝。注意两点：默认 resolver 读的是提交时的 dataModel 快照（拿不到编辑值）；"拒绝未声明字段"的检查只在默认路径生效，自定义 resolver 必须自己补上。Web transport 还要为 action 补充 `timestamp` 与 `actionId`（core 不生成，服务端信封校验要求 timestamp）。
3. Host 的本地 `createTicket` handler（`adapter.registerActionHandler` 注册）在返回消息源之前完成全部业务：经 `surface_bindings` 找回案件并核对 `case_version`（过期 surface 在这里拒绝，Nexus 快照不感知案件版本）、重读订单事实、检查操作前置条件，然后在事务内写入唯一工单、案件状态、操作结果和审计；最后把事务回执编译成只含 `updateComponents`/`updateDataModel` 的 patch 消息源。事务先于流式输出完成，SSE 中断不会回滚工单。
4. Host 从事务回执生成同 surface 的确定性 patch，禁用建单按钮并显示工单号。
5. SSE 或 patch 失败不回滚已提交工单。Web 查询案件或 action 状态并重新渲染；不盲目重试建单。重复提交返回已有结果。

## 6. OrderOps Catalog v1

首条流程允许 `Column`、`Text`、`OrderSummary`、`LogisticsTimeline`、`TextField`、`Button`，唯一 action 为 `createTicket`。`Column` 是根布局；两个业务组件只展示事实，不挂 action；`TextField` 仅绑定 `/draft/note`；Button 的 action context 只声明案件关联和备注。真正的案件 ID 由 Host 通过 `surfaceId` 查得。

自定义组件需要同时声明 `componentSchemas` 与 `componentPolicies.fields`：订单号、商品、币种、整数金额、客户摘要；物流事件 ID、状态、时间和来源。Button 需声明实际使用的 `child`、`disabled` 字段。schema 与 policy 都通过后再写入 prompt contract，不能让模型输出未声明字段或未经验证的外部 URL。第二条退款流程再按需要增加 `RiskNotice`、`ChoicePicker`、金额输入和 `approveSimulatedRefund`。

## 7. 技术栈

| 层         | 选择                                                | 理由                                                                                                          |
| ---------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 运行时     | Node.js 24 LTS、TypeScript、pnpm 9                  | 与 Nexus 的 Node/TS 接入面一致；24 为当前 active LTS，不基于已结束维护的 Node 18                              |
| Host HTTP  | Koa 2、`@koa/router`                                | 已核实 `@nexus-ui/server` 依赖即 koa 2.15 / `@koa/router` 12，Host 必须同主版本才能直接挂载其 router 与中间件 |
| Agent HTTP | Node/TypeScript 轻量 HTTP 服务                      | 只暴露 JSONL RPC 和 health，无浏览器 CORS 需求                                                                |
| 数据层     | SQLite、`better-sqlite3`、版本化 SQL migration      | 单机 fixture 与事务足够，唯一约束可直接审查                                                                   |
| 模型       | OpenAI SDK 兼容接口、结构化结果校验                 | 隔离供应商，限制输出字段、时长与大小                                                                          |
| Web        | React 18、Vite、`@nexus-ui/core`、`@nexus-ui/react` | 宿主 UI 与受控 surface 分层                                                                                   |
| 测试       | 服务端 Node test/tsx、前端 Vitest/Testing Library   | CI 用确定性数据；真实模型单独冒烟                                                                             |

首条切片不引入 LangChain/LangGraph、向量库、Redis、消息队列、ORM 或 Postgres。这些工具不能解决眼下的证据正确性、最新输入和事务恢复。扩展到多用户或多实例时，再迁移数据库与进程内状态并增加认证、租户隔离和后台任务队列。

## 8. 实施阶段和验收

### 8.1 模块拆分

| 包             | 建议模块                                                                                                                                             | 实施顺序                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `host-server`  | `db/migrations`、`fixtures`、`cases/detect`、`cases/repository`、`tools/read-api`、`nexus/catalog`、`nexus/adapter`、`actions/create-ticket`、`http` | 先事实与检测，再 Nexus 装配，最后本地 action |
| `agent-server` | `rpc`、`catalog-contract`、`tools`、`analysis/schema`、`analysis/model`、`a2ui/compile`                                                              | 先确定性结构化分析和编译器，再接真实模型     |
| `web`          | `cases/queue`、`cases/detail`、`nexus/transport`、`nexus/render-map`、`actions/status`                                                               | 先宿主导航，再审核 surface 和结果恢复        |

跨包共享的只是案件 ID、只读工具响应和 Agent 分析结果等版本化契约；不要让 Agent import Host 的数据库模块，也不要把 OrderOps 领域类型放进 Nexus 通用包。

### 8.2 阶段门禁

| 阶段          | 交付                                                                 | 完成标准                                                            |
| ------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| M0 接入基线   | 修正包依赖和入口；Nexus core/react/server 本地 tarball；最小独立宿主 | `install/dev/build/typecheck` 可运行；只用公开入口生成并渲染        |
| M1 案件事实   | SQL migration、fixture、检测规则、队列及详情 API                     | 停滞案例唯一建案；正常案例不建案；事实和事件 ID 可回查              |
| M2 Agent 分析 | 只读工具、Catalog v1、真实模型结构化输出、A2UI 编译器                | 真实模型生成可渲染 surface；证据引用正确；非法输出被 guard 拒绝     |
| M3 人工闭环   | 备注、Host 本地建单、幂等事务、审计和 patch                          | 最新备注生效；伪造、过期和重复提交被处理；刷新及断线后结果一致      |
| M4 第二种异常 | 高金额退款案件及模拟 action                                          | 新输入和审批流程复用同一 Catalog/guard/Host 边界，无 Nexus 业务特例 |
| M5 扩展评估   | 更多标注样本、日常简报、质量报告                                     | 分别报告检测、证据、建议、风险拦截和协议通过率                      |

M0 是技术门槛；M1-M3 合起来才算第一条业务切片完成。M2 不能只以确定性 fixture 代替真实模型。每阶段保留失败样本：编造事件 ID、非法 Catalog 字段、伪造订单 ID、旧 surface、双击建单、SSE 中断和事务成功但 patch 失败。模拟数据只能证明流程和规则，真实业务收益需有人工基线后才能报告。

## 9. 当前仓库差距

2026-09-28 更新：阶段 0（工程基线）与 M0 接入穿刺已完成，`install/typecheck/lint/test/build` 全绿。

已完成：

- Node 24 基线统一（engines、`@types/node`、`.nvmrc`、`better-sqlite3@^12`）；两处 `@koa/cors` 已移除。
- ESLint 9 flat config、Prettier、Vitest、GitHub Actions CI 就位；服务端与 Web 各自 tsconfig 独立。
- Nexus 三包以 tarball + pnpm overrides 接入（`pnpm pack:nexus`，见 `scripts/pack-nexus.sh`）；Host 声明 `@nexus-ui/server` 与 `@nexus-ui/core`。
- 穿刺闭环自动化测试（`host-server/src/http/app.test.ts`）：`POST /api/cases/:caseId/analyze` → 玩具生成源 → guard → SSE `message×N → done`；`POST /api/a2ui/event` → ping handler → patch 禁用按钮；伪造 action 名被快照校验以 400 拒绝。
- Web 穿刺（`web/src/App.test.tsx`，jsdom）：生成 → 受控渲染 → 编辑备注 → action 回流（transport 补 `timestamp`/`actionId`）→ patch 生效；并断言 `action.context` 携带编辑后的最新备注。

仍待实施：

- `fixtures/` 尚无数据；正式 OrderOps Catalog v1、案件检测、SQLite migration、Agent RPC（现为玩具生成源）、队列/详情页面均未实现（M1/M2 范围，见 implementation-plan.md）。
- Web 现为穿刺页面（生成按钮 + 受控渲染区），正式队列/详情导航在 M1 搭建。
- Nexus 进程内锁与 ledger 之外的数据库原子性，仍由 M3 的领域幂等与结果查询负责。

## 10. Nexus 公开面核查结论（2026-09-28）

对 `Nexus_UI` 仓库 `@nexus-ui/server`、`@nexus-ui/core`、`@nexus-ui/react`（均 0.1.0，含已构建 `dist`，可 `pnpm pack` 成 tarball 接入）源码级核查的结论。`@nexus-ui/react` peer 依赖 `react >=18`。

### 10.1 Host 侧可用公开面（`@nexus-ui/server`，Koa 2 中间件）

| 公开导出                                      | OrderOps 用法                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createAgentRouter(options)`                  | 整包挂载：复用 `POST /api/a2ui/event`（action 回流）、`GET /api/a2ui/published-catalogs`、`/api/a2ui/catalog-contract`、`/api/a2ui/runs`、`/health`；`catalogContracts` 选项即发布 OrderOps Catalog 与 prompt contract（含 `contractHash`）                                                                                                                             |
| `AgentAdapter`                                | 构造注入：`registry`（只注册 OrderOps Catalog v1）、`createGenerationSource`（转发到 Agent-server RPC）、`resolveActionContext`（取最新备注）、`onGenerationCommitted`（写 `surface_bindings`）；`registerActionHandler(catalogId, 'createTicket', handler)` 承接本地业务 action                                                                                        |
| `sendAgentRun(ctx, plan.run, ...)`            | Host 自有 analyze 路由的流式输出；`plan.run.sequence.surfaceId` 在流式开始前即可取得并落库                                                                                                                                                                                                                                                                              |
| `createExternalAgentGenerationSource(config)` | Host → Agent-server 的 RPC 客户端。请求：`POST JSON {version:1, kind:'generate', surfaceId, message, history, catalogId, supportedComponents, supportedActions, catalogContract}`；响应必须是 `application/x-ndjson` 流。`timeoutMs` 默认 15s、`maxBytes` 默认 2MB，接真实模型必须上调 timeout。Agent-server 按此契约实现服务端即可，错误用非 2xx + `{error:{message}}` |
| `verifyExternalAgentIntegration`              | 六项 onboarding 检查（generation-lifecycle、catalog-stability、generation-root、action-same-surface、action-root-stability、policy-rejection）中的两项 action 检查依赖外部 action RPC；第一阶段只可用它覆盖生成半程的协议冒烟，本地 action 以宿主集成测试代替                                                                                                           |

### 10.2 已核实的执行语义

- Guard 逐消息校验（协议 → Nexus profile → 序列/生命周期 → Catalog schema 与 policy 诊断；跨消息 `{path}` 绑定用运行态组件表 + dataModel 交叉校验）全部发生在该消息写入 SSE 之前，非法消息不会到达浏览器。
- 生成流第一条消息必须是匹配 `surfaceId/catalogId` 的 `createSurface`，且必须包含 `id` 为 `root` 的组件；action 响应只允许 `updateComponents`/`updateDataModel`。
- SSE 事件名为 `message`/`done`/`error`，`done` 在 `commit`（action 快照 → `onGenerationCommitted` → history）成功后发送；commit 抛错会先回滚快照。
- action 提交有逐 surface 进程内锁与 in-memory ledger 去重；默认 `InMemorySurfaceActionStateStore`（LRU 256）重启即失效。`SurfaceActionStateStore` 是公开接口，后续可实现 SQLite 版支持跨重启。
- Web 侧：`A2UIProvider` 接 `catalogRegistry`、`catalogRenderMaps`（标准组件用 `standardRenderMap` 展开，`OrderSummary`/`LogisticsTimeline` 写自定义 render fn）；`useA2UI().push(ndjsonLine)`/`end()` 对接 SSE。TextField 编辑经 `runtime.setInputValue` 写入客户端 dataModel，点击按钮时由 core 按当前 dataModel 解析出最新 context 值。

### 10.3 实现陷阱清单

- `streamDelayMs` 默认每条消息 200ms（演示用节奏），生产装配必须显式传 0。
- 外部 Agent RPC `timeoutMs` 默认 15s，真实模型必须上调。
- `Button.disabled` 只允许字面布尔，不可 `{path}` 绑定；建单成功后以 patch 写 `disabled: true`。
- 自定义 Catalog 不触发内置 Basic/Workbench 的组件语义与媒体 URL 检查，但"Text 不得承载或绑定 URL 值"的动态检查对所有 Catalog 生效。
- 原生 `EventSource` 的网络错误与服务端同名 `error` 事件都会触发 error 监听，需按 `data` 是否存在区分。
- 过期 surface 的案件版本校验不在 Nexus 内，必须由 Host 的 action handler 对照 `surface_bindings.case_version` 实现。

实施时以 Nexus 公开 API 和可运行测试为准；本文件描述目标设计，不把计划功能写成已完成能力。
