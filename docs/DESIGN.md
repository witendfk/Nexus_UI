# DESIGN — SDK 设计决策

更新：2026-10-16。需求见 [PRD](PRD.md)，精确契约见 [SPEC](SPEC.md)，结构见 [ARCHITECTURE](ARCHITECTURE.md)，实施顺序见 [CURRENT](tasks/CURRENT.md)。已决策不代表已实现；本文不记录应用业务决策。

## 决策索引

| 决策 | 选择                                            | 状态                                    |
| ---- | ----------------------------------------------- | --------------------------------------- |
| D1   | Protocol / Profile / Catalog / Host Policy 分层 | 保留；默认示例规则按 D4 迁出            |
| D2   | 以独立接入和 SDK 门禁验收                       | 更新；业务应用不再是发行前置            |
| D3   | Koa 适配器调用时同步占用 SSE 响应               | 保留已有修复，限定在 Koa 适配层         |
| D4   | SDK 中立默认值与显式宿主装配                    | server 侧已实施（含 runs 准入默认拒绝） |
| D5   | 区分消息状态、运行提交与业务结果                | 已决策，待改造                          |
| D6   | 四包目标与可选框架适配                          | 已决策，client 尚未创建                 |
| D7   | Provider / Surface 分离，runtime 身份稳定       | 已决策，待改造                          |
| D8   | 声明式输入与 action 能力                        | 已决策，待改造                          |
| D9   | 单一运行调度与有界资源                          | 已决策，待改造                          |
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

**限定范围**：这是 Koa 适配器的实现决策。后续运行模块负责调度、准入、提交、取消与释放；Koa 适配器负责响应占用、序列化、背压和连接生命周期。运行模块不接受 Koa Context，不用 `streamClaimed` 一类由 HTTP 层回写的标志决定锁所有权。

**代价与回归要求**：保留两种调用写法、排队响应和错误转发反例；移出参考服务时不得破坏已有时序。SDK 通用契约不要求其他框架复制 Koa socket 操作。

## D4. SDK 默认行为保持业务中立

**选择**：生成源、Catalog、Host Policy 和 handler 显式注入。缺少必需依赖显式报错；未声明 action 不继承示例白名单；未声明业务 Policy 不继承搜索、表单或客户跟进规则。模型 key 不改变通用 runtime 的生成源选择。runs 查询访问控制默认拒绝：宿主未配置 `runsAccess` 时 `GET /api/a2ui/runs` 一律 403，`surfaceId` 不作为凭据。

**实施状态（2026-10-16，server 侧）**：`AgentAdapterOptions.registry` 必填；`historyStore` 缺省为每实例隔离新建，模块级全局单例已删除；`useLlm` 默认 false，启用必须显式注入 `streamLlm`；generate 请求 `catalogId` 必填，legacy URL 不再静默归一；guard 序列选项 `catalogId`/`registry`/`supportedActions` 必填，Button/TaskButton 挂载特判删除（归 Catalog v2 声明能力）；`sendAgentRun` 必须显式传 `manager`；参考 Catalog/LLM/prompt/演示 handler/环境读取/listener 迁至 `examples/playground-server/`。上述行为均有先失败后通过的证伪测试。

**保留与迁出**：标准组件契约、安全 URL 使用约束、原型防护、正则与资源限制保留。联系人/任务/Workbench Catalog、流程 Policy、prompt、模型调用、模拟 handler、环境读取和 listener 迁至参考应用。外部 RPC helper 作为可选适配保留，不引入 Agent 编排或业务模型。

**代价**：默认行为变更属于破坏性迁移，须同步示例、API 契约和迁移说明；不以删除 demo 能力替代依赖隔离。

## D5. 三种状态与预览隔离

**选择**：core 按 A2UI 消息顺序更新状态；client/server 的运行层区分临时预览和已提交 revision；业务成功与失败由宿主认定。Nexus 的运行元数据不写入 A2UI 消息 payload。

client 只在明确成功终态且本地校验通过后开放当前 revision 的 action。失败丢弃本次预览；已有提交视图可保留展示，但在提交结果未知或版本不一致时必须标记失同步并禁用 action。缺失终态、网络中断和提交确认丢失不能推断服务端未提交。

**副作用边界**：取消与 patch 失败不回滚宿主事务。SDK 不自动重试业务 action，不把 ledger 的 failed 当作业务可重试。宿主可提供不透明操作关联标识及恢复回调；SDK 不内建领域结果库。

