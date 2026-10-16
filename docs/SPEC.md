# SPEC — SDK 契约

更新：2026-10-16。上游 [PRD](PRD.md)，结构 [ARCHITECTURE](ARCHITECTURE.md)，决策 [DESIGN](DESIGN.md)，交付状态 [CURRENT](tasks/CURRENT.md)。§1–§3 描述本轮源码核对的现状；§4–§8 是已决策、尚待实现的目标契约。目标 API 和 wire 变更不能当作当前可用能力。

## 0. 术语与权威

| 术语             | 权威与范围                                              |
| ---------------- | ------------------------------------------------------- |
| surface          | 组件声明、dataModel 与界面 revision；不证明任何业务事实 |
| Profile          | Nexus 开放的 A2UI v0.9 子集，不等于官方 Basic Catalog   |
| Catalog Contract | 宿主能力声明及其版本/hash；hash 仅证明内容一致          |
| run              | 一次生成或 action/patch 的 SDK 运行；不等于业务操作     |
| Host             | 持有身份、权限、业务事实、领域事务与业务结果            |
| Agent            | 提供不可信候选消息；业务分析/工具/模型由接入方定义      |

## 1. 当前 A2UI 消息与 Profile

server→client 消息采用 A2UI `version: 'v0.9'`，每个信封恰好一个 payload。生成流先 `createSurface(surfaceId, catalogId)`，再发送 `updateComponents` 与 `updateDataModel`；patch 只更新相同 surface。`createSurface` 不内嵌组件或 dataModel。core 支持 `deleteSurface`，当前 guarded Agent 流拒绝它。

```jsonl
{"version":"v0.9","createSurface":{"surfaceId":"s-1","catalogId":"https://example.com/catalogs/demo/v1"}}
{"version":"v0.9","updateComponents":{"surfaceId":"s-1","components":[{"id":"root","component":"Column","children":["title"]},{"id":"title","component":"Text","text":{"path":"/title"}}]}}
{"version":"v0.9","updateDataModel":{"surfaceId":"s-1","value":{"title":"任务界面"}}}
```

组件采用扁平 ID 表，容器通过 `children`/`child`/`tabs` 引用，绑定采用 JSON Pointer。生成流须含 `root`；action 流仅允许 `updateComponents`/`updateDataModel`。

当前 17 个标准组件为 Text、Image、Icon、Row、Column、List、Card、Tabs、Divider、Button、TextField、CheckBox、ChoicePicker、DateTimeInput、Slider、Video、AudioPlayer。List 仅静态 children；Button 仅 `action.event`。TextField/Slider/Button 的 checks 子集为 required、regex、length、numeric、email。

不支持任意 FunctionCall、组合 checks、ChildList 模板、Modal、`sendDataModel` 端到端和 WebSocket/A2A/MCP transport。Theme 被保存但标准 React 组件尚不消费。自定义组件受 Catalog 与 Profile 共同约束，当前自定义输入/action 仍受硬编码限制。

安全准入基线：`__proto__`/`constructor`/`prototype` 为保留段。`action.event.context` 的键与组件 props 层（非结构键）的自有键含保留段一律拒绝；`component.id` 与四处 `surfaceId` 三段全拒。Image/Video/AudioPlayer 的字面量 `url` 必须是 http(s) URL（core 公开 `isSafeMediaUrl`，经 URL 解析判定 protocol，不做字符串前缀匹配）；`{ path }` 绑定放行准入，由 React 三个媒体组件在解析后复用同一判定守卫，非法时不输出 `src` 并渲染带说明性 alt/aria 的占位。运行层防御与准入同口径：`resolveContext` 遇保留段键显式抛错，`buildProps` 跳过保留段键不写入 props。

组件表、Catalog schema/Policy 表与 renderMap 查表只读取自有属性；renderMap 条目须为函数，未知或非法条目降级为占位，不调用原型链成员。`maxNodes`、`maxDepth`、`maxElements` 与各 store 的容量预算必须为正安全整数；非法值在 runtime/store 初始化或直接渲染调用时显式抛错，空树不跳过配置校验，零不表示关闭限制。

