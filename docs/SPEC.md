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

当前 17 个标准组件为 Text、Image、Icon、Row、Column、List、Card、Tabs、Divider、Button、TextField、CheckBox、ChoicePicker、DateTimeInput、Slider、Video、AudioPlayer。List 仅静态 children；Button 仅 `action.event`。标准声明默认仅为 TextField/Slider/Button 启用 checks，子集为 required、regex、length、numeric、email；宿主可在自己的 Catalog 中显式启用其他组件的 checks。

不支持任意 FunctionCall、组合 checks、ChildList 模板、Modal、`sendDataModel` 端到端和 WebSocket/A2A/MCP transport。 FunctionCall 豁免仅限通过结构与函数白名单校验的 `updateComponents.components[].checks[].condition`，仍递归检查其参数；普通 props、dataModel、theme 的同名 checks 键没有豁免。Theme 被保存但标准 React 组件尚不消费。自定义组件受 Catalog 与 Profile 共同约束，当前本地输入写回仍受硬编码限制（S2.3）；checks/action 挂载能力由当前 Catalog 决定。

安全准入基线：`__proto__`/`constructor`/`prototype` 为保留段。`action.event.context` 的键与组件 props 层（非结构键）的自有键含保留段一律拒绝；`component.id` 与四处 `surfaceId` 三段全拒。Image/Video/AudioPlayer 的字面量 `url` 必须是 http(s) URL（core 公开 `isSafeMediaUrl`，经 URL 解析判定 protocol，不做字符串前缀匹配）；`{ path }` 绑定放行准入，由 React 三个媒体组件在解析后复用同一判定守卫，非法时不输出 `src` 并渲染带说明性 alt/aria 的占位。运行层防御与准入同口径：`resolveContext` 遇保留段键显式抛错，`buildProps` 跳过保留段键不写入 props。

组件表、Catalog schema/Policy 表与 renderMap 查表只读取自有属性；renderMap 条目须为函数，未知或非法条目降级为占位，不调用原型链成员。`maxNodes`、`maxDepth`、`maxElements` 与各 store 的容量预算必须为正安全整数；非法值在 runtime/store 初始化或直接渲染调用时显式抛错，空树不跳过配置校验，零不表示关闭限制。

校验链为 Protocol → Profile → Catalog → 显式 Host Policy。已有诊断码为 `PROTOCOL_INVALID`、`LIFECYCLE_INVALID`、`FEATURE_UNSUPPORTED`、`CATALOG_UNSUPPORTED`、`POLICY_REJECTED`。诊断可带 `path`、`message`、`dataPath`。client→server 消息由服务端 action 边界处理，不属于 core 的 server→client 流入。

轻量 core runtime 未注入 `catalogRegistry` 时只执行 Protocol/Profile，不提供 Catalog 能力准入保证，也不隐式采用 SDK 标准声明；宿主需显式注入自己的 Catalog 来限制 checks/action 能力。

官方用例当前基线（2026-10-17）：9 份用例，36 pass、44 已决策偏差、0 fail，位置为 `packages/nexus-core/tests/conformance-baseline.json`。偏差为 profile-unsupported 13、profile-catches-protocol-loose 23、degraded-value-constraint 5、scope-client-to-server 3。此次 checks 能力准入从 Profile 移至 Catalog 后，ChoicePicker 的 valid checks / length validation 与 CheckBox 的 valid checks 共 3 条由 Profile 不支持转为 pass；DateTimeInput 的 valid checks 用例仍因缺少 enableDate/enableTime 被拒，仅拒绝原因变化。此基线测试 Protocol/Profile，不证明默认标准 Catalog 已启用这些 checks，也不代表完整协议一致性。历史 2026-09-30 基线为 33 pass / 47 偏差；后续改动须重跑并解释分类变化。

## 2. 当前 Catalog 与公开 API

