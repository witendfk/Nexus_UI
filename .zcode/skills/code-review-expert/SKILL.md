---
name: code-review-expert
description: "Expert code review of current git changes with a senior engineer lens. Detects SOLID violations, security risks, code smells, and boundary-condition bugs in diffs. Use PROACTIVELY when the user asks to review/评审/审查 code, before significant commits, or when a feature milestone (M0-M5) is declared complete."
---

# Code Review Expert

对当前 git 变更做专家级代码评审：不改变行为的前提下找出 SOLID 违规、安全风险、坏味道与边界条件缺陷。**先评审、后动手：在用户明确确认前不要实施任何修复。**

来源：基于 [sanyuan0704/sanyuan-skills](https://github.com/sanyuan0704/sanyuan-skills) 的 `code-review-expert` 改写，加入 OrderOps 项目专项检查。

## Workflow

1. **Preflight**: 确认上下文 —— `git status`、`git diff`（不足时 `git log -p -3`）。理解系统架构与调用链（本项目的架构见 `docs/architecture.md`，接线见 `docs/design.md` §10 核查结论）。
2. **SOLID & 架构扫描**: 对照 `references/solid-checklist.md`，标注违规（file:line + 违反的原则）。
3. **删除/简化候选**: 对照 `references/removal-plan.md`，对每项给出删除收益与风险评估。
4. **安全扫描**: 对照 `references/security-checklist.md`（XSS / 注入 / SSRF / 竞态 / 数据校验）+ 下方"OrderOps 专项"。
5. **代码质量扫描**: 对照 `references/code-quality-checklist.md`（异常吞噬、资源泄漏、隐式耦合、并发问题）。
6. **格式化输出**: 按 Output Format 分节输出中文报告；文件级 finding 用 `::code-comment` 指令内联标注。
7. **Next Steps**: 给出修复选项（修 P0-P1 / 修到 P2 / 指定条目 / 仅报告），等用户确认。

## Review-First Rule

默认只输出评审结论。用户说"直接修"、"fix it" 或在 Next Steps 中选择后才动手。若某个修复会改变公共 API 或引入新依赖，即使用户已确认也要先说明再实施。

## OrderOps 专项检查（项目 overlay）

通用 checklist 之外，本项目评审必须额外过一遍：

### 信任边界（最重要）

- 浏览器回传的 `action.context` 字段**不得**被当作订单事实；案件归属必须经 `surfaceId → surface_bindings` 服务端反查（architecture.md §5.2）。
- 过期 surface（`case_version` 不匹配）的提交必须被拒绝；Nexus 快照不感知案件版本，这道校验在 Host action handler 里。
- Agent/模型输出只能进受 schema 约束的通道；证据 ID 必须属于工具快照；guard 拒绝的不算"已生成"。

### SSE 与流式

- `done` 之前业务 action 必须禁用；流式预览不是可执行界面。
- `error` 事件（服务端 guard 拒绝）与网络错误（fetch reject / EventSource onerror）必须区分处理。
- 流中断后的恢复路径：查询 `GET /api/actions/:id` / 案件状态，不盲目重发写操作。

### 幂等与事务（M3 起）

- 领域幂等键 `caseId + operationType`；唯一约束兜底；`request_key` 只识别客户端重放。
- 事务必须先于流式输出完成；SSE/patch 失败不得回滚已提交事务。

### 确定性

- CI/回归只用 fixture 模式；真实模型调用只允许出现在显式冒烟测试。
- 检测规则、严重度推导、乱序/缺失事件处理必须是纯代码，不得交给模型。

### Nexus 约束

- 只允许使用 `@nexus-ui/*` tarball 的公开导出（见 architecture.md §10.1）；禁止 import 内部路径。
- 生产装配 `streamDelayMs: 0`；外部 Agent RPC `timeoutMs` 必须 ≥ 模型实际耗时（默认 15s 陷阱）。
- `Button.disabled` 只能是字面布尔，不能 `{path}` 绑定。

## Output Format

```markdown
## Summary
用 2-3 句话向资深工程师同事总结变更质量与最大风险。

## P0/P1/P2/P3 Findings
| 级别 | 位置 | 问题 | 建议 |
（P0=安全/数据丢失/正确性必须阻塞；P1=应尽快修；P2=重要不紧急；P3=值得注意）

## 安全扫描
覆盖 XSS / 注入 / SSRF / 竞态 / 数据校验，附通过项。

## SOLID 评估
突出严重违规，逐条标注 file:line 与违反原则。

## 删除/简化候选
每项给删除收益 + 风险。

## 建议的 commit message
按仓库惯例给 1-2 个 conventional commit 建议。

## Next Steps
1. 修复全部 P0-P1 问题
2. 修复至全部 P2 清零
3. 仅处理指定条目
4. 仅输出报告，不修改代码
```

文件级 finding 同时用内联指令标注（ZCode 环境）：

```
::code-comment{title="[P1] 标题" body="说明" file="绝对路径" start=行号 priority=1}
```

## Verification

除非用户在 Next Steps 中明确选择修复，否则不执行任何 lint/test/build。
