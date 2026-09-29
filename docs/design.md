# OrderOps Copilot 框架设计图

配套文档：[架构设计与验收](architecture.md)（文字版设计，含第 10 节 Nexus 源码核查结论）、[实施顺序与任务清单](implementation-plan.md)。以下视图均基于 2026-09-28 对 `Nexus_UI` 0.1.0 源码核实后的接线方式绘制。

## 1. 系统拓扑与数据流

```mermaid
flowchart TB
    subgraph WEB["packages/web · :3200 · React 18 + Vite"]
        W1["cases/queue 案件队列"]
        W2["cases/detail 案件详情"]
        W3["nexus/transport SSE 读取 + action POST"]
        W4["nexus/render-map OrderSummary / LogisticsTimeline"]
        W5["A2UIProvider · Nexus 受控 surface"]
    end

    subgraph HOST["packages/host-server · :3201 · Koa 2"]
        H1["http/ · cases 路由 + analyze SSE"]
        H2["nexus/ · AgentAdapter 装配 + createAgentRouter + guard"]
        H3["actions/create-ticket 本地业务 handler"]
        H4["cases/ · 停滞检测 + 仓储"]
        H5["tools/read-api · 内部只读快照 API"]
        H6[("SQLite · 7 表 · 事务与审计")]
    end

    subgraph AGENT["packages/agent-server · :3202"]
        A1["rpc/ · JSON 请求 → NDJSON 流"]
        A2["catalog-contract/ · 拉取 + hash 缓存"]
        A3["analysis/ · 模型适配 + zod 校验"]
        A4["a2ui/compile · 分析结果 → A2UI 消息"]
    end

    LLM["LLM · OpenAI 兼容接口"]

    W1 -->|"GET /api/cases"| H1
    W2 -->|"GET /api/cases/:id"| H1
    W2 -->|"POST analyze → SSE"| H1
    W3 -->|"POST /api/a2ui/event · timestamp+actionId"| H2
    W4 --> W5
    W3 -->|"SSE message/done/error → runtime.push"| W5
    H1 --> H2
    H2 -->|"外部 Agent RPC · JSON → NDJSON · timeoutMs≥120s"| A1
    H2 --> H5
    H5 --> H4
    H3 --> H6
    H4 --> H6
    A1 --> A2
    A1 --> A3
    A3 <--> LLM
    A3 --> A4
    A4 --> A1
```

要点：

- 浏览器只与 Host 通信；Agent-server 无浏览器面，仅接受 Host 的 RPC，无 CORS。
- Nexus 三个包以 tarball 静态接入：`@nexus-ui/core` + `@nexus-ui/react` 进 Web，`@nexus-ui/server` 进 Host；guard 与 action 快照都运行在 Host 进程内。
- 业务事实的唯一权威是 Host 的 SQLite；A2UI dataModel 只是界面状态，不回传作为订单事实。

## 2. 包内模块结构

