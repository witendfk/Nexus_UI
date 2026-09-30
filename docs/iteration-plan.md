# Nexus UI 迭代任务计划

状态：当前迭代执行基线。更新时以代码、测试和独立宿主验收结果为准。
更新：2026-09-30。历史执行记录保留原日期；本轮静态 review 与文档同步未重跑门禁。

本文档综合 [工程现状与优先级](engineering-priorities.md)、[npm SDK 改造计划](npm-sdk-transformation.md) 和 [OrderOps Copilot 方向](order-ops-copilot.md)，给出按依赖关系排列的迭代阶段。每个任务标注验收标准；完成后在对应阶段标记日期和证据链接。

## 当前基线

| 项目 | 状态 |
| --- | --- |
| 全仓测试 | **2026-09-30 快照通过**：core 179（含 conformance 5 例）/ react 27 / orderops 34 / playground 9 / demo 1；2026-09-28 历史记录（core 92 / React 23 / server 117 / web 9 / demo 22）存档 |
| typecheck / lint / build / format | 2026-09-28 历史记录通过；本轮未重跑 |
| 独立宿主 demo | 可运行，外部 Agent RPC + local action 双模式验证通过 |
| Catalog Contract | 已发布带 `contractVersion` / `contractHash` 的 discovery 和 onboarding 路由 |
| 可安装 SDK | 三包仍为私有包（npm 发布按 SDK 路线在 M4 后），入口已指向 `dist`；tarball 冒烟（2026-09-28）+ 同居 workspace 直链消费验证（2026-09-30，orderops guard 全绿） |
| Layer 0.3 core 加固 | **已关闭（2026-09-30）**：[L0-01–L0-07](runtime-hardening-review.md) 全部 CLOSED，每项带证伪测试（commit `3dc308a`） |
| Layer 0.1/0.2 | **已完成（2026-09-30，commit `261ea43`）**：官方 9 份用例基线 33 pass / 47 已决策偏差 / 0 fail，决策见 [conformance-baseline.md](conformance-baseline.md)；orderops guard 同 workspace 验证 |
| OrderOps 业务闭环 | 同居于 `examples/orderops`（2026-09-30 起）：M0 闭环，M1 T2.1–T2.3 完成、transport P1 已修（34 例绿）；下一步 T2.4 停滞检测。M3 才算首条业务切片交付 |

## 当前状态与下一步

**无阻断（2026-09-30）**：Layer 0 七项关闭（修复 `3dc308a`）、conformance 基线建成（`261ea43`）、orderops 同居接线（`20213f8`，tarball 刷新仪式随之暂停，拆分/npm 发布时恢复）。Layer 0 已作为 OrderOps M2 的入口基线。

下一步（业务主线）：orderops M1 收口——T2.4 停滞检测规则、T2.5 案件查询 API、T2.6 队列/详情页；随后 M2 真实模型分析（Catalog 转正、A2UI 消息编译）。action 取消、领域幂等剩余验收随 M3 推进。

## 已完成记录与验证范围

以下是历史记录；临时目录路径仅用于追溯当时验收，不保证产物仍在，也不证明当前快照已通过。Phase 的剩余验收须继续跟踪。

| 日期 | 任务 | 证据 |
| --- | --- | --- |
| 2026-09-28 | Phase 1.1.1 surface 级 action 串行（per-surface lock 从 `prepareAction` 到 SSE 流结束） | `agent-adapter.test.ts` serializes concurrent handler execution |
| 2026-09-28 | Phase 1.1.2 `commitGeneration` 原子性（hook / history 失败时回滚 action snapshot） | `agent-adapter.test.ts` rolls back the action snapshot |
| 2026-09-28 | Phase 1.1.3 流失败时 ledger 关闭为 `failed`；允许同 key 重试 | `agent-adapter.test.ts` marks the action ledger as failed |
| 2026-09-28 | Phase 1.2.1 默认 resolver 路径拒绝未声明的客户端 context 字段 | `agent-adapter.test.ts` rejects action context fields not declared |
| 2026-09-29 | Phase 1.1.1 补强：action 锁释放点从 source 耗尽移到 commit/onError 之后（`AgentRun.streamClaimed`），并补证伪测试——同一 surface 的第二个 handler 必须读到第一个 action 提交后的 dataModel | `agent-adapter.test.ts` runs the next same-surface action only after the previous action commits |
| 2026-09-29 | Phase 1.3.1 部分闭合：`historyStore.getHistory` 失败时 ledger 关闭为 `failed` 并释放 surface 锁；ledger 容量淘汰跳过 running 记录（重放保护不再被容量逐出打断） | `agent-adapter.test.ts` closes the action ledger ... when history reads fail；`surface-action-state.test.ts` never evicts running records |
| 2026-09-28 | Phase 2.2–2.3 core / React / server `dist` 入口 + `files` + ESM import 修复 + `pnpm pack` 三 tarball | `/tmp/nexus-tarballs/*.tgz`；tarball 仅含 dist + README + metadata |
| 2026-09-28 | Phase 2.4–2.5 的安装与公开 API 冒烟记录；浏览器输入/action 闭环仍需当前快照证据 | `/tmp/nexus-clean-host/smoke.mjs` 记录通过（17 standard components, compatible, protocol validation ok） |

