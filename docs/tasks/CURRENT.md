# CURRENT — 唯一任务与进度源

更新：2026-10-21。产品判据见 [PRD](../PRD.md)，契约见 [SPEC](../SPEC.md)，结构与取舍见 [ARCHITECTURE](../ARCHITECTURE.md)、[DESIGN](../DESIGN.md)。本文件维护唯一实施计划，不以目标设计替代交付证据。

## 当前结论

**产品方向已敲定：宿主约束的 Agent UI Runtime SDK。** SDK 提供协议、Catalog、绑定、渲染、运行与交互基建；业务 prompt、模型/工具编排、具体流程、业务权限与副作用由宿主负责。

当前只有 core/react/server 三包；目标新增 client。S1 已完成：core 安全反例（保留段、媒体 URL scheme、schema.pattern）先证伪后修复；Adapter/guard 显式装配（registry 必填、policy 无默认、LLM 生成源与 catalogId 必填，缺失即报错）；runs 查询宿主 `runsAccess` 准入（未配置一律 403）；参考服务与演示 Catalog/LLM/Policy 迁至 `examples/playground-server/`，只消费公开 SDK 入口。S3/S4 尚未实施（模块级 per-surface 队列按 S3 计划收编，client 待 S4 新建）。验证宿主与 Agent 尚未选定，不能将已有 demo 或 `examples/agent-demo/` 占位视为已选接入工程。SDK 通过可替换的确定性夹具和仓外契约验收验证，不评审接入方应用内部工程，也不等待其重建。

**当前任务：S2 Catalog v2、输入与 action——S2.1–S2.6 已完成并推送（至 `5a5c5a1`）；S2.7 独立复核与阶段验收已于 2026-10-21 完成（16 项全部实施，S2 全阶段完成），验收证据见 [S2-ACCEPTANCE](S2-ACCEPTANCE.md)，本轮变更待提交。下一阶段 S3 通用 server runtime。** S1 及独立评审修复（`b44b639`）、S2.1 契约锁定（`6c93780`）、S2.2 共享解释器（`71ab59a`）、S2.3 本地写回（`35778e2`）及其 playground 收尾（`734430c`）、S2.4 与复审修复（`69ab5a7`）已提交并推送；S2.5.1/.2/.5 并行实施与评审修复（`23f1a9c`）已提交；S2.5.3/.4（`80b70f8`）、S2.5.6/.7 与整体评审修复（`c42dffe`）已提交并推送至 `origin/feature`。S2 按下述 S2.1–S2.7 推进；契约已定型（SPEC §4/§5.1/§8、DESIGN D8、core/server 公开类型、`fixtures/catalog-v2/` 共享 fixture）。复审补齐按 runId 固定提交基准与两种并发时序反例，不能用最新 revision 给旧视图刷新资格；最小 HTTP envelope、成功 done 固定结果与两个浏览器门控已随 S2.4 复审修复提前接通；S2.5 七项（统一运行标识、有界结果留存、发布契约一致性、按 run 查询路由、`X-Nexus-Run-Id` 响应头、verifier/RPC 贯通、并发关联复核）已全部完成，整体评审四项修复通过最新根门禁（753 项）；消费方完整关联门控归 S2.6.3，完整 Session/SSE 生命周期由 S3/S4 完成。

补充决定（2026-10-16）：DESIGN D12 / SPEC §8.2 明确保留分包、以层内高层 API 简化接入，暂不新增总门面包。S3/S4 完善 server/session/视图组合，S5 验证公开入口环境隔离与跨包兼容；本次仅补充文档，不改变代码阶段状态。

## 阶段与依赖

| 阶段                     | 状态                 | 交付与依赖                                                               |
| ------------------------ | -------------------- | ------------------------------------------------------------------------ |
| S0 文档与评审范围基线    | 已完成（文档/skill） | PRD/SPEC/ARCHITECTURE/DESIGN、README、本计划与 SDK review skill 对齐     |
| S1 安全基线与业务中立    | 已完成（验收通过）   | 安全反例证伪修复；显式装配；参考程序迁出 playground-server；早期产物检查 |
| S2 Catalog v2 与交互扩展 | 已完成（S2.7 验收通过） | 声明式展示/输入/action；共享准入、本地写回、服务端权威准入               |
| S3 通用 server runtime   | 待实施，依赖 S2      | 单一调度、Session v1 与提交语义；Koa/RPC 薄适配                          |
| S4 client 与可嵌入 React | 待实施，依赖 S2/S3   | 新 client、Provider/Surface、两个浏览器消费方迁移                        |
| S5 独立契约验收与发行    | 待实施，依赖 S1–S4   | 当前产物仓外安装、公开 API/兼容、浏览器和 CI 门禁                        |

S1–S4 每个切片同步其消费方与迁移说明，保持已交付路径可运行；破坏性变化显式区分契约版本，不长期保留两套通用解释器。任务 ID 已重新编排，旧 S1 已收口事项仅为回归基线，不表示新 S1 完成。

## S1 — 安全基线与中立默认值

1. 逐项核实原型/继承属性、URL scheme、Catalog schema.pattern、run 查询访问控制的可达路径，先写能在修复前失败的测试，再修复。预算非法值显式报错。
2. 移除 Adapter 对示例 Catalog、LLM、业务 Policy、全局 history 的隐式选择；必要依赖缺失即报错。模型凭证不改变 SDK 默认运行策略；标准组件与安全限制保留。
3. 将参考服务、模型/prompt、联系人/任务/Workbench 演示 Catalog 与流程 Policy 迁至目标 `examples/playground-server/`，只用公开 SDK 入口。更新根 dev/递归脚本、依赖与示例说明，不为目录整齐重命名无关前端。
4. 早期检查三包 exports/types、dist 加载和参考程序迁出后的依赖；正式仓外接入和兼容验收仍在 S5。无版本发布需求时不恢复 tarball 仪式。

完成判据：安全反例通过；两个无关 Catalog 不受搜索/表单等业务词影响；示例功能保留；SDK 根入口无 listener/项目环境读取/模型 SDK 前置；无反向依赖。新增或迁移测试遵循包 `test/` 镜像结构，现有 server `tests/` 不因本轮计划顺手全量搬迁。

## S2 — Catalog v2、输入与 action

目标：宿主通过 Catalog 声明和 renderMap/handler 注册新增展示、输入与 action 组件，无需修改 SDK 内核；浏览器最新合法输入经服务端权威校验后到达 handler。

### 现状依据与实施边界

- S2.3 已将 `core/runtime.setInputValue` 改为按组件 + 绑定属性写回，值域由 Catalog `inputs` 声明决定（无名字分支，未注入 registry 即拒绝）；最新输入草稿经 `getLatestInputs` 提取，S4 client 由此读取。
- S2.2 已将 checks/action 能力准入交由当前 Catalog；Profile 保留结构、标准字段与安全基线，checks FunctionCall 豁免限定到组件 condition。`catalog/schema` 解释受限 schema 与能力声明，注册闸门拒绝非法/未知配置。
- S2.4 已移除 `resolveDeclaredActionContext`：共享准入先重算参数，resolver 后置且输出仍受未声明键与 paramSchema 约束；浏览器本地编辑经 nexus inputs 到达临时模型。
- Catalog Contract 当前 v2；surface 固定 Catalog version/hash/声明副本；HTTP 已解析版本化 envelope 并透传客户端原始基准，成功 done 返回本次固定提交结果；两个参考浏览器已迁移最小门控。
- S2 不改变“协议到 VNode 在 core，React 仅做映射”的职责。以确定性契约 fixture 验证，宿主 Agent 未定不阻塞。S1 的安全限制、预算、公开入口与产物检查继续回归。

### 子任务与顺序

| ID   | 交付内容                                     | 主要位置                                                         | 依赖       | 验收出口                                                                         |
| ---- | -------------------------------------------- | ---------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------- |
| S2.1 | 锁定 Catalog v2 与 action 输入契约、版本迁移 | SPEC §4/§5.1/§8、DESIGN D8、core/server 公开类型                 | S1         | 字段、默认拒绝、失败语义、版本及迁移样例明确，正常/非法 fixture 定稿             |
| S2.2 | 实现 core 共享 Catalog/schema/能力解释器     | core/catalog、protocol、共享 fixture                             | S2.1       | 浏览器与 server 复用同一纯规则，非法配置初始化失败，输入/动作由声明决定          |
| S2.3 | 声明式本地写回与输入收集                     | core/runtime/action、React 类型与标准控件                        | S2.2       | 自定义绑定属性与值类型可写回，按组件/属性提取最新输入，非法输入不改状态          |
| S2.4 | 服务端权威输入与 action 参数准入             | server/adapter、surface-action-state、core 共享规则              | S2.2       | 基于已提交声明校验整批输入并重算参数，拒绝时 handler 未调用、快照未改变          |
| S2.5 | 接通版本化请求与契约发布                     | server/client-event/routes、contract/hash/discovery/RPC/verifier | S2.3、S2.4 | action 的 revision/hash/输入通过公开入口传递，旧格式显式拒绝，发布契约与执行一致 |
| S2.6 | 同步 SDK 消费方与迁移说明                    | React、playground-server、playground、standalone-host-demo       | S2.5       | 演示 Catalog 全迁移；两个无关 Catalog 完成最新输入 → handler → 原 surface patch  |
| S2.7 | 独立复核与阶段验收                           | 各包 test、公开 API、conformance、dist、CURRENT/README           | S2.1–S2.6  | 证伪矩阵、代码门禁与 SDK review 完成，实际交付状态同步                           |

#### S2.1 — 先敲定契约

1. Catalog v2 明确组件 props schema、字段/绑定能力、可写绑定属性及值 schema、action 挂载能力与参数 schema；actions 必填，展示型显式 `[]`。标准组件使用同一声明机制，不另保留名字驱动的输入解释器。
2. 定义“可选配置”与“缺失必需配置”的区别；未知 schema/policy 字段、不支持语法、保留段、非法预算与矛盾声明在注册时拒绝。schema.pattern 注册支持范围须与实际有界引擎一致，不能先注册再在每次合法取值时失败。
3. 宿主为 surface 提供精确可编辑 JSON Pointer 白名单；权限配置来自可信服务端装配，模型声明和浏览器不能自行扩权。明确 JSON Pointer 规范化、重复输入、路径冲突/别名、缺失绑定和未变化输入的处理；不加入任意路径表达式。
4. 锁定 `{ message, nexus }` action 请求类型：v0.9 action 与 SDK 元数据分离，元数据含 session version、actionId、surfaceRevision、catalogHash 和组件/绑定属性/新值输入。客户端不提交目标写路径；context 的允许形状与额外字段拒绝规则必须明确，参数始终由服务端声明重算。
5. Catalog Contract v2、相关包 API、schema/Profile 支持范围分别版本化。定义快照固定 version/hash 与旧请求/旧 Catalog 显式拒绝方式；不维护 v1/v2 两套通用解释器，包版本与 workspace 规则仍遵循 AGENTS.md。
6. action 基准关联本地已渲染运行：`NexusSurfaceCommit` 为固定结果，查询须带 surfaceId/runId；结果不可用不回退最新快照，查询元数据不能恢复旧视图。两种并发时序 fixture 与运行结果关联规则见 SPEC §5.1。

#### S2.2 — 同一套通用解释规则

1. core 提供可复用的 schema 值校验、字段/绑定准入、输入能力与 action 能力解释及诊断。server 不再复制一套组件/输入语义。
2. 梳理 Protocol/Profile/Catalog：结构与不变安全基线继续由 SDK 强制；标准组件的字段、checks/action 挂载和输入类型规则移到可复用声明。自定义组件不能被标准组件名分支阻断，也不能绕过 URL、正则、原型与预算限制。
3. prompt contract、contract hash/发布内容与执行校验使用同一份规范化契约。能力变化必须影响 hash；请求中的业务词不能改变通用校验。
4. 流式缺失绑定仍可渐进显示；用户输入和 handler 参数使用严格值校验。两者的缺失值语义明确区分，避免候选流提前拒绝或交互放过无效值。

#### S2.3 — 本地输入机制

1. 将 setInputValue 扩展为按组件与绑定属性写入，值域由 Catalog schema 决定；标准输入与自定义输入走同一路径。React 只上报用户值，不解释可信写路径。
2. core 保存/提取 action 所需的最新输入项，输出组件 ID、绑定属性与值；不让示例遍历或 deep-merge 整个 dataModel 来猜用户编辑。
3. 用自定义展示组件、自定义输入（至少一个非 `value` 绑定属性）和自定义 action 组件形成最小夹具；拒绝只读属性、未声明属性、错误类型及危险路径，失败前后状态一致。
4. 为 S4 留出读取输入草稿的公开原语；S2 不实现 client 包、预览隔离或 Provider/Surface 拆分。

#### S2.4 — 服务端权威准入

**分析基线（2026-10-18）**：S2.3 与收尾修复已在本地提交（`35778e2`、`734430c`）；本节只拆分任务，不表示 S2.4 已实施。

源码核实的缺口：

- `server/agent/adapter.prepareAction` 已在实例内 surface 锁下读快照，但默认 resolver 只看旧模型；自定义 resolver 接管参数解析，额外客户端字段检查只在默认分支执行，尚无 inputs、白名单、revision/hash 和 paramSchema 准入。
- `surface-action-state` 快照只有 `catalogId/version/components/dataModel`；读取只浅拷贝 Map，组件和模型共享引用；生成每次从 version 1 开始，删除后也未保留区分旧基准的信息。
- `core/dataModel` 旧 helper 容忍相对路径，把 `/` 当根，数组寻址使用 `Number(segment)`；精确白名单和路径冲突不能先按严格指针判定，再交给这套宽松语义写入。
- `api/client-event` 与 HTTP 路由仍只传 v0.9 action，`NexusActionRequest` 仅有类型；当前 store 提交只应用 handler 返回的消息，尚无临时输入与 patch 的组合提交。

按下列切片推进；表中位置为包内模块，新增测试在相应包 `test/` 下镜像 `src/`。

| ID | 交付 | 主要位置 | 依赖 | 完成判据 |
| --- | --- | --- | --- | --- |
| S2.4.1 | 严格路径与共享字面值校验 | core/dataModel、catalog/schema | S2.2/S2.3 | 白名单、冲突比较、绑定读取与实际写入使用一致的路径段语义；输入/参数复用 schema 解释器，不复制组件规则 |
| S2.4.2 | 固定契约与隔离快照 | server/agent/surface-action-state、catalog-contract | 无 | 快照固定 Catalog 声明副本及 contractVersion/hash；组件/模型/读取结果无可变别名；同 surface 再生成、删除重建的 revision 不与旧基准碰撞 |
| S2.4.3 | 宿主可编辑范围装配 | server 可信运行配置与路径规则 | S2.4.1 | 按 surface 提供精确白名单；缺省为空，非法/规范化重复配置显式失败；请求和模型不能扩权 |
| S2.4.4 | 整批输入与来源准入 | core 纯输入规则、server/agent/action-admission（拟新增） | S2.4.1–3 | 核对请求结构、session/revision/hash、action 来源与声明；整批 inputs 校验后构造隔离临时模型；任一项失败不产生局部状态 |
| S2.4.5 | 参数重算与 resolver 后置 | core 字面值规则、server/agent 参数解析 | S2.4.4 | 从服务端 action 声明及临时模型重算；客户端值不覆盖参数；resolver 之前执行共享准入，之后再次检查参数字段/schema |
| S2.4.6 | 准入与 UI 提交组合 | server/agent 状态、准入/提交组合原语 | S2.4.2/5 | 锁内读基准；合法输入与 handler patch 经 guard 后一次提交；准入/流失败不发布输入或递增 revision；并发提交不能覆盖新状态 |
| S2.4.7 | 证伪矩阵与切片复核 | core/server test、共享 fixture、公开 API、文档 | 各切片持续补测试，最终依赖 S2.4.1–6 | 共享请求 fixture 与拒绝不变式通过；真实状态存储/提交路径反例、门禁与 SDK review 完成，明确尚未接线的入口 |

