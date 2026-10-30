# CURRENT — 唯一任务与进度源

更新：2026-10-30。需求、契约、结构、决策分别见 [PRD](../PRD.md)、[SPEC](../SPEC.md)、[ARCHITECTURE](../ARCHITECTURE.md)、[DESIGN](../DESIGN.md)。本文件保留当前计划、阶段摘要与待办；完成的拆分和整改过程从 Git 历史追溯，最终证据在阶段报告维护。

## 当前结论

**产品方向：宿主约束的 Agent UI Runtime SDK。** SDK 提供协议、Catalog、绑定、渲染、运行与交互基建；业务 prompt、Agent/模型编排、业务权限与副作用由宿主负责。只评审 SDK 及公开接入契约；业务宿主与 Agent 尚未选定，不阻塞确定性夹具验收。

**当前节点：S4 已完成阶段验收，S5 待启动/细拆（2026-10-30）。** S4.4 汇总 headless/React 矩阵并实际执行浏览器关键路径；修复 Surface 动作禁用向输入传播的可访问性问题。根构建/类型/根与包 lint/1190 项测试通过，conformance 36 pass / 44 已决策偏差 / 0 fail；全仓格式检查仍有 5 处既有问题。最终证据与限制见 [S4-ACCEPTANCE](S4-ACCEPTANCE.md)。前置实现基线为已推送的 `1495238`；本轮交付包含浏览器夹具、可访问性修复与文档收口。

当前 core/client/react/server 四个私有包，workspace 使用不等于已可发行；alpha 安装、NodeNext/ESM 迁移、兼容与远端 CI 仍归 S5。按 DESIGN D12 保持职责分包，通过层内高层 API 简化接入，不新增总门面包。

## 阶段与依赖

| 阶段 | 状态 | 交付与证据 |
| --- | --- | --- |
| S0 文档与评审规范 | 已完成 | 产品方向、契约/结构/决策基线与 SDK review 范围 |
| S1 安全基线与业务中立 | 已验收 | 2026-10-16 复核、随 `b44b639` 推送；保留段/原型/媒体 URL/pattern、预算拒绝、显式装配与参考服务迁出；原始记录见该提交 |
| S2 Catalog v2 与交互扩展 | 已验收 | 2026-10-21，随 `eb5f8cd` 推送；声明式输入/action、共享准入、固定运行结果与消费迁移；见 [S2-ACCEPTANCE](S2-ACCEPTANCE.md) |
| S3 通用 server runtime | 已验收 | 2026-10-28，随 `021f27f` 推送；唯一调度、Session/提交三态、访问准入、预算/背压与 Koa/RPC 薄适配；见 [S3-ACCEPTANCE](S3-ACCEPTANCE.md) |
| S4 client 与可嵌入 React | 已验收 | 2026-10-30；core 直调用边界、候选/提交/草稿、恢复、Provider/Surface、消费迁移与真实浏览器；见 [S4-ACCEPTANCE](S4-ACCEPTANCE.md) |
| S5 独立契约验收与发行 | 待启动 | 依赖 S1–S4；当前产物仓外安装、API/兼容/升级、完整格式和远端 CI |

S1/S2/S3 的测试总数与门禁为历史证据，以各阶段报告为准；不能替代当前产物验证。各切片同步消费方和迁移说明，不长期维护两套通用解释器。

## S4 — 已验收摘要

| 单元 | 最终交付 | 当前证据 |
| --- | --- | --- |
| S4.0 | core 直调用数组寻址、模型字节/组件数量预算，原子拒绝 | core model-bounds 与 server storage-budgets 正反例 |
| S4.1 | 框架无关 client；稳定 runtime/订阅、独立候选、固定提交、草稿代次、恢复、可替换 fetch/SSE | 2026-10-30 完整矩阵签收：公开产物 30 项 / 17 cell，client 共 108 项 |
| S4.2 | Provider/Surface、只读 Preview、动作出口门控、外部/自建所有权、显式样式 | 2026-10-30 联合矩阵 14 项 / 12 cell，DOM 身份 3 项，React 共 78 项 |
| S4.3 | 两处浏览器只经 client 公开入口；删除重复 SSE/基准/草稿状态机 | 2026-10-29 实施；本轮真实 HTTP 基本表单与自定义 scorecard 回流通过 |
| S4.4 | 浏览器/工程门禁、SDK review、报告和交接；完成细项收口 | [最终阶段报告](S4-ACCEPTANCE.md)；本轮可访问性缺陷已修复并经实际 AX 与临时产物证伪 |

本轮 Node v24.16.0 实测：根 build、构建后 typecheck、根/递归包 lint、根 test 均 exit 0，1190 项；conformance 36/44/0。全仓格式检查 exit 1 的 5 处问题已明确交接，S4.4 变更定向格式通过。浏览器为实际内置浏览器默认视口，不代表移动端、多浏览器、实际屏幕阅读器或完整 WCAG；未执行仓外安装和远端 CI。完整 headless/React/浏览器矩阵、命令与证据只维护在报告。

## S5 — 当前产物验收与发行

- API 定型后，在仓外干净 React + Node 项目仅使用公开根入口完成 PRD §5.1；验证生成源、Catalog、transport 和 handler 可替换，非 Koa 路径一致。该项目是 SDK 契约验收夹具，具体宿主 Agent 仍可后续选择。
- 按 DESIGN D10 统一 ESM + 类型声明与可选样式；显式 .js 源码路径/NodeNext 迁移和产物验证后移除 fix-esm-imports。校验四包 types/exports/files/依赖/兼容声明、加载副作用、API 快照与升级说明；测试须基于本次构建产物，不能用源码直链代替。
- 当前 conformance 及偏差、根 typecheck/lint/test/build/format、干净环境 CI 与浏览器关键路径有实际执行证据。先标注支持子集和限制，再按 PRD 门禁决定 alpha/正式发行；未通过不宣称 production-ready。
- workspace 同居期不刷 tarball；真实拆分/发行时按 AGENTS.md 恢复版本与消费端同步规则。包管理器/Node 声明与实际 Node 24 门禁一致性在产物检查中核实。

## 待办归属与暂缓项

只列未完成项；已解决问题不再重复挂账。S2 报告中的历史问题表不自动等于当前阶段新增承诺，具体实施以本计划和契约决策为准。

| 待办 | 归属与处置 |
| --- | --- |
| NodeNext/ESM 修补脚本、运行环境声明一致性、仓外安装/浏览器兼容/远端 CI | S4 已完成默认内置浏览器关键路径；S5 验证目标兼容矩阵与当前发行产物，不引用历史单测替代 |
| 全仓 5 处既有格式问题 | S5 完整格式门禁前清理；路径见 S4 报告，保留当前无关工作区改动 |
| 每消息全量组件重校验的增量优化 | 保持有界正确行为；优化暂缓，依据真实瓶颈决定 |
| 独立 Catalog 包、Vue、完整 v0.9/v1.0、分布式调度 | 非首发范围，暂缓 |

## 验证与文档维护

代码门禁遵循根 AGENTS.md：Node 24、相关单测/typecheck、根与相关包 lint、构建；跨包改动加根 test。core API 变更先构建 core 再跑 React 测试；安全/隔离/幂等声明须有证伪测试，显著或协议面变更须执行 SDK review。仓外、浏览器与 CI 结论只使用实际环境证据。

文档维护：当前阶段保留可执行细项；验收后收敛为交付摘要、最终证据入口及未解决事项，移除已完成拆分、重复修复日志和被取代快照。契约/结构/决策回到主链文档，阶段报告保存验收证据，过程由 Git 追溯，CURRENT 不追加会话流水账。
