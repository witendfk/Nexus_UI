# DESIGN — SDK 设计决策

更新：2026-10-30。需求见 [PRD](PRD.md)，精确契约见 [SPEC](SPEC.md)，结构见 [ARCHITECTURE](ARCHITECTURE.md)，实施顺序见 [CURRENT](tasks/CURRENT.md)。已决策不代表已实现；本文不记录应用业务决策。

## 决策索引

| 决策 | 选择                                            | 状态                                    |
| ---- | ----------------------------------------------- | --------------------------------------- |
| D1   | Protocol / Profile / Catalog / Host Policy 分层 | 保留；默认示例规则按 D4 迁出            |
| D2   | 以独立接入和 SDK 门禁验收                       | 更新；业务应用不再是发行前置            |
| D3   | Koa 适配器调用时同步占用 SSE 响应               | 保留已有修复，限定在 Koa 适配层         |
| D4   | SDK 中立默认值与显式宿主装配                    | server 侧已实施（含 runs 准入默认拒绝） |
| D5   | 区分消息状态、运行提交与业务结果                | server/client 已实施；阶段验收见 CURRENT |
| D6   | 四包目标与可选框架适配                          | 已决策；client 包已创建（S4.1，2026-10-28），可安装声明归 S5 |
| D7   | Provider / Surface 分离，runtime 身份稳定       | 已实施并验收，证据见 S4-ACCEPTANCE          |
| D8   | 声明式输入与 action 能力                        | 已实施（S2.2–S2.6，草稿确认语义 2026-10-20） |
| D9   | 单一运行调度与有界资源                          | S3 已实施并验收（2026-10-28），证据见 S3-ACCEPTANCE |
| D10  | ESM 与类型声明为首发产物，消除产物路径修补      | 已决策，构建迁移待实施                  |
| D11  | 保留段、媒体 URL 与正则求值的统一安全口径       | 已决策，S1 已实施（core/react）         |
| D12  | 按职责分包，通过层内高层 API 聚合接入能力       | 已决策，暂不新增总门面包                |

## D1. 分层准入

**选择**：Protocol 判断 A2UI v0.9 结构；Profile 声明支持子集；Catalog 定义组件、字段、绑定和 action 能力；Host Policy 表达显式注入的宿主规则。安全基线始终执行。prompt contract 从相同 Catalog 生成，只指导生成，不替代准入。

**依据与代价**：协议合法不代表当前宿主支持。保留分层 diagnostics 和 conformance 偏差，避免把受限 Profile 宣称为完整官方 Basic Catalog。公共纯校验逻辑只维护一份；客户端本地校验和服务端权威准入可复用它，但承担不同责任。

## D2. SDK 门禁独立于业务应用

**选择**：用仓外独立宿主、自定义组件和失败反例验收 SDK。业务副作用以可观测宿主替身证明；验证宿主与 Agent 尚未选定，不以现有 demo 代替选型。SDK 评审只核对公开接入契约，不评审业务应用的内部工程；业务应用自行定义领域验收。先解决接入模型，再冻结公开 API，随后完成最终产物/兼容/浏览器门禁。

**变更依据**：旧决策把首条业务闭环与 alpha 绑定，扩大了 SDK 的验收范围。当前用户已明确要求 SDK 只提供基建能力。真实应用继续提供集成反馈，SDK 交付不等待业务应用重建。

**代价**：须维护能触发失败条件的独立验收夹具；无法用业务演示或旧测试数字代替门禁。

## D3. Koa SSE 响应及时占用

**已有证据**：2026-10-15 修复 `105ee34`，`sendAgentRun` 调用时同步 `ctx.respond = false`、`flushHeaders`、`pipe`，让排队 run 不回落 404，宿主 `void`/`await` 均保持流式下发。

**限定范围**：这是 Koa 适配器的实现决策。运行模块负责调度、准入、提交、取消与释放；Koa 适配器负责响应占用、序列化、背压和连接生命周期。运行模块不接受 Koa Context，不用 `streamClaimed` 一类由 HTTP 层回写的标志决定锁所有权。

**代价与回归要求**：保留两种调用写法、排队响应和错误转发反例；移出参考服务时不得破坏已有时序。SDK 通用契约不要求其他框架复制 Koa socket 操作。

## D4. SDK 默认行为保持业务中立

