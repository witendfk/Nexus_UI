# SPEC — SDK 契约

更新：2026-10-30。上游 [PRD](PRD.md)，结构 [ARCHITECTURE](ARCHITECTURE.md)，决策 [DESIGN](DESIGN.md)，交付状态 [CURRENT](tasks/CURRENT.md)。§1–§3 描述当前实现，§4 的 Catalog/交互准入已实施；§5–§8 按条目标明已交付和后续目标，不能将待实施能力当作当前保证。

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

不支持任意 FunctionCall、组合 checks、ChildList 模板、Modal、`sendDataModel` 端到端和 WebSocket/A2A/MCP transport。 FunctionCall 豁免仅限通过结构与函数白名单校验的 `updateComponents.components[].checks[].condition`，仍递归检查其参数；普通 props、dataModel、theme 的同名 checks 键没有豁免。Theme 被保存但标准 React 组件尚不消费。自定义组件受 Catalog 与 Profile 共同约束；本地输入写回由当前 Catalog `inputs` 声明驱动，未声明即拒绝（S2.3，§4.3）；checks/action 挂载能力由当前 Catalog 决定。

安全准入基线：`__proto__`/`constructor`/`prototype` 为保留段。`action.event.context` 的键与组件 props 层（非结构键）的自有键含保留段一律拒绝；`component.id` 与四处 `surfaceId` 三段全拒。Image/Video/AudioPlayer 的字面量 `url` 必须是 http(s) URL（core 公开 `isSafeMediaUrl`，经 URL 解析判定 protocol，不做字符串前缀匹配）；`{ path }` 绑定放行准入，由 React 三个媒体组件在解析后复用同一判定守卫，非法时不输出 `src` 并渲染带说明性 alt/aria 的占位。运行层防御与准入同口径：`resolveContext` 遇保留段键显式抛错，`buildProps` 跳过保留段键不写入 props。

组件表、Catalog schema/Policy 表与 renderMap 查表只读取自有属性；renderMap 条目须为函数，未知或非法条目降级为占位，不调用原型链成员。`maxNodes`、`maxDepth`、`maxElements` 与各 store 的容量预算必须为正安全整数；非法值在 runtime/store 初始化或直接渲染调用时显式抛错，空树不跳过配置校验，零不表示关闭限制。

校验链为 Protocol → Profile → Catalog → 显式 Host Policy。已有诊断码为 `PROTOCOL_INVALID`、`LIFECYCLE_INVALID`、`FEATURE_UNSUPPORTED`、`CATALOG_UNSUPPORTED`、`POLICY_REJECTED`。诊断可带 `path`、`message`、`dataPath`。client→server 消息由服务端 action 边界处理，不属于 core 的 server→client 流入。

轻量 core runtime 未注入 `catalogRegistry` 时只执行 Protocol/Profile，不提供 Catalog 能力准入保证，也不隐式采用 SDK 标准声明；宿主需显式注入自己的 Catalog 来限制 checks/action 能力。

官方用例当前基线（2026-10-17）：9 份用例，36 pass、44 已决策偏差、0 fail，位置为 `packages/nexus-core/tests/conformance-baseline.json`。偏差为 profile-unsupported 13、profile-catches-protocol-loose 23、degraded-value-constraint 5、scope-client-to-server 3。此次 checks 能力准入从 Profile 移至 Catalog 后，ChoicePicker 的 valid checks / length validation 与 CheckBox 的 valid checks 共 3 条由 Profile 不支持转为 pass；DateTimeInput 的 valid checks 用例仍因缺少 enableDate/enableTime 被拒，仅拒绝原因变化。此基线测试 Protocol/Profile，不证明默认标准 Catalog 已启用这些 checks，也不代表完整协议一致性。历史 2026-09-30 基线为 33 pass / 47 偏差；后续改动须重跑并解释分类变化。

### 1.1 core 写路径与状态规模（S4.0，2026-10-28）

数组容器的路径写入只允许修改界内元素或在 `index === length` 处紧凑追加，跳过末尾的写入拒绝；删除只允许界内元素，仍以 `undefined` 保留长度。`setValueAtPath`、`removeAtPath` 与输入共用的 `setStrictPath` 拒绝数组越界时抛公开的 `DataModelResourceLimitError`（`code: 'RESOURCE_LIMIT_EXCEEDED'`）。缺失中间节点的协议写入同样不能造稀疏数组；对象路径的既有创建语义保留。

`A2UIRuntime` 的 `RuntimeOptions` 提供以下常开预算；省略时使用默认值，显式配置必须为正安全整数，`null`、0、负数、小数和非安全整数在构造时抛错。

| 选项 | 默认值 | 作用对象与拒绝语义 |
| --- | --- | --- |
| `maxDataModelBytes` | 1,048,576 bytes（1 MiB） | 单 surface 最终 dataModel 的 UTF-8 JSON 字节；`updateDataModel` 整条拒绝，`setInputValue`/`confirmInputDrafts` 返回 false |
| `maxComponentsPerSurface` | 10,000 | 单 surface 现有与新增组件 ID 的去重总数；超限 `updateComponents` 整条拒绝 |

上述协议拒绝经 runtime 上报 `FEATURE_UNSUPPORTED`，组件/模型与有效输入草稿不因拒绝而部分写入；错误记录仍会增加。本地输入须先通过当前 Catalog 的 `inputs` 声明与值 schema，不能以缺声明时的提前拒绝证明预算生效。草稿确认将剩余新草稿恢复到临时模型后再检查预算，失败不确认任何有效条目、不部分恢复，调用方不得启用新 action 基准。

`A2UIRuntime.dispatchChecked(message: unknown): ParseResult` 返回单条消息经过 Protocol/Profile/Catalog、生命周期及应用阶段资源校验后的结果；`ok: false` 同时经既有错误出口报告。client 按每条结果决定能否接受 done，不以错误日志长度推断准入（日志有容量上限）。`dispatch(message): void` 保持兼容并委托同一路径；`parse(line)` 仍只做解析/预校验，不代表消息已应用。surface/render 观察者异常已隔离，不改变已发布事实；原始低层 store 及 action 回调由宿主自管。单条拒绝不回滚此前消息；client 将消息拒绝或异常按失同步处理，并丢弃独立候选。

资源预算不依赖 Catalog 是否注入；模型/组件规模限制属于 runtime 接受边界，公开低层 store 与 dataModel helper 不提供同等规模保证，也不构成进程内存硬配额。server 的完整快照预算（§6.6，含组件与 Catalog）与 core 的模型预算作用对象不同，不能互相替代；生成与 action 的 store 提交前数组越界均返回 `notCommitted + RESOURCE_LIMIT_EXCEEDED`。client 须独立执行本地校验，服务端已提交而本地拒绝时按 §5.2 失同步处理。

迁移：这是 0.1.x 的资源行为收紧；过去依赖数组跳写的宿主应改为紧凑追加，需要更大状态的宿主显式配置 runtime 与 server 各自预算。不改变 A2UI v0.9、Catalog Contract 2 或 Session 1 的线上形状。

## 2. 当前 Catalog 与公开 API

CatalogDefinition 已切换为 v2 形状（S2.2，2026-10-16）：`catalogId`、组件声明表 `components`（每组件必含 `schema` 与能力声明）与必填 `actions`；v1 的 components 数组/`componentSchemas`/`componentPolicies` 已移除。绑定能力唯一权威是 schema 节点的 `dynamic`（缺省即 `forbidden`），`fields` 只承载 origin/componentRef 元数据。schema 是明确受限的 JSON-Schema-like 子集；未知关键字注册即拒绝，`minItems` 已纳入子集。`pattern` 注册口径与求值口径一致：注册闸门强制长度上限（200）、拒绝嵌套量词，并直接经 `compileSafeRegExp` 有界线性引擎编译，引擎不支持的语法（环视等）注册即拒绝。17 个标准组件的声明由 core 公开 `standardCatalogComponentDeclarations()` 提供，宿主按名组合或覆盖。

`createCatalogPromptContract` 从声明生成提示。server 发布 Catalog Contract v2 与 SHA-256 hash，并提供 discovery。它们用于契约识别和缓存，不是鉴权凭据。

**当前差距**：注册闸门已实施 §4.2 全部拒绝规则（含配置类型校验：布尔 enabled/componentRef、非负安全整数预算、非空字符串 catalogId），Catalog Contract 版本已升至 2；Profile 只校验 checks 结构与受支持函数的安全基线，不按组件名决定启用能力；当前 Catalog 的 checks 声明是能力、函数子集与预算的权威，action 挂载来源由 Catalog `sources` 决定；字段结构契约（含 Slider min<max 等跨字段约束与媒体 URL/validationRegexp 正则、原型与预算基线）保留在 Profile。标准声明工厂返回深拷贝，跨实例互不共享；inputs 值 schema 全树禁止 `dynamic`；未注册 action 名与 sources 越权由共享 Catalog 诊断统一报告（runtime 不再另设一套）；成员判断统一只读自有属性。浏览器本地写回与输入收集已按 §4.3 第一条实施（S2.3，2026-10-18）：`setInputValue` 与输入草稿由当前 Catalog `inputs` 声明驱动。server 权威准入已按 §4.3 其余条目实施（S2.4，2026-10-18）：nexus 元数据核对、来源能力、整批输入校验、临时模型参数重算与 resolver 后置接线于 `AgentAdapter.prepareAction`，并以 `fixtures/catalog-v2/` 全部请求夹具对测。client 输入链路已按 §7 完成会话隔离、草稿协调与 S4 阶段验收；action HTTP envelope 解析与旧格式拒绝已在 S2.4 复审修复中接通，成功 `done` 直接携带本次固定提交结果，两个浏览器消费方据此提交最新输入；按运行结果留存与发布一致性已在 S2.5.1/.2/.5 实施；按运行查询路由与 `X-Nexus-Run-Id` 响应头已在 S2.5.3/.4 实施（2026-10-20）；RPC 完整序列化与 verifier 按本次 done 固定结果对账已在 S2.5.6 实施（2026-10-20）。消费方迁移已在 S2.6 实施（2026-10-20）：参考服务实际入口发布执行 Catalog 并装配可信可编辑白名单；core 公开 `getCatalogContractHashInput`/`isCatalogContractHash`（server hash 与浏览器 Web Crypto 复算共用同一规范化）与草稿发送快照/确认原语；两个参考浏览器挂载前校验契约、以响应头关联 done、按快照确认草稿；`sendAgentRun` 旧 idPrefix 四参槽位已删除。server 侧已移除示例 actions 回退与默认业务 Policy：示例 Catalog、LLM 调用、演示 handler 与搜索/表单/Workbench 流程 Policy 已迁至 `examples/playground-server/`。

