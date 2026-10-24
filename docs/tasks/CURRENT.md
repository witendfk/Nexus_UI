# CURRENT — 唯一任务与进度源

更新：2026-10-24。需求、契约、结构、决策分别见 [PRD](../PRD.md)、[SPEC](../SPEC.md)、[ARCHITECTURE](../ARCHITECTURE.md)、[DESIGN](../DESIGN.md)。本文件只保留当前详细计划、后续阶段概要、已验收摘要与待办；已完成阶段的拆分、修复过程和中间快照从 Git 历史追溯，最终验收证据保留在阶段报告。

## 当前结论

**产品方向：宿主约束的 Agent UI Runtime SDK。** SDK 提供协议、Catalog、绑定、渲染、运行与交互基建；业务 prompt、模型/工具编排、业务权限与副作用由宿主负责。评审覆盖 SDK 与公开接入契约，不评审接入方业务工程；验证宿主与 Agent 尚未选定，不阻塞确定性夹具验收。

**当前任务：S3 通用 server runtime。** S3.1 契约锁定（2026-10-22）、S3.2 传输无关入口与单一调度（2026-10-23，随 `565415f` 提交，含独立复审六项整改）、S3.3 提交事实/ledger 收紧/扩展失败隔离（2026-10-23 交付，2026-10-24 独立复审六项已整改）、S3.4 Session v1 事件与结构化诊断（2026-10-24）已完成。S3.5–S3.7 共 12 个子任务待实施。S1/S2 已验收，S2.7 于 2026-10-22 随 `eb5f8cd` 推送。当前只有 core/react/server 三包；client 在 S4 新增。按 DESIGN D12 保留分包，通过层内高层 API 简化接入，暂不新增总门面包。

## 阶段与依赖

| 阶段 | 状态 | 交付与依赖 |
| --- | --- | --- |
| S0 文档与评审规范 | 已完成 | 产品方向、契约/结构/决策基线、SDK review 范围 |
| S1 安全基线与业务中立 | 已验收 | 安全防护、显式装配、参考程序迁出、早期产物检查 |
| S2 Catalog v2 与交互扩展 | 已验收 | 声明驱动交互、共享准入、固定运行结果与消费方迁移 |
| S3 通用 server runtime | S3.1–S3.4 已完成，S3.5–S3.7 待实施 | 依赖 S2；单一调度、Session 与提交语义、Koa/RPC 薄适配 |
| S4 client 与可嵌入 React | 待实施 | 依赖 S2/S3；新 client、Provider/Surface、消费方迁移 |
| S5 独立契约验收与发行 | 待实施 | 依赖 S1–S4；仓外安装、公开 API/兼容、浏览器和 CI 门禁 |

各实施切片同步消费方与迁移说明，保持已交付路径可运行；破坏性变化明确版本，不长期保留两套通用解释器。

## 已验收阶段摘要

| 阶段 | 最终交付 | 验收与追溯 |
| --- | --- | --- |
| S1 | 保留段/原型查表/媒体 URL/pattern 安全防护；预算非法值拒绝；Adapter/guard 显式装配与 runs 查询默认拒绝；参考服务迁至 examples；构建清理旧 dist | 2026-10-16 独立评审四项已修复，随 `b44b639` 推送；原始实施与验收记录见该提交的本文件 |
| S2 | Catalog Contract v2、共享解释器、声明式输入/草稿确认、服务端权威准入、固定 run 提交基准/查询/响应头、RPC/verifier 与两组 Catalog 消费验证 | 2026-10-21 阶段验收 APPROVE，无 P0/P1；随 `eb5f8cd` 推送；完整证据与限制见 [S2-ACCEPTANCE](S2-ACCEPTANCE.md) |

历史门禁：S1 在 Node v24.16.0 下 build/build:packages/typecheck、根与包 lint、根 test 均退出 0（479 项），三包 ESM 根入口和 dist 清单通过；修改文件格式检查通过，全仓 format 当时仍有 13 处既有差异。S2 最终同类工程门禁通过（851 项），conformance 36 pass / 44 已决策偏差 / 0 fail，细节以验收报告为准。上述均为历史证据，不代替后续阶段实测；当时未完成真实浏览器、仓外安装与远端 CI 验收。

## S3 — 单一运行调度与 Session v1

**拆分基线（2026-10-22）**：S2.7 随 `eb5f8cd` 已推送，工作区在本轮计划修改前干净。851 项、conformance 36 pass / 44 已决策偏差 / 0 fail 是 S2 历史证据，不替代 S3 门禁。7 个交付单元中 S3.1–S3.4 已完成，其余 3 个单元 12 个子任务待实施；拆分轮不新增运行 API 或执行改造的约束随 S3.1 实施解除。

**S3.4 完成记录（2026-10-24）**：Session v1 事件唯一事实源与结构化诊断落地。