校验链为 Protocol → Profile → Catalog → 显式 Host Policy。已有诊断码为 `PROTOCOL_INVALID`、`LIFECYCLE_INVALID`、`FEATURE_UNSUPPORTED`、`CATALOG_UNSUPPORTED`、`POLICY_REJECTED`。诊断可带 `path`、`message`、`dataPath`。client→server 消息由服务端 action 边界处理，不属于 core 的 server→client 流入。

官方用例历史基线（2026-09-30）：9 份用例，33 pass、47 已决策偏差、0 fail，位置为 `packages/nexus-core/tests/conformance-baseline.json`。偏差为 profile-unsupported 16、profile-catches-protocol-loose 23、degraded-value-constraint 5、scope-client-to-server 3。这个分类结果不代表完整协议一致性；当前改动须重跑 conformance 后才能声明无回归。

## 2. 当前 Catalog 与公开 API

CatalogDefinition 目前包含 `catalogId`、`components`、可选 `actions`、`componentSchemas` 和 `componentPolicies`。schema 是明确受限的 JSON-Schema-like 子集；`dynamic` 描述字面值/绑定约束，不能当作任意 JSON Schema 引擎。`pattern` 与 checks 路径同口径：注册闸门强制长度上限（200）并拒绝嵌套量词；求值统一走 `compileSafeRegExp` 有界线性引擎，编译失败（超限/不受支持语法）产生 schema 诊断，不再裸用原生 RegExp。

`createCatalogPromptContract` 从声明生成提示。server 发布 Catalog Contract v1 与 SHA-256 hash，并提供 discovery。它们用于契约识别和缓存，不是鉴权凭据。

**当前差距**：core 在 `actions` 缺省时不执行 action 名称白名单检查；未声明 schema 的组件可仅做名称检查。不得把“所有未声明能力均被拒绝”作为当前统一保证。目标见 §4。server 侧已移除示例 actions 回退与默认业务 Policy：示例 Catalog、LLM 调用、演示 handler 与搜索/表单/Workbench 流程 Policy 已迁至 `examples/playground-server/`。

当前公开根入口只有 `@nexus-ui/core`、`@nexus-ui/react`、`@nexus-ui/server`，包版本为 0.1.x、根 API 版本均为 1。React 0.1.x 的现有兼容声明为 core 0.1.x / core API 1 / v0.9。深路径和源码路径不承诺兼容。

server 根入口提供 AgentAdapter、router、guard 校验函数、Policy 注入、Catalog contract/discovery、RPC、verifier、history/run 实现与 `sendAgentRun` 等装配能力。装配依赖全部显式：`registry` 必填；`historyStore` 缺省为每 adapter 实例隔离新建；`useLlm` 默认 false，启用必须显式注入 `streamLlm`；generate 请求 `catalogId` 必填，不回落默认 Catalog；`sendAgentRun` 必须显式传入 `manager`。SDK 根入口无 listener、不读取项目环境、不依赖模型 SDK。参考工厂自行装配演示 Policy，局部覆盖仅替换对应 hook；SDK 不继承这些默认值。三包构建先清理旧 dist，产物清单必须与当前 src 对应，已迁出模块和测试不得残留。

## 3. 当前 HTTP、RPC 与提交语义

当前参考 HTTP 路由：

| 路由                                        | 当前行为                                             |
| ------------------------------------------- | ---------------------------------------------------- |
| `POST /api/a2ui/generate`                   | 接收 `message?`、`catalogId`（必填），返回 SSE       |
| `POST /api/a2ui/event`                      | 接收 v0.9 action 信封，返回同 surface patch          |
| `GET /api/a2ui/catalog-contract?catalogId=` | 返回已发布 Catalog Contract                          |
| `GET /api/a2ui/published-catalogs`          | 返回显式发布的 Catalog 摘要与 URL                    |
| `GET /api/a2ui/agent-onboarding?catalogId=` | 返回 Agent 接入约束与验收描述                        |
| `GET /api/a2ui/runs?surfaceId=`             | 运行记录查询；宿主 `runsAccess` 准入，未配置默认 403 |