**S2.4.1：先解决实际寻址一致性。** 按 SPEC §4.3 固定严格绝对 JSON Pointer：空串根指针、非法 `~` 转义、保留段拒绝；对象键与数组索引按容器分别处理，数组不得通过 `01`、`+1` 等别名绕过冲突或权限判断。`/` 在 RFC 6901 中表示空键，不能被写入 helper 当成整表替换；实现须区分输入寻址与既有 `updateDataModel` 根替换约定，统一底层段解析并对原有协议语义、转义和 conformance 做回归。参数按完整字面对象校验，不能借组件 props helper 丢弃 `id/component/children/action` 等键后再判定合法。

**S2.4.2–3：可信事实由宿主提供。** Catalog hash 不从客户端或查询时的最新 registry 补齐；快照持有实际提交使用的声明和固定版本/hash，后续 registry 变动不得悄悄改变既有 surface 的准入语义。白名单允许配置 `/profile` 与 `/profile/name`，授权只精确匹配，不按前缀继承；同批输入是否冲突另行判断。未配置可编辑路径时，`inputs=[]` 的合法 action 仍可执行；非空输入默认拒绝。常量配置在初始化校验，按 surface 动态取得的配置在调用边界校验。

**S2.4.4：先验证整批，再构造临时模型。** 输入项只接受 `{ componentId, property, value }`，目标从快照组件的 `{ path }` 绑定解析；复用 Catalog `inputs`、值 schema 与自有属性规则。拒绝未知/只读字段、伪造路径、缺失绑定、schema 不符、危险路径、同组件同属性重复、同目标路径和按段比较的祖先/后代冲突，两种输入顺序结论一致。未变化输入幂等合法。纯规则结果带稳定的拒绝类别和诊断，不绑定 HTTP 状态；结构解析与 S2.5 HTTP 入口复用同一实现，不另建一套请求解释器。

**S2.4.5：扩展点不能替换准入。** 查找快照中的 action.event，再核对固定 Catalog 的 action/sources。客户端 context 只允许服务端 action 声明的字段，值仅作非权威上下文；参数从临时模型重算。resolver 只接收隔离的已准入输入/参数，不能修改权威快照或绕过失败；输出必须是 JSON 对象，并执行声明字段与 `paramSchema` 校验，缺省 paramSchema 只接受空对象。参数不满足时不能调用 handler；不得把流式绑定的 pending 宽容语义用于必需的 action 参数。身份、业务对象归属和事务仍由宿主判断。

**S2.4.6：准入成功不等于状态已提交。** 临时输入只用于参数重算及本次待提交 UI，handler 调用前不修改快照。成功提交需包含已准入输入，partial patch 无需回显输入；同路径归一化或根替换以 handler 为准；输入更新与 patch 使用同一 guard/最终模型语义，不做两次提交或重复递增 revision。前置准入拒绝保证 resolver/handler 未调用；resolver 结果拒绝保证 handler 未调用；两者都保证快照/revision 不变。handler 已执行后若 patch/传输失败，只能说明 UI 未确认提交，不能宣称宿主副作用被回滚。

并发验证须使用真实写入交错：两个 action 竞争旧 revision、排队期间状态改变、同 ID generation 提交与 action 相交、删除重建及版本上溢。现有 action 锁并未覆盖 generation 提交，不能据其存在宣称全部写入已隔离；S2.4 最小补齐同 surface 写入临界区与提交时基准核对，S3 再统一运行调度所有权。failed ledger 重入策略、模块队列、全套取消/背压/并发预算重构仍归 S3。

**S2.4.7：验收分层且可证伪。** 消费 `fixtures/catalog-v2/` 正常/非法请求，hash 占位符按真实 Catalog 实算；先验证 fixture 前置消息合法，再对照预期拒绝类别。补白名单缺省/非法配置、转义/空键/数组别名、未配置 paramSchema、恶意 resolver、调用参数别名、失败后快照不变、并发与重建等反例。覆盖两个无关 Catalog、自定义非 `value` 输入及非 Button action；共享规则在 core/server 对同一数据给出一致结论。baseline 两种查询时序只在本阶段验证旧 revision 会被准入内核拒绝，实际查询响应及浏览器关联验收仍归 S2.5。

**与 S2.5 的接线边界（2026-10-19 修订）。** 为封堵可达 HTTP 旁路，S2.4 复审修复已提前切换公开 prepareAction 与 HTTP envelope、成功 done 固定结果及两个参考浏览器的最小门控；默认 HTTP 与非 HTTP 均经权威准入。S2.5 继续完成有界 run 结果留存/查询、响应头、verifier/RPC 元数据贯通与完整发布核对，补齐查询缺失/淘汰等反例；S2.6 完整双 Catalog 场景和迁移说明、S3/S4 完整会话/预览隔离保持原计划。

#### S2.5 — 请求与发布接线

**实施状态（2026-10-20）**：S2.5.1–.7 全部完成（首轮/评审修复/组 2/组 3 验证记录见文末），S2.6 待实施。S2.4 已完成 HTTP `{ message, nexus }` 解析、原始 actionId 传递、共享权威准入、commit 返回固定结果与成功 done 发布；这些能力只补回归，不再重新实现。baseline 时序夹具已由 S2.5.3 升级到真实 HTTP 查询路由验证。

剩余缺口（2026-10-20 S2.5 收口复核）：S2.5 七项无剩余缺口——verifier 已改为消费本次 done 固定结果并整体删除 `describeSurfaceContract` 补基准调用；并发查询时序、非 HTTP/HTTP 同源、重复标识、旧 envelope 混入与查询-淘汰窗口交错全部经真实入口验证。消费方完整关联门控与 verifier 端到端验收归 S2.6.3，运行调度/队列/完整 commitState 归 S3。

| ID     | 交付                   | 主要位置                                                                        | 依赖     | 完成判据                                                                                                                  |
| ------ | ---------------------- | ------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| S2.5.1 | 统一运行标识与版本边界 | server/agent/adapter、run-manager、api/send-messages、SPEC §5/§8                | S2.4     | 一次 run 只分配一个不可变 ID，非 HTTP commit、HTTP 头、事件前缀、done 与查询使用同值；onboarding/RPC 的版本与兼容决定写明 |
| S2.5.2 | 有界固定提交结果留存   | server/agent/run-manager、adapter、api/send-messages                            | S2.5.1   | 复用同一记录所有者保存不可变结果，先于成功 done 可读；不读取最新快照拼装；防重复 ID、活动记录误淘汰及可变引用污染         |
| S2.5.3 | 按 run 查询与访问控制  | server/api/surface-state、routes、run-manager                                   | S2.5.2   | 真实路由落实 400/403/404/409/200；先鉴权后查记录；历史结果不受后续提交或当前 surface 淘汰影响，结果淘汰则明确不可用       |
| S2.5.4 | 响应头与传输关联       | server/api/send-messages、transport/sse、两个参考服务 CORS 装配                 | S2.5.1–2 | 生成/action 均在 flushHeaders 前设置 X-Nexus-Run-Id；跨源可读且保留宿主其他暴露头；await/void、排队响应与取消回归通过     |
| S2.5.5 | 发布内容与执行契约一致 | server/api/routes、catalog-contract、catalog-discovery-client、agent-onboarding | S2.5.1   | registry、发布声明/hash、prompt 与 onboarding 使用一致的已校验契约；发布后外部修改无效；严格拒绝非法/错配发现响应         |
| S2.5.6 | RPC 与 verifier 贯通   | server/agent/external-agent、verification、onboarding-verification              | S2.5.3–5 | RPC 传递完整已准入 action；verifier 消费本次 done 固定结果，可信配置输入场景；拒绝时远端 handler 未调用，报告不虚报通过   |
| S2.5.7 | 入口与并发关联复核     | server/test、fixtures/catalog-v2、公开 API/契约文档                             | S2.5.1–6 | HTTP/非 HTTP 固定结果一致，两种并发查询时序及缺失/淘汰/错配反例经真实入口验证；相关门禁完成                               |

**S2.5.1：先收口身份，避免第二个运行系统。** 由运行创建方分配 ID，AgentRun 向传输暴露同一标识；sendAgentRun 不再以另一个 idPrefix 改写提交事实，runId 与 actionId 保持不同语义。扩展现有 run-manager 的结果接口，由 adapter/HTTP 共用同一记录所有者，不另建平行结果 Map。明确自定义 AgentRun、run-manager 实现与既有 `commit(): void` 的迁移：没有可确认结果的运行不能伪造成功提交；原始消息发送工具不被默认为可查询的 SDK 运行。完整调度器留给 S3。

版本分别处理：Catalog Contract 保持 2、Nexus session 保持 1；onboarding 新增必需字段/验收项若改变消费者要求，显式提升其契约版本并同步类型、解析与示例。外层 RPC version 独立判断，只增补已存在 action 的元数据透传不机械升版；改变必需结构则先更新 SPEC 再成组迁移，不保留两套准入解释器。

**S2.5.2：保留提交事实，有界且默认隔离。** generation/action 都在提交边界捕获固定 `NexusSurfaceCommit`，成功 done 发出前完成留存，不能把“流结束”当提交。记录读写深拷贝，后续状态迁移不能覆盖固定结果；重复 ID 显式拒绝。容量优先淘汰终态记录，不能淘汰仍在排队/执行的保护记录；全部活动时显式拒绝新建，测试覆盖拒绝后未启动生成源/handler、未泄漏响应和锁。这里只补结果留存所需容量约束，完整排队/背压预算属于 S3。提交失败不得发布可用基准；已确认提交后观察/传输失败不得另造新 revision 或改写提交结果，未确认的情况保持不可用，完整 commitState/history 语义在 S3 收口。

**S2.5.3–4：查询是核对结果的入口。** 缺失/空 surfaceId 或 runId 返回 400；合法参数先执行 `runsAccess`，未配置/拒绝均为 403，不泄露记录存在性。指定记录不存在、surface 不匹配或已淘汰返回 404；存在但没有可确认提交返回 409；200 只读该记录的固定结果，不要求当前 surface 快照仍存在。响应头在同步占用 SSE 响应之前设置；保留既有 Koa await/void 与队列时序。跨源暴露头由适配层及参考装配显式完成，合并宿主已有配置，不接管宿主的 CORS 授权策略。消费者不得解析事件 ID 格式来猜 runId。

**S2.5.5：发布和执行来自同一份声明。** 路由装配时校验并复制 Catalog，核对已发布 Catalog 与执行 registry 的 ID/version/hash；允许只发布执行 Catalog 的子集，不强制泄露私有 Catalog。发布结果、prompt、hash 与 onboarding 始终基于同一副本；初始化后修改调用方对象不能造成内容/hash 分裂。discovery 校验版本、完整 hash 格式、组件/action 列表形状与重复项、发现摘要与完整契约的一致性；能力/schema 变化影响 hash，对象键顺序不影响 hash。复用既有 core 注册规则和 server hash 实现，不复制通用 schema 解释器。

**S2.5.6：验证路径不能借最新快照过关。** RPC 已在共享准入后的 handler 内传递 action，本项核对所有元数据、服务端重算参数与最新输入的实际序列化；远端响应仍过 guard，不能授予写路径权限。verifier 读取本次成功 done 的完整结果并关联请求，不再通过 describeSurfaceContract 的最新值补基准。可编辑路径与待编辑值由可信宿主 fixture 配置，禁止按组件名猜输入；覆盖自定义输入/action、无输入 action、展示型 Catalog 的适用检查与 skipped 原因。RPC、onboarding 声明与 verifier 报告的检查项一致。

**S2.5.7：真实交错与拒绝不变式。** A 的消息消费完毕后，分别在查询 A 前、查询 A 后/action 前提交 B；查询 A 始终返回 A 的固定旧 revision，A action 被拒、handler 未调用、B 快照不变。补无权限、无结果、已淘汰、跨 surface、重复标识、旧 envelope/版本/hash 及非 HTTP 结果同源反例；fixture 前置合法性先验证。消费方尚未完成完整关联门控，不能据此宣称 S2.6 或 Session v1 完成。

#### S2.6 — 消费方迁移

**细分基线（2026-10-20，S2.5 推送后核实）**：保留 S2.6.1–.5 五个交付 ID，细化为 16 个执行任务。当前仅完成拆分，全部运行代码待实施；用户要求先看任务，本轮不启动改造。S2.5 基准为 `80b70f8` / `c42dffe`，753 项测试为该阶段历史证据，不作 S2.6 交付证据。

**实施状态（2026-10-20）**：用户确认拆分并给出建议顺序（.1 → .2 → 先锁定草稿确认语义 → 合并推进 .3/.4 → .5），随后指示「全部做完再准备提交」。S2.6 五组 16 项已全部完成，验证记录见文末「S2.6.1 实施验证」与「S2.6 组 B–D 实施验证」；用户已确认将全部 S2.6 交付与复审修复合并提交。

源码核实：

- playground-server 的 `src/main.ts` 未传 `catalogContracts`；`reference/reference-agent.ts` 未装配 `editablePaths`。无 key fallback 的 Basic 路径仅生成联系人，不包含可编辑表单；Workbench 有现成输入，但一次业务创建后即禁用，不能直接承担连续两次 action 的验收。
- 两个服务已随 S2.5 暴露 `X-Nexus-Run-Id`，本阶段回归实际 CORS 及公开常量消费，不重复交付响应头。
- playground 的 `src/catalog/registry.ts` 仅返回 registry，丢弃发布的版本/hash；standalone 浏览器静态装配本地 Catalog，discovery 当前仅用于展示链接，未核对实际发布声明与渲染所用声明。
- 两个 `consumeRun` 已解析 done 固定结果，但 transport 未把响应头传给消费入口；尚无完整的请求代次/卸载保护与 Catalog hash 对账。不能把解析 event id 格式作为权威 runId 来源。
- core `runtime.getLatestInputs` 返回独立草稿快照，尚无成功提交后的草稿确认 API。同绑定 patch 可保留旧草稿，连续提交可能覆盖服务端归一化结果；需要先决定确认语义。
- standalone 原审批 Catalog 只有展示及 Button action。保留原示例，新增独立中立交互 Catalog，通过公开 registry/renderMap/handler 接入，不重构审批业务，也不选定未来宿主 Agent。

| ID | 交付单元 | 依赖 | 完成出口 |
| --- | --- | --- | --- |
| S2.6.1 | 参考服务真实装配 | S2.5 | 实际入口发布执行 Catalog；可信白名单限定真实输入；无 key 可完成确定性交互 |
| S2.6.2 | 第二个中立交互 Catalog | S2.6.1 的装配规则 | 新增展示、自定义输入和非 Button action；整数/布尔等值类型；原审批示例保持可用 |
| S2.6.3 | 浏览器契约与运行关联 | S2.6.1–.2；草稿语义先定 | 实际加载声明与响应头/done/视图一致才开放 action，失败及晚到结果不能恢复资格 |
| S2.6.4 | 草稿确认与连续交互 | 语义先定；闭环依赖 S2.6.3 | 已确认草稿不重放，新编辑不误删；两组 Catalog 连续提交，拒绝与双 surface 隔离成立 |
| S2.6.5 | 最小接入、迁移与删除旧路径 | S2.6.1–.4 | 可照着接入的公开 API 文档、旧签名清理、根门禁及 SDK review 完成 |

**S2.6.1 — 参考服务真实装配（3 项）**

实施状态（2026-10-20）：三项已完成，见文末「S2.6.1 实施验证」。

| 任务 | 实施内容与位置 | 验收 / 失败反例 |
| --- | --- | --- |
| S2.6.1.1 | 在 playground 实际 main/reference 装配中发布所用三个 Catalog，发布列表从实际 adapter 的固定执行声明取得；保留现有 Policy、history 与环境装配 | 实际入口 discovery、catalog-contract、onboarding 与生成 done 的 Catalog/hash 一致；不是仅在测试另建 router 证明可用 |
| S2.6.1.2 | 按可信服务端 surface/Catalog 关系配置精确可编辑路径；只读 ID、客户身份、审批金额等不默认开放；覆盖两个服务实际 CORS | 未知 surface、无输入 Catalog、未配置白名单均拒绝非空输入；允许路径不从模型或浏览器推断；缺省 SDK 拒绝行为保持。映射/缓存需说明容量和失效归属，避免新增无界 Map |
| S2.6.1.3 | Basic fallback 增加最小确定性表单入口（字符串 + 布尔），复用现有 submit handler；联系人/Task/Workbench 路径保持 | 无模型 key 经实际服务生成可编辑表单；最新输入经 HTTP 到达 handler 并 patch 原 surface；只做首次闭环，连续交互归 .4。新增测试位于包 test/ 镜像 src/ |