- S3.4.1 core/session 事件面（`src/session/events.ts`，纯 wire 形状与规则，无 Node/React/server 依赖）：start/done/error/message 事件类型、`parseSessionEvent` 按 SSE 事件名解析单事件（未知版本/事件名/错误码/committed 状态显式拒绝，JSON 往返稳定）、`createSessionStreamCheck` 序列检查（start 首事件+排队取消例外、message 零或多、恰一终态、EOF 无终态不完整）；诊断条目 `{code, message, path?, dataPath?}` 与共享截断上限 `NEXUS_SESSION_DIAGNOSTIC_LIMIT`（512 字符）；core 公开入口导出并同步 API 面快照测试。
- S3.4.2 runtime 事件对齐：`RuntimeRunEvent` error 携带 `sessionVersion/runId/surfaceId/code/commitState`（身份在 emitError 统一装配），diagnostics 归一为会话条目（边界码 Protocol/Profile/Catalog/Policy、组件 schema 诊断 path/dataPath、生命周期故障折叠进 message），文本统一截断；start 发射点改为调度内 `bindBaseline(identity, surfaceRevision)`——适配器 action 准备在快照读取后、准入裁决前绑定（恰一次），准备完成仍未绑定的由 `prepared.identity` 兜底补发（自定义 run 保持原时序）。
- 契约澄清（S3.1 文字冲突裁决）：「start 在准入后发出」与同日锁定的 fixture oracle（`reject-admission-stale-revision` 预期 `[start, error]`、start 携带实际读取基准）及当时序列规则「start 是首事件（唯一例外排队取消）」互相矛盾；实施以 fixture oracle 与序列规则为准——准入拒绝流为 start→error，start 报告调度内实际基准而非客户端声明。SPEC §5.4 措辞已按实施更新；复审实际接入 fixture 后发现该旧 oracle 仍写客户端基准，已按 SPEC 校准为权威快照 revision（见下方整改）。
- S3.4.3 唯一终态与消费迁移：SSE error 帧直接转发锁定载荷（移除 S2 过渡的 `code: AGENT_STREAM_ERROR` 覆盖与 `runCode`/顶层 `boundaryCode` 附加字段，边界分类改入 diagnostics；进程内判别字段不上 wire）；`sendMessages` 原始工具路径保持非运行错误形状不变；verifier 错误解析迁移到新载荷并从 diagnostics 提取边界码（policy 拒绝验收语义不变）；订阅更替（提前退出后再订阅）经缓冲接续同一条逻辑流，不产生第二个终态。
- S3.4.4 测试：新增 `test/runtime/session-events.test.ts` 9 项——正常生成、action start 携带调度内基准、空输出 action 一次提交、HTTP/非 Koa 同输入对拍（事件名/载荷/终态一致）+ HTTP error 锁定形状回归（无 `runCode`/顶层 `boundaryCode`）、准入拒绝（start 带实际基准、handler 零调用、记录 409 语义）、store unknown、排队取消唯一 error、取消竞态 done 胜出、非法候选/缺 root 诊断分类、提前退出接续重放；事件逐条经 core `parseSessionEvent`+`createSessionStreamCheck` 对拍（fixtures/session-v1 结论）。core 新增 `test/session/events.test.ts`（解析/序列/往返/遗留过渡形状拒绝）。既有断言同组迁移：server 4 文件、playground 3 处、standalone 3 处（`runCode`→`code`；host-guard 改 diagnostics 形状）。

S3.4 首轮门禁（2026-10-24，历史证据，Node v24.16.0）：`pnpm build:packages`、根 `pnpm build`、根 `pnpm typecheck`、根 `pnpm lint`、`pnpm -r --if-present lint`、根 `pnpm test` 均 exit 0。测试合计 923 项（core 335、server 352、React 51、playground 38、standalone 45+11、参考服务 91）；变更 TS 文件 prettier 与 `git diff --check` 通过；本次构建 core/server ESM 根入口加载并核对新增导出（`parseSessionEvent` 等）通过。未运行真实浏览器、仓外安装或远端 CI；未推进 S3.5，未提交/推送。

**S3.4 独立复审五项整改（2026-10-24）**：身份准备前失败显式 beforeStart/notCommitted（不伪造 start），generation 在 history 读取前绑定身份；core 保存 start 身份副本并核对 message/error/done 身份与 action revision 推进；迭代器退出同步移交未读缓存与终态；actionId 在入队时固定并覆盖 handler 失败及排队/运行取消；core/server 直接读取四份 Session oracle（生成、含输入 action、旧 revision、store unknown），server 同验直接事件与真实 SSE 目的流。旧 oracle 的 start 基准、输入基础模型+handler patch 条数、unknown 前消息漏项按 SPEC 与调用顺序校准，未替换产品保证。先补证伪：core 7 项与 server 7 项修复前均失败、修复后通过；四份共享 oracle 双端初测通过。本轮整改范围复核无遗留 actionable finding。其余 oracle 不在此记录冒充已验收；不推进 S3.5。

本轮最终门禁（2026-10-24，Node v24.16.0）：`pnpm build:packages`、根 `pnpm build`、根 `pnpm typecheck`、根 `pnpm lint`、`pnpm -r --if-present lint`、根 `pnpm test` 均 exit 0。新增 26 项（首批证伪 14 项、共享 oracle 12 项），合计 949 项（core 346、server 367、React 51、playground 38、standalone 45+11、参考服务 91）；变更 TS/fixture 定向 prettier、文档链接/围栏与 `git diff --check` 通过。原 review 探针逐项复验、当前构建 core/server ESM 根入口及 beforeStart 解析/序列规则通过；未验证真实浏览器、仓外安装或远端 CI，未提交/推送。

**S3.2 完成记录（2026-10-23）**：传输无关入口与单一调度落地，旧测试按新契约迁移，未删测试消红。

- S3.2.1 显式运行装配与隔离实例：`createAgentRuntime(options): AgentRuntime` 公开（`generate`/`action` 返回入队结果 `{accepted, run|stage, code}`、`queryRun`/`listRuns` 只读记录）；`src/runtime/`（surface-scheduler / scheduler-owner / run-handle / agent-runtime / runtime-facade / stream-inspect）每实例一份调度器与记录所有者；非 Koa 最小接入用例不构造任何 HTTP 对象（`test/runtime/agent-runtime.test.ts`）；缺少必需依赖装配抛错沿 D4。
- S3.2.2 唯一调度与准入顺序：同 surface generation+action 同队列 FIFO，覆盖快照读取→准入→ledger→resolver→handler→候选 guard→提交；排队容量默认 32（`fixtures/session-v1/budgets.json` 同源），非法值构造抛错；排队取消先于 source 工厂与 handler 函数体（取消检查先于每次拉取，含首次）；不同 surface 并发，跨实例互不阻塞。
- S3.2.3 双锁迁移与统一直接调用：`surfaceRunQueues`（模块全局队列）与 `acquireSurfaceLock`（adapter 私有锁）删除；`sendAgentRun` 改为句柄分支（转发 runtime 事件，仅占用响应与序列化）+ 原始自定义 run 分支（复用运行模块按记录所有者关联的唯一调度器，传输层不另建队列）；非 HTTP generation 提交补完整候选与最终校验（`validateAgentCandidateSequence`），S2 直提绕过缺口关闭；`ManagedAgentRun` 拆出 `RunRecordHandle`，action 运行身份在调度内绑定实际快照。
- S3.2.4 证伪与回归：新增 11 项证伪（FIFO 串行、跨 surface 并发、容量拒绝+额度复用、取消先于任务体、已开跑不可排队取消、非法配置、非 Koa 全链、实例隔离、句柄/外壳共调度、action start 绑定调度内基准）；既有回归 server 307 + standalone-host-demo 45 + playground-server 91 全绿，拒绝语义迁移处均保留真实触发条件（越界输入、旧 revision、错 hash、越权属性仍被拒）。

