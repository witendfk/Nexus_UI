# Agent Line MVP Scope

本文档是第一条 Agent 线的事实边界。协议本身以 [specification/v0_9](../specification/v0_9/README.md) 为准；本文档只描述 Nexus UI 当前实现范围。

协议层、Catalog 能力层和宿主策略层的命名口径见 [architecture-boundary.md](architecture-boundary.md)。

宿主接入契约、HTTP/SSE 参考协议和完整支持矩阵见 [host-integration.md](host-integration.md)；最小复制路径见 [host-quickstart.md](host-quickstart.md)。

## 目标

先交付一条可靠闭环：

```text
自然语言输入
  -> LLM/mock 生成 A2UI JSONL
  -> 服务端结构与生命周期校验
  -> SSE 流式下发
  -> core 渐进解析
  -> React 渐进渲染
  -> 用户 action
  -> 官方 client-to-server 消息回传
  -> 业务 action handler 更新同一 surface
  -> UI 原地更新
```

## Catalog 边界

协议事实源是 `specification/v0_9`。A2UI v0.9 官方 Basic Catalog 定义 18 个组件：

```text
Text, Image, Icon, Video, AudioPlayer,
Row, Column, List, Card, Tabs, Modal, Divider,
Button, TextField, CheckBox, ChoicePicker, Slider, DateTimeInput
```

当前 playground 默认边界是 **Nexus Basic Task Profile**，不是官方 Basic Catalog 完整一致性实现。该 Profile 选用其中 17 个 Basic-like 组件名：

```text
Text, TextField, CheckBox, ChoicePicker, DateTimeInput, Slider, Button, Column, Row, List, Tabs, Image, Video, AudioPlayer, Card, Icon, Divider
```

这不是 A2UI 协议上限，也不表示这些组件的全部官方字段和渲染行为都已实现。服务端通过 `CatalogRegistry` 查询组件边界；generate 请求默认使用 Nexus Basic Task Profile，也可显式选择已注册的 task 或 Workbench catalog。

P14-b-a 起使用三个身份：官方 Basic Catalog ID 保持 `https://a2ui.org/specification/v0_9/basic_catalog.json`，但不被 Nexus 注册；默认 Profile 使用 `https://example.com/catalogs/nexus-basic-task/v1`；P14-b 前的错误 URL `https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json` 仅作为历史 surface 的兼容别名，会在 adapter 内归一化为默认 Profile。需要扩展字段的宿主应继续使用自己的 Catalog ID。

M6 已提供 registry 架构和端到端 task 样例：core 可注册多个 `catalogId`，server 可按请求选择 catalog 并约束 LLM 输出，React 可按 surface 选择对应 renderMap。自定义组件必须由宿主显式提供渲染函数；P6-a 起，registry 还可为自定义组件注册 props schema，runtime 与 server guard 会统一执行组件名和 props 契约校验。P7-a 起，宿主还可在 `CatalogDefinition.actions` 中声明 action 白名单；这是 Nexus 的宿主边界扩展，不是新增 A2UI wire 字段，core runtime 与 server guard 都会在声明存在时拒绝未声明的组件 action。

task catalog 是 `TaskSummary`、`TaskButton` 两个组件的最小接入样例，用于证明设计系统可以按 A2UI Catalog 边界接入，不代表所有自定义组件都能自动渲染。

Workbench catalog 是企业跟进任务样例，只允许 `CustomerSummary`、`Text`、`TextField`、`ChoicePicker`、`DateTimeInput`、`Button`、`Column`、`Row`、`Divider`，且只开放 `submit` action。`CustomerSummary` 的展示字段必须绑定 dataModel path；生成流必须形成 `CustomerSummary -> TextField(/taskTitle) -> ChoicePicker(/priority) -> DateTimeInput(/reminderAt) -> submit Button -> submitResult` 闭环，submit context 必须携带任务标题、优先级、ISO 8601 提醒时间、客户 ID 和客户名。

当前 `WorkbenchTaskStore` 是进程内模拟 CRM。真实宿主应替换为 CRM / OA 调用，并补充权限、审计、幂等和租户隔离。

## Agent Adapter 边界

server 内置 Agent Adapter，用来隔离 HTTP 传输与 Agent 实现：

- 生成链路负责创建 `surfaceId`、解析已注册 catalog、选择宿主注入生成源 / LLM / fallback 输出；宿主 source 与 LLM 成功后会记录 surface catalog 和 history。
- action 链路按 `catalogId + action.name` 查找业务 action handler；action 白名单优先来自 `CatalogDefinition.actions`，未显式声明的旧定义保持内置 Basic 兼容边界。当前内置 Basic `call / search / submit`、Task `start / complete` 与 Workbench `submit`。
- 业务 handler 可以返回同步或异步 A2UI 消息源，并接收同 surface 的 catalog、action 白名单与成功生成 history 只读上下文；输出仍必须通过同一个结构和生命周期 guard。
- 未注册 catalog 或未注册 action 在进入 SSE 前返回 400；Agent 输出失败则通过 SSE `error` 返回。
- `historyStore` 可注入且支持异步读取 / 提交：默认内存实现保留最近 64 个 surface、每 surface 最近 20 条 turn；显式配置 `NEXUS_HISTORY_FILE` 时可使用本地文件适配器，重启后恢复 catalog 与 turn。catalog 与 turn 通过一次 `commitGeneration` 提交，生成源与 action handler 只接收拷贝后的只读 history。