当前公开根入口为 `@nexus-ui/core`、`@nexus-ui/client`、`@nexus-ui/react`、`@nexus-ui/server`，均为私有 0.1.x 包。core/server API 为 1；React API 为 2（Provider 显式 Surface、样式显式选择），其兼容声明仍为 core 0.1.x / core API 1 / v0.9。client 在 S4 定型，深路径和源码路径不承诺兼容。

server 根入口提供 AgentAdapter、router、guard 校验函数、Policy 注入、Catalog contract/discovery、RPC、verifier、history/run 实现与 `sendAgentRun` 等装配能力。装配依赖全部显式：`registry` 必填；`historyStore` 缺省为每 adapter 实例隔离新建；`useLlm` 默认 false，启用必须显式注入 `streamLlm`；generate 请求 `catalogId` 必填，不回落默认 Catalog；`AgentAdapter` 持有默认隔离或显式注入的 `runManager`，`sendAgentRun` 自动复用；自定义原始 `AgentRun` 必须显式传入 manager，SDK run 不接受另一个记录所有者。SDK 根入口无 listener、不读取项目环境、不依赖模型 SDK。参考工厂自行装配演示 Policy，局部覆盖仅替换对应 hook；SDK 不继承这些默认值。四包构建先清理旧 dist，产物清单必须与当前 src 对应，已迁出模块和测试不得残留。

## 3. 当前 HTTP、RPC 与提交语义

当前参考 HTTP 路由：

| 路由                                        | 当前行为                                             |
| ------------------------------------------- | ---------------------------------------------------- |
| `POST /api/a2ui/generate`                   | 接收 `message?`、`catalogId`（必填），返回 SSE       |
| `POST /api/a2ui/event`                      | 接收 `{ message, nexus }`，返回同 surface patch          |
| `GET /api/a2ui/catalog-contract?catalogId=` | 返回已发布 Catalog Contract                          |
| `GET /api/a2ui/published-catalogs`          | 返回显式发布的 Catalog 摘要与 URL                    |
| `GET /api/a2ui/agent-onboarding?catalogId=` | 返回 Agent 接入约束与验收描述                        |
| `GET /api/a2ui/runs?surfaceId=`             | 运行记录查询；宿主 `access.read` 准入，未配置默认 403 |

当前 HTTP 要求 `{ message, nexus }`。message.action 必含 name、surfaceId、sourceComponentId、可解析 timestamp 和对象 context；可选 actionId 若提供须与 nexus.actionId 一致。generate/action 在入队前先经宿主 `access.generate/action` 准入（缺省 403，S3.5 已实施），随后与所有消费路径共用同一 runtime 调度：快照/action 声明与 handler 查找 → ledger → nexus/来源/整批输入准入 → 参数重算与可选 resolver → handler → 固定 Catalog patch guard → revision/epoch 比较并提交 UI（顺序见 §5.4/§6.2）。

参数从临时输入模型重算，resolver 只能在共享准入之后扩展，最终参数仍受未声明键与 paramSchema 校验；字段/路径/类型拒绝不委托宿主兜底。ledger 只在进程内去重，留存窗口内已知记录一律拒绝重入（§6.4），不能作为业务重试依据。

SSE `start`/`message`/`done`/`error` 即 §5.4 Session v1 事件；`sendAgentRun` 是 Session→SSE 薄适配（S3.5 已实施）：只负责占用响应、SSE 序列化、连接与异常转发，不解释 Catalog、不自建队列、不自行提交；调用时同步占用响应并自行 pipe，宿主 await/void 均逐条下发，此保证属于 Koa 适配行为。

| 资源                        | 当前默认值 / 已知限制                                                  |
| --------------------------- | ---------------------------------------------------------------------- |
| JSON 请求体                 | JSON 或 +json，1 MiB、10 s                                             |
| 外部 Agent RPC              | 15 s、2,000,000 bytes；仅 NDJSON/JSONL；空输出拒绝；AbortSignal 传播   |
| SSE 下发                    | 有界背压（高水位 1 MiB、慢消费 30 s，S3.6 已实施）；`streamDelayMs` 退为演示用逐条间隔，默认 0 |
| JSONL 行                    | 1,000,000 个 JavaScript 字符串代码单元；不是 HTTP 字节限制；超长行丢弃 |
| VNode / 深度 / React 元素   | 10,000 / 1,000 / 10,000                                                |
| 错误记录                    | 200 条；raw 截断 2000 字符                                             |
| run / ledger / surface 快照 | 保留配置为 512 / 1,024 / 256；不构成运行总资源的完整硬上限             |

外部生成 RPC 现有请求为 `{ version: 1, kind: 'generate', surfaceId, message, catalogId, supportedComponents, supportedActions, catalogContract, history }`，可传播 signal。成功响应为 `application/x-ndjson` 或 `application/jsonl`；失败为非 2xx 与错误信息。宿主选择 endpoint/headers/timeout，模型耗时超过默认值时须显式调高。该 RPC 是可选适配，不是所有 Agent 必须采用的协议。

## 4. Catalog 与交互准入（已实施 S2.1–S2.4）

当前 Catalog Contract 为 v2，支持展示、输入与 action 能力的一致声明；v1 形状显式拒绝。内容或能力变化产生新 hash，运行的 surface 固定其契约版本/hash。core 公开 `CatalogDefinition` 为 v2 单一声明表形状（V2 后缀已移除）；共享正常/非法 fixture 定稿于 `fixtures/catalog-v2/`，core 注册与 server 准入对同一数据必须给出一致结论。

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
- 发送快照与草稿确认（已实施，S2.6.4.1）：消费方组装 action 请求时经 `extractLatestInputDrafts(surfaceId)` 一次取得「最新输入 + 逐条草稿代次」，`nexus.inputs` 仍只含 `{ componentId, property, value }`。仅完整关联且本地校验通过的成功提交可调用 `confirmInputDrafts(snapshot)`；确认按 surfaceId 与逐条 `(componentId, property)` 的代次相等删除，不按值相等——发送期间的再次编辑（含改回同值）、改绑/替换组件（已被失效清理删除）、其他 surface 与其他 runtime 实例的草稿一律保留。失败、取消或本地拒绝不确认，草稿原样保留供重试；确认幂等。服务端归一化写回与新编辑的优先级（2026-10-21 复审修正）：action 流按输入基础模型 → handler patch 应用；完整接受成功结果后，`confirmInputDrafts(snapshot): boolean` 原子确认未再编辑的已发送项，并把剩余有效草稿恢复到本地编辑模型，保持 serial 不变。已发送且未再编辑的字段保留服务端归一化结果；请求期间再编辑或首次编辑的字段继续显示其最新草稿，下次提交与可见编辑值一致。恢复仅影响本地编辑态，不改写服务端提交或 revision；失效草稿按既有规则删除。恢复写路径失败返回 false，不部分恢复、不确认任何有效条目，消费方不得启用新基准；跨 runtime 返回 false 且不改状态，重复确认幂等。此原语仅在本次成功结果完整接受后调用，不能用查询或过期快照恢复旧视图。
- 可编辑范围为宿主在可信装配中按 surface 提供的精确 JSON Pointer 白名单（已实施，S2.4）：绝对指针（RFC 6901）、拒绝空串根指针与 `/`（根/空键不做可编辑目标）、core 共享严格寻址按实际容器区分对象键与数组索引，数组下标仅接受规范十进制（`01`、`+1`、`1e0`、空段、负数等别名拒绝）；对象中同形字面键合法，不能在不知容器类型时一律当数组拒绝、规范化后重复即配置错误（装配器显式抛出，不伪装成业务拒绝）、默认拒绝、不做通配或前缀继承；`~1`/`~0` 转义按规范形归一，转义键与字面嵌套路径不碰撞。白名单自身允许嵌套重叠（如同时允许 `/profile` 与 `/profile/name`）。
- 浏览器输入只提交 `{ componentId, property, value }`（已实施，S2.4）；服务端在 surface 锁内从已提交组件声明解析目标路径，逐项核对声明、白名单与值 schema。客户端提交目标写路径、未声明属性、错误类型均整批拒绝；同批 `inputs` 的写入与数组顺序无关——重复（同组件同属性）、同目标路径、以及解析路径互为祖先/后代（按 JSON Pointer 段比较，如 `/profile` 与 `/profile/name`）都判冲突拒绝；任一项失败不产生局部写入。未变化输入合法，按普通输入幂等写回。
- handler 参数由服务端从已提交 action 声明与临时输入模型重新解析，并按 `paramSchema` 校验（已实施，S2.4）。`paramSchema` 校验作用于最终交给 handler 的参数：无 resolver 时为共享重算值，有 resolver 时为其输出——共享准入本身不提前否决 resolver 的参数整形。准入与参数解释一律使用提交边界固定的 Catalog 声明副本（与 hash 一并固定），不读当前 registry：宿主原地修改声明不能让同一 revision/hash/输入从拒绝翻转为接受。客户端 `context` 键必须是已声明绑定字段，且值不作为参数权威；自定义 resolver 只能在共享准入之后扩展参数，其输出仍须通过未声明字段拒绝与参数 schema，不得把被拒输入重新变为可执行 action，其对快照引用的改动不回写权威状态。准入成功不表示业务授权成功，身份、对象归属与事务由宿主 handler 判断。
- 提交语义（S2.4 复审修复，2026-10-19）：`nexus` 必填，HTTP 只透传客户端的 revision/hash/actionId，旧格式拒绝；不得查询当前快照代替客户端声明其视图基准。已准入输入先形成基础模型，再应用 handler patch，一次原子落库；partial patch 不必回显输入，handler 对同路径的归一化结果优先，根替换以 handler 的完整新模型为准。运行消息源在 patch 前发布该临时模型（无输入时不增消息），浏览器按消息顺序应用所得模型与权威状态一致。临时输入本身不提前提交或增加 revision，流失败不发布新的成功基准。
- 隔离与固定契约：组件、模型、Catalog 与消息在存储入界/出界均深拷贝；临时模型、待提交 inputWrites 与 resolver/handler 的参数和上下文分别持有独立值。准入、实际 patch guard 和提交前复核均使用本次快照固定声明，guard 基于原组件表与临时输入模型解释增量 patch。
- 并发与版本：内存 store 以实例级单调安全整数计数器分配 revision，生成 epoch 取其提交 revision；删除或容量淘汰不回收编号，无每 surface 墓碑表。提交同时比较 expectedRevision 与 expectedEpoch，同代其他 action 或重新生成均使旧 patch 失效；上溢显式失败。原始手动 AgentRun 消费也持有调度权直到 commit/onError/dispose，正常 source EOF 不代表提交；高层 runtime/adapter 句柄由调度任务自动完整校验并提交，以 result/Session 终态判断。handler 已执行的业务副作用由宿主管理，SDK 不自动重放或回滚。

