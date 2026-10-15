# DESIGN — 设计决策

状态：当前有效决策；后续变更以新编号记录理由、代价和触发条件。需求见 [PRD](PRD.md)，契约见 [SPEC](SPEC.md)，拓扑见 [ARCHITECTURE](ARCHITECTURE.md)。

## 决策索引

| 决策 | 选择 | 状态/复核时机 |
| --- | --- | --- |
| D1 | SDK 为主产品，OrderOps 为验证载体 | 已确定；SDK 与业务各有验收线 |
| D2 | 规则检测，Agent 解释，代码编译 A2UI | M1 规则已实现；M2 Agent 路径待闭合 |
| D3 | Protocol / Profile / Catalog / Policy 分层 | 已实现基本分层；行为变更看 conformance |
| D4 | Host 持有事实与执行权 | SDK 边界已确定；M3 领域 handler 待实现 |
| D5 | 业务事务先于 patch，以查询恢复 | M3 目标；必须有失败注入验收 |
| D6 | SDK 门禁先行，高层 API 按接入证据定型 | 当前三包入口已有；候选抽取待验证 |
| D7 | 简化 Agent fixture，不降低 SDK 质量标准 | 已确定；发布前复核 SDK 门禁 |
| D8 | 演示即验收：OrderOps 兼作部署演示载体，对抗模式参数化走生产路径 | 2026-10-14 立项；演示线（V1–V5）与 SDK S 线交替推进 |
| D9 | SSE 响应生命周期归 SDK，调用时同步占用 | 2026-10-15 实现（`105ee34`）；宿主 await/void 均正确，排队 run 不回落 404 |

决策只回答为什么选择这条路；消息字段与状态机以 [SPEC](SPEC.md) 为准，代码进度以 [CURRENT](tasks/CURRENT.md) 为准。

## D1. SDK 是产品，业务闭环是验证手段

**决定**：Nexus SDK 的公开边界、可靠性、兼容性和可安装性按生产级设计规范建设，独立验收；物流停滞 M1–M3 与模拟高金额退款 M4 是集成验证载体。OrderOps Agent/Host 保持足够简单，不承担生产商户系统目标。**理由**：业务闭环能暴露最新输入、旧 surface、领域幂等或失败恢复问题，但单一演示不能证明 SDK 的包产物和通用边界。**代价**：必须同时维护 SDK 门禁和简化业务 fixture，不能用任一方代替另一方的验收。

## D2. 确定性规则检测，Agent 解释与建议

**决定**：停滞判定和重复建案由规则完成；Agent 读取 Host 快照后做证据选择、原因解释、不确定性表达和处理建议。模型结果先过结构化 schema 与证据 ID 校验，再由代码编译 A2UI。**理由**：检测结果和风险阈值需要可重复、可回归；Agent 的价值在需要上下文综合的说明。**代价**：规则覆盖的异常类型有限；扩展新类型须增加 fixture 与规则。

## D3. 协议、Profile、Catalog、Policy 分层

**决定**：协议层对齐 A2UI v0.9 消息结构；Profile 明确支持子集；Catalog 由宿主双声明组件 schema/policy；Policy 承担工作流约束。`createCatalogPromptContract` 只指导生成，guard 始终最终裁决。**理由**：官方合法消息不等于当前渲染器能安全消费。**代价**：需要维护 conformance 偏差基线和同 fixture 双端测试；不宣称完整 Basic Catalog 兼容。

**取舍**：若把不支持的官方合法特性都判作“协议非法”，会造成协议层与官方测试相悖；若只做 schema 放行，渲染器又会收到未实现的 FunctionCall/模板。两层校验让错误来源可解释。Catalog 的字段策略当前不能表示所有领域约束，例如 `/draft/note` 的唯一可编辑路径仍需 Host resolver 保证，不能通过 prompt 声称 guard 已覆盖。

## D4. Host 是事实和执行权威

**决定**：A2UI dataModel 是界面状态；客户端 context 只接受声明过的可编辑字段。案件 ID、金额上限、订单状态等从 Host 重读。用户确认后由本地 handler 执行事务。**理由**：模型或浏览器可伪造字段，Nexus 进程内 ledger 也无法保证业务副作用。**代价**：每个领域 action 都须定义版本、幂等键、审计和恢复语义。

**替代方案**：把 Agent 输出的订单号或浏览器 action.context 当业务事实会省去 `surface_bindings`，但无法证明这些字段没有被篡改。Host 侧多一次关联与重读是信任边界的必要成本。SDK 提供 action 来源校验和处理钩子，不内置 OrderOps 工单规则。

## D5. 事务先于 patch，查询作为恢复路径

**决定**：Host 先提交业务事务和操作终态，再发送确定性 patch。SSE 中断或 patch 失败时前端查询案件/操作状态，不盲目重复执行。**理由**：流传输和业务提交无法组成一个原子事务。**代价**：Web 必须处理 pending、failed、needs_reconcile 和刷新恢复。