**S2.6.2 — 第二个中立交互 Catalog（3 项）**

实施状态（2026-10-20）：三项已完成，见文末「S2.6 组 B–D 实施验证」。

| 任务 | 实施内容与位置 | 验收 / 失败反例 |
| --- | --- | --- |
| S2.6.2.1 | standalone 新增独立 Catalog 夹具：展示摘要、自定义整数输入（例如 score，非 value 属性）、布尔输入、自定义提交触发器（非 Button）；明确字段/inputs/actions/paramSchema | 通过同一注册闸门；非法类型/范围拒绝。命名及布局仅属夹具，SDK 内核无相应名字分支；不修改审批 Catalog 来充当第二个无关场景 |
| S2.6.2.2 | 用公开生成源/RPC、handler、Catalog 发布与可信白名单装配新夹具；提供支持连续 patch 的确定性路径，保持审批 local/external 模式 | 实际 HTTP/RPC 收到准入后的整数/布尔参数；客户端 context 不能伪造权威值；patch 不 create/delete surface；原审批测试回归 |
| S2.6.2.3 | 在 standalone 注册 renderMap 与最小场景选择入口；控件仅上报 componentId/surfaceId/property/value，触发器只调公开 action API | React 映射测试覆盖整数/布尔变更、非 value 属性及非 Button action；生成可渲染且保持同一 runtime。契约校验和完整门控留到 .3 成组接通 |

**S2.6.3 — 浏览器契约与运行关联（4 项）**

实施状态（2026-10-20）：四项已完成，见文末「S2.6 组 B–D 实施验证」。

| 任务 | 实施内容与位置 | 验收 / 失败反例 |
| --- | --- | --- |
| S2.6.3.1 | 两个浏览器的 Catalog loader 保留声明、contractVersion、contractHash；验证版本、身份、完整注册规则、标准 prompt 和 hash↔内容一致性，再挂载对应 registry/renderMap | 非法版本、格式合法但内容错配 hash、错误 prompt、请求 Catalog 与响应错配全部失败；取消/晚到加载不替换当前契约。纯规范化/校验按需进 core，浏览器 hash 使用 Web Crypto，禁止 import server 实现或 Node crypto；共享变更先核对公开 API/产物 |
| S2.6.3.2 | transport 将实际响应头交给 consumeRun；以响应头确定 runId，核对成功 done 的 session/run/surface/catalog/version/hash 与本次加载和消费的视图 | 缺头、错 run/surface/catalog/hash、无 done、重复终态、终态后消息、本地拒绝均不开放 action；event id 只作帧信息，不解析其格式猜 runId；异常时 reader 取消并释放 |
| S2.6.3.3 | 两个消费方保存请求代次/失效标记，重新生成、切换 Catalog、取消、卸载使旧运行失效；动作出口与可用状态同步 | A 晚于 B 到达、abort 后仍返回数据、卸载后 resolve 均不能写回视图/基准或误改 busy；动作没有合格基准时不发请求。不提前实现 S4 的预览/提交双视图或 Session 全量状态机 |
| S2.6.3.4 | 成功且已本地校验的同次 done 是正常基准来源；如做查询，仅核对该次 surfaceId/runId，不引入正常提交必经查询 | 真实查询返回 A 旧结果不会给 B/旧视图换 revision；404/409/错配不能恢复资格。verifier 使用两组实际装配验证输入/RPC/固定结果；无输入及展示型 skipped 继续回归 |

**S2.6.4 — 草稿确认与连续交互（3 项）**

实施状态（2026-10-20）：语义先经 SPEC §4.3 / DESIGN D8 定稿，三项已完成，见文末「S2.6 组 B–D 实施验证」。

| 任务 | 实施内容与位置 | 验收 / 失败反例 |
| --- | --- | --- |
| S2.6.4.1 | 先在 SPEC §4.3 / DESIGN D8 定下发送快照与确认语义，再按需补 core 公开原语及两端接线；确认须绑定发送时的草稿身份/代次，不按当前值相等粗略删除 | 仅完整关联、本地接受的成功提交可确认本次已发送草稿；请求期间的新编辑（含改回同值）、改绑/替换组件、其他 surface 不误删；失败不确认。服务端归一化写回与新编辑冲突的优先级明确并有测试，不仅保证草稿未删却让可见值被旧 patch 覆盖。公共签名在语义确定后敲定，不预造 API |
| S2.6.4.2 | 两组 Catalog 跑实际装配 → core 本地编辑 → HTTP envelope → 权威 handler/RPC → 同 surface patch → 再编辑/action；捕获实际 handler 参数和最终模型 | 连续两次 action；第一次服务端归一化后，第二次不重发已确认旧草稿覆盖结果；覆盖非 value 属性、字符串/布尔/整数以及 partial patch，无需 handler 回显整表输入 |
| S2.6.4.3 | 补非法输入、越权路径、旧 revision、错 hash、拒绝后门控与双 surface headless 对测；串联已有共享 fixture | 被拒时 handler 零调用、快照/revision 不变；A 的草稿/确认/基准/patch 不影响 B；与 .3 的晚到保护共同回归。两个 React Surface 布局、完整预览隔离和真实浏览器验收仍归 S4/S5 |

**S2.6.5 — 最小接入与收尾（3 项）**

实施状态（2026-10-20）：三项已完成，见文末「S2.6 组 B–D 实施验证」。

| 任务 | 实施内容与位置 | 验收 / 失败反例 |
| --- | --- | --- |
| S2.6.5.1 | 更新两示例 README、SPEC/ARCHITECTURE/DESIGN 现状：展示型 actions=[]、纯本地 core、HTTP+RPC 三种入口；给 Catalog + renderMap + handler + 白名单最小样例 | 示例命令与实际入口一致；说明协议到 VNode 属于 core，新增 renderer 不复制解释器；查询不是视图恢复，done 不表示业务事务成功 |
| S2.6.5.2 | 迁移所有 sendAgentRun 四参调用后删除忽略的 idPrefix 旧重载及相关测试；清理已被公开输入提取/权威准入替代的整表合并、参数猜测与最新快照补基准 | 全仓调用方与 dist 类型一致；保留 HTTP await/void、排队占用、取消等旧回归。两处 SSE 消费器留到 S4 client 统一，不为本阶段新增总门面包或会话框架 |
| S2.6.5.3 | Node 24 下根 build → typecheck、根/相关包 lint、根 test、触碰文件格式/链接；SDK review 四维清单，证据回填 CURRENT/README | 新拒绝/隔离反例先失败后通过；core 公共 API 改动先构建 core 再测 React，核对当前 dist/公开入口。完成本节不宣称 S2 全阶段完成，S2.7 另行验收 |

**建议实施顺序与提交单元**：

1. 组 A：S2.6.1.1–.3，先修实际参考入口并建立一个可重复调用的确定性表单。
2. 组 B：S2.6.2.1–.3，接通第二个 Catalog 的公开扩展；不混入原审批业务重构。
3. 组 C：先完成 S2.6.4.1 的语义决策，再实施 S2.6.3.1–.4、S2.6.4.1 代码及 .4.2–.3。运行关联与草稿确认一起交付，避免只加请求头校验却保留旧草稿重放。
4. 组 D：S2.6.5.1–.3，完成迁移删除、文档、根门禁与本阶段复核，再进入 S2.7。

每组先核实失败条件、实现及相关测试，再过组门禁；任务顺序不是额外 agent 授权。原 2026-10-19 并行安排是历史方案；2026-10-20 用户确认拆分并给出建议顺序（.1 → .2 → 先锁定草稿确认语义 → 合并推进 .3/.4 → .5），五组已全部按此完成；用户随后指示全部做完再统一处理提交。每次需要提交时另按根 SOP 给出实际范围/message，不能把历史提交确认延用到未来 S2.6 提交。

#### S2.7 — 独立复核与阶段验收

**细分基线（2026-10-21，S2.6 推送后核实）**：S2.6 及五项复审修复已随 `5a5c5a1` 推送至 `origin/feature`。保留原 S2.7.1–.5 五个交付 ID，细化为 16 个执行任务，全部待实施；本轮只拆分。S2.6 的 836 项测试是历史基线，不能代替 S2.7 本次门禁。目标是验收 S2 已交付的 Catalog v2 与通用交互，发现缺口后补证伪和修复，不预设必须新增多少测试。

**实施状态（2026-10-21）：16 项全部完成，S2 阶段验收通过。** 覆盖矩阵、逐项证据、门禁命令与退出码、review 结论及 S3 交接单集中于 [S2-ACCEPTANCE](S2-ACCEPTANCE.md)。要点：补证伪测试 8 项（paramSchema 默认路径 adapter 反例、装配端 7 份非法夹具全量对测、baseline 夹具 oracle 字段逐项断言、playground 在途重复 action、两个消费方契约加载中止、dist 类型最小消费与签名错用反例）；SDK 复核发现并修复三项正确性问题（合法空输出 action 被拒绝、快照容量淘汰误删刚提交权威代、prepareAction 获锁后准备阶段及 ledger 异常泄漏 surface 锁），均补有反例；移除 `tsconfig.base.json` 源码 paths 别名，全部消费方 typecheck 改走当前 dist 声明；SPEC §1/§5.1/§8、PRD 现状列与 fixtures README 过期声明按实现清理；最终门禁 Node 24 六步退出码 0、合计 851 项测试。SDK review 结论 APPROVE（无 P0/P1，其余 P2/P3 均有归属理由）；远端 CI、真实浏览器与仓外安装未执行，不作为本轮证据。本轮变更待提交，哈希提交后回填。

**核实依据与范围**：已有 core `test/catalog/registration.test.ts`、server `test/agent/action-admission-fixtures.test.ts`、真实 HTTP `test/api/surface-state-query*.test.ts`、两组连续交互及浏览器回归；三包已有源码入口 API 快照，server `test/build-artifact.test.ts` 检查三包 dist 文件清单。源码快照不等于产物可消费，状态存储夹具不等于 HTTP 验收。现有 conformance 覆盖 9 份官方用例、80 条判定；CI 已配置 build → typecheck → lint → test，但配置存在不代表本次远端运行通过。

| ID     | 交付                   | 执行项数 | 依赖      | 完成出口                                                 |
| ------ | ---------------------- | -------- | --------- | -------------------------------------------------------- |
| S2.7.1 | 需求与证伪覆盖矩阵     | 4        | S2.1–S2.6 | 每项保证有真实入口、正反例、失败不变式及证据；缺口明确   |
| S2.7.2 | 公开 API 与当前产物    | 3        | S2.7.1    | 三包根入口 ESM/类型可消费，dist 与源码对应，依赖边界成立 |
| S2.7.3 | conformance 与文档声明 | 2        | S2.7.2    | 实测分类可解释，契约/公开说明与实现一致                  |
| S2.7.4 | Node 24 工程门禁       | 3        | S2.7.1–.3 | 本次构建、类型、lint、测试与定向检查有真实结果           |
| S2.7.5 | SDK 复核与阶段交接     | 4        | S2.7.1–.4 | P0/P1 关闭并复验，状态如实更新，S3 边界明确              |

**统一证据交付**：实施时新增 `docs/tasks/S2-ACCEPTANCE.md`，集中记录矩阵、实际测试位置/名称、命令与退出码、日期、Node 版本、被测 Git 基准及未提交差异范围、结论和未验证项；CURRENT 保留进度和该报告入口，README 保留对外状态。测试数量只作结果统计。此报告本轮不提前创建，不填写尚未执行的通过结论。

**S2.7.1 — 需求与证伪覆盖矩阵（4 项）**

| ID       | 任务与主要位置                                                                                 | 完成判据                                                                                                                                                                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S2.7.1.1 | 以 PRD R1/R2/R4 及 R5/R6/R7 的 S2 已交付部分，对照 SPEC §1/§4/§5.1/§8 和下文验收矩阵建立覆盖表 | 每行列出保证、公开入口、正常/非法用例、观察对象与证据；标明已覆盖/待补/后续阶段。R3 的独立 Surface、R5 完整预览恢复、R6 通用调度、R7 仓外发行不得记作 S2 完成                                                                                                       |
| S2.7.1.2 | 核对 `fixtures/catalog-v2` 与 core/server 测试的实际消费，检查 fixture 前置合法性与 oracle     | Catalog 注册夹具双端结论一致；request 中可复用纯规则与 core 对拍，server 另验可信白名单/参数准入，不要求 core 实现 HTTP。拒绝须命中目标条件；能证明 handler 未进入、快照/revision 未变，不能只看错误文案                                                            |
| S2.7.1.3 | 沿 adapter、HTTP、非 HTTP、RPC/verifier 实际入口核对提交与并发证据                             | 固定 run/surface/catalog/hash/revision；缺失/淘汰/跨 surface/旧格式拒绝；两种 baseline 交错消费同一 oracle，经真实查询/action 路由拒绝旧基准。准入拒绝时 resolver/handler 的调用边界按 SPEC 区分；传输失败不推断业务回滚                                            |
| S2.7.1.4 | 核对两个参考消费方与两组无关 Catalog 的交互回归，重点纳入 S2.6 复审五项                        | 非 value 整数/布尔、自定义触发器、连续两次 action、双 surface 隔离有证据；真正挂起请求验证期间新编辑可见且与下次 inputs 一致；覆盖逐帧失效、重复 action、取消/卸载晚到、done-only/旧视图借基准、JSON 往返 hash。已有测试充分则复用，缺口补入所在包 `test/` 镜像路径 |

**S2.7.2 — 公开 API 与当前产物（3 项）**

| ID       | 任务与主要位置                                                                                     | 完成判据                                                                                                                                                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S2.7.2.1 | 对照三包 `src/index`、公开类型、API 快照与 README 接入片段                                         | 公开符号/签名一致，重点核对四参数 `setInputValue`、草稿快照/boolean 确认、hash 规范化、三参数 `sendAgentRun`、固定 commit 与结果接口；消费代码只 import 包根入口。源码单测可测包内模块，但不能据此声称根入口消费成立                       |
| S2.7.2.2 | Node 24 下以包 build 清理旧 dist 并构建，复用文件清单检查，增加或复用真正的产物根入口/类型消费证据 | 实际 import 三包当前 ESM 根入口并核对导出，最小 TS 消费经公开声明编译；不通过源码 alias、tsx 代解析或包内深路径掩盖 dist 问题。JS/声明/map 清单与当前源码对应，无已删残留；类型加载使用当前支持的配置，NodeNext 迁移仍属 S5                |
| S2.7.2.3 | 核对 exports、依赖图、消费者 imports 和根入口加载副作用                                            | core 不带 React/Node/server，React 不带 Node/server，SDK 不反向依赖示例或业务模型；根入口不启动 listener、不读取项目环境来隐式选模型/Policy。保留 server 现有 Koa 适配，剥离通用 runtime 归 S3；保留 ESM 修补脚本，源码路径迁移与删除归 S5 |

**S2.7.3 — conformance 与文档声明（2 项）**

| ID       | 任务与主要位置                                                                           | 完成判据                                                                                                                                                                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S2.7.3.1 | 执行 core 现有 conformance，逐条比对 `tests/conformance-baseline.json` 与 SPEC §1        | 9 份/80 条用例源完整，分类与本次输出一致；现有基线为 36 pass / 13 Profile 不支持 / 23 Profile 兜底 / 5 值级降级 / 3 方向不适用，0 fail。变化逐条判断回归或显式支持范围决策，不为消红直接刷新快照；这不是完整官方 Basic Catalog 兼容声明                  |
| S2.7.3.2 | 沿实际发布/执行声明核对 Catalog、hash、prompt、onboarding 与主链文档，清理现状段过期描述 | 正常与篡改发布契约均有测试；JSON 往返不漂移，发布与执行同源。核实后修正已发现的文档候选：SPEC §1 仍称本地写回硬编码、§5.1 仍描述旧四参兼容槽，fixtures README 仍仅描述查询路由接线前状态；PRD 包现状等按实现核对。历史记录保留日期，目标需求不提前标完成 |

