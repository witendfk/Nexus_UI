# CURRENT — 唯一任务与进度源

更新：2026-10-30。需求、契约、结构、决策分别见 [PRD](../PRD.md)、[SPEC](../SPEC.md)、[ARCHITECTURE](../ARCHITECTURE.md)、[DESIGN](../DESIGN.md)。本文件只保留当前详细计划、后续阶段概要、已验收摘要与待办；已完成阶段的拆分、修复过程和中间快照从 Git 历史追溯，最终验收证据保留在阶段报告。

## 当前结论

**产品方向：宿主约束的 Agent UI Runtime SDK。** SDK 提供协议、Catalog、绑定、渲染、运行与交互基建；业务 prompt、模型/工具编排、业务权限与副作用由宿主负责。评审覆盖 SDK 与公开接入契约，不评审接入方业务工程；验证宿主与 Agent 尚未选定，不阻塞确定性夹具验收。

**当前节点：S4 进行中（2026-10-30）。** S4.0 已完成并复核；S4.1 会话/传输主体随 `be6a9df` 交付，复核整改覆盖 core 完整视图准入/发布/删除、client 独立候选与固定提交快照、草稿协调、recover 过期/冲突拒绝及按 surface 稳定订阅；**S4.1.4 完整矩阵已于 2026-10-30 独立签收**（acceptance.test.ts 30 项公开产物测试覆盖 17 cell，已补齐四项评审缺口，见下方签收记录）。S4.2 Provider/Surface 主体已落地，React API 为 2；S4.3 两处 client 消费迁移已实施；**S4.2 联合验收已于 2026-10-30 签收**（packages/nexus-react/test/acceptance.test.tsx 14 项 React+client 联合矩阵及 3 项控件 DOM 身份回归，三项评审问题已整改，dist 公开入口驱动，见下方签收记录）。剩余验收：**S4.4 浏览器与阶段验收**。S3.1–S3.7 已验收，随 `021f27f` 推送，历史矩阵与限制见 [S3-ACCEPTANCE](S3-ACCEPTANCE.md)。S1/S2 已验收；当前四个私有包，alpha 安装声明归 S5。按 DESIGN D12 保留分包，通过层内高层 API 简化接入。

## 阶段与依赖

| 阶段 | 状态 | 交付与依赖 |
| --- | --- | --- |
| S0 文档与评审规范 | 已完成 | 产品方向、契约/结构/决策基线、SDK review 范围 |
| S1 安全基线与业务中立 | 已验收 | 安全防护、显式装配、参考程序迁出、早期产物检查 |
| S2 Catalog v2 与交互扩展 | 已验收 | 声明驱动交互、共享准入、固定运行结果与消费方迁移 |
| S3 通用 server runtime | 已完成（2026-10-28，验收报告 [S3-ACCEPTANCE](S3-ACCEPTANCE.md)） | 依赖 S2；单一调度、Session 与提交语义、Koa/RPC 薄适配 |
| S4 client 与可嵌入 React | 进行中（S4.1 与 S4.2 联合验收已于 2026-10-30 签收；仅剩 S4.4 阶段验收） | 依赖 S2/S3；core 边界、新 client、Provider/Surface、消费方迁移 |
| S5 独立契约验收与发行 | 待实施 | 依赖 S1–S4；仓外安装、公开 API/兼容、浏览器和 CI 门禁 |

各实施切片同步消费方与迁移说明，保持已交付路径可运行；破坏性变化明确版本，不长期保留两套通用解释器。

## 已验收阶段摘要

| 阶段 | 最终交付 | 验收与追溯 |
| --- | --- | --- |
| S1 | 保留段/原型查表/媒体 URL/pattern 安全防护；预算非法值拒绝；Adapter/guard 显式装配与 runs 查询默认拒绝；参考服务迁至 examples；构建清理旧 dist | 2026-10-16 独立评审四项已修复，随 `b44b639` 推送；原始实施与验收记录见该提交的本文件 |
| S2 | Catalog Contract v2、共享解释器、声明式输入/草稿确认、服务端权威准入、固定 run 提交基准/查询/响应头、RPC/verifier 与两组 Catalog 消费验证 | 2026-10-21 阶段验收 APPROVE，无 P0/P1；随 `eb5f8cd` 推送；完整证据与限制见 [S2-ACCEPTANCE](S2-ACCEPTANCE.md) |

