---
name: code-review-expert
description: 评审 Nexus SDK 的代码、公开契约和架构边界，适用于 SDK review、显著变更提交前检查和里程碑验收；不评审接入方应用的内部工程或业务规则。
---

# Nexus SDK Review

评审对象是 Nexus SDK 的正确性、安全、扩展性与可交付性。当前包、目标结构和任务状态以仓库文档为准，不把目标保证当作现有实现。

## 范围与授权

- SDK 源码、公开入口、依赖、构建产物、测试、协议与设计文档属于范围。
- 仓内示例、参考服务和独立验收夹具只检查其 SDK 公开入口消费、契约一致性，以及是否掩盖 SDK 缺陷；不审查其业务算法、数据模型、事务设计或应用分层。
- 验证宿主与 Agent 尚未选定时，使用可替换的生成源、Catalog、transport 和 handler fixture。不能以缺少真实宿主为由阻塞 SDK 评审，也不能借评审替用户选定宿主工程。
- 宿主身份、权限和业务事实属于边界：检查 SDK 是否提供并执行必要的准入回调、是否错误信任客户端或模型；不规定接入方采用某张表、领域幂等键、数据库或框架。
- 默认只评审。用户已授权修复或文档调整时，直接完成授权范围；公共 API/依赖变化先说明影响。提交、推送和外部操作仍遵循会话授权与根 AGENTS.md。

## 工作方式

1. 读根 AGENTS.md、docs/tasks/CURRENT.md，按问题读取 docs/PRD.md → SPEC.md → ARCHITECTURE.md → DESIGN.md。核对源码，不复用旧快照作为本轮证据。
2. 确认范围：改动评审查看 git status、staged/unstaged diff；方向评审追踪公开入口和完整数据流。保留已有工作区改动，不扩展到接入方工程。
3. 按相关清单检查。代码评审覆盖四个维度；文档或架构评审只加载相关清单。通用准入与输入解释应可复用，组件扩展不应依赖业务名分支。
   - [SOLID 与包边界](references/solid-checklist.md)：依赖、扩展点、公开 API 与框架耦合。
   - [安全与可靠性](references/security-checklist.md)：不可信输入、action、状态、流与资源。
   - [代码质量与验证](references/code-quality-checklist.md)：错误、所有权、兼容、证伪与产物。
   - [删除与迭代](references/removal-plan.md)：SDK/示例隔离、迁移收益、风险和验收。
4. 对每个 finding 给出可达路径、触发条件、后果和修复建议；绑定实际文件行。区分已证实问题、待验证风险与产品取舍。无法验证时说明缺失证据，不把猜测写成缺陷。
5. 只运行与范围有关的只读检查或必要验证；遵守 Node/构建顺序。只评审不触发安装、改码或自动格式化；已授权实施时运行相应门禁。明确区分本轮结果与历史证据。

## 重点判断

- SDK 提供协议、Catalog、绑定、运行和交互机制；宿主提供业务规则。安全基线不随业务 Policy 的替换而被绕过。
- 协议接受、UI 提交和宿主业务结果分别判断。流失败不证明业务失败；SDK 不自动重试业务 action 或回滚宿主副作用。
- core、浏览器会话、React 视图和服务端运行各有职责；实际包数与 API 以当前源码为准。非默认 Catalog、自定义输入/action、两个 surface 与非框架消费能否通过公开契约接入，是扩展性证据。
- 生产级声明依赖当前产物、失败反例和实际环境证据；不以示例运行成功或测试数量代替。

## 输出

先给 APPROVE / REQUEST_CHANGES / COMMENT 与主要结论，再按 P0–P3 分组列出 findings（位置、触发条件、影响、建议），随后给删除/迭代计划和验证范围。无 actionable finding 时明确写出，并说明未验证项。

- P0：可达安全、数据丢失或严重正确性问题，阻断合并。
- P1：逻辑错误、重大架构边界违反或性能回退，合并前应修。
- P2：影响维护和演进的问题。
- P3：非阻断的命名或风格建议。

文件级问题逐条附 `::code-comment{title="[P1] 简短标题" body="触发条件、后果与建议" file="绝对路径" start=行号 priority=1}`，priority 对应 0–3；范围评审的整体决策无需强行绑定某行。

用户仅要求评审时，结束前询问修复范围；用户已授权实施时完成授权工作并报告结果，不重复征求确认。不默认生成提交或 commit message。

来源：参考 [sanyuan0704/sanyuan-skills](https://github.com/sanyuan0704/sanyuan-skills) 的 code-review-expert，按 Nexus SDK 范围重写。
