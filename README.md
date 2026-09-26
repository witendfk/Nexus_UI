# Nexus UI

Nexus UI 是面向 Agent 开发者的 A2UI Agent UI Runtime：Agent 只输出受约束的 A2UI v0.9 声明式消息，宿主通过 Nexus UI 校验、流式渲染、绑定用户状态、分发业务 action，并在同一 surface 原地更新结果。当前交付物是 **Nexus Agent Task Profile**，不是完整 A2UI v0.9 客户端，也不是官方 Basic Catalog 完整一致性实现。

它不是 UI 画板。UI 画板的终点是“生成一张页面”；Nexus UI 的终点是“让 Agent 生成的任务界面可以安全运行，并把用户操作送回业务系统”。

## 项目提供的能力

| 能力 | 说明 |
| --- | --- |
| 安全 UI 边界 | Agent 输出不能是 HTML、前端源码或任意 JSON；协议结构、Catalog 能力、surface 生命周期和 action 策略必须分层校验。 |
| 流式运行时 | core 缓冲 JSONL、渐进解析消息、维护组件树和 dataModel，并以流式状态驱动 React 渲染。 |
| 有状态交互 | TextField、CheckBox、ChoicePicker、DateTimeInput、Slider 可写回 dataModel；最小 A2UI checks 展示协议错误并阻断按钮 action；Button action 携带最新上下文。 |
| 宿主设计系统控制 | A2UI 组件名通过 React renderMap 映射到宿主组件；自定义 Catalog 可声明组件 schema 和 action 白名单。 |
| Agent 接入契约生成 | `createCatalogPromptContract` 可从同一份 Catalog 定义生成外部 Agent 的 A2UI 输出提示词契约，并可由宿主显式通过 HTTP 发布；guard 仍是最终边界。 |
| 业务 action 归属 | action 可以回传外部 Agent，也可以由宿主本地 handler 执行；两种策略的输出都走同一 guard。 |
| 可接入证明 | 提供独立宿主、外部 Agent RPC、有限 server 装配 API、坏输出回归和浏览器验收路径。 |

核心执行链路：

```text
业务 Agent / LLM
  -> Agent 输出 A2UI v0.9 JSONL
  -> 宿主 catalog / lifecycle / structure / action guard
  -> SSE 流式下发
  -> core 渐进解析并维护 dataModel
  -> React renderMap 渐进渲染
  -> 用户 action 回传
  -> 外部 Agent 或宿主 handler 处理
  -> 同一 surface 原地 patch
```

明确不是：

- 不是垂直业务 Agent 本体。
- 不替代 CRM、OA、工单、审批等业务系统。
- 不是完整 A2UI v0.9 实现或官方 Basic Catalog conformance 实现。
- 不是 prompt 生成静态页面的画板。
- MVP 不承诺认证、租户隔离、公网部署和多实例持久化。

## 文档索引

| 文档 | 用途 |
| --- | --- |
| [docs/product-position.md](docs/product-position.md) | 产品定位、落地场景、非目标和个人项目成功标准 |
| [docs/architecture-boundary.md](docs/architecture-boundary.md) | 协议层 / 能力层 / 策略层边界与命名口径 |
| [docs/host-integration.md](docs/host-integration.md) | 宿主接入契约、HTTP/SSE 参考协议、catalog 与支持矩阵 |
| [docs/host-quickstart.md](docs/host-quickstart.md) | 外部宿主最小接入路径、endpoint 替换与坏输出验收 |
| [docs/public-api.md](docs/public-api.md) | core / React / server 有限装配 API、禁止内部路径与版本兼容策略 |
| [docs/interview-narrative.md](docs/interview-narrative.md) | 面试与开源项目讲解叙事 |
| [docs/agent-line-scope.md](docs/agent-line-scope.md) | MVP 协议边界与逐里程碑验收记录 |

## 架构