**代价**：需要已提交状态与预览的隔离存储，以及明确的恢复/重新生成路径；仅增加一个 loading 布尔值不足以实现这些语义。

## D6. 四包目标与适配分层

**选择**：目标为 core/client/react/server。core 负责协议与状态；client 依赖 core，提供无 React 依赖的浏览器会话和 fetch/SSE 适配；React 依赖 core，接收稳定 runtime/视图状态，不强制使用 client；server 依赖 core，内部区分通用运行模块与可选 HTTP/RPC 适配。client 与 server 不互相 import 实现。

**证据**：playground 与 standalone-host-demo 已重复实现 SSE 消费，EOF/终态/取消清理尚未统一；这足以支持抽取 client。Provider 的固定渲染槽和 `sendAgentRun` 的 Koa 耦合证明需要完善组合边界。

**约束**：当前仍只有三包；client 在对应切片新增，不提前宣传已可安装。共享协议与运行元数据类型放在 core 的纯契约模块；不额外拆 guard、Policy、Catalog 或 Agent 包。Koa 入口可留在 server 公开根入口，框架无关入口的加载不执行 listener/环境读取，也不要求模型 SDK。

**代价**：新增一个包的构建、兼容和发行维护；由消除跨示例关键逻辑复制获得收益。不同 transport 通过薄适配接入，不在首发建设通用插件平台。

## D7. 稳定 runtime 与独立 Surface

**选择**：Provider 管理上下文与订阅所有权；Surface 按 surfaceId 渲染到宿主选择的位置。外部 runtime 的销毁由创建者负责；Provider 自建 runtime 在卸载时释放。React 使用稳定快照订阅，renderMap/onAction 变化不意外清空已有 surface。

**依据**：当前一个 `tree` 接收全部 surface 的 onRender，且固定输出在 children 前。多 surface 和已有页面布局无法通过常规接线完整使用。

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
- nexus 元数据类型定在 core `session` 模块（`NEXUS_SESSION_VERSION`、`NexusActionInput`、`NexusActionMetadata`），server 组合 `{ message, nexus }` 请求 envelope。固定提交结果 `NexusSurfaceCommit` 同样由 core 定义，server 的 `SurfaceStateBaseline` 为其别名；S2 通过 `GET /api/a2ui/surface-state?surfaceId=&runId=` 查询指定运行在提交边界保存的不可变结果（宿主准入沿用 `runsAccess`，未配置 403），S3 成功 done 直接复用。S2.5 由生成/action 响应头 `X-Nexus-Run-Id` 关联本地流，跨源时显式暴露；SSE data 与原始 A2UI 形状不加字段。记录缺失/淘汰拒绝，绝不回退为最新快照；浏览器只能给同一成功且已校验的运行视图附上该结果。其他运行更新 surface 时，旧视图仍携带旧 revision 并被拒，必须恢复视图，不能仅查询元数据解除失同步。surface 快照固定 contractVersion/hash；`pattern` 注册口径与有界求值引擎一致。
- 共享正常/非法 fixture 定稿于 `fixtures/catalog-v2/`，core 注册与 server 准入对同一数据必须给出一致结论。

**实施状态（S2.2 已完成，2026-10-17 收尾）**：`CatalogDefinition` 已切换为 v2 形状（V2 后缀移除）；注册闸门实施 §4.2 全部拒绝规则（含 enabled/componentRef 布尔、安全整数预算等类型校验）；`standardCatalogComponentDeclarations()` 提供 17 个标准组件声明且每次调用返回深拷贝；checks 能力、函数子集与预算统一由当前 Catalog 决定（Profile 只校验结构与安全基线，不读取 SDK 固定标准声明；DateTimeInput/媒体组件的 checks 名字禁令删除）；FunctionCall 仅在已校验的组件 checks.condition 位置豁免，参数内部仍递归检查；字段结构契约与 URL/正则/原型/预算基线保留；未注册 action 名与 sources 越权由共享 Catalog 诊断统一报告；成员判断只读自有属性。conformance 基线经分类决策更新为 36/13/23/5/3（ChoicePicker/CheckBox 共 3 条 checks 用例转为 pass，DateTimeInput 仍由字段约束拒绝；详见 SPEC §1）。待实施：浏览器/server 输入准入接线（S2.3/S2.4）。