## 迭代原则

- 以一条完整业务切片为单位推进，不以组件数量或包数量为单位。
- 先修 P0 通用边界，再接真实业务；先证明 tarball 可安装，再稳定高层 API。
- 每阶段有明确的"做"和"不做"，防止范围膨胀。

---

## Phase 1：P0 Action 边界纠偏

目标：保证业务 action 不会在 guard 校验失败、流中断或重复提交时产生不可恢复的副作用。这是后续所有业务接入和 SDK 安装验证的前置条件。

来源：[engineering-priorities.md](engineering-priorities.md)的 action、输入与幂等章节。以下保留验收目标；已记录修复不重复视为未实现：1.1.1、1.1.2、1.2.1 有历史实现/测试记录，1.3.1 部分闭合；1.1.3 和其余业务/恢复验收仍待完成。

### 1.1 串行与提交边界

| # | 任务 | 验收 |
| --- | --- | --- |
| 1.1.1 | 将 `prepareAction()` 中的 handler 调用移入 surface 级串行队列，保证同一 surface 的读取权威快照 → 校验输入 → 执行 handler → 提交结果按一致顺序执行 | 并发提交同一 surface 时，第二个请求基于第一个请求提交后的状态执行，不能基于旧状态重复执行 |
| 1.1.2 | 修复 `commitGeneration()` 原子性：action 快照保存、成功 hook 和 history 提交要么全部成功，要么全部回滚 | 测试：成功 hook 或 history 提交失败时，SSE 返回 `error`，不留可执行 surface action 快照；流式预览阶段的按钮在提交成功前不能触发业务 action |
| 1.1.3 | 补充连接取消时的 handler 中断语义 | 测试：客户端断开后，`AbortSignal` 传播到 handler；handler 已完成的副作用通过 reconcile 语义回滚或标记 |

### 1.2 服务端事实与用户输入分离

| # | 任务 | 验收 |
| --- | --- | --- |
| 1.2.1 | 通用边界只接受 surface 声明过的可编辑绑定字段作为用户输入；未声明的客户端 context 字段在 guard 层拒绝 | 测试：伪造额外 context 字段（如 `orderId`）时返回结构化 diagnostics |
| 1.2.2 | 按字段类型、范围和当前业务状态校验已声明字段；宿主从领域服务重读订单、金额上限等事实 | 测试：伪造订单号、超限退款金额、非法处理方式及过期 surface 时被拒绝；客户端 context 不能覆盖服务端事实 |

### 1.3 幂等与失败状态闭合

| # | 任务 | 验收 |
| --- | --- | --- |
| 1.3.1 | action ledger 在 handler 成功、失败、取消后都有可查询结局；不留 `running` 孤儿记录 | 测试：流失败 / 取消 / 提交失败后，通过 API 查询 ledger 状态为终态 |
| 1.3.2 | OrderOps Host（后续 Phase 3）用 SQLite 建立领域幂等键；Nexus 通用 ledger 不替代领域事务 | 依赖 Phase 3 的 OrderOps 数据模型；在 Phase 3 中验收同一订单异常同一处理决策只能执行一次 |

**Phase 1 验收口径**：`pnpm test` 全绿 + 新增的 action 边界专项测试全绿。完成后在 `engineering-priorities.md` 的对应 P0 段落标记"已修复"和日期。

---

## Phase 2：最小可安装 SDK（tarball 验收）

目标：让 core / React / 有限 server 入口产生可从 `dist` 安装的本地 tarball，在 monorepo 外的干净宿主中通过公开入口完成静态 A2UI 冒烟。暂不发布 npm。

来源：[npm-sdk-transformation.md](npm-sdk-transformation.md) M0 + M1 + M2（不含 OrderOps 接入部分）。

进度：2.2–2.3 已有产物配置与历史打包记录，2.4–2.5 有安装/公开 API 冒烟；当前加固版本的完整输入/action 与跨仓 fixture 验收仍待完成。每次重验新产物均遵守三包 patch 升级及对方 deps/overrides 同步规则。

