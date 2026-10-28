# @nexus-ui/server

Nexus UI server SDK：Agent 装配、准入 guard、SSE 传输与宿主显式注入契约。它通过 Agent Adapter 接宿主生成源、分发业务 action、校验 A2UI 输出，并通过 SSE 下发消息。参考服务（演示 Catalog、LLM/mock 生成源、本地 Koa 装配）在 [examples/playground-server](../../examples/playground-server/)。

## 源码结构

```text
src/
  index.ts          服务组合根：宿主装配 API（不启动 listener、不读取项目环境）
  api/              请求解析、client action 解析、路由与 SSE 响应流
  agent/            Agent Adapter、guard、catalog contract、RPC helper、history/run 实现、policy 类型
  runtime/          单一调度、运行句柄、候选校验、提交确认、预算与取消收敛
  transport/        SSE event 序列化与响应头
```

## 接口

- `GET /health`：健康检查；`agentMode`/`actionMode` 来自宿主显式配置，默认值不读取环境或模型 key。
- `POST /api/a2ui/generate`：接收 `{ message?, catalogId }`；`catalogId` 必填，缺失即 400，不回落默认 Catalog。
- `POST /api/a2ui/event`：仅接收 `{ message, nexus }`；message 为 v0.9 action，nexus 含 sessionVersion/actionId/surfaceRevision/catalogHash/inputs，流式返回同 surface 更新。
- `GET /api/a2ui/runs?surfaceId=`：运行记录查询；必须配置宿主 `access.read` 准入钩子（路由级 `access` 或 adapter 装配的 `access.read`），未配置一律 403（`RUNS_ACCESS_NOT_CONFIGURED`），拒绝为 403（`RUNS_ACCESS_DENIED`）。
- `GET /api/a2ui/surface-state?surfaceId=&runId=`：返回指定运行的固定 `NexusSurfaceCommit`；缺参 400，`access.read` 未配置/拒绝 403，记录缺失/错 surface/淘汰 404，尚无提交结果 409。仅查固定留存，不回退最新快照。

生成/action SSE 在占用响应时即携带 `X-Nexus-Run-Id`（公开常量 `NEXUS_RUN_ID_HEADER`），与成功 done.runId、运行记录 ID 和事件 ID 前缀同值。跨源读取需由宿主 CORS 配置暴露该头；查询必须使用裸 runId，不能解析事件 ID 猜测。原始 `sendMessages` 不提供运行标识头或固定提交结果。

SSE 事件（Session v1，SPEC §5.4；消费方按事件名分派）：

- `start`：运行身份与基准（sessionVersion/runId/surfaceId/catalogId/contractVersion/catalogHash；action 运行携带调度内实际快照的 `surfaceRevision`）。
- `message`：`data` 是一个已校验的 A2UI 消息，不掺任何运行元数据。
- `done`：data 直接承载本次固定 `NexusSurfaceCommit`，语义是 UI 提交成功；不代表宿主业务副作用的事务结果。
- `error`：运行失败终态，携带 runId/surfaceId/code（RUN_ADMISSION_REJECTED 等 Session 错误码枚举）/commitState（notCommitted|unknown）与截断的结构化 diagnostics；每次流恰一个终态，EOF 不是终态。

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

## S3 高层运行入口与访问准入（2026-10-27 已实施）

