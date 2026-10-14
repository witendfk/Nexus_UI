# CURRENT — 唯一任务与进度源

更新：2026-10-10。任务判据取自 [PRD](../PRD.md)，接口边界取自 [SPEC](../SPEC.md)。此处记录未完成任务、验收门禁和最近已知证据；历史过程留在 Git，不再维护并行计划。

状态口径：完成 = 有本轮可复核的代码与测试证据；工作区实现 = 文件存在但未完成跨端接线/门禁；目标 = PRD/SPEC 已定义但未实现。旧提交的测试数字只标历史基线。

## 当前结论

**主产品是 Nexus SDK，当前验证任务是 OrderOps M3 收口。** SDK 的生产级设计门禁与业务演示分开验收。Nexus Layer 0 七项加固与 v0.9 conformance 基线已关闭；M0/M1 完成，**M2 全部任务（T3.1–T3.7）已完成**（收口仅差真实模型冒烟，待凭证）。**M3 代码任务（T4.1–T4.4）已全部完成**：建单事务、工单号定点 patch、操作终态查询、Web 三结局反馈与刷新恢复、七类失败样本每类一条端到端证伪（含锁定 D5 的"事务成功但 patch 失败"故障注入）。**下一步是 M3 里程碑门禁，不再是写代码**：fresh clone 跑通、真浏览器走查（录屏点）、完整代码评审；真实模型冒烟（待凭证）可并行补。之后仓外独立宿主 → M4。未经对应端到端验证，不把下一段能力标为完成。

**下一步**：T4.4 已于 2026-10-13 完成，七类失败样本矩阵闭环（见下表）。**M3 出口 = 里程碑门禁**：① fresh clone 全量门禁；② 真浏览器走查全链并录屏（面试交付点）；③ 完整代码评审。真实模型冒烟等凭证后随时并行。之后按 仓外独立宿主（SDK S2/S3）→ M4 → subtree 拆分评估 推进。未经对应端到端验证，不把下一段能力标为完成。

| 失败样本 | 自动化用例位置 |
| --- | --- |
| ① 编造事件 ID | agent `handler.test`：model 注入快照外证据 → 不可执行面（无输入/按钮，缺信息明示） |
| ② 非法 Catalog 字段 | host `app.test` 样本①：未声明组件 → SSE error + 无绑定；另 guard 等价测试常驻 |
| ③ 伪造订单 ID | host `app.test` 样本②：action 夹带 orderId → 400 未声明字段；`create-ticket.test` resolver 用例 |
| ④ 旧 surface | host `app.test` 样本③ + `create-ticket.test` expired 用例：版本推进 → 400 重新分析 |
| ⑤ 双击 | host `app.test`：不同 actionId 双发 → 400 已建单且仅一单 |
| ⑥ SSE 中断 | host `app.test`：响应头后中断 → 事务不回滚、查询可见 succeeded |
| ⑦ 事务成功但 patch 失败 | host `d5-patch-failure.test`：故障注入未声明组件 patch → 事务/操作记录保持，guard 拒绝（**D5 锁定**） |

| 阶段 | 状态 | 下一门禁 |
| --- | --- | --- |
| Nexus Layer 0 | 已完成（2026-09-30，`3dc308a`） | 保持证伪回归 |
| Nexus conformance | 已完成基线（`261ea43`）：9 份用例，33 pass / 47 已决策偏差 / 0 fail | 行为改变时更新 JSON 基线和 SPEC |
| Nexus SDK 生产级设计门禁 | 进行中；当前三包根入口与独立 Demo 已有证据，完整门禁未通过 | 见下方 SDK 队列；不能以 OrderOps 演示代替 |
| OrderOps M0 / M1 | 已完成（2026-09-28 / 09-30） | 保持公开入口、fixture、队列/详情及重复扫描测试 |
| OrderOps M2 | T3.1–T3.7 已完成；收口仅差真实模型冒烟（待凭证） | 真实模型单独特定冒烟通过即宣告 M2 |
| OrderOps M3 | 代码任务完成（T4.1–T4.4，2026-10-13）；待里程碑门禁 | fresh clone、真浏览器走查（录屏）、完整代码评审 |
| OrderOps M4 | 待 M3 收口 | 模拟退款验证复用 |
| OrderOps M5 / Vue 等扩展 | 可选 | 不阻塞 SDK 首个交付范围 |

