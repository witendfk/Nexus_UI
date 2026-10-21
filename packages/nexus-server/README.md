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
- `POST /api/a2ui/event`：仅接收 `{ message, nexus }`；message 为 v0.9 action，nexus 含 sessionVersion/actionId/surfaceRevision/catalogHash/inputs，流式返回同 surface 更新。
- `GET /api/a2ui/runs?surfaceId=`：运行记录查询；必须配置 `runsAccess` 宿主准入回调，未配置时一律 403（`RUNS_ACCESS_NOT_CONFIGURED`），回调拒绝为 403（`RUNS_ACCESS_DENIED`）。
- `GET /api/a2ui/surface-state?surfaceId=&runId=`：返回指定运行的固定 `NexusSurfaceCommit`；缺参 400，`runsAccess` 未配置/拒绝 403，记录缺失/错 surface/淘汰 404，尚无提交结果 409。仅查固定留存，不回退最新快照。

生成/action SSE 在占用响应时即携带 `X-Nexus-Run-Id`（公开常量 `NEXUS_RUN_ID_HEADER`），与成功 done.runId、运行记录 ID 和事件 ID 前缀同值。跨源读取需由宿主 CORS 配置暴露该头；查询必须使用裸 runId，不能解析事件 ID 猜测。原始 `sendMessages` 不提供运行标识头或固定提交结果。

SSE 事件：

- `message`：`data` 是一个已校验的 A2UI 消息。
- `error`：Agent、模型或协议校验失败。
- `done`：SDK 运行成功提交 UI 后，data 直接承载本次固定 `NexusSurfaceCommit`；不代表宿主业务副作用的事务结果。

## 显式装配契约

- `AgentAdapterOptions.registry` 必填：宿主注入自己的 `CatalogRegistry`，SDK 不注册任何默认 Catalog；官方 A2UI Basic Catalog 身份显式拒绝。
- 生成源必须显式提供之一：`createGenerationSource`、`fallbackGeneration`，或 `useLlm: () => true` 加 `streamLlm` 注入（`useLlm` 默认恒为 false；启用而缺 `streamLlm` 在 prepare 时报错）。SDK 不内置模型 SDK，也不读取 `OPENAI_*` 环境变量。
- `historyStore` 可选注入；缺省时每个 adapter 实例新建独立的内存 store，实例之间互不可见。不再存在模块级全局 history 单例。
- `catalogId` 在每次 generate 请求必填；旧版 legacy URL 不再静默归一，按未注册 catalog 明确报错。
- 业务 action handler 按 `catalogId + action.name` 注册，并接收同 surface 的 catalog 与成功生成 history；SDK 不提供任何演示 handler。
- `AgentAdapterOptions.policy` 支持注入部分或完整 host policy；未注入时 SDK 施加零条业务规则（无媒体关键词、无搜索/表单/Workbench 流程校验）。注入策略仍然运行在协议、Profile、Catalog 和生命周期 guard 之后。
- Agent guard 的序列选项 `catalogId`/`registry`/`supportedActions` 必填；action 挂载组件不再按 Button/TaskButton 名称特判（声明式能力归属 Catalog v2，见 SPEC §4）。
- `AgentAdapter` 持有每实例隔离的 `runManager`，宿主可在构造时注入；router 与 `sendAgentRun(ctx, run, options)` 自动复用。显式 manager 必须是同一实例；原始自定义 `AgentRun` 必须向 sender 显式提供 manager。`sendAgentRun` 只有三参签名；旧的 idPrefix 四参槽位已删除（S2.6.5），运行标识只来自 `run.runId`。
- `AgentAdapterOptions.editablePaths(surfaceId)` 由宿主可信装配按 surface 提供精确 JSON Pointer 白名单；缺省即全部拒绝非空 `inputs`（`inputs: []` 的 action 不受影响）。surface→Catalog 的映射由宿主自己维护（参考示例在 `onGenerationCommitted` 记录、有界容量、未记录即返回空数组，fail-closed），不从模型或浏览器推断可编辑路径。
- `external-agent.ts` 提供最小 HTTP JSONL RPC helper，可把初始生成与业务 action 转发给宿主自有 Agent；输出仍必须通过同一 Agent guard。