P5-b 提供最小外部 Agent JSONL RPC helper：生成和 action 共用 `version: 1` 请求契约，远端返回候选 A2UI JSONL；超时、响应大小、HTTP 状态、Content-Type、JSONL 解析和空输出均有本地错误边界。RPC 输出没有独立放行通道，仍必须通过同一个 Agent guard。自动重试、远程凭证托管、权限、租户、审计和持久化 RPC 日志不属于当前版本。

## 支持范围

- 单个 active rendered surface；core store 可保存多个 surface，但 React Provider 只展示一个。
- 静态 `child` / `children` 引用。
- Nexus Basic Task Profile `List` 的静态列表布局：`direction` / `align`。
- Nexus Basic Task Profile `Tabs` 的静态 `tabs` 定义、动态 `title` 和本地激活切换。
- Nexus Basic Task Profile `Image` 的 `url` 展示与 `description` 可访问文本。
- Nexus Basic Task Profile `Video` 的 `url` 原生播放器展示；不开放 HTML 风格控制字段或 action。
- Nexus Basic Task Profile `AudioPlayer` 的 `url` 原生音频展示与 `description` 说明文本；不开放 HTML 风格控制字段或 action。
- Nexus Basic Task Profile `TextField` 的 `shortText / longText / number / obscured` 输入、`label`、`value: { path }` 双向绑定。
- Nexus Basic Task Profile `TextField.validationRegexp` 的本地格式校验反馈。
- Nexus Basic Task Profile `CheckBox` 的 `label` 与布尔 `value: { path }` 双向绑定。
- Nexus Basic Task Profile `ChoicePicker` 的单选 / 多选、`checkbox / chips` 展示、选项筛选和 `string[]` 形式 `value: { path }` 双向绑定。
- Nexus Basic Task Profile `DateTimeInput` 的 date / time / date-time 输入、`min` / `max` 和 ISO 8601 字符串形式的 `value: { path }` 双向绑定。
- Nexus Basic Task Profile `Slider` 的有限数字 `min` / `max` 范围和数字 `value: { path }` 双向绑定；`min` 缺省为 `0`，且必须小于 `max`。
- Nexus Basic Task Profile 最小 `checks`：仅 `TextField` / `Slider` / `Button` 支持 `required`、`regex`、`length`、`numeric`、`email`；输入组件展示第一条协议错误文案，Button checks 失败时禁用按钮并由 core 阻断 action。
- Nexus Basic Task Profile `search` action：Button 读取 TextField 绑定值并原地更新 `searchResult`。
- Nexus Basic Task Profile `submit` action：Button 同时读取 TextField 与 CheckBox 绑定值并原地更新 `submitResult`。
- `{ path }` 数据绑定。
- `action.event`。
- Task catalog 的进程内业务状态样例：`pending -> active -> completed`。
- Workbench catalog 的企业跟进任务样例：客户摘要、任务标题、任务优先级、提醒时间、submit 创建任务、结果原地更新和重复提交拒绝。
- 请求级 `catalogId` 选择与 task catalog 自定义 renderMap。
- 宿主进程内注入自定义 generation source；其输出必须经过同一 Agent guard。
- 外部业务 Agent 的最小 HTTP JSONL RPC helper，可接入初始生成与 action 响应；宿主也可把 action 留在本地业务 handler，输出仍必须经过同一 Agent guard。
- `createCatalogPromptContract(catalog)`：从宿主 CatalogDefinition 生成外部 Agent 可选使用的 A2UI NDJSON、组件、action、schema 与动态绑定提示词；宿主可通过 `catalogContracts` 显式发布只读 HTTP 契约。生成的 prompt 不是放行边界，输出仍必须经过统一 guard。
- `examples/standalone-host-demo`：仓库内可运行的三进程独立宿主 Demo。外部 Demo Agent 默认真实调用 OpenAI-compatible LLM，生成与 action 输出仍必须通过同一 guard；自定义 catalog、React renderMap、Koa generate / event 装配、本地 action handler 与测试都归属根部 examples，不放入 server 子包。
- SSE `message` / `error` / `done`。
- 参考 server 请求入口要求 JSON Content-Type，限制请求体字节数并设置读取超时；默认 1 MiB / 10s，可显式配置。
- 服务端按 surface 保存成功 LLM / 宿主 source 生成流的内存 history。
- 宿主可替换 surface history 存储；当前提供异步与原子提交边界、进程内默认实现、可选本地单进程文件持久化和“commit 成功后才 `done`”的 SSE 语义，不包含数据库、多实例或租户持久化。
- Catalog 诊断以结构化 `{ path, message, dataPath? }` 从 core runtime、React Provider `onError` 和 SSE `error` payload 上浮；宿主可直接定位组件 props 或 dataModel 来源。
- `@nexus-ui/core` 与 `@nexus-ui/react` 只承诺根入口 API；React 提供当前 core 范围的兼容诊断。server 根入口只承诺有限宿主装配 API（`SERVER_API_VERSION = 1`），完整参考 server 不是生产 SDK。