**选择**：生成源、Catalog、Host Policy 和 handler 显式注入。缺少必需依赖显式报错；未声明 action 不继承示例白名单；未声明业务 Policy 不继承搜索、表单或客户跟进规则。模型 key 不改变通用 runtime 的生成源选择。runs 查询访问控制默认拒绝：宿主未配置 `access.read` 时（S3.5 前为 `runsAccess`） `GET /api/a2ui/runs` 一律 403，`surfaceId` 不作为凭据。

**实施状态（2026-10-16，server 侧）**：`AgentAdapterOptions.registry` 必填；`historyStore` 缺省为每实例隔离新建，模块级全局单例已删除；`useLlm` 默认 false，启用必须显式注入 `streamLlm`；generate 请求 `catalogId` 必填，legacy URL 不再静默归一；guard 序列选项 `catalogId`/`registry`/`supportedActions` 必填，Button/TaskButton 挂载特判删除（归 Catalog v2 声明能力）；当时 `sendAgentRun` 必须显式传 `manager`（由下述 S2.5 决策取代）；参考 Catalog/LLM/prompt/演示 handler/环境读取/listener 迁至 `examples/playground-server/`。上述行为均有先失败后通过的证伪测试。

**保留与迁出**：标准组件契约、安全 URL 使用约束、原型防护、正则与资源限制保留。联系人/任务/Workbench Catalog、流程 Policy、prompt、模型调用、模拟 handler、环境读取和 listener 迁至参考应用。外部 RPC helper 作为可选适配保留，不引入 Agent 编排或业务模型。

**代价**：默认行为变更属于破坏性迁移，须同步示例、API 契约和迁移说明；不以删除 demo 能力替代依赖隔离。

**S2.5 所有权修正（2026-10-20）**：runManager 在 adapter 注入或默认隔离新建，HTTP 与非 HTTP 共用 managed run 的生命周期；router/sender 不另建记录所有者，显式 manager 不一致即拒绝。容量准入先于生成源工厂/handler 调用及 SSE 占用，工厂/handler 异常属于运行失败。发布绑定实际 adapter 的首次固定 Catalog，拒绝独立的第二份执行 registry；这样直接消费与 HTTP 具有同一结果事实，不将 Koa 当运行事实所有者。完整 scheduler 已随 S3.2 抽取。

## D5. 三种状态与预览隔离

**选择**：core 按 A2UI 消息顺序更新状态；client/server 的运行层区分临时预览和已提交 revision；业务成功与失败由宿主认定。Nexus 的运行元数据不写入 A2UI 消息 payload。

client 只在明确成功终态且本地校验通过后开放当前 revision 的 action。失败丢弃本次预览；已有提交视图可保留展示，但在提交结果未知或版本不一致时必须标记失同步并禁用 action。缺失终态、网络中断和提交确认丢失不能推断服务端未提交。

**S4.1 门控决定（2026-10-28）**：是否已调用 transport.open 是客户端能可靠观察的发送边界，未收到响应头不证明未送达；发送后取消/网络失败按失同步处理。准入错误暂未细分 revision/hash 原因，统一关闭旧动作资格，不通过错误文案猜测安全性；确定未发送的取消与可信 notCommitted、未改动视图且无准入拒绝的失败可保留旧基准。消息接受结果由 core 显式返回，避免复制校验器或依赖有界日志长度。S4.1.2 已实现独立候选 runtime、成功发布时草稿协调与受控恢复（2026-10-29）；可信 notCommitted 即使已有候选 patch 也保留原提交视图与动作资格。

**提交事实口径（S3.1 补充，2026-10-22）**：服务端 commitState 由 store 结果契约三分（SPEC §6.3）——确定性拒绝为 notCommitted，确认提交为 committed，store 异常且无法证明未写入为 unknown（不得凭异常推断未提交）；确认后不可倒写。客户端在未获得可信终态时保守使用 unknown。

**副作用边界**：取消与 patch 失败不回滚宿主事务。SDK 不自动重试业务 action，不把 ledger 的 failed 当作业务可重试。宿主可提供不透明操作关联标识及恢复回调；SDK 不内建领域结果库。