行为变化（S3.1 已锁定，SPEC §6/§5.4）：调度内准入失败经 SSE error 报告（载荷新增附加字段 `runCode`/`commitState`/`runId`/`surfaceId`，既有 `code: AGENT_STREAM_ERROR` 保留），不再使用入队前 400；失败运行存在记录，按 run 查询 409；SSE 新增 `start` 事件帧（消费者按事件名分派）；排队容量拒绝在 `prepare*` 上为 `ok:false, code capacity-limit`。SSE 逐条 pacing 在发送层写入链保留（`streamDelayMs` 语义沿 D3，真实背压归 S3.6）。

S3.2 首轮 SDK review（2026-10-23，历史证据；下方独立复审另有六项整改）：初评 REQUEST_CHANGES，四项 P1 已修并各配回归反例——①运行中 dispose 只发取消信号、终态由任务侧收敛（store 确认提交胜过竞态取消，不再倒写 notCommitted）；②事件通道加终态守卫，终态后事件一律丢弃；③响应占用失败恢复 S2 同步抛错语义（DESIGN D3），路由 `void` 消费不再产生未处理拒绝，SPEC §5.1/§5.3 措辞随更新（记录收敛 canceled）；④调度任务早退路径显式关闭宿主生成器（finally 清理不依赖 GC）。同批修复：调度器条目排空回收、action 提交闸门与生成路径共用 `validateAgentCandidateSequence`、空 surfaceId 入队前拒绝。挂账（随对应切片收口）：句柄任务侧内部 API 的接口隔离（S3.5/S3.6）、不协作 source 下句柄悬挂与弃管句柄保留策略（S3.6.1/D9 已声明边界）、routes 容量拒绝 400→503（S3.5）。评审删除/迭代清单已对齐 §6.7 与各切片任务。

S3.2 首轮门禁（2026-10-23，Node v24.16.0，非本次六项整改证据）：`build:packages` exit 0；根 `pnpm test` exit 0（server 310、standalone-host-demo 45、playground-server 91，core/react 同批通过）；`pnpm -r typecheck`、`pnpm -r lint` exit 0；变更文件 prettier 通过；`git diff --check` 通过。

**S3.1/S3.2 独立复审六项整改（2026-10-23）**：action 入队深拷贝隔离 surface/context/inputs；runtime 与自定义 run 复用唯一 scheduler；manager fail/cancel/dispose 异常不阻断句柄终态并附诊断；sender 初始/后续 signal 接通并释放监听器；排队取消立即释放额度；SPEC 成功字段统一为 `run`。先补反例，修复前定向测试 9 项真实失败（含 1 项已有测试增强），修复后补齐调度器冲突配置与监听器释放检查，定向 23 项通过。六项整改复核 APPROVE，无遗留 actionable finding；不包含 S3.3–S3.7 待实现保证。

本轮门禁（2026-10-23，Node v24.16.0）：`pnpm build:packages`、根 `pnpm build`、`pnpm typecheck`、根 `pnpm lint`、`pnpm -r --if-present lint`、根 `pnpm test` 均 exit 0。测试合计 874 项（core 319、server 319、React 51、playground 38、standalone 45+11、参考服务 91）；本轮修复涉及的 TS 文件 prettier、六份主链/任务文档本地文件链接（27 个）与围栏、`git diff --check` 通过，本次构建的 server ESM 根入口可加载 `createAgentRuntime`。未运行真实浏览器、仓外安装或远端 CI；未推进 S3.3，未提交/推送。（随注：该轮工作连同 S3.1/S3.2 记录已随 `565415f` 提交，仅未推送。）

**S3.3 完成记录（2026-10-23）**：提交事实三态、观察者隔离与 ledger 收紧落地。

- S3.3.1 store 结果契约：`SurfaceActionStateStore.commitGeneration/commitAction` 返回 `SurfaceCommitResult`（`committed | notCommitted | unknown`）；内存 store 所有拒绝（epoch/revision 比较、缺 surface/组件、版本上溢、写路径失败）都发生在写入前，一律 `notCommitted`，永不 unknown；adapter 把自定义 store 抛出的异常映射 `UnknownCommitError` → 终态 failed、commitState `unknown`、错误码 `RUN_COMMIT_UNKNOWN`，不自动重试。取消与 commit 竞态仍以 store 确认为准（S3.2 已落）。
- S3.3.2 观察者隔离：删除生成 hook/history 异常后的 `removeSnapshot` 回滚；新增适配器装配项 `onRunDiagnostic`（stage：generation-hook / history-commit / record-commit / commit-identity / ledger-complete / ledger-begin），观测回调自身异常按诊断缺席处理。留存拆分（`RunRecordHandle.assertFixed/retain/finishSucceeded`）：store 确认后 recordCommit 抛错 → 运行 succeeded/committed、done 照发、记录无留存结果（按 run 查询 409）、诊断 record-commit；身份核对失败 → unknown + 诊断 commit-identity。该口径取代 S2.7「留存失败不发布成功 done」，以 SPEC §6.3 矩阵为准。
- S3.3.3 ledger 收紧：`begin` 三态 `{admitted} | {admitted:false, reason:'duplicate'|'capacity'}`；留存窗口内任意已知记录（running/succeeded/failed）拒绝重入，failed 不再是重试许可；容量满且全部活动 → capacity 拒绝且不入账、不执行 handler（映射 `RESOURCE_LIMIT_EXCEEDED`）；`complete` 抛错被吞并诊断，UI 提交事实不依赖 ledger；`begin` 自身抛错 → `RUN_FAILED`（/Action ledger 不可用/），调度权不泄漏；提交步失败也调用幂等 onAbort，覆盖最终校验拒绝，成功 ledger 不倒写。
- S3.3.4 证伪集 `test/agent/commit-facts.test.ts`（8 项）：handler 副作用后 patch 被拒 notCommitted 且不重放不回滚（共享 store 双 runtime 制造 epoch 前进）、store 异常 → unknown/RUN_COMMIT_UNKNOWN 单次调用、store notCommitted 传播、hook 失败不回滚快照 + 诊断、recordCommit 失败保留成功事实 + 409 + 诊断、ledger complete 抛错不影响 UI 事实且调度权不泄漏、同 actionId 失败后重试 duplicate 且 handler 累计一次、ledger 容量经跨 surface 命中 capacity 且 handler 零调用。既有回归按新契约迁移（13 文件 113 项，两处语义重写：hook 失败不回滚、留存失败保留成功事实），均保留真实触发条件。
- 迁移中发现并修复：留存拆分首版把 `finishSucceeded` 放在 retain 的 catch 内，正常路径记录被 dispose 收敛为 canceled；已改为 retain 后无条件收敛（finish 自带终态守卫）。

