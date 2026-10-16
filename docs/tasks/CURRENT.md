# CURRENT — 唯一任务与进度源

更新：2026-10-16。产品判据见 [PRD](../PRD.md)，契约见 [SPEC](../SPEC.md)，结构与取舍见 [ARCHITECTURE](../ARCHITECTURE.md)、[DESIGN](../DESIGN.md)。本文件维护唯一实施计划，不以目标设计替代交付证据。

## 当前结论

**产品方向已敲定：宿主约束的 Agent UI Runtime SDK。** SDK 提供协议、Catalog、绑定、渲染、运行与交互基建；业务 prompt、模型/工具编排、具体流程、业务权限与副作用由宿主负责。

当前只有 core/react/server 三包；目标新增 client。S1 已完成：core 安全反例（保留段、媒体 URL scheme、schema.pattern）先证伪后修复；Adapter/guard 显式装配（registry 必填、policy 无默认、LLM 生成源与 catalogId 必填，缺失即报错）；runs 查询宿主 `runsAccess` 准入（未配置一律 403）；参考服务与演示 Catalog/LLM/Policy 迁至 `examples/playground-server/`，只消费公开 SDK 入口。S3/S4 尚未实施（模块级 per-surface 队列按 S3 计划收编，client 待 S4 新建）。验证宿主与 Agent 尚未选定，不能将已有 demo 或 `examples/agent-demo/` 占位视为已选接入工程。SDK 通过可替换的确定性夹具和仓外契约验收验证，不评审接入方应用内部工程，也不等待其重建。

**当前任务：S2 Catalog v2、输入与 action，S2.1 契约锁定已完成，S2.2 起实施运行代码。** S1 及独立评审修复已提交并推送（`b44b639`）。S2 按下述 S2.1–S2.7 推进；契约已定型（SPEC §4/§5.1/§8、DESIGN D8、core/server 公开类型、`fixtures/catalog-v2/` 共享 fixture）。复审补齐按 runId 固定提交基准与两种并发时序反例，不能用最新 revision 给旧视图刷新资格；路由、结果留存与浏览器接线由 S2.5 实施，完整 Session/SSE 生命周期仍由 S3/S4 完成。

补充决定（2026-10-16）：DESIGN D12 / SPEC §8.2 明确保留分包、以层内高层 API 简化接入，暂不新增总门面包。S3/S4 完善 server/session/视图组合，S5 验证公开入口环境隔离与跨包兼容；本次仅补充文档，不改变代码阶段状态。

## 阶段与依赖

| 阶段                     | 状态                  | 交付与依赖                                                               |
| ------------------------ | --------------------- | ------------------------------------------------------------------------ |
| S0 文档与评审范围基线    | 已完成（文档/skill）  | PRD/SPEC/ARCHITECTURE/DESIGN、README、本计划与 SDK review skill 对齐     |
| S1 安全基线与业务中立    | 已完成（验收通过）    | 安全反例证伪修复；显式装配；参考程序迁出 playground-server；早期产物检查 |
| S2 Catalog v2 与交互扩展 | 实施中（S2.1 已完成） | 声明式展示/输入/action；共享准入与最新输入                               |
| S3 通用 server runtime   | 待实施，依赖 S2       | 单一调度、Session v1 与提交语义；Koa/RPC 薄适配                          |
| S4 client 与可嵌入 React | 待实施，依赖 S2/S3    | 新 client、Provider/Surface、两个浏览器消费方迁移                        |
| S5 独立契约验收与发行    | 待实施，依赖 S1–S4    | 当前产物仓外安装、公开 API/兼容、浏览器和 CI 门禁                        |

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

- `core/runtime.setInputValue` 按 TextField/CheckBox/ChoicePicker/DateTimeInput/Slider 名称与固定 `value` 属性判断，可写值类型同样写死。
- `core/protocol/validator` 同时包含结构校验、标准组件契约与 checks/action 名称限制；`catalog/schema` 已有受限 schema 与字段/action/checks policy，可复用，但注册闸门尚未覆盖全部非法/未知配置。
- server 默认 `resolveDeclaredActionContext` 只读取已提交模型，看不到浏览器本地编辑；自定义 `resolveActionContext` 目前接管整个参数解析并能跳过未声明字段检查。
- Catalog Contract 当前 v1；surface 快照已有内部 `version`，但未固定完整 Catalog version/hash；HTTP action 只解析 v0.9 action，两个浏览器消费方自行封装请求。
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

1. 在现有 surface 锁内读取快照，核对 action 来源、Catalog version/hash 与 surfaceRevision；可编辑白名单从可信装配取得。快照固定的契约不能随 registry 原地变更悄悄漂移。
2. 整批验证组件/绑定属性/值，再从已提交声明读取目标路径，构造临时输入模型。拒绝任意客户端路径、额外字段、重复/冲突输入和 schema 不符；中途失败不得留下局部写入。
3. 用临时模型解析服务端持有的 action.event 声明，校验 action 参数 schema 和来源能力，再交给 handler。客户端 context 不能覆盖只读参数或业务事实。
4. 调整 resolver 扩展点：共享准入必须先执行，扩展后的参数仍需校验，resolver 不得把被拒输入重新变为可执行 action。业务身份/对象归属/事务仍由宿主 handler 判断。
5. 明确临时输入与已提交 UI 状态的边界：不能在准入时就发布输入或递增 revision；沿用现有 patch 提交路径。本任务不重构 failed ledger 重入、双锁与模块队列，这些属于 S3。

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