**代价**：每次运行持有独立候选 runtime，增加一份有界视图；公开 runtime 保留提交视图与本地草稿，固定提交快照不含编辑。recover 只检查结构、身份、已知版本与内容一致性，来源与同次权威读取由可信宿主保证，不虚构对任意 JSON 的提交认证。

## D6. 四包目标与适配分层

**选择**：目标为 core/client/react/server。core 负责协议与状态；client 依赖 core，提供无 React 依赖的浏览器会话和 fetch/SSE 适配；React 依赖 core，接收稳定 runtime/视图状态，不强制使用 client；server 依赖 core，内部区分通用运行模块与可选 HTTP/RPC 适配。client 与 server 不互相 import 实现。

**依据与现状**：两个浏览器曾重复实现 SSE 消费，促成 client 抽取；S4.3 已统一使用 client 并删除复制实现。Provider/Surface 已分离；server 的通用运行逻辑已随 S3 从 Koa sender 移出，阶段验收见 CURRENT。

**约束**：client 已随 S4.1 新增（2026-10-28，`packages/nexus-client`，依赖 core，无 React/server 依赖），alpha 安装声明仍归 S5。共享协议与运行元数据类型放在 core 的纯契约模块；不额外拆 guard、Policy、Catalog 或 Agent 包。Koa 入口可留在 server 公开根入口，框架无关入口的加载不执行 listener/环境读取，也不要求模型 SDK。

**代价**：新增一个包的构建、兼容和发行维护；由消除跨示例关键逻辑复制获得收益。不同 transport 通过薄适配接入，不在首发建设通用插件平台。

## D7. 稳定 runtime 与独立 Surface

**选择**：Provider 管理上下文与订阅所有权；Surface 按 surfaceId 渲染到宿主选择的位置。外部 runtime 的销毁由创建者负责；Provider 自建 runtime 在卸载时释放。React 使用稳定快照订阅，renderMap/onAction 变化不意外清空已有 surface。

**依据**：原 Provider 以一个 `tree` 接收全部 surface 且固定输出在 children 前，不适合多 surface 和宿主布局。现已改为按 surface 的显式槽位。

**只读预览（S4.3）**：React 提供 `A2UIPreview` 展示 client 暴露的候选快照，关闭输入/action 回调且不读写 Provider 状态；React 不依赖 client。生成可渐进展示，action 运行期间保留可编辑的已提交视图。动作禁用仅作用于动作控件与回调出口；Surface 根使用普通状态标记，避免 ARIA 禁用语义传播到可编辑输入（S4.4 浏览器复验）。示例重新生成是显式替换会话，不以意外 Provider 重渲重置状态；切换与卸载由创建者解除订阅并 dispose。

**代价**：Provider 的隐式输出迁到显式 Surface，是公开行为变更。提供迁移示例；保留轻量 core 接入，不要求本地 JSONL 使用者配置 HTTP。

## D8. 声明式输入与 action 能力

**选择**：组件声明提供可写绑定属性、值 schema；宿主运行配置限制允许编辑的 JSON Pointer。SDK 验证组件与 revision、声明路径及类型后提取最新输入；从服务端持有的 action 声明重新解析参数。宿主 handler 再核对身份、业务对象和业务状态。

自定义 action 组件依据 Catalog 能力准入，不按 Button/TaskButton 名称特判。未声明字段与 action 拒绝。schema 的支持子集和新增声明随 Catalog Contract 版本演进，禁止忽略不支持的配置。

**契约定型（2026-10-16，S2.1）**：