S3.3 首轮门禁（2026-10-23，历史证据，Node v24.16.0）：`build:packages` exit 0；根 `pnpm test` exit 0（server 327、standalone-host-demo 45、playground-server 91，core/react 同批通过）；`pnpm -r typecheck`、`pnpm -r lint` exit 0；变更文件 prettier 通过；`git diff --check` 通过。SPEC §6.3/§6.4 标注已实施，§6.7 两行迁移项标注已落地，DESIGN D9 状态更新。

**S3.3 独立复审整改（2026-10-24）**：自定义 run 与 adapter 共用提交身份/留存/成功终态收敛；最终校验拒绝执行幂等 ledger 清理；store 非法确认转 unknown；取消不覆盖确定拒绝；组合生命周期故障保留 RUN_COMMIT_UNKNOWN；成功 transition 失败经诊断报告。新增自定义 run 诊断入口（sender 的 onRunDiagnostic），确认提交后清理故障不改写成功事实。先补反例：首批 14 项在修复前 12 fail/2 pass，修复后全绿；额外补两项自定义提交确认丢失与记录异常组合反例，并在成功终态写入失败用例中触发诊断观察者异步拒绝。最终新增 16 项通过；按 SDK review 四维复核，六项整改无遗留 actionable finding。

本轮最终门禁（2026-10-24，Node v24.16.0）：`pnpm build:packages`、根 `pnpm build`、`pnpm typecheck`、根 `pnpm lint`、`pnpm -r --if-present lint`、根 `pnpm test` 均 exit 0。测试合计 898 项（core 319、server 343、React 51、playground 38、standalone 45+11、参考服务 91）；本轮修复 TS 文件 prettier、六份文档本地文件链接（27 个）/围栏与 `git diff --check` 通过；本次构建 server ESM 根入口及新增 sender 诊断类型声明核对通过。未验证真实浏览器、仓外安装或远端 CI；未推进 S3.4，未提交/推送。

**S3.1 完成记录（2026-10-22）**：契约决策与 oracle 定稿，未实施运行代码。

- S3.1.1 运行入口与所有权：`createAgentRuntime(options): AgentRuntime` 工厂、入队结果三态、句柄（`events()`/`result`/`cancel`/幂等 `dispose`）、依赖所有权表、生命周期状态图与旧 API 迁移表定稿于 SPEC §6.1/§6.7；`prepareGeneration/prepareAction` 保留为委托同一调度的兼容外壳，`AgentPlan ok:false` 收窄为入队前错误。
- S3.1.2 Session 事件与版本：start/message/done/error 字段表、序列规则、错误码枚举（`RUN_ADMISSION_REJECTED`/`RUN_FAILED`/`RUN_COMMIT_UNKNOWN`/`RUN_CANCELLED`/`RESOURCE_LIMIT_EXCEEDED`/`AGENT_STREAM_ERROR`）、排队与准入失败的记录存在性、查询状态码表定稿于 SPEC §5.4；Session 1、server API 1、RPC 1、onboarding 1、Catalog Contract 2 全部保持并写明理由（新增事件不改既有形状，无第二套解释）。
- S3.1.3 提交事实与访问钩子：store 结果契约 `committed|notCommitted|unknown`（异常一律 unknown，确定性拒绝返回 notCommitted）、失败矩阵、ledger 三态 begin 与留存窗口内全状态拒绝重入、`access.read/generate/action` 缺省拒绝钩子定稿于 SPEC §6.3–§6.5、DESIGN D9；备选方案「failed 重入=重试许可」「异常=未提交」在 D9 记录否决依据。
- S3.1.4 预算与共享 fixture：预算默认值/单位/所有者/超限行为定稿（run 512、ledger 1024、surface 256、history 64×20 沿 S2 加活动保护；排队 32 入队 503；消息 2000 条/单条 1,000,000 字节/累计 8,000,000 字节；SSE 高水位 1 MiB、慢消费 30 s；执行/排队超时默认不启用）；`fixtures/session-v1/` 新增 README（R5/R6/R7 证据映射）、共享 Catalog、budgets.json 与 11 个流 oracle（正常生成/action、准入拒绝、排队取消、取消竞态、handler 副作用后拒绝、store unknown、重复 actionId、容量入队拒绝、慢消费大流、观察者失败），声明式 steps 覆盖挂起/恢复/注入点，计数器以函数体入口观察为准。

