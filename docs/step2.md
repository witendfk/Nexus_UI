# Milestone Log: SSE Server and Agent Loop

状态：M3-M10 已完成。

## 交付内容

### M3: Transport and Deterministic Agent

- Koa server 提供 `GET /health`。
- `POST /api/a2ui/generate` 接收自然语言请求。
- `POST /api/a2ui/event` 接收官方 action 消息。
- SSE 事件使用 `message`、`error`、`done`。
- 未配置 key 时使用联系人卡片 fallback。
- 服务端生成 `surfaceId`，避免客户端重复点击触发重复 create。

验收：

- fallback 生成流完整渲染联系人卡片。
- action 回流后同一 surface 原地更新。
- SSE 错误流不发送 `done`。

### M4: Real LLM Streaming and Guard

- 接入 OpenAI-compatible Chat Completions streaming。
- 支持项目根 `.env`，部署环境变量优先。
- LLM 输出约束为 A2UI JSONL。
- prompt 提供协议 few-shot，避免模型输出通用 UI JSON。
- 服务端保存按 surface 隔离的内存 history。

服务端 guard：

- 强制单 surface。
- 强制当前 8 组件白名单。
- 生成流必须先 `createSurface`。
- 生成流必须包含 `root`。
- action 响应不能 create/delete surface。
- 非法输出通过 SSE `error` 返回，且不写入 history。

验收：

- `agentMode=llm` 时生成非 mock UI。
- LLM 输出非法结构时前端不渲染坏 UI。
- action 响应 patch 同一个 surface。

### M5: End-to-end Acceptance

已执行的真实链路验收：

1. 请求生成杭州天气卡片。
2. SSE 返回 `createSurface`。
3. 同一 surface 收到 `updateComponents`，包含 `root` 和 `refresh` Button。
4. 流以 `done` 结束。
5. 回传 `refresh` action。
6. SSE 只返回同一 surface 的 `updateComponents`。
7. 卡片内容原地更新，没有 create/delete。

## M5 收尾结果

M5 完成标准已全部通过：

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

四条命令于 2026-09-15 全部通过。测试环境已与仓库 `.env` 隔离，mock route 测试不会读取开发者 key 或请求真实 LLM。

## M6-a: Catalog Registry Architecture

交付边界：

- core 新增框架无关 `CatalogRegistry`，只登记 `catalogId` 与组件名，不解释 props，也不感知渲染器。
- React `A2UIProvider` 新增 `catalogRenderMaps`，按 surface 的 `catalogId` 选择 renderMap；未匹配时回退 `renderMap`。
- server Agent guard 支持注入 `catalogId` 与 `CatalogRegistry`，并校验 `createSurface.catalogId` 与组件白名单一致。

M6-a 当时限制（已由 M6-b 解决）：

- playground generate API 仍固定 Basic Catalog 的 8 组件子集。
- 尚未提供请求级 catalog 选择。
- 尚未完成自定义组件的端到端生成与 action 验收。

验收结果：

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

四条命令于 2026-09-15 全部通过。

## M6-b: End-to-end Custom Catalog

交付边界：

- server 注册 task catalog，只允许 `TaskSummary` / `TaskButton`。
- generate 请求支持 `catalogId`，未注册 catalog 直接返回 400。
- LLM prompt 按 catalog 注入组件白名单和 `createSurface.catalogId`。
- 服务端记录 surface 与 catalog 的对应关系，action 响应继续使用原 catalog 边界。
- playground 提供 task renderMap 和 Basic / Task 切换。
- fallback task 流覆盖生成、数据绑定、action 回流和原地更新。

验收结果：

- React 测试覆盖自定义 renderMap 渲染与 action 事件解析。
- server 集成测试覆盖 task 生成、action 后同 surface 更新和 Basic 组件混入拒绝。
- `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build` 于 2026-09-15 全部通过。

## M7-a: Agent Adapter Boundary

交付边界：

- 新增 server Agent Adapter，Koa 路由只负责请求解析、HTTP 状态码和 SSE 触发。
- 生成链路由 Adapter 创建 surfaceId、解析 catalog、选择 LLM/fallback，并在成功流后记录 surface catalog 与 LLM history。
- 业务 action handler 按 `catalogId + action.name` 注册，当前内置 Basic `call` 与 Task `complete`。
- handler 支持同步或异步消息源；输出继续经过 A2UI 结构与生命周期 guard。
- 未注册 action 在进入 SSE 前返回 400。

验收结果：

- AgentAdapter 测试覆盖 catalog 生成源、LLM 组件边界、surface catalog 分发、异步业务 handler 和未注册 action 拒绝。
- server 集成测试保留 Basic / Task 生成与 action 回流，并新增未注册 action 400 场景。
- `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build` 于 2026-09-16 全部通过。