- `createAgentRuntime(options): AgentRuntime` 是传输无关的高层工厂：默认每实例独立 adapter/scheduler/记录所有者；显式共用 runManager 的入口复用同一 scheduler。`generate(request, options?)` / `action(request, options?)` 返回入队结果 `{ accepted: true, run } | { accepted: false, stage, code?, message }`；预期拒绝以结果报告，装配/编程错误（含 access 钩子抛错）仍抛出。`queryRun(surfaceId, runId)` / `listRuns(surfaceId)` 是可信宿主本地只读接口，不自行执行 read 钩子；对外查询须经带 `access.read` 的 router 或宿主等价授权。运行句柄暴露 `runId/surfaceId/kind`、`events()`、`result`、`cancel(reason?)` 与幂等 `dispose()`。非 Koa 消费不构造任何 HTTP 对象。
- **访问准入缺省拒绝**（SPEC §6.5）：`access: { read?, generate?, action? }`，签名 `(request, context?) => boolean | Promise<boolean>`。generate/action 在入队前评估，未配置即拒绝（HTTP 403 `GENERATE_ACCESS_NOT_CONFIGURED`/`GENERATE_ACCESS_DENIED`/`ACTION_ACCESS_NOT_CONFIGURED`/`ACTION_ACCESS_DENIED`）；`context` 由传输透传（HTTP 传 Koa Context），SDK 不解释其内容。查询路由的 read 钩子可配在 router `access` 或 adapter `access.read`（前者优先）。本地 demo 必须显式放行（参考服务即此口径）。
- **资源预算**：`budgets` 装配项（默认值见 SPEC §6.6 与 [共享预算表](../../fixtures/session-v1/budgets.json)）——每 surface 排队 32、活动/排队/隔离 surface 合计 512、每 run 2000 条/单条 1 MB/累计 8 MB；完整快照 8 MB/10000 组件，history 每 turn 8 MB/每 surface 16 MB。SSE 与 `events()` 均有 1 MiB 高水位和 30 s 慢消费期限，后者另限 32 条缓冲；非法值装配抛错。超限原子拒绝或结构化失败，不发布部分 UI；已确认提交后的传输/history 故障不改写提交。取消/执行超时发出 abort 并及时收敛句柄；宿主及源关闭尚未退出时隔离 surface，拒绝业务重叠，计入总容量。提交已在飞仍等待 store 确认。执行/排队超时默认不启用，生产宿主按任务设置。
- 迁移：`runsAccess` → `access: { read }`（S3.5）；`prepareGeneration/prepareAction` 保留为兼容外壳，内部委托同一调度；HTTP 全局队列与 adapter 私有锁已删除。完整迁移表见 SPEC §6.7。

非 HTTP 消费直接调用高层入口（下方 HTTP 样例中同样显式装配 Catalog/source/handler）：

```ts
const queued = await runtime.generate({ catalogId });
if (!queued.accepted) throw new Error(queued.message);
try {
  for await (const event of queued.run.events()) {
    // message 是候选预览，done.commit 才是本次固定 UI 提交；error 不代表业务失败。
    onSessionEvent(event);
  }
  const outcome = await queued.run.result;
  if (outcome.terminal === 'succeeded') saveBaseline(outcome.commit);
} finally {
  queued.run.dispose();
}
```