## SDK 主线待办

| ID | 任务 | 完成判据 |
| --- | --- | --- |
| S1 | 收口运行时边界：取消传播、并发/重复 action、失败流清理、资源上限和结构化 diagnostics | 对真实触发条件有证伪测试；失败状态可被宿主观察和恢复，不把内存 ledger 当业务事务 |
| S2 | 公开 API 与包产物：核对 core/react/server 根导出、类型、exports、依赖与兼容版本 | 当前改动产物在仓外干净宿主安装，仅用公开入口完成最小闭环；API 快照和兼容检查通过 |
| S3 | 宿主接入能力：先用现有根入口完成独立宿主，再评估浏览器 API/组合层与非 Koa guard 的抽取 | 可替换 Agent/transport/Catalog/renderMap/handler；正常与非法流均走同一准入边界，记录重复接线量；仅在证据支持时新增公共 API 或包 |
| S4 | conformance、React 交互与接入文档 | 支持子集和偏差有版本化基线；输入、action、错误提示和基本可访问性在浏览器验证；quickstart 覆盖坏输出 |
| S5 | SDK 发布节奏与门禁 | P0 的独立安装、坏输出和首条闭环通过后可发布标明限制的 alpha；正式 npm 发行前再完成 M4 复用、typecheck/lint/test/build/CI、版本升级/变更记录与浏览器验收；未通过前不宣称 production-ready |

S1/S2 是贯穿当前切片的 SDK 质量工作：优先修复 M2/M3 接线直接暴露的边界，再做仓外独立宿主验收，不要求在 T3.3 阶段一次收尽所有发行项。S3 先完成独立宿主的可用路径，再用 M4 核对是否有第二种输入/action 所需的通用能力；是否拆包不是验收项。标明限制的 alpha 可在首条业务闭环后评估；正式发行和设计达标声明取决于 SDK 门禁，不取决于 Agent 是否具备生产能力。

### PRD 对码差距（本轮源码核对）

| 需求 | 已有代码证据 | 未完成判据 |
| --- | --- | --- |
| R1 流入/生命周期 | core `JSONLBuffer`、runtime、server `sendMessages` 逐条 guard，已有 conformance 基线 | 取消传播的 HTTP 路径、提交失败/中断的组合反例 |
| R2 Catalog 边界 | CatalogDefinition、schema/policy、Contract hash 和 discovery；OrderOps Catalog v1 已定义 | `/draft/note` 路径级白名单不在 guard 表达范围，须由 Host resolver 锁定并测越权路径 |
| R3 渲染 | React Provider/17 个标准组件、自定义 renderMap 接口 | OrderOps 两个业务组件实际渲染、真实浏览器输入/错误/键盘验收 |
| R4 Agent/Host 装配 | 公共 `AgentAdapter`、外部 RPC 客户端、guarded router、独立 Demo | OrderOps adapter 尚为玩具源；浏览器接入逻辑还在示例中 |
| R5 失败与执行 | surface 锁、进程内 ledger、SSE `done/error` | Host 领域事务/操作查询与提交后断线；不把进程内结果当持久状态 |
| R6 包兼容 | 三包根入口指向 dist、API 版本和历史 tarball 冒烟 | 当前快照的仓外干净安装、peer/types/exports 与升级记录 |
| R7 可验证性 | 官方 v0.9 基线与双端 guard 测试入口 | 新增业务失败样本、资源/取消回归及发行 CI 证据 |

**优先纠偏已闭合（T3.3b，2026-10-10）**：analyze 路由现在经 `admitAnalyze` 核对案件存在与状态（未知 404、`ticket_created`/`dismissed` 409、db 未接线 503，白名单 `open`/`in_review`）；通用 `POST /api/a2ui/generate` 在业务宿主下线（404 `ROUTE_DISABLED`）。证伪测试：`host-server/test/http/analyze-guard.test.ts`（5 例）+ `test/cases/analyze-guard.test.ts`（3 例）。原 `app.ts` 注释与实际相反的问题已一并修正。该缺口属于 OrderOps 接线，不等于 Nexus SDK 的通用 generate 路由有业务逻辑错误。

