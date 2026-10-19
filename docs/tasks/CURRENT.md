# CURRENT — 唯一任务与进度源

更新：2026-10-19。产品判据见 [PRD](../PRD.md)，契约见 [SPEC](../SPEC.md)，结构与取舍见 [ARCHITECTURE](../ARCHITECTURE.md)、[DESIGN](../DESIGN.md)。本文件维护唯一实施计划，不以目标设计替代交付证据。

## 当前结论

**产品方向已敲定：宿主约束的 Agent UI Runtime SDK。** SDK 提供协议、Catalog、绑定、渲染、运行与交互基建；业务 prompt、模型/工具编排、具体流程、业务权限与副作用由宿主负责。

当前只有 core/react/server 三包；目标新增 client。S1 已完成：core 安全反例（保留段、媒体 URL scheme、schema.pattern）先证伪后修复；Adapter/guard 显式装配（registry 必填、policy 无默认、LLM 生成源与 catalogId 必填，缺失即报错）；runs 查询宿主 `runsAccess` 准入（未配置一律 403）；参考服务与演示 Catalog/LLM/Policy 迁至 `examples/playground-server/`，只消费公开 SDK 入口。S3/S4 尚未实施（模块级 per-surface 队列按 S3 计划收编，client 待 S4 新建）。验证宿主与 Agent 尚未选定，不能将已有 demo 或 `examples/agent-demo/` 占位视为已选接入工程。SDK 通过可替换的确定性夹具和仓外契约验收验证，不评审接入方应用内部工程，也不等待其重建。

**当前任务：S2 Catalog v2、输入与 action，S2.1–S2.4 已完成，下一步为 S2.5 请求与发布接线。** S1 及独立评审修复（`b44b639`）、S2.1 契约锁定（`6c93780`）、S2.2 共享解释器（`71ab59a`）、S2.3 本地写回（`35778e2`）及其 playground 收尾（`734430c`）已提交并推送。S2 按下述 S2.1–S2.7 推进；契约已定型（SPEC §4/§5.1/§8、DESIGN D8、core/server 公开类型、`fixtures/catalog-v2/` 共享 fixture）。复审补齐按 runId 固定提交基准与两种并发时序反例，不能用最新 revision 给旧视图刷新资格；最小 HTTP envelope、成功 done 固定结果与两个浏览器门控已随 S2.4 复审修复提前接通；结果留存/按 run 查询、响应头、verifier/RPC 与完整发布核对仍由 S2.5 实施，完整 Session/SSE 生命周期仍由 S3/S4 完成。

补充决定（2026-10-16）：DESIGN D12 / SPEC §8.2 明确保留分包、以层内高层 API 简化接入，暂不新增总门面包。S3/S4 完善 server/session/视图组合，S5 验证公开入口环境隔离与跨包兼容；本次仅补充文档，不改变代码阶段状态。

## 阶段与依赖

| 阶段                     | 状态                 | 交付与依赖                                                               |
| ------------------------ | -------------------- | ------------------------------------------------------------------------ |
| S0 文档与评审范围基线    | 已完成（文档/skill） | PRD/SPEC/ARCHITECTURE/DESIGN、README、本计划与 SDK review skill 对齐     |
| S1 安全基线与业务中立    | 已完成（验收通过）   | 安全反例证伪修复；显式装配；参考程序迁出 playground-server；早期产物检查 |
| S2 Catalog v2 与交互扩展 | S2.1–S2.4 已完成    | 声明式展示/输入/action；共享准入、本地写回、服务端权威准入               |
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

1. 更新 action HTTP 解析器、公开 adapter 参数、外部 RPC 和 verifier，把相同的输入/revision/hash 信息传到共享准入；非 HTTP 调用也必须走权威规则。
2. 更新 Catalog contract/discovery/onboarding 与相关 hash 断言；输入能力、参数 schema 和版本都进入发布内容，prompt 不夸大实际支持范围。
3. 生成/action 响应提供 `X-Nexus-Run-Id`（跨源显式暴露），在提交边界保存固定的 `NexusSurfaceCommit`，先于成功 done 可见；`surface-state` 按 surfaceId/runId 查询该结果，执行 runsAccess，落实 400/403/404/409 语义与有界留存，不允许回退最新快照。S3 成功 done 复用同一类型，不往原始 A2UI message 塞入临时字段。
4. S2 先交付 action 请求 envelope 与准入所需元数据；S3 接续同一版本的 start/message/done/error、revision 发布与 commitState，S4 接续浏览器会话门控。不能因 S2 已有请求元数据就宣称 Session v1 已完整实现。
5. 两个消费方仅为同一成功且本地校验通过的运行视图附上基准，校验 session/run/surface/Catalog 关联，拒绝晚到响应；同一 surfaceId 的后续提交（含重新生成/重建）不能与旧基准重号。复用 baseline 时序 fixture 验证查询前后其他提交均使旧 action 被拒、handler 未调用、快照/revision 不变；补结果缺失/淘汰、查询失败、本地校验失败的门控反例。旧 revision 拒绝后须恢复视图，不能仅重查元数据再提交。

#### S2.6 — 消费方迁移

1. 迁移 playground-server 的联系人/任务/Workbench Catalog，保留其显式业务 Policy 与演示行为；SDK 不新增这些业务规则。
2. 更新 React 标准组件、两个浏览器 action 封装及独立宿主夹具，只消费公开入口；移除被共享机制取代的输入/参数拼装，不提前抽取 S4 SSE 状态机。
3. 补充最小接入与升级样例：仅注册 Catalog、renderMap、handler 和可编辑路径即可扩展；展示型无 action、只用本地 core 的路径也能使用严格契约。

### S2 验收矩阵与完成判据

- 正常：两个无关 Catalog；新增展示/自定义输入/自定义 action；非 `value` 属性；不同 schema 值类型；最新输入到达 handler；合法 patch 更新原 surface。
- 初始化拒绝：缺 actions/schema/能力、未知配置、矛盾能力、不支持的 schema/pattern、非法预算和原型危险键。
- 运行拒绝：未声明组件/action/字段、非可挂载来源、只读/越权路径、伪造目标路径、错误类型、重复/冲突输入、参数不合规、旧 revision、错误 hash 与 v1/v2 混用；handler 未执行，已提交快照和 revision 不变。
- 扩展点反例：自定义 resolver、生成源或 RPC 不能绕过共享准入；同一正常/非法 fixture 在 core 与 server 得到一致结果。真实业务授权仍由宿主实现。
- 代码门禁：Node 24，相关用例先失败后通过；core 构建后测 React；根 test/typecheck/lint、相关包 lint、build/build:packages、当前 dist/公开 API 检查；conformance 变化明确说明分类理由。新测试在包 test/ 下镜像 src/。
- SDK review 后同步 SPEC 的现状、ARCHITECTURE/DESIGN 的实现状态及 CURRENT/README。仓外干净安装、真实浏览器与完整 Session/调度仍分别按 S3–S5 验收，不借 S2 完成提前宣称。

执行顺序为 S2.1 → S2.2 → S2.3/S2.4 → S2.5 → S2.6 → S2.7；S2.3/S2.4 是依赖上可分别实施的模块，不表示授权并行 agent。每项完成须保持已有消费路径可运行，契约变更与消费方更新成组落地，不单独交付不可编译的类型变更。

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

状态变化同步本文件与 README；契约/结构/决策/需求分别同步 SPEC/ARCHITECTURE/DESIGN/PRD，返工经验写回根 AGENTS.md。