- v2 采用单一组件声明表（`CatalogDefinitionV2.components`），替换 v1 的 components/componentSchemas/componentPolicies 三张平行表，name-only 条目不复存在；`actions` 必填，展示型显式 `[]`。
- action 挂载权威在 `CatalogActionDeclaration.sources`；组件侧只保留 `action.required`，「required 组件不在任何 sources 中」属矛盾声明，注册报错。该选择取代 v1 组件侧 `action.allowed` 与 validator 中按组件名禁止挂载的分散规则，注册闸门同时校验两向一致性。
- `inputs` 声明可写绑定属性 → 值 schema，键必须是 `dynamic` 非 `forbidden` 的已声明字段；值 schema 只描述浏览器提交的字面值，不含 `dynamic`。字段绑定能力唯一权威是 schema 节点的 `dynamic`（缺省即 `forbidden`），`fields` 收窄为 origin/componentRef 元数据、不再声明 `binding`，v1 风格双源声明按未知键注册拒绝。浏览器只提交 `{ componentId, property, value }`，目标路径由服务端从已提交声明解析，客户端永不提交写路径。
- 可编辑白名单为宿主按 surface 提供的精确 JSON Pointer 集合：绝对指针、规范化后判重、默认拒绝、无通配与前缀继承；白名单自身允许嵌套重叠。同批 inputs 写入与数组顺序无关：重复、同目标路径、解析路径互为祖先/后代（按段比较）均判冲突拒绝；未变化输入合法，按普通输入幂等写回。
- resolver 扩展点后置：共享准入（revision/hash 核对、声明、白名单、值 schema、重复冲突）先执行，resolver 输出仍须通过未声明字段拒绝与 `paramSchema`；`paramSchema` 缺省即参数必须为空对象。
- nexus 元数据类型定在 core `session` 模块（`NEXUS_SESSION_VERSION`、`NexusActionInput`、`NexusActionMetadata`），server 组合 `{ message, nexus }` 请求 envelope。固定提交结果 `NexusSurfaceCommit` 同样由 core 定义，server 的 `SurfaceStateBaseline` 为其别名；S2 通过 `GET /api/a2ui/surface-state?surfaceId=&runId=` 查询指定运行在提交边界保存的不可变结果（宿主准入沿用 `access.read`，S3.5 起由 `runsAccess` 迁移，未配置 403），成功 done 已随 S2.4 复审提前携带该结果，S3 接续完整 Session 生命周期。S2.5 由生成/action 响应头 `X-Nexus-Run-Id` 关联本地流，跨源时显式暴露；原始 A2UI message 形状不变，SDK 提交结果放在 done data。记录缺失/淘汰拒绝，绝不回退为最新快照；浏览器只能给同一成功且已校验的运行视图附上该结果。其他运行更新 surface 时，旧视图仍携带旧 revision 并被拒，必须恢复视图，不能仅查询元数据解除失同步。surface 快照固定 contractVersion/hash；`pattern` 注册口径与有界求值引擎一致。
- 共享正常/非法 fixture 定稿于 `fixtures/catalog-v2/`，core 注册与 server 准入对同一数据必须给出一致结论。

**实施状态（S2.2 已完成，2026-10-17 收尾）**：`CatalogDefinition` 已切换为 v2 形状（V2 后缀移除）；注册闸门实施 §4.2 全部拒绝规则（含 enabled/componentRef 布尔、安全整数预算等类型校验）；`standardCatalogComponentDeclarations()` 提供 17 个标准组件声明且每次调用返回深拷贝；checks 能力、函数子集与预算统一由当前 Catalog 决定（Profile 只校验结构与安全基线，不读取 SDK 固定标准声明；DateTimeInput/媒体组件的 checks 名字禁令删除）；FunctionCall 仅在已校验的组件 checks.condition 位置豁免，参数内部仍递归检查；字段结构契约与 URL/正则/原型/预算基线保留；未注册 action 名与 sources 越权由共享 Catalog 诊断统一报告；成员判断只读自有属性。conformance 基线经分类决策更新为 36/13/23/5/3（ChoicePicker/CheckBox 共 3 条 checks 用例转为 pass，DateTimeInput 仍由字段约束拒绝；详见 SPEC §1）。该时点待接线的浏览器/server 输入准入，现已由下述 S2.3/S2.4 完成。

**实施状态（S2.3 已完成，2026-10-18）**：浏览器本地写回与输入收集落地。`setInputValue(componentId, surfaceId, property, value)` 删除五组件名字分支：可写属性必须是当前宿主 Catalog `inputs` 声明键（自有属性查表），值经声明值 schema 字面校验（`{ path }` 形状的值按绑定拒绝），写回目标取组件 `{ path }` 绑定并拒绝保留段；未注入 registry 即无任何写回能力（标准名不隐含能力），写路径异常（中间节点非容器）收敛为拒绝而非向宿主抛错。成功写回按 surface 记录「组件 + 绑定属性 → 最新值」草稿（structuredClone 值快照隔离），`getLatestInputs(surfaceId)` 返回与内部模型、草稿隔离的深拷贝 `NexusActionInput[]`。草稿保存来源（Catalog、组件类型、绑定路径、组件声明指纹），在接受组件更新后立即清除失效条目并于提取时复核，防止改绑或替换再恢复时复活旧值；同类型同绑定的普通属性更新保留草稿，`deleteSurface` 清理；这是 S4 client 读取输入草稿的公开原语。React `RenderContext.setInputValue` 同形增加 `property` 参数，五个标准控件固定上报 `value`，不解释可信写路径。本地拒绝类别与草稿语义见 SPEC §4.3。Playground 从现有同源 `/api/a2ui/catalog-contract` 接口加载三个已发布声明，全部通过 SDK 注册闸门后再挂载 Provider；加载失败显式报错，不复制另一套浏览器声明表。

