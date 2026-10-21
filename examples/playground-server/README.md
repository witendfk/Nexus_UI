# @nexus-ui/playground-server

Nexus UI Playground 的本地参考服务：演示 Catalog（Nexus Basic Task Profile / Task / Workbench）、确定性 mock 与可选 LLM 生成源、联系人/搜索/表单/任务/客户跟进演示 handler，以及本地 Koa 装配（默认端口 3001，`web/nexus-playground` 的 Vite 代理目标）。

它只通过 `@nexus-ui/core`、`@nexus-ui/server` 公开入口消费 SDK（有测试断言禁止深路径 import）；SDK 本身不包含这里的业务 Catalog、prompt、模型调用或演示 handler。

## 显式装配

- registry：`src/agent/catalog.ts` 的演示 `agentCatalogRegistry` 在参考装配中显式传给 `AgentAdapter`（SDK 已不内置默认 Catalog）。
- 生成源：无 `OPENAI_API_KEY` 时走确定性 fixture fallback；配置后经 `streamLlm` 显式注入 OpenAI 兼容流。两者都是参考程序自己的选择。
- policy：`src/agent/policy/` 的演示规则（媒体关键词、搜索/表单/Workbench 流程）经 `AgentAdapterOptions.policy` 显式注入。
- history：`NEXUS_HISTORY_FILE` 配置后用 `FileSurfaceHistoryStore`，否则每实例新建内存 store。
- runs 查询：本地试验台显式传 `runsAccess: () => true` 放行；公网部署必须换成基于可信请求上下文的准入。
- 发布：`main.ts` 传 `catalogContracts: listReferencePublishedCatalogs(agentAdapter)`，发布列表取自 adapter 的固定执行声明（三个演示 Catalog），装配期与执行声明核对 hash；`published-catalogs`/`catalog-contract`/`agent-onboarding` 与生成 done 的 Catalog/hash 同源。
- 可编辑白名单：参考工厂内置 surface→Catalog 映射（生成提交边界记录，容量 512，未记录即空数组），按 Catalog 精确声明可编辑路径——Basic `/name`、`/subscribed`；Task 无输入；Workbench `/taskTitle`、`/priority`、`/reminderAt`。客户身份/ID、状态等只读字段不开放；调用方可经 `editablePaths` 显式收窄。
- Basic 表单：消息命中演示 Policy 的表单意图（`表单|form|订阅|subscribe`）时 fallback 生成字符串 + 布尔表单（ids `name`/`subscribed`/`submitButton`/`submitResult`），复用 `submit` handler；输入经 HTTP 权威准入后到达 handler 并 patch 原 surface，可连续提交（浏览器按草稿快照确认，已确认草稿不重发）。

浏览器端（`web/nexus-playground`）在挂载前校验已发布契约（版本、身份、Web Crypto 复算 hash、标准 prompt、注册闸门），以 `X-Nexus-Run-Id` 响应头关联 done，成功后确认草稿；`GET /api/a2ui/surface-state` 查询不是视图恢复，`done` 不表示业务事务成功。

## 命令

```bash
pnpm dev:server                            # 仓库根目录；等价于下行
pnpm --filter @nexus-ui/playground-server dev
pnpm --filter @nexus-ui/playground-server test
pnpm --filter @nexus-ui/playground-server typecheck
```

环境变量沿用仓库根 `.env`（`.env.example`）：`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`、`PORT`、`NEXUS_HISTORY_FILE`、`NEXUS_MAX_REQUEST_BODY_BYTES`、`NEXUS_REQUEST_TIMEOUT_MS`。测试环境不加载仓库 `.env`。
