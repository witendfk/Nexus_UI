# OrderOps Copilot

电商内部订单异常案件处理验证工程，使用 [Nexus UI SDK](../../) 作为受控的人机审核界面。Agent 与业务数据刻意保持简化；本工程用于检验 SDK 接入、边界和失败行为，不宣称生产级订单系统。

M0 Nexus 接入穿刺与 M1 案件事实已完成；M2 Agent 分析进行中，Host 目前仍使用玩具生成源，M3 人工建单尚未完成。产品范围见 [PRD](../../docs/PRD.md)，契约见 [SPEC](../../docs/SPEC.md)，拓扑见 [ARCHITECTURE](../../docs/ARCHITECTURE.md)，当前任务和验收见 [CURRENT](../../docs/tasks/CURRENT.md)。

## 快速开始

前置：Node 24（`better-sqlite3` ABI 敏感）、pnpm 9；从 Nexus_UI 根目录执行安装，同居期依赖通过 `workspace:*` 链接。

```bash
pnpm install
pnpm -C examples/orderops dev   # web localhost:3200 / host :3201 / agent :3202
pnpm -C examples/orderops test
```

## 代码评审

项目内置 [code-review-expert](.claude/skills/code-review-expert/SKILL.md) 评审 skill（基于 [sanyuan-skills](https://github.com/sanyuan0704/sanyuan-skills) 改写，加入 OrderOps 信任边界/SSE/幂等专项）：

- **AI 辅助**：在 Claude Code 中打开本仓自动生效（`.claude/skills/`）；其他 agent 可将 SKILL.md 作为评审提示词模板。
- **人工**：提交前对照 `references/` 下四个清单（SOLID / 安全 / 代码质量 / 删除计划）。
- **纪律**：评审先行，确认后修复；每个里程碑（M1–M5）宣告完成前必须过一轮完整评审。
