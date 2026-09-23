# Nexus UI

Nexus UI 是一个面向 Agent 开发者的 A2UI Runtime：Agent 输出符合 A2UI v0.9 的声明式 UI 消息，Nexus UI 负责校验、流式解析、渐进渲染、用户交互回流和同 surface 原地更新。

它不是一个垂直业务 Agent，也不试图替代业务系统。业务 Agent 通过 Adapter 接入；Nexus UI 解决的是“Agent 生成 UI”的协议、渲染和安全边界问题。

## 产品主张

Agent 动态生成 UI 时，直接输出 HTML、React 代码或任意 JSON 都会带来安全、校验、渲染和交互回流问题。Nexus UI 把这条链路工程化：

```text
自然语言
  -> Agent 输出 A2UI v0.9 JSONL
  -> 服务端结构与生命周期校验
  -> SSE 流式下发
  -> core 渐进解析
  -> React 渐进渲染
  -> 用户 action 回传
  -> Agent 更新同一 surface
  -> UI 原地更新
```

## 文档索引

| 文档 | 用途 |
| --- | --- |
| [docs/product-position.md](docs/product-position.md) | 产品定位、落地场景、非目标和个人项目成功标准 |
| [docs/host-integration.md](docs/host-integration.md) | 宿主接入契约、HTTP/SSE 参考协议、catalog 与支持矩阵 |
| [docs/public-api.md](docs/public-api.md) | core / React 公开 API、禁止内部路径与版本兼容策略 |
| [docs/interview-narrative.md](docs/interview-narrative.md) | 面试与开源项目讲解叙事 |
| [docs/agent-line-scope.md](docs/agent-line-scope.md) | MVP 协议边界与逐里程碑验收记录 |

## 架构

```text
Business Agent / LLM
        |
Agent Adapter + guard       catalog、surface 生命周期、结构、action 安全边界
        |
SSE reference transport     POST + text/event-stream；可替换为其他 transport
        |
@nexus-ui/core              框架无关运行时：JSONL 缓冲、校验、状态、树构建、Catalog Registry、action 出口
        |
@nexus-ui/react             ReactRenderer + renderMap / catalogRenderMaps + Provider
        |
Host App / business system  企业设计系统组件、CRM / OA / 工单 / 审批等 action handler
```

`web/nexus-playground` 是当前真实 LLM 与 action 闭环的证明面，不是最终产品形态。

边界原则：

- core 不感知 SSE、React、DOM、Node 或 Agent 业务。
- React 只通过 `renderMap` 消费 VNode，不自研 reconciler。
- action timestamp 和 client-to-server 外层信封留在 web/server 适配层。
- 协议解释以 `specification/v0_9` 为唯一事实源。
- Agent 输出永远先经过宿主 guard，不能直接获得前端执行能力。

## 当前 MVP

当前版本只交付一条 Agent 线，目标是先跑通闭环，而不是覆盖 A2UI 全部能力。