```text
Business Agent / LLM
        |
Agent Adapter + guard       protocol / capability / policy / action 分层边界
        |
SSE reference transport     POST + text/event-stream；可替换为其他 transport
        |
@nexus-ui/core              框架无关运行时：JSONL 缓冲、校验、状态、树构建、Catalog Registry、action 出口
        |
@nexus-ui/react             ReactRenderer + renderMap / catalogRenderMaps + Provider
        |
Host App / business system  企业设计系统组件、CRM / OA / 工单 / 审批等 action handler
```

`web/nexus-playground` 证明 Workbench 表单与组件能力；`examples/standalone-host-demo` 证明独立宿主与外部 Agent 接入。两者都是证明面，不是最终产品形态。

边界原则：

- core 不感知 SSE、React、DOM、Node 或 Agent 业务。
- React 只通过 `renderMap` 消费 VNode，不自研 reconciler。
- action timestamp 和 client-to-server 外层信封留在 web/server 适配层。
- 协议解释以 `specification/v0_9` 为唯一事实源。
- Agent 输出永远先经过宿主 guard，不能直接获得前端执行能力。

## MVP 边界

当前能力基线到 P13-a；P10-d 的产品收口原则继续有效。交付重点是一条可验证、可接入的 Agent Task Surface 闭环，不是组件数量竞赛。

当前包含：

- 单 active surface、SSE 参考传输、静态 child / children、`{ path }` dataModel 绑定和 action context 解析。
- Nexus Basic Task Profile 选用 17 个 Basic-like 组件名：`Text`、`TextField`、`CheckBox`、`ChoicePicker`、`DateTimeInput`、`Slider`、`Button`、`Column`、`Row`、`List`、`Tabs`、`Image`、`Video`、`AudioPlayer`、`Card`、`Icon`、`Divider`。core 现在先区分协议合法性和 Profile 支持性，再进入 Catalog / Policy guard；这不表示这些组件的全部官方字段和渲染语义都已实现。
- Profile 最小 `checks`：`TextField` / `Slider` / `Button` 支持 `required`、`regex`、`length`、`numeric`、`email`，并展示协议错误文案；失败 Button checks 会阻断 action。
- task / Workbench 自定义 Catalog：验证企业组件映射、props schema、action 白名单、结构化 diagnostics 和业务闭环。
- 外部 Agent HTTP JSONL RPC：初始生成与 action 都可回传远端；宿主也可通过 `NEXUS_DEMO_ACTION_MODE=local` 把 action 留在本地，输出仍走统一 guard。
- Catalog Contract：从宿主 `CatalogDefinition` 生成确定性的 A2UI NDJSON、组件、action、schema 与动态绑定提示词；宿主可显式发布只读 HTTP 契约，不强制外部 Agent 使用固定 prompt。
- 独立宿主 Demo：LLM-backed Agent、Koa 宿主 API、React 宿主页面、health 策略展示和同 surface patch。
- 有限公开装配面：core / React 根入口 API 与 server `SERVER_API_VERSION = 1` 均有测试锁定。
- 可注入异步 surface history；默认内存容量策略，可选本地单进程文件持久化。

当前不包含：

- 官方 Basic Catalog `Modal` 和完整官方组件字段一致性。
- 通用 FunctionCall、ChildList template、`checks` 组合条件、跨字段校验、Workbench `checks` 和完整标准 JSON Schema。
- 多 surface 并发展示、WebSocket、A2A、MCP。
- 认证、授权、租户隔离、审计、公网限流和多实例数据库持久化。

完整支持矩阵与协议事实源见 [docs/agent-line-scope.md](docs/agent-line-scope.md)，宿主接入契约见 [docs/host-integration.md](docs/host-integration.md)，最小复制路径见 [docs/host-quickstart.md](docs/host-quickstart.md)。

## 本地运行

```bash
pnpm install
cp .env.example .env
```

在 `.env` 中配置：