## M7-b: In-Process Business Agent Sample

交付边界：

- Task catalog 的初始 action 从 `complete` 调整为 `start`。
- 新增进程内 `TaskStateStore`，按 surface 维护 `pending -> active -> completed`。
- `start` 原地更新状态为“进行中”，并把按钮 action 切换为 `complete`。
- `complete` 原地更新状态为“已完成”，并禁用按钮。
- 重复 `start`、未开始即 `complete`、重复 `complete` 均返回 400。
- LLM prompt 注入 catalog 支持的 action 名称；Agent guard 在消息下发前拒绝未注册 action。

验收结果：

- AgentAdapter 测试覆盖 task 状态闭环与非法状态迁移。
- Agent guard 测试覆盖未注册 action。
- server 集成测试覆盖 task 生成、`start`、`complete` 和重复 `complete`。
- `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build` 于 2026-09-16 全部通过。

## M8-a: Static List Component

交付边界：

- Basic Catalog 组件白名单新增 `List`。
- React `standardRenderMap` 渲染 `List` 为无样式列表，支持 `direction` 与 `align`。
- `List` 只支持静态 `children` id 数组；ChildList template 与相对路径作用域仍由协议校验拒绝。
- React 测试覆盖静态 children 渲染和 `{ path }` 数据绑定。
- Agent guard 测试覆盖 Basic Catalog 的静态 `List` 组件。

验收结果：

- `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build` 于 2026-09-16 全部通过。
- 真实 LLM 生成包含 `List` 的 Basic Catalog UI，并通过服务端组件边界校验。

## M8-b: Static Tabs Component

交付边界：

- Basic Catalog 组件白名单新增 `Tabs`。
- core 校验 `tabs` 必须为非空数组，每项只包含动态 `title` 和静态 `child`。
- core 树构建按 `tabs[].child` 构建子树，并解析 `tabs[].title` 的 `{ path }` 绑定。
- React `standardRenderMap` 渲染 tablist / tabpanel，本地维护激活项，只渲染当前 tab 的子组件。
- LLM prompt 明确 `Tabs.tabs` 的字段形状，Task catalog prompt 不注入 Tabs 规则。

验收结果：

- core 测试覆盖 Tabs 树构建与非法 tabs 结构。
- React 测试覆盖动态标题和本地切换。
- Agent guard 测试覆盖 Basic Catalog 静态 Tabs。
- `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build` 于 2026-09-16 全部通过。
- 真实 LLM 生成包含 `Tabs` 的 Basic Catalog UI，并通过服务端组件边界校验。

## M8-c: Image Contract Guard

交付边界：

- LLM prompt 明确 `Image` 必须使用 `url`，可选 `description`，禁止 `src` / `alt`。
- LLM prompt 明确头像 / 图片语义必须生成 `Image`，图片 URL 不得直接或通过 `updateDataModel` + `{ path }` 写入 `Text`；头像必须使用 `variant: "avatar"` 与 `fit: "cover"`，未提供头像 URL 时使用 `ui-avatars` 占位服务。
- server guard 在 Basic Catalog 内拒绝缺失 `url` 或使用 `src` / `alt` 的 Image，并校验 `description` / `fit` / `variant` 的合法形状。
- server guard 拒绝 `Text` 中的 URL 字面量与 URL 类动态绑定，并跨 `updateComponents` / `updateDataModel` 消息校验，避免模型把头像链接渲染成文字。
- 当用户请求包含图片 URL 时，生成流必须包含 Basic Catalog `Image` 组件，避免服务把 URL 放入数据模型后静默漏渲染。
- React `Image` 将协议 `description` 渲染为 HTML `alt`。
- React `Image` 使用 `referrerPolicy="no-referrer"` 加载远程图片，兼容拒绝本地 Referer 的图片 CDN。
- Playground 生成完成后自动滚动到 `.nexus-surface` 顶部，避免长卡片在流式更新时因浏览器滚动锚定把顶部头像裁出视口。

验收结果：

- Agent guard 测试覆盖非法 `src` / `alt` 与合法 `{ path }` 图片绑定。
- React 测试覆盖 `description` 的 `{ path }` 解析、`alt` 输出和 `no-referrer` 加载策略。
- 同类联系人卡片真实 LLM 请求输出 `Image.url` 与 `Image.description`，头像不再为空。
- 真实百度 CDN 头像验证：无 Referer 请求返回 `200 image/jpeg`，携带本地页面 Referer 返回 `403`；`no-referrer` 走可用路径。
- Agent stream guard 测试覆盖 URL 先进 dataModel 后绑定 Text、URL 类 path 先到 Text 后到 dataModel、以及请求包含图片 URL 但漏生成 Image 的场景。
- 真实页面验收以“头像像素加载完成且完整进入视口”为标准，而不只检查 `<img>` 节点存在。