**失败顺序**：事务前失败可明确拒绝；事务后 patch 前失败属于“业务已成功、显示未知”，不能以 SDK `error` 事件反推业务回滚。`caseId + operationType` 的领域唯一性与 actionId 的请求重放识别分别负责不同问题。这个决策须由 M3 的“事务成功但 patch 失败”反例锁定。

## D6. 从一开始执行 SDK 门禁，按证据定型高层 API

**决定**：当前 core/react/server 根入口按公开 API、兼容、安全和独立安装门禁验收；OrderOps 暂以 subtree + `workspace:*` 消费它们。产品需要可复用的浏览器终态/错误处理和服务端准入行为，不预先承诺浏览器 client、`NexusSurface` 或独立 guard 包。先完成独立宿主和 M3，再凭重复接线点决定是否抽取；M4 验证扩展到第二类输入和 action。首条业务闭环可发布标明限制的 alpha，完整门禁通过前不声称 SDK 生产级设计达标。**理由**：生产级设计标准不能等待业务演示结束，单个示例也不足以固定便利 API。**代价**：目前 transport 与装配有样例级重复；拆分时仍须 subtree split 和三包 patch 版本、overrides/deps 同步。

**复核问题**：两个宿主是否重复解析 SSE 和补 action 信封？外部宿主若不用 Koa，能否通过当前公开入口复用准入行为？React 组合层是否实质减少必要代码且允许替换 transport？这些有对照代码与安装测试后，再锁包边界；不能仅凭 OrderOps 同仓 import 成功决定发布 API。

## D7. 单机 fixture 优先，可审计地扩展

**决定**：OrderOps 使用 Node 24、SQLite 和少量标注 fixture；CI 跑确定性路径，真实模型单独冒烟。SDK 仍须通过资源限制、错误语义、兼容性、独立安装、可访问性与坏输出验收。**理由**：Agent 和模拟业务不需要生产级规模，SDK 的工程标准却不能随 fixture 简化。**代价**：不报告真实商户收益；在 SDK 门禁完成前也不宣称当前包已 production-ready。

## D8. 演示即验收：OrderOps 兼作部署演示载体

**决定**：OrderOps 在验证载体之外兼作部署演示载体，目标是在部署环境里让 NexusUI 的核心能力（流式渲染、安全准入、可信执行、断线恢复）被亲眼验收。演示节拍 = 走查判据（同一张表，PRD §5.3），不另设表演通道——对抗模式与 pacing 是同一生产代码的参数化配置（fixture 变体 + 配置开关）。确定性模式下的逐条效果如实标注为演示节奏；真模型模式逐条编译产出，是价值层的最终形态。**理由**：基建的价值只在对比与现场中成立——"裸 prompt 不可控 vs SDK 拦下"的对比、"断线后 Host 确认"的恢复，都是测试无法替面试官亲眼确认的。**代价**：价值叙事需要三根支柱补强——对比基准（对抗模式）、真模型闭环（fixture 证明机制、真模型证明价值）、M4 复用证据（第二场景零改动 = 基建而非业务代码）；演示线与 SDK S 线交替推进，不相互挤占。详情页信息层级以 AI 生成区前置（演示第一幕即"流式生长"），宿主事实区（订单摘要/触发原因/物流时间线）置于其下——与 PRD §5.1 业务步骤序相反属演示信息层级，不改变业务步骤语义（2026-10-15）。

## D9. SSE 响应生命周期归 SDK，调用时同步占用（2026-10-15，`105ee34`）

**决定**：`sendAgentRun`/`sendMessages` 在被调用的那一刻同步装配响应（`ctx.respond = false` + 立即 `flushHeaders` 并 `pipe` 到 socket），接管响应生命周期、不依赖 Koa 的 `respond()`。per-surface 排队 run 从调用起就拥有自己的响应：既不因宿主 `void` 写法回落 404，也不因宿主 `await` 把整条流缓冲成一次下发——两种宿主写法都正确。**被否决的替代**：把返回值改为 `{ started, completed }` 并约定"不得 await"——破坏性变更波及全部调用点与 SPEC，且 JS 宿主不受 TS 类型约束，约定本身不可强制；`respond=false` 接管经实验使两种写法同时正确，改动面小一个量级。**代价**：Koa 的响应错误转发随 `respond()` 一起让位，SDK 须自行补报 PassThrough 错误；mock `res` 桩必须提供可写流（`new PassThrough()`），已在各 mock 处注释防止回退。

## 裁剪与开放决策

资源有限时，先保证 PRD R1–R7 在首条切片的可靠性、独立接入和业务闭环，再做第二流程；更多组件、Daily Briefing、Monthly Review、Vue 和完整官方 Basic Catalog 依次后排。不能裁掉 guard 反例、失败恢复或仓外产物验收来换取演示页面数量。

上游 A2UI v1.0、浏览器 API/独立 guard 的确切包图、持久化 surface state store、正式 npm 版本策略均在 [CURRENT](tasks/CURRENT.md) 的触发条件满足时形成新决策；在此之前不得把候选写成当前能力。