当前 action 要求 name、surfaceId、sourceComponentId、可解析 timestamp 和对象 context；解析器支持可选 actionId。顺序为 surface 锁 → 快照与 action 声明核对 → handler 查找 → ledger → resolver → handler → patch guard → UI 快照提交。

默认 resolver 从服务端快照解析参数，无法取得浏览器后续输入；自定义 resolver 完全接管时，字段/路径/类型拒绝须宿主自行实现。ledger 只在进程内去重，failed 记录可能再次进入，不能作为业务重试依据。

SSE `message` 是已逐条校验的预览；`done` 在 UI 快照/相关提交成功后发送，`error` 表示运行失败。现有浏览器示例未完整落实终态识别与预览门控。当前 `sendAgentRun` 接受 Koa Context 与必填的宿主（或 router 实例）`manager`，调用时同步占用响应并自行 pipe，宿主 await/void 均逐条下发；此保证属于 Koa 适配行为。

| 资源                        | 当前默认值 / 已知限制                                                  |
| --------------------------- | ---------------------------------------------------------------------- |
| JSON 请求体                 | JSON 或 +json，1 MiB、10 s                                             |
| 外部 Agent RPC              | 15 s、2,000,000 bytes；仅 NDJSON/JSONL；空输出拒绝；AbortSignal 传播   |
| SSE 下发                    | 默认每条延迟 200 ms；背压硬上限尚待补齐                                |
| JSONL 行                    | 1,000,000 个 JavaScript 字符串代码单元；不是 HTTP 字节限制；超长行丢弃 |
| VNode / 深度 / React 元素   | 10,000 / 1,000 / 10,000                                                |
| 错误记录                    | 200 条；raw 截断 2000 字符                                             |
| run / ledger / surface 快照 | 保留配置为 512 / 1,024 / 256；不构成运行总资源的完整硬上限             |

外部生成 RPC 现有请求为 `{ version: 1, kind: 'generate', surfaceId, message, catalogId, supportedComponents, supportedActions, catalogContract, history }`，可传播 signal。成功响应为 `application/x-ndjson` 或 `application/jsonl`；失败为非 2xx 与错误信息。宿主选择 endpoint/headers/timeout，模型耗时超过默认值时须显式调高。该 RPC 是可选适配，不是所有 Agent 必须采用的协议。

## 4. 目标 Catalog 与交互准入（待实现）

目标 Catalog Contract 升至 v2，支持展示、输入与 action 能力的一致声明。现有 v1 与目标 v2 不得静默混用；内容或能力变化产生新 hash，正在运行的 surface 固定其契约版本/hash。

1. actions 必须显式声明，展示型 Catalog 使用空数组；缺失配置显式报错，不继承示例动作。
2. 发布组件须有 props schema 和能力声明；标准组件可复用 SDK 定义。未声明字段默认拒绝，不支持的 schema 配置在注册时显式报错。
3. 输入声明包含可写绑定属性及值 schema；宿主为 surface 配置允许编辑的 JSON Pointer。首发使用明确路径，不建设任意路径表达式或业务规则 DSL。
4. action 声明包含可挂载组件能力和参数 schema。由声明决定 action 来源，不按 Button/TaskButton 名称特判。
5. 浏览器提交输入只标识组件、绑定属性和新值；服务端从已提交组件声明取得路径，核对允许路径与 schema 后构造临时输入模型。不得直接 deep-merge 客户端 dataModel。
6. handler 参数从服务端持有的 action 声明及临时输入模型重新解析，并通过参数 schema。客户端 context 不是参数权威，额外字段拒绝；只读业务字段由宿主再查询和核对。
7. 通用准入成功不表示业务授权成功。宿主依据可信身份、业务对象与当前业务版本决定是否执行。