**S2.7.4 — Node 24 工程门禁（3 项）**

| ID       | 任务与主要位置                                              | 完成判据                                                                                                                                                                                                                                                             |
| -------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S2.7.4.1 | 核对 Node/包管理器和当前构建顺序，运行根构建/类型/lint 门禁 | Node 24；记录 `pnpm build:packages`、`pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm -r --if-present lint` 真实退出码。先构建 core 再执行依赖其 dist 的 React/消费方检查；无源码变化时避免无意义重复，不执行安装/打包/升版仪式                                    |
| S2.7.4.2 | 运行根 `pnpm test` 并核实测试发现与产物前置依赖             | core/react/server/playground/standalone/playground-server 均实际执行；新增用例被各包 runner 发现，公共 API、dist、conformance 与关键正反例结果可定位。新增缺陷修复须先有能失败的反例；836 不作为硬编码通过数量。后续复核修改代码时复跑受影响门禁，跨包修改复跑根测试 |
| S2.7.4.3 | 核对变更格式、文档链接、diff 和 CI 证据边界                 | `git diff --check`、本次变更定向 Prettier 和本地链接检查通过；执行全仓 `pnpm format:check`，既有差异与本次引入分别记录，不笼统写全绿。CI 仅在可定位本次提交的真实运行成功后记通过，否则记未验证；本地门禁不替代远端 CI                                               |

**S2.7.5 — SDK 复核与阶段交接（4 项）**

| ID       | 任务与主要位置                                                                                 | 完成判据                                                                                                                                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S2.7.5.1 | 按 `.zcode/skills/code-review-expert/SKILL.md` 加载四份清单，对 S2.1–S2.6 公开调用链做独立复核 | 覆盖 SOLID/边界、安全可靠性、代码质量与删除/迭代；不能仅 review 验收新增文件或复述已有测试。结论给 APPROVE/REQUEST_CHANGES/COMMENT、真实触发条件及文件行；“独立”不要求额外 agent 或接入方业务工程                             |
| S2.7.5.2 | 建立 findings 闭环，修复本阶段阻断项并更新证据                                                 | P0/P1 清零且对应反例与复验通过；P2/P3 有本阶段处理或后续归属/理由，不能将可达 S2 正确性缺陷仅因 S3 将重构而推迟。用户只要求评审时按 SOP 请求修复范围，已授权实施/修复时不重复确认；修复后回到 .4 更新相关门禁和最终评审       |
| S2.7.5.3 | 基于本次证据完成 S2 阶段报告并同步 CURRENT/README 及相关主链文档                               | 16 项逐项可核，保证/限制与已实现 API 一致，无未解决阻断项才将 S2 标完成；远端 CI、仓外安装、真实浏览器未执行须明记，不能宣称 alpha/生产可用。实际提交后才回填哈希                                                             |
| S2.7.5.4 | 整理 S3 入口与保留回归，不启动 S3 代码                                                         | 交接单覆盖调度唯一所有者、实例隔离、传输无关运行与 Koa 薄适配、完整 commitState/history/资源边界；client/Provider/Surface/预览恢复归 S4，仓外安装/NodeNext/发行归 S5。列出 S2 必须保留的准入、草稿、固定提交与双 Catalog 回归 |

**执行顺序与提交建议**：串行 `.1 → .2 → .3 → .4 → .5`；`.1` 发现的缺口在对应职责层补测试/修复，`.5` 发现问题返回相应任务复验。建议验收证据与补充回归为一组；如存在实现修复，将同一缺陷的代码、证伪测试与契约文档成组交付；最后提交验收结论与阶段交接。具体提交数以实际变更为准，不按 hunk 强拆同一契约文件，每次提交仍须确认范围/message。现阶段只交付任务拆分，不执行上述测试、SDK review 或代码改造。

**实施与提交单元（2026-10-20 用户调整）**：.5 因调度先于 .3/.4/.6 完成，SPEC 同时涉及 §5.1/§8，S2.5.1/.2/.5 合并一个提交，避免按 hunk 拆分同一契约文档；后续维持 .3+.4、.6+.7 两组。每组包括必要消费契约更新与对应测试，保持编译及已有路径可运行。S2.6 后续以本节 2026-10-20 细分的 A/B/C/D 四组为建议提交单元；S2.7.1–.5 另行验收，先前切片完成不代表整个阶段完成。

**历史并行调度决定（2026-10-19 用户确认；S2.6 以 2026-10-20 先拆分指令为准）**：S2.5/S2.6 按文件所有权分轨并行实施——主干 S2.5.1→.2 串行；.5 在 .1 落地后并行（`routes.ts` 归 .5 先行、.3 后置）；.3 与 .4 在 .2 落地且 .5 完成后并行（文件不相交）；.6→.7 收尾；S2.6.1 与 .2 双消费方并行后串行汇合。协调规则：并行期只跑包级 test/typecheck，根 build/test 门禁在提交组边界执行；提交分组以 2026-10-20 调整为准；CURRENT.md 状态行由主线程统一更新。S2.7 不并行，在 S2.5 与 S2.6 完工后串行推进。

### S2 验收矩阵与完成判据

- 正常：两个无关 Catalog；新增展示/自定义输入/自定义 action；非 `value` 属性；不同 schema 值类型；最新输入到达 handler；合法 patch 更新原 surface。
- 初始化拒绝：缺 actions/schema/能力、未知配置、矛盾能力、不支持的 schema/pattern、非法预算和原型危险键。
- 运行拒绝：未声明组件/action/字段、非可挂载来源、只读/越权路径、伪造目标路径、错误类型、重复/冲突输入、参数不合规、旧 revision、错误 hash 与 v1/v2 混用；handler 未执行，已提交快照和 revision 不变。
- 扩展点反例：自定义 resolver、生成源或 RPC 不能绕过共享准入；同一正常/非法 fixture 在 core 与 server 得到一致结果。真实业务授权仍由宿主实现。
- 代码门禁：Node 24，相关用例先失败后通过；core 构建后测 React；根 test/typecheck/lint、相关包 lint、build/build:packages、当前 dist/公开 API 检查；conformance 变化明确说明分类理由。新测试在包 test/ 下镜像 src/。
- SDK review 后同步 SPEC 的现状、ARCHITECTURE/DESIGN 的实现状态及 CURRENT/README。仓外干净安装、真实浏览器与完整 Session/调度仍分别按 S3–S5 验收，不借 S2 完成提前宣称。

执行顺序为 S2.1 → S2.2 → S2.3/S2.4 → S2.5 → S2.6 → S2.7；S2.3/S2.4 是依赖上可分别实施的模块，不表示授权并行 agent。S2.5/S2.6 的 2026-10-19 并行安排保留为历史决定；2026-10-20 用户确认 S2.6 拆分并给出建议实施顺序（.1 → .2 → 先锁定草稿确认语义 → 合并推进 .3/.4 → .5），执行以 S2.6 本节为准。S2.7 待 S2.5/S2.6 完工后推进。每项完成须保持已有消费路径可运行，契约变更与消费方更新成组落地，不单独交付不可编译的类型变更。

## S3 — 单一运行调度与 Session v1

1. 抽离不接受 Koa Context 的运行模块；每 runtime/surface 一个调度所有者，覆盖读取快照、revision/hash/action 准入、handler 和 UI 提交。移除全局队列/双锁与 HTTP 标志耦合。
2. 落地 SPEC 的 Nexus Session v1 envelope、start/message/done/error、唯一终态、UI commitState 与结构化 diagnostics；明确提交发布点及结果不确定时的 unknown。
3. ledger、store、scheduler 按实例隔离；failed/取消/断线不自动重放业务操作。history/观察者失败不能把已提交 UI 报成未提交；持久化 store 不被宣称为分布式协调。
4. Koa 只负责响应占用、序列化、连接和背压；保持 await/void、排队响应与错误转发时序。通用 runtime 用非 Koa 事件消费者对测。
5. 为活动/排队 run、消息、缓冲和记录保留建立真实预算；超限显式拒绝，不淘汰仍在执行的保护记录；取消能释放源、锁、reader 和监听器。

完成判据：并发/重复 action、排队取消、慢消费、超限、跨实例隔离和提交前后失败均有反例；宿主副作用替身已执行后，patch/网络失败不会触发 SDK 重放或回滚。handler 不会在排队准入前执行；原取消与 Koa 回归全保留。

## S4 — client 与 Provider/Surface

1. 新建 `@nexus-ui/client`：稳定 runtime、会话/按 surface 订阅、生成/action、取消、恢复、dispose；fetch/SSE 适配可替换且不依赖 React 或 server 实现。
2. 隔离预览、已提交视图和输入草稿。必须核对终态与本地校验；EOF 不成功，缺失确认/版本不一致标失同步并禁用 action。
3. Provider 只提供上下文，新增 `A2UISurface` 由宿主布局；renderMap/回调重渲不重置 runtime；明确外部/内部实例销毁与订阅释放。样式显式选择。
4. playground 与 standalone-host-demo 迁移到同一 client 状态机，删除复制的 SSE 消费逻辑；展示禁用态与动作出口双重门控。

完成判据：自定义控件、双 surface 独立更新/删除、缺失 done、坏流顺序、取消/晚到响应、unknown、恢复、卸载释放在 headless 和相关 React 用例验证；真实浏览器验证宿主布局嵌入、输入、action、错误反馈与基本可访问性。使用契约 fixture 即可，不依赖真实模型或指定业务应用。

## S5 — 当前产物验收与发行

- API 定型后，在仓外干净 React + Node 项目仅使用公开根入口完成 PRD §5.1；验证生成源、Catalog、transport 和 handler 可替换，非 Koa 路径一致。该项目是 SDK 契约验收夹具，具体宿主 Agent 仍可后续选择。
- 按 DESIGN D10 统一 ESM + 类型声明与可选样式；显式 .js 源码路径/NodeNext 迁移和产物验证后移除 fix-esm-imports。校验四包 types/exports/files/依赖/兼容声明、加载副作用、API 快照与升级说明；测试须基于本次构建产物，不能用源码直链代替。
- 当前 conformance 及偏差、根 typecheck/lint/test/build/format、干净环境 CI 与浏览器关键路径有实际执行证据。先标注支持子集和限制，再按 PRD 门禁决定 alpha/正式发行；未通过不宣称 production-ready。
- workspace 同居期不刷 tarball；真实拆分/发行时按 AGENTS.md 恢复版本与消费端同步规则。包管理器/Node 声明与实际 Node 24 门禁一致性在产物检查中核实。

## 既有挂账归属与暂缓项

| 既有问题                                                                                                   | 归属与处置                                                               |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| resolveContext 保留 key、render 继承属性、媒体 URL scheme、schema.pattern 原生 RegExp、runs 查询无访问准入 | S1 已处置（2026-10-16）：全部先证伪后修复；runs 改宿主 `runsAccess` 准入 |
| 默认 Catalog/LLM/业务 Policy、参考程序混装                                                                 | S1 已处置（2026-10-16）：默认值删除、缺失即报错；参考程序迁出            |
| 输入/动作组件名硬编码、客户端最新输入缺失、resolver 替换安全链                                             | S2：能力声明与共享准入                                                   |
| Protocol/Profile 近重复解释                                                                                | S2 结合共享规则整理；保留 conformance 分类证据                           |
| 双锁、模块全局队列、failed 重入、背压无硬限额、重放/超限组合反例                                           | S3：运行所有权与预算                                                     |
| Provider 固定布局、单 tree、runtime 重建、两处 SSE 消费、EOF/预览门控                                      | S4：会话与视图拆分                                                       |
| 每消息全量重校验所有组件                                                                                   | S2–S4 保持有界正确行为并加观测；精细增量优化暂缓，以真实瓶颈为依据       |
| freestanding Catalog 包、Vue、完整 v0.9/v1.0、分布式调度                                                   | 暂缓；非首发范围，不与本轮门禁混合                                       |

## 验证规则与历史基线

代码切片：先 `node -v` 核对 Node 24；相关单测、typecheck、根与相关包 lint、构建；跨包改动加根 `pnpm test`。core API 改动先构建 core 再跑 React 测试。安全/隔离/幂等保证必须有触发失败路径的证伪测试。声明仓外、浏览器或 CI 可用必须实际在对应环境执行。

以下均为旧证据，不是新阶段完成声明：

- Layer 0：2026-09-30 `3dc308a`；conformance `261ea43`，9 份用例，33 pass / 47 已决策偏差 / 0 fail。
- 2026-10-15 `105ee34`：Koa 调用时同步占用响应；await/void 与排队 run 三条证伪。取消传播也已收口，重构必须保留双侧 AbortSignal 反例。
- 2026-10-16 结构调整后已有快照：根测试 core 179 / server 127 / React 32 / playground 9 / demo 21；根 typecheck/lint/build 通过、三包 dist 根入口齐全。此证据不包含本轮目标改造；本轮不据此宣称通过代码门禁。

本轮验证（2026-10-16，仅文档与 skill）：

- 12 份变更 Markdown 经定向 Prettier 格式化；使用 `--ignore-path /dev/null` 绕过仓库对 Markdown 的默认忽略，定向 check 通过。
- 32 个本地 Markdown 链接目标存在；相关文件 `git diff --check` 通过；旧业务专项、失效文档路径和旧任务描述扫描无残留。
- skill 内置 `quick_validate.py` 因 Python 缺少 PyYAML 未执行成功；改用已安装的 js-yaml 完成 YAML、允许字段、命名、描述和未完成占位结构检查，结果通过，未安装依赖。
- 人工复核评审范围：SDK 变更检查公开契约与生命周期；示例只检查 SDK 消费；未选定宿主不阻塞 fixture 验证。无应用内部工程评审要求。
- 未改运行代码，未运行单测/typecheck/lint/build、仓外安装、浏览器或 CI；上述目标阶段仍待实施。

## 提交前验证快照（2026-10-16）

范围为已有仓库结构整理（server 包等内容迁移、旧业务示例移除、workspace/锁文件同步）与文档/skill 基线。另补齐 ESLint 忽略目录和 Vite 注释的旧路径；ESM + 类型声明及后续移除产物修补的约定已入 SPEC §8.1 / DESIGN D10，本轮不实施构建重构。

- Node v24.16.0：根 `pnpm build`、`pnpm typecheck`、`pnpm lint`、server 包 lint 均退出 0。
- 根 `pnpm test` 退出 0：core 179、server 127、React 32、playground 9、standalone Node 测试 21 + jsdom 测试 1。沙箱首次因 tsx IPC EPERM 失败，获准后在沙箱外重新执行通过。
- 根 `pnpm format:check` 退出 1：13 个 core/React 文件有已有格式差异，逐一确认与 HEAD 字节相同；不扩大本次提交为全仓格式改动。变更文件另行定向检查，Markdown 显式绕过忽略。
- React 预算测试输出已有重复 key 警告，测试仍通过；不作为浏览器行为已验收的证据，后续 S4 核对节点 key 与渲染稳定性。
- server 56 个文件相对原路径为等内容迁移；评审结论 COMMENT，本次差异未发现新增 P0/P1，既有安全/生命周期差距仍在 S1–S4，不据此宣称 SDK 可正式发行。
- 未执行仓外干净安装、真实浏览器或远端 CI；未开始 S1–S5 运行代码改造。实际提交哈希只在提交成功后使用，不预填。

## S1 实施验证（2026-10-16）

范围为 S1 安全基线与业务中立：core/react 安全反例修复、server 显式装配与 runs 准入、参考程序迁出 `examples/playground-server/`、根脚本与文档同步。实际提交哈希只在提交成功后回填。