Catalog schema、绑定与 action 规则由 core 的共享纯模块实现，server 不复制第二套组件/输入语义。

本地输入写回执行 Catalog inputs 值 schema；checks 是提交门控，在 triggerAction 与服务端 action 准入执行，不作为 setInputValue 的额外写回前置。草稿恢复整体 false 时保持原子不变且不开放新基准，完整恢复由 S4 接续。

### 4.4 失败语义

注册期失败在宿主装配时抛错；运行期拒绝返回结构化失败且满足同一不变式：handler 未调用、已提交快照与 revision 不变。运行拒绝类别：envelope 缺失 `nexus` 或 `sessionVersion` 非 1（旧格式显式拒绝）；revision/hash 与快照固定值不一致；未声明组件/action/属性；越权或伪造路径；schema 不符；重复/冲突输入；action 未注册 handler（既有）。浏览器本地校验只服务状态正确性与反馈，不能替代服务端权威准入。

## 5. Session 与流契约（Session v1、传输薄适配与资源预算已随 S3 实施）

### 5.1 版本与 envelope

新增 Nexus Session v1，独立于 A2UI v0.9、Catalog Contract v2 和包 API 版本。运行元数据放在 Nexus 传输 envelope，A2UI message 保持自身形状，不向 createSurface/action payload 静默追加 SDK 字段。

当前 action HTTP 请求为外层 `{ message, nexus }`：message 承载 v0.9 action 信封（形状不变）；nexus 承载 SDK 元数据。签名已在 core 公开入口定型：`NexusActionMetadata` 含 `sessionVersion`（字面量 1，常量 `NEXUS_SESSION_VERSION`）、`actionId`（非空字符串，标识一次用户提交，不代表领域幂等键）、`surfaceRevision`（正安全整数）、`catalogHash`（`sha256:` 加 64 位十六进制）与 `inputs`（`NexusActionInput[]`，元素为 `{ componentId, property, value }`）。解析规则：缺失 `nexus` 或 `sessionVersion` 非 1 显式拒绝；`message.action.actionId` 若存在必须与 `nexus.actionId` 一致；输入项出现 `componentId`/`property`/`value` 之外的键拒绝。这些语义不再由示例各自定义；S3 的 start/done/error 复用同一 session 版本基线，不向 A2UI payload 追加字段。

浏览器的 action 基准必须对应其实际渲染的那次 UI 提交，不自行递增、猜测或从最新快照借用 revision/hash。共享类型 `NexusSurfaceCommit` 定于 core `session`，server 的 `SurfaceStateBaseline` 是其类型别名，字段为 `{ sessionVersion: 1, runId, surfaceId, catalogId, contractVersion, catalogHash, surfaceRevision }`。`runId` 由运行创建方分配，是本次运行的非空不可变标识，在同一 runtime 中不复用；它与 `actionId`（客户端一次用户提交的标识、ledger 重放键）语义不同，不得混用或互相替代；其余版本/hash/revision 与该次实际提交固定值一致。

revision 必须区分同一 surfaceId 的先后提交，包括重新生成，不能因重建而与仍可能提交的旧基准重号。重新生成/删除重建后的旧视图同样必须被拒；超出正安全整数或无法维持旧基准失效时显式失败，不重置为可碰撞的基准。

当前最小接线（S2.4 复审修复，2026-10-19）：Adapter 的 commit 返回提交边界捕获的 `NexusSurfaceCommit`；`sendAgentRun` 成功 `done` 携带同一固定结果，其 runId 与本次 SSE event id 前缀一致，不在终态查询最新快照。core 公开 `parseSurfaceCommit` 校验版本、标识、hash 和正安全整数 revision，Catalog Contract 版本常量由 core 定义并由 server 复用。两个参考浏览器从同次流的成功 `done` 保留该基准，在 EOF、错误、版本/标识不符或本地消息拒绝时关闭后续 action；请求携带原 actionId 与 `getLatestInputs`。这只是现有消费方的最小门控，完整隔离预览/恢复会话仍由 S3/S4 实施。

运行标识统一（S2.5.1，2026-10-19）：一次 run 只分配一个不可变 ID，由运行创建方生成并经 `AgentRun.runId` 暴露；非 HTTP commit、SSE event id 前缀、成功 done 与 run-manager 运行记录使用同值。发送层 `sendAgentRun` 不以另一个 idPrefix 改写 `commit.runId`，也不为同一运行生成第二个标识；旧四参签名 `sendAgentRun(ctx, run, idPrefix, options)` 已随 S2.6.5.2 删除（2026-10-21 验收核实公开入口仅存 `sendAgentRun(ctx, run, options)`），不留兼容槽位或第二套身份解释。`AgentRun.commit` 必须返回结构合法且 runId、surfaceId、catalogId、catalogHash 与准备阶段捕获身份完全一致的 `NexusSurfaceCommit`；空对象、缺字段或错配都按运行失败处理，不留存结果、不发布成功 done。校验返回值只保留规范字段，不能依赖 TypeScript 签名或非空判断；原始 `sendMessages` 是非运行工具路径，不产生运行记录，其终态不承载 `NexusSurfaceCommit`。自定义 `AgentRun` 实现必须迁移到返回固定 commit 的签名；自定义 `AgentRunManager` 实现必须实现结果接口 `recordCommit(id, commit)`（记录先经 `create` 建立，提交边界写入、成功 done 之前可读），无记录时显式报错。HTTP 响应头已接线（S2.5.4，`X-Nexus-Run-Id`），按 run 查询路由已实施（S2.5.3），有界留存与重复标识拒绝的完整语义已实施（S2.5.2）。

提交结果留存（S2.5.2，2026-10-20 评审修正）：传输无关的 managed run 是运行生命周期入口，adapter 持有每实例隔离的 `runManager`（可在 adapter 构造时注入），HTTP、非 HTTP generation/action 共用同一记录所有者。非 HTTP 首次消费 source 或调用 commit 时建立 queued/running 记录；HTTP 在同步占用 SSE 响应前先预留 queued 记录，排队完成后转 running。生成源工厂与 action handler 均延迟到消息源消费、记录容量准入成功之后才调用；工厂/handler 抛错属于运行失败，HTTP 已占用响应时用 SSE error 收场。prepare 阶段的协议/权限/参数/resolver 拒绝仍在流前完成。正常 source EOF 或迭代器 return 不等于提交，直接消费者必须 commit/onError/dispose 显式结束；source 异常会结束运行并释放资源。

managed run 在底层 commit 成功后验证完整提交结构与本次固定身份，调用 `recordCommit(runId, commit)` 并迁移 succeeded 后才返回结果，因此先于成功 done 可读；返回值与留存值隔离。记录建立失败不占用 SSE 响应、不调用生成源工厂/handler，并释放 action 锁。响应占用失败同步撤销已分配的流并将已创建记录收敛为 canceled（S3.2 起；取消不倒写 store 已确认的提交），释放运行和宿主 dispose 资源，清理至多一次。留存失败（无记录、重复写入、终态补记）按失败处理，不发布成功 done，已提交快照不因此回滚。自定义原始 AgentRun 由发送层包装以复用同一生命周期；router 可省略 runManager，若显式提供必须与 adapter.runManager 是同一实例。

`InMemoryAgentRunManager` 写入与读取均深拷贝，后续状态迁移不能覆盖已留存结果；recordCommit 同时校验结构与记录 ID/surface，重复 ID 与重复结果显式拒绝。容量按插入序优先淘汰终态记录，queued/running 受保护，全部活动时显式拒绝新建。HTTP 与非 HTTP 均留存 adapter 提交边界的同一固定结果，不从最新快照拼装；结果淘汰后明确不可用。已确认提交后的观察/传输失败保留结果和成功事实，不另造 revision；完整 commitState/history 与统一调度归 S3。