S3.1 退出核对：决策无含混字段/状态（错误事件 commitState 只允许 notCommitted/unknown；done ⇒ committed）；R5/R6/R7 映射与可证伪断言见 fixture README；主链文档均标注「S3.1 锁定，实施随 S3.2–S3.6」。验证：14 个新 fixture/文档文件 JSON 解析与格式检查通过、本地链接可达（证据见下）。

**目标**：宿主通过 server 公开入口显式装配一个运行实例；Koa 与非 Koa 消费共用准入、调度、候选校验、UI 提交、取消与运行事实。SDK 不选择业务流程，不重放或回滚宿主副作用。首发仍是 Node 单实例，不实现分布式协调。

### S3 拆分时的缺口基线与范围

以下为 2026-10-22、S3.2 实施前的缺口快照；当前调度状态以上方完成/整改记录为准：

- `api/send-messages.ts` 的 `surfaceRunQueues` 为模块全局队列；`AgentAdapter.prepareAction/acquireSurfaceLock` 又有实例内锁。HTTP 排队发生在准备之后，非 HTTP 不经该队列；generation 与 action 尚无共同的完整调度边界。迁移必须覆盖准备阶段，不能只移动 Map。
- `agent/run-lifecycle.ts` 已统一 runId、容量预留与固定结果留存，但主要包装 source/commit，取消依赖消费者继续拉取或 dispose，尚无完整 Session 事件与 commitState。S2 所有权成果应复用，不能再建平行 manager。
- `AgentAdapter.prepareGeneration` 在快照提交后调用 hook/history，异常时删除快照；`ManagedAgentRun.commit` 在已提交后 recordCommit/transition 抛错仍走 fail。S3 必须显式区分 UI 发布事实、结果留存、观察者和传输，不能把存储异常一概判为未提交。
- `InMemorySurfaceActionLedger.begin` 允许 failed 记录重入；满容量且全部 running 时找不到可淘汰项仍可增长。runManager 已保护活动记录，但不等于活动/排队 run、消息、快照与缓冲都有硬预算。
- `pumpMessages` 在 Koa 层做完整流校验、积累 sent 并提交；写入忽略背压。Adapter action commit 也有校验，而非 HTTP generation commit 缺少同等完整校验保证。通用运行入口须统一候选与最终校验，直接 commit 也不能成为绕过路径。
- router 对 runs/固定结果查询已有 `runsAccess` 默认拒绝，但 generate/action 尚无等价的宿主访问钩子；可信身份由宿主上下文提供，不能把 surfaceId/hash/context 当凭据。
- S2 保留回归包含：共享非法夹具、参数重算/resolver 后置、固定 Catalog、副本隔离、revision/epoch、不回退最新快照、空输出 action、LRU、异常释放、响应头关联和 Koa await/void。旧测试若编码了快照回滚或 failed 重入，要按新契约改写并保留真实失败触发条件，不能直接删测试消红。

**范围**：主要修改 server 包内运行模块、core 的纯 Session 类型/解析及相关公开消费方接线。模块目录和工厂精确命名在 S3.1 定型，不为目录整齐重命名。新增测试放 `test/` 并镜像源码；旧 `tests/` 仅按改动迁移必要项。暂不新建 client、不拆 Provider/Surface、不做浏览器预览隔离；完整视图恢复归 S4，仓外安装/NodeNext/发行归 S5。Koa 仍为显式可选适配，raw `sendMessages` 不冒充 SDK Session 运行。

### 交付单元与依赖

| ID | 交付 | 执行项 | 依赖 | 完成出口 |
| --- | --- | --- | --- | --- |
| S3.1 | 运行、Session 与迁移契约锁定 | 4 | S2 | **已完成（2026-10-22）**：所有权、状态、提交事实、预算、准入、事件与版本决策写明，正常/失败 oracle 定稿 |
| S3.2 | 传输无关运行入口与单一调度 | 4 | S3.1 | **已完成（2026-10-23）**：同实例同 surface 全链串行、不同 surface 可并发；HTTP 不另排队；实例隔离 |
| S3.3 | 提交事实、ledger 与扩展失败隔离 | 4 | S3.2 | **已完成（2026-10-23）**：提交前/后/不确定结果可区分；失败不重放副作用；留存与 UI 事实不混淆 |
| S3.4 | Session v1 事件与诊断 | 4 | S3.3 | **已完成（2026-10-24）**：start/message/唯一终态统一产生，HTTP/非 HTTP 共用；固定结果与 error commitState 可解析 |
| S3.5 | Koa/RPC 薄适配与访问准入 | 4 | S3.4 | Koa 只处理 HTTP/序列化/连接；同步占用及 await/void 保留；两种消费路径结果一致 |
| S3.6 | 资源硬边界与取消收敛 | 4 | S3.2–S3.5 | 队列/活动/消息/字节/留存有界，慢消费停产，取消与 dispose 释放资源 |
| S3.7 | 消费迁移、独立复核与阶段验收 | 4 | S3.1–S3.6 | 公开消费路径可用、反例矩阵与真实门禁成立，交接 S4 |

**子任务执行口径**：每个单元下的 `.1`–`.4` 为可跟踪子任务，以下 28 项中 S3.1–S3.4 的 16 项已完成（见上方记录），其余 12 项待实施。每项明确交付物与完成判据；完成时就地记录状态、实际改动位置及验证证据。实现项同步补其正反例，不能等到单元末尾才验证；单元最后一项负责组合复核。子任务编号用于跟踪，不强制一项一个提交。

预算和取消契约在 .1 定义、从 .2 起随职责落地；.6 是组合资源验收与缺口收口，不是允许前序引入无限队列/缓冲。建议串行 `.1 → .2 → .3 → .4 → .5 → .6 → .7`；依赖图不构成并行 agent 授权。

#### S3.1 — 先锁定运行与 wire 契约（4 项，已完成 2026-10-22）