历史门禁：S1 在 Node v24.16.0 下 build/build:packages/typecheck、根与包 lint、根 test 均退出 0（479 项），三包 ESM 根入口和 dist 清单通过；修改文件格式检查通过，全仓 format 当时仍有 13 处既有差异。S2 最终同类工程门禁通过（851 项），conformance 36 pass / 44 已决策偏差 / 0 fail，细节以验收报告为准。上述均为历史证据，不代替后续阶段实测；当时未完成真实浏览器、仓外安装与远端 CI 验收。

## S3 — 已验收摘要

| 单元 | 最终交付 | 实施/追溯 |
| --- | --- | --- |
| S3.1 | 运行工厂/句柄、Session、提交事实、预算与共享 oracle 契约 | 2026-10-22 |
| S3.2 | 传输无关入口、唯一调度、实例隔离、公开兼容路径归一 | 2026-10-23，`565415f`，含六项复审整改 |
| S3.3 | store 确认三态、ledger 去重、扩展失败与提交事实隔离 | 2026-10-23/24，`7054e7d`，含六项复审整改 |
| S3.4 | Session v1 事件、解析/序列检查、结构化诊断 | 2026-10-24，`6bfb335` |
| S3.5 | Koa/RPC 薄适配、访问准入、消费迁移与真实 HTTP 对测 | 2026-10-27，`42d2df3`，含三项复审整改 |
| S3.6 | 资源硬边界、取消隔离、HTTP/非 HTTP 背压、持久状态预算 | 2026-10-27，`f50bd6f`，含八项复审整改 |
| S3.7 | 公开产物接入、S2 遗留处置、需求矩阵、独立门禁与交接 | 2026-10-28，`021f27f`，见阶段报告 |

最终门禁（2026-10-28，本次实测，Node v24.16.0）：build:packages、根 build、构建后 typecheck、根/包 lint、根 test 均 exit 0，1029 项测试通过；conformance 36 pass / 44 已决策偏差 / 0 fail。新增公开根入口普通 Node 加载与生成/action 验证、真实 HTTP 占用失败回归共 5 项；变更源码格式、文档链接/结构与 diff 检查通过。SDK code-review-expert 四维复核无未关闭的 S3 阻断项。命令、证据与边界只维护在 [S3 阶段报告](S3-ACCEPTANCE.md)，完成的拆分和整改过程从 Git 历史追溯。

S3 验收时仍为私有三包，未执行仓外安装、真实浏览器或远端 CI；R5 的 client 双视图隔离/恢复归 S4，R7 发行门禁归 S5。当时实测的 core 直调用数组/模型资源缺口已交接 S4.0，当前处置见下方记录，不能以 server 预算或白名单宣称全端已解决。

## S4 — client 与 Provider/Surface

入口优先核实并收紧 core 直调用的数组寻址与模型资源边界（协议更新、本地输入写回均覆盖），在 alpha/S5 前完成证伪验收；server 白名单不能代替 core 边界。

1. 新建 `@nexus-ui/client`：稳定 runtime、会话/按 surface 订阅、生成/action、取消、恢复、dispose；fetch/SSE 适配可替换且不依赖 React 或 server 实现。
2. 隔离预览、已提交视图和输入草稿。必须核对终态与本地校验；EOF 不成功，缺失确认/版本不一致标失同步并禁用 action。
3. Provider 只提供上下文，新增 `A2UISurface` 由宿主布局；renderMap/回调重渲不重置 runtime；明确外部/内部实例销毁与订阅释放。样式显式选择。
4. playground 与 standalone-host-demo 迁移到同一 client 状态机，删除复制的 SSE 消费逻辑；展示禁用态与动作出口双重门控。

完成判据：自定义控件、双 surface 独立更新/删除、缺失 done、坏流顺序、取消/晚到响应、unknown、恢复、卸载释放在 headless 和相关 React 用例验证；真实浏览器验证宿主布局嵌入、输入、action、错误反馈与基本可访问性。使用契约 fixture 即可，不依赖真实模型或指定业务应用。

### S4 交付单元与依赖（2026-10-28）

保留 S4.0–S4.4 与已有 S4.1.1–S4.1.4 编号。每个交付单元按能力验收；S4.1.2 内用 A/B/C 表示提交与复核检查点，进度只在本文件维护。每个检查点随实现补单测/证伪并执行相关门禁，S4.1.4 做跨场景验收，不承担延后的基础测试。