按运行查询与结果对账接线（查询路由与响应头已实施 S2.5.3/.4，2026-10-20；verifier/RPC 贯通已实施 S2.5.6，2026-10-20；入口与并发关联复核已实施 S2.5.7，2026-10-20）：

- `GET /api/a2ui/surface-state?surfaceId=<id>&runId=<id>` 两项必填，缺失/空值返回 400（参数校验先于准入）；先执行宿主 `access.read(surfaceId, ctx)`（S3.5 起，原 `runsAccess`），未配置或拒绝均为 403，准入拒绝时不查询运行记录，不泄露记录存在性，再查询该 surface 下的运行结果。
- server 在发布 UI revision 的提交边界保存不可变的 `NexusSurfaceCommit`，先于成功 `done` 可见；不能等查询时再读取最新 surface 拼装。200 响应体即为该运行的 `NexusSurfaceCommit`（无额外包装），即使同一 surface 后续已有其他提交，历史结果也不改变。记录不存在、与 surface 不匹配或已淘汰返回 404（三种原因同一响应体，不泄露区分）；运行存在但尚无可确认的 UI 提交结果返回 409——排队/执行中与失败/取消终态都没有已留存结果，按同一 409 语义处理。查询路径只读 run 记录所有者，不读当前 surface 快照，结构上不存在回退最新基准的可能；留存条数有界，记录淘汰允许查询失败，运行标识不得复用。
- 生成与 action 的 SSE 响应在 S2.5 显式携带 `X-Nexus-Run-Id` 响应头（跨源使用时须暴露该头），值与本次运行及其 SSE event id 前缀一致；浏览器把响应、已校验消息与成功 `done` 作为同一次本地运行关联，不能通过解析 event id 格式或查询最新 run 猜测标识。A2UI 消息形状不变；成功 `done` 已直接承载固定提交结果。
- 消费方在响应、每条消息、终态与流结束时核对请求代次/取消标记；取消、切换 Catalog、卸载立即使运行失效，晚到响应不写 runtime、基准或运行状态。在途重复 action 忽略，不取消当前运行；取消后释放 busy，可显式重新生成。生成结果必须来自本次新建 surface，包含 root，Catalog 匹配本次请求；只有 done 的生成响应不能为旧视图换基准。action 结果核对固定 surface/session/catalog/contract/hash，并要求 revision 前进（无 patch 的合法 action 仍可成功）。
- 只有本地该次流成功、消息全部校验通过，且运行结果（当前为同次流 done，后续也可按 run 查询）的 session version/runId/surfaceId/catalogId 与本地运行一致、contractVersion/hash 与所用 Catalog 一致时，才能把该次视图与基准成对启用。查询失败、收到晚到的旧运行结果或本地校验失败时不开放 action；保留查询所归属的本地运行，不能把结果贴到另一份视图。
- 另一提交无论发生在流完成后查询前，还是查询后 action 前，都不能替旧视图刷新基准：例如本地渲染 run A/revision 1，run B 已提交 revision 2，查询 A 仍返回 1，下一枚 action 因旧 revision 被拒。此时禁用该 surface 的 action，通过重新生成或受控完整快照恢复视图与基准；仅重新查询元数据或让用户再次点击不能恢复一致性。

- verifier/RPC 贯通（S2.5.6，2026-10-20）：外部 Agent RPC 在共享准入后的 handler 内序列化完整已准入 action——nexus 元数据（actionId/sessionVersion/surfaceRevision/catalogHash）、服务端重算参数与最新输入 `inputs` 都出现在请求载荷；远端响应仍过同一 guard，RPC 适配不授予额外写路径权限。`verifyExternalAgentIntegration` 以本次成功 `done` 携带的固定 `NexusSurfaceCommit` 为唯一 action 基准并核对 runId/surfaceId/catalogId 与 SSE event id 前缀的关联，不再调用 `describeSurfaceContract` 以最新快照补基准；done 缺失或与运行不一致按失败处理，不虚构通过。可编辑路径（`editablePaths`）与待编辑值（`actionInputs`）由可信宿主夹具显式配置，SDK 不按组件名猜输入；展示型 Catalog（`actions: []`）跳过 action 阶段，`action-same-surface`/`action-root-stability` 按 skipped 记录并给出原因。verifier 完整消费实际响应目的流并等待结束后解析，合法输出不因流缓冲阈值而被截断；报告 `actionContext` 是 inputs 准入、参数重算后实际交给 RPC handler 的 context 深拷贝，跳过 action 时为 `{}`。verifier 报告、onboarding 契约 `verification.checks` 与 RPC 声明的检查项保持 id/顺序一致。查询 404/409 的不可对账口径在 verifier 侧等价于失败/skipped，不回退最新快照。

- 入口与并发关联复核（S2.5.7，2026-10-20）：非 HTTP 消费的运行与 HTTP 路径同出 adapter 提交边界——纳入同一记录所有者，真实查询路由返回与两条路径的固定 commit 值一致；源 EOF 未显式提交按 409 处理（正常 EOF 不是终态）。查询与容量淘汰的窗口期交错经真实路由验证：读取先于淘汰返回被查运行自己的固定结果，查询到达前已淘汰返回 404，均不回退同 surface 的更新提交；查询键严格为裸 runId，事件 id 全值与被拒 envelope 的 actionId 均得 404。此项历史验收未包含消费方门控；S2.6.3 的当前消费方实施见上文，Session v1 仍待 S3/S4。

成功 `done` 已提前复用 `NexusSurfaceCommit`；S3 的 `start` 报告本次运行的基准，按运行查询保留为结果对账用途，查询元数据本身不是视图恢复接口。结果留存、按 run 查询、`X-Nexus-Run-Id` 响应头与 verifier/RPC 贯通已实施（S2.5.2/.3/.4/.6），入口与并发关联复核完成（S2.5.7，2026-10-20）；完整 Session 生命周期由 S3/S4 实施。

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

### 5.3 传输关联与响应头（S2.5.4 已实施）

生成与 action 的 SSE 响应在同步占用响应时携带 `X-Nexus-Run-Id` 响应头：写入发生在 `flushHeaders` 之前、`ctx.respond = false` 接管响应生命周期的同一同步点，值为本次运行的唯一不可变 ID，与运行记录 id、SSE event id 前缀和成功 `done` 载荷的 `runId` 同值（§5.1）。响应头只依赖运行标识本身，不等待运行记录建立或队列排空——排队 run 的响应在被占用的瞬间即带头，客户端无须等待即可取得本次运行的关联标识；容量拒绝等未占用响应的失败路径不产生该头。原始 `sendMessages` 是非 SDK 运行路径，不携带该头。

跨源可读由适配层与参考装配显式完成：宿主 CORS 装配以 `Access-Control-Expose-Headers` 暴露该头，并在宿主已有暴露配置上合并（参考服务在其当前为空的暴露集上合并）；SDK 不接管宿主的 CORS 授权策略，也不在宿主未显式暴露时声称跨源可读。

消费者关联本次运行的权威入口是 `X-Nexus-Run-Id` 响应头与成功 `done` 载荷（按 run 查询路由已由 S2.5.3 实施，见 §5.1 后续列表）。消费者不得解析 SSE event id 格式来猜 runId：event id 只是流内帧标识，不是公开查询键；SDK 不提供也不暗示该用法，关联核对以显式响应头与 `done` 元数据为准。

响应头写入失败与其它 SSE 响应头同策略：响应占用失败（含 `flushHeaders` 抛错）在调用方同步段抛出并撤销已分配的流、运行收敛为 canceled 并释放宿主 dispose 资源，不留半占用响应（S3.2 语义更新：S2 时期记录迁移 failed）。完整 Session/SSE 生命周期（`start` 事件、断线恢复）不在本切片内，归 S3/S4；按 run 查询路由已由 S2.5.3 实施（§5.1）。

### 5.4 Session v1 事件契约（S3.1 锁定，2026-10-22；事件面已随 S3.4 实施，SSE 薄适配与访问准入已随 S3.5 实施，资源硬预算已随 S3.6 实施）

本节为 S3.1 定型的 wire 契约。事件面——core 纯类型/解析/序列检查、runtime 统一事件源与锁定 error 形状的 SSE 转发——已随 S3.4 实施；传输薄适配、访问钩子与断连清理已随 S3.5 实施（2026-10-27）；资源硬预算已随 S3.6 实施。共享 oracle 数据定稿于 `fixtures/session-v1/`（含预算表、正常/取消/提交前后/unknown/重复/容量/慢消费/观察者失败场景），core 解析与 server 运行时对同一数据必须给出一致结论。

**事件模型**：每次 run 恰一个有序事件流，wire 事件名为 `start`、`message`、`done`、`error`。HTTP SSE 与非 Koa 事件消费共用同一事实源与同一序列规则；`runId` 贯穿事件、`X-Nexus-Run-Id` 响应头、运行记录与 done 载荷（§5.1）。`start` 载荷携带 `type: "start"` 判别字段（S3.2 起既有形状；消费方按 SSE 事件名分派，core 解析器按事件名归一并校验该字段）。

`start` 事件字段：

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `sessionVersion` | 字面量 1 | `NEXUS_SESSION_VERSION` |
| `runId` | string | 非空，本次运行唯一不可变标识 |
| `surfaceId` | string | 非空 |
| `catalogId` | string | 非空 |
| `contractVersion` | 数值 | 等于 `CATALOG_CONTRACT_VERSION`（当前 2） |
| `catalogHash` | string | `sha256:` 加 64 位十六进制 |
| `surfaceRevision` | 正安全整数，可选 | action 运行必带，值为调度内实际读取快照的 revision；generation 运行不携带（surface 由本次运行创建，无旧基准可报告） |