**实施状态（S2.4，2026-10-19 复审修复）**：server 的 `agent/action-admission.ts` 在 surface 锁内完成必填 nexus 基准、来源能力、整批输入、精确白名单与声明参数重算；resolver 后置且最终输出仍受未声明键/paramSchema 校验。core 共享严格输入寻址按实际对象/数组容器解释，拒绝根替换别名与所有非规范数组索引。存储入界/出界、临时模型、待提交输入与扩展上下文均隔离引用；准入、流 guard 和提交复核使用固定 Catalog 副本，guard 以已提交组件表和临时输入模型为起点。

提交采用「输入基础模型 → handler patch」顺序，归一化结果及根替换以 handler 为准；消息源先发输入模型再发 patch，保证浏览器与存储组合一致。实例级单调计数器不因删除/淘汰重号，action 提交同时核对 revision/epoch；非 HTTP 正常 EOF 仍持锁，直到 commit/onError/dispose。移除按 HTTP 回写 `streamClaimed` 转移锁所有权的机制。

**实施状态（S2.6.4.1，2026-10-20）**：草稿确认语义定型并落地 core 公开原语。备选方案对比：按「发送前值快照相等」删除会把发送期间改回同值的新编辑误删；按「整 surface 计数器」删除会让同 surface 的部分编辑拖住全部草稿不确认，旧值在下次提交重发并覆盖服务端归一化结果。选择逐条草稿代次：每条草稿在成功写回时取得 runtime 内单调 serial；`extractLatestInputDrafts(surfaceId)` 返回 entries（wire 输入 + serial，与 `getLatestInputs` 同一套失效清理），`confirmInputDrafts(snapshot)` 仅删除 surfaceId 匹配且 serial 仍相等的条目。快照携带 runtime 实例标识，跨实例确认不改状态；确认幂等；失败/取消/本地拒绝不调用即不确认。2026-10-21 复审修正：action 流按输入基础模型 → handler patch 应用；成功接受后 `confirmInputDrafts(snapshot): boolean` 确认未再编辑项，并原子恢复剩余有效草稿到本地编辑模型，serial 不变。已确认字段显示服务端归一化结果，新编辑保持可见，避免隐藏草稿被下次提交。恢复不是服务端提交或 revision 更新；写路径失败返回 false、模型与有效草稿均不部分修改，消费方不开放新基准；跨 runtime 返回 false。

**实施状态（S2.6 消费方迁移，2026-10-20）**：两个参考服务与两个参考浏览器已按上述语义迁移——发布列表取自 adapter 固定执行声明；可编辑白名单由宿主侧 surface→Catalog 映射（生成提交边界记录、有界、未记录即拒绝）按 Catalog 精确给出；浏览器契约加载经版本/身份/hash（Web Crypto 复算 core 公开的规范化载荷）/标准 prompt/注册闸门后才挂载；运行标识以响应头为权威，event id 只作帧信息；请求代次在逐帧写入前核对，取消/切换 Catalog/卸载立即失效并清理 reader，晚到结果不写视图或基准；在途重复 action 忽略而不打断原运行。生成必须消费本次新建 surface 与 root，核对请求 Catalog，拒绝 done-only 响应借用旧视图；action 核对固定身份与递增 revision。hash 规范化先使用 JSON 传输形状，显式 undefined 可选字段不产生传输前后摘要差异。中立 scorecard 夹具（整数非 value 属性、布尔、非 Button 触发器）与 Basic 表单作为两组无关 Catalog 完成连续交互与隔离对测。`sendAgentRun` 的 idPrefix 兼容槽位随 S2.6.5 删除。