## 最小接入样例

三种入口共用同一套 Catalog 声明：**纯本地 core**（浏览器 `A2UIRuntime` + `setInputValue`/`extractLatestInputDrafts`，无服务端）、**HTTP**（本包 router + 本地 handler）与 **RPC**（handler 转发外部 JSONL Agent）。协议到 VNode 的解释只在 `@nexus-ui/core`；React 只做 VNode→元素映射，新增 renderer 不复制解释器。

```ts
import { CatalogRegistry, standardCatalogComponentDeclarations } from '@nexus-ui/core';
import type { CatalogDefinition } from '@nexus-ui/core';
import { AgentAdapter, createAgentRouter } from '@nexus-ui/server';

// 1. Catalog：展示型显式 actions: []；交互型声明 inputs（可写绑定属性 → 值 schema）与 action 来源。
const catalog: CatalogDefinition = {
  catalogId: 'https://example.com/catalogs/feedback/v1',
  components: {
    ...standardCatalogComponentDeclarations(), // 可按需只挑子集
    ScoreDial: {
      schema: { type: 'object', additionalProperties: false, required: ['score'],
        properties: { score: { type: 'integer', dynamic: 'required', minimum: 0, maximum: 100 } } },
      inputs: { score: { type: 'integer', minimum: 0, maximum: 100 } },
      origin: 'host-extension',
    },
  },
  actions: [{ name: 'record', sources: ['Button'], paramSchema: {
    type: 'object', additionalProperties: false, required: ['score'],
    properties: { score: { type: 'integer', minimum: 0, maximum: 100 } } } }],
};

// 2. handler：参数是服务端从临时输入模型按声明重算的权威值；patch 只改同 surface。
const handlers = new Map([[`${catalog.catalogId}:record`, (action) => [
  { version: 'v0.9', updateDataModel: { surfaceId: action.surfaceId, path: '/note',
    value: `已记录 ${String(action.context.score)}` } },
]]]);

// 3. 白名单：宿主按 surface 的 Catalog 给出精确可编辑路径；只读身份字段不开放。
const surfaceCatalog = new Map<string, string>();
const adapter = new AgentAdapter({
  registry: new CatalogRegistry([catalog]),
  actionHandlers: handlers,
  fallbackGeneration: (request) => myDeterministicFixture(request.surfaceId),
  onGenerationCommitted: (event) => void surfaceCatalog.set(event.surfaceId, event.catalogId),
  editablePaths: (surfaceId) =>
    surfaceCatalog.get(surfaceId) === catalog.catalogId ? ['/score'] : [],
});

// 4. 发布：列表取自 adapter 的固定执行声明，装配期核对 hash；浏览器用同一声明挂载 renderMap。
const router = createAgentRouter({
  adapter,
  catalogContracts: [adapter.describeCatalog(catalog.catalogId)!],
  runsAccess: (surfaceId, ctx) => myTrustedAccessCheck(surfaceId, ctx),
});
```

浏览器侧（`@nexus-ui/react` + renderMap）：控件只上报 `setInputValue(componentId, surfaceId, property, value)`，触发器只调 `triggerAction`；组装 action 请求时用 `extractLatestInputDrafts(surfaceId)` 取「最新输入 + 草稿代次」，成功 done 经本地完整性校验（响应头 runId、catalog/hash 与已加载契约一致）后再检查 `confirmInputDrafts(snapshot)` 返回 true；该步骤确认已发送且未再编辑的项，并恢复期间的新草稿为可见编辑值（serial 不变），不会修改服务端提交。返回 false 时不开放新基准。两个参考浏览器（`web/nexus-playground`、`examples/standalone-host-demo`）即此路径的可运行样例。

口径提醒：`GET /api/a2ui/surface-state` 查询返回某次运行的固定结果，**不是视图恢复**——旧视图不能借查询换 revision；成功 `done` 表示 UI 已提交，**不表示宿主业务事务成功**。