```env
OPENAI_API_KEY=你的-key
OPENAI_BASE_URL=你的 OpenAI-compatible base URL
OPENAI_MODEL=你的模型名
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

无 key、不消耗模型请求的浏览器验收：

```bash
NEXUS_DEMO_AGENT_MODE=deterministic NEXUS_DEMO_ACTION_MODE=local pnpm demo:standalone
```

访问 `http://127.0.0.1:3100/`，确认页面显示 `action: local handler`，生成任务面后点击审批按钮。预期同一卡片原地更新为 `Approved locally: approval-demo-001`，按钮变为 `Approved locally` 并禁用。

真实 LLM 验收：

```bash
pnpm demo:standalone
```

访问 `http://127.0.0.1:3100/`，默认输入保持 `创建营销活动审批任务`，点击“生成任务面”后继续点击模型生成的审批按钮。预期同一张审批卡原地更新为 `Approved: approval-demo-001`，按钮禁用，页面显示 `action: approve`。该模式读取根目录 `.env` 并真实调用 LLM；详细说明见 [examples/standalone-host-demo/README.md](examples/standalone-host-demo/README.md)。

## MVP 验收口径

不同 demo 验收同一类事实，不要求每次重复全部场景：

1. 独立宿主：health 暴露当前 `agentMode` / `actionMode`；生成流从 `streaming` 到 `done`；点击后同一 surface 原地 patch，按钮禁用，无浏览器 error。
2. Workbench：客户摘要、任务标题、优先级、提醒时间和 submit 形成完整任务 surface；提交后同一 surface 显示任务号、优先级和 ISO 8601 提醒时间。
3. 坏输出：外部 Agent 返回非法 JSONL 时，宿主输出 SSE `error`，没有 `done`，失败生成不提交 history。
4. 公开 API：宿主只依赖 core / React / server 根入口，不引用 server 内部源码路径。

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
| P9-a | 宿主接入 Quickstart 与坏输出防回归 | 完成 |
| P9-b | 外部 Agent endpoint 启动编排 | 完成 |
| P10-a | server 有限宿主装配 API 与内部引用收敛 | 完成 |
| P10-b | 最小外部宿主本地 action 模板验收 | 完成 |
| P10-c | 可切换 action 策略浏览器验收 | 完成 |
| P10-d | MVP 产品收口与演示叙事 | 完成 |
| P11-a | Basic `Slider` 数值绑定与 action 上下文闭环 | 完成 |
| P11-b | Basic `checks` 最小校验与 action 阻断闭环 | 完成 |
| P12-a | Catalog Prompt Contract Generator | 完成 |
| P12-b | Catalog Contract HTTP 发布与浏览器验收 | 完成 |
| P13-a | Basic `Video` / `AudioPlayer` 媒体组件与 URL guard | 完成 |
| P14-a | 协议校验 / Runtime Profile 边界拆分 | 完成 |
| P14-b-a | Nexus Basic Task Profile 身份收口 | 完成 |
| P14-b-b | Catalog 能力契约迁移 | 完成 |
| P14-c-a | 宿主 Policy Layer 拆分 | 完成 |
| P14-c-b | 宿主 Policy 注入接口 | 完成 |
| P15-a | 最小宿主模板 Policy 收口 | 完成 |
| P15-b | Policy 拒绝边界码 | 完成 |
| P15-c | 真实 Agent 验收命令 | 完成 |
| P16-a | 可复用 Agent 验收 API | 完成 |
| P16-b | Agent Onboarding Contract API | 完成 |
| P16-c | Onboarding checks 与 verifier 验收闭环 | 完成 |
| P17-a | Onboarding Contract 驱动验收 API | 完成 |
| P17-b | Onboarding Contract 浏览器验收面 | 完成 |

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

