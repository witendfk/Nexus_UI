# Nexus UI — 工作区指令

## 宿主仓与 orderops 同居阶段（每次会话必读）

本仓（Nexus_UI）是受约束 A2UI v0.9 运行时（协议/Catalog/Policy 校验、surface 状态、渲染、SDK 打包）。OrderOps Copilot 业务工程自 2026-09-30 起以 `git subtree` 方式同居于 `examples/orderops/`（agent-server / host-server / contracts / web 四包，历史完整保留，源自独立仓 `../orderops-agent`）。**同居是阶段性安排：后续要拆回两个独立项目**，拆分出口用 `git subtree split --prefix=examples/orderops`。

硬规则：

1. **依赖方向单一**：`examples/orderops` 只消费本仓公开入口（`@nexus-ui/core` / `@nexus-ui/react` / `@nexus-ui/server`），经 pnpm `workspace:*` 链接；绝不 import 源码/深路径——由 `examples/orderops/eslint.config.js` 的 no-restricted-imports 边界墙强制。本仓 packages/server 代码绝不反向依赖 orderops 业务模型。
2. **同居期不刷 tarball**：core/react/server 变更后只需根目录 `pnpm install` 即对 orderops 生效；`pnpm pack:nexus` + 版本提升 + overrides 同步的整套仪式**暂停使用**，拆分时恢复——届时必须先升三包 patch 版本并让对方同步 overrides/deps（pnpm 不重读同名同版本的 file: tarball，`--force` 也不行；2026-09-29 已实际踩坑）。
3. **校验行为变更**（Catalog/协议/Profile）用同一批 fixture 在仓内双端验证：本仓 conformance 用例 + `examples/orderops` guard 测试，一次 `pnpm test` 全覆盖。
4. **测试入口**：根 `pnpm test` 已覆盖 orderops（其 root 包被 workspace 通配纳入）；orderops 专属命令用 `pnpm -C examples/orderops <script>`（test / dev / build / typecheck / lint）。orderops 需要 Node 24（better-sqlite3 原生模块 ABI 敏感，见其 AGENTS.md 规则 4）。
5. orderops 组件层迭代计划见 `docs/component-iteration.md`；其业务模型绝不进入本仓通用包。

## Code Review 标准（强制）

所有代码 review（如 "review 这次改动"、"审查代码"、提交前检查）必须按工程级 skill
`.zcode/skills/code-review-expert/SKILL.md` 执行：

- **严重级别**：P0（安全/数据丢失/正确性，阻断合并）、P1（逻辑错误/重大 SOLID 违反/性能回退，合并前应修）、P2（代码坏味道/可维护性）、P3（风格/命名/小建议）。
- **review 维度**：SOLID 与架构边界、安全与可靠性（注入/XSS/SSRF/鉴权/竞态/资源泄漏）、代码质量（错误处理/性能/边界条件）、可删除项与迭代计划。
- **输出格式**：总结（APPROVE / REQUEST_CHANGES / COMMENT）→ 按严重级别分组的 findings（含 `file:line`、问题描述、建议修复）→ 删除/迭代计划 → 询问用户如何继续。
- **文件级问题**用 `::code-comment{title body file start end priority}` 指令逐条输出，P0–P3 对应 `priority=0–3`。
- **默认只 review 不改码**，用户确认后再实施修复。
- 检查清单在 `.zcode/skills/code-review-expert/references/`（solid / security / code-quality / removal-plan），review 时按 SKILL.md 的流程加载。