CatalogDefinition 已切换为 v2 形状（S2.2，2026-10-16）：`catalogId`、组件声明表 `components`（每组件必含 `schema` 与能力声明）与必填 `actions`；v1 的 components 数组/`componentSchemas`/`componentPolicies` 已移除。绑定能力唯一权威是 schema 节点的 `dynamic`（缺省即 `forbidden`），`fields` 只承载 origin/componentRef 元数据。schema 是明确受限的 JSON-Schema-like 子集；未知关键字注册即拒绝，`minItems` 已纳入子集。`pattern` 注册口径与求值口径一致：注册闸门强制长度上限（200）、拒绝嵌套量词，并直接经 `compileSafeRegExp` 有界线性引擎编译，引擎不支持的语法（环视等）注册即拒绝。17 个标准组件的声明由 core 公开 `standardCatalogComponentDeclarations()` 提供，宿主按名组合或覆盖。

`createCatalogPromptContract` 从声明生成提示。server 发布 Catalog Contract v2 与 SHA-256 hash，并提供 discovery。它们用于契约识别和缓存，不是鉴权凭据。

**当前差距**：注册闸门已实施 §4.2 全部拒绝规则（含配置类型校验：布尔 enabled/componentRef、非负安全整数预算、非空字符串 catalogId），Catalog Contract 版本已升至 2；Profile 只校验 checks 结构与受支持函数的安全基线，不按组件名决定启用能力；当前 Catalog 的 checks 声明是能力、函数子集与预算的权威，action 挂载来源由 Catalog `sources` 决定；字段结构契约（含 Slider min<max 等跨字段约束与媒体 URL/validationRegexp 正则、原型与预算基线）保留在 Profile。标准声明工厂返回深拷贝，跨实例互不共享；inputs 值 schema 全树禁止 `dynamic`；未注册 action 名与 sources 越权由共享 Catalog 诊断统一报告（runtime 不再另设一套）；成员判断统一只读自有属性。浏览器本地写回与输入收集已按 §4.3 第一条实施（S2.3，2026-10-18）：`setInputValue` 与输入草稿由当前 Catalog `inputs` 声明驱动。server 权威准入端（§4.3 其余条目）与 client 输入链路尚未实施。server 侧已移除示例 actions 回退与默认业务 Policy：示例 Catalog、LLM 调用、演示 handler 与搜索/表单/Workbench 流程 Policy 已迁至 `examples/playground-server/`。

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

目标 Catalog Contract 升至 v2，支持展示、输入与 action 能力的一致声明。现有 v1 与目标 v2 不得静默混用；内容或能力变化产生新 hash，正在运行的 surface 固定其契约版本/hash。契约类型已在 core 公开入口定型（`CatalogDefinitionV2` 等，注册闸门切换后替换 v1 `CatalogDefinition` 形状并移除 V2 后缀）；共享正常/非法 fixture 定稿于 `fixtures/catalog-v2/`，core 注册与 server 准入对同一数据必须给出一致结论。

### 4.1 v2 声明形状