| # | 任务 | 验收 |
| --- | --- | --- |
| 2.1 | 冻结 core / React / server 根入口导出面；补充 public API snapshot tests | 测试锁定当前导出列表；文档明确最小支持范围和禁止依赖的内部路径 |
| 2.2 | core / React / server 的 `main` / `types` / `exports` 指向 `dist`；补 `files` 字段 | `pnpm --filter @nexus-ui/core build` 等三个命令成功产出 `dist/` |
| 2.3 | `npm pack` 三个 tarball 并检查内容 | tarball 只含构建产物、README、LICENSE 和 package metadata；不含 tests / examples / TypeScript 源码 / workspace 配置 |
| 2.4 | 新建干净 Vite React 宿主项目（monorepo 外）；安装三个 tarball | 宿主不引用 monorepo source path；`node_modules` 中只有 tarball 产物 |
| 2.5 | 干净宿主渲染静态 A2UI JSONL 流；验证 TextField 写回 dataModel；验证 Button action context 携带最新值 | 浏览器无 runtime error；action context 与 UI 输入一致 |

**Phase 2 验收口径**：在 monorepo 外的干净宿主中，只 import `@nexus-ui/core` / `@nexus-ui/react` / `@nexus-ui/server` 的公开 API 即可完成生成 → 渲染 → 输入 → action 闭环。

---

## Phase 3：OrderOps 首条业务切片

目标：用一个标注的"物流长时间无更新"案例完成真实 Agent → 受控 surface → Host action → 同 surface patch 的端到端闭环。

来源：[order-ops-copilot.md](order-ops-copilot.md) §9 首条端到端业务切片；[engineering-priorities.md](engineering-priorities.md) 开发节奏步骤 1 和 4。

### 3.1 固定最小契约

| # | 任务 | 验收 |
| --- | --- | --- |
| 3.1.1 | 定义 OrderOps CatalogDefinition：`OrderSummary` + `LogisticsTimeline` 两个自定义组件（含 props schema 和 componentPolicies）；复用现有 `Text` / `TextField` / `Button` | Catalog definition 可注册、发布 discovery、生成 prompt contract；非法组件 / action 被 guard 拒绝 |
| 3.1.2 | 定义只读订单 / 物流查询结果和可编辑备注的最小数据模型 | 确定性 fixture 包含一条停滞物流案例 + 一条正常对照案例，带可追溯的订单 / 物流事件 ID |
| 3.1.3 | 定义 `createTicket` action 的输入 / 结果 / 幂等键 | 同一订单异常同一处理决策只能创建一张工单；重复提交返回已有结果或明确拒绝 |

### 3.2 最小 OrderOps Host

| # | 任务 | 验收 |
| --- | --- | --- |
| 3.2.1 | 用 SQLite 实现订单 / 物流事实存储和工单 action 的领域幂等键与最终状态 | Phase 1.3.2 在此验收；重启后能恢复或明确标记待核查 |
| 3.2.2 | Host 校验当前订单 / 物流事实与用户输入后，幂等创建 mock 工单；同 surface 更新工单号和处理状态 | Host 拒绝伪造订单 ID、未声明输入和重复建单；错误或中断不把未完成的 action 误报成功 |

### 3.3 真实 Agent 接入

| # | 任务 | 验收 |
| --- | --- | --- |
| 3.3.1 | OrderOps Agent 消费发布的 Catalog Contract，用只读工具调用查询订单 / 物流事实，引用事件 ID 解释停滞并建议建单 | Agent 输出的事实引用能回查工具结果；不是从 prompt 猜测 |
| 3.3.2 | 同一案例保留确定性 fixture 供 CI 重放 | CI 用 fixture 跑通完整闭环（不依赖真实 LLM key） |

**Phase 3 验收口径**：
- 干净宿主通过 tarball 安装 core / React / server，接入 OrderOps Agent + Host，完成查询 → 生成 → 人工确认 → createTicket → 同 surface patch。
- Agent 输出 A2UI，订单事实由 Host 校验；Phase 2 的干净宿主扩展为 OrderOps 实际闭环。

---

## Phase 4：第二个场景检验抽象

目标：用处理方式和确认界面显著不同的高金额退款请求，检验 Catalog、guard、绑定和 Host action 是否能真正复用；如果必须加入业务特判，先修抽象再继续。

来源：[order-ops-copilot.md](order-ops-copilot.md) §9 第二条流程；[engineering-priorities.md](engineering-priorities.md) 开发节奏步骤 5。

