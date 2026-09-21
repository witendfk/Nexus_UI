# Agent Line MVP Scope

本文档是第一条 Agent 线的事实边界。协议本身以 [specification/v0_9](../specification/v0_9/README.md) 为准；本文档只描述 Nexus UI 当前实现范围。

宿主接入契约、HTTP/SSE 参考协议和完整支持矩阵见 [host-integration.md](host-integration.md)。

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

A2UI v0.9 Basic Catalog 定义 18 个组件：

```text
Text, Image, Icon, Video, AudioPlayer,
Row, Column, List, Card, Tabs, Modal, Divider,
Button, TextField, CheckBox, ChoicePicker, Slider, DateTimeInput
```

Basic Catalog 只允许并实现 14 个：

```text
Text, TextField, CheckBox, ChoicePicker, DateTimeInput, Button, Column, Row, List, Tabs, Image, Card, Icon, Divider
```

这不是 A2UI 协议上限，而是 MVP 的实现白名单。服务端通过 `CatalogRegistry` 查询组件边界；generate 请求默认使用 Basic Catalog，也可显式选择已注册的 task 或 Workbench catalog。

M6 已提供 registry 架构和端到端 task 样例：core 可注册多个 `catalogId`，server 可按请求选择 catalog 并约束 LLM 输出，React 可按 surface 选择对应 renderMap。自定义组件必须由宿主显式提供渲染函数；P6-a 起，registry 还可为自定义组件注册 props schema，runtime 与 server guard 会统一执行组件名和 props 契约校验。

task catalog 是 `TaskSummary`、`TaskButton` 两个组件的最小接入样例，用于证明设计系统可以按 A2UI Catalog 边界接入，不代表所有自定义组件都能自动渲染。

Workbench catalog 是企业跟进任务样例，只允许 `CustomerSummary`、`Text`、`TextField`、`ChoicePicker`、`DateTimeInput`、`Button`、`Column`、`Row`、`Divider`，且只开放 `submit` action。`CustomerSummary` 的展示字段必须绑定 dataModel path；生成流必须形成 `CustomerSummary -> TextField(/taskTitle) -> ChoicePicker(/priority) -> DateTimeInput(/reminderAt) -> submit Button -> submitResult` 闭环，submit context 必须携带任务标题、优先级、ISO 8601 提醒时间、客户 ID 和客户名。

当前 `WorkbenchTaskStore` 是进程内模拟 CRM。真实宿主应替换为 CRM / OA 调用，并补充权限、审计、幂等和租户隔离。

## Agent Adapter 边界

server 内置 Agent Adapter，用来隔离 HTTP 传输与 Agent 实现：

- 生成链路负责创建 `surfaceId`、解析已注册 catalog、选择宿主注入生成源 / LLM / fallback 输出；宿主 source 与 LLM 成功后会记录 surface catalog 和 history。
- action 链路按 `catalogId + action.name` 查找业务 action handler；当前内置 Basic `call / search / submit`、Task `start / complete` 与 Workbench `submit`。
- 业务 handler 可以返回同步或异步 A2UI 消息源，并接收同 surface 的 catalog、action 白名单与成功生成 history 只读上下文；输出仍必须通过同一个结构和生命周期 guard。
- 未注册 catalog 或未注册 action 在进入 SSE 前返回 400；Agent 输出失败则通过 SSE `error` 返回。
- `historyStore` 可注入且支持异步读取 / 提交：默认内存实现保留最近 64 个 surface、每 surface 最近 20 条 turn；显式配置 `NEXUS_HISTORY_FILE` 时可使用本地文件适配器，重启后恢复 catalog 与 turn。catalog 与 turn 通过一次 `commitGeneration` 提交，生成源与 action handler 只接收拷贝后的只读 history。

P5-b 提供最小外部 Agent JSONL RPC helper：生成和 action 共用 `version: 1` 请求契约，远端返回候选 A2UI JSONL；超时、响应大小、HTTP 状态、Content-Type、JSONL 解析和空输出均有本地错误边界。RPC 输出没有独立放行通道，仍必须通过同一个 Agent guard。自动重试、远程凭证托管、权限、租户、审计和持久化 RPC 日志不属于当前版本。

## 支持范围