| ID | 交付 | 当前状态与完成判据 |
| --- | --- | --- |
| S4.0 | core 直调用边界 | **已完成并复核**：数组寻址、模型字节与组件数量上限；合法声明下输入与确认反例、生成/action 资源分类。契约见 SPEC §1.1 |
| S4.1 | 框架无关 client | **完整矩阵已签收（2026-10-30）**：独立候选/原子发布、草稿协调、固定提交快照、recover、稳定订阅与传输；依赖 core，与 React/server 实现无依赖 |
| S4.2 | React Provider/Surface | **联合验收已签收（2026-10-30）**：Provider 只提供上下文；A2UISurface 按宿主布局与 surfaceId 独立渲染。稳定 runtime/快照、可解除订阅、无并发状态撕裂；标准/自定义动作禁用态和出口门控；外部实例归创建者销毁，自建实例卸载释放；样式显式选择；配置/父重渲不重置状态。React+client 联合矩阵见下方签收记录 |
| S4.3 | 消费方迁移 | **已实施（2026-10-29）**：两处浏览器只经公开 client 根入口生成/action/取消/销毁；复制的 SSE、基准、信封与草稿确认逻辑已删除。只读 A2UIPreview、已提交 Surface 和自定义动作禁用/出口双门控；共享 DAG 重复 key 修复并验证 patch/重排 DOM 身份。验收证据见下方 S4.3 记录 |
| S4.4 | S4 阶段验收 | **待实施，依赖 S4.2 联合验收**：汇总 headless/React 矩阵，实际执行浏览器布局/输入/action/错误反馈/可访问性与根门禁、conformance；记录 S4-ACCEPTANCE 和 S5 交接。仓外安装、发行产物与远端 CI 仍归 S5 |

当前剩余验收：**S4.4 浏览器与阶段验收**（S4.1 完整矩阵与 S4.2 联合验收均已签收）。S4.3 实施和定向回归不替代 S4.4 阶段验收，也不代表 S4 整体完成。

### S4.1 子任务与状态

| ID | 核心交付 | 当前状态、职责与退出条件 |
| --- | --- | --- |
| S4.1.1 | 会话契约与包骨架 | **契约已收口（2026-10-29）**：SPEC §7 已明确 recover 输入/拒绝/状态转移、按 surface 订阅与稳定快照、runtime 装配与销毁所有权；重复 action 显式 ignored，不同 surface 独立 |
| S4.1.2 | 视图隔离、草稿协调与恢复 | **A/B/C 三个检查点已实现（2026-10-29）**：core 完整 Protocol/Profile/Catalog/引用/预算重验、原子发布、草稿协调与渲染清理；client 独立候选、固定提交快照、recover 过期/冲突拒绝及旧 run 失效、按 surface 稳定订阅；已随 2026-10-30 完整矩阵签收 |
| S4.1.3 | fetch/SSE 传输适配 | **已实现，定向传输回归通过**：POST、运行标识头透传、content-type 门控（非 event-stream 拒绝）、UTF-8/分帧、abort/reader 释放；可注入替换。Session 事件语义与顺序由会话层复用 core 解析/检查。帧/总字节/建连/空闲/总时长预算已明确并实现（SPEC §7），不延期到 React |
| S4.1.4 | headless 公开契约验收 | **已签收（2026-10-30）**：`test/acceptance.test.ts` 30 项从构建产物入口驱动共享 fixture oracle（accept-generation/accept-action-with-inputs/reject-admission-stale-revision），17 cell 证据见下方签收记录 |

**S4.1.2 的三个检查点**（主体及本轮整改已实现；最终以矩阵签收为准）：

| 检查点 | 交付边界 |
| --- | --- |
| A · core 受控状态原语 | 先盘点现有 store/订阅/草稿原语；补完整 surface 快照读取、校验后原子替换与删除、稳定读取和按 surface 订阅。入界/出界引用隔离，替换与删除协调草稿；完整执行 Protocol/Profile/Catalog、引用完整性与资源边界。core 只处理视图内容/声明，不解释 Session done、不联网。精确公开类型随实现写回 SPEC/ARCHITECTURE |
| B · client 预览与提交隔离 | 基于 A 分开预览和已提交视图，保持公开 runtime 身份稳定；按 surface 管理运行所有权和订阅快照，向 S4.2 提供稳定读取。仅本次完整生成的视图可提升；action 基于实际提交基准；成功完整接受后提升视图与基准，失败丢弃预览，按提交事实及基准可信度保留或关闭 action。所有收敛路径使用受控原语 |
| C · 草稿协调与完整恢复 | **已实现**：发送时 extract，成功只 confirm 发送代次；recover 重验完整视图与提交身份，成功一次恢复视图/基准/动作资格并使旧 run 失效（superseded 晚到防护）；恢复拒绝保持原状态 |