- 单个 active surface。
- SSE 传输。
- A2UI Basic Catalog 14 组件子集：`Text`、`TextField`、`CheckBox`、`ChoicePicker`、`DateTimeInput`、`Button`、`Column`、`Row`、`List`、`Tabs`、`Image`、`Card`、`Icon`、`Divider`。API 未传 `catalogId` 时默认 Basic。
- 示例 task catalog 自定义组件：`TaskSummary`、`TaskButton`，用于验证企业设计系统接入方式。
- 自定义组件 props 契约：注册期校验 schema，runtime / server guard 聚合未知字段、非法类型、enum / range / length / pattern、嵌套 object / array 与 `{ path }` 绑定策略诊断；绑定在 dataModel 已有值时继续校验 resolved value，缺失路径保持流式 pending。
- Catalog 宿主边界：`CatalogDefinition.actions` 可声明自定义 action 白名单；core runtime、server Adapter / guard、外部 Agent RPC 请求和业务 handler 上下文使用同一套 action 边界。
- 结构化 diagnostics：core runtime `onError`、store error、React Provider `onError` 与 SSE `error` payload 均可携带 `{ path, message, dataPath? }`，宿主无需解析错误文案即可定位组件 props 或 dataModel 问题。
- Workbench catalog 企业跟进任务 Demo：`CustomerSummary` 复用 Basic 输入与提交能力，并包含任务优先级 `ChoicePicker` 和提醒时间 `DateTimeInput`。Playground 默认展示该场景。
- 静态 `child` / `children` 引用。
- Basic Catalog `Tabs` 的静态 `tabs` 定义和本地激活切换。
- `{ path }` 数据绑定。
- Basic Catalog `TextField` 的 `shortText / longText / number / obscured` 变体、`value: { path }` 双向绑定、action context 取值和 `validationRegexp` 本地格式反馈。
- Basic Catalog `CheckBox` 的 `value: { path }` 布尔双向绑定，以及 `TextField + CheckBox -> submit -> submitResult` 最小表单闭环。
- Basic Catalog `ChoicePicker` 的 `multipleSelection / mutuallyExclusive`、`checkbox / chips` 展示、选项筛选和 `string[]` 形式的 `value: { path }` 双向绑定。
- Basic Catalog `DateTimeInput` 的 date / time / date-time 原生输入、`min` / `max` 和 ISO 8601 字符串形式的 `value: { path }` 双向绑定。
- `action.event` 服务端回流。
- LLM 生成优先，未配置 key 时各 catalog 使用确定性 fallback。
- 业务 action 通过 Agent Adapter 按 `catalogId + action.name` 分发；当前注册 Basic `call / search / submit`、Task `start / complete` 与 Workbench `submit`。
- 宿主可在进程内注入自定义 generation source；输出仍经过同一服务端 guard，action handler 可读取同 surface 的 catalog 与成功生成 history。
- 外部业务 Agent 可通过最小 HTTP JSONL RPC helper 接入初始生成与 action 响应；请求携带 catalog / action / surface history 边界，输出仍必须经过同一服务端 guard。
- `examples/standalone-host-demo` 提供仓库内可运行的三进程独立宿主 Demo：LLM-backed 外部 Agent、独立 Koa 宿主 API、React 宿主页面、SSE guard、action 回流与同 surface 原地更新。它验证 Runtime 接入边界，不是完整业务 Agent 工程；server 子包不再承载 demo 目录。
- `@nexus-ui/core` 与 `@nexus-ui/react` 只承诺根入口 API；根导出面有测试锁定，React 提供 core/renderer 兼容诊断。server 是参考组合根，不是公开 SDK。
- React 包提供可测试的最小宿主接入示例；参考 server 请求入口要求 JSON Content-Type，并支持请求体大小与读取超时配置。
- 宿主可注入异步 surface history store；catalog 与 turn 通过一次原子 `commitGeneration` 提交，默认进程内实现保留最近 64 个 surface、每 surface 最近 20 条 turn。显式配置 `NEXUS_HISTORY_FILE` 时可启用本地单进程文件持久化，重启后恢复 catalog 与 history；SSE 只有在完整流通过最终 guard 且 history 提交成功后才发送 `done`。
- 服务端通过 Catalog Registry 拦截非法结构、非法 surface 生命周期、不支持组件和 action 期 create/delete；generate 请求可通过 `catalogId` 选择已注册 catalog，并对 Basic `Image`、`TextField`、`CheckBox`、`ChoicePicker`、`DateTimeInput` 与 task / Workbench 自定义组件做协议字段、props schema 和闭环校验。

A2UI v0.9 Basic Catalog 本身定义 18 个组件，并支持通过 Catalog 扩展自定义组件。当前自定义 Catalog 提供 task 与 Workbench 示例，并支持 JSON Schema-like MVP 子集与已存在 dataModel 值的动态绑定校验；完整标准 JSON Schema 引擎、跨字段校验、`Slider`、`checks`、ChildList template、FunctionCall 和多 surface 都是后续版本，不属于当前 MVP。

