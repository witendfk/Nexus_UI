# OrderOps Agent 架构设计

状态：初始框架设计。
日期：2026-09-28。
依赖：[Nexus UI](../../Nexus_UI/)（`@nexus-ui/core` / `@nexus-ui/react` / `@nexus-ui/server`）。

## 1. 一句话定位

> OrderOps Copilot 是一个电商内部订单异常运营 Agent；Nexus UI 是它的人机协同执行层。

Agent 发现异常、解释原因、建议处理方案；Host 持有订单 / 物流 / 工单事实、校验业务 action、保证幂等；Nexus UI 提供受控的 A2UI 渲染、输入绑定和 action 回流。

## 2. 服务拓扑

```text
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (web)                            │
│  @nexus-ui/react A2UIProvider → renderMap → dataModel → action  │
└───────────────┬─────────────────────────────┬───────────────────┘
                │ POST /api/a2ui/generate     │ POST /api/a2ui/event
                ▼                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Host Server (:3201)                           │
│                                                                  │
│  @nexus-ui/server createAgentRouter + AgentAdapter               │
│  ├── Catalog Registry (OrderOps catalog v1)                      │
│  ├── Stream guard (protocol / lifecycle / catalog / action)      │
│  ├── Action handlers (createTicket / contactCourier / …)         │
│  ├── Surface action state store (committed snapshot)             │
│  └── SQLite: orders / logistics / tickets / idempotency          │
│                                                                  │
│  External Agent RPC (HTTP JSONL)                                 │
└───────────────┬─────────────────────────────────────────────────┘
                │ POST /rpc (generate / action)
                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Agent Server (:3202)                          │
│                                                                  │
│  消费 Catalog Contract（discovery + hash 校验）                   │
│  ├── LLM (OpenAI-compatible) + system prompt                     │
│  ├── 只读工具: queryOrder / queryLogistics / queryAnomalies      │
│  ├── 生成: 返回 createSurface + updateComponents NDJSON          │
│  └── Action: 接收已解析 action，返回同 surface patch             │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 Agent Server (`packages/agent-server`)

独立 HTTP 进程，暴露一个 JSONL RPC endpoint。

职责：
- 消费 Host 发布的 Catalog Contract（通过 `/api/a2ui/published-catalogs` discovery）。
- 维护 system prompt：Catalog promptContract + 业务规则（OrderOps 领域知识）。
- 调用只读工具查询订单 / 物流事实，引用事件 ID 作为证据。
- 接收 generate 请求（含 surfaceId / catalogId / supportedComponents / supportedActions / history）。
- 返回 `application/x-ndjson`，每行一个候选 A2UI 消息对象。
- 接收 action 请求，返回同 surface 的 patch 消息。

不负责：
- 业务事实存储（Host 负责）。
- action 执行（Host handler 负责）。
- 最终输出校验（Host 的 Nexus guard 负责）。

### 2.2 Host Server (`packages/host-server`)

独立 HTTP 进程，组装 `@nexus-ui/server` 的受控装配 API。

职责：
- 通过 `AgentAdapter` + `createExternalAgentGenerationSource` 连接 Agent Server。
- 注册 OrderOps CatalogDefinition（组件白名单 / action 白名单 / props schema / componentPolicies）。
- 注册业务 action handler（createTicket 等），内部实现领域幂等（SQLite）。
- 暴露 `createAgentRouter` 路由：`/api/a2ui/generate`、`/api/a2ui/event`、`/api/a2ui/catalog-contract`、`/api/a2ui/published-catalogs`。
- Agent Server 通过 `/api/a2ui/published-catalogs` discovery 获取 Catalog Contract。
- 向 Web 提供 SSE 流。

不负责：
- LLM 调用（Agent Server 负责）。
- UI 渲染（Web 负责）。

### 2.3 Web (`packages/web`)

Vite + React 前端。

职责：
- 通过 `@nexus-ui/react` 的 `A2UIProvider` 挂载 runtime。
- 消费 Host 的 SSE 流，调用 `runtime.push(chunk)`。
- 用户输入通过 `{ path }` 绑定写入 dataModel。
- Button action 携带最新 context POST 回 Host `/api/a2ui/event`。
- 通过 `catalogRenderMaps` 接入 OrderOps 自定义组件（OrderSummary / LogisticsTimeline）。

不负责：
- 协议校验（Nexus guard + core 双层负责）。
- 业务逻辑（Host handler 负责）。

## 3. 数据流

### 3.1 首条切片：物流长时间无更新

```text
用户输入: "帮我处理一下订单 SO-9182 的物流异常"
  │
  ▼
Web → POST /api/a2ui/generate { message, catalogId }
  │
  ▼
Host AgentAdapter.prepareGeneration()
  ├── createExternalAgentGenerationSource(rpc) → Agent Server
  │     ├── Agent 消费 catalog promptContract
  │     ├── Agent 调用 queryOrder('SO-9182') → 返回订单 + 物流事实
  │     ├── Agent 调用 queryLogistics('SO-9182') → 返回时间线事件 ID
  │     └── Agent 输出 NDJSON:
  │         createSurface { surfaceId, catalogId }
  │         updateComponents { OrderSummary, LogisticsTimeline, Text, TextField, Button }
  │         updateDataModel { orderId, customerName, events, resolution }
  │
  ├── Host guard: protocol / lifecycle / catalog / schema / action 校验
  ├── Host actionStateStore.commitGeneration()
  └── SSE → Web 渲染 surface

