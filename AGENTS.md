# Nexus UI — 工作区指令

## 双仓关系（每次会话必读）

本仓与同级仓 `../orderops-agent` 是固定双子仓：本仓是受约束 A2UI v0.9 运行时（协议/Catalog/Policy 校验、surface 状态、渲染、SDK 打包），`orderops-agent` 是独立的 OrderOps Copilot 业务工程（agent-server / host-server / web 三包）。依赖方向单一：对方通过 `tarballs/*.tgz` + pnpm overrides 只消费本仓公开入口。硬规则：

1. 本仓合并加固或能力变更后，提醒并配合对方仓执行 `pnpm pack:nexus` + `pnpm install` 刷新快照；对方进 M2 前必须消费含 Layer 0 加固的产物。
2. Catalog/校验行为变更用同一批 fixture 双仓验证（本仓 conformance 用例 + 对方 guard 测试）。
3. 本仓组件层迭代计划见 `docs/component-iteration.md`（Layer 2 批次由 orderops 业务需求拉动）；OrderOps 的业务模型绝不进入本仓通用包。

## Code Review 标准（强制）

所有代码 review（如 "review 这次改动"、"审查代码"、提交前检查）必须按工程级 skill
`.zcode/skills/code-review-expert/SKILL.md` 执行：

- **严重级别**：P0（安全/数据丢失/正确性，阻断合并）、P1（逻辑错误/重大 SOLID 违反/性能回退，合并前应修）、P2（代码坏味道/可维护性）、P3（风格/命名/小建议）。
- **review 维度**：SOLID 与架构边界、安全与可靠性（注入/XSS/SSRF/鉴权/竞态/资源泄漏）、代码质量（错误处理/性能/边界条件）、可删除项与迭代计划。
- **输出格式**：总结（APPROVE / REQUEST_CHANGES / COMMENT）→ 按严重级别分组的 findings（含 `file:line`、问题描述、建议修复）→ 删除/迭代计划 → 询问用户如何继续。
- **文件级问题**用 `::code-comment{title body file start end priority}` 指令逐条输出，P0–P3 对应 `priority=0–3`。
- **默认只 review 不改码**，用户确认后再实施修复。
- 检查清单在 `.zcode/skills/code-review-expert/references/`（solid / security / code-quality / removal-plan），review 时按 SKILL.md 的流程加载。