| 声明                                | 字段                                                                    | 约束                                                                                                                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CatalogDefinitionV2`               | `catalogId`、`components`、`actions`                                    | `actions` 必填，展示型显式 `[]`；`components` 为组件名到声明的表，每个发布组件必须携带完整声明，name-only 条目不再存在                                                       |
| `CatalogComponentDeclaration`       | `schema`（必填）、`fields?`、`inputs?`、`action?`、`checks?`、`origin?` | `fields`/`inputs` 的键必须是 `schema.properties` 已声明字段；`inputs` 键还必须是 `dynamic` 非 `forbidden` 的可绑定字段，值 schema 描述浏览器提交的字面值、不得声明 `dynamic` |
| `CatalogFieldPolicyV2`              | `origin?`、`componentRef?`                                              | 只承载字段元数据；绑定能力唯一权威是 schema 节点的 `dynamic`（未声明即 `forbidden`），`fields` 不再声明 `binding`                                                            |
| `CatalogActionDeclaration`          | `name`、`sources`、`paramSchema?`                                       | `sources` 是允许挂载该 action 的组件名（非空、无重复、均为已声明组件）；`paramSchema` 缺省表示重算参数必须是空对象                                                           |
| `CatalogComponentActionRequirement` | `required?`                                                             | 组件侧只声明「必须挂载」；挂载权威在 `sources`                                                                                                                               |

可选与缺失必需的区分：`fields`、`origin` 缺省表示无附加元数据；`inputs`、`checks`、`paramSchema`、`action.required` 缺省表示该能力关闭（默认拒绝），均不继承任何默认值。绑定能力只在 schema 上声明一次：`dynamic` 缺省即 `forbidden`，不存在 schema 与 fields 双源解释。`catalogId`、非空 `components`、`actions` 数组与每个组件的 `schema` 缺失即注册报错。

### 4.2 注册期拒绝（宿主装配时显式报错；S2.2 已实施，fixture 对测见 `fixtures/catalog-v2/`）

- 未知键一律拒绝：`CatalogDefinitionV2`、组件声明、action 声明、字段/checks/action policy 与 schema 节点出现未定义键（含拼写错误）即报错，不静默忽略；`fields` 中的 `binding` 键属 v1 双源声明，同样按未知键拒绝。
- 不支持的 schema 语法注册报错；`pattern` 的注册口径与运行期有界求值引擎一致——原生 RegExp 可编译但 `compileSafeRegExp` 不支持的语法在注册时拒绝，不允许先注册再在取值时失败。
- 矛盾声明拒绝：`action.required` 组件不在任何 `sources` 中；`inputs` 指向不可绑定字段；`fields` 键不在 `schema.properties` 中；`checks.enabled` 为 true 但 `functions` 为空；`sources` 引用未声明组件。
- 校验收紧：`checks.functions` 必须是受支持函数子集；`binding`/`origin` 枚举值非法即报错（v1 对两者静默放行）。
- 标准组件复用 SDK 以同一声明机制提供的定义，宿主按需组合；不另保留按组件名驱动的输入/checks/action 解释器。

### 4.3 输入与参数准入（服务端权威）

- 浏览器本地写回（已实施，S2.3）：渲染层只上报 `{ componentId, property, value }`，core 的 `setInputValue` 按当前宿主 Catalog 从已提交组件的 `{ path }` 绑定解析目标路径，并按该属性 `inputs` 声明的值 schema 严格校验字面值。未注入 registry、组件或属性未声明（`inputs` 键是唯一可写入口）、值不符、绑定缺失、保留段路径与写路径失败（如中间节点非容器）一律显式拒绝，已提交状态与输入草稿保持不变；写回成功才更新本地 dataModel 并记录输入草稿。草稿按 surface 保存「组件 + 绑定属性」的最新值，调用入参、模型、草稿与每次 `getLatestInputs` 返回的 `NexusActionInput[]` 均持有独立值快照。草稿关联写入时的 Catalog、组件类型、绑定路径及组件能力声明；每次接受组件更新后立即清除失效条目（类型改变、绑定缺失或改址、属性不可写、声明变化），提取时再次核对来源并清除失效项。恢复原组件或路径不会复活旧草稿；同类型同绑定且声明未变的属性更新保留草稿；被拒的组件更新不使草稿失效。`deleteSurface` 清理该 surface。本地校验只服务状态正确性，不能替代服务端权威准入。
- 可编辑范围为宿主在可信装配中按 surface 提供的精确 JSON Pointer 白名单：绝对指针（RFC 6901）、拒绝空串根指针、规范化后重复即配置错误、默认拒绝、不做通配或前缀继承。白名单自身允许嵌套重叠（如同时允许 `/profile` 与 `/profile/name`）。
- 浏览器输入只提交 `{ componentId, property, value }`；服务端在 surface 锁内从已提交组件声明解析目标路径，逐项核对声明、白名单与值 schema。客户端提交目标写路径、未声明属性、错误类型均整批拒绝；同批 `inputs` 的写入与数组顺序无关——重复（同组件同属性）、同目标路径、以及解析路径互为祖先/后代（按 JSON Pointer 段比较，如 `/profile` 与 `/profile/name`）都判冲突拒绝；任一项失败不产生局部写入。未变化输入合法，按普通输入幂等写回。
- handler 参数由服务端从已提交 action 声明与临时输入模型重新解析，并按 `paramSchema` 校验。客户端 `context` 键必须是已声明绑定字段，且值不作为参数权威；自定义 resolver 只能在共享准入之后扩展参数，其输出仍须通过未声明字段拒绝与参数 schema，不得把被拒输入重新变为可执行 action。准入成功不表示业务授权成功，身份、对象归属与事务由宿主 handler 判断。

Catalog schema、绑定与 action 规则由 core 的共享纯模块实现，server 不复制第二套组件/输入语义。

### 4.4 失败语义

注册期失败在宿主装配时抛错；运行期拒绝返回结构化失败且满足同一不变式：handler 未调用、已提交快照与 revision 不变。运行拒绝类别：envelope 缺失 `nexus` 或 `sessionVersion` 非 1（旧格式显式拒绝）；revision/hash 与快照固定值不一致；未声明组件/action/属性；越权或伪造路径；schema 不符；重复/冲突输入；action 未注册 handler（既有）。浏览器本地校验只服务状态正确性与反馈，不能替代服务端权威准入。

## 5. 目标 session 与流契约（待实现）

### 5.1 版本与 envelope

新增 Nexus Session v1，独立于 A2UI v0.9、Catalog Contract v2 和包 API 版本。运行元数据放在 Nexus 传输 envelope，A2UI message 保持自身形状，不向 createSurface/action payload 静默追加 SDK 字段。

目标 action HTTP 请求为外层 `{ message, nexus }`：message 承载 v0.9 action 信封（形状不变）；nexus 承载 SDK 元数据。签名已在 core 公开入口定型：`NexusActionMetadata` 含 `sessionVersion`（字面量 1，常量 `NEXUS_SESSION_VERSION`）、`actionId`（非空字符串，标识一次用户提交，不代表领域幂等键）、`surfaceRevision`（正安全整数）、`catalogHash`（`sha256:` 加 64 位十六进制）与 `inputs`（`NexusActionInput[]`，元素为 `{ componentId, property, value }`）。解析规则：缺失 `nexus` 或 `sessionVersion` 非 1 显式拒绝；`message.action.actionId` 若存在必须与 `nexus.actionId` 一致；输入项出现 `componentId`/`property`/`value` 之外的键拒绝。这些语义不再由示例各自定义；S3 的 start/done/error 复用同一 session 版本基线，不向 A2UI payload 追加字段。

浏览器的 action 基准必须对应其实际渲染的那次 UI 提交，不自行递增、猜测或从最新快照借用 revision/hash。共享类型 `NexusSurfaceCommit` 定于 core `session`，server 的 `SurfaceStateBaseline` 是其类型别名，字段为 `{ sessionVersion: 1, runId, surfaceId, catalogId, contractVersion, catalogHash, surfaceRevision }`。`runId` 是服务端分配的非空运行标识，在同一 runtime 中不复用；其余版本/hash/revision 与该次实际提交固定值一致。

revision 必须区分同一 surfaceId 的先后提交，包括重新生成，不能因重建而与仍可能提交的旧基准重号。重新生成/删除重建后的旧视图同样必须被拒；超出正安全整数或无法维持旧基准失效时显式失败，不重置为可碰撞的基准。

S2 通过按运行查询交付基准（S2.5 接线）：

- `GET /api/a2ui/surface-state?surfaceId=<id>&runId=<id>` 两项必填，缺失/空值返回 400；先执行宿主 `runsAccess(surfaceId, ctx)`，未配置或拒绝均为 403，再查询该 surface 下的运行结果。
- server 在发布 UI revision 的提交边界保存不可变的 `NexusSurfaceCommit`，先于成功 `done` 可见；不能等查询时再读取最新 surface 拼装。200 响应只返回指定运行的固定结果，即使同一 surface 后续已有其他提交，历史结果也不改变。surface/run 不存在、两者不匹配或结果已淘汰返回 404；运行存在但尚无可确认的 UI 提交结果返回 409。任何不可用情况均不得回退到最新基准；留存条数有界，记录淘汰允许查询失败，运行标识不得复用。
- 生成与 action 的 SSE 响应在 S2.5 显式携带 `X-Nexus-Run-Id` 响应头（跨源使用时须暴露该头），值与本次运行及其 SSE event id 前缀一致；浏览器把响应、已校验消息与成功 `done` 作为同一次本地运行关联，不能通过解析 event id 格式或查询最新 run 猜测标识。A2UI 消息及 S2 的 SSE data 形状不加字段。
- 只有本地该次流成功、消息全部校验通过，且查询响应的 session version/runId/surfaceId/catalogId 与本地运行一致、contractVersion/hash 与所用 Catalog 一致时，才能把该次视图与基准成对启用。查询失败、收到晚到的旧运行结果或本地校验失败时不开放 action；保留查询所归属的本地运行，不能把结果贴到另一份视图。
- 另一提交无论发生在流完成后查询前，还是查询后 action 前，都不能替旧视图刷新基准：例如本地渲染 run A/revision 1，run B 已提交 revision 2，查询 A 仍返回 1，下一枚 action 因旧 revision 被拒。此时禁用该 surface 的 action，通过重新生成或受控完整快照恢复视图与基准；仅重新查询元数据或让用户再次点击不能恢复一致性。

S3 的成功 `done` 直接复用 `NexusSurfaceCommit`，`start` 继续报告本次运行的基准，按运行查询保留为结果对账用途；查询元数据本身不是视图恢复接口。上述查询、结果留存、响应头与浏览器接线属于 S2.5，本次 S2.1 只锁定类型与验收数据。

首发流适配为 POST fetch/SSE：

| 事件      | 目标语义                                                                     |
| --------- | ---------------------------------------------------------------------------- |
| `start`   | session version、runId、surfaceId、Catalog hash、基准 revision；先于候选消息 |
| `message` | data 为原始 A2UI 消息；经校验后进入本次预览                                  |
| `done`    | `NexusSurfaceCommit`：本次运行固定的提交结果；表示 UI 提交成功               |
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

Catalog Contract 版本在 S2 升至 2：hash 算法不变（对 `{ contractVersion, catalog }` 稳定序列化取 SHA-256），版本常量提升后全部 hash 随之变化；输入能力、action 参数 schema 与组件声明都进入发布内容，能力变化必须影响 hash。surface 快照在创建时固定 `contractVersion` 与 `catalogHash`，请求携带值与固定值不一致显式拒绝，registry 原地变更不回写已创建 surface。v1 的拒绝点是明确的：v1 形状 Catalog 在注册闸门报错，缺 `nexus` 的 action 请求在解析入口拒绝，不维护 v1/v2 两套通用解释器。迁移样例以 `fixtures/catalog-v2/` 的正常夹具与 S2.6 的最小接入样例为准；各包 API 版本随其破坏性行为落地的切片提升并同步消费方。

新增 client 后，只通过四包公开入口消费；不强制所有应用安装四包。协议/Profile 与组件能力校验使用共享正常/非法 fixture 在 core、server 和 client/React 接入验证，不等待业务应用重建。conformance 变更须显式更新分类理由和基线。

发行须对当前产物做仓外干净安装、types/exports/依赖/兼容检查及真实浏览器关键路径验收。当前 workspace 测试和历史数字只证明对应快照；任务状态与执行命令见 CURRENT。

### 8.1 目标发行产物（待实施）

首发每包交付可原生加载的 ESM `.js` 与 `.d.ts`；建议 `.js.map`，发布时保证源码映射可用。视图包可提供显式公开的样式入口，宿主按需引入；当前 React 仍在 import 时注入动画，独立 CSS 尚未交付。不提供 CJS、UMD 或 IIFE；包内不重复捆绑 React/Vue，框架依赖以 peer dependency 声明，内部包按依赖关系消费。

当前构建仍使用 `fix-esm-imports.mjs` 补齐相对路径。目标以显式 `.js` 源码路径和 NodeNext 配置在编译时保证 Node ESM 可解析性；通过产物原生加载、类型解析和浏览器打包验证后才移除脚本。宿主通过公开包入口消费，不运行 SDK 构建脚本。

### 8.2 公开入口与高层 API（目标）

目标各包提供独立公开根入口，宿主按环境与框架安装选用；暂不提供统一重导出四包的总门面包。高层接入能力在职责内聚合：client 管会话，React 管视图，server 管运行装配，core 保持可独立消费。浏览器入口不重导出 Node server；框架无关入口不引入 React/后续 Vue。精确 API 随实现切片定型，兼容与产物门禁须验证层间组合，不以 tree shaking 替代环境边界。