P8-a 已完成。`examples/standalone-host-demo` 的外部 Agent 默认调用真实 LLM，初始生成和 `approve` action 均返回候选 A2UI JSONL 并通过统一 guard。真实 HTTP 验收记录生成流与 action 流均以 `done` 结束且 `surfaceId` 不变；真实浏览器验收记录页面生成审批卡、点击后按钮禁用、显示 `action: approve`、同一 DOM surface 原地 patch，且无 pageerror / console error。浏览器装配层已修复重复创建 catalog registry 导致 action 后 runtime 重建的问题，并有 React DOM 回归测试锁定：action 触发宿主重渲染后，runtime 继续复用原 surface，action 请求携带原 `surfaceId`，同一 `section` 原地更新且按钮禁用。测试模式使用确定性输出或 mocked SSE，不读取 `.env` 或请求模型。

P9-a 已完成。`docs/host-quickstart.md` 将 standalone demo 收敛为外部宿主最小接入模板，说明 catalog / renderMap / action handler / external endpoint 的替换点，以及正常输出和坏输出的验收口径。standalone demo 的真实 HTTP 回归测试证明：endpoint 替换后，Agent 收到的请求仍包含完整 catalog、action、surface 与 history 边界；非法 JSONL 会被宿主转换为 SSE `error`，且没有 `done`。

P9-b 已完成。standalone demo 的进程编排现在理解 `NEXUS_DEMO_AGENT_ENDPOINT`：未配置时启动内置 Agent、host 和 web；显式配置外部 endpoint 时跳过内置 Agent，只启动 host 和 web。子进程意外退出会关闭整组服务，编排行为由测试锁定。同时修复 `NEXUS_DEMO_AGENT_MODE` 未传入 Agent 进程的问题，`deterministic` 与非法模式均有测试覆盖。

P10-a 已完成。server 根入口成为有限宿主装配 API，导出 Agent Adapter、external JSONL RPC helpers、内存 history、guarded router 和 `sendAgentRun` transport seam，并用 `SERVER_API_VERSION = 1` 标记。可执行参考服务移至 `src/main.ts`；standalone demo 已移除 server 内部源码路径引用，只依赖根入口。导出面快照测试同时锁定“import API 不启动参考 listener”。

P10-b 已完成。standalone host 模板提供 `actionHandler` 注入点：默认 action 回传外部 Agent，传入本地 handler 时初始生成仍走 external JSONL RPC，action 在宿主进程内返回候选 A2UI JSONL。回归测试使用自定义 catalog 与 React renderMap，验证外部 Agent 只收到一次 generate 请求、本地 action 更新保持同一 `surfaceId`、按钮禁用并以 `done` 结束，且本地输出没有绕过统一 guard。

P10-c 已完成。standalone demo 支持通过 `NEXUS_DEMO_ACTION_MODE=external | local` 切换 action 策略：`external` 保持 action 回传外部 Agent，`local` 保持初始生成走 external Agent RPC 但 action 由宿主本地 handler 处理。宿主 `/health` 返回 `agentMode: "external-rpc"` 与 `actionMode`；浏览器页面显示当前 action 策略。策略解析、health 契约和 local 模式浏览器回归均有测试。

P10-d 已完成。MVP 产品收口将当前边界固定为：单 active surface、Basic Catalog 14 组件子集、task / Workbench 自定义 Catalog、外部 Agent JSONL RPC、可切换 action 归属、统一 guard 和同 surface 原地更新。README 首屏、产品定位、当前能力基线和面试演示路径已同步；剩余 Basic 组件、完整 schema、跨字段校验、多 surface 和生产部署能力都不属于当前 MVP。后续扩展必须先说明落地工作流和验收闭环，不做组件数量扩张。

P11-a 已完成。Basic Catalog `Slider` 覆盖 core 字段与范围校验、React 原生 range 渲染、数字 `value: { path }` 写回和 Button action 最新数值解析；server Basic Catalog 强制 `value: { path }`，只允许 `id/component/label/min/max/value`，并拒绝非法范围、`checks` 和挂载 action。LLM prompt 明确 `min` 缺省为 `0`，禁止 `minValue/maxValue`。core / React / server 测试通过；全仓 format / typecheck / lint / build / test 已于 2026-09-24 通过，自动化测试不读取 `.env`、不消耗真实 LLM 请求。