未注册 action 在进入 SSE 前返回 400，避免半流失败。每条消息下发前经过 `@nexus-ui/core` 结构校验和 Agent guard；生成流必须先 `createSurface`，后续只能更新同一 surface，且必须包含 `root`；action 响应只能 `updateComponents` / `updateDataModel`。失败输出或 history 提交失败都不会以 `done` 结束；提交失败会转换为 SSE `error`。

HTTP action 仅接收 `{ message, nexus }`：message 是 v0.9 action，nexus 必含 sessionVersion/actionId/surfaceRevision/catalogHash/inputs。旧格式显式拒绝；服务端不查询最新快照补基准，也不重建 actionId。成功 `done` data 为该次提交固定的 `NexusSurfaceCommit`，其 runId 与本次 SSE ID 前缀一致，供消费方关联其实际视图。失败或缺 done 的视图不能继续 action。

HTTP 与非 HTTP 使用同一传输无关的运行生命周期，非 HTTP 首次消费 source 或 commit 时预留记录容量，commit 验证结果结构及本次 run/surface/catalog/hash 后留存，返回独立的固定结果；成功 done 之前结果已可读。直接消费者必须在读取消息源后显式调用 commit，或 onError/dispose；正常 EOF 不释放 action 锁。输入模型先于 handler patch 发布并提交，handler 的同路径归一化值/根替换优先。自定义 `SurfaceActionStateStore` 需实现 revision + epoch 原子比较，commitGeneration/commitAction 返回本次提交的独立快照。

生成源工厂与 action handler 仅在消息源消费且容量准入成功后调用；它们抛错会使运行失败，HTTP 中通过 SSE error 返回。prepare 的准入错误仍发生在流前。容量拒绝/响应占用异常会释放运行、action 锁与宿主 dispose 资源，不遗留活动记录。

发布 Catalog 时自动与实际 adapter 的执行声明核对；首次发布/执行会固定该 Catalog 副本，之后修改外部 registry 不影响当前 adapter。更新固定声明需重建 adapter 与发布路由。onboarding 发布与消费共用完整 Catalog、版本、hash 与 prompt 一致性校验。verifier 完整消费响应流，以成功 done 固定结果为 action 基准；报告 actionContext 为实际交给 handler 的权威参数隔离副本。消费方完整关联门控已在两个参考浏览器实施（S2.6.3，2026-10-20：契约 hash/prompt/版本校验后挂载、响应头 runId 关联、请求代次保护、草稿确认）；完整调度/背压/commitState 归 S3，Session 归 S3/S4。

外部 Agent RPC 支持 endpoint、自定义 headers、timeout 和响应字节上限；不提供自动重试、远程凭证托管、租户隔离或审计。

## 配置

SDK 根入口不读取项目环境。请求边界由 router options 显式配置：

| router options         | 默认      | 说明                                                                  |
| ---------------------- | --------- | --------------------------------------------------------------------- |
| `maxRequestBodyBytes`  | `1048576` | JSON 请求体字节上限；超限 Content-Length 会先拒绝，流式字节也持续计数 |
| `requestBodyTimeoutMs` | `10000`   | JSON 请求体读取超时                                                   |
| `streamDelayMs`        | `200`     | 演示 pacing；生产装配应省略                                           |

通过 `new AgentAdapter({ registry, runManager, ... })` 注入自定义运行记录存储（实现 `AgentRunManager`，含 `recordCommit`）；router 可省略 runManager，显式提供时必须与 adapter 的同一实例一致；runs 查询的访问控制由 `runsAccess` 决定，`surfaceId` 不是凭据，认证主体必须来自宿主可信请求上下文。

## 命令

```bash
pnpm --filter @nexus-ui/server test
pnpm --filter @nexus-ui/server typecheck
pnpm --filter @nexus-ui/server build
```

参考服务（本地 3001 端口、playground 前端代理目标）的运行方式见 [examples/playground-server](../../examples/playground-server/README.md)；独立宿主与 LLM 外部 Agent 链路验证见 [examples/standalone-host-demo](../../examples/standalone-host-demo/README.md)。