**实施状态（S2.3 已完成，2026-10-18）**：浏览器本地写回与输入收集落地。`setInputValue(componentId, surfaceId, property, value)` 删除五组件名字分支：可写属性必须是当前宿主 Catalog `inputs` 声明键（自有属性查表），值经声明值 schema 字面校验（`{ path }` 形状的值按绑定拒绝），写回目标取组件 `{ path }` 绑定并拒绝保留段；未注入 registry 即无任何写回能力（标准名不隐含能力），写路径异常（中间节点非容器）收敛为拒绝而非向宿主抛错。成功写回按 surface 记录「组件 + 绑定属性 → 最新值」草稿（structuredClone 值快照隔离），`getLatestInputs(surfaceId)` 返回与内部模型、草稿隔离的深拷贝 `NexusActionInput[]`。草稿保存来源（Catalog、组件类型、绑定路径、组件声明指纹），在接受组件更新后立即清除失效条目并于提取时复核，防止改绑或替换再恢复时复活旧值；同类型同绑定的普通属性更新保留草稿，`deleteSurface` 清理；这是 S4 client 读取输入草稿的公开原语。React `RenderContext.setInputValue` 同形增加 `property` 参数，五个标准控件固定上报 `value`，不解释可信写路径。本地拒绝类别与草稿语义见 SPEC §4.3。Playground 从现有同源 `/api/a2ui/catalog-contract` 接口加载三个已发布声明，全部通过 SDK 注册闸门后再挂载 Provider；加载失败显式报错，不复制另一套浏览器声明表。

**实施状态（S2.4，2026-10-19 复审修复）**：server 的 `agent/action-admission.ts` 在 surface 锁内完成必填 nexus 基准、来源能力、整批输入、精确白名单与声明参数重算；resolver 后置且最终输出仍受未声明键/paramSchema 校验。core 共享严格输入寻址按实际对象/数组容器解释，拒绝根替换别名与所有非规范数组索引。存储入界/出界、临时模型、待提交输入与扩展上下文均隔离引用；准入、流 guard 和提交复核使用固定 Catalog 副本，guard 以已提交组件表和临时输入模型为起点。

提交采用「输入基础模型 → handler patch」顺序，归一化结果及根替换以 handler 为准；消息源先发输入模型再发 patch，保证浏览器与存储组合一致。实例级单调计数器不因删除/淘汰重号，action 提交同时核对 revision/epoch；非 HTTP 正常 EOF 仍持锁，直到 commit/onError/dispose。移除按 HTTP 回写 `streamClaimed` 转移锁所有权的机制。

复审同时提前接通最小 HTTP 契约：只接收 `{ message, nexus }`，保留客户端 actionId，不读取最新快照为旧视图填充基准。commit 捕获并返回固定 `NexusSurfaceCommit`，成功 done 直接发布；两个参考浏览器仅为成功消费的本次视图保存该结果，缺终态/失败/本地拒绝后不开放 action。**剩余 S2.5**：有界结果留存、按 run 查询、`X-Nexus-Run-Id`、verifier/RPC 与发布内容核对；完整会话和预览隔离仍属 S3/S4。此处替代首轮七项整改中的 patch 后写输入、仅 epoch 核对与可信 HTTP 补基准方案。

**依据与代价**：当前写回只支持五个内置输入且不读 Catalog，默认 resolver 看不到浏览器编辑，自定义 resolver 可整体跳过未声明字段检查；每个宿主自写 resolver 容易复制安全逻辑。未知键从静默忽略收紧为注册报错属破坏性收敛，playground-server 等既有 Catalog 已随注册闸门切片迁移，依赖透传客户端 context 的测试写法将失效并改为显式声明。增加通用输入准入有维护成本，但不扩展为业务规则 DSL 或任意 dataModel 写接口。

## D9. 单实例调度与资源边界

**选择**：同一 server runtime 的每个 surface 只有一个运行调度所有者，覆盖读取快照、action 准入、handler 调用和 patch 提交；HTTP 适配器不另建全局 surface 队列。不同 runtime 的状态默认隔离。所有资源预算在超限时显式拒绝或降级，运行中记录不能静默淘汰。

**范围**：首发保证单实例内行为，允许宿主注入存储；持久化存储本身不产生多实例锁或领域幂等保证。分布式协调与业务唯一约束由宿主部署/业务设计承担。

**代价**：双锁/全局 store 迁移需要并发和取消反例；保留有界整树重建，暂不建设分布式执行引擎或自研 reconciler。

## D10. 产物格式与原生 ESM 路径

**选择**：首发提供 ESM JavaScript 与 `.d.ts`，建议提供可用的 `.js.map`；React/后续 Vue 可提供显式导入的独立样式。暂不双发 CJS，不提供 UMD/IIFE；有明确消费需求再评估。SDK 保留模块结构，由宿主负责最终应用打包，React/Vue 为 peer dependency，内部包间依赖不重复内嵌。