详细边界见 [docs/agent-line-scope.md](docs/agent-line-scope.md)，宿主接入契约见 [docs/host-integration.md](docs/host-integration.md)。

## 本地运行

```bash
pnpm install
cp .env.example .env
```

在 `.env` 中配置：

```env
OPENAI_API_KEY=你的-key
OPENAI_BASE_URL=https://open.bigmodel.cn/api/coding/paas/v4
OPENAI_MODEL=glm-5.2
PORT=3001
# 可选：配置后启用本地 surface history 持久化。
# NEXUS_HISTORY_FILE=.nexus/surface-history.json
```

`.env` 已被 git 忽略；部署时服务器环境变量优先。不要把 key 提交到仓库或发送到聊天里。

启动服务：

```bash
pnpm dev:server
pnpm dev:web
```

访问：

- Web: `http://localhost:5173/`
- Server health: `http://localhost:3001/health`

未配置 key 时 `/health` 返回 `agentMode: "fallback"`；配置后应返回 `agentMode: "llm"`。

### Run The Standalone Host Demo

```bash
pnpm demo:standalone
```

访问 `http://127.0.0.1:3100/`，默认输入保持 `创建营销活动审批任务`，点击“生成任务面”后继续点击模型生成的审批按钮。预期同一张审批卡原地更新为 `Approved: approval-demo-001`，按钮禁用，页面显示 `action: approve`。该 Demo 默认读取根目录 `.env` 并真实调用 LLM；详细说明见 [examples/standalone-host-demo/README.md](examples/standalone-host-demo/README.md)。

## MVP 验收

1. 保持 Catalog 为 `Workbench`，使用默认输入并点击“生成 UI”，状态从 `streaming` 到 `done`。
2. 输入“帮我给华云科技创建一条客户跟进任务，并在明天 10:00 提醒我。”并生成 UI。
3. 确认页面出现客户摘要、任务标题输入、优先级单选、提醒时间输入、提交按钮和结果位。
4. 输入“发送方案修订版”，选择“高”优先级，确认提醒时间后点击“创建跟进任务”。
5. 同一 surface 原地更新为“任务已创建”，显示 `followup-*` 任务号、“优先级：高”和 ISO 8601 提醒时间，按钮禁用，action 状态为 `done`。
6. 切换 Catalog 为 `Basic`，输入非联系人卡片需求，验证通用卡片与 action 原地更新。
7. 切换 Catalog 为 `Task`，生成 task UI，先点击“开始任务”，再点击“完成任务”。
8. 每条 action 线的 surface 均原地更新，底部 action 状态最终为 `done`。

接口级验收要求生成流满足：

```text
createSurface
updateComponents（包含 id=root）
可选 updateDataModel
done
```

action 响应只允许 `updateComponents` / `updateDataModel`，且 `surfaceId` 不变。

## 开发节奏