P11-b 已完成。Basic Catalog 支持官方 `CheckRule` 最小子集：`TextField` / `Slider` / `Button` 可使用 `required`、`regex`、`length`、`numeric`、`email`；core 校验官方 `{ condition, message }` 形状并按当前 dataModel 派生 `VNode.validation`，React 展示第一条失败文案，Button 失败 checks 禁用按钮且 core 在 `triggerAction` 出口二次阻断。server guard 只对 Basic Catalog 放行这 5 个函数，限制规则数量、文案和正则长度，LLM prompt 明确动作按钮需要重复阻断条件；Workbench 与通用 FunctionCall 仍不支持。core / React / server 测试覆盖协议结构、求值、DOM 恢复、action 阻断、guard 与 prompt 契约；全仓 format / typecheck / lint / build / test 已于 2026-09-24 通过，自动化测试不读取 `.env`、不消耗真实 LLM 请求。

P12-a 已完成。core 提供 `createCatalogPromptContract(catalog)`，输入宿主 `CatalogDefinition`，先复用 Catalog 注册校验，再输出确定的 A2UI v0.9 NDJSON 生命周期、组件 / action 白名单、props schema、dynamic binding 规则和“guard 是最终边界”提示词。外部 Agent 不强制使用这段 prompt；它只是把宿主契约注入 Agent system prompt 的可选工具。standalone demo 的外部 LLM Agent 已改为与宿主共用同一份纯 CatalogDefinition 生成 system prompt。当前生成器只描述 Nexus 已支持的 JSON-Schema-like 子集；没有 schema 的组件仍需宿主在业务 prompt 中补充组件字段语义，且不承诺完整标准 JSON Schema。core / standalone demo 测试与全仓 format / typecheck / lint / build / test 已于 2026-09-24 通过，自动化测试不读取 `.env`、不消耗真实 LLM 请求。

P12-a 真实请求验收：standalone Demo Agent 使用生成后的 system prompt 完成 initial generation 与 `approve` action 两次真实模型调用。生成流返回正确的 surface、组件、动态绑定、action context 和金额；action 流保持同一 `surfaceId`，禁用按钮并更新审批结果。

P12-b 已完成。server 装配 API 支持宿主显式传入 `catalogContracts`，guarded router 随之提供 `GET /api/a2ui/catalog-contract?catalogId=...`。响应包含 `serverApiVersion: 1`、原始 CatalogDefinition 和确定性 promptContract；缺失 ID 返回 400，未显式发布返回 404，重复发布在装配期失败。Catalog 注册只是 guard 边界，不等于对外公开契约。standalone demo 的宿主与浏览器均通过同一份 `standaloneHostCatalog` 验收该只读发布路径；自动化测试不读取 `.env` 或消耗模型请求。

P13-a 已完成。Basic Catalog `Video` 只允许 `id/component/url`，`AudioPlayer` 只允许 `id/component/url/description`；两者均可使用字符串或 `{ path }` 绑定。React 使用原生 video / audio 播放器渲染，控制能力留在宿主渲染层，Agent 不能输出 HTML 风格 `src`、`controls`、children 或 action。server prompt 要求原样复制用户提供的媒体 URL，流式 guard 在明确视频 / 音频请求时强制对应组件存在，普通未知 URL 不做类型猜测。自动化测试覆盖 core 协议结构、React DOM、公开导出、prompt 契约和流式防回退边界。

P14-a 已完成。core 拆分 `validateProtocolMessage`（官方 A2UI v0.9 结构）和 `validateNexusProfileMessage`（当前 Nexus Runtime Profile），旧入口 `validateA2UIMessage` 保持兼容并串联两者。runtime、参考 server stream guard 和诊断错误现在携带 `PROTOCOL_INVALID` / `LIFECYCLE_INVALID` / `CATALOG_UNSUPPORTED` / `FEATURE_UNSUPPORTED` 边界代码。官方 Basic Catalog 33 个示例矩阵锁定为“全部协议合法、当前 Profile 不声明完整支持”。下一步是 P14-b：收口 catalog 身份并把组件字段规则从 server guard 迁到 Catalog 契约。

P14-b-a 已完成。默认 playground catalog 更名为 Nexus Basic Task Profile，canonical ID 为 `https://example.com/catalogs/nexus-basic-task/v1`；历史错误 URL 仅在 generation/action 入口归一化；官方 Basic Catalog ID 显式拒绝注册，防止把受限 Profile 冒充官方完整 Catalog。adapter 测试覆盖默认 ID、legacy 归一化、官方 ID 拒绝和历史 action 分发。组件字段契约迁移到 Catalog Contract 属于下一步 P14-b-b。