用户修改备注，点击 createTicket
  │
  ▼
Web → POST /api/a2ui/event { action: { name: 'createTicket', context: { … } } }
  │
  ▼
Host AgentAdapter.prepareAction()
  ├── surface lock（同一 surface 串行）
  ├── 从 actionStateStore 读取权威快照
  ├── 校验 action 与快照匹配（组件 / action 名）
  ├── resolveDeclaredActionContext（服务端 dataModel 为权威事实）
  ├── handler: createTicket
  │     ├── SQLite 事务: INSERT ticket (idempotency_key = anomalyId + resolution)
  │     ├── 冲突 → 返回已有工单号（幂等）
  │     └── 返回 patch NDJSON（经 Agent Server 或本地 fixture）
  ├── Host guard 校验 patch 输出
  ├── actionStateStore.commitAction()
  └── SSE → Web 同 surface 原地更新（工单号 + 状态）
```

## 4. OrderOps Catalog（首条切片）

```typescript
const orderOpsCatalog: CatalogDefinition = {
  catalogId: 'https://orderops.example/catalogs/order-ops/v1',
  components: [
    'OrderSummary',       // 自定义：订单号 / 商品 / 金额 / 客户
    'LogisticsTimeline',  // 自定义：物流事件列表，带可追溯事件 ID
    'Text',
    'TextField',          // 运营备注
    'Button',             // createTicket
  ],
  actions: ['createTicket'],
  componentSchemas: {
    OrderSummary: {
      type: 'object',
      required: ['orderId', 'productName', 'amount', 'customerName'],
      properties: {
        orderId:      { type: 'string', dynamic: 'required' },
        productName:  { type: 'string', dynamic: 'required' },
        amount:       { type: 'number', dynamic: 'required' },
        customerName: { type: 'string', dynamic: 'required' },
      },
    },
    LogisticsTimeline: {
      type: 'object',
      required: ['events'],
      properties: {
        events: {
          type: 'array',
          dynamic: 'required',
          items: {
            type: 'object',
            required: ['eventId', 'status', 'timestamp'],
            properties: {
              eventId:   { type: 'string' },
              status:    { type: 'string' },
              timestamp: { type: 'string' },
            },
          },
        },
      },
    },
  },
  componentPolicies: {
    OrderSummary:      { origin: 'host-extension', action: { allowed: false } },
    LogisticsTimeline: { origin: 'host-extension', action: { allowed: false } },
    Button:            { action: { allowed: true } },
  },
};
```

## 5. SQLite 数据模型

首条切片的最小表结构：

```sql
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  product_name TEXT NOT NULL,
  amount REAL NOT NULL,
  customer_name TEXT NOT NULL,
  promised_delivery TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE logistics_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  status TEXT NOT NULL,
  description TEXT,
  occurred_at TEXT NOT NULL
);

CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  anomaly_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL
);
```

`idempotency_key = sha256(orderId + anomalyType)`；同 key 的 `INSERT OR IGNORE` 保证同一订单异常只建一张工单。

## 6. Agent 只读工具

Agent Server 在 LLM 调用中注入以下 tool 定义（function calling）：

| 工具 | 输入 | 输出 | 约束 |
| --- | --- | --- | --- |
| `queryOrder` | orderId | 订单摘要 + 状态 | 只读 |
| `queryLogistics` | orderId | 物流事件列表（带 eventId） | 只读 |
| `listAnomalies` | — | 标注异常列表 | 只读，首条切片可省略 |

Agent 的事实引用必须回查到工具结果中的事件 ID，不能从 prompt 推测。

## 7. Nexus UI 接入方式

开发阶段（monorepo 内联）：

```json
{
  "dependencies": {
    "@nexus-ui/core": "file:../../Nexus_UI/packages/nexus-core",
    "@nexus-ui/react": "file:../../Nexus_UI/packages/nexus-react",
    "@nexus-ui/server": "file:../../Nexus_UI/server/nexus-playground-server"
  }
}
```

正式接入（Phase 2 tarball 或 npm alpha）：

```json
{
  "dependencies": {
    "@nexus-ui/core": "0.1.0",
    "@nexus-ui/react": "0.1.0",
    "@nexus-ui/server": "0.1.0"
  }
}
```

接入边界：
- Host Server 只 import `@nexus-ui/server` 的根入口（`AgentAdapter` / `createAgentRouter` / `InMemorySurfaceHistoryStore` / `createExternalAgentGenerationSource` / `createExternalAgentActionHandler`）。
- Web 只 import `@nexus-ui/react` 的根入口（`A2UIProvider` / `useA2UI` / `standardRenderMap`）和 `@nexus-ui/core` 的类型。
- 不依赖内部路径。

## 8. 迭代顺序

| 阶段 | 交付物 | 验收 |
| --- | --- | --- |
| M1 | SQLite + fixture 数据 + 只读查询 API | `queryOrder('SO-9182')` 返回订单 + 物流时间线 |
| M2 | OrderOps CatalogDefinition + Host Server 组装 | `/api/a2ui/published-catalogs` 返回 OrderOps catalog |
| M3 | Agent Server 确定性 fixture 输出 | 独立调用 RPC 返回合法 NDJSON |
| M4 | Web 渲染 + action 闭环 | 生成 surface → 修改备注 → createTicket → 同 surface patch |
| M5 | Agent Server 接入真实 LLM | 同一案例用真实模型跑通；证据引用可回查 |

首条切片完成后再扩展第二种异常（高金额退款），检验 Catalog / guard / 绑定复用。