项目按“小步实现、测试、验收、再扩展”推进：

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | 工作区、协议类型、模块骨架 | 完成 |
| M1 | core 流式解析、状态、树构建、action 出口 | 完成 |
| M2 | React renderMap、Provider、渐进渲染 | 完成 |
| M3 | SSE、Koa server、fallback Agent | 完成 |
| M4 | 真实 LLM streaming、服务端 guard、action history | 完成 |
| M5 | 真实 LLM 端到端验收与坏输出防线 | 完成 |
| M6 | Catalog Registry 架构与端到端自定义 Catalog 样例 | 完成 |
| M7-a | Agent Adapter 与业务 action handler 最小分层 | 完成 |
| M7-b | 进程内业务 Agent 样例与 task 状态闭环 | 完成 |
| M8-a | Basic Catalog `List` 静态列表组件 | 完成 |
| M8-b | Basic Catalog `Tabs` 静态标签容器 | 完成 |
| M8-c | Basic `Image` 协议字段防回归 | 完成 |
| M9-a | Basic `TextField` 双向绑定与搜索 action 闭环 | 完成 |
| M9-b | Basic `TextField` 官方变体与正则校验 | 完成 |
| M10 | Basic `CheckBox` 布尔绑定与最小表单提交闭环 | 完成 |
| P1 | 产品叙事、宿主接入契约、支持矩阵与面试讲解 | 完成 |
| P2 | 企业 Agent Workbench 跟进任务闭环 | 完成 |
| P3 | Workbench 任务优先级与 Basic `ChoicePicker` 闭环 | 完成 |
| P4 | Workbench 提醒时间与 Basic `DateTimeInput` 闭环 | 完成 |
| P5-a | 宿主进程内 Agent source 注入与 surface action 上下文 | 完成 |
| P5-b | 外部业务 Agent JSONL RPC 最小契约 | 完成 |
| P5-c-1 | surface history 可注入存储边界与默认容量策略 | 完成 |
| P5-c-2 | 异步 history 原子提交与 done 前置校验语义 | 完成 |
| P5-c-3 | 本地单进程 surface history 文件持久化 | 完成 |
| P5-d | core / React 根入口 API 与兼容策略 | 完成 |
| P5-e | 最小宿主接入示例与请求边界加固 | 完成 |
| P6-a | 自定义组件 Catalog 工程化与 props schema 校验 | 完成 |
| P6-b | Catalog 诊断聚合与动态绑定值校验 | 完成 |
| P6-c | 结构化 diagnostics 上浮到 runtime / React / SSE / Playground | 完成 |
| P7-a | 独立宿主接入证明面与自定义 Catalog action 契约 | 完成 |
| P7-b | 独立宿主 HTTP 装配模板 | 完成 |
| P8-a | 仓库内可运行独立宿主 Demo | 完成 |

2026-09-15 验收记录：真实 LLM 生成与 action 原地更新已通过；测试环境已与项目 `.env` 隔离；全仓 `test / typecheck / lint / build` 全部通过。

M6-a 验收记录：core `CatalogRegistry`、React `catalogRenderMaps`、server registry-backed guard 已完成；全仓 `test / typecheck / lint / build` 通过。当前 generate API 仍固定使用 Basic Catalog，请求级 catalog 选择和端到端自定义组件样例属于 M6-b。

M6-b 验收记录：task catalog 已完成注册、请求级选择、LLM prompt 边界、fallback 生成、React 渲染、action 回流和同 surface 原地更新；全仓质量门禁通过。自定义组件仍由宿主显式提供 renderMap，不支持未注册组件自动渲染。

M7-a 验收记录：Agent Adapter 已接管生成源选择、surfaceId、catalog 边界、surface history 提交和业务 action 分发；Koa 路由只保留 HTTP 解析与状态码映射。当前已注册 Basic `call` 和 Task `complete` 两个确定性 action handler，异步业务 handler 与未注册 action 拒绝均有测试覆盖。全仓 `test / typecheck / lint / build` 于 2026-09-16 通过。

M7-b 验收记录：task catalog 接入进程内业务状态样例，`start` 将任务从待处理更新为进行中并把按钮切换为 `complete`，`complete` 更新为已完成并禁用按钮；重复状态迁移返回 400。LLM prompt 与服务端 guard 同步限制 catalog 支持的 action 名称。全仓 `test / typecheck / lint / build` 于 2026-09-16 通过。

M8-a 验收记录：Basic Catalog 新增 `List` 静态列表组件，支持 `direction`、`align`、静态 `children` 和 `{ path }` 数据绑定；ChildList template 与相对路径作用域仍明确不支持。

M8-b 验收记录：Basic Catalog 新增 `Tabs` 静态标签容器，支持非空 `tabs`、动态 `title`、静态 `child` 引用、`{ path }` 绑定和渲染层本地激活切换；core 会校验 tabs 结构并构建对应子树。