P14-b-b 已完成。core `CatalogDefinition` 新增 `componentPolicies`，可声明字段允许范围、`{ path }` 绑定策略、action 挂载、checks 白名单 / 上限和字段来源；`Button.disabled` 明确标记为 Nexus extension。Nexus Basic 与 Workbench catalog 已迁移到该契约，server guard 移除了手写 Basic 字段、媒体字段、选项结构和 checks 规则；URL 安全策略、Slider / DateTime 跨字段语义和 Workbench 工作流闭环仍保留在 policy layer。Catalog Prompt Contract 会输出同一份 capability policy。

P14-c-a 已完成。server 新增独立 policy layer：`component-policy` 承接跨字段组件语义，`media-policy` 承接媒体意图分类和 URL 不入 `Text` 的安全规则，`workflow-policy` 承接搜索、订阅表单和 Workbench 精确闭环。`agent-guard` 保留协议 / Profile / Catalog / 生命周期编排职责；行为和错误契约保持不变，server 测试新增 policy layer 单元验收。

P14-c-b 已完成。`AgentAdapterOptions.policy` 和 `AgentSequenceOptions.policy` 支持宿主注入 `AgentPolicy`；宿主可覆盖组件语义、literal/dynamic 媒体策略、必需媒体分类和 final workflow，未覆盖的 hook 回落到 `nexusAgentPolicy`。server 公开 API 暴露 policy 类型和 `resolveAgentPolicy`，stream guard 通过 resolved policy 执行；默认行为保持不变，新增 partial override、sequence 注入和公开导出面测试。

P15-a 已完成。standalone 最小宿主模板暴露 `policy` 注入点，Catalog Contract 增加 `componentPolicies` 示例：`ApprovalSummary` 标记为宿主扩展并强制 title / amount 路径绑定，`Button.disabled` 标记为宿主扩展，`Button.child` 标记为 ComponentId。catalog prompt 会向外部 Agent 声明这些能力边界；standalone host policy 测试证明注入策略可以在 SSE 前拒绝远端候选输出。Host Quickstart 同步更新为 P15-a。

P15-b 已完成。host policy 拒绝现在携带 `POLICY_REJECTED` 边界码；detailed guard issue 和 SSE `error.boundaryCode` 都会暴露该码，覆盖组件策略、媒体策略、必需媒体缺失和 final workflow。旧 `validateAgentSequence` / `validateAgentStreamFinal` 字符串入口保持兼容；server 新增 detailed 路径供 SSE 和宿主遥测使用。

P15-c 已完成。standalone demo 新增 `verify` 命令和 `verifyExternalAgentIntegration` API：给定真实外部 Agent endpoint 时，自动启动临时 host，验收 NDJSON 生成流、默认 / 注入 host policy、`POLICY_REJECTED` 边界码、runtime action context、action 回流、同一 `surfaceId`、不新增 create、`root` 稳定 patch。API 级验收器使用本地 fixture 测试锁定；浏览器 patch 仍由 React DOM 测试覆盖。

P16-a 已完成。`verifyExternalAgentIntegration` 提升为 `@nexus-ui/server` 公开 API，不再绑定 standalone demo catalog。宿主可传入自己的 `CatalogDefinition`、`AgentPolicy`、外部 RPC 配置、任务请求和 `actionSelector`。verifier 生成结构化 report，覆盖 generation / action 消息数、action 组件、组件 ID 变化和 `POLICY_REJECTED` 探针；server 测试使用独立 fake JSONL Agent 锁定全流程。

## 明确不支持

- 官方 Basic Catalog `Modal` 和完整官方字段 / 渲染语义一致性。
- `checks` 的 `and/or/not`、自定义函数、跨字段校验与 Workbench `checks`。
- 通用 FunctionCall、`action.functionCall`、`sendDataModel`。
- ChildList template 与相对路径作用域。
- 多 surface 并发展示。
- WebSocket、A2A、MCP 等其他传输。
- 持久化会话、权限、审计、租户隔离与真实 CRM / OA 集成。

遇到不支持但结构合法的消息时，由服务端 guard 拒绝，不交给前端渲染；直接进入 core 的坏消息会记录错误并丢弃，不中断后续流。

P14-a 已引入 `PROTOCOL_INVALID`、`LIFECYCLE_INVALID`、`CATALOG_UNSUPPORTED` 和 `FEATURE_UNSUPPORTED`；`POLICY_REJECTED` 将随 server guard 迁移补充，避免把“A2UI 不允许”和“Nexus 当前不支持”混在一个错误文案里。

## Surface 生命周期

1. 生成流第一条必须是 `createSurface`。
2. 后续消息只能 `updateComponents` / `updateDataModel`。
3. 所有消息必须使用同一个 `surfaceId`。
4. 生成流必须至少在一个 `updateComponents` 中包含 `id=root`。
5. action 响应不能 `createSurface` / `deleteSurface`。
6. 组件按 id 覆盖，后续更新保持稳定 id 以实现原地 patch。