各检查点的验收清单：

- **A**：同 Catalog/路径合法替换成功后，非法 schema/引用/预算整体拒绝，视图/有效草稿不变；修改传入或返回嵌套对象不污染内部状态；替换/删除 surface B 不改变 surface A，也不触发 A 的专属订阅；状态未变时快照引用稳定；解除订阅后不再通知。
- **B**：正常生成/action 成功提升；done-only、缺 root、坏消息或缺 done 不提升；notCommitted/unknown/取消后预览不污染提交视图；失同步保持动作关闭；同步 dispose、晚到帧及同 surface 运行竞争不复活/覆盖视图；双 surface 独立。基础输入仍可用，完整请求期间编辑语义在 C 验收。
- **C**：挂起真实请求后继续编辑，验证可见值与下次 inputs 一致；成功不误删新 serial，失败/取消不误确认。合法恢复重新启用匹配视图；过期/身份错配/非法/超预算恢复不改视图、基准与草稿；恢复后旧响应不能再写入。recover 不用查询到的最新 revision 给旧视图续资格，不自动重试业务 action。

**S4.1.4 验收矩阵**：自定义输入/action、两个 Catalog、双 surface 独立更新/删除、缺失 done、坏顺序、done-only 生成、身份/版本错配、本地拒绝、发送不确定性、同步取消/销毁、晚到响应、unknown、合法/非法恢复、请求期间编辑、稳定快照、订阅与 dispose 幂等释放。断言视图、草稿、固定基准、动作门控和资源清理；复用 A/B/C 的定向证据并补跨模块公开入口对测，不复制同名手写场景替代共享 oracle。

**2026-10-30 完整矩阵签收复核**：原 18 项版本经 SDK review 发现四项证据缺口，现已补强为 `packages/nexus-client/test/acceptance.test.ts` **30 项**。运行时与类型均从构建产物公开根入口消费（core 经 workspace dist、client 经 `../dist/index.js`），无源码导入。共享 oracle 的实际消费帧先经 core 解析/序列检查，再与 `expected.events`、终态/提交事实及 revision 对拍；响应按场景事实构造，未从 expected 反推。客户端签收范围为帧消费、请求体、视图/草稿/基准、动作门控和资源释放；工厂/handler 调用次数及真实服务端交错仍由 S3 的服务端对测覆盖。

| 矩阵 cell | acceptance.test.ts 证据 |
| --- | --- |
| 自定义输入/action | accept-action-with-inputs oracle：捕获真实请求，核对 inputs、context、actionId、revision/hash，成功确认发送草稿 |
| 两个 Catalog | 「双 Catalog 与双 surface 隔离」分别生成并保留各自提交 |
| 双 surface 更新/删除 | 「稳定快照与按 surface 订阅」实际 patch B，A 视图引用/通知不变；「双 Catalog 与双 surface 隔离」受控删除 A，B 保留 |
| done-only 生成 | 「done-only 生成（无视图消息）」拒绝提升 |
| 本地拒绝 | 「runtime dispatchChecked 拒绝非法组件」无半提交 |
| 缺失 done | 「EOF 无终态」候选不发布、动作关闭 |
| 坏消息顺序 | 「message 先于 start、start 前终态」 |
| 身份/版本错配 | hash/runId 错配；4 项非法 done revision（相同/倒退、缺省/旧 start），断言候选、草稿、固定基准不提升；stale oracle 保留本地 revision 1，实际消费权威 start revision 2 后拒绝重发 |
| 发送不确定性 | 已调用 open 后抛错；「已发送、未收到帧时取消」保留草稿并关闭动作 |
| 同步取消/销毁 | busy 订阅内分别同步 cancel/dispose；确认 action 未调用 transport.open，自建实例销毁后不复活 |
| 晚到响应 | 以消费屏障验证取消后晚到 done；opening/reading 时 dispose，晚到 patch 不写入候选或公开视图 |
| unknown | error/unknown 关闭动作且保留旧 revision |
| 合法恢复 | accept-generation：失同步后以同次固定视图与提交恢复动作资格 |
| 非法恢复 | 过期/身份冲突/内容冲突/超预算均拒绝，视图/基准/草稿不变 |
| 请求期间编辑 | 等待实际 open 挂起后编辑；核对当前发送 inputs、成功后可见模型与固定提交隔离、下次 inputs 一致 |
| 稳定快照 | 按 surface 通知隔离、未变引用稳定、更新后换代 |
| 订阅与 dispose 幂等释放 | 空闲/同步/在途销毁和重复解除；4 条正常/拒绝路径实际 close；在途 opening/reading 响应关闭；默认 fetch/SSE 真实 reader cancel |