M8-c 验收记录：LLM prompt 明确 `Image` 只能使用 `url` / `description` / `fit` / `variant`，头像必须使用 `variant: "avatar"` 与 `fit: "cover"`；server guard 拒绝 `src` / `alt`、缺失 `url`、非法 `fit` / `variant`、URL 直接或经 dataModel 动态绑定写入 `Text`，以及请求包含图片 URL 但漏生成 `Image` 的输出。React 将 `description` 渲染为 `alt` 并以 `no-referrer` 加载远程图片，避免常见 CDN 防盗链拦截。同类真实联系人卡片请求已输出可渲染头像 URL。
Playground 在生成完成后自动定位到输出卡片顶部，避免头像被浏览器滚动锚定裁出视口。

M9-a 验收记录：core 按官方 Basic Catalog 契约校验 `TextField`，新增受控写回接口 `A2UIRuntime.setInputValue`；React 将 `value: { path }` 输入写回 dataModel，点击 Button 时由 action context 解析最新值。server 只开放 `label` / `value` / `variant(shortText)`，搜索场景强制生成 `TextField -> search Button -> searchResult` 闭环。真实 LLM 页面输入 `A2UI Runtime` 后收到 `搜索：A2UI Runtime` 原地更新，状态为 `done` 且浏览器无 error / warning。

M9-b 验收记录：`TextField` 官方变体全部开放，React 分别渲染单行输入、多行输入、数字输入和密码输入；core 与 server guard 校验合法正则，server 限制 `validationRegexp` 长度并禁止未授权字段。真实 LLM 输出的编号字段携带 `"validationRegexp":"^[A-Z0-9]{6}$"`，页面输入 `abc` 失焦后显示错误与 `aria-invalid=true`，修正为 `ABC123` 后错误清除；浏览器 error / warning 为空。

M10 验收记录：Basic `CheckBox` 已按官方 `label` / `value` 契约接入，core 只允许布尔值或 `{ path }` 绑定并把用户切换写回 dataModel；server guard 强制表单流生成 `TextField + CheckBox -> submit Button -> submitResult`，且关键组件必须从 `root` 可达。真实 LLM 页面输入 `A2UI Runtime`、勾选订阅后提交，同一 surface 原地更新为 `已提交：name=A2UI Runtime，subscribed=true`，生成与 action 状态均为 `done`，浏览器 error / warning 为空。

P1 验收记录：产品定位、个人项目成功标准、宿主接入契约、支持矩阵、安全边界和面试叙事已完成。README 与 core / React 包文档已统一到 M10 后的真实能力边界；Markdown Prettier 检查和全仓 typecheck 通过。本轮是文档与契约交付，未修改运行时代码。

P2 验收记录：Workbench catalog 已完成 LLM prompt、fallback、服务端 guard、React `CustomerSummary` 渲染、`submit` action handler 和同 surface 原地更新。真实 LLM 请求输出客户摘要、`/taskTitle`、`/remind`、`submit` 闭环；页面提交“发送方案修订版”后生成 `followup-0002`，按钮禁用，重复提交被 400 拒绝，生成与 action 状态均为 `done`，浏览器 error / warning 为空。全仓 `typecheck / lint / build / test` 通过。

P3 验收记录：Basic `ChoicePicker` 与 Workbench 优先级闭环已完成。core 支持 `string[]` 绑定写回，React 支持单选 / 多选、checkbox / chips 与筛选，server guard 强制合法选项、双向绑定和 Workbench `/priority` 闭环。真实 LLM 页面选择“高”并提交后，同一 surface 更新为 `任务已创建：followup-0003 · 发送方案修订版 · 优先级：高 · 已设置提醒`，按钮禁用，action 状态为 `done`，浏览器 error / warning 为空。

P4 验收记录：Basic `DateTimeInput` 与 Workbench 提醒时间闭环已完成。core 校验 ISO 8601 date/time/date-time 与字符串双向绑定，React 渲染原生日期时间控件并写回 `/reminderAt`，server guard 强制 Workbench 同时启用日期和时间，handler 校验并规范化提醒时间。真实 LLM 根据当前日期将“明天 10:00”生成 `2026-09-20T10:00:00`；页面提交后同一 surface 显示 `followup-*`、`优先级：高` 和 `提醒时间：2026-09-20T10:00:00`，按钮禁用，action 状态为 `done`，浏览器 error / warning 为空。全仓 `format:check / typecheck / lint / build / test` 通过。