| ID | 子任务与主要位置 | 交付物 | 完成判据 |
| --- | --- | --- | --- |
| S3.1.1 | 定义 server 高层运行工厂、运行句柄、生命周期与依赖所有权（SPEC §6、ARCHITECTURE §6、DESIGN D9/D12） | 运行入口签名草案、生命周期状态图、依赖所有权表与旧 API 迁移表 | 列出创建/排队/启动/消费/提交/取消/dispose 的责任和资源交接点；运行模块不接受 Koa Context。说明 AgentAdapter/AgentRun/manager 注入的保留、替代或删除路径，单一事实所有者；已有 prepare/commit 公开入口不得绕过最终校验和调度，兼容外壳只能委托同一实现 |
| S3.1.2 | 定型 Session 事件、diagnostics 与版本迁移（SPEC §5/§8、core/session） | Session 字段表、事件时序、版本兼容决策及查询状态码表 | 精确定义 start 的身份/固定 Catalog/基准 revision（首次生成无旧 revision 的表示）、排队与准入失败是否已有 run、message 原始 A2UI、done 固定提交、error 身份/code/commitState。明确取消、提前断开、唯一终态和查询 404/409；比较 Session 1/server API/RPC/onboarding 是否需升版并给理由，不机械升级或静默双解释 |
| S3.1.3 | 定义 UI 提交结果、重放、扩展与访问契约 | 提交失败矩阵、store 结果契约、重复 action 规则与访问钩子契约 | 区分写入前确定失败、写入已确认、存储结果不确定；定义自定义 store 报告方式，普通异常默认不能证明未写。发布后 history/hook/record/传输失败不抹除 UI。明确 actionId 在留存窗口内各终态的重复拒绝规则、容量/淘汰限制和业务幂等边界；定义读取/生成/action 的宿主访问钩子，缺省拒绝与显式本地 demo 配置 |
| S3.1.4 | 建立预算表、失败矩阵和正常/非法契约 fixture | 资源预算表、带预期结果的共享契约 fixture 与需求映射 | 活动 run、全局/每 surface 排队、消息数/单条与累计字节、事件/输出缓冲、执行/排队/空闲/释放时限、run/ledger/surface/history/诊断留存列出计量单位、默认值、配置范围、拒绝点与所有者。正常、取消、提交前/后/unknown、重复、慢消费 oracle 定稿；形状放共享 fixture，SDK 不引入宿主领域模型 |

退出条件：上述决策无含混字段/状态，关联需求 R5/R6/R7 与可证伪断言；主链文档标清目标/现状。只锁契约时不把类型声明或伪代码当功能交付。

#### S3.2 — 传输无关入口与单一调度（4 项，已完成 2026-10-23）

| ID | 子任务与主要位置 | 交付物 | 完成判据 |
| --- | --- | --- | --- |
| S3.2.1 | 落地显式运行装配及隔离实例（server 运行模块、adapter、公开根入口） | 实例化运行工厂、公开导出、最小非 Koa 接入用例与装配测试 | store/ledger/scheduler/manager 默认每实例一份；registry/source/Policy/handler/history 显式装配，缺少必需项报错。可选 hook 不强制启用业务记忆；根入口无 listener/环境读取/模型默认值。非 Koa 消费无需伪造 Context |
| S3.2.2 | 建立每 runtime/surface 唯一调度与准入顺序 | 唯一 surface 调度器、排队/取消实现与调度顺序测试 | generation（含固定 surfaceId 工厂碰撞/重建）与 action 同队列，覆盖快照读取、revision/hash、输入、resolver、handler、候选与提交。排队容量与取消先于 source 工厂/handler 函数体；同 surface 不并发，不同 surface 可并发，两个 runtime 的同名 surface 不互相阻塞 |
| S3.2.3 | 迁移 Adapter 锁与 HTTP 全局队列，统一直接调用路径 | Adapter/HTTP 委托接线、旧锁/全局队列删除及既有入口回归 | 删除 `surfaceRunQueues` 与 `acquireSurfaceLock` 的重复所有权；prepare 只做契约允许的预处理，权威读取/业务调用在调度内。source EOF 不提前释放提交资格；重复消费/commit/dispose 按契约拒绝或幂等；显式失败/取消/初始化异常都释放所有权 |
| S3.2.4 | 补调度、实例隔离与装配失败反例 | 带屏障的并发、实例隔离与异常释放证伪测试集 | 用挂起真实读取/handler 的屏障验证同 surface 顺序、generation/action 交错、排队 handler 零调用、跨 surface 进展、同名跨实例独立、store/ledger/装配抛错后下一任务可完成。不靠 generator 首次 yield 代替工厂/handler 调用计数 |

#### S3.3 — 提交事实、重放与扩展失败隔离（4 项，已完成 2026-10-23）

| ID | 子任务与主要位置 | 交付物 | 完成判据 |
| --- | --- | --- | --- |
| S3.3.1 | 明确提交发布点与 store 结果（surface 状态、运行生命周期） | store 提交结果实现、commitState 传播与原子发布测试 | 完整结果经身份/契约验证，在调度内原子提交；确定发布前失败为 notCommitted，成功为 committed，写入后结果丢失为 unknown。保留 revision/epoch 单调、声明固定与引用隔离；合法空输出 action 仍一次提交并推进 revision。取消与 commit 交错不能将实际已提交倒写为 notCommitted |
| S3.3.2 | 分离 history/observer/运行留存与权威 UI | history/hook/manager 失败隔离实现及提交后故障测试 | 移除生成 hook/history 异常后的删除快照方案；扩展失败按 .1 约定报告但保留已发布状态和固定事实。recordCommit/transition 抛错不改写为未提交，不伪造成功留存；查询无法确认结果时保留明确 409/不可对账语义。内存与 FileHistory 可替换，SDK 不伪装跨存储原子事务 |
| S3.3.3 | 收紧 ledger 的重放与容量语义 | ledger 重复拒绝与容量预留实现、留存窗口说明及边界测试 | failed/canceled/unknown 不成为同一 actionId 重试许可，SDK 不自动重放。容量预留、终态与淘汰遵循 .1，全部活动时拒绝新条目且不执行 handler；留存窗口之外不承诺永久 exactly-once。释放失败不泄漏 surface 调度权，UI 提交事实不依赖 ledger complete 成功 |
| S3.3.4 | 以副作用替身与故障 store 验证提交前/后事实 | 故障 store、业务副作用计数替身与提交竞态证伪测试集 | 覆盖写入前拒绝、写入后抛错/响应丢失、history/hook/manager/ledger 异常、提交中取消、二次终态/commit；宿主副作用计数已变后，patch 拒绝或传输失败不触发 SDK 重放/回滚。同一 actionId 再提交不能再次进入 handler；快照、固定结果与 commitState 分别核对 |