**构建方向**：源码使用显式 `.js` 模块路径，以 TypeScript NodeNext 检查 Node ESM 可解析性；浏览器包同时验证现代构建工具接入。当前 `scripts/fix-esm-imports.mjs` 是三包构建中的产物修补步骤，先保留；完成路径迁移、构建与原生 Node 加载验收后删除，不要求宿主运行该脚本。

**代价与验收**：源码路径需要统一迁移，兼顾类型导出和包边界；S5 用当前构建产物验证 Node、浏览器打包和 TS 消费。source map 若发布须包含可用的源码映射，不发布指向缺失源文件的调试资源。此决策不代表当前已有独立 CSS 或 NodeNext 配置。

## D11. 保留段、媒体 URL 与正则求值的统一安全口径

**选择**：`__proto__`/`constructor`/`prototype` 为 SDK 唯一保留段口径，判断逻辑在 dataModel 定义处导出（`isUnsafeSegment`），准入与运行层共用。准入侧：`action.event.context` 键与组件 props 层自有键含保留段拒绝；`component.id` 与四处 `surfaceId` 三段全拒。运行侧纵深防御：`resolveContext` 遇保留段键抛错（写返回对象会触发 `__proto__` 访问器改写原型），`buildProps` 静默跳过保留段键。媒体组件 Image/Video/AudioPlayer 的字面量 `url` 准入时必须经 `isSafeMediaUrl` 判定为 http(s)（URL 解析后读 protocol，不做字符串前缀匹配——前缀写法可被大小写与协议相对形式绕过）；`{ path }` 绑定无法在准入层判定真值，React 渲染层解析后复用同一 util 守卫，非法时不输出 `src` 并渲染带说明性 alt/aria 的占位。Catalog schema `pattern` 与 checks 路径同口径：注册闸门强制长度上限并拒绝嵌套量词，求值统一走 `compileSafeRegExp` 有界线性引擎（checks 的 safe-regex 为唯一正则求值实现），编译失败产生 schema 诊断。

**评审补充**：安全闭环还覆盖组件表、Catalog schema/Policy 表和 renderMap 的自有属性查找；不通过黑名单代替正确查表，显式自有注册仍可使用同名组件。renderMap 值不是函数时降级。渲染与 store 容量须为正安全整数，空树也校验，避免 NaN/Infinity 关闭预算或负数导致无限淘汰循环。业务中立不意味着参考应用丢失自己的规则：参考工厂显式接回演示 Policy。SDK 三包 build 清除旧 dist，再验证当前源码对应的产物清单。

**依据**：三条路径的原有实现各自为政——dataModel 三段全拦、validator 只拦 `__proto__`、schema.pattern 裸用原生 RegExp（`(a|aa)+$` 类歧义 pattern 在失败值上指数回溯）。证伪测试确认均可复现污染、注入或挂起；统一口径后规则只有一份定义，准入拒绝与运行降级各司其职，避免下游消费方再自行推断边界。

**代价**：准入口径收紧属破坏性收敛——含保留段键/组件 id 的历史消息（含经 `JSON.parse` 注入的自有 `__proto__`）与字面量非 http(s) 媒体 URL 从放行变为拒绝；原生 RegExp 可编译但超出有界引擎兼容子集（环视、反向引用、超大重复计数）的 pattern 在匹配时产生「无法求值」诊断而非原生语义。误报场景按 Profile 兼容范围声明处理，不做静默兼容。

## D12. 高层接入 API 与包边界

**选择**：保留 core/client/react/server 的目标分包，暂不新增统一重导出四包的总门面包。各包通过公开根入口及职责内的高层 API 简化接入：client 会话控制器聚合生成/action、订阅、取消与恢复；React 提供 Provider/Surface/hooks；server 运行工厂装配准入、调度、生成源与 handler。名称与精确类型按对应实现切片定型。

**依据**：宿主按环境与框架选用能力。浏览器入口不重导出 Node server，框架无关入口不引入 React/后续 Vue，不依靠 tree shaking 消除跨环境解析与可选依赖问题。统一文档和兼容说明可以提供一致接入体验；减少重复接线比减少包名更有价值。

**代价与重评条件**：消费方需要安装其使用的包；SDK 须保证跨包类型兼容与组合示例完整。只有实际接入证明安装/组合仍有明显成本时，才评估薄便捷包，并验证环境隔离、依赖和产物加载。当前不为该可能性预建新包。