P9-a 验收记录（2026-09-23）：新增 [docs/host-quickstart.md](docs/host-quickstart.md)，明确外部宿主应复制的最小文件、catalog / renderMap / action 替换点、external Agent RPC 请求与 JSONL 响应契约、正常链路和坏输出验收方式，并说明 server 仍是参考组合根而非公开 SDK。standalone demo 新增真实 HTTP 回归测试：替换 external endpoint 后，宿主请求仍携带 `version/kind/surfaceId/catalogId/supportedComponents/supportedActions/history`；Agent 返回非法 JSONL 时，浏览器入口输出 SSE `error` 且没有 `done`。

P9-b 验收记录（2026-09-23）：standalone demo 的进程编排支持按 `NEXUS_DEMO_AGENT_ENDPOINT` 切换。未配置时保持内置 Agent、host、web 三进程；显式配置外部 endpoint 时只启动 host 和 web，不再启动无用的内置 Agent。任一子进程意外退出会关闭整组服务，避免残留半套 Demo；默认、外部 endpoint 与空白 endpoint 三种编排路径均有测试锁定。验收同时修复 `NEXUS_DEMO_AGENT_MODE` 未传入 Agent 进程的问题：`deterministic` 模式真实生效，非法模式会被拒绝。真实外部编排验收确认 host 为 `external-rpc`、Agent 为 `deterministic`、生成流以 `done` 结束且 dev 编排日志中没有内置 Agent。

P10-a 验收记录（2026-09-23）：server 根入口从可执行参考服务改为有限宿主装配 API，标记 `SERVER_API_VERSION = 1`，只导出 Agent Adapter、external JSONL RPC helpers、内存 history、guarded router 和 `sendAgentRun` transport seam；参考服务启动逻辑移至 `src/main.ts`，package dev/start 脚本同步切换。standalone demo 已移除对 server `src/**` 内部路径的引用，仅通过 `@nexus-ui/server` 根入口装配宿主；server 根导出面有快照测试锁定，并验证 import 不会暴露或启动参考 Koa app。

P10-b 验收记录（2026-09-23）：standalone host 模板新增本地 action 注入点。默认 action 继续回传外部 Agent；传入本地 handler 时，初始生成仍使用 external JSONL RPC，action 由宿主进程处理并返回候选 A2UI JSONL。回归测试证明外部 Agent 只收到一次 generate 请求，本地 action 保持同一 `surfaceId`，React 原地更新并禁用按钮，输出仍通过统一 guard 后以 `done` 结束。

P10-c 验收记录（2026-09-23）：standalone demo 新增 `NEXUS_DEMO_ACTION_MODE=external | local`。默认 external 行为不变；local 模式下初始生成仍走外部 Agent RPC，action 由宿主本地 handler 处理。宿主 `/health` 返回 `agentMode` 与 `actionMode`，浏览器显示 `action: external Agent` 或 `action: local handler`，本地结果显示 `Approved locally` 且同一 surface 原地禁用按钮。策略解析、health 契约和浏览器渲染路径均有测试。

P10-d 验收记录（2026-09-23）：MVP 产品收口完成。README 首屏改为 runtime 能力、非目标和最短证明路径；当前包含 / 不包含边界与 P10-c 后的真实实现同步；deterministic standalone demo 成为无 key 浏览器验收路径，真实 LLM demo 保留为模型链路验收；面试叙事补充外部 Agent RPC、action 归属和原地 patch 的讲解顺序。

P11-a 验收记录（2026-09-24）：Basic Catalog `Slider` 接入 core 结构校验、React 原生 range 渲染、数字 `value: { path }` 双向绑定和 Button action 最新数值解析。server catalog、prompt 与 guard 要求有限数字 `min/max`、`min < max`、`value: { path }`，并拒绝 `checks`、未知字段和挂载 action。core / React / server 测试覆盖合法结构、非法范围、数字写回、DOM 交互、公开导出和 prompt 契约；全仓 format / typecheck / lint / build / test 已通过，自动化测试不读取 `.env`、不消耗真实 LLM 请求。