## Action 信封

core 输出的 `ActionEvent` 是框架无关事件。web 适配层回传服务端前包装为 v0.9 client-to-server 消息：

```json
{
  "version": "v0.9",
  "action": {
    "name": "refresh",
    "surfaceId": "surface-xxx",
    "sourceComponentId": "refreshButton",
    "timestamp": "2026-09-14T00:00:00.000Z",
    "context": {}
  }
}
```

timestamp 和外层信封属于 web/server 适配层，不进入 core。

## 验收矩阵

| 验收项 | 通过标准 |
|---|---|
| LLM 模式 | `/health` 返回 `agentMode: "llm"` |
| 初始生成 | 生成非 mock UI，并以 `done` 结束 |
| 协议顺序 | 先 create，后 update，同 surface |
| Root | 至少一个 update 包含 `id=root` |
| Action | 点击后同一个 `surfaceId` 收到 action |
| 原地更新 | 不重建卡片，只 patch 组件或数据 |
| 输入绑定 | TextField 输入写回 dataModel，action context 携带最新值 |
| 布尔绑定 | CheckBox 切换写回 dataModel，submit context 携带最新布尔值 |
| 选项绑定 | ChoicePicker 选择写回 dataModel，Workbench submit context 携带唯一优先级 |
| 时间绑定 | DateTimeInput 输入写回 dataModel，Workbench submit context 携带 ISO 8601 提醒时间 |
| 数值绑定 | Slider 输入写回 dataModel，Button action context 携带最新有限数字 |
| 输入校验 | validationRegexp 失焦后显示错误，修正后错误清除 |
| 非法 JSON | SSE `error`，无 `done` |
| 多 payload | 服务端拒绝 |
| 不支持组件 | 服务端拒绝 |
| Catalog props 错误 | SSE `error.diagnostics[]` 包含 `path` / `message` / 可选 `dataPath`，且无 `done` |
| 自定义 Catalog | 只允许请求已注册 catalog；task 流不能混入 Basic 组件 |
| Workbench 闭环 | 客户摘要、任务输入、优先级、提醒时间、submit、结果位和客户 context 必须从 root 可达 |
| 缺 root | 服务端拒绝 |
| action create/delete | 服务端拒绝 |

## 验收记录

M5 已完成。真实 LLM 手工与接口级验收通过；测试环境不会加载仓库 `.env`，mock route 测试不会读取开发者 key 或请求真实模型；全仓 `test / typecheck / lint / build` 已于 2026-09-15 通过。

M6-a 已完成。Catalog Registry 架构、React catalog-specific renderMap 和 server registry-backed guard 的单元 / 集成测试通过；全仓质量门禁已通过。端到端自定义 Catalog 验收待 M6-b 完成。

M6-b 已完成。task catalog 覆盖注册、请求级选择、LLM 组件边界、fallback 生成、React 渲染、action 回流、同 surface 原地更新和 Basic 组件混入拒绝；全仓质量门禁已通过。

M7-a 已完成。Agent Adapter 覆盖生成源选择、surfaceId、catalog 边界、surface history 提交、业务 action 分发和未注册 action 拒绝；全仓质量门禁已于 2026-09-16 通过。

M7-b 已完成。task catalog 覆盖进程内业务状态、`start / complete` 闭环、同 surface 原地更新、非法状态迁移拒绝和 action 名称边界；全仓质量门禁已于 2026-09-16 通过。

M8-a 已完成。Basic Catalog `List` 覆盖静态 children、`direction` / `align` 和 `{ path }` 绑定；ChildList template 仍被拒绝。全仓质量门禁与真实 LLM 请求已于 2026-09-16 通过。

M8-b 已完成。Basic Catalog `Tabs` 覆盖非空静态 `tabs`、动态 `title`、静态 `child` 引用、结构校验、树构建和 React 本地切换；真实 LLM 输出保持在 Basic Catalog 边界内。全仓质量门禁与真实 LLM 请求已于 2026-09-16 通过。

M8-c 已完成。Basic Catalog `Image` 强制使用协议字段 `url` / `description` 并校验 `fit` / `variant`，头像输出使用 `variant: "avatar"` 与 `fit: "cover"`；server guard 拒绝 HTML 风格 `src` / `alt`、URL 直接或经 dataModel 动态绑定写入 `Text`，以及请求包含图片 URL 但漏生成 `Image`。React 将 `description` 渲染为 `alt` 并以 `no-referrer` 加载远程图片。同类联系人卡片真实 LLM 请求已输出可渲染头像 URL。