| # | 任务 | 验收 |
| --- | --- | --- |
| 4.1 | 定义高金额退款 Catalog 切片：`RiskNotice` + `ChoicePicker`（处理方式）+ `TextField`（退款金额）+ `Button`（approveRefund） | 不同风险提示、金额输入和确认 action 复用同一宿主边界；无业务特判进入 Nexus 通用层 |
| 4.2 | Host 校验退款金额上限和订单状态；幂等执行 mock 退款 | 超额退款被拒绝；同一退款决策只能执行一次 |
| 4.3 | 对比两条流程暴露的重复接入逻辑；若抽象不合理先修边界再扩展 | 完成两条流程后才稳定高层 SDK API 和扩展组件库 |

**Phase 4 验收口径**：两条显著不同的业务流程通过同一套 Catalog / guard / 绑定 / Host action 模板完成；发现的抽象问题在扩展前修复。

---

## Phase 5：SDK 高层 API 定型

目标：在两条业务流程验证通过后，从重复接入逻辑中定型 `@nexus-ui/client` 和 `NexusSurface`。

来源：[npm-sdk-transformation.md](npm-sdk-transformation.md) M3 + M4。

| # | 任务 | 验收 |
| --- | --- | --- |
| 5.1 | 从 web playground 抽出 SSE parser + HTTP generate client + action client → `@nexus-ui/client` | client 不 import React；React 宿主通过 client 完成 generate / action 闭环；换自定义 transport 不修改 core |
| 5.2 | 增加 timeout / max bytes / 非 2xx / 非法 content-type 错误处理 | 各错误场景有明确错误类型和结构化信息 |
| 5.3 | 组合 `A2UIProvider` + transport + action client + error surface → `NexusSurface` | 宿主只需提供 `client` / catalog / action handler 即可渲染并提交任务 surface |

**Phase 5 验收口径**：干净宿主 `npm install @nexus-ui/react @nexus-ui/client`，只需 `client` / catalog / action handler 即可运行。

---

## Phase 6：Guard SDK 抽出与规模扩展

目标：从 reference server 抽出独立 guard 包；同时扩展 OrderOps 数据集和异常类型。

来源：[npm-sdk-transformation.md](npm-sdk-transformation.md) M5；[order-ops-copilot.md](order-ops-copilot.md) §9 后续扩展路线。

| # | 任务 | 验收 |
| --- | --- | --- |
| 6.1 | 从 reference server 抽出 sequence / lifecycle / catalog / action guard → `@nexus-ui/guard` | 宿主后端独立安装 guard；非法输出不产生 `done` / 不提交 history；现有 `@nexus-ui/server` 入口保持兼容 |
| 6.2 | 扩大到 30 SKU / 90 天订单 / 20-30 个标注异常 | 每种异常 2-4 个 fixture；Agent、guard、surface 和 handler 用同一批数据验证 |
| 6.3 | 逐步加入 Daily Briefing、Monthly Review 及更多 action | 每个新 action 复用同一输入校验、领域幂等和失败状态模板 |

**Phase 6 验收口径**：guard 包在两条以上流程中验证边界一致性；OrderOps 数据规模和异常类型达到 MVP 评测要求。

---

## Phase 7：Conformance 与 Vue renderer

目标：证明 renderer 语义不绑定 React。

来源：[npm-sdk-transformation.md](npm-sdk-transformation.md) M6。

| # | 任务 | 验收 |
| --- | --- | --- |
| 7.1 | 在 Layer 0 已建立的官方/双仓 fixture 基础上扩展 renderer conformance contract | React 和 Vue 运行同一批 fixture；rendering / binding / action / error 语义一致 |
| 7.2 | 实现 `@nexus-ui/vue` renderer adapter | 与 React 共享同一批 A2UI conformance fixtures |

---

## 不做（当前 Non-Goals）

以下能力不阻塞任何阶段，除非明确的业务切片需要：

- npm 公开发布（Phase 2 只做本地 tarball 验收）。
- 认证 / 租户隔离 / 权限模型 / 通用审计平台。
- 多实例数据库持久化。
- 多 surface UI router。
- 完整 A2UI v0.9 组件集。
- 三端原生渲染。
- Vue renderer（Phase 7 才开始）。

## 评测口径提醒

- 异常识别率 / 风险拦截率 / 记录完整度：可在标注 fixture 上验证。
- 建议采纳率 / 人工修改幅度 / 真实处理时长：需要实际参与者和可复现人工基线；仅有 mock dataset 时只报告模拟结果。
- SDK 可接入：脱离 monorepo 的 tarball 安装和独立宿主闭环。