#### S3.4 — Session v1 事件与结构化诊断（4 项，已完成 2026-10-24）

| ID | 子任务与主要位置 | 交付物 | 完成判据 |
| --- | --- | --- | --- |
| S3.4.1 | 实现共享纯类型、解析与事件状态检查（core/session） | core/session 纯类型、解析器、序列规则与共享 fixture 测试 | 只放 wire 形状与纯规则，不依赖 Node/React/server；start/done/error 必需字段、版本/hash/revision、diagnostics 与身份严格校验，JSON 往返稳定；单独解析与序列检查分责，未知版本显式拒绝，A2UI payload 不掺运行元数据 |
| S3.4.2 | 在通用 runtime 统一产生校验后的事件 | runtime 事件源、统一候选/最终 guard 与固定 done 测试 | 非 Koa 事件消费者与 SSE 使用相同 start/message/done/error 事实源；start 先于候选且绑定调度内实际基准，不能提前读最新快照拼装。候选逐条及完整最终结果共用 guard，直接调用不得绕过；成功 done 等于本次固定 commit，不等于业务成功 |
| S3.4.3 | 收敛终态、查询与 diagnostics | 唯一终态控制、结构化 diagnostics 与查询一致性实现 | 可交付事件流只产生一个终态，终态后无消息；EOF/iterator return 不伪造成功，消费方提前退出需取消/dispose。定义连接已断而无法发终态的本地记录结果；错误区分 Protocol/Profile/Catalog/Policy、准入、资源、传输与运行，携带可获得的 run/surface/action 关联并截断 raw |
| S3.4.4 | 补事件协议和跨入口反例 | HTTP/非 HTTP 事件对测与非法流、取消竞态测试集 | 正常生成/空输出 action、准入拒绝、非法候选、缺 root、错身份/hash、重复终态、终态后消息、提前 EOF、取消与终态竞态对拍。非 HTTP generation 也必须拒绝非法完整结果；core/server 共用 fixture，记录/事件/done/查询值一致 |

#### S3.5 — Koa/RPC 薄适配与访问准入（4 项）

| ID | 子任务与主要位置 | 交付物 | 完成判据 |
| --- | --- | --- | --- |
| S3.5.1 | 将 HTTP sender 改为 Session 事件薄适配 | Session→SSE 薄 sender、响应占用/异常清理与时序测试 | 不再解释 Catalog、不自建 queue/manager、不自行提交；负责占用响应、SSE 序列化、连接与异常转发。已接受排队 run 同步占用并写 runId 头，`void`/`await` 都及时流式下发；容量拒绝在占用前，flushHeaders/pipe 失败回收运行和宿主资源 |
| S3.5.2 | 接通可信宿主访问与断连 | 访问钩子接线、可信上下文传递、断连清理与拒绝测试 | generate/action/运行查询在读取受保护状态或执行前调用 .1 定型的宿主钩子；未配置默认拒绝，显式本地 demo 自行放行。拒绝不启动 source/resolver/handler、不泄露记录存在性；HTTP Context 留在适配层，只向运行传递约定的可信上下文，不信任客户端自报身份。统一 signal 与 listener 所有权，重复取消/关闭清理一次 |
| S3.5.3 | 迁移 RPC/verifier/发布和最小消费接线 | RPC/verifier、参考服务与浏览器必要契约迁移及使用说明 | RPC 只做候选传输，复用 guard 与真实参数，不获得额外写权限；verifier 消费真实目的流至结束并校验新事件。公开类型或 wire 变化同时迁移两个参考服务、两个浏览器必要解析（新 start/error 可识别），已有 Catalog/hash 与 nexus 输入链不断；S4 前不复制完整 client 会话状态机 |
| S3.5.4 | 完成真实 HTTP 与非 Koa 对测 | 真实 HTTP/非 Koa 同输入对测与头/查询/终态一致性证据 | 同输入正常/拒绝/空 action/提交前后失败的准入、固定结果和 commitState 相同；保留运行查询 403/404/409、头与 done 一致、排队 HTTP 不回落 404、await/void、响应占用异常和错误转发。非 Koa 测试不构造 Koa Context；HTTP 必须读取实际响应至终态 |

#### S3.6 — 资源硬边界与取消收敛（4 项）

| ID | 子任务与主要位置 | 交付物 | 完成判据 |
| --- | --- | --- | --- |
| S3.6.1 | 核实活动/排队/保护记录及生命周期预算 | 活动/排队预算、保护记录与句柄超时回收实现及容量测试 | 运行级与每 surface 预算真实生效，非法配置初始化拒绝；排队取消立即移出，活动记录/surface/ledger 不被容量淘汰。预算失败在工厂/handler 前显式拒绝，终态释放额度可复用；设置运行、等待与未消费句柄的释放策略，不能靠无限保留锁处理悬空句柄 |
| S3.6.2 | 限制消息、累计缓冲、快照和历史占用 | 消息/字节/快照/history 计量实现及临界值、超限测试 | 对单条/累计消息字节、候选/提交缓存、事件与诊断 raw、surface 模型/组件、history 条数/字节及结果留存分别计量；不是只限制条数。超限不发布部分 UI 或静默截断改变语义；读取共享 fixture 与快照隔离不产生无界旁路，预算默认值与 SPEC 一致 |
| S3.6.3 | SSE 与非 HTTP 消费的有界背压 | 有界事件消费、SSE drain/中断实现与真实慢流验收 | 适配层尊重 write(false)/drain，通用事件源按消费速率推进，不无限预取。输出缓冲和慢消费等待有硬上限，关闭/abort/error 可打断 drain；合法输出超过 highWaterMark 仍完整收到终态，真正超限明确失败，不把合法大流误当空输出 |
| S3.6.4 | 取消/超限组合证伪与不协作宿主边界 | 组合取消证伪测试、不协作 handler 隔离行为与边界说明 | 挂起 source.next/reader/handler、排队与慢消费者时取消，调用 return/cancel/abort 并清理 timer/listener/预算；不依赖下一条消息才观察取消。宿主不理会 signal 时不保证终止业务代码；超时后阻止晚到 UI 提交，保留单 surface 所有权或拒绝后续业务重叠的有界策略必须与 .1 一致，不能假装已杀死 handler 后放行冲突运行 |