## M9-a: TextField Two-Way Binding

交付边界：

- core 按官方 Basic Catalog 契约校验 `TextField.label`、`TextField.value`、`variant` 与 action 挂载边界。
- core 新增 `A2UIRuntime.setInputValue`：渲染层只上报组件 ID 与新值，绑定路径仍由内核解释并写回 dataModel。
- React 标准组件新增 `TextField`，当前只开放 `shortText`，输入时写回 `value: { path }`。
- Button action 继续复用现有 `{ path }` context 解析，点击时取得用户最新输入。
- server Basic Catalog 白名单新增 `TextField`，action 新增 `search`；guard 只允许 `id/component/label/value/variant`，且 `value` 必须是 `{ path }`。
- 搜索请求的最终流强制满足 `TextField -> search Button -> searchResult`，action context 的 `keyword` 必须绑定 TextField 的同一个 path。
- `search` handler 返回包含用户输入值的 `searchResult` 原地更新。

验收结果：

- 全仓 `test / typecheck / lint / build` 于 2026-09-17 通过。
- 真实 LLM 生成搜索卡片，页面输入 `A2UI Runtime` 并点击搜索。
- action `search` 回流到同一 surface，页面更新为 `搜索：A2UI Runtime`。
- action 状态为 `done`，浏览器 error / warning 为空。

## M9-b: TextField Variants and Validation

交付边界：

- core 校验 `TextField.validationRegexp` 必须是可编译的正则字符串，并继续校验官方四类 `variant`。
- React 将 `shortText` 渲染为单行输入、`longText` 为 textarea、`number` 为数字输入、`obscured` 为密码输入。
- React 在 `validationRegexp` 校验失败且输入已失焦时输出红色错误、`aria-invalid="true"` 与 `aria-describedby`；修正后清除错误。
- server guard 允许 `validationRegexp`，要求数据双向绑定，限制正则长度为 256，并在进入 SSE 前拒绝非法正则与未授权字段。
- LLM prompt 只允许用户显式提供正则时输出 `validationRegexp`，并要求逐字复制。
- 继续不支持 `checks`、FunctionCall 与自定义校验文案，避免把通用校验系统一次性引入 MVP。

验收结果：

- core / React / server 测试覆盖四类变体、非法正则与错误反馈。
- 真实 LLM 请求输出四类 `TextField`，编号字段携带 `"validationRegexp":"^[A-Z0-9]{6}$"`。
- 页面输入 `abc` 失焦后显示“格式不符合要求”，修正为 `ABC123` 后错误清除。
- 生成状态为 `done`，浏览器 error / warning 为空。

## M10: CheckBox Two-Way Binding and Minimal Submit Loop

交付边界：

- core 按官方 Basic Catalog 契约校验 `CheckBox.label` 与 `CheckBox.value`；`value` 只能是布尔值或 `{ path }` 绑定。
- `A2UIRuntime.setInputValue` 扩展为接受 `string | boolean`：TextField 只接受字符串，CheckBox 只接受布尔值，绑定 path 仍由 core 解释。
- React 新增原生 checkbox 渲染，用户切换后立即写回 dataModel。
- server Basic Catalog 白名单新增 `CheckBox`，action 新增 `submit`；guard 只允许 `id/component/label/value`，且 `value` 必须是 `{ path }`。
- 表单请求最终流强制满足 `TextField + CheckBox -> submit Button -> submitResult`；submit context 必须同时绑定文本输入与布尔输入。
- guard 检查表单关键组件必须从 `root` 渲染树可达，避免模型声明组件但页面上不可见。
- `submit` handler 返回包含最新 `name` 与 `subscribed` 的 `submitResult` 原地更新。
- 继续不支持 `checks`、跨字段校验、ChoicePicker、Slider 和 DateTimeInput。

验收结果：

- core / React / server 测试覆盖 CheckBox 官方字段、布尔写回、submit context、非法挂载 action、未知字段与不可达表单组件。
- 真实 LLM 生成订阅表单，页面出现姓名 TextField、接收通知 CheckBox、提交 Button 与结果 Text。
- 页面输入 `A2UI Runtime` 并勾选 CheckBox 后提交，`submitResult` 更新为 `已提交：name=A2UI Runtime，subscribed=true`。
- 生成状态与 action 状态均为 `done`，浏览器 error / warning 为空。