复审同时提前接通最小 HTTP 契约：只接收 `{ message, nexus }`，保留客户端 actionId，不读取最新快照为旧视图填充基准。commit 捕获并返回固定 `NexusSurfaceCommit`，成功 done 直接发布；两个参考浏览器仅为成功消费的本次视图保存该结果，缺终态/失败/本地拒绝后不开放 action。**S2.5.1/.2/.5 已交付并完成评审修复（2026-10-20）**：运行 ID 与提交身份统一校验，adapter 持有传输无关的结果留存所有者；发布强制绑定实际执行声明，首次使用固定副本；onboarding 完整校验。**S2.5 全部七项已完成（2026-10-20）**：按 run 查询、`X-Nexus-Run-Id`、verifier/RPC 贯通与并发关联复核已交付。整体评审修正将 onboarding 发布/消费的完整校验合并为内部单一入口；verifier 观察实际 handler 权威参数，并消费响应目的流至结束，避免缓冲阈值影响验收结论。消费方完整关联门控归 S2.6.3，完整调度/背压/commitState 归 S3，会话和预览隔离仍属 S3/S4。此处替代首轮七项整改中的 patch 后写输入、仅 epoch 核对与可信 HTTP 补基准方案。

**依据与代价（改造前基线）**：原写回只支持五个内置输入且不读 Catalog，默认 resolver 看不到浏览器编辑，自定义 resolver 可整体跳过未声明字段检查；每个宿主自写 resolver 容易复制安全逻辑。未知键从静默忽略收紧为注册报错属破坏性收敛，playground-server 等既有 Catalog 已随注册闸门切片迁移，依赖透传客户端 context 的测试写法将失效并改为显式声明。增加通用输入准入有维护成本，但不扩展为业务规则 DSL 或任意 dataModel 写接口。

## D9. 单实例调度与资源边界

**选择**：同一 server runtime 的每个 surface 只有一个运行调度所有者，覆盖读取快照、action 准入、handler 调用和 patch 提交；HTTP 适配器不另建全局 surface 队列。不同 runtime 的状态默认隔离。所有资源预算在超限时显式拒绝或降级，运行中记录不能静默淘汰。

**范围**：首发保证单实例内行为，允许宿主注入存储；持久化存储本身不产生多实例锁或领域幂等保证。分布式协调与业务唯一约束由宿主部署/业务设计承担。

**代价**：双锁/全局 store 迁移需要并发和取消反例；保留有界整树重建，暂不建设分布式执行引擎或自研 reconciler。

**契约定型（S3.1，2026-10-22）**：