四项复核整改：补请求体与编辑全链断言；补同步/在途 dispose、abort/close/reader cancel 与晚到写入观测；补相同/倒退 done revision；补共享 oracle 独立期望对拍（action 基础模型 + handler patch 为两条 message，stale start 为权威 revision 2）。晚到测试以屏障替代固定 sleep。

证伪实测均在临时产物/fixture 副本执行，仓库源码与正常产物保持完整：删除 inputs 发送 → 2 项失败；跳过 response.close → 6 项失败；跳过 dispose abort → opening/reading 两项均失败；移除 action revision 前进检查 → 3 项失败；分别篡改 generation/action/stale 三份 oracle 的 expected.start revision → 各 1 项失败，七组均 exit 1。正常副本 30/30 通过。core/client/React 定向回归继续作为第二层证据。

本次复核整改 Node v24.16.0 实测：根 build（含两处 Vite 生产构建）、构建后 typecheck、根/递归包 lint、根 test 均 exit 0；**1173 项通过**（core 360+14/client 108/server 448/React 61/playground 34/standalone 45+12/参考服务 91），公开产物验收由 18→30 项，client 由 96→108 项。变更源码 prettier、文档本地链接/矩阵结构和 `git diff --check` 通过。SDK review 四维复核，四项评审问题已关闭。真实浏览器、仓外安装、远端 CI 仍未执行，归 S4.4/S5。

受控恢复数据由宿主提供可信来源，SDK 验证结构与视图/提交身份的一致性，不建设业务结果库或强制新增恢复 HTTP 路由。React 仍可只消费本地 core runtime；S4.2 的此路径用不依赖 client 的用例单独验收。

**2026-10-29 复核整改范围**：已授权的全部 P1/P2——隔离候选、恢复全链准入/版本拒绝/可信来源边界、观察者异常隔离、受控删除渲染清理、renderMap 更新、自定义动作统一门控、消费入口构建与订阅释放、稳定会话快照及文档一致性。core 仍不解释 Session；恢复权威来源由宿主保证，不声称任意 JSON 可认证。React API 2 的显式 Surface/样式迁移见包 README。

本轮 Node v24.16.0 实测：先构建 core，最终根 build、构建后 typecheck、根/递归包 lint、根 test 全部 exit 0；**1149 项通过**（core 360+14/client 84/server 448/React 58/playground 38/standalone 45+11/参考服务 91），conformance 36 pass / 44 已决策偏差 / 0 fail。相对评审快照新增 26 项定向反例（core 7/client 12/React 7）。临时撤销候选隔离、恢复 Profile、删除根缓存、自定义 action 门控、renderMap 更新五组保护，对应测试均 exit 1，失败数 5/1/1/2/1；完整恢复源码后最终门禁通过。根 test 首次受沙箱 tsx IPC EPERM 阻止，授权原命令重跑 exit 0。变更源码格式、文档本地链接/结构、diff 检查通过；按 SDK review 四维复核，本轮已授权缺陷已关闭。真实浏览器、仓外安装、远端 CI 与 S4 阶段验收仍未执行；该次快照的 React 共享 DAG 重复 key 警告已由下方 S4.3 修复。

**已交付与验证基线（2026-10-28，`be6a9df`）**：会话主体与传输已实现，六项 P1 已关闭（逐条本地准入、发送不确定性、准入门控、重入/EOF 失效、错误体有界清理、分片无关帧预算）。Node v24.16.0 下先构建 core，再执行根 build、构建后 typecheck、根/递归包 lint、根 test，均 exit 0，**1106 项通过**（core 360/client 62/server 448/React 51/playground 38/standalone 45+11/参考服务 91）；新增 core 2/client 27 项，七组撤销保护实验失败 4/1/2/1/1/1/4 项，恢复源码后通过。根 test 首次因沙箱 tsx IPC EPERM 退出，经授权原命令重跑通过；源码格式、文档链接/结构和 diff 检查通过。此为已提交快照的历史证据，不代表本次任务重划或完整 S4.1 已验收；真实浏览器、仓外安装、远端 CI 未执行。