`start` 在调度任务内身份与基准可得后、先于准入裁决、候选消息消费与 handler 调用发出：generation 在固定 Catalog 后、读取 history 前；action 在读取实际快照后。基准取调度内实际快照，不得提前读最新快照或采用客户端声明拼装。已取得快照的准入拒绝是「start → error」序列（`fixtures/session-v1/reject-admission-stale-revision.json`）。快照不存在/读取异常、记录启动异常等身份准备失败不伪造 start，产生带 `beforeStart:true` 的唯一 error；排队取消同样不产生 start。

`message` 事件 data 为原始 A2UI v0.9 信封，形状与 §1 一致，不追加任何运行元数据；逐条经共享 guard 校验后才进入本次预览。

`done` 事件 data 为本次运行提交边界捕获的固定 `NexusSurfaceCommit`（§5.1），语义为 UI 提交成功，不表示业务成功。

`error` 事件字段：

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `sessionVersion` | 字面量 1 | |
| `runId` | string | 非空 |
| `surfaceId` | string | 非空 |
| `code` | 枚举 | 见下表 |
| `commitState` | `notCommitted` \| `unknown` | error 流不得为 `committed`（已确认提交走 done） |
| `message` | string，可选 | 截断至诊断上限（core `NEXUS_SESSION_DIAGNOSTIC_LIMIT`，512 字符；字节级预算归 S3.6） |
| `diagnostics` | 数组，可选 | 复用 §1 结构化诊断（`PROTOCOL_INVALID` 等）与 `path`/`dataPath`；条目 `{ code, message, path?, dataPath? }`，message 同上限截断 |
| `actionId` | string，可选 | action 运行可获得时携带 |
| `beforeStart` | 字面量 true，可选 | 身份/基准准备失败或排队取消，没有 start；只能 `notCommitted`，不得为 `RUN_COMMIT_UNKNOWN`；已发 start 后禁止出现 |

错误码枚举（Nexus session 契约，不伪装为 A2UI 协议字段）：

| code | 语义 | 典型 commitState |
| --- | --- | --- |
| `RUN_ADMISSION_REJECTED` | 调度内准入/校验拒绝（revision/hash、声明、白名单、参数、ledger 重复） | `notCommitted` |
| `RUN_FAILED` | source/handler/store 确定性失败等运行失败 | `notCommitted` |
| `RUN_COMMIT_UNKNOWN` | store 提交异常且无法证明未写入 | `unknown` |
| `RUN_CANCELLED` | 取消或 dispose 收敛的终态 | `notCommitted`（提交竞态例外见 §6.3） |
| `RESOURCE_LIMIT_EXCEEDED` | 消息数/字节/缓冲等预算超限 | 按提交事实 |
| `AGENT_STREAM_ERROR` | 传输边界错误（S2 既有码，保留） | 按提交事实 |

**序列规则**：`start` 是首事件；准备失败或排队取消可为唯一 error（显式 `beforeStart:true`；无此字段时仅保留 `RUN_CANCELLED/notCommitted` 的排队取消兼容形状）。其后 `message` 零或多条；每条流恰一个终态（`done` 或 `error`），终态后不得再有任何事件；EOF/iterator return 不是终态，消费方不得据此推断成功。连接已断而无法投递终态时，运行在本地记录终态事实（§6.3），不要求重放。SSE `error` 载荷即上方字段表（S2 过渡的 `code: AGENT_STREAM_ERROR` 覆盖、`runCode`/顶层 `boundaryCode` 附加字段已随 S3.4 移除，边界分类改入 `diagnostics`）；非 Koa 消费经句柄 `events()` 得到同一事件事实，进程内判别字段不上 wire。订阅更替（提前退出后再次订阅）经缓冲接续同一条逻辑流：iterator.return() 将尚未投递的消息与终态同步归还句柄，旧迭代器关闭后不能再消费；不构成广播，也不产生第二个终态。序列检查保存 start 身份副本，后续 message 的 surfaceId 与 createSurface 的 Catalog 必须一致，error 的 runId/surfaceId 必须一致，done 的运行/契约身份必须一致；action done revision 必须大于 start 的实际基准。actionId 在入队时固定，handler/候选/提交失败与排队/运行取消均保留可获得的关联。

**运行记录存在性**：入队前的拒绝（access 未配置/拒绝、队列容量、envelope/装配错误）不创建运行记录、无 `X-Nexus-Run-Id` 响应头；入队成功即建立 `queued` 记录并占用响应（排队 run 同步写头，不回落 404）。调度内准入失败是运行失败终态，记录存在且可查询（无结果时 409）。

**查询与状态码**：按运行查询保持 S2 语义（§5.1）：400 参数缺失、403 access、404 记录不存在/淘汰/surface 不匹配（同一响应体）、409 尚无可确认结果（queued/running/failed/canceled/unknown 一律 409）、200 返回固定 `NexusSurfaceCommit`。generate/action 路由映射（已随 S3.5 实施，真实 HTTP 对测见 `test/api/http-parity.test.ts`）：access 未配置或拒绝 403（`GENERATE_ACCESS_NOT_CONFIGURED`/`GENERATE_ACCESS_DENIED`/`ACTION_ACCESS_NOT_CONFIGURED`/`ACTION_ACCESS_DENIED`），队列容量拒绝 503（`RUN_CAPACITY_REJECTED`）；envelope 解析失败保持 400。已接受运行的调度内失败经 SSE `error` 报告，不再使用入队前 400——准入发生在调度内，400/错误事件的分界以入队为界。

**版本决策（S3.1）**：Nexus Session 保持 1（本契约新增事件与错误码枚举值，不改变既有 `done`/`message` 形状，消费方按事件名分派）；server API 保持 1；外部 Agent RPC 保持 1（请求载荷不变）；agent onboarding 保持 1；Catalog Contract 保持 2。不做新旧两套流解释；新增字段只出现在新事件中，A2UI payload 不掺运行元数据。

## 6. 运行时契约（S3.1 锁定，2026-10-22；§6.1/§6.2 已随 S3.2 实施，§6.3/§6.4 已随 S3.3 实施，§6.1 句柄事件面已随 S3.4 实施，§6.5 访问准入与 §6.7 适配迁移已随 S3.5 实施，§6.6 资源预算已随 S3.6 实施）

本节为已实施的 S3 运行契约（2026-10-28 阶段验收，证据见 [S3-ACCEPTANCE](tasks/S3-ACCEPTANCE.md)）；client 预览/提交隔离与恢复已按 §7 实施，完整 S4 验收见 CURRENT。

### 6.1 运行入口、句柄与所有权

- `createAgentRuntime(options): AgentRuntime` 为 server 公开高层入口（DESIGN D12）：`options` 覆盖现有 `AgentAdapterOptions` 全部显式装配项（`registry` 必填、`historyStore` 缺省隔离新建、`useLlm` 默认 false、`catalogId` 必填等，§2），新增 `scheduler`、`access`、`budgets`；缺 registry 或非法预算在初始化时抛错；生成源可省略以仅装配 action，实际 generate 未配置源时入队前拒绝，启用 LLM 却缺 streamLlm 时调用入口抛出装配错误。默认 store、ledger、scheduler、runManager 每实例一份，实例间互不共享；根入口无 listener、环境读取或模型默认值。
- `AgentRuntime.generate(request, options?)` / `AgentRuntime.action(request, options?)` 返回 `Promise<{ accepted: true, run } | { accepted: false, stage, code?, message }>`（成功字段固定为 `run`；拒绝 `stage` 为 `request` 或 `capacity`）：预期拒绝（access、容量、请求级校验）以结果报告，不抛异常；装配/编程错误抛错。非 Koa 消费无需构造任何 HTTP 对象。
- 运行句柄暴露 `runId`/`surfaceId`/`kind`、`events(): AsyncIterable<SessionEvent>`（单条逻辑流、唯一事实源，已随 S3.4 实施：订阅更替经缓冲接续同一条流）、`result`（终态结果 Promise，含终态/commitState/固定提交）、`cancel(reason?)` 与幂等 `dispose()`。
- `queryRun(surfaceId, runId)` / `listRuns(surfaceId)` 只读 run 记录所有者；只读固定记录、不读当前 surface 快照；这两个可信宿主本地接口不执行 access.read。对外查询由 HTTP 路由或宿主自己的适配层执行 read 授权并映射 §5.1 状态码。

| 事实 | 唯一所有者 | 备注 |
| --- | --- | --- |
| Catalog 固定副本、handler 表、Policy | adapter（由 runtime 持有） | 发布绑定实际执行声明（§8） |
| 每 surface 调度队列 | runtime scheduler | 默认每 runtime 一份；显式共用 runManager 的入口复用同一调度器 |
| 运行记录与固定结果 | `adapter.runManager` | 注入或默认隔离（S2.5 语义不变） |
| surface 快照 / ledger | `actionStateStore` / `actionLedger` | 每 adapter 一份，可注入 |
| Session 事件流 | runtime 事件源 | SSE 适配只消费，不自建事实 |
| HTTP 响应、连接、序列化 | Koa 适配层 | 运行模块不接受 Koa Context |

生命周期（每次 run 恰一个终态；`commitState` 随终态固定，确认提交后不可倒写）：

```text
enqueue（access → 队列容量 → 建 queued 记录；拒绝则无记录）
  │
  ▼
queued ──调度出队──► running ──store 确认提交──► succeeded (committed)
  │                    │
  │排队取消             ├── 准入/校验确定未写 ──► failed (notCommitted)
  ▼                    ├── store 写入不确定 ───► failed (unknown)
canceled               ├── 取消先于提交确认 ───► canceled (notCommitted/unknown)
(notCommitted,         └── 提交确认后取消迟到 ─► succeeded (committed)
 无 start 事件)
```