P5-a 验收记录：宿主 generation source 可在进程内替换内置 LLM / fallback，并接收 surface、请求、catalog、组件与 action 边界；业务 action handler 可读取同 surface 的 catalog 与成功生成 history。合法自定义输出通过完整 SSE guard 并提交 history；非法输出以 SSE `error` 结束、没有 `done`、不提交 history。

P5-b 验收记录：外部业务 Agent JSONL RPC helper 可同时接入初始生成与 action 响应。请求携带 `version/kind/surfaceId/catalogId/supportedComponents/supportedActions/history`，action 请求携带已解析的 action；响应必须是 2xx JSONL，每行一个候选 A2UI 消息。真实本地 HTTP 测试覆盖跨 chunk JSONL、同 surface 原地更新、非 2xx 错误契约和超时中断；RPC 输出仍走统一 guard，失败流没有 `done`，失败生成不提交 history。

P5-c-1 验收记录：surface history 从模块级全局状态改为 Agent Adapter 可注入的存储边界。默认内存实现统一限制最近 64 个 surface 和每 surface 最近 20 条 turn；即使 fallback surface 只登记 catalog、不记录 LLM turn，也会参与容量淘汰。生成源和 action handler 收到拷贝后的只读 history。注入隔离、容量淘汰、只读拷贝和 action 上下文读取已通过测试；数据库持久化和异步写入仍在后续 P5-c。

P5-c-2 验收记录：`SurfaceHistoryStore` 升级为异步接口，`prepareGeneration` / `prepareAction` 等待 history 读取；catalog 与 turn 合并为 `commitGeneration` 一次提交，为数据库事务适配留出边界。完整 A2UI 流通过最终 guard 后先等待 commit，成功才发送 `done`；提交失败转换为 SSE `error` 且没有 `done`。异步提交顺序与失败路径已通过测试。数据库适配器、租户隔离和审计仍在后续 P5-c。

P5-c-3 验收记录：本地文件 `FileSurfaceHistoryStore` 已完成。默认不写磁盘；server 配置 `NEXUS_HISTORY_FILE` 后启动加载、commit 串行写入同目录临时文件并原子 rename。新 store 实例读取同一文件可模拟服务重启，并恢复 action catalog 与 history；surface / turn 容量淘汰、非法 JSON、写入失败不污染上一状态和 Agent action 重启恢复均通过测试。该实现定位为本地单进程参考适配器，不是数据库或多实例生产方案。

P5-d 验收记录：core 根入口移除通配导出，显式导出 runtime、协议类型与校验、Catalog Registry、状态 / 渲染 / action seam 和 dataModel helper，并增加 `CORE_API_VERSION`。React 显式导出 Provider、Renderer、RenderMap、全部 14 个标准组件和 core/renderer 兼容诊断，支持 core `0.1.x` / API `1`。core 与 React 的运行时导出面由测试锁定；server 继续定位为参考组合根而非公开 SDK。协议版本、包版本和根 API 版本的兼容策略已写入 `docs/public-api.md`。

P5-e 验收记录：新增 `packages/nexus-react/examples/minimal-host.tsx`，示例只用公开根入口消费 A2UI JSONL、渲染自定义 catalog 并把 action 交回宿主；React DOM 测试覆盖自定义组件渲染和最新 action context。参考 server 请求解析要求 `application/json` 或 `+json`，在读取前拒绝超限 `Content-Length`，流式统计实际字节并默认限制 1 MiB，请求体默认 10s 未完成即失败；边界通过 6 个确定性测试。认证、租户、公网限流与审计仍不属于 MVP。