**S4.0 实施与复核记录（2026-10-28）**：core 直调用边界收紧落地，三项评审整改已关闭；本切片提交从 Git 历史追溯。

- 数组越界确定性拒绝：`setValueAtPath`/`removeAtPath`（协议 updateDataModel 路径）与 `setStrictPath`（server inputWrites 与本地输入写回共用路径）——数组容器只允许修改界内元素或在末尾紧凑追加（index === length），越界跳写与越界删除一律抛 `DataModelResourceLimitError`（code `RESOURCE_LIMIT_EXCEEDED`，core 公开导出）；拒绝自动建数组时造稀疏空洞。server 生成与 action 提交前失败共用分类，返回确定性 notCommitted + RESOURCE_LIMIT_EXCEEDED；对照验证拒绝不发布状态、不推进 revision，合法紧凑追加仍可提交。
- 模型规模上限（RuntimeOptions 新增，默认常开，非法值构造抛错）：`maxDataModelBytes`（默认 1 MiB，UTF-8 JSON）——updateDataModel 应用后超限整条消息以 FEATURE_UNSUPPORTED 结构化拒绝（状态不变），setInputValue/confirmInputDrafts 超限返回 false（全或无语义不变）；`maxComponentsPerSurface`（默认 10000，与渲染 maxNodes 同量级）——updateComponents 超限整条消息拒绝。均不依赖 catalogRegistry 注入。
- 证伪入口改为 core `test/runtime/model-bounds.test.ts`（12 项），合法 Catalog 下证明输入界内/恰好上限可写、超 UTF-8 字节拒绝且模型/草稿不变；补实际输入数组越界/紧凑追加与 confirm 恢复超限的整体拒绝/合法恢复对照。server `test/agent/storage-budgets.test.ts` 补生成/action 同类错误与 revision 原子性。临时移除输入字节检查、确认字节检查、生成资源映射时，对应三组测试均断言失败（exit 1），随后完整恢复源码。此前缺声明的假阳性测试已替换。
- 本轮 Node v24.16.0 实测：先构建 core，再执行根 `pnpm build`、构建后 `pnpm typecheck`、根 `pnpm lint`、`pnpm -r --if-present lint`、根 `pnpm test`，均最终 exit 0；根测试 **1042 项通过**（core 358、server 448、React 51、playground 38、standalone 45+11、参考服务 91），含 conformance 36 pass / 44 已决策偏差 / 0 fail。根 test 首次在沙箱内因 tsx IPC socket `listen EPERM` 退出 1，经授权在沙箱外重跑同一命令后完整通过；不以单包重跑代替根门禁，不对未复现的并行失败归因环境。变更 TypeScript 格式、文档链接/表格结构与 `git diff --check` 通过；SDK review 四维复核未发现未关闭项。未执行真实浏览器、仓外安装或远端 CI。

### S4.2 联合验收（2026-10-30，评审整改复核）

原 10 项联合验收经 SDK review 发现 1 项实际缺陷与 2 项证据缺口：同名组件的 DOM id 跨 surface 串联；“晚到 done”脚本只有 start + EOF；只读预览未验证输入写回。三项已整改，当前 `packages/nexus-react/test/acceptance.test.tsx` **14 项**与 `test/components/input-dom-id.test.tsx` **3 项**均从构建产物公开根入口消费（react 经 dist，core/client 经 workspace 包根入口）。

联合装配与参考宿主同口径：宿主在 runtime 的 `onAction` 转发 `session.action`，按 `actionOpen && !busy` 设置 `A2UISurface.actionsEnabled`。主链、预览与 reader 释放走真实 `fetchSseTransport` + fetch mock（SSE ReadableStream、运行标识头）；晚到 message/done 两项使用故意忽略 abort 的可替换 transport，以保证帧确实交付，不把底层取消成功当作失效检查证据。react 仅新增测试 devDependency `@nexus-ui/client: workspace:*`，生产依赖与 API 版本不变。