- 诊断核实：五类缺陷（resolveContext 保留键、buildProps 继承属性、媒体 URL scheme、schema.pattern 原生 RegExp、组件 id/surfaceId 单字面量拦截）均经源码核实并运行时复现；`(a+)+$` 实测 25 字符 644ms / 29 字符 2060ms（指数回溯）。
- 证伪测试先失败后通过：core 修复前新测试 16 失败（mocha exit 16），修复后 core 204 passing；React 媒体守卫修复前 3 失败，修复后 38 passing。
- 迁移：11 个 src + 3 个测试文件迁至 playground-server，公开入口依赖有证伪扫描（深路径 import 为零）；server 测试 90 passing（演示用例随迁，未全量搬迁）。
- 门禁（Node v24.16.0）：根 `pnpm typecheck`、`pnpm test`（core 204 / server 90 / playground-server 70 / React 38 / playground 9 / standalone 21+jsdom 1）、`pnpm lint`、`pnpm build` 均退出 0；三包 dist 根入口原生 ESM 加载实测通过。
- server 公开导出面实测：`nexusAgentPolicy`/`resolveAgentPolicy`/默认单例已不在 dist；`new AgentAdapter({})` 按 registry 缺失抛错。
- 首轮自检（后被独立评审补充）：按 SDK review skill 执行，结论 COMMENT，无 P0/P1；P3 备忘（React 阻断占位文案重复、schema.pattern 走有界引擎的语义子集已在 DESIGN D11 记录、playground-server `@types/node ^18` 可升 ^24）。
- 未执行：仓外干净安装、真实浏览器路径（媒体占位仅组件级测试）、远端 CI、`pnpm format:check` 全量复跑。

## S1 独立评审修复验证（2026-10-16）

独立评审结论为 REQUEST_CHANGES：原型继承查表和非法预算属于验收遗漏，参考工厂漏接 Policy 属迁移回归，旧 dist 残留属于构建面遗漏。用户已授权修复四项，以下证据取代首轮自检的完成判断；修复已纳入本次 S1 交付，未开始 S2。

- 原型查表：core 组件表、Catalog schema/Policy 表仅读取自有属性；React renderMap 仅调用自有且为函数的条目，否则渲染未知组件占位。保留显式注册同名组件的能力，未扩大组件类型禁用名单。
- 预算：runtime 创建、buildTree/renderTree 调用（含空树）、内存/文件 history、action state/ledger 与 run manager 初始化时拒绝非正安全整数。负数、零、小数、NaN、Infinity 和超出安全整数范围均有反例；此处不提前实现 S3 并发/队列预算。
- 装配：演示 Policy 由参考工厂显式接入，局部覆盖保留其他演示 hook；SDK 仍为中立 Policy。测试经过实际工厂与公开 guard，避免手动注入掩盖回归。
- 构建：三包 build 先清理各自 dist 再编译，根 build/build:packages 串行执行，避免依赖包清理竞态；文件清单对照当前 src，验证旧 listener、模型/演示和环境模块及测试文件不残留在 SDK 产物中。此处仍不恢复 tarball 发行流程。
- 证伪：修复前新增 core 渲染/预算用例 15 失败、Catalog 查表 3 失败、React 11 失败、server 预算/产物 8 失败、参考装配 2 失败；修复后全部通过。负数 history 导致死循环另经独立子进程超时复现，回归测试在构造入口断言拒绝，避免测试进程挂死。
- Node v24.16.0：根 build/build:packages/typecheck/lint、各包 lint、根 test 均退出 0；本轮三包原生 ESM 根入口加载与 dist 清单验证通过。测试 core 224 / React 50 / server 101 / playground-server 73 / playground 9 / standalone 21 + jsdom 1，共 479 项。根测试首次被沙箱 tsx IPC EPERM 阻断，获准后沙箱外执行通过。core 已构建后再执行 React 测试。
- 格式与复核：全仓 format:check 仍有修复前已有的 13 处差异，不扩大为无关格式修复；本轮修改文件定向 Prettier 检查、文档本地链接检查与 git diff --check 均通过。复核四项发现均有反例回归闭环，本轮修复未发现新增 P0/P1。React 预算压力测试仍有已有重复 key 警告，归 S4 验证，不作为本轮浏览器已验收证据。
- 未执行：仓外安装、真实浏览器、远端 CI；S3 调度与 S4 client/React 生命周期仍按原计划推进。

## S2.1 实施验证（2026-10-16）

范围为 S2.1 契约锁定：SPEC §4/§5.1/§8 与 DESIGN D8 定稿；core 新增 session 契约模块与 Catalog v2 类型、server 新增 `NexusActionRequest` 类型（纯类型加 `NEXUS_SESSION_VERSION` 常量，不改运行行为）；共享 fixture 定稿于 `fixtures/catalog-v2/`。实际提交哈希只在提交成功后回填。

- 契约定型：v2 单一组件声明表且 `actions` 必填；action 挂载权威在 `sources`、组件侧仅 `required`（矛盾组合注册报错）；`inputs` 键须为可绑定字段且值 schema 无 `dynamic`；`paramSchema` 缺省即参数必须为空对象；nexus 元数据类型定于 core `session` 模块，server 组合 `{ message, nexus }` envelope；可编辑白名单为精确 JSON Pointer、规范化判重、默认拒绝；未变化输入幂等合法；`pattern` 注册口径与有界求值引擎一致。决策全文见 DESIGN D8「契约定型」。
- 现状核实：S2「现状依据」四条断言经源码逐条复核属实（setInputValue 硬编码、validator/注册闸门缺口、resolver 绕过路径、Contract v1 与快照无 hash）；另核实未知声明键与未知 schema 关键字当前静默接受、action 白名单核对分散在 runtime 与 server 两处。
- fixture：2 份正常 Catalog、6 份非法注册、2 份正常请求、8 份非法请求；非法项覆盖未知键、未知 schema 关键字、矛盾声明、环视 pattern、v1 形状、revision/hash 不一致、未声明属性、schema 违规、重复/冲突输入、伪造写路径、缺 `nexus`。envelope 与 `{{catalogHash}}` 占位规则见目录 README。
- 门禁（Node v24.16.0）：根 `pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm test` 均退出 0；测试 core 224 / React 50 / server 101 / playground-server 73 / playground 9 / standalone 21 + jsdom 1，与 S1 基线一致（本轮无运行行为变化）。core public-api 导出清单测试同步新增 `NEXUS_SESSION_VERSION`。三包 dist 根入口原生 ESM 加载实测通过。
- 格式与扫描：变更 TS/JSON/Markdown 定向 Prettier 检查通过（SPEC/CURRENT 表格经 --write 修整）；五份文档本地链接 21 个全部存在；`git diff --check` 通过；新增文件与改动段落旧业务词扫描零新增残留。
- 未执行：仓外安装、真实浏览器、远端 CI、conformance 重跑（无运行代码与协议校验行为变化，S2.2 改动解释器时重跑）。

## S2.4 实施验证（2026-10-19）

范围为 S2.4 服务端权威输入与 action 参数准入：server 新增 `agent/action-admission.ts` 共享编排（可编辑白名单规范化、严格/兼容双入口、整批输入校验、临时模型参数重算）、`AgentAdapter.prepareAction` 准入接线与 resolver 后置、`SurfaceActionSnapshot` 提交边界固定 Catalog hash/contractVersion、core 公开导出 `isUnsafeDataPath`。实际提交哈希只在提交成功后回填。

- 准入顺序（surface 锁内）：客户端 context 未声明键拒绝 → nexus 核对（严格入口缺失 `nexus` 即按旧格式拒绝；兼容入口逐字段核对已提供的 sessionVersion/actionId/surfaceRevision/catalogHash）→ action 来源能力（`actions.sources`）→ 整批输入校验（组件与 `inputs` 声明、白名单精确匹配、`{ path }` 绑定与保留段、值 schema、重复/同路径/祖先-后代冲突）→ 临时模型重算参数。`paramSchema` 校验作用于最终交给 handler 的参数（默认=重算值，resolver=其输出），共享准入不提前否决 resolver 整形；resolver 输出仍受未声明键与参数 schema 约束。拒绝满足不变式：handler 未调用、快照与 revision 不变、ledger 失败记录可重试；临时模型不发布输入、不递增 revision，提交沿既有 patch 路径。
- 共享 oracle 对测：`fixtures/catalog-v2/` 全部 12 份请求夹具经真实 `InMemorySurfaceActionStateStore` + 严格准入入口对测一致（accept/reject 各按 fixture `expect`）。
- 证伪：新准入规则使既有消费方测试 6 处 server + 5 处 standalone 先失败（resolver 透传客户端 context、paramSchema 缺省-空对象、无 paramSchema 演示 Catalog），随契约成组迁移后全绿；新增准入单元 18 项与 adapter 不变式 4 项针对已实现模块编写（含白名单转义归一防碰撞反例：`/a~1b` 与 `/a/b` 不冲突）。新增测试未先红，以既有用例的语义红承担证伪。
- 消费方成组迁移：standalone 演示 Catalog 补 paramSchema（approvalId/amount）；playground-server 演示 Catalog 的 Workbench priority 修正为真实形状（字符串数组，恰选其一与取值合法性保留为 Policy 业务规则）；两个测试内联 Catalog 补 paramSchema；external-agent RPC 夹具按「客户端键必须已声明」改为空 context；standalone prompt 断言随 paramSchema 发布更新。
- 门禁（Node v24.16.0）：根 `pnpm build`、`pnpm typecheck`、`pnpm lint` 与根 `pnpm test` 均退出 0；测试 core 302（含 conformance，基线未动）/ React 51 / server 167 / playground 13 / standalone 21 + jsdom 1 / playground-server 73。触碰文件定向 Prettier、`git diff --check`、core dist 根入口加载实测通过。
- 未执行：仓外安装、真实浏览器、远端 CI；action HTTP envelope 解析、`X-Nexus-Run-Id`、基线路由、verifier/RPC 元数据传递与旧格式入口拒绝归 S2.5，不据本轮宣称请求接线已完成。

## S2.4 首轮独立评审整改记录（2026-10-19，部分方案由下节取代）

本节保留首轮记录与当时门禁；后续复核发现八项缺口，当前语义以「S2.4 二次复核修复」为准。

独立评审七项 P1 全部整改并补反例：①准入输入随 handler patch 在提交边界一次原子落库（patch 先应用、输入后写回，不依赖回显；原测试手动回显掩盖的问题已由反例固化）；②快照深拷贝出界（组件表/模型/声明副本独立），resolver 拒绝不污染权威状态；③统一严格寻址——根指针 `/` 与非规范数组下标（前导零）拒绝；④重新生成/删除重建跨代单调 revision，上溢显式失败；⑤排队提交按生成代（epoch）核对基准——同代串行队列语义保留，新生成替换快照后旧 patch 拒绝应用；⑥准入与 guard 使用提交边界固定的 Catalog 声明副本（随 hash 一并固定），registry 原地变更不翻转结论；⑦移除「缺元数据则跳过」兼容旁路，`nexus` 必填，S2.5 前参考 HTTP 层经 `describeSurfaceContract` 以可信装配身份提供元数据，演示流保持可用。反例按七项逐一补齐（组合提交/深隔离/严格寻址/单调版本/代基准/固定副本/无旁路），server 175 项全绿；门禁（Node v24.16.0）根 build/typecheck/lint/test 退出码全 0，core 302 / React 51 / server 175 / playground 13 / standalone 21+1 / playground-server 73。整改顺序与 S2.5 归属按评审建议执行，未执行仓外安装、真实浏览器、远端 CI。

## S2.4 二次复核修复（2026-10-19）

用户授权修复八项缺口，当前实现替代首轮中的相关结论：

1. HTTP 仅接受 `{ message, nexus }`，原样保留 actionId/revision/hash；不以 `describeSurfaceContract` 或新 UUID 替代客户端基准。commit 返回提交时捕获的固定结果，成功 done 发布；两个浏览器将其与同次已消费视图关联，EOF/错误/本地拒绝后不能继续 action。旧格式、过期基准与 actionId 重放均有真实 HTTP 回归，handler 调用次数断言保持不变。
2. 输入作为基础模型，handler patch 后应用，归一化值优先；根替换以 handler 全量模型为准。输入模型经消息源先发出，浏览器与存储按同序组合；partial patch 无需回显输入。
3. core 共用容器感知的严格输入寻址，拒绝所有数组别名（`01`、`+1`、`1e0`、空段等），普通对象同形字面键允许；空串与 `/` 禁止作为输入根目标，既有协议根替换语义不变。
4. 临时模型、待提交 inputWrites、resolver/handler 的参数与上下文持有独立值快照，扩展修改不穿透验证后的待提交输入。
5. 消息组件与模型在存储入界/出界均克隆，原消息后续改动不污染权威状态。
6. store 使用实例级单调安全整数计数器，删除/容量淘汰后重建不重号；无无界墓碑 Map，上溢显式失败。
7. 非 HTTP 正常 source EOF 不释放锁；消费者必须 commit/onError/dispose。提交同时核对 revision/epoch，排队的旧 revision 在 handler 前拒绝；终止回调幂等且不会把已成功的 ledger 改为失败。
8. 实际流 guard 与提交前复核使用固定 Catalog 副本，以原组件表与临时模型校验增量 patch，registry 变化不改变当前运行解释。

为堵住可达的 HTTP 旁路，S2.5 最小 envelope、done 固定结果及参考浏览器接线已提前；不表示 S2.5 整体完成。剩余有界结果留存、按 run 查询、响应头、verifier/RPC 与发布核对保持原计划；S3/S4 的完整会话与预览隔离未实施。

门禁（Node v24.16.0）：根 `pnpm build`、`pnpm typecheck`、`pnpm lint`、各包递归 lint 与根 `pnpm test` 退出码均为 0；core 306 / React 51 / server 186 / playground 16 / standalone 21+1 / playground-server 73，共 654 项。core 构建后运行 React/消费方测试；完整测试因 tsx IPC/本地 HTTP 需要在获准后于沙箱外执行。定向 Prettier、`git diff --check` 与 dist 公开入口检查通过。

按 SDK review skill 的架构边界、安全、质量和删除清单复核八项修复，无本轮新增待修 finding；移除可信 HTTP 补基准、actionId 重建及 streamClaimed 锁转移逻辑。回归覆盖实际 HTTP、非 HTTP、存储及 jsdom App，不以其替代真实浏览器、仓外安装或远端 CI；这三项未执行。原有用户改动保留并纳入本次 S2.4 提交范围；本节为提交前验证记录，提交与推送状态以 Git 实际记录为准。

## S2.3 实施验证（2026-10-18）

范围为 S2.3 声明式本地写回与输入收集：runtime `setInputValue` 删除五组件名字分支改为声明驱动、输入草稿与 `getLatestInputs` 公开原语、React `RenderContext` 与五个标准控件加 `property` 参数、schema 层新增 `validateInputValueDiagnostics`/`isDataBinding` 公开导出与 Registry `getInputValueSchema`。实际提交哈希只在提交成功后回填。

- 声明驱动写回：可写属性必须是当前宿主 Catalog `inputs` 键（自有属性查表，`toString`/`__proto__` 不借原型冒充）；值经声明值 schema 字面校验（`{ path }` 形状的值按绑定拒绝）；写回目标取组件 `{ path }` 绑定并拒绝保留段与空路径；未注入 registry 即无写回能力，宿主 Catalog 未声明 inputs 的同名组件不因标准名获得能力。`setValueAtPath` 写路径异常（中间节点非容器）收敛为拒绝，不再向宿主事件回调抛错。
- 首轮输入收集（隔离与失效清理缺口已由下节评审修复取代）：成功写回按 surface 记录 `{ componentId, property, value }` 草稿（structuredClone 值快照，写入模型与草稿同一份克隆）；`getLatestInputs` 按「组件 + 绑定属性」去重取最新、过滤失效条目（组件被替换/属性不再可写/绑定消失）、`deleteSurface` 清理。S2 不组装 action 请求，服务端权威准入归 S2.4/S2.5。
- 先失败后通过：新增 `test/runtime/input-write.test.ts` 16 项与 `test/catalog/input-value.test.ts` 5 项；runtime 实现前新测试 13 项行为失败（`getLatestInputs` 缺失、自定义属性/声明值域在旧名字分支下全错），实现后全绿。行为变化随之固化：ChoicePicker `[]` 按声明 `minItems:1` 拒绝（取代名字分支宽容度）。
- 消费方成组迁移：旧 runtime 测试 6 处调用点改 4 参签名并装配标准声明 Catalog（action 经 sources 授权）；React provider 测试 7 个输入用例补 `catalogRegistry`（无 registry 拒绝写回后必需）；新增标准控件 `property='value'` 上报断言；首轮仅搜索直接 `setInputValue` 调用而判断浏览器零改动，遗漏 Playground 的 Provider registry 装配；本轮评审修复补齐。
- 门禁（Node v24.16.0）：根 `pnpm build`、`pnpm typecheck`、`pnpm lint`、core/server 包 lint 与根 `pnpm test` 均退出 0；测试 core 295（含 conformance，基线未动）/ React 51 / server 133 / playground-server 73 / playground 9 / standalone 21 + jsdom 1。
- 未执行：仓外安装、真实浏览器、远端 CI；服务端权威输入与 action 参数准入归 S2.4，不据本轮宣称准入已实施。

