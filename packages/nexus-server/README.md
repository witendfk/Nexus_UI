# @nexus-ui/server

Nexus UI server SDK：Agent 装配、准入 guard、SSE 传输与宿主显式注入契约。它通过 Agent Adapter 接宿主生成源、分发业务 action、校验 A2UI 输出，并通过 SSE 下发消息。参考服务（演示 Catalog、LLM/mock 生成源、本地 Koa 装配）在 [examples/playground-server](../../examples/playground-server/)。

## 源码结构

```text
src/
  index.ts          服务组合根：宿主装配 API（不启动 listener、不读取项目环境）
  api/              请求解析、client action 解析、路由与 SSE 响应流
  agent/            Agent Adapter、guard、catalog contract、RPC helper、history/run 实现、policy 类型
  transport/        SSE event 序列化与响应头
```

## 接口

- `GET /health`：健康检查；`agentMode`/`actionMode` 来自宿主显式配置，默认值不读取环境或模型 key。
- `POST /api/a2ui/generate`：接收 `{ message?, catalogId }`；`catalogId` 必填，缺失即 400，不回落默认 Catalog。
- `POST /api/a2ui/event`：接收 v0.9 client-to-server action 消息，流式返回同 surface 更新。
- `GET /api/a2ui/runs?surfaceId=`：运行记录查询；必须配置 `runsAccess` 宿主准入回调，未配置时一律 403（`RUNS_ACCESS_NOT_CONFIGURED`），回调拒绝为 403（`RUNS_ACCESS_DENIED`）。

SSE 事件：

- `message`：`data` 是一个已校验的 A2UI 消息。
- `error`：Agent、模型或协议校验失败。
- `done`：Agent 输出和生成 history 提交均成功后的流结束事件。

## 显式装配契约

- `AgentAdapterOptions.registry` 必填：宿主注入自己的 `CatalogRegistry`，SDK 不注册任何默认 Catalog；官方 A2UI Basic Catalog 身份显式拒绝。
- 生成源必须显式提供之一：`createGenerationSource`、`fallbackGeneration`，或 `useLlm: () => true` 加 `streamLlm` 注入（`useLlm` 默认恒为 false；启用而缺 `streamLlm` 在 prepare 时报错）。SDK 不内置模型 SDK，也不读取 `OPENAI_*` 环境变量。
- `historyStore` 可选注入；缺省时每个 adapter 实例新建独立的内存 store，实例之间互不可见。不再存在模块级全局 history 单例。
- `catalogId` 在每次 generate 请求必填；旧版 legacy URL 不再静默归一，按未注册 catalog 明确报错。
- 业务 action handler 按 `catalogId + action.name` 注册，并接收同 surface 的 catalog 与成功生成 history；SDK 不提供任何演示 handler。
- `AgentAdapterOptions.policy` 支持注入部分或完整 host policy；未注入时 SDK 施加零条业务规则（无媒体关键词、无搜索/表单/Workbench 流程校验）。注入策略仍然运行在协议、Profile、Catalog 和生命周期 guard 之后。
- Agent guard 的序列选项 `catalogId`/`registry`/`supportedActions` 必填；action 挂载组件不再按 Button/TaskButton 名称特判（声明式能力归属 Catalog v2，见 SPEC §4）。
- `sendAgentRun` 必须显式传入 `manager`（`AgentRunManager`）；`createAgentRouter` 缺省时为每个 router 实例新建，宿主也可注入。
- `external-agent.ts` 提供最小 HTTP JSONL RPC helper，可把初始生成与业务 action 转发给宿主自有 Agent；输出仍必须通过同一 Agent guard。

未注册 action 在进入 SSE 前返回 400，避免半流失败。每条消息下发前经过 `@nexus-ui/core` 结构校验和 Agent guard；生成流必须先 `createSurface`，后续只能更新同一 surface，且必须包含 `root`；action 响应只能 `updateComponents` / `updateDataModel`。失败输出或 history 提交失败都不会以 `done` 结束；提交失败会转换为 SSE `error`。

外部 Agent RPC 支持 endpoint、自定义 headers、timeout 和响应字节上限；不提供自动重试、远程凭证托管、租户隔离或审计。

## 配置

SDK 根入口不读取项目环境。请求边界由 router options 显式配置：

| router options         | 默认      | 说明                                                                  |
| ---------------------- | --------- | --------------------------------------------------------------------- |
| `maxRequestBodyBytes`  | `1048576` | JSON 请求体字节上限；超限 Content-Length 会先拒绝，流式字节也持续计数 |
| `requestBodyTimeoutMs` | `10000`   | JSON 请求体读取超时                                                   |
| `streamDelayMs`        | `200`     | 演示 pacing；生产装配应省略                                           |

`runManager` 可注入宿主自己的运行记录存储（实现 `InMemoryAgentRunManager` 同款接口）；runs 查询的访问控制由 `runsAccess` 决定，`surfaceId` 不是凭据，认证主体必须来自宿主可信请求上下文。

## 命令

```bash
pnpm --filter @nexus-ui/server test
pnpm --filter @nexus-ui/server typecheck
pnpm --filter @nexus-ui/server build
```

参考服务（本地 3001 端口、playground 前端代理目标）的运行方式见 [examples/playground-server](../../examples/playground-server/README.md)；独立宿主与 LLM 外部 Agent 链路验证见 [examples/standalone-host-demo](../../examples/standalone-host-demo/README.md)。