#### S3.7 — 消费迁移与独立验收（4 项）

| ID | 子任务与主要位置 | 交付物 | 完成判据 |
| --- | --- | --- | --- |
| S3.7.1 | 收口公开 API、迁移说明和删除项 | 公开 API/产物清单、迁移指南、删除清单及公开入口验证 | 新入口和既有 Adapter/run 路径只委托同一调度/校验；删除 HTTP 全局队列、重复通用流解释与旧回滚/重入旁路。三包 dist 根入口/类型/文件清单与依赖检查；不复活源码 paths、不新增门面包，NodeNext/ESM 修补脚本仍留 S5 |
| S3.7.2 | 建立 S3 需求/失败证据矩阵并复核 S2 回归 | R5/R6/R7 证据矩阵、S2 回归结果与残余问题归属表 | 每项 R5/R6/R7 保证有真实入口、正反例、不变式和证据；覆盖并发、取消、重复、超限、慢消费、实例隔离、提交前/后/unknown 与副作用替身。双 Catalog 最新输入、固定 run 基准/查询、草稿、LRU 与异常释放回归继续通过；评估 S2 报告待核实的数组路径/草稿恢复/checks 挂账并给明确归属，不借调度任务改业务规则 |
| S3.7.3 | 运行 Node 24 门禁与 SDK review | 本次 Node 24 门禁日志、实际退出码及 SDK review 结论 | 先核 Node，再 build:packages/build/typecheck/根与相关包 lint/根 test；conformance 差异逐条决策。变更文件定向格式、链接、diff 检查；四维 code-review-expert 评审，阻断项先反例后修复。测试数量仅统计，CI/真实浏览器/仓外安装只记录本次实际执行证据 |
| S3.7.4 | 完成阶段报告与 S4 交接 | S3-ACCEPTANCE 阶段报告、状态同步与 S4 交接清单 | 验收时新增 `docs/tasks/S3-ACCEPTANCE.md`，集中命令/退出码、矩阵、版本/迁移、限制与 review；同步 CURRENT/README 和主链实现状态，无阻断项才标完成。S4 接 client/预览提交隔离/恢复/Provider/Surface，S5 接仓外产物与发行；实际提交后才写哈希 |

### 实施与提交建议

按七个交付单元评审与验收；建议 `.1` 契约文档一组，`.2` 单一调度一组，`.3` 提交/重放一组，`.4` Session 事件一组，`.5` 适配与消费迁移一组，`.6` 资源边界一组，`.7` 阶段验收一组。精确类型/wire 与实际消费方必须同组迁移；需要依赖前序才能保持可运行时允许合并提交，不强拆同一契约文件的 hunk。阶段门禁不过不进入下一单元，提交仍按 SOP 另行确认范围/message。

S3.1 已按上述完成记录交付契约与 oracle；S3.2 起执行代码改造，各单元门禁与 SDK review 按本节口径逐项记录，不以计划或契约声明 Session v1 已完整实现。

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

## 待办归属与暂缓项

只列未完成项；已解决问题不再重复挂账。S2 报告中的历史问题表不自动等于当前阶段新增承诺，具体实施以本计划和契约决策为准。

| 待办 | 归属与处置 |
| --- | --- |
| 旧入口进一步收口、访问钩子 | S3.5；提交事实/ledger 重放与扩展失败隔离已在 S3.3 落实 |
| 背压/字节硬预算、数组路径越界风险 | S3.6；路径风险先核实可达性，再决定修复范围 |
| S2 残余草稿恢复与 checks 语义问题 | S3.7.2 核实并明确归属；完整视图恢复由 S4 承接，不借调度重构改业务规则 |
| Provider 固定布局/runtime 重建、两处 SSE 消费、预览隔离/恢复、草稿读取入口收敛 | S4；同时核对 S1 留下的 React 重复 key 警告与渲染稳定性 |
| NodeNext/ESM 修补脚本、运行环境声明一致性、仓外安装/真实浏览器/远端 CI | 按 S4/S5 实际验收范围推进，不引用历史单测替代 |
| 每消息全量组件重校验的增量优化 | 保持有界正确行为；优化暂缓，依据真实瓶颈决定 |
| 独立 Catalog 包、Vue、完整 v0.9/v1.0、分布式调度 | 非首发范围，暂缓 |

## 验证与文档维护

代码门禁遵循根 AGENTS.md：Node 24、相关单测/typecheck、根与相关包 lint、构建；跨包改动加根 test。core API 变更先构建 core 再跑 React 测试；安全/隔离/幂等声明须有证伪测试，显著或协议面变更须执行 SDK review。仓外、浏览器与 CI 结论只使用实际环境证据。

文档维护：当前阶段保留可执行细项；验收后收敛为交付摘要、最终证据入口及未解决事项，移除已完成拆分、重复修复日志和被取代快照。契约/结构/决策回到主链文档，阶段报告保存验收证据，过程由 Git 追溯，CURRENT 不追加会话流水账。

历史整理（2026-10-22，仅文档）：28 个 S3 子任务、交付物与判据完整；15 个本地链接及 CURRENT 锚点核对通过，代码围栏配对、`git diff --check` 通过；该轮未改运行代码或执行代码门禁。最新实施证据见上方 S3.2 整改与门禁记录。