## S2.3 评审修复验证（2026-10-18）

本轮闭合 3 项 P1 与 1 项 P2：输入提取引用隔离、草稿来源失效与复活、Playground 公开装配遗漏、core README 旧签名。

- 输入快照：调用值、模型、内部草稿与每次提取返回值分别深拷贝；修改提取条目、嵌套数组或公开 store 模型不会污染后续草稿。
- 失效清理：记录来源 Catalog、组件类型、绑定路径与能力声明指纹；接受组件更新后立即清除失效项，提取时复核。改绑、替换组件、移除绑定后恢复均不复活旧值；无关属性更新和其他 surface 的草稿保留。
- 消费契约：Playground 从现有同源 Catalog 发布接口加载声明，全部通过 SDK 注册闸门后再挂载 Provider；HTTP 失败、ID 不匹配或 schema 非法显式报错。未新增 SDK 网络 API，未提前实施 S2.4/S2.5。
- 公开文档：core/React README 同步四参数写回、Catalog v2 装配与输入快照用法；SPEC/DESIGN/README/SOP 同步草稿所有权与失效语义。
- 证伪：修复前新增 core 6 项、实际 App 4 项全部行为失败；修复后通过。App 通过真实 Provider、控件、core 与 fetch/SSE 消费链验证编辑值进入 action context。
- 门禁（Node v24.16.0）：根 `pnpm build`、`pnpm typecheck`、`pnpm lint`、递归各包 lint 与根 `pnpm test` 均退出 0；测试 core 302（含 conformance）/ React 51 / server 133 / playground-server 73 / playground 13 / standalone 21 + jsdom 1，共 594 项。根测试首次受沙箱 tsx IPC EPERM 限制，获准后沙箱外重跑通过；React/消费方测试在 core 构建后执行。
- 定向 Prettier、`git diff --check` 与文档本地链接（22 个）检查通过；core/React README 的 Catalog v2 示例经当前 dist 公开根入口注册通过。按 SDK review 清单复核四项修复，无新增待修项；同类型同绑定普通属性更新与被拒更新均保留合法草稿。
- 未执行：仓外安装、真实浏览器与远端 CI；App 回归为 jsdom 环境。S2.4/S2.5 继续按原计划推进，未提交或推送。

## S2.2 复核剩余两项修复验证（2026-10-17）

P1/P2 均已修复：Profile 移除固定 SDK 标准声明查表与 DateTimeInput/媒体组件的 checks 限制，结构与安全校验保留，能力、函数子集和预算由当前 Catalog 决定；FunctionCall 仅豁免已校验的 `updateComponents.components[].checks[].condition`，仍递归检查参数。轻量 core 未注入 registry 时只执行 Protocol/Profile，不隐式选择标准 Catalog。

- 先失败后通过：新增共享 `fixtures/checks-boundary.json`；core runtime 31 项与 server 实际 `sendMessages` 30 项覆盖标准名覆盖、自定义名、toString、启用/关闭/缺省，以及 dataModel/theme/props/条件参数嵌套 checks 键；反例断言 runtime 状态不变、server 不转发非法消息且不提交，正常普通 checks 数据可提交。
- conformance 分类已逐条核对并更新快照：36 pass、44 偏差、0 fail（13/23/5/3）；ChoicePicker 两条与 CheckBox 一条由名字禁令解除而转为 pass，DateTimeInput 仍缺 enableDate/enableTime，仅诊断变化。默认标准声明未自动启用这些能力，详见 SPEC §1。
- 门禁（Node v24.16.0）：根 `pnpm build`、`pnpm typecheck`、`pnpm lint`、core/server 包 lint 与根 `pnpm test` 均退出 0。最终测试 core 274（含 conformance）/ React 50 / server 133 / playground 9 / standalone 21 + jsdom 1 / playground-server 73；根测试首次被沙箱禁止 tsx IPC 管道，提权重跑通过。
- 当前 core dist 根入口实际 push 验证：宿主启用 Card.checks 后可入库，普通 dataModel checks 中的 FunctionCall 被拒。变更文件定向 Prettier 与 `git diff --check` 通过；Markdown 依仓库配置不纳入 Prettier。
- 已按 SDK review 清单复核本轮改动，无新增待修项；SPEC/DESIGN/CURRENT/README 与 SOP 已同步。未执行仓外安装、真实浏览器、远端 CI；S2.3–S2.5 未实施。

## S2.2 首轮评审修复记录（2026-10-17，结论由本轮复核修正）

首轮修复后曾报告 4 P1 + 2 P2 全部闭合。随后独立复核确认：固定 SDK 标准声明仍会覆盖宿主 checks 配置（P1 未完全修复），任意 checks 键的 FunctionCall 全树豁免引入新遗漏（P2）；本段保留当时实施与门禁记录，最终实现及证据见本轮复核修复记录。

- P1 自有属性：schema 的 required/additionalProperties/properties 与 Catalog fields/inputs/sources 成员判断统一改为自有属性检查；证伪覆盖「自有 toString 冒充已声明字段（additionalProperties:false 下经完整 runtime 被拒且不落状态）」与「sources:['toString'] 注册拒绝」。
- P1 声明隔离：`standardCatalogComponentDeclarations()` 改为 structuredClone 深拷贝，证伪用例断言修改一次调用的嵌套 schema 不影响 SDK 与后续调用。
- P1 配置闸门：checks.enabled/componentRef 必须布尔、checks 预算必须非负安全整数、catalogId 必须非空字符串；'false' 字符串真值与非安全整数预算均有注册拒绝反例。
- P1 Profile 首轮方案（已由复核修正）：checks 能力闸门查 SDK 标准声明（仍误拒宿主覆盖，不能作为最终声明驱动实现）；五个输入组件的「不支持挂载 action」名字禁令删除，挂载权威归 Catalog sources；字段结构契约、Slider min<max 等跨字段约束与 URL/正则/原型/资源基线按要求保留。
- P2 嵌套 dynamic：inputs 值 schema 全树（properties/items）递归拒绝 `dynamic`，注册期反例覆盖两层嵌套。
- P2 共享 action 诊断：未注册 action 名（path `components.<id>.action.event.name`）与 sources 越权统一由 `getComponentDiagnostics` 报告；runtime 删除重复的 getActionDiagnostics；guard/standalone 断言随升级为 catalog 级消息。
- conformance：重跑零漂移（pass 33 / 16 / 23 / 5 / 3 不变），`conformance-baseline.json` 无变化，无需分类更新；官方 checks 用例落在原白名单组件上，删除名字闸门不改变官方面。
- 门禁（Node v24.16.0）：根 `pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm test` 退出 0；测试 core 243 / React 50 / server 103 / playground 9 / standalone 21 + jsdom 1 / playground-server 73；触碰文件定向 Prettier、`git diff --check` 通过。
- 未执行：仓外安装、真实浏览器、远端 CI；输入准入执行链路按计划归 S2.4/S2.5。

## S2.2 实施验证（2026-10-16，注册闸门与标准声明部分）

范围为 S2.2 的闸门与声明基建：`CatalogDefinition` 切换 v2 形状（V2 后缀移除、v1 三张平行表删除）、注册闸门实施 SPEC §4.2 全部拒绝规则、`standardCatalogComponentDeclarations()` 上收 17 个标准组件声明、Catalog Contract v2 生效、server adapter/guard/onboarding/verification/discovery 适配声明表、playground-server 三个演示 Catalog 与全部消费方测试迁移。Profile validator 按名分支切换到声明驱动仍为 S2.2 收尾项，输入准入接线归 S2.3/S2.4。

- 闸门与语义：未知键（定义/声明/action/policy/schema 节点）注册拒绝；`fields.binding` 双源声明拒绝；`inputs` 键须为 schema.properties 已声明字段且绑定能力非 forbidden（缺省即 forbidden）；`action.required` 与 `sources` 双向一致性注册校验；`checks.functions` 对照受支持名单（常量上收 `SUPPORTED_CHECK_FUNCTIONS`）；`pattern` 注册口径与 `compileSafeRegExp` 一致；schema 新增 `minItems`（校验+执行）；Registry 查表只读自有属性（`__proto__`/`toString` 冒充被拒）。
- action 挂载由声明决定：Registry 诊断核对「组件挂载的 action 名 ∈ 目录 actions 且组件 ∈ sources」，取代按名 allowed/required 特判；`supportedActions`/`supportedComponents` 由声明推导（server adapter、discovery 摘要同步）。
- 契约版本：`CATALOG_CONTRACT_VERSION` 升至 2，hash 算法不变；discovery client 版本校验对照常量不再硬编码。
- 证伪对测：core 新增 `test/catalog/registration.test.ts` 消费 `fixtures/catalog-v2/` 全部 9 份 Catalog 夹具（2 接受 + 7 拒绝，关键词对齐 §4.2 条款）；既有 23 个 v1 形状消费方（core/react/server/playground-server/standalone）全部迁移，旧「不能挂 action/未知字段」按名断言改为声明驱动语义断言。
- 门禁（Node v24.16.0）：根 `pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm test` 均退出 0；测试 core 236 / React 50 / server 103 / playground 9 / standalone 21 + jsdom 1 / playground-server 73（conformance 用例含于 core，基线无回归）；触碰文件定向 Prettier、`git diff --check` 通过；dist 根入口加载实测 `standardCatalogComponentDeclarations` 返回 17 个声明。
- 未执行：仓外安装、真实浏览器、远端 CI；`{ message, nexus }` 请求解析与输入准入接线归 S2.4/S2.5，不据本轮宣称准入已实施。

## S2.1 评审修复验证（2026-10-16）

首轮独立评审结论为四项（P1×3、P2×1），以下为首次修复记录；复审确认前三项闭环，第四项仍有并发关联缺口，其基线来源方案由下节取代。

- P1 请求夹具前置非法：原 10 份请求夹具组件 action 均含协议不允许的外层 `name`、全部缺 `root`、无输入正例缺必需 `context`。已修复为合法基线（action 仅 `event`、补 root Column、`context: {}`），非法夹具只保留单一目标偏差；新增临时脚本逐条跑现有 `validateProtocolMessage`/`validateNexusProfileMessage` 与 action 解析入口，21 份夹具全部通过（脚本已删除，证据为本轮退出码 0）。
- P1 绑定双源：绑定能力收归 schema 节点 `dynamic` 唯一权威（缺省即 forbidden）；v2 字段策略改为 `CatalogFieldPolicyV2`（仅 origin/componentRef），`fields.binding` 按未知键注册拒绝并新增 `catalog-reject-legacy-fields-binding` 反例；SPEC §4.1 补缺省语义与单源声明，正向 Catalog 已去除全部 fields.binding。
- P1 路径冲突遗漏祖先/后代：准入冲突规则扩展为「同批 inputs 解析路径互为祖先/后代（按 JSON Pointer 段比较）亦拒绝」，写入与数组顺序无关；白名单允许嵌套重叠、冲突只在同批判定；新增 `request-reject-path-ancestor-conflict` 与 `request-reject-path-descendant-first` 两种顺序反例。
- P2 基线响应契约：新增 server 公开类型 `SurfaceStateBaseline`；SPEC §5.1 锁定 S2 单一基线来源为 `GET /api/a2ui/surface-state`（宿主准入沿用 `runsAccess`，未配置 403），明确响应字段、404、准入时快照一致性、竞态下 revision 拒绝重查，action SSE 响应 S2 不加字段，S3 起 start/done 承载同一组字段。
- fixture 终态计数：正常 Catalog 2、非法注册 7（新增 legacy-fields-binding）、正常请求 2、非法请求 10（新增祖先/后代两份）。
- 门禁复跑（Node v24.16.0）：根 `pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm test` 退出 0，测试计数与 S1 基线一致（core 224 / React 50 / server 101 / playground-server 73 / playground 9 / standalone 21 + jsdom 1）；dist 根入口加载、定向 Prettier、21 个文档本地链接、`git diff --check` 均通过。

## S2.1 提交基准关联修复（2026-10-16）

复审发现：浏览器渲染 revision 1 后，另一运行在查询前提交 revision 2；旧方案返回最新 2，会使旧视图通过版本比较。用户已授权修正契约，本节取代首次修复中的最新快照查询与仅重查元数据后再次提交方案。

- 固定结果：core 新增公开类型 `NexusSurfaceCommit`，server `SurfaceStateBaseline` 复用该类型；必须包含 sessionVersion/runId，查询必须同时指定 surfaceId/runId，返回提交边界保存的历史固定值，结果不可用不回退最新快照。响应头关联、错误码、提交前后可见性与浏览器门控已入 SPEC §5.1 / DESIGN D8 / ARCHITECTURE §5.2，需求补充在 PRD R5。
- 反例：新增 baseline 时序夹具两份，分别在查询前、查询后提交其他 action；两种情况下本地 run-rendered 的基准固定为 1，而 action 时服务端版本为 2。总计 23 份 JSON（Catalog 9、请求 12、baseline 2）。新增 server 契约夹具测试使用实际状态存储和协议/Profile 校验验证时序与 oracle，不冒充尚未实现的 HTTP 查询或权威准入验证。
- 实施边界：本轮不实现路由、留存、响应头、客户端门控或 S3 生命周期；S2.5 已补这些接线与拒绝反例的完成判据。
- 验证（Node v24.16.0）：新增 server 时序夹具测试 2 项通过；根 build/typecheck/lint、core/server lint 与根 test 均退出 0，core 224 / React 50 / server 103 / playground-server 73 / playground 9 / standalone 21 + jsdom 1，共 481 项。根测试首次因沙箱禁止 tsx IPC 管道返回 EPERM，获准后沙箱外重跑通过；core 已构建后再测 React。变更文件定向格式检查、29 个本地文档链接、dist 公开类型导出/别名与三包原生 ESM 加载、git diff --check 均通过。自检未发现本次修复新增 P0/P1；未执行浏览器、仓外安装或远端 CI。

## S2.5.1/2.5.2/2.5.5 首轮并行实施验证（2026-10-19/20，契约结论已由评审修复取代）

本节保留首轮历史记录。随后评审确认结果校验、实际执行声明绑定、非 HTTP 记录所有权、onboarding 校验与初始化清理仍有缺口，当前实现及证据以下节为准。

范围为 S2.5 三个并行切片：统一运行标识与版本边界（.1）、有界固定提交结果留存（.2）、发布内容与执行契约一致（.5）。按「并行调度决定」分两批 agent 实施（.1 先行为关键路径，.2‖.5 文件所有权不相交并行），主线程统一维护本文件与根门禁。实际提交哈希：`23f1a9c`（2026-10-20，与下节评审修复同提交）。