- 单个 active surface。
- 静态 `child` / `children` 引用。
- Basic Catalog `List` 的静态列表布局：`direction` / `align`。
- Basic Catalog `Tabs` 的静态 `tabs` 定义、动态 `title` 和本地激活切换。
- Basic Catalog `Image` 的 `url` 展示与 `description` 可访问文本。
- Basic Catalog `TextField` 的 `shortText / longText / number / obscured` 输入、`label`、`value: { path }` 双向绑定。
- Basic Catalog `TextField.validationRegexp` 的本地格式校验反馈。
- Basic Catalog `CheckBox` 的 `label` 与布尔 `value: { path }` 双向绑定。
- Basic Catalog `ChoicePicker` 的单选 / 多选、`checkbox / chips` 展示、选项筛选和 `string[]` 形式 `value: { path }` 双向绑定。
- Basic Catalog `DateTimeInput` 的 date / time / date-time 输入、`min` / `max` 和 ISO 8601 字符串形式的 `value: { path }` 双向绑定。
- Basic Catalog `search` action：Button 读取 TextField 绑定值并原地更新 `searchResult`。
- Basic Catalog `submit` action：Button 同时读取 TextField 与 CheckBox 绑定值并原地更新 `submitResult`。
- `{ path }` 数据绑定。
- `action.event`。
- Task catalog 的进程内业务状态样例：`pending -> active -> completed`。
- Workbench catalog 的企业跟进任务样例：客户摘要、任务标题、任务优先级、提醒时间、submit 创建任务、结果原地更新和重复提交拒绝。
- 请求级 `catalogId` 选择与 task catalog 自定义 renderMap。
- 宿主进程内注入自定义 generation source；其输出必须经过同一 Agent guard。
- 外部业务 Agent 的最小 HTTP JSONL RPC helper，可同时接入初始生成与 action 响应；输出仍必须经过同一 Agent guard。
- SSE `message` / `error` / `done`。
- 参考 server 请求入口要求 JSON Content-Type，限制请求体字节数并设置读取超时；默认 1 MiB / 10s，可显式配置。
- 服务端按 surface 保存成功 LLM / 宿主 source 生成流的内存 history。
- 宿主可替换 surface history 存储；当前提供异步与原子提交边界、进程内默认实现、可选本地单进程文件持久化和“commit 成功后才 `done`”的 SSE 语义，不包含数据库、多实例或租户持久化。
- Catalog 诊断以结构化 `{ path, message, dataPath? }` 从 core runtime、React Provider `onError` 和 SSE `error` payload 上浮；宿主可直接定位组件 props 或 dataModel 来源。
- `@nexus-ui/core` 与 `@nexus-ui/react` 只承诺根入口 API；React 提供当前 core 范围的兼容诊断。server 是参考组合根，不承诺 npm SDK 稳定性。

## 明确不支持

- `Slider` 等剩余表单组件。
- `checks`、FunctionCall、可定制校验错误文案与跨字段校验。
- checks、FunctionCall、`sendDataModel`。
- ChildList template 与相对路径作用域。
- 多 surface 并发展示。
- WebSocket、A2A、MCP 等其他传输。
- 持久化会话、权限、审计、租户隔离与真实 CRM / OA 集成。

遇到不支持但结构合法的消息时，由服务端 guard 拒绝，不交给前端渲染；直接进入 core 的坏消息会记录错误并丢弃，不中断后续流。

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

P5-d 已完成。core 和 React 公开 API 从“实际导出”收紧为“显式承诺的根入口”：core 移除协议模块通配导出并标记 `CORE_API_VERSION = 1`；React 导出全部 14 个标准组件并提供 `getReactCoreCompatibility()`，当前支持 core `0.1.x` / API `1` / A2UI `v0.9`。两个包的运行时导出面都有快照测试，文档明确内部路径不可依赖、server 不是公开 SDK。协议版本、包版本和 API 版本的边界已固定到 `docs/public-api.md`。

P5-e 已完成。`packages/nexus-react/examples/minimal-host.tsx` 提供可执行的最小宿主接入示例：只使用 core/react 根入口 API，本地 JSONL 输入 core，自定义 catalog 经 `catalogRenderMaps` 渲染，并把 action 上下文交回宿主；示例通过真实 React DOM 测试。参考 server 的 JSON 请求解析增加 Content-Type 校验、Content-Length 预检、流式字节数上限和读取超时，默认 1 MiB / 10s，可通过 `NEXUS_MAX_REQUEST_BODY_BYTES` / `NEXUS_REQUEST_TIMEOUT_MS` 配置。认证、租户、公网限流和审计仍明确属于宿主部署层。

P6-a 已完成。core `CatalogRegistry` 支持自定义组件 `componentSchemas`，schema 在注册期做确定性校验，runtime 可选注入 registry 并在进入状态 / 渲染前拦截未注册 catalog、跨 catalog 组件和非法 props；React Provider 暴露 `catalogRegistry`，最小宿主示例同时演示契约注册与渲染注册。server 的 task `TaskSummary` / `TaskButton` 与 Workbench `CustomerSummary` 已改为复用同一 props guard。当前 schema 是 JSON Schema-like MVP 子集，不承诺完整标准 JSON Schema，也不校验 `{ path }` 解析后的数据值类型。

P6-b 已完成。自定义组件 props 校验会聚合所有确定性 schema 诊断，而不是只返回第一个错误。`{ path }` 绑定保持 A2UI 渐进语义：路径尚未出现在 dataModel 时视为 pending；路径已有值时，resolved value 会继续执行类型、enum、range、length、pattern 与嵌套 object / array 校验。runtime 在 `updateComponents` 时使用当前模型校验，在 `updateDataModel` 时先计算下一版模型再反查现有组件，非法更新整条拒绝且不落 state；server stream guard 复用同一套 diagnostics，防止 Agent 端绕行。

P6-c 已完成。core `A2UIError` 新增结构化 `diagnostics[]`，runtime `onError`、store error、React Provider `onError` 和参考 server SSE `error` payload 使用同一诊断形状。Agent Adapter 会把宿主注入的自定义 `CatalogRegistry` 传入生成与 action sequence guard，避免校验回落到默认 registry。Playground 会展示 `path <- dataPath`，便于区分组件 props 契约错误与动态绑定数据错误。