```text
packages/host-server/src/
├── main.ts                  # Koa 装配入口（挂路由、监听 3201）
├── config.ts                # env 读取 + 启动时 zod 校验
├── db/
│   ├── migrations/0001_init.sql
│   └── client.ts            # better-sqlite3 单例 + migration runner(user_version)
├── fixtures/                # 停滞物流案例 + 正常对照案例
├── cases/
│   ├── detect.ts            # 停滞检测规则（occurrence_key 幂等）
│   └── repository.ts        # 订单/物流/案件/工单/审计查询与事务
├── tools/
│   └── read-api.ts          # GET /internal/cases/:id/context（内部 token）
├── nexus/
│   ├── catalog.ts           # OrderOps Catalog v1 定义 + CatalogRegistry
│   ├── adapter.ts           # AgentAdapter 装配：生成源/context resolver/commit 钩子
│   └── create-ticket.ts     # 本地 action handler（版本校验 + 事务 + patch 编译）
└── http/
    ├── app.ts               # 挂 createAgentRouter + 自有 /api 路由
    └── cases.ts             # 队列/详情/analyze(SSE)/action 查询

packages/agent-server/src/
├── main.ts                  # Koa 入口（监听 3202，仅 /rpc + /health）
├── config.ts
├── rpc/
│   └── handler.ts           # 解析 Host 请求，返回 application/x-ndjson 流
├── catalog-contract/
│   └── client.ts            # GET Host catalog-contract，按 contractHash 缓存
├── tools/
│   └── case-context.ts      # GET Host /internal/cases/:id/context
├── analysis/
│   ├── schema.ts            # 分析结果 zod schema（summary/reason/evidence/…）
│   ├── model.ts             # OpenAI 兼容调用 + 结构化输出校验 + 重试
│   └── fixture.ts           # 确定性分析（回归测试与降级演示）
└── a2ui/
    └── compile.ts           # 校验后的分析 → createSurface/updateComponents/updateDataModel

packages/web/src/
├── main.tsx                 # Router + QueryProvider 装配
├── api/
│   └── client.ts            # fetch 封装（cases/analyze/actions）
├── cases/
│   ├── QueuePage.tsx        # 队列：筛选、搜索、导航
│   └── CaseDetailPage.tsx   # 详情：事实、时间线、分析、审核区
├── nexus/
│   ├── transport.tsx        # SSE → runtime.push；onAction → POST event
│   ├── render-map.tsx       # standardRenderMap 展开 + 两个业务组件
│   └── registry.ts          # 与 Host 共享的 CatalogDefinition 构造 CatalogRegistry
├── actions/
│   └── status.tsx           # done 前禁用、失败重试、断线恢复
└── contracts/               # re-export @orderops/contracts（仅类型与 schema）
```

跨包契约只有 `packages/contracts`（纯 zod schema + 类型，零运行时依赖）：`CaseSnapshot`、`ReadContextResponse`、`AnalysisResult`、`CreateTicketInput`。Agent 不 import Host 的数据库模块。

## 3. 生成时序（M2 主流程）

```mermaid
sequenceDiagram
    actor U as 运营
    participant W as Web :3200
    participant H as Host :3201
    participant G as Nexus guard（Host 进程内）
    participant A as Agent :3202
    participant M as LLM

    U->>W: 打开案件详情
    W->>H: POST /api/cases/:id/analyze
    H->>H: 案件状态校验 → prepareGeneration(message=caseId)
    H->>A: POST /rpc {version:1, kind:generate, caseId, catalogContract}
    A->>A: contractHash 比对，必要时刷新 Catalog Contract
    A->>H: GET /internal/cases/:id/context（只读快照）
    A->>M: 结构化分析（schema 约束五字段）
    M-->>A: summary / reason / evidenceEventIds / recommendation / uncertainties
    A->>A: 证据 ID ∈ 快照校验，不足则 insufficient_evidence
    A->>A: 代码编译 createSurface + updateComponents + updateDataModel
    A-->>H: NDJSON 流
    loop 每条消息
        H->>G: 协议 / profile / 序列 / Catalog schema 四层校验
        G-->>W: 通过才写 SSE message
    end
    H->>H: commit：action 快照 + onGenerationCommitted 写 surface_bindings
    H-->>W: SSE done
    W->>W: 渲染 surface，启用建单按钮（done 前禁用）
```

失败路径：任一消息校验失败或 commit 抛错 → 先回滚快照，再发 SSE `error` 事件；Web 显示错误与重试，不把半截流当可执行界面。

## 4. 建单 action 时序（M3 主流程）