- **S2.5.1 统一运行标识**：adapter 在 `prepareGeneration`/`prepareAction` 内各分配一次 `randomUUID()`；`AgentRun` 新增必填 `runId`，`commit` 类型收窄为必返固定 `NexusSurfaceCommit`（void/null 运行时兜底拒绝——流转 `error` 终态、记录转 `failed`，不伪造成功提交）；发送层不再以 idPrefix 改写 `commit.runId`（旧四参签名保留为 @deprecated 槽位、字符串实参被忽略，删除归 S2.6.5）；SSE event id 根、done 载荷与运行记录 id 同值；缺失/空 runId 在占用 SSE 响应之前同步抛错。版本边界写入 SPEC §5.1/§8：Catalog Contract 保持 2、session 保持 1、onboarding 保持 1、RPC 保持 1，包版本不动。
- **S2.5.2 结果留存**：发送层 beforeDone 在提交边界成功返回后调 `manager.recordCommit(runId, commit)`，代码顺序保证先于成功 done 可读（recordCommit 抛错则 error 帧收场，不发布成功 done，已提交快照不回滚）；`manager.create` 移到响应占用之前，拒绝路径无响应/锁/消息源泄漏（action 运行经 dispose 走 abortRun）；记录写入与 `get`/`listBySurface` 读取均深拷贝，终态迁移保留已留存 commit 不被覆盖；重复 create/recordCommit、终态补记显式拒绝；容量满按插入序优先淘汰终态记录，queued/running 受保护，全部活动时显式拒绝新建。非 HTTP 消费的固定结果即 `run.commit()` 返回值、不进入 manager（发送层为记录唯一所有者）；HTTP/非 HTTP 同源由构造保证（同出 adapter 提交边界 `commitResult`），该口径列为 S2.5.7/SDK review 复核项。SPEC §5.1 追加留存语义。
- **S2.5.5 发布一致性**：路由装配期 `buildPublishedCatalogContract` 先 `structuredClone` 再过 core 注册闸门，hash/prompt/发布 catalog 全部基于同一副本；`executionRegistry` 为可选装配项，传入时核对「已发布 ⇔ 已注册且 hash 一致」（未发布项 404），缺省仍强制复制+闸门校验，registry 核对随 S2.6.1 参考装配收口；onboarding 装配期校验入参契约（kind/version/hash 格式/hash↔内容一致）并内嵌独立 clone；discovery client 逐项严格校验（契约版本、完整 `sha256:<64hex>` 格式、组件/action 非空字符串数组无重复、URL 非空），任一非法整体拒绝。版本决定全部不升版，依据写入 SPEC §8。
- **证伪与迁移**：.1 新测试实现前 9 红→10 绿；.2 新增 12 项，其范围实现前 11 红/3 绿→实现 14/14 绿；.5 新增 21 项（4 个测试文件）+2 个既有测试成组迁移，实现前 12 红→全绿；legacy 消费方迁移共 5 个文件（agent-adapter/run-manager/sse-response-claim/catalog-discovery-client/onboarding-verification），verifier 敌意宿主反例（原始 JSON 下发过期 hash）原样保留。
- **根门禁（Node v24.16.0，主线程执行）**：根 `pnpm build`、`pnpm typecheck`、`pnpm lint`、根 `pnpm test` 均退出 0；测试 core 306 / React 51 / server 229 / playground 16 / standalone 21 + jsdom 1 / playground-server 73，共 697 项；根 build 先于 React/消费方测试产物。触碰文件定向 Prettier 全绿（5 个测试文件差异已修复）、`git diff --check` 通过。未执行仓外安装、真实浏览器、远端 CI；按 run 查询路由、`X-Nexus-Run-Id` 响应头、RPC/verifier 贯通与并发关联复核归 S2.5.3/.4/.6/.7。

## S2.5.3/2.5.4 实施验证（2026-10-20，提交组 2）

范围为 S2.5 第三波并行切片：按 run 查询与访问控制（.3）、响应头与传输关联（.4）。实际提交：`80b70f8`。文件所有权不相交（.3：surface-state/routes/run-manager + SPEC §5.1；.4：send-messages/transport-sse/两参考服务 CORS + 新增 SPEC §5.3），主线程完成公开导出收尾与状态句同步。实际提交哈希只在提交成功后回填。

- **S2.5.3 查询路由**：`GET /api/a2ui/surface-state?surfaceId=&runId=` 落地于 `surface-state.ts`（原类型别名），routes.ts 装配注入已核对的 `adapter.runManager` 与宿主 `runsAccess`（沿用「router manager ≠ adapter manager 即装配失败」）。判定顺序：缺参 400（先于准入，未配置 runsAccess 时缺参仍 400）→ `runsAccess` 未配置/拒绝 403（先鉴权后查记录，spy 证明拒绝路径零查询，不泄露记录存在性）→ 记录不存在/跨 surface/已淘汰同一 404（不泄露区分，淘汰即明确不可用）→ `commit` 缺失 409（统一覆盖排队/执行中与失败/取消终态）→ 200 返回该运行固定 `NexusSurfaceCommit`（无包装）。查询路径只读 runManager、不持有 actionStateStore，结构上不存在回退最新快照；「淘汰 A 后同 surface 新增可查询 commit 作对照，再查 A 得 404」反例固化历史结果不受后续提交/淘汰影响。
- **baseline 夹具升级真实入口**：两份时序夹具（并发 B 提交在查询前/查询后 action 前）经真实 HTTP 驱动——查询 A 恒返 A 的固定旧 revision，旧 revision 的下一枚 action 被 400 拒、handler 零调用、快照保持服务端 revision。
- **S2.5.4 响应头**：`transport/sse.ts` 新增 `NEXUS_RUN_ID_HEADER` 常量与 `prepareSseResponse(ctx, options?)`，头在 `flushHeaders` 之前、`ctx.respond=false` 同步占用点写入；空/非字符串 runId 在任何头写入前显式报错；排队 run 响应被占用瞬间即带头（真实 HTTP 断言：第二请求 fetch 解析时头已在且源未启动）；客户端断开取消后同 surface 后续 run 获新标识，旧运行保持 canceled；`sendMessages` 原始路径永不带头（verifier 的「非 SDK 运行」负向信号）。两参考服务 CORS `exposeHeaders` 在宿主现有暴露集上合并该头，不接管授权策略。主线程将 `NEXUS_RUN_ID_HEADER` 提升为根入口公开导出并更新 public-api 快照与取值断言。
- **文档**：SPEC §5.1 查询 bullet 标注实施口径、新增 §5.3「传输关联与响应头」；主线程同步 §2/§4/§5.1 状态句。
- **证伪**：.3 新增 12 项，实现前 12 红（路由缺失全 404）→ 实现后 12 绿；.4 新增 9 项，实现前 8 红 → 9/9 绿（复跑 3 次稳定，期间修复两个测试自身的挂起/时序缺陷，与实现无关）。
- **组 2 根门禁（Node v24.16.0，主线程执行）**：根 `pnpm build`、`pnpm typecheck`、`pnpm lint`、根 `pnpm test` 均退出 0；测试 core 306 / React 51 / server 268 / playground 16 / standalone 21 + jsdom 1 / playground-server 73，共 736 项。触碰文件定向 Prettier 全绿、`git diff --check` 通过。未执行仓外安装、真实浏览器、远端 CI；verifier/RPC（.6）与并发关联复核（.7：非 HTTP/HTTP 同源、重复标识、旧 envelope 混入、查询-淘汰窗口交错）归提交组 3。

## S2.5.6/2.5.7 实施验证（2026-10-20，提交组 3）

范围为 S2.5 收口两切片：RPC 与 verifier 贯通（.6）、入口与并发关联复核（.7）。主线程硬收敛令下分别 39/24 分钟交付；实际提交哈希只在提交成功后回填。

- **S2.5.6 verifier 贯通**：verifier 解析成功 done 帧载荷（`parseSseRun` 捕获 commit 与全部 event id），经 `parseSurfaceCommit` 校验并核对 runId/surfaceId/catalogId 身份与 event id 前缀一致性，action 基准只取 `generationCommit.surfaceRevision/catalogHash`，**`describeSurfaceContract` 调用整体删除**，报告新增 `generationCommit`/`actionCommit`（跳过时 null）。skipped 以声明为准：展示型 `actions:[]` 跳过 action 阶段并给原因，声明了 action 但生成流无可验收组件仍硬失败。RPC 序列化以真实捕获请求体断言：`inputs` 原样、`context`=服务端重算值（客户端伪造值被覆盖）、`actionId/sessionVersion/surfaceRevision/catalogHash` 与 done 固定结果同值、无输入 action 显式 `inputs:[]`。onboarding-verification 增加报告 checks ≡ 契约 verification.checks（id+顺序）一致性闸门；`external-agent.ts` 零改动（handler 本就序列化完整权威 action，测试钉死）。
- **S2.5.7 复核反例（8 项，全部真实 HTTP，未发现 src 缺陷）**：非 HTTP/HTTP 同源对照——非 HTTP run 经 run-lifecycle 纳入同一 manager 实证（runId 出现于 createdIds），非 HTTP commit 返回值 ≡ 真实查询 200，源 EOF 未显式提交查询 409、显式 commit 后 200；查询-容量淘汰窗口交错以观察窗口 manager 确定性构造——evict-after-get 返回被查运行自身旧 revision（非同 surface 更新的新 revision）、evict-before-get 404，证伪锚点为「若查询回退最新快照则断言失败」；`X-Nexus-Run-Id ≡ event id 前缀 ≡ done.runId ≡ 查询 200` 全链等式补齐查询路由一环，失败流（error 无 done）查询 409、对账基准不存在、报告无虚构材料；事件 id 全值作查询键 404、裸 runId 200（消费者不得解析事件 id）；旧 revision 与错 catalogHash 的 action 经真实入口 400、handler 零调用、先前固定结果 deep-equal 不变。
- **onboarding 声明备忘裁定（.6 移交，.7 裁定）**：`action.requiredFields` 不列 `actionId/sessionVersion/surfaceRevision/catalogHash` 为现状正确、不升版——四字段是宿主侧准入与对账元数据（解释权威在宿主准入层，不委派远端 Agent），requiredFields 枚举外部 Agent 必须消费的输入；运行时强制不依赖该声明（adapter 类型必填 + 共享准入拒绝 + .6 序列化断言）。若未来把 requiredFields 重定位为完整 wire-shape 声明，属消费者可见契约变更，须按版本规则先改 SPEC 并升 `AGENT_ONBOARDING_CONTRACT_VERSION`。
- **证伪与组 3 门禁（Node v24.16.0，主线程执行，非沙箱授权）**：.6 新增 4 项实现前 3 红 → 4/4 绿；.7 新增 8 项零回归（前 272/272 → 后 280/280）。根 `pnpm build`、`pnpm typecheck`、`pnpm lint`、根 `pnpm test` 均退出 0；测试 core 306 / React 51 / server 280 / playground 16 / standalone 21 + jsdom 1 / playground-server 73，共 748 项；触碰文件 Prettier 全绿、`git diff --check` 通过。未执行仓外安装、真实浏览器、远端 CI。
- **S2.5 收口边界**：七项全部完成；消费方完整关联门控（响应头/done/查询与视图一致性在浏览器侧的装配）与 verifier 端到端验收归 S2.6.3；运行调度/队列/完整 commitState 归 S3，Session v1 归 S3/S4。不据 S2.5 完成宣称 S2.6 或 Session v1 完成。

状态变化同步本文件与 README；契约/结构/决策/需求分别同步 SPEC/ARCHITECTURE/DESIGN/PRD，返工经验写回根 AGENTS.md。


## S2.5.1/.2/.5 评审修复（2026-10-20，历史切片记录）

用户授权修复首轮评审的 2 P1 + 3 P2，范围仍为 .1/.2/.5，未开始 .3/.4/.6/.7。

- 提交身份：运行边界校验完整 NexusSurfaceCommit 与准备时捕获的 runId/surfaceId/catalogId/catalogHash，空对象和合法但错配的结果均拒绝，不留存、不发成功 done。manager 写入口同时核对结构及记录 ID/surface。
- 实际执行契约：删除新引入的可选 executionRegistry 装配项，发布强制读取真实 adapter 的声明并核对 hash；每个 Catalog 首次发布/执行固定副本，后续外部 registry 修改不改变该 adapter。更新声明需重建 adapter 及发布。
- 留存所有权：新增内部传输无关 run lifecycle；adapter 持有默认隔离或注入的 runManager，HTTP 与非 HTTP generation/action 共用。router/sender 显式 manager 与 adapter 不一致即拒绝。首次消费 source/commit 建立记录，HTTP 预留发生在响应占用前；正常 EOF 仍需显式终结。
- 完整装配验证：onboarding 复制输入后校验 serverApiVersion、完整 Catalog 注册规则、hash 与声明、prompt 与标准生成器输出一致性。
- 失败清理：容量拒绝及响应占用异常均清理运行与宿主 dispose；占用失败的记录转 failed，可被容量回收；body 已分配后 flushHeaders 抛错也撤销流与 respond 占用。工厂/handler 延迟至消费且预留成功后调用，失败进入运行终态；prepare 的准入拒绝保留流前语义。
- 证伪：修复前新增 14 个行为反例均失败，修复后全部通过；另补 manager 直接写入口身份/结构反例、body 占用后 flushHeaders 失败清理、sender/router 拒绝不同记录所有者用例。准入用例使用实际 partial patch，handler 调用断言置于函数体入口，避免生成器惰性掩盖提前调用。
- 消费契约迁移：SDK 及参考测试复用 adapter 的 manager；Workbench/任务 handler 异常断言改在 source 消费或 SSE error，无业务实现改动。SPEC/ARCHITECTURE/DESIGN、server README 与根 SOP 同步；PRD 无需求变化。
- 最终门禁（Node v24.16.0）：根 `pnpm build`、`pnpm typecheck`、`pnpm lint`、递归各包 lint 与根 `pnpm test` 均退出 0；core 306（含 conformance，基线不变）/ React 51 / server 247 / playground 16 / playground-server 73 / standalone 21 + jsdom 1，共 715 项。core 已构建后再运行 React/消费方；HTTP/tsx IPC 测试按已获准的沙箱外入口执行。
- 产物与文档：三包 dist 公开根入口原生 ESM 加载通过；经 dist server 公开入口实际生成、非 HTTP commit 与 adapter 结果留存一致。变更 TS 定向 Prettier、29 个本地文档链接、`git diff --check` 通过；Markdown 按仓库配置不纳入 Prettier。按 SDK review 四项清单复核修复调用链，无新增 actionable finding。
- 未执行仓外安装、真实浏览器、远端 CI；本轮未提交或推送。按用户指定 .1+.2+.5 / .3+.4 / .6+.7 分组，后两组及 S2.6/S2.7 仍待实施。


## S2.5 整体评审修复（2026-10-20）

用户授权修复整体评审的 1 P1 + 3 P2，保留已有 S2.5.3/.4/.6/.7 实施，未推进 S2.6/S2.7。

- 流消费：verifier 改为消费实际响应目的流，等待 finish 后解析，按 UTF-8 流解码并在 finally 清理 body/response；删除仅监听 body.data 的旁路采集，避免 unread res 超过缓冲阈值后截断。真实 HTTP 回归使用 13 条合法消息（含大段中文与 emoji），覆盖大于缓冲阈值的输出及最终 done。
- 契约单源：抽取内部 catalog-contract-validation，由 onboarding 发布与消费共用版本、hash 格式/一致性、完整 Catalog 注册闸门和标准 prompt 校验；消费端在 Agent 调用前拒绝非法内嵌版本、错误/缺失 prompt 与 hash 正确但非法 Catalog。未新增公开根入口或契约版本。
- 报告权威：actionContext 从实际 RPC handler 入口深拷贝，记录 inputs 准入和参数重算后的值；输入前客户端 context 仅用于请求。回归对照旧模型 score=3、输入/RPC/report score=4，展示型及无参数 action 的既有语义继续回归。
- 文档：ARCHITECTURE/DESIGN 删除现状段落中 S2.5 查询/响应头/verifier 仍待实施的过期描述；server README 补查询状态码、响应头、envelope 和固定 done，SPEC 与根 README/本文件同步，根 SOP 记录教训。PRD 无需求变化。保留日期明确的历史切片证据，完整关联门控归 S2.6.3，完整调度/背压/commitState 归 S3，Session 归 S3/S4。
- 证伪：修复前 5 个行为断言失败（大流缺 done、report 仍为 3、消费端接受内嵌非法版本及错误/缺失 prompt）；修复后定向 20 项通过，随后补入消费端非法 Catalog 拒绝反例，根测试全绿。
- 最终门禁（Node v24.16.0）：根 `pnpm build`、`pnpm typecheck`、`pnpm lint`、server 包 `pnpm -C packages/nexus-server lint`、根 `pnpm test` 均退出 0；core 306 / React 51 / server 285 / playground 16 / playground-server 73 / standalone 21 + jsdom 1，共 753 项。core 构建先于 React/消费方测试；HTTP/tsx IPC 测试使用获准的沙箱外入口。首次 build 的 unknown 类型收窄错误修正后重跑通过。
- 产物与复核：三包 dist 公开根入口原生 ESM 加载通过；仅消费公开 dist API 的复现脚本证实大流 13 条消息和 done 完整、report/RPC 均为 score=4、非法内嵌版本在 Agent 调用前拒绝。全部变更 TS 定向 Prettier、29 个本地文档链接、`git diff --check` 通过。按 SDK review 四维清单复核，无新增 actionable finding；删除了旁路流采集与重复宽松校验，后续阶段按原计划推进。
- 未执行仓外干净安装、真实浏览器或远端 CI；本次修复未提交、未推送。