M9-a 已完成。Basic Catalog 按官方契约开放 `TextField.shortText`：core 校验 `label` / `value` / `variant` 并提供受控写回 seam，React 输入写回 dataModel，Button action 从同一 path 解析最新值。server prompt 与 guard 强制搜索 UI 生成 `TextField -> search Button -> searchResult` 闭环；真实 LLM 页面输入 `A2UI Runtime` 后收到 `搜索：A2UI Runtime` 原地更新，状态为 `done`，浏览器无 error / warning。全仓质量门禁与真实请求已于 2026-09-17 通过。

M9-b 已完成。Basic Catalog `TextField` 官方变体全部开放：React 渲染 `shortText` 单行输入、`longText` 多行输入、`number` 数字输入和 `obscured` 密码输入；`validationRegexp` 在失焦后触发本地格式反馈，修正输入后错误清除。server 只允许显式提供的合法正则并限制长度，非法正则与未授权字段在进入 SSE 前被拒绝。真实 LLM 请求已输出四类变体与 `"validationRegexp":"^[A-Z0-9]{6}$"`，页面验收和浏览器 error / warning 检查通过。

M10 已完成。Basic Catalog `CheckBox` 按官方契约接入：core 校验 `label` 与布尔动态 `value`，React 渲染原生 checkbox 并把切换结果写回 dataModel；server guard 只允许 `id/component/label/value` 且强制 `value: { path }`。表单请求最终流必须形成 `TextField + CheckBox -> submit Button -> submitResult`，context 同时绑定文本与布尔输入，且关键组件必须从 `root` 渲染树可达。真实 LLM 页面输入 `A2UI Runtime` 并勾选后提交，同一 surface 原地更新为 `已提交：name=A2UI Runtime，subscribed=true`，生成与 action 状态均为 `done`，浏览器 error / warning 为空。全仓质量门禁与真实请求已于 2026-09-18 通过。

P2 已完成。Workbench catalog 覆盖请求级选择、LLM prompt 契约、fallback、`CustomerSummary` 字段白名单、跨 catalog 组件拒绝、submit context 绑定、进程内任务创建、结果原地 patch、按钮禁用和重复提交拒绝。真实 LLM 请求输出完整 `createSurface -> updateComponents -> updateDataModel -> done` 流；页面输入“发送方案修订版”并勾选提醒后，同一 surface 更新为 `任务已创建：followup-0002 · 发送方案修订版 · 已设置提醒`，按钮禁用，生成与 action 状态均为 `done`，浏览器 error / warning 为空。全仓质量门禁已于 2026-09-18 通过。

P3 已完成。Basic `ChoicePicker` 覆盖官方单选 / 多选、`checkbox / chips`、选项筛选、选项结构校验、`string[]` 双向绑定和禁止挂载 action；Workbench guard 强制 `priority` 从 root 可达、绑定 `/priority`、使用 `high / normal / low` 单选，并随 submit context 返回业务 handler。真实 LLM 页面选择“高”并提交后，同一 surface 更新为 `任务已创建：followup-0003 · 发送方案修订版 · 优先级：高 · 已设置提醒`，按钮禁用，生成与 action 状态均为 `done`，浏览器 error / warning 为空。

P4 已完成。Basic `DateTimeInput` 覆盖 date / time / date-time、ISO 8601 字面量、`min` / `max`、字符串 path 双向绑定和禁止挂载 action；Workbench guard 强制 `reminderAt` 同时启用日期和时间、绑定 `/reminderAt` 并随 submit context 返回业务 handler。真实 LLM 根据当前日期把“明天 10:00”预填为 `2026-09-20T10:00:00`；页面确认时间并提交后，同一 surface 更新为包含 `followup-*`、`优先级：高` 和 `提醒时间：2026-09-20T10:00:00` 的结果，按钮禁用，生成与 action 状态均为 `done`，浏览器 error / warning 为空。全仓质量门禁已于 2026-09-19 通过。

P5-a 已完成。宿主可在进程内注入 generation source，并接收 `surfaceId`、用户请求、catalog、组件白名单和 action 白名单；自定义 action handler 可读取同 surface 的 catalog 与成功生成 history。合法自定义输出通过完整 SSE 传输并提交 history；非法 catalog 输出以 SSE `error` 结束、没有 `done`、不提交 history。远程 Agent RPC、认证、租户隔离和持久化 history 仍不属于本步。

P5-b 已完成。外部 Agent RPC 通过真实本地 HTTP 服务验收：请求携带 `version/kind/surfaceId/catalogId/supportedComponents/supportedActions/history`，action 请求还携带已解析的 action；响应为跨 chunk 的 JSONL。生成与 action 均完成同 surface 原地更新，非 2xx 错误契约和超时中断通过测试。所有 RPC 输出仍走统一 Agent guard，失败流没有 `done`，失败生成不提交 history。