P6-a 验收记录：core `CatalogRegistry` 支持 `componentSchemas`，runtime 可选注入 catalog 边界并在进入状态 / 渲染前拦截非法输出；React Provider 暴露 `catalogRegistry`，最小宿主示例同时注册契约与渲染器。server 的 task 与 Workbench 自定义组件复用同一 props guard。当前能力是确定性 JSON Schema-like 子集，不承诺完整标准 JSON Schema，也不校验动态绑定解析后的数据值类型。

P6-b 验收记录：props schema 校验升级为结构化诊断聚合；`updateComponents` 用当前 dataModel 校验组件绑定，`updateDataModel` 先计算下一版模型再反查现有组件绑定，非法 resolved value 会拒绝整条消息且不写入 state。server stream guard 复用同一套 Catalog diagnostics，Agent 输出没有绕行通道。dataModel 中尚未出现的绑定路径保持 pending，以保留 A2UI 渐进流式语义。

P6-c 验收记录：Catalog schema 诊断已从 core runtime 上浮到 React Provider、SSE error payload 和 Playground 展示。core `onError` 与 store errors 保留完整 `A2UIError.diagnostics`；React 通过 `onError` 原样透传；参考 server 在 `AGENT_STREAM_ERROR` 中输出 `diagnostics[]`。同时修复 Agent Adapter 自定义 `CatalogRegistry` 未传入 SSE guard 的问题，宿主注入的 catalog 契约在生成与 action 链路均生效。

P7-a 验收记录：`CatalogDefinition` 支持可选宿主 action 白名单，内置 Basic / task / Workbench catalog 显式登记 actions，core runtime、Agent Adapter 与 guard 优先使用宿主 catalog 声明；空白名单表示纯展示 catalog，未声明时 core 不强制内置 Basic fallback，server 参考实现保留旧兼容行为。新增独立宿主审批示例，覆盖外部 JSONL RPC 生成、自定义 props schema、SSE guard、core 渐进渲染、React renderMap、action context 回流、外部 Agent action 响应、同 surface 原地更新与未声明 action 拒绝。

P7-b 验收记录：独立宿主 Koa 装配模板收敛在 `examples/standalone-host-demo/src/host/app.ts`，复用自定义审批 catalog、外部 JSONL RPC Agent、统一 guard 与请求边界，不加载 Playground 内置 catalog / LLM / fallback。测试通过真实 HTTP `/health`、`/api/a2ui/generate`、`/api/a2ui/event` 验证外部 Agent 边界请求、SSE 输出、action context 回流和同 surface patch；health 可显式报告 `external-rpc` 模式。

P8-a 验收记录（2026-09-23）：新增 `examples/standalone-host-demo` workspace，一条命令同时启动 LLM-backed 外部 Agent、独立宿主 API 和 React 独立宿主页面。Agent health 返回 `agentMode: "llm"` 且 `llmConfigured: true`，Host health 返回 `agentMode: "external-rpc"`。真实模型请求已验证初始生成与 approve action 均以 SSE `done` 结束，且 action 保持同一 `surfaceId`；真实浏览器验收验证任务生成、按钮点击、按钮禁用、`action: approve`、同一 DOM surface 原地 patch，且无 pageerror / console error。验收中修复浏览器装配层重复创建 catalog registry 导致 action 后 runtime 重建、原 surface 丢失的问题；新增 React DOM 回归测试通过 mocked SSE 验证 action 重渲染后 runtime 稳定、请求携带原 `surfaceId`，并确认同一 `section` 原地更新。自动化测试显式隔离 deterministic 输出，不读取 `.env` 或消耗模型请求；后续完整 Agent 独立建仓后只需替换 RPC endpoint。

## 后续路线

1. **Catalog 工程化后续**：按真实宿主需求评估完整标准 JSON Schema、跨字段校验与诊断上限策略。
2. **场景化表单扩展**：在真实工作流需要时评估 Slider、`checks` 与跨字段校验。

扩展顺序必须继续服从产品目标：先增强 runtime 的确定性和可接入性，不做组件画廊式的大而全。