排队语义：同一 runtime 同一 surface 的 generation 与 action 同队列 FIFO 串行（覆盖固定 surfaceId 工厂碰撞/重建）；不同 surface 可并发；两个 runtime 实例的同名 surface 互不阻塞。排队容量与取消先于 source 工厂与 handler 函数体。取消排队项立即移出队列并释放额度，不等待活动任务结束。action 请求在入队前深拷贝（含 context/inputs），调度键、准入与提交只使用同一请求快照。

**S3.2 实施补充（2026-10-23）**：adapter、runtime 与自定义 `AgentRun` 以同一 `runManager` 身份关联唯一 scheduler（关联由运行模块持有，传输层不另建队列）；显式为既有所有者配置第二个 scheduler 时装配报错。`sendAgentRun` 的 signal 与准备阶段 signal 都能取消运行，终态清理监听器。提交前运行失败/排队取消时，即便 manager 的终态写入或清理抛错，句柄仍收敛 result 与唯一 error，并附 `RUN_LIFECYCLE_ERROR` 诊断；不伪造外部记录已写成功，按 run 查询仍只读该所有者的实际记录。提交后的存储/留存事实隔离已随 S3.3 完成。

### 6.2 调度内准入与统一候选校验

排队任务覆盖完整链：快照读取 → revision/hash/来源/action 声明准入 → ledger → 输入/白名单/参数重算 → 可选 resolver → handler → 候选逐条 guard → 完整最终校验 → store 提交。generation 与 action 同队列；准入使用提交边界固定的 Catalog 声明副本（§4.3），`paramSchema` 校验点与拒绝顺序沿 S2 不变。

所有提交路径（HTTP、非 Koa、直接 commit、自定义 `AgentRun`）在提交前经同一完整校验（逐条 guard + `validateAgentStreamFinalDetailed` + root 要求）；流式下发侧的逐条校验保留用于尽早拒绝，实现共用一份 guard，不是两套解释。

### 6.3 提交事实与失败矩阵（已实施，S3.3，2026-10-23）

| 阶段 | 写入结果 | run 终态 | commitState | 客户端所见 | 副作用 |
| --- | --- | --- | --- | --- | --- |
| 入队拒绝（access/容量/envelope） | 未写 | 无运行记录 | — | 403/503/400 | 无 |
| 调度内准入/校验拒绝 | 确定未写 | failed | notCommitted | error `RUN_ADMISSION_REJECTED` | handler 未调用 |
| handler 执行后 patch 提交被拒 | 确定未写 | failed | notCommitted | error `RUN_FAILED` | 副作用已发生；不重放、不回滚 |
| store 确认提交 | 已发布 | succeeded | committed | done（固定提交） | — |
| store 提交异常（无法证明未写） | 不确定 | failed | unknown | error `RUN_COMMIT_UNKNOWN` | 不自动重试 |
| 提交成功后 history/hook/record/传输失败 | 已发布 | succeeded | committed | done 已发或传输失败 | 留存与 UI 事实不改写 |

- store 结果契约（已实施）：`commitGeneration`/`commitAction` 返回 `{ outcome: 'committed' | 'notCommitted' | 'unknown' }`。确定性拒绝（revision/epoch 比较、结构校验、surface 缺失）必须返回 `notCommitted`；实现无法证明未写入时返回或被映射为 `unknown`（store 抛出的异常一律视为 unknown，不得凭异常推断未提交）。提交返回值须经运行时校验 outcome、快照结构、surface/Catalog 身份、声明内容/hash、epoch/revision；确认缺失或非法报 `RUN_COMMIT_UNKNOWN`，不凭字段读取异常推断未写入。取消与确定拒绝竞态仍为 canceled/notCommitted，取消与 unknown 竞态为 canceled/unknown；生命周期附加故障不得覆盖原错误分类。
- 发布点之后的 history/hook 失败经适配器装配项 `onRunDiagnostic`（诊断面，宿主可选回调）报告，不删除快照、不改写成功事实；留存（`record-commit`）、成功终态写入（`record-transition`）失败同样报告并保留 succeeded/committed。外部记录仍以实际写入为准，不伪造留存或终态成功；无留存结果时按 run 查询返回 409。自定义 `AgentRun` 共用同一身份/留存/终态收敛，诊断从 `sendAgentRun` 的 `onRunDiagnostic` 接收；确认提交后的宿主清理失败报告 `run-dispose`，不调用失败回调或抹除 done。自定义提交函数普通异常按 unknown 处理。诊断回调自身抛错或 Promise 拒绝按诊断缺席处理，不等待观察者完成。
- `commitState` 一经 `committed` 不可被取消、失败或传输异常倒写；取消与提交竞态时以 store 确认结果为准（`fixtures/session-v1/cancel-racing-commit.json`）。
- revision/epoch 单调、声明固定、引用隔离、合法空输出 action 仍一次提交并推进 revision 沿 §4.3 不变。

### 6.4 重复 action 与 ledger（已实施，S3.3，2026-10-23）

- `begin` 返回三态：接受 / `duplicate` / `capacity`。留存窗口内已知记录（running/succeeded/failed/canceled）一律拒绝重入；`failed` 不是重试许可，SDK 不自动重放。
- 容量满且全部活动时拒绝新条目且不执行 handler；活动记录不参与淘汰。留存窗口之外不承诺永久 exactly-once；业务重试与幂等归宿主。
- ledger 完成失败不泄漏 surface 调度权；UI 提交事实不依赖 ledger complete 成功。
- 提交步内的最终校验拒绝也须完成 ledger 失败写回；完成操作幂等，不能因已经进入 commitStep 而漏掉发布前失败，也不能在成功后倒写 failed。

### 6.5 访问准入钩子（已实施，S3.5，2026-10-27）

- `access: { read?, generate?, action? }`，签名 `(request, context?) => boolean | Promise<boolean>`；`context` 由传输适配透传（HTTP 适配传 Koa Context，宿主闭包自行提取可信身份），运行模块不解释其内容。generate/action 配置于 `AgentAdapterOptions.access`（`createAgentRuntime` 透传），HTTP 路由经入队选项传入 Context；钩子抛错按装配错误向上传播，不静默改为拒绝。
- 三类钩子缺省一律拒绝（DESIGN D4/D9）：未配置即拒绝，显式本地 demo 自行放行。读取路由保持既有 403 码（`RUNS_ACCESS_NOT_CONFIGURED`/`RUNS_ACCESS_DENIED`；`runsAccess` 已迁移为 `access.read`，路由未配置时回落 adapter 装配的 read 钩子）；generate/action 拒绝映射 403（`GENERATE_ACCESS_NOT_CONFIGURED`/`GENERATE_ACCESS_DENIED`/`ACTION_ACCESS_NOT_CONFIGURED`/`ACTION_ACCESS_DENIED`，§5.4 状态码表）。
- 拒绝发生在入队前：不启动 source/resolver/handler、不创建运行记录、不泄露记录存在性；generate 准入先于 Catalog 解析（未授权调用方不能借 catalogId 探测注册状态），action 准入先于快照读取。请求原语捕获/深拷贝先于任何 await；generate/action 访问钩子收到同一入口快照的隔离且递归冻结的副本（类型顶层 `Readonly`，JSON 嵌套值在运行时同样冻结），不得改写请求。异步鉴权、调度和执行绑定同一入口值，调用方或钩子的修改不能让批准目标与执行目标错配（§6.1）。可信身份来自宿主上下文；surfaceId、catalogHash 与客户端 context 都不是凭据。

自定义 run 在托管、记录预留和任务初始化的失败路径均须清理宿主资源一次；记录已终态不能跳过宿主 `dispose`。清理异常只报告诊断，保留原始初始化错误，不占用 SSE 响应。

### 6.6 资源预算（已实施，S3.6，2026-10-27）

预算默认值、单位、所有者与超限行为见 `fixtures/session-v1/budgets.json`，实现常量由测试逐项读取对拍。`AgentAdapterOptions.budgets` 与 `createAgentRuntime` 使用相同装配；配置取不可变快照，非法数值初始化拒绝，0 不表示关闭。显式注入的 store/ledger/manager/history 保持自身配置；共享记录所有者复用唯一 scheduler，首次装配确定预算，显式冲突调度器拒绝。runtime 的显式 `scheduler` 字段逐项覆盖 budgets 中对应队列项。

| 预算 | 默认值与行为 |
| --- | --- |
| run / ledger / snapshot / history 条数 | 512 / 1024 / 256 / 64×20；活动记录不淘汰；全部保护时显式拒绝，snapshot 不允许临时越界 |
| 调度 | 每 surface 排队 32；活动、排队、隔离 surface 合计最多 512（`maxTrackedSurfaces`）；容量拒绝在 source/handler 前发生 |
| 消息与结果缓存 | 每 run 2000 条、单条 1,000,000 字节、累计 8,000,000 字节（UTF-8 JSON）；候选先计量再 guard，同一有界消息集合用于提交、事件与 result，不复制第二套无界 raw |
| 持久 snapshot | 完整快照含固定 Catalog 最大 8,000,000 字节、组件最多 10000；对输入基础模型与 handler patch 合并后的最终值计量，超限原子 `notCommitted` + `RESOURCE_LIMIT_EXCEEDED`，不推进 revision |
| history | 每 turn 8,000,000 字节、每 surface 16,000,000 字节；新增批次超限拒绝，已有历史按完整旧 turn 淘汰；提交后的 history 失败只诊断，不改写已确认 UI |
| 事件迭代消费 | 高水位 1 MiB / 32 条，等待上限 30 s；一个活动迭代器，`return()` 移交未读缓存供接续，释放当前消费等待；不取消运行。`subscribe()` 是同步观察端口，不作为异步拉取消费接口 |
| SSE | 高水位 1 MiB、慢消费 30 s；`write(false)` 即启动期限，`drain` 清状态并唤醒；最终响应完成也有期限，堵塞或错误回收 stream/连接；取消输出最多保留 100 ms 发送终态 |
| 诊断 | 至多 64 条；message/path/dataPath 各 512 字符、code 128 字符，已失败句柄不保留原始无界诊断对象 |

