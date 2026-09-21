# @nexus-ui/server

Agent 线 MVP 的传输与 Agent 服务。它通过 Agent Adapter 选择生成源、分发业务 action、校验 A2UI 输出，并通过 SSE 下发消息。

## 源码结构

```text
src/
  index.ts        服务组合根：配置加载、Koa 装配、端口监听
  api/            请求解析、client action 解析、路由与 SSE 响应流
  agent/          Agent Adapter、LLM/mock 生成源、业务 action handler、guard、会话 history
  config/         环境变量加载
  transport/      SSE event 序列化与响应头
```

## 接口

- `GET /health`：健康检查，返回当前 `agentMode`。
- `POST /api/a2ui/generate`：接收 `{ message?, catalogId? }`，流式返回初始 UI。
- `POST /api/a2ui/event`：接收 v0.9 client-to-server action 消息，流式返回同 surface 更新。

SSE 事件：

- `message`：`data` 是一个已校验的 A2UI 消息。
- `error`：Agent、模型或协议校验失败。
- `done`：Agent 输出和生成 history 提交均成功后的流结束事件。

## Agent 模式

- 配置 `OPENAI_API_KEY` 时使用 LLM streaming。
- 未配置 key 时使用确定性联系人卡片 fallback。
- 宿主可注入进程内 generation source；Agent Adapter 负责 surfaceId 生成、catalog 解析、生成源选择和 LLM / 宿主 source 成功流后的 surface history 提交。
- 宿主可通过异步 `historyStore` 注入独立 surface history 存储；catalog 与 turn 由一次 `commitGeneration` 提交，便于数据库实现使用事务。默认实现为进程内内存，保留最近 64 个 surface、每 surface 最近 20 条 turn，并以只读拷贝提供给生成源和 action handler。配置 `NEXUS_HISTORY_FILE` 后启用本地单进程文件持久化，重启后可恢复 catalog 与 history。
- 业务 action handler 按 `catalogId + action.name` 注册，并接收同 surface 的 catalog 与成功生成 history；当前提供 Basic `call / search / submit`、Task `start / complete` 和 Workbench `submit`。
- `external-agent.ts` 提供最小 HTTP JSONL RPC helper，可把初始生成与业务 action 转发给宿主自有 Agent；输出仍必须通过同一 Agent guard。
- 未注册 action 在进入 SSE 前返回 400，避免半流失败。
- LLM 输出必须是 A2UI JSONL。
- 每条消息下发前经过 `@nexus-ui/core` 结构校验和 Agent guard。
- 生成流必须先 `createSurface`，后续只能更新同一 surface，且必须包含 `root`。
- Agent guard 基于 `CatalogRegistry` 校验组件边界，并按 catalog 校验 action 名称；generate 默认 Basic Catalog，也可显式选择已注册 task / Workbench catalog。
- action 响应只能 `updateComponents` / `updateDataModel`。
- Task 样例使用进程内状态维护 `pending -> active -> completed`；重复迁移返回 400，重启后状态重置。
- 失败输出或 history 提交失败都不会以 `done` 结束；提交失败会转换为 SSE `error`。
- 外部 Agent RPC 支持 endpoint、自定义 headers、timeout 和响应字节上限；不提供自动重试、远程凭证托管、租户隔离或审计。

## 配置

本地开发使用仓库根目录 `.env`，参考 `.env.example`。`.env` 已被 git 忽略；部署环境变量优先，便于后续把 key 移到服务器环境。

| 变量 | 默认 | 说明 |
|---|---|---|
| `OPENAI_API_KEY` | 无 | 配置后启用真实 LLM |
| `OPENAI_BASE_URL` | 无 | OpenAI-compatible 服务地址 |
| `OPENAI_MODEL` | `gpt-4o-mini` | 模型名 |
| `PORT` | `3001` | HTTP 端口 |
| `NEXUS_HISTORY_FILE` | 无 | 显式配置后启用本地单进程 surface history 持久化；未配置则只在内存中保存 |
| `NEXUS_MAX_REQUEST_BODY_BYTES` | `1048576` | JSON 请求体字节上限；超限 Content-Length 会先拒绝，流式字节也持续计数 |
| `NEXUS_REQUEST_TIMEOUT_MS` | `10000` | JSON 请求体读取超时 |

`NEXUS_HISTORY_FILE` 使用同目录临时文件加 `rename` 的原子写入方式，仅适用于单进程部署。它不是数据库、多实例协调、租户隔离或审计方案。

JSON API 只接受 `application/json` 或 `+json` Content-Type。上述请求边界用于降低慢请求和超大请求的本地拒绝服务风险；认证、公网限流和租户策略仍由宿主部署层负责。

## 命令

```bash
pnpm --filter @nexus-ui/server dev
pnpm --filter @nexus-ui/server test
pnpm --filter @nexus-ui/server typecheck
pnpm --filter @nexus-ui/server build
```

测试环境不会加载仓库 `.env`，因此 route 测试不会读取开发 key 或请求真实 LLM。