`events()` 只有一个活动迭代器；提前 `break` 只归还未读缓存以便接续，不取消运行，放弃消费时须 `cancel`/`dispose`。只需最终结果可直接 await `run.result`，调度任务自动校验并提交；不能把原始 source EOF 当作成功。只读同步 `subscribe` 用于观察，异步消费用 `events()`。本地可执行的公开入口夹具见 [public-entry.mjs](test/runtime/fixtures/public-entry.mjs)，使用普通 Node 加载本次 dist，不走源码或 tsx。

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
  // 示例显式放行；实际应用从 context 的可信宿主身份判断权限。
  access: { generate: () => true, action: () => true },
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
  access: { read: (surfaceId, ctx) => myTrustedAccessCheck(surfaceId, ctx) },
});
```

浏览器侧（`@nexus-ui/react` + renderMap）：控件只上报 `setInputValue(componentId, surfaceId, property, value)`，触发器只调 `triggerAction`；组装 action 请求时用 `extractLatestInputDrafts(surfaceId)` 取「最新输入 + 草稿代次」，成功 done 经本地完整性校验（响应头 runId、catalog/hash 与已加载契约一致）后再检查 `confirmInputDrafts(snapshot)` 返回 true；该步骤确认已发送且未再编辑的项，并恢复期间的新草稿为可见编辑值（serial 不变），不会修改服务端提交。返回 false 时不开放新基准。两个参考浏览器（`web/nexus-playground`、`examples/standalone-host-demo`）即此路径的可运行样例。

口径提醒：`GET /api/a2ui/surface-state` 查询返回某次运行的固定结果，**不是视图恢复**——旧视图不能借查询换 revision；成功 `done` 表示 UI 已提交，**不表示宿主业务事务成功**。

action 与生成的请求级校验（envelope、catalogId、access）在入队前返回 400/403/503；已接受运行的调度内失败经 SSE `error` 收场。每条消息下发前经过 `@nexus-ui/core` 结构校验和 Agent guard；生成流必须先 `createSurface`，后续只能更新同一 surface，且必须包含 `root`；action 响应只能 `updateComponents` / `updateDataModel`。提交前拒绝经 error 报告 notCommitted，store 确认丢失报告 unknown；已确认提交后的 history/hook 失败经 `onRunDiagnostic` 报告，仍保留 done 与提交事实。

HTTP action 仅接收 `{ message, nexus }`：message 是 v0.9 action，nexus 必含 sessionVersion/actionId/surfaceRevision/catalogHash/inputs。旧格式显式拒绝；服务端不查询最新快照补基准，也不重建 actionId。成功 `done` data 为该次提交固定的 `NexusSurfaceCommit`，其 runId 与本次 SSE ID 前缀一致，供消费方关联其实际视图。失败或缺 done 的视图不能继续 action。

HTTP 与非 HTTP 使用同一传输无关的运行生命周期。runtime/adapter 在入队时预留队列与记录容量，调度任务自动校验并提交；结果验证本次 run/surface/catalog/hash 后留存，成功 done 之前可读。宿主自行创建的原始 `AgentRun` 手动消费仍须显式 commit/onError/dispose，使用 `sendAgentRun` 时由运行模块托管；这与高层句柄的自动提交不同。输入模型先于 handler patch 发布并提交，handler 的同路径归一化值/根替换优先。自定义 `SurfaceActionStateStore` 需实现 revision + epoch 原子比较，返回 `SurfaceCommitResult`（committed 携带独立快照；确定未写为 notCommitted；无法确认则 unknown），普通异常按 unknown 处理。

生成源工厂与 action handler 仅在调度任务内、排队容量与记录预留成功后调用（同 surface 严格串行）；它们抛错使运行失败，HTTP 中以 SSE error 收场。准入与参数重算都在调度任务内完成。入队拒绝（access 未配置/拒绝 403、排队容量 503、请求级错误 400）发生在响应占用前，无 SSE 头、无运行记录；响应占用异常同步抛出并回收运行与宿主 dispose 资源，不遗留活动记录。

发布 Catalog 时自动与实际 adapter 的执行声明核对；首次发布/执行会固定该 Catalog 副本，之后修改外部 registry 不影响当前 adapter。更新固定声明需重建 adapter 与发布路由。onboarding 发布与消费共用完整 Catalog、版本、hash 与 prompt 一致性校验。verifier 完整消费响应流，以成功 done 固定结果为 action 基准；报告 actionContext 为实际交给 handler 的权威参数隔离副本。消费方完整关联门控已在两个参考浏览器实施（S2.6.3，2026-10-20：契约 hash/prompt/版本校验后挂载、响应头 runId 关联、请求代次保护、草稿确认）。单一调度、Session v1 事件、访问准入、有界背压与资源预算已随 S3 实施（2026-10-27）；完整 client 会话状态机与视图恢复归 S4。

外部 Agent RPC 支持 endpoint、自定义 headers、timeout 和响应字节上限；不提供自动重试、远程凭证托管、租户隔离或审计。

## 配置

SDK 根入口不读取项目环境。请求边界由 router options 显式配置：

| router options         | 默认      | 说明                                                                  |
| ---------------------- | --------- | --------------------------------------------------------------------- |
| `maxRequestBodyBytes`  | `1048576` | JSON 请求体字节上限；超限 Content-Length 会先拒绝，流式字节也持续计数 |
| `requestBodyTimeoutMs` | `10000`   | JSON 请求体读取超时                                                   |
| `streamDelayMs`        | `0`       | 演示用逐条间隔；真实背压由高水位/慢消费预算承担，生产装配应省略         |

通过 `new AgentAdapter({ registry, runManager, ... })` 注入自定义运行记录存储（实现 `AgentRunManager`，含 `recordCommit`）；router 可省略 runManager，显式提供时必须与 adapter 的同一实例一致；runs 查询的访问控制由 `access.read` 决定，`surfaceId` 不是凭据，认证主体必须来自宿主可信请求上下文。

## 命令

```bash
pnpm --filter @nexus-ui/server test
pnpm --filter @nexus-ui/server typecheck
pnpm --filter @nexus-ui/server build
```

参考服务（本地 3001 端口、playground 前端代理目标）的运行方式见 [examples/playground-server](../../examples/playground-server/README.md)；独立宿主与 LLM 外部 Agent 链路验证见 [examples/standalone-host-demo](../../examples/standalone-host-demo/README.md)。