TextField 的控件/错误 DOM id 与 Slider 的错误 DOM id 改用 React `useId`，每个挂载实例独立，覆盖跨 surface、同 surface 的预览/提交以及重复挂载；标签、aria-describedby 指向本实例。SDK 输入写回仍使用协议 componentId + surfaceId，普通 patch 保持 DOM 节点与 id 稳定。既有 Provider checks 测试改断言实际错误关联，不再绑定固定字符串 id。

| 联合矩阵 cell | 公开产物证据 |
| --- | --- |
| 全链：生成→渲染→输入→action→patch | 请求体固定 revision/hash、inputs 草稿、非空 actionId 及信封关联；提交后渲染与基准推进 revision 2 |
| 生成中只读预览→提交挂载 | 真正挂起 done；预览期零 action 出口、无提交视图，交付 done 后预览清除并开放动作 |
| 预览禁止输入与自定义 action | 标准/自定义控件两项；已有提交视图与候选共存，预览 change/click/key 不达 runtime，模型、草稿和固定提交不变 |
| 请求期间编辑 | 同一挂起 action 中编辑提交视图；成功后新编辑仍可见，与下次实际 inputs 一致；固定提交保持服务端归一化结果 |
| desync（EOF 无终态） | 旧视图保留、动作关闭、renderer 出口不达 runtime、无第二次出网 |
| desync（commitState unknown） | 同上收敛，基准不推进 |
| 自定义组件键盘/变更门控 | 无原生 disabled 的自定义动作在 unknown 后不达 runtime |
| 合法/非法恢复 | 身份错配恢复拒绝且 UI 保持禁用；合法恢复开放动作并完成后续 action |
| 双 surface 与 DOM 身份 | 独立更新/删除和动作资格；每个 label.control 指向本 surface。3 项控件回归覆盖 TextField/longText/Slider 错误关联、重复挂载、patch 身份与协议写回参数 |
| 外部/自建所有权与配置重渲 | 外部 runtime 跨重渲/卸载保持；创建者 dispose；自建 runtime 探针证明配置重渲不重建 |
| 在途卸载/销毁与晚到隔离 | 真实 fetch signal abort、reader cancel 并等待 action 结束；另两项以消费屏障实际交付晚到 message/done，候选、外部视图/草稿与独立观察者 DOM 不变，tracking/基准不复活、响应仅 close 一次 |
| 样式显式选择 | import 无自动注入，injectNexusStyle 幂等 |

本轮证伪在临时构建产物副本执行（仓库源码与正常 dist 未改）：恢复旧 DOM id → 5 项失败；把预览写回接到真实 runtime → 2 项失败；把预览 action 接到真实 runtime → 1 项失败；移除 client 运行有效性检查 → 晚到 message/done 两项失败（分别观察候选被写入与错误 committed）。四组均为断言失败、exit 1，正常副本 17/17 通过。原门控/runtime 稳定性证伪属于整改前的历史证据，不替代本轮验证。

本次整改 Node v24.16.0 实测：根 build（含两处 Vite 生产构建）、构建后 typecheck、根/递归包 lint、根 test 均 exit 0；**1190 项通过**（core 360+14/client 108/server 448/React 78/playground 34/standalone 45+12/参考服务 91）。React 由 71→78，联合矩阵 10→14，新增控件身份回归 3 项。根 test 首次受沙箱 tsx IPC EPERM 阻断，授权后同命令完整通过。变更 TypeScript 格式、文档本地链接/矩阵结构与 git diff 检查通过；SDK review 四维复核，三项问题已关闭。真实浏览器、仓外安装、远端 CI 本轮未执行，仍归 S4.4/S5；S4 不因本节点签收而整体完成。

### S4.3 消费方迁移（2026-10-29）