## M2 待办

| ID | 任务 | 完成判据 |
| --- | --- | --- |
| T3.3 | ✅ 已完成（2026-10-10，`6d1d7bc`）：Agent `/rpc` NDJSON 与 Catalog Contract hash 缓存；测试 Host 验证 RPC 契约——fixture 打通、非 2xx + `{error:{message}}`、hash 不一致 502、空产出 500、GET 405 | 正式 Host adapter 切换属于 T3.6 |
| T3.3b | ✅ 已完成（2026-10-10，`6d1d7bc`）：封口案件生成入口——analyze 经 `admitAnalyze` 核对案件存在/状态；通用 `/api/a2ui/generate` 业务宿主下线 | 无效/不可分析 caseId 均被拒；自由 message 不能经任一入口创建 surface；8 条证伪测试全绿 |
| T3.4 | ✅ 已完成（2026-10-11，`2c6dea6`）：确定性默认 + 真实模型模式；strict schema、证据 ID ⊆ 快照、重试耗尽 → 不足证据（越界）或明确失败（结构非法） | 非法输出证伪测试全绿（引擎 8 例）；真实模型冒烟待 `ORDEROPS_AGENT_MODE=model` 凭证后单独跑 |
| T3.5 | ✅ 已完成（2026-10-11，`2c6dea6`）：分析结果由确定性代码编译 createSurface + updateComponents + updateDataModel；证据不足编译不可执行面（无输入/按钮） | protocol/profile/catalog guard 等价校验全绿（9 例）；同输入编译逐字节一致；组件/action 全在 Catalog v1 声明内 |
| T3.6 | ✅ 已完成（2026-10-12，`bdc5ca2`）：Host adapter 切换外部 Agent 生成源（玩具源已删）；analyze 提交后经 commit 钩子写 `surface_bindings(surface_id, case_id, case_version, catalog_hash)`；agentRpc 未配置显式 503 | 集成测试：analyze → 替身 RPC → SSE done → 绑定行断言；RPC 失败 → error 且无绑定；非法 caseId 均被拒（T3.3b 用例保持全绿） |
| T3.7 | ✅ 已完成（2026-10-12，`bdc5ca2`）：Web 业务 renderMap（OrderSummary/LogisticsTimeline 与标准组件显式合并）；证据 id 渲染页内锚点可回查；`done` 前丢弃 action 事件；SSE error 与网络失败在 transport 区分 | renderMap/transport 单测 7 例 + 既存穿刺全链 jsdom 用例全绿；真实浏览器验收留在里程碑门禁 |

**M2 完成**：真实模型生成可渲染 surface，证据引用正确，非法输出被 guard 拒；CI 仍以确定性 fixture 为主。

## M3 待办