非 HTTP `events()`/兼容 `source` 的消费水位在下一次拉取源之前等待；单条合法消息可以超过事件字节高水位，但仍受单条消息预算约束。未挂接迭代消费而仅 await `result` 的运行继续主动消费，backlog/result 受 run 条数与字节预算约束。SSE 的 message 闸门最多多持有一条已校验候选；合法大流经过真实 `write(false)`/`drain` 仍完整收到终态。`streamDelayMs` 是默认 0 的演示间隔，可取消。sender Promise 在目的响应 finish/close/失败时结束；终态事件与传输完成分别判断，传输错误不能倒写 store 已确认提交。

执行/排队超时默认 `null`，启用需正安全整数。排队取消清除 timer、释放 pin，不调用工厂。执行超时调用取消信号；提交前取消及时返回唯一终态，同时向持有的 iterator 请求 `return()`，不依赖下一条消息。宿主操作或关闭仍在飞时隔离该 surface，已接受排队任务显式失败，新运行容量拒绝，直到真实退出才解除；隔离条目计入 `maxTrackedSurfaces`，不能靠终态记录淘汰绕过。普通失败关闭源最多等待 100 ms 后报告原错误，未完成关闭仍保持隔离。宿主不协作时不承诺终止业务代码；提交已在飞时继续等待 §6.3 store 确认，不伪造 notCommitted。默认内存 store 的 `retainSurface` 对活动、排队及隔离运行保护快照，保护容量已满时工厂前拒绝；外部 store 未实现该可选能力可能因淘汰确定性拒绝提交。

### 6.7 旧 API 迁移表

| 旧 | 处置 | 落地切片 |
| --- | --- | --- |
| `surfaceRunQueues` 模块全局队列（send-messages） | 删除；runtime scheduler 替代 | S3.2 |
| `AgentAdapter.acquireSurfaceLock`（私有双锁） | 删除；统一调度接管 | S3.2 |
| `AgentAdapter.prepareGeneration/prepareAction` | 保留公开兼容外壳，内部委托同一调度；`{ok:false}` 收窄为入队前错误 | S3.2 |
| `AgentPlan` 语义 | `ok:false` 仅限入队前拒绝；运行内失败走句柄终态 | S3.2 |
| 生成提交的 hook/history 异常回滚快照 | **已删除（S3.3）**；扩展失败经 `onRunDiagnostic` 报告，快照与成功事实保留（§6.3） | S3.3 |
| ledger `failed` 记录重入 | **已落地（S3.3）**：三态 begin，任意已知记录拒绝重入，容量满拒绝且不执行 handler（§6.4） | S3.3 |
| `runsAccess` 路由选项 | **已迁移（S3.5）**：`access.read`，读取 403 码保持；路由未配置时回落 adapter 装配的 read 钩子 | S3.5 |
| `sendAgentRun(ctx, run, options)` | **已迁移（S3.5）**：签名保留；内部为句柄→SSE 薄适配，不自建队列或解释 Catalog；自定义 run 组合移入 runtime 模块 `startCustomRunTask`，sender 始终组合 req/res 断连与可选 signal，重复取消幂等；routes 的入队阶段监听在 sender 同步接入后释放（占用失败同样释放） | S3.5 |
| `sendMessages`（模块内，未公开导出） | 保留为非运行工具路径，不产生运行记录、不携带运行头 | — |

`AgentRun`/`AgentRunManager` 注入语义沿 S2.5 不变：自定义 run 必须显式传入 manager、`commit` 必须返回固定 `NexusSurfaceCommit`、`recordCommit` 为结果接口；SDK run 不接受另一个记录所有者。Koa 适配保持调用时响应占用与 `await`/`void` 时序（DESIGN D3）：排队 run 同步写 `X-Nexus-Run-Id` 头，两种调用写法均逐条下发；该保证属于 Koa 适配行为，非 Koa 消费不复制 socket 操作。

## 7. React 与 client 组合（2026-10-29 实施契约；阶段验收状态见 CURRENT）

client 对外提供会话控制器（`@nexus-ui/client`，会话、传输与 S4.1.2 隔离/恢复已实施）：`createClientSession(options)` 入口——稳定 runtime（外部注入或自建）、per-surface 状态（`streaming | ready | desync` 与 `actionOpen` 门控）、可解除订阅、`generate/action`（RunResult：committed/failed/canceled/desync/ignored）、`cancel` 及 `dispose`。`cancel` 只作用于调用时在途的运行，不阻断后续运行；会话级终态只有 `dispose`（销毁后入口抛错）。transport 可注入（`SessionTransport.open(request) → { runIdHeader, frames, close?() }`，`close` 幂等释放 reader/监听/定时器，会话在运行结束时一律调用，含未开始消费帧的提前拒绝）；首发自带 `fetchSseTransport(options)`，核心会话状态机不依赖 React 或 Node server 包。

`subscribe(listener)` 提供会话通知，`subscribeSurface(surfaceId, listener)` 只在指定 surface 的状态、基准或候选视图变化时通知，均可幂等解除。`getSurface` 返回递归冻结的视图/基准及冻结状态对象，状态未变时引用稳定，适合稳定快照订阅；dispose 清空订阅。`runtime` 身份固定；自建实例经 `runtimeOptions` 注入 Catalog/预算，dispose 清理其视图；外部 runtime 由创建者持有，session 不删除其既有视图。

**视图发布**：每次运行使用 core `createViewRuntime()` 复制 Catalog/预算配置，状态、草稿和宿主回调不共享。消息只写候选 runtime；`getSurface(id).preview` 暴露只读、稳定的渐进候选快照，未成功时不进入公开 `session.runtime`，也不授予 action。完整 done/EOF 校验通过后，core 对候选执行 Protocol/Profile/Catalog、root/全部静态引用（含无环）及预算重验，再经 `restoreSurfaceView`（生成）或 `commitSurfaceView(view, sentDrafts)`（action）一次发布。后者只确认发送代次，保留仍兼容的新编辑并在发布前合并；合并失败不写视图、不确认草稿并将会话置为 desync。失败、取消和无效流丢弃候选，原视图及有效草稿保留。

**React 只读预览（S4.3）**：根入口 `A2UIPreview({ view: SurfaceViewSnapshot, renderMap?, maxElements? })` 只展示已经 runtime 准入的候选，允许未到齐引用占位；以 core `buildTree` 构建树，不复制协议解释。无需 Provider/client，不订阅或写入 runtime；`actionsEnabled=false`、triggerAction 无操作、setInputValue 固定 false，外层禁用 fieldset。自定义控件仍应读取 actionsEnabled 展示禁用态。完整提交界面继续用 `A2UISurface`，由宿主将 client 的 actionOpen 接到 actionsEnabled；action 运行中的输入仍可编辑。ReactRenderer 子引用按同父级组件 id 的出现序号分配 key，避免共享 DAG 警告并保留普通 patch 身份。

**恢复**：`getCommittedSurface(id)` 返回同次成功提交的冻结 `{ view, commit }`，其中 view 不含后续本地编辑或候选 patch。`recover({ view, commit })` 仅接受可信宿主同次读取的完整视图与固定提交身份，核对 surface/Catalog/契约 hash，重验完整视图；低于本地已知 revision、同 revision 的身份或内容冲突一律拒绝，拒绝不改变原视图/基准/草稿。成功恢复清除旧草稿、设置固定基准、重开 action，并使该 surface 旧运行失效；不自动重试业务 action。宿主必须保证恢复数据来自同次权威读取，不能把查询到的新 revision 与旧视图拼接。SDK 不为任意 JSON 提供来源认证，也无法自行证明一个更高 revision 的内容来自服务端；需要重建同名 surface 的宿主应创建新会话，不能倒退本会话的已知提交。

会话状态机承担完整消费路径（抽取自两个参考浏览器，SPEC §5.1/§5.4 的客户端门控）：响应头权威 runId 关联（缺失不采信 done）、done 身份/catalogHash 按宿主提供的契约 hash 表门控、action 基准 revision 前进、生成视图归属与 root 校验、草稿随 `nexus.inputs` 发送并在成功后确认、终态后额外事件使流无效、EOF 无终态与 unknown 归入 desync 禁 action、取消丢弃生成预览。运行标识头常量 `NEXUS_RUN_ID_HEADER` 定义在 core，server 写入、client 读取，两端按值比对，不各持一份字面量。

**失败分级**（与 §5 提交三态同口径，S4.1 定型）：`failed` 用于身份关联可信且未报告准入拒绝的 `error + notCommitted`，即使此前有候选 patch 也丢弃候选并保留原提交视图，action 保留旧视图与动作出口。`RUN_ADMISSION_REJECTED` 未细分 revision/hash 等拒绝原因，统一 `desync`，不解析错误文案。`error`（含 `beforeStart`）也须匹配响应头 runId 和已知 surface。缺运行标识、done 身份/版本不符、无效流、EOF 无终态、unknown、本地消息拒绝或候选完整校验/发布失败均归 `desync`；generate 丢弃预览，action 保留可见视图但关闭动作出口。