- 两处应用新增 `@nexus-ui/client: workspace:*`，只经公开根入口装配同一个 client 实现；会话拥有稳定 runtime，Provider 显式注入。生成/action/失败/取消/晚到/卸载的 Session 判断、固定基准与草稿发送确认由 client 负责；宿主只保留布局、Catalog 加载和控件状态。
- `A2UIPreview` 是不依赖 client 的纯 React 展示入口，从已准入候选快照构建 VNode；原生 fieldset 禁用，输入写回和 action 回调均关闭。生成逐步预览，完整成功才挂载 `A2UISurface`；action 期间保持提交界面及输入可编辑。业务结果仍由宿主认定。
- 宿主重新生成明确销毁旧会话并 keyed 重挂 Provider；切换 Catalog、卸载解除订阅并 dispose；取消只作用于在途请求，失同步旧视图保留展示并禁动作。标准和自定义 action 组件同时展示禁用态与统一回调门控，非 Button 夹具补键盘入口。
- 删除两份 SSE 工具、playground action 信封工具与其 9 项实现专属测试；公共 transport 保留分片/超时/取消/资源回归，补 metadata/多行/尾帧证据。浏览器夹具补 Session v1 start，失败生成验证候选清除，卸载断言真实准入/发布边界。
- renderer 以同父级的 `[componentId, occurrence]` 标识引用，涵盖正常、占位、未知和预算降级，重复引用无 React key 警告；普通 patch、不同 id 重排保留 DOM 身份。

本轮 Node v24.16.0 实测：根 build（含两处 Vite 生产构建）、构建后 typecheck、根/递归包 lint、根 test 均 exit 0；**1150 项通过**（core 360+14/client 85/server 448/React 61/playground 34/standalone 45+12/参考服务 91），conformance 36 pass / 44 已决策偏差 / 0 fail。新增 10 项回归，删除旧工具专属 9 项，净增 1 项。根测试首次因沙箱 tsx IPC EPERM 中止，授权同命令重跑后完成。新 transport 断言按实际公开可选 id 形状校准；未放宽实现契约。key 保护撤销实验 exit 1（重排残留旧输入），恢复后 React 61 项通过；冻结只读预览 context 后补构建 React 并再次通过定向测试。源码格式、40 个本地文档链接/结构与 diff 检查通过。SDK review 四维复核无本轮未关闭的 actionable finding。

真实浏览器布局/可访问性验收仍归 S4.4；S4.1 完整矩阵独立签收与 S4.2 联合验收已于 2026-10-30 完成，不由本轮定向证据替代；仓外安装和远端 CI 归 S5。

## S5 — 当前产物验收与发行

- API 定型后，在仓外干净 React + Node 项目仅使用公开根入口完成 PRD §5.1；验证生成源、Catalog、transport 和 handler 可替换，非 Koa 路径一致。该项目是 SDK 契约验收夹具，具体宿主 Agent 仍可后续选择。
- 按 DESIGN D10 统一 ESM + 类型声明与可选样式；显式 .js 源码路径/NodeNext 迁移和产物验证后移除 fix-esm-imports。校验四包 types/exports/files/依赖/兼容声明、加载副作用、API 快照与升级说明；测试须基于本次构建产物，不能用源码直链代替。
- 当前 conformance 及偏差、根 typecheck/lint/test/build/format、干净环境 CI 与浏览器关键路径有实际执行证据。先标注支持子集和限制，再按 PRD 门禁决定 alpha/正式发行；未通过不宣称 production-ready。
- workspace 同居期不刷 tarball；真实拆分/发行时按 AGENTS.md 恢复版本与消费端同步规则。包管理器/Node 声明与实际 Node 24 门禁一致性在产物检查中核实。

## 待办归属与暂缓项

只列未完成项；已解决问题不再重复挂账。S2 报告中的历史问题表不自动等于当前阶段新增承诺，具体实施以本计划和契约决策为准。

| 待办 | 归属与处置 |
| --- | --- |
| NodeNext/ESM 修补脚本、运行环境声明一致性、仓外安装/真实浏览器/远端 CI | 按 S4/S5 实际验收范围推进，不引用历史单测替代 |
| 每消息全量组件重校验的增量优化 | 保持有界正确行为；优化暂缓，依据真实瓶颈决定 |
| 独立 Catalog 包、Vue、完整 v0.9/v1.0、分布式调度 | 非首发范围，暂缓 |

## 验证与文档维护

代码门禁遵循根 AGENTS.md：Node 24、相关单测/typecheck、根与相关包 lint、构建；跨包改动加根 test。core API 变更先构建 core 再跑 React 测试；安全/隔离/幂等声明须有证伪测试，显著或协议面变更须执行 SDK review。仓外、浏览器与 CI 结论只使用实际环境证据。

文档维护：当前阶段保留可执行细项；验收后收敛为交付摘要、最终证据入口及未解决事项，移除已完成拆分、重复修复日志和被取代快照。契约/结构/决策回到主链文档，阶段报告保存验收证据，过程由 Git 追溯，CURRENT 不追加会话流水账。