Catalog schema、绑定与 action 规则由 core 的纯模块复用。server 是权威准入点，浏览器校验用于状态正确性与反馈，不能替代 server。

## 5. 目标 session 与流契约（待实现）

### 5.1 版本与 envelope

新增 Nexus Session v1，独立于 A2UI v0.9、Catalog Contract v2 和包 API 版本。运行元数据放在 Nexus 传输 envelope，A2UI message 保持自身形状，不向 createSurface/action payload 静默追加 SDK 字段。

目标 action HTTP 请求为外层 `{ message, nexus }`：message 承载 v0.9 action 信封；nexus 承载 session version、actionId、surfaceRevision、catalogHash 和组件输入。actionId 标识一次用户提交，不代表领域幂等键。具体 TypeScript 字段签名与解析器在对应实现切片共同锁定；这些语义不再由示例各自定义。

首发流适配为 POST fetch/SSE：

| 事件      | 目标语义                                                                     |
| --------- | ---------------------------------------------------------------------------- |
| `start`   | session version、runId、surfaceId、Catalog hash、基准 revision；先于候选消息 |
| `message` | data 为原始 A2UI 消息；经校验后进入本次预览                                  |
| `done`    | runId、surfaceId、已提交 revision 与 Catalog hash；表示 UI 提交成功          |
| `error`   | runId、surfaceId、诊断与 UI commitState；不表示业务失败                      |

每条流只能有一个终态；终态后 message 或第二个终态视为无效流。EOF 前未收到终态为运行不完整；content-type、frame/响应大小、超时与 reader 清理均受约束。首发不自动重试 action、不承诺断点续传或 exactly-once。

### 5.2 三种状态

| 状态           | 语义                                                                    |
| -------------- | ----------------------------------------------------------------------- |
| core surface   | A2UI 消息产生的组件/dataModel 状态；core 不把每组消息当事务             |
| SDK run        | queued → running → succeeded / failed / canceled；另报告 UI commitState |
| Host operation | 宿主定义的业务结果，SDK 不推导或固化其领域状态机                        |

UI commitState 为 notCommitted、committed 或 unknown。服务端按已知提交事实报告；客户端未获得可信终态时保守使用 unknown，即使 TCP 正常关闭也不能推断未提交。

成功 done 且本地消息全部通过校验，client 才把本次预览提升为已提交视图并开放 action。失败/取消丢弃本次预览；保留原已提交视图用于展示。commitState unknown、客户端与服务端 revision/hash 不一致或 done 后本地校验失败时，将该 surface 标记失同步并禁用 action，直到显式恢复/重新生成。

恢复通过宿主提供的受控 surface 快照或重新生成完成；快照必须核对 revision/hash 并重新经过校验。业务结果恢复由宿主回调或查询实现，可使用宿主提供的不透明操作关联标识。SDK 不推断业务可重试，也不回滚已执行副作用。

## 6. 目标 server runtime（待实现）

- 生成源、registry、Host Policy、handler、状态实现均显式装配；缺少必需依赖报错。可提供确定性的可选标准 Catalog 工厂，不使用模型 key 或业务词选择默认行为。
- 同一 runtime 的 surface 调度覆盖快照读取、revision/hash 核对、输入/action 准入、handler 和 patch 提交；handler 不得在排队准入前执行。HTTP 适配器不拥有第二套 surface 锁。
- snapshot commit 是 UI revision 的发布点。确认失败发生在发布前报告 notCommitted；存储写入结果不确定时报告 unknown，不能仅凭写入异常推断未提交。发布后传输/观察者失败不能改写成未提交。history/观测为显式可选扩展，不伪装成与宿主数据库的原子事务。
- default store、ledger、scheduler 按 runtime 实例隔离；可替换存储不意味着支持多实例一致性。首发只保证单实例调度，宿主另行处理跨实例业务幂等。
- 取消关闭候选源、reader、监听器和排队任务；已经开始的宿主操作能否取消由 handler 决定。资源超限须显式拒绝，禁止无限排队、缓冲或淘汰运行中保护记录。
- HTTP 适配在读取/公开 surface 数据及执行 action 前调用宿主访问准入。认证主体来自可信请求上下文；surfaceId、catalogHash 与客户端 context 都不是凭据。参考应用的本地演示模式须显式配置，不能作为公网默认授权。
- Koa 适配保持调用时响应占用与 await/void 时序；非 Koa 消费无需构造 Koa Context，即可复用相同运行逻辑与准入结果。