P5-c-1 已完成。surface history 改为 `SurfaceHistoryStore` 可注入边界，`InMemorySurfaceHistoryStore` 默认保留最近 64 个 surface、每 surface 最近 20 条 turn；只登记 catalog 的 fallback surface 也参与容量淘汰。生成源与 action handler 收到拷贝后的只读 history。注入隔离、容量淘汰和 action 上下文读取通过测试；数据库持久化、异步写入、租户隔离与审计仍不属于本步。

P5-c-2 已完成。`SurfaceHistoryStore` 改为异步接口，catalog 与 turn 合并为一次 `commitGeneration` 提交，宿主数据库适配器可用事务实现。`prepareGeneration` / `prepareAction` 等待 history 读取；完整 A2UI 流通过最终 guard 后先执行 commit，成功才发送 SSE `done`，提交失败发送 `error` 且没有 `done`。异步提交成功顺序与提交失败路径均有测试；数据库适配器、租户隔离与审计仍不属于本步。

P5-c-3 已完成。新增 `FileSurfaceHistoryStore` 本地单进程持久化适配器：启动时加载文件，commit 串行执行并通过同目录临时文件加 `rename` 原子落盘；写入成功后才替换内存快照，写入失败保持上一次状态。默认仍为内存模式，只有 server 配置 `NEXUS_HISTORY_FILE` 才写磁盘。新 store 实例读取同一文件可模拟重启，并恢复 action 分发所需 catalog 和 history；容量淘汰、非法文件与写入失败边界均有测试。多实例协调、数据库、租户隔离和审计仍不属于本步。

P5-d 已完成。core 和 React 公开 API 从“实际导出”收紧为“显式承诺的根入口”：core 移除协议模块通配导出并标记 `CORE_API_VERSION = 1`；React 导出全部 14 个标准组件并提供 `getReactCoreCompatibility()`，当前支持 core `0.1.x` / API `1` / A2UI `v0.9`。两个包的运行时导出面都有快照测试，文档明确内部路径不可依赖；server 的公开承诺后续进一步收敛为有限宿主装配 API。协议版本、包版本和 API 版本的边界已固定到 `docs/public-api.md`。

P5-e 已完成。`packages/nexus-react/examples/minimal-host.tsx` 提供可执行的最小宿主接入示例：只使用 core/react 根入口 API，本地 JSONL 输入 core，自定义 catalog 经 `catalogRenderMaps` 渲染，并把 action 上下文交回宿主；示例通过真实 React DOM 测试。参考 server 的 JSON 请求解析增加 Content-Type 校验、Content-Length 预检、流式字节数上限和读取超时，默认 1 MiB / 10s，可通过 `NEXUS_MAX_REQUEST_BODY_BYTES` / `NEXUS_REQUEST_TIMEOUT_MS` 配置。认证、租户、公网限流和审计仍明确属于宿主部署层。

P6-a 已完成。core `CatalogRegistry` 支持自定义组件 `componentSchemas`，schema 在注册期做确定性校验，runtime 可选注入 registry 并在进入状态 / 渲染前拦截未注册 catalog、跨 catalog 组件和非法 props；React Provider 暴露 `catalogRegistry`，最小宿主示例同时演示契约注册与渲染注册。server 的 task `TaskSummary` / `TaskButton` 与 Workbench `CustomerSummary` 已改为复用同一 props guard。当前 schema 是 JSON Schema-like MVP 子集，不承诺完整标准 JSON Schema，也不校验 `{ path }` 解析后的数据值类型。

P6-b 已完成。自定义组件 props 校验会聚合所有确定性 schema 诊断，而不是只返回第一个错误。`{ path }` 绑定保持 A2UI 渐进语义：路径尚未出现在 dataModel 时视为 pending；路径已有值时，resolved value 会继续执行类型、enum、range、length、pattern 与嵌套 object / array 校验。runtime 在 `updateComponents` 时使用当前模型校验，在 `updateDataModel` 时先计算下一版模型再反查现有组件，非法更新整条拒绝且不落 state；server stream guard 复用同一套 diagnostics，防止 Agent 端绕行。

P6-c 已完成。core `A2UIError` 新增结构化 `diagnostics[]`，runtime `onError`、store error、React Provider `onError` 和参考 server SSE `error` payload 使用同一诊断形状。Agent Adapter 会把宿主注入的自定义 `CatalogRegistry` 传入生成与 action sequence guard，避免校验回落到默认 registry。Playground 会展示 `path <- dataPath`，便于区分组件 props 契约错误与动态绑定数据错误。

P7-a 已完成。`CatalogDefinition` 支持注册期校验可选 action 白名单，空数组可表示纯展示 catalog。独立宿主示例通过本地 HTTP Agent 返回审批 JSONL，SSE 输出进入 core 后由 React renderMap 渲染；点击按钮解析 `/approvalId` 与 `/amount` context，外部 Agent action 响应将同一 surface patch 为已审批并禁用按钮。未在 catalog 声明的 action 在进入 SSE 前被拒绝。