```mermaid
sequenceDiagram
    actor U as 运营
    participant W as Web
    participant H as Host
    participant N as Nexus AgentAdapter
    participant D as SQLite

    U->>W: 编辑备注（runtime.setInputValue 写客户端 dataModel）
    U->>W: 点击确认建单
    W->>W: resolveContext 按 {path} 解析最新备注；补 timestamp + actionId
    W->>H: POST /api/a2ui/event {version:v0.9, action}
    H->>N: prepareAction(action)
    N->>N: surface 锁 → 快照存在 → Button 声明匹配 → ledger 去重
    N->>H: resolveActionContext（只留备注字段，拒其他客户端字段）
    H->>H: surface_bindings 找案件，核对 case_version（过期拒绝）
    H->>D: 事务：唯一工单 + 案件状态 + action_attempts + audit_events
    H->>H: 事务回执 → 确定性 patch（按钮 disabled:true + 工单号）
    H->>N: handler 返回 patch 消息源 → guard 校验
    N-->>W: SSE updateComponents/updateDataModel → done
    Note over W,D: SSE 中断或 patch 失败不回滚工单；Web 以 GET /api/actions/:id 与案件查询恢复真实状态；重复提交返回已有结果
```

## 5. 数据模型与状态机

```mermaid
erDiagram
    orders ||--o{ logistics_events : "order_id"
    orders ||--o{ anomaly_cases : "order_id"
    anomaly_cases ||--o| tickets : "case_id 唯一约束"
    anomaly_cases ||--o{ action_attempts : "case_id"
    anomaly_cases ||--o{ audit_events : "case_id"
    anomaly_cases ||--o{ surface_bindings : "case_id"
    anomaly_cases {
        text id PK
        text order_id FK
        text type
        text occurrence_key "一次停滞区间，防重复建案"
        text severity
        text status
        int version "乐观版本，状态变化自增"
        text last_event_id "可回查的触发事件"
    }
    action_attempts {
        text id PK
        text case_id FK
        text operation
        text request_key "客户端请求重放识别"
        text status "pending/succeeded/failed/needs_reconcile"
    }
```

```mermaid
stateDiagram-v2
    [*] --> open: 检测器建案（occurrence_key 幂等）
    open --> in_review: 打开详情 / 发起分析
    in_review --> ticket_created: 建单事务提交
    open --> dismissed: 人工关闭
    in_review --> dismissed: 人工关闭
    ticket_created --> [*]
```

操作状态：`pending → succeeded | failed | needs_reconcile`。领域幂等键 `caseId + operationType`（`tickets.case_id` 唯一约束兜底）；`request_key` 仅识别同一客户端请求重放，备注不参与幂等键。

## 6. 端口与环境变量

| 端口 | 服务            | 说明                                                   |
| ---- | --------------- | ------------------------------------------------------ |
| 3200 | Web（Vite dev） | `/api` 代理到 3201；SSE 经代理流式透传                 |
| 3201 | Host            | 生产模式下同时静态托管 `web/dist`，单一 origin 无 CORS |
| 3202 | Agent-server    | 仅 Host 可达                                           |

| 变量                                                    | 包           | 说明                                                    |
| ------------------------------------------------------- | ------------ | ------------------------------------------------------- |
| `PORT`                                                  | host / agent | 默认 3201 / 3202                                        |
| `ORDEROPS_DB_PATH`                                      | host         | SQLite 文件路径，默认 `var/orderops.sqlite`             |
| `ORDEROPS_SEED_FIXTURES`                                | host         | `1` 时启动写入 fixture 案件                             |
| `ORDEROPS_STALL_THRESHOLD_HOURS`                        | host         | 物流停滞阈值（severity 由此推导）                       |
| `ORDEROPS_AGENT_RPC_URL`                                | host         | 默认 `http://127.0.0.1:3202/rpc`                        |
| `ORDEROPS_AGENT_TIMEOUT_MS`                             | host         | 外部 RPC 超时，默认 `120000`（Nexus 默认 15s 必须覆盖） |
| `ORDEROPS_INTERNAL_TOKEN`                               | host / agent | `/internal/*` 共享鉴权，两边一致                        |
| `ORDEROPS_ANALYSIS_MODE`                                | agent        | `fixture`（默认，确定性）或 `model`                     |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `ORDEROPS_MODEL` | agent        | `model` 模式必填                                        |