调用 `transport.open` 即视为请求可能送达：open 抛错或收到首帧前取消都不能证明宿主未提交，action 归 `desync`、不推进基准、不确认草稿；确定未发送的 action 取消保留旧基准并返回 `canceled`。生成取消返回 `canceled` 并丢弃预览。运行须先登记再通知订阅者，发送前、每条 runtime 写入前及 EOF 后终态副作用前检查有效性，订阅内同步 cancel/dispose 与 abort 后正常 EOF 均不能复活运行。取消不等于撤销宿主业务副作用，SDK 不自动重试。候选写入隔离且不可 action；成功发布后的观察者异常不能倒写提交事实。

**传输资源边界**（S4.1.3）：`fetchSseTransport` 默认建连 30s、空闲 60s、总时长 600s 超时，单帧 1e6 UTF-16 代码单元（不含空行分隔符）、单次响应 16 MiB 原始字节预算。先拆完整帧再按帧检查，剩余半帧单独限额；同一内容不因网络分片/合并而改变接受结果。错误响应体读取同受空闲/总时长/字节预算及取消约束，诊断最多保留 500 字符；非法 content-type 直接关闭响应体。总时长从 open 开始计量，也覆盖消费暂停；关闭时不等待宿主自定义 cancel 钩子完成。超时/越界抛错（action 归 desync）。预算须为非负安全整数，非法配置在工厂入口报错，`0` 关闭该项。按 surface 的交互可用状态经 `getSurface/surfaces/subscribeSurface` 提供；订阅与 `onListenerError` 回调异常均隔离。

React 以 `A2UIProvider` 提供稳定 runtime/context，以新增 `A2UISurface` 按 surfaceId 渲染；Provider 不隐式输出 surface。宿主可只传本地 runtime，不必创建网络 session。会话消费方经 client 按 surface 订阅后传入 `actionsEnabled`；Surface 在 renderer 的 `ctx.triggerAction` 统一门控（包含自定义 keyboard/change 等事件），标准 Button 显示 disabled，自定义控件通过 `ctx.actionsEnabled` 展示状态。本地输入写回不随 action 禁用而关闭。Surface 根以 data-actions-disabled 标记动作状态，不设置会影响后代输入的 aria-disabled；具体动作控件表达其 disabled/aria-disabled，预览仍用禁用 fieldset。标准输入控件的 DOM id 与协议 componentId 分离，标签和错误说明按挂载实例关联；同名组件跨 surface、预览/提交或重复挂载不串联，写回仍使用原 componentId + surfaceId。两个参考浏览器已随 S4.3 接入此装配；重新生成显式替换会话，切换/卸载释放旧会话，原有 action 请求期间保持提交视图及输入可编辑。

订阅必须可解除；外部 runtime/session 由创建者销毁，Provider 自建 runtime 由 Provider 销毁。renderMap、catalogRenderMaps 更新会重新渲染，回调经 ref 更新，父组件重渲不重置 runtime；Surface 使用 `useSyncExternalStore` 订阅稳定的 VNode 根，切换 surface 与 render/订阅间更新不会沿用旧视图。受控删除同步清空根缓存并通知 null，surface/render 观察者异常不阻断状态发布。外部 runtime 的回调仍由创建者装配。样式需显式调用根入口 `injectNexusStyle()`，import 不注入全局动画。

## 8. 版本迁移与验证

core/server API 1 保持；React API 随 Provider/Surface 行为变更提升为 2，消费方需显式放置 `<A2UISurface surfaceId="..." />`，并按需调用 `injectNexusStyle()`。client 随 S4 新增，通过公开根入口导出 RecoverInput 等类型。目标改造涉及 Provider 行为、默认依赖、Catalog 与 HTTP envelope 的破坏性变化。各切片同步公开根导出快照、消费方、迁移说明；交付新的破坏性契约时提升相应 API 版本。包版本与 workspace 安装规则遵循 AGENTS.md，文档定稿不提前改包版本。

Catalog Contract 版本在 S2 升至 2：hash 对 `{ contractVersion, catalog }` 稳定序列化取 SHA-256；catalog 先规范化为 JSON 传输形状（合法可选字段的显式 undefined 与省略等价），纯 JSON 声明的既有摘要不变（2026-10-21 复审修正），版本常量提升后全部 hash 随之变化；输入能力、action 参数 schema 与组件声明都进入发布内容，能力变化必须影响 hash。surface 快照在创建时固定 `contractVersion` 与 `catalogHash`，请求携带值与固定值不一致显式拒绝，registry 原地变更不回写已创建 surface。v1 的拒绝点是明确的：v1 形状 Catalog 在注册闸门报错，缺 `nexus` 的 action 请求在解析入口拒绝，不维护 v1/v2 两套通用解释器。迁移样例以 `fixtures/catalog-v2/` 的正常夹具与 S2.6 的最小接入样例为准；各包 API 版本随其破坏性行为落地的切片提升并同步消费方。

运行标识切片（S2.5.1）的版本决定：Catalog Contract 保持 2、Nexus Session 保持 1——本切片只收口 server 装配层契约（`AgentRun.runId`、`commit` 必须返回固定结果、`AgentRunManager.recordCommit` 结果接口），不改变任何线上结构，`NexusSurfaceCommit` 与 `{ message, nexus }` envelope 字段不变，因此不提升协议版本。agent onboarding contract 保持 1：本切片未新增必需字段或验收项，未改变外部 Agent 的消费者要求；后续新增必需字段/验收项时必须显式提升 `AGENT_ONBOARDING_CONTRACT_VERSION` 并同步类型、解析与示例。外部 Agent RPC version 保持 1：请求结构未变，action 载荷已内嵌完整 nexus 元数据；后续只增补已存在 action 的元数据透传不机械升版，改变必需结构则先更新 SPEC 再成组迁移，不保留两套准入解释器。装配层 TypeScript 契约的破坏性迁移（`commit(): void`、自定义 `AgentRun`/`AgentRunManager` 旧签名）在本切片内显式完成，不留两套签名解释；包 API 版本仍按本章首段口径随发行节奏处理，不提前改包版本。

发布一致性切片（S2.5.5，2026-10-20 评审修正）：路由装配期对每个待发布 Catalog 先复制后经 core 注册闸门校验，contractHash、promptContract 与发布声明来自同一独立副本；必须通过实际 `adapter.describeCatalog(catalogId)` 读取执行声明并核对 hash，未注册或错配即装配失败，不提供独立的 executionRegistry 作为替代权威。adapter 在每个 Catalog 首次发布/执行时校验并固定声明副本，随后外部 registry 或调用方对象变更不影响该 adapter 的发布或执行；更新已固定 Catalog 需重建 adapter 并重新装配发布。允许只发布执行 Catalog 的子集，未发布项 404，不公开私有声明。

发现客户端逐项校验 serverApiVersion、契约版本、完整 `sha256:<64 hex>` hash、组件/action 非空字符串及无重复、非空发现 URL，任一非法整体拒绝。对象键顺序不影响 hash，能力/schema 变化必须影响 hash；摘要和完整发布内容由同一副本推导。`createAgentOnboardingContract` 复制输入后检查 serverApiVersion、kind、contractVersion、hash 格式、完整 Catalog 注册合法性、hash 与内容一致、prompt 与 `createCatalogPromptContract(catalog)` 完全一致，并内嵌独立副本；`verifyExternalAgentOnboarding` 在调用 Agent 前复用同一内部校验，内嵌契约不能采用较宽松规则（2026-10-20 整体评审修正）。core 根入口公开 `getCatalogContractHashInput`/`isCatalogContractHash`/`CATALOG_CONTRACT_HASH_PATTERN`（S2.6 起公开，2026-10-21 验收核实 dist 根入口导出），浏览器 Web Crypto 复算与 server hash 共用同一规范化（§2）。本切片不新增线上字段或必需验收项，Catalog Contract 2、server API 1、onboarding 1、RPC 1 均保持，包版本遵循 workspace 发行规则；严格装配验证不引入第二套契约解释器。

新增 client 后，只通过四包公开入口消费；不强制所有应用安装四包。协议/Profile 与组件能力校验使用共享正常/非法 fixture 在 core、server 和 client/React 接入验证，不等待业务应用重建。conformance 变更须显式更新分类理由和基线。

发行须对当前产物做仓外干净安装、types/exports/依赖/兼容检查及真实浏览器关键路径验收。当前 workspace 测试和历史数字只证明对应快照；任务状态与执行命令见 CURRENT。

### 8.1 目标发行产物（待实施）

首发每包交付可原生加载的 ESM `.js` 与 `.d.ts`；建议 `.js.map`，发布时保证源码映射可用。视图包可提供显式公开的样式入口，宿主按需引入；当前 React import 不注入样式，动画由根入口 injectNexusStyle() 显式选择；独立 CSS 尚未交付。不提供 CJS、UMD 或 IIFE；包内不重复捆绑 React/Vue，框架依赖以 peer dependency 声明，内部包按依赖关系消费。

当前构建仍使用 `fix-esm-imports.mjs` 补齐相对路径。目标以显式 `.js` 源码路径和 NodeNext 配置在编译时保证 Node ESM 可解析性；通过产物原生加载、类型解析和浏览器打包验证后才移除脚本。仓库内类型解析（含 SDK 包间与全部消费方）统一走 node_modules 的当前 dist 声明：tsconfig 不设源码 paths 别名（2026-10-21 验收移除），typecheck 依赖先构建的产物。宿主通过公开包入口消费，不运行 SDK 构建脚本。

### 8.2 公开入口与高层 API（目标）

目标各包提供独立公开根入口，宿主按环境与框架安装选用；暂不提供统一重导出四包的总门面包。高层接入能力在职责内聚合：client 管会话，React 管视图，server 管运行装配，core 保持可独立消费。浏览器入口不重导出 Node server；框架无关入口不引入 React/后续 Vue。精确 API 随实现切片定型，兼容与产物门禁须验证层间组合，不以 tree shaking 替代环境边界。