## 7. 目标 React 与 client 组合（待实现）

client 对外提供会话控制器；其 TypeScript API 在实现时以 `createClientSession` 为入口定型，包含稳定 runtime、会话/surface 状态订阅、生成/action、取消、恢复及 dispose。transport 可注入；首发自带 fetch/SSE，核心会话状态机不依赖 React 或 Node server 包。

React 以 `A2UIProvider` 提供稳定 runtime/context，以新增 `A2UISurface` 按 surfaceId 渲染；Provider 不隐式输出 surface。宿主可只传本地 runtime，不必创建网络 session。会话接入还需提供按 surface 订阅的交互可用状态，Surface 与动作出口均执行门控。

订阅必须可解除；外部 runtime/session 由创建者销毁，Provider 自建 runtime 由 Provider 销毁。renderMap、回调和父组件重渲不得意外重置 runtime；两个 Surface 的状态、删除和生命周期隔离。样式由宿主显式选择，不在 import 时注入全局动画。

## 8. 版本迁移与验证

当前三包 API 1 保持“现状”标识，目标改造涉及 Provider 行为、默认依赖、Catalog 与 HTTP envelope 的破坏性变化。各切片同步公开根导出快照、消费方、迁移说明；交付新的破坏性契约时提升相应 API 版本。包版本与 workspace 安装规则遵循 AGENTS.md，文档定稿不提前改包版本。

新增 client 后，只通过四包公开入口消费；不强制所有应用安装四包。协议/Profile 与组件能力校验使用共享正常/非法 fixture 在 core、server 和 client/React 接入验证，不等待业务应用重建。conformance 变更须显式更新分类理由和基线。

发行须对当前产物做仓外干净安装、types/exports/依赖/兼容检查及真实浏览器关键路径验收。当前 workspace 测试和历史数字只证明对应快照；任务状态与执行命令见 CURRENT。

### 8.1 目标发行产物（待实施）

首发每包交付可原生加载的 ESM `.js` 与 `.d.ts`；建议 `.js.map`，发布时保证源码映射可用。视图包可提供显式公开的样式入口，宿主按需引入；当前 React 仍在 import 时注入动画，独立 CSS 尚未交付。不提供 CJS、UMD 或 IIFE；包内不重复捆绑 React/Vue，框架依赖以 peer dependency 声明，内部包按依赖关系消费。

当前构建仍使用 `fix-esm-imports.mjs` 补齐相对路径。目标以显式 `.js` 源码路径和 NodeNext 配置在编译时保证 Node ESM 可解析性；通过产物原生加载、类型解析和浏览器打包验证后才移除脚本。宿主通过公开包入口消费，不运行 SDK 构建脚本。

### 8.2 公开入口与高层 API（目标）

目标各包提供独立公开根入口，宿主按环境与框架安装选用；暂不提供统一重导出四包的总门面包。高层接入能力在职责内聚合：client 管会话，React 管视图，server 管运行装配，core 保持可独立消费。浏览器入口不重导出 Node server；框架无关入口不引入 React/后续 Vue。精确 API 随实现切片定型，兼容与产物门禁须验证层间组合，不以 tree shaking 替代环境边界。