P11-b 验收记录（2026-09-24）：Basic Catalog 最小 A2UI `checks` 闭环完成。core 支持官方 `{ condition, message }`、5 个基础校验函数和 `VNode.validation`；React 在 `TextField` / `Slider` 展示协议错误文案，Button 失败 checks 禁用按钮，core 在 action 出口二次阻断；server guard 与 LLM prompt 仅对 Basic `TextField` / `Slider` / `Button` 放行，并限制函数、数量、文案和正则边界。core / React / server 测试覆盖协议结构、求值、DOM 恢复、action 阻断、guard 与 prompt 契约；全仓 format / typecheck / lint / build / test 已通过，自动化测试不读取 `.env`、不消耗真实 LLM 请求。

P12-a 验收记录（2026-09-24）：core 新增 `createCatalogPromptContract(catalog)`，复用 `CatalogRegistry` 的注册期校验，并从 `catalogId`、组件白名单、action 白名单和 JSON-Schema-like props schema 生成确定性的 A2UI NDJSON 输出契约；prompt 明确动态绑定语义并声明宿主 guard 是最终边界。standalone demo 将纯 Catalog 契约拆分到 `shared/catalog-contract.ts`，宿主继续注册同一 CatalogDefinition，外部 Demo Agent 用它生成 system prompt。core 覆盖确定性输出、display-only / 未声明 action 差异、非法定义拒绝和公开导出面；demo 覆盖 prompt 与 Catalog 同源。全仓 format / typecheck / lint / build / test 已通过；自动化测试不读取 `.env`、不消耗真实 LLM 请求。

P12-a 真实模型补充验收：直连 standalone Demo Agent 触发生成与 `approve` action 两次真实 LLM 请求。生成返回 `createSurface -> updateComponents -> updateDataModel`，使用 `root/approve/approveLabel`、`ApprovalSummary` 动态绑定和 `USD 3,500`；action 返回同一 `surfaceId` 的 `updateComponents -> updateDataModel`，按钮禁用并更新为 `Approved: approval-demo-001`。

P12-b 验收记录（2026-09-24）：server 宿主装配 API 新增 `catalogContracts` 显式发布边界，并提供 `GET /api/a2ui/catalog-contract?catalogId=...`，返回 `serverApiVersion`、原 `CatalogDefinition` 和 `createCatalogPromptContract` 生成的 prompt。缺失 `catalogId` 返回 400，未显式发布的 catalog 返回 404，重复发布在装配期失败；Catalog 注册本身不代表对外公开。standalone host 使用与 guard 相同的 `standaloneHostCatalog` 发布契约，浏览器提供“查看 Catalog Contract”验收入口。无头 Chrome 验收确认页面请求返回 200、面板状态为 `done`，契约包含生命周期、catalog、schema 与 guard 边界，且无 console error / pageerror；全仓 format / typecheck / lint / build / test 已通过，自动化测试不读取 `.env`、不消耗真实 LLM 请求。

P13-a 验收记录（2026-09-24）：Basic Catalog `Video` 与 `AudioPlayer` 已按官方字段接入 core 结构校验、React 原生播放器渲染和公开导出；server catalog、LLM prompt 与流式 guard 只允许官方 `url`（`AudioPlayer` 另有 `description`），拒绝 HTML 风格字段与 action。用户明确提供视频或音频 URL 时，生成流必须包含对应媒体组件；普通未知 URL 不猜测媒体类型，且 URL 不能直接或经 dataModel 绑定进入 `Text`。自动化测试不读取 `.env`、不消耗真实 LLM 请求。

## 后续路线

1. **P14-b-b Catalog Contract 迁移**：把 `disabled` 等 Nexus 扩展和组件字段规则迁入机器可读 Catalog Contract，并继续从 server guard 去重。
2. **场景化表单扩展**：在真实工作流需要时评估 `checks` 组合条件与跨字段校验。

扩展顺序必须继续服从产品目标：先增强 runtime 的确定性和可接入性，不做组件画廊式的大而全。