- 入口与调度：server 公开 `createAgentRuntime` 工厂（见 D12）；每 runtime 实例一份调度器，同 surface 的 generation 与 action 同队列 FIFO 串行，覆盖快照读取到提交全链；不同 surface 并发，跨实例互不阻塞。入队阶段只做 access 钩子、队列容量与请求级校验，三类拒绝不建运行记录；调度内准入失败是运行失败终态（不再是入队前 400）。adapter 的 `prepareGeneration/prepareAction` 保留为委托同一实现的兼容外壳，不构成旁路。
- 提交事实三分：store 提交方法返回 `committed | notCommitted | unknown` 结果契约——确定性拒绝（revision/epoch 比较、结构校验）返回 notCommitted；无法证明未写入的异常一律映射 unknown；确认提交后取消/失败/传输异常不得倒写。发布点之后的 history/hook/recordCommit/传输失败按诊断面报告，不删除快照、不改写留存（替代 S2 的 hook/history 异常回滚快照方案）。
- ledger 重放：留存窗口内任意已知记录（含 failed/canceled）拒绝重入，`failed` 不是重试许可；SDK 不自动重放，业务重试归宿主。备选方案「failed 重入=业务重试入口」被拒：SDK 无法证明 failed 记录的 handler 未执行，把重试许可建在不可证明的事实上会把重复副作用伪装成安全行为。
- 资源预算：默认值定稿于 `fixtures/session-v1/budgets.json`（SPEC §6.6 同源）——run 512、ledger 1024、surface 256、history 64×20 沿 S2 并补活动/排队保护；每 surface 排队 32、全部活动/排队/隔离 surface 合计 512；每 run 消息、完整快照和 history 分别有字节上限。非 HTTP 迭代源与 SSE 都执行消费水位及慢消费期限，SSE 资源由适配器持有至响应结束或超时回收；执行/排队超时默认不启用、显式配置。非法配置装配抛错，超限显式拒绝，全部活动时拒绝新建而不淘汰活动记录。
- 访问准入：`access.read/generate/action` 钩子缺省一律拒绝（D4 默认拒绝原则扩展到写入路径），拒绝在入队前、不建记录不泄露存在性；`runsAccess` 迁移为 `access.read`，可信身份由宿主闭包从自己的上下文提取，SDK 不解释 context。（已实施，S3.5，2026-10-27：generate/action 配置于 adapter，钩子接收入口快照的冻结隔离副本，异步鉴权与执行使用同一入口值；HTTP 路由透传 Context；读取路由保持既有 403 码，generate/action 拒绝映射 403、容量拒绝映射 503。）
- Session 准备失败（S3.4 复审，2026-10-24）：身份尚不可得时不造 start，以 `beforeStart:true/notCommitted` 的唯一 error 收敛；generation 固定身份后即 start，history 读取失败仍是 start→error。core 检查跨事件身份与 action revision 推进；句柄在入队固定 actionId，提前退出归还未读缓存（含终态），接续消费不依赖生产速度。已存在的无标记排队取消形状继续可解析；不允许 beforeStart 声称 unknown。
- 取消语义：sender 始终组合连接断开与外部 signal，不以存在 signal 推断连接监听所有权；routes 入队阶段的监听在 sender 同步接入后释放，重复关闭/abort 幂等。自定义 run 初始化失败统一释放宿主资源，清理异常仅诊断并保留原错误。排队取消先于工厂/handler，无 start 事件、唯一 error 终态；store 确认提交后的迟到取消不倒写终态；宿主不理会 signal 时不假装已杀死业务代码，超时按取消收敛并丢弃晚到的 handler 返回（提交由 SDK 介导，悬挂 handler 无法自行提交）。（S3.6 已实施，2026-10-27：执行/排队超时可配置、默认不启用；执行超时发出 abort 并返回取消终态，宿主与关闭退出前隔离 surface、拒绝重叠；隔离计入全局 surface 硬上限。提交已在飞时按 §6.3 等待 store 确认。）

**S3.2 所有权落实（2026-10-23）**：调度关联放在运行模块，adapter/runtime/自定义 run 按 runManager 身份取得同一 scheduler；传输层不另建平行队列。显式共用记录所有者就共用调度；对同一所有者装配冲突 scheduler 直接报错，避免静默覆盖预算或串行边界。入队时隔离 action 请求，取消排队即释放额度；记录终态写入失败作为诊断报告，不能阻断句柄本地终态，也不假装外部记录已修复。

**S3.3 复审落实（2026-10-24）**：adapter 与自定义 run 共用 `RunRecordHandle.commitValidated`，确认提交后的留存、终态记录和宿主清理失败只报告诊断，不改写已发布事实。store 返回确认由 `runtime/commit-result` 核对结构、身份/固定契约和版本，异常确认按 unknown；取消状态不能覆盖确定拒绝。最终校验失败与其他发布前失败共用幂等 ledger 收敛，组合故障保留原错误分类。拒绝将「进入提交函数」等同「写入发生/结果未知」：提交步还包含可确定拒绝的最终校验和 store 返回结果。

## D10. 产物格式与原生 ESM 路径

**选择**：首发提供 ESM JavaScript 与 `.d.ts`，建议提供可用的 `.js.map`；React/后续 Vue 可提供显式导入的独立样式。暂不双发 CJS，不提供 UMD/IIFE；有明确消费需求再评估。SDK 保留模块结构，由宿主负责最终应用打包，React/Vue 为 peer dependency，内部包间依赖不重复内嵌。

**构建方向**：源码使用显式 `.js` 模块路径，以 TypeScript NodeNext 检查 Node ESM 可解析性；浏览器包同时验证现代构建工具接入。当前 `scripts/fix-esm-imports.mjs` 是四包构建中的产物修补步骤，先保留；完成路径迁移、构建与原生 Node 加载验收后删除，不要求宿主运行该脚本。

**代价与验收**：源码路径需要统一迁移，兼顾类型导出和包边界；S5 用当前构建产物验证 Node、浏览器打包和 TS 消费。source map 若发布须包含可用的源码映射，不发布指向缺失源文件的调试资源。此决策不代表当前已有独立 CSS 或 NodeNext 配置。