## S2.5 推送与 S2.6 任务细分（2026-10-20）

- 已确认并完成提交：`80b70f8`（S2.5.3/.4 查询及响应头）、`c42dffe`（S2.5.6/.7 与整体评审修复），已推送至 `origin/feature`；推送首次 TLS 连接失败，重试成功，核对本地/远端跟踪引用无差异。
- 用户随后要求 S2.6 先拆分、暂不实施：本轮结合实际代码细化 5 单元/16 任务及四组建议提交，更新 CURRENT 与 README；未修改运行代码、测试、包版本或对外契约。S2.6/S2.7 仍未开始运行代码改造。

本轮文档验证：16 个执行任务 ID 唯一，14 个本地文档链接目标存在，`git diff --check` 通过；仅文档改动，未重跑代码门禁。上述 S2.6 计划尚未提交或推送。

## S2.6.1 实施验证（2026-10-20，组 A）

范围为 S2.6.1 参考服务真实装配三项：实际入口发布、可信可编辑路径、Basic fallback 确定性表单。改动仅涉及两个示例装配与测试，SDK 三包源码零改动。实际提交哈希只在提交成功后回填。

- **S2.6.1.1 实际入口发布**：`main.ts` 装配 `catalogContracts: listReferencePublishedCatalogs(agentAdapter)`；发布列表经 `describeCatalog` 取自 adapter 固定执行声明（三个演示 Catalog），router 装配期再次与执行声明核对 hash，不一致即启动失败；Policy、history 与环境装配保持不变。实际入口 `published-catalogs`/`catalog-contract`/`agent-onboarding` 与生成 done 的 Catalog/hash 一致经真实 HTTP 验证。
- **S2.6.1.2 可信可编辑路径**：reference 工厂内置 `ReferenceSurfaceCatalogIndex`（容量 512、插入序淘汰、生成提交边界刷新，SDK 快照淘汰不主动失效——缺快照即拒绝，旧条目不放大权限）与 Catalog 级精确白名单：Basic `/name`、`/subscribed`；Task `[]`（无输入组件，`inputs:[]` 的 action 不受影响）；Workbench `/taskTitle`、`/priority`、`/reminderAt`；customer 身份/ID、状态等只读字段不开放。未知 surface 返回空数组，非空输入走 SDK 缺省拒绝（fail-closed）；跨 Catalog 重生成的瞬时窗口两组路径互不相交，只会过度拒绝。宿主可经 `options.editablePaths` 显式收窄（反例证明缺省白名单是输入准入生效要件）。两个服务 CORS 改为消费公开常量 `NEXUS_RUN_ID_HEADER`（替换字符串字面量），跨源暴露回归通过。
- **S2.6.1.3 Basic fallback 表单**：新增 `createContactFormFixture`（形状对齐参考 LLM prompt 表单契约：root Column children `["name","subscribed","submitButton","submitResult"]`，model `{name,subscribed,result}`）；fallback 触发器复用演示 Policy 的 `isFormRequest`（`/表单|form|订阅|subscribe/i`）——修复前表单意图消息会因 workflow 契约被 `POLICY_REJECTED`，修复后生成合法可编辑表单。复用既有 `submit` handler：最新输入经 HTTP envelope 服务端权威准入后重算参数到达 handler 并 patch 原 surface（首闭环；连续交互归 S2.6.4）。联系人/Task/Workbench 既有路径回归通过。
- **证伪**：新增 15 项测试（playground-server 14、standalone 1）实现前 9 项行为失败——发布列表为空/契约 404、表单意图消息被 Policy 拒、workbench 与 Basic 输入因白名单未装配被拒；实现后全绿。错误类型输入经真实 HTTP 400 且无 done、handler 不产生提交。
- **门禁（Node v24.16.0）**：根 `pnpm build`、`pnpm typecheck`、`pnpm lint`、根 `pnpm test` 均退出 0；测试 core 306（含 conformance，基线未动）/ React 51 / server 285 / playground 16 / standalone 22 + jsdom 1 / playground-server 87，共 768 项。触碰文件定向 Prettier 全绿、`git diff --check` 通过。
- **未执行**：仓外安装、真实浏览器、远端 CI。本交付仅覆盖服务端装配与 HTTP 首闭环；浏览器契约校验/运行关联归 S2.6.3，草稿确认与连续交互归 S2.6.4。

## S2.6 组 B–D 实施验证（2026-10-20）

范围为 S2.6.2–S2.6.5 共 13 项（组 A 见上节）。SDK 侧改动：core 新增草稿发送快照/确认原语与契约 hash 规范化公开导出；server 删除 `sendAgentRun` 旧 idPrefix 四参槽位并迁移全部调用方、catalog-contract 改用 core 规范化（hash 值不变）。其余改动都在两个参考消费方。实际提交哈希只在提交成功后回填。

- **S2.6.2 中立 scorecard 夹具**：`shared/scorecard-contract.ts` 定义 `FeedbackSummary`（展示）、`ScoreDial`（整数输入，非 `value` 属性 `score`，0–100）、`PinnedToggle`（布尔输入）、`SubmitCard`（非 Button 触发器，`action.required`）与 `record` action（paramSchema 整数+布尔）。注册闸门负例：minimum>maximum、inputs 键未声明、inputs 携带 dynamic、sources 越权全部拒绝；声明值域拒绝 101/3.5/字符串。`host/scorecard.ts` 提供确定性生成源与本地 handler（无状态、支持连续 patch、只写 `/note` 不回显整表）；`host/adapter.ts` 按 catalogId 分发（审批仍走外部 RPC），注册 scorecard handler，surface→Catalog 映射驱动 `editablePaths`（审批 `[]`、反馈 `/score`、`/pinned`，未记录即空数组 fail-closed）；`host/app.ts` 发布两个 Catalog。浏览器 `scorecardHostRenderMap` 控件只上报 componentId/surfaceId/property/value，`SubmitCard` 只调公开 `triggerAction`；`DemoControls` 增加双场景按钮。原审批 external/local 模式、discovery、onboarding 契约测试全部回归通过。
- **S2.6.4.1 语义定稿与 core 原语**：SPEC §4.3 / DESIGN D8 定稿——按「逐条草稿代次」确认，否决值相等对比（会误删改回同值的新编辑）与整 surface 计数器（部分编辑拖住全部草稿导致旧值重发）。core 新增 `extractLatestInputDrafts`（wire 输入 + 逐条 serial）与 `confirmInputDrafts`（surfaceId 匹配且 serial 仍相等才删除；runtimeId 隔离跨实例；幂等），与既有失效清理同源。core 新增 7 项测试覆盖改回同值、部分确认、双 surface、改绑不复活、跨实例 no-op、幂等、失败不确认；`getLatestInputs` 保留为兼容读取。core 公开 `getCatalogContractHashInput`/`isCatalogContractHash`/`CATALOG_CONTRACT_HASH_PATTERN`（`CATALOG_CONTRACT_VERSION` 移至同模块、barrel 转发），server `createCatalogContractHash` 改用同一规范化，hash 值不变（server 全量回归证实）。
- **S2.6.3.1/.3.2 浏览器契约与运行关联**：standalone `browser/catalog-loader.ts` 与 playground `catalog/registry.ts` 在挂载前核对契约版本、Catalog 身份（请求↔响应）、hash 格式、Web Crypto 复算 hash↔内容、标准 prompt 与注册闸门，任一非法整体失败不挂载；取消/晚到加载不替换当前契约。两浏览器 `consumeRun` 以 `X-Nexus-Run-Id` 响应头为权威 runId（event id 只作帧信息，不再解析其格式），成功 done 须与响应头同 runId 且 catalog/hash 与本次加载契约一致；缺头、错 runId、错 hash、无 done、重复终态、终态后消息、本地拒绝均不产生基准。standalone `sse.ts` 增加 `onResponse` 与异常路径 reader 取消；playground `sse-client` 原有取消保留。
- **S2.6.3.3 请求代次**：两浏览器引入 epoch：重新生成/切换 Catalog/取消/卸载使旧运行失效并 abort（在途重复 action 忽略，2026-10-21 修正）；晚到的 resolve 不写回视图、基准或 busy；动作出口无合格基准时不发请求。UI 级覆盖卸载与缺基准路径，2026-10-21 补齐 A 晚于 B、abort 后返回、生成与 action 卸载等 S2.6 反例；完整 Session 交错归 S4 client。
- **S2.6.3.4 基准语义与 verifier**：headless 真实查询路由验证——按 run 查询返回该运行固定旧 revision，用查询结果当基准提交被 400（查询不是视图恢复），未知 runId 404 不能形成基准，正常基准来自本次成功 done；server verifier 夹具扩展布尔输入，整数（非 value）+ 布尔 + 非 Button 来源 + 展示型 skipped 一并回归（9/9 绿）。
- **S2.6.4.2/.4.3 连续交互与拒绝/隔离对测**：两组 Catalog 各以「真实 HTTP 装配 + core runtime headless」跑完整链路——本地编辑 → HTTP envelope（inputs 取发送快照）→ 服务端权威准入 → handler patch → 确认草稿 → 第二次提交 `inputs:[]`（不重发已确认旧草稿，参数由服务端模型重算且伪造 context 被覆盖）→ 再编辑只随新草稿发出；覆盖字符串/布尔/整数与非 value 属性、partial patch。拒绝不变式：旧 revision、错 hash、未声明属性、越界整数均 400 且流中无 handler patch（handler 零调用）；失败不确认、草稿保留、快照未变故原基准可继续提交。双 surface：A 的草稿/确认/基准/patch 不影响 B 的草稿、模型与基准。
- **S2.6.5.1/.5.2 接入文档与旧路径删除**：server README 新增「最小接入样例」（Catalog + renderMap + handler + 白名单；纯本地 core / HTTP / RPC 三种入口；查询不是视图恢复、done 不表示业务事务成功）；两示例 README、SPEC §2/§4.3、ARCHITECTURE、DESIGN D8 同步现状。`sendAgentRun` 三参化：删除四参兼容重载，迁移 src（routes ×2）与 server/playground-server/standalone 全部测试调用点，legacy 槽位专测改写；示例 handler 的参数猜测链（`context.keyword ?? context.query ?? context.value` 等）改为声明键直读；`describeSurfaceContract` 仅存诊断用途，无补基准消费方。整表合并与深路径消费扫描无残留。
- **证伪说明**：组 B/C 浏览器与 loader 测试在实现前以旧契约断言失败（发布单 Catalog、无响应头校验、草稿重发）；core 草稿测试与实现同步落地，其证伪力在于断言会击穿朴素实现（值相等删除、整 surface 计数、跨实例互删均有专门反例）。
- **首轮自评（2026-10-20，已被 2026-10-21 独立评审纠正）**：当时记录无 P0/P1，后续独立复审发现五项 P1，整改见下一节。P3 备忘：`getLatestInputs` 与 `extractLatestInputDrafts` 并存，S4 client 落地时收敛读取入口；两浏览器 `consumeRun` 副本留待 S4 统一（计划内）；浏览器在 action 被拒后即弃基准属保守选择（服务端快照未变、headless 已证原基准可用），可在 S4 评估恢复重试；standalone loader 对每个 Catalog 各拉一次 discovery，属示例内小冗余。
- **最终门禁（Node v24.16.0）**：根 `pnpm build`、`pnpm typecheck`、`pnpm lint`、根 `pnpm test` 均退出 0；测试 core 313（含 conformance，基线未动）/ React 51 / server 285 / playground 26 / standalone 42 + jsdom 5 / playground-server 91，共 813 项。触碰的 45 个 TS 文件定向 Prettier 全绿；`git diff --check` 通过；8 份文档 30 个本地链接目标存在。
- **未执行**：仓外安装、真实浏览器、远端 CI。S2.6 完成不宣称 S2 全阶段完成——独立复核与阶段验收归 S2.7。


## S2.6 独立评审五项修复（2026-10-21）

用户授权修复本节五项 P1，并确认将全部 S2.6 交付与本节修复合并提交至 `feature`；保留 S2.7 独立阶段验收。提交记录以 Git 历史为准。

1. **运行失效与传输清理**：两个消费方在响应、每条消息、done 和流结束前检查当前 epoch 与 signal；取消、切换 Catalog、卸载立即失效。SSE 对等待中的 reader 主动 cancel，晚到 fetch、同一 chunk 的后续 frame、尾帧处理异常均不再写旧视图，finally 释放 reader/listener。standalone 增加显式取消入口。
2. **重复 action**：将卸载清理提升为组件级所有者；pendingAction 变化不再清理原运行。在途重复点击直接忽略，原运行可完成并释放 busy，不排队或自动重放 action。
3. **可见草稿与确认**：修正 SPEC §4.3 / DESIGN D8；成功接受结果后，core `confirmInputDrafts(snapshot): boolean` 仅确认 serial 未变的发送项，将剩余有效新草稿原子恢复到本地编辑模型、serial 不变。已确认字段保留 handler 归一化结果；新编辑可见且与下次 inputs 一致，不改服务端提交/revision。恢复失败 false、不做部分写回/确认，两个消费方不开放新基准。真正挂起请求覆盖字符串/整数新编辑及改回同值；修正原先把「请求完成后编辑」误标为「期间编辑」的测试。
4. **生成视图关联**：生成必须消费本次新建的 surface、root 和请求 Catalog；done-only 响应、借用已有 surface、响应换成另一个已加载 Catalog 均拒绝。action 固定 surface/session/catalog/contract/hash 且 revision 必须前进，允许无 patch 的合法成功 action。测试夹具改为独立运行标识及递增 revision，不再重复使用 revision=1 掩盖校验缺口。
5. **hash 与 JSON 传输**：core 先以 JSON 传输形状规范化 Catalog，再稳定排序计算摘要输入，合法可选 undefined 与省略字段等价；纯 JSON 的既有摘要不变。公开 hash 输入、Node server 摘要与浏览器 Web Crypto 共用规则，真实 HTTP 发布内容、hash、执行声明与 prompt 一致性有回归测试。

**证伪与验证**：修复前 Playground 三项、standalone 重复 action、core JSON 往返及草稿恢复反例均真实失败；修复后本轮 Node v24.16.0 根 `pnpm build`、`pnpm typecheck`、根/包 lint、根 `pnpm test` 均退出 0；core 319 / React 51 / server 286 / playground 36 / standalone 42 + jsdom 11 / playground-server 91，共 836 项（较首轮 813 增加 23 项）。源码定向 Prettier 与 `git diff --check` 通过，本地文档链接目标已核对。未执行真实浏览器、仓外安装或远端 CI。


## S2.6 推送与 S2.7 任务细分（2026-10-21）

- S2.6 全部交付与独立复审五项修复已提交为 `5a5c5a1`（`feat: 完成 S2.6 消费方迁移与交互可靠性修复`），已推送至 `origin/feature`，当时核实远端与本地一致、工作区干净。
- 用户要求先拆分 S2.7：本轮核对现有测试入口、共享夹具、公开 API、dist 清单检查、conformance 与 CI 配置，将原五个交付单元细化为 16 项并定义验收报告、依赖、退出条件及 S3 交接边界。只更新 CURRENT/README，未启动运行代码改造或阶段验收。
- S2.6 的 836 项及 conformance 分类均为历史基线；S2.7 实测结果待执行。本轮文档检查结果另在交付说明记录，不将任务拆分标为阶段完成。