| ID | 任务 | 完成判据 |
| --- | --- | --- |
| T4.1 | ✅ 已完成（2026-10-12，`5a06740`）：`createTicket` 本地 handler——resolver 限定 `note`（contracts 契约校验，换 path/伪造字段在此被拒），事务写唯一工单/案件 `ticket_created`+版本推进/操作/审计；**重复检查先于版本检查**（双击答"已建单"） | 证伪测试 10 例：最新备注生效、伪造字段、过期、双击不重复建单、dismissed 拒绝、无绑定 fail-closed；HTTP 双击 400 且仅一单 |
| T4.2 | ✅ 已完成（2026-10-12，`f3970f2`）：建单成功 patch = 禁用按钮 + 官方 `updateDataModel` 可选 `path` 语义在 `/result` 定点写工单号（不清空 draft）；`GET /api/actions/:actionId` 返回操作终态（succeeded/failed + resultId），未知 404 | 集成测试：patch 两段断言（ticketId 与库一致、draft 未被清空）、查询 200/404、**客户端中断流后事务不回滚且查询可见** |
| T4.3 | ✅ 已完成（2026-10-13，`408af5d`）：Web 三种结局显式表态——成功（patch 渲染工单号）/ 流失败后按 actionId 查 Host 终态：确认成功则展示"Host 确认"结果并锁定重发、确认失败可重试、**查询不可用=结果未知（锁定重发并提示勿重复提交）**；终态案件刷新后不再提供分析入口、不发起 analyze 请求 | jsdom 证伪 4 例：D5 恢复（查询 actionId 与提交一致、重发被锁）、未知态锁定、404 可重试、ticket_created 刷新零 analyze 请求；既存穿刺全链用例保持全绿 |
| T4.4 | ✅ 已完成（2026-10-13）：七类失败样本每类一条端到端证伪（矩阵见上）；新增编造证据（agent model 模式 e2e）、非法组件/伪造字段/旧 surface（host e2e）、**事务成功但 patch 失败故障注入（D5 锁定）**，双击与 SSE 中断由 T4.1/T4.2 用例承载 | 样本用例全绿；根 typecheck/lint/test 通过（orderops 142） |

**M3 完成**：M1–M3 的物流停滞切片在真浏览器通过，人工确认后才建单，工单可审计且可恢复。

## 后续与挂账

- M4：高金额退款 fixture、风险提示、金额输入、用户确认 `approveSimulatedRefund`、限额/版本校验和模拟退款结果。与物流流程共用 Catalog/guard/绑定/Host action 模板；Nexus 通用包不得加入退款特例。
- M4 动工前先在 SPEC 确定退款 `contracts` 判别联合、整数最小货币单位、金额上下限、领域幂等键和状态迁移；目前无退款 schema、Catalog 声明或 handler，不能展示成已支持 action。
- M5 可选：Daily Briefing、更多标注异常、Monthly Review 和人工基线评测。样本规模按评测需要增加，不作为 M3 前置。
- SDK 高层 API 先由独立宿主和 M3 的接线量提出候选，再用 M4 复核；无重复成本时保留现有三包。能力和发行门禁已列在 S1–S5。Vue renderer、完整官方 Basic Catalog 支持和更多协议特性按独立需求评估。
- 组件线 D1–D7：仅在 M2/M4 真实界面需要时补业务组件的 schema + policy + renderMap、字段约束、action 归属、可访问性和 guard 反例。
- 质量尾项：OrderOps `detect.ts` case ID 理论碰撞、最新输入权威性、事务成功但 patch 失败恢复；Nexus action 取消/`AbortSignal` HTTP 路径纳入 SDK S1，不再作为可延后的业务尾项。模型语法容错与 Catalog Prompt Skill 随真实模型接入；freestanding catalog 导出及 v0.9/v1.0 决策在拆分/发布前。
- 同居拆分：M3 后评估 subtree split；拆分时先升 Nexus 三包 patch 版本，再同步 OrderOps deps/overrides 和 tarball。

## 验证门禁与更新规则

最近已知快照（2026-10-13，T4.4 完成、M3 代码任务闭环）：根 `pnpm test` 全绿——core 179（含 conformance）/ orderops 142 / React 32 / playground 9 / demo 1；orderops typecheck、lint、根 typecheck 通过。T4.1–T4.4 已提交推送；M3 待里程碑门禁（fresh clone/真浏览器/代码评审）。历史快照（2026-09-30 至 T3.2）：OrderOps 72 / core 179（含 conformance）/ React 27 / playground 9 / demo 1。根 CI 为 Node 24 的 install/typecheck/lint/test/build。声明新任务完成时记录实际日期、命令与结果；SDK 发行门禁还须当前产物的仓外干净安装、独立宿主坏输出与浏览器验收；OrderOps 里程碑须 fresh clone、真浏览器和完整代码评审。跨包契约变更需同 fixture 双端测试。

进度只改本文件及对外 README 的一句话状态；契约变更改 SPEC，结构变更改 ARCHITECTURE，新决策改 DESIGN，需求变化先改 PRD。返工经验写入根 AGENTS.md。历史快照不能当作本轮门禁。