## D11. 保留段、媒体 URL 与正则求值的统一安全口径

**选择**：`__proto__`/`constructor`/`prototype` 为 SDK 唯一保留段口径，判断逻辑在 dataModel 定义处导出（`isUnsafeSegment`），准入与运行层共用。准入侧：`action.event.context` 键与组件 props 层自有键含保留段拒绝；`component.id` 与四处 `surfaceId` 三段全拒。运行侧纵深防御：`resolveContext` 遇保留段键抛错（写返回对象会触发 `__proto__` 访问器改写原型），`buildProps` 静默跳过保留段键。媒体组件 Image/Video/AudioPlayer 的字面量 `url` 准入时必须经 `isSafeMediaUrl` 判定为 http(s)（URL 解析后读 protocol，不做字符串前缀匹配——前缀写法可被大小写与协议相对形式绕过）；`{ path }` 绑定无法在准入层判定真值，React 渲染层解析后复用同一 util 守卫，非法时不输出 `src` 并渲染带说明性 alt/aria 的占位。Catalog schema `pattern` 与 checks 路径同口径：注册闸门强制长度上限并拒绝嵌套量词，求值统一走 `compileSafeRegExp` 有界线性引擎（checks 的 safe-regex 为唯一正则求值实现），编译失败产生 schema 诊断。

**评审补充**：安全闭环还覆盖组件表、Catalog schema/Policy 表和 renderMap 的自有属性查找；不通过黑名单代替正确查表，显式自有注册仍可使用同名组件。renderMap 值不是函数时降级。渲染与 store 容量须为正安全整数，空树也校验，避免 NaN/Infinity 关闭预算或负数导致无限淘汰循环。业务中立不意味着参考应用丢失自己的规则：参考工厂显式接回演示 Policy。SDK 三包 build 清除旧 dist，再验证当前源码对应的产物清单。

**依据**：三条路径的原有实现各自为政——dataModel 三段全拦、validator 只拦 `__proto__`、schema.pattern 裸用原生 RegExp（`(a|aa)+$` 类歧义 pattern 在失败值上指数回溯）。证伪测试确认均可复现污染、注入或挂起；统一口径后规则只有一份定义，准入拒绝与运行降级各司其职，避免下游消费方再自行推断边界。

**代价**：准入口径收紧属破坏性收敛——含保留段键/组件 id 的历史消息（含经 `JSON.parse` 注入的自有 `__proto__`）与字面量非 http(s) 媒体 URL 从放行变为拒绝；原生 RegExp 可编译但超出有界引擎兼容子集（环视、反向引用、超大重复计数）的 pattern 在匹配时产生「无法求值」诊断而非原生语义。误报场景按 Profile 兼容范围声明处理，不做静默兼容。

## D12. 高层接入 API 与包边界

**选择**：保留 core/client/react/server 的目标分包，暂不新增统一重导出四包的总门面包。各包通过公开根入口及职责内的高层 API 简化接入：client 会话控制器聚合生成/action、订阅、取消与恢复；React 提供 Provider/Surface/hooks；server 运行工厂装配准入、调度、生成源与 handler。名称与精确类型按对应实现切片定型。

**server 高层 API（S3 已实施，2026-10-28 验收）**：server 公开 `createAgentRuntime(options): AgentRuntime` 作为传输无关运行入口——聚合 adapter 全部显式装配项并新增调度/访问/预算配置，暴露 `generate`/`action` 入队结果、运行句柄（事件流、终态、取消/dispose）与只读查询；Koa router 退为薄适配。不新增包、不新增总门面包。

**依据**：宿主按环境与框架选用能力。浏览器入口不重导出 Node server，框架无关入口不引入 React/后续 Vue，不依靠 tree shaking 消除跨环境解析与可选依赖问题。统一文档和兼容说明可以提供一致接入体验；减少重复接线比减少包名更有价值。

**代价与重评条件**：消费方需要安装其使用的包；SDK 须保证跨包类型兼容与组合示例完整。只有实际接入证明安装/组合仍有明显成本时，才评估薄便捷包，并验证环境隔离、依赖和产物加载。当前不为该可能性预建新包。
