# OrderOps Copilot

电商内部订单异常案件处理助手，使用 [Nexus UI](../Nexus_UI/) 作为受控的人机审核界面。

项目已完成 **M0 Nexus 接入穿刺**：`Agent 生成 → guard 校验 → SSE → 受控渲染 → action 回流 → patch` 全链有自动化测试覆盖（7/7 绿）。产品功能、系统边界、技术栈、数据模型、执行流程与逐阶段验收见 [框架设计与实施方案](docs/architecture.md)；框架设计图（拓扑、模块、时序、数据模型）见 [docs/design.md](docs/design.md)；逐任务实施顺序与进度见 [docs/implementation-plan.md](docs/implementation-plan.md)。

## 快速开始

前置：Node 24（见 `.nvmrc`）、pnpm 9、本仓同级目录存在 `Nexus_UI` 参考仓（或用 `NEXUS_UI_DIR` 环境变量指定路径）。

```bash
pnpm install
pnpm pack:nexus   # 首次或 Nexus 更新后：打包 @nexus-ui/* tarball 到 tarballs/
pnpm dev          # web localhost:3200（Vite 绑 localhost，用 127.0.0.1 访问不到）/ host :3201 / agent :3202
pnpm test         # 单测位于各包 test/ 目录（镜像 src 结构），含 Nexus 接入穿刺测试
```

## 代码评审

项目内置 [code-review-expert](.claude/skills/code-review-expert/SKILL.md) 评审 skill（基于 [sanyuan-skills](https://github.com/sanyuan0704/sanyuan-skills) 改写，加入 OrderOps 信任边界/SSE/幂等专项）：

- **AI 辅助**：在 Claude Code 中打开本仓自动生效（`.claude/skills/`）；其他 agent 可将 SKILL.md 作为评审提示词模板。
- **人工**：提交前对照 `references/` 下四个清单（SOLID / 安全 / 代码质量 / 删除计划）。
- **纪律**：评审先行，确认后修复；每个里程碑（M1–M5）宣告完成前必须过一轮完整评审。
