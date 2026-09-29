# OrderOps Agent — 工作区指令

## 双仓关系（每次会话必读）

本仓与同级仓 `../Nexus_UI` 是固定双子仓，任何工程决策都要在两仓语境下做：

| 仓 | 职责 | 不负责 |
| --- | --- | --- |
| `../Nexus_UI` | 受约束 A2UI v0.9 运行时：协议/Catalog/Policy 校验、surface 状态、渲染、SDK 打包 | 任何 OrderOps 业务模型（订单/物流/退款/工单） |
| 本仓（orderops-agent） | OrderOps Copilot 业务工程：agent-server（生成源 RPC）、host-server（案件事实 + Nexus 装配 + 领域事务）、web（宿主 UI + 受控 surface） | 协议运行时本身的实现或修改 |

依赖方向单一：本仓通过 `tarballs/*.tgz` + pnpm overrides 只消费 Nexus **公开入口**，绝不 import 其源码路径；Nexus 不反向依赖本仓。

## 跨仓硬规则

1. **tarball 对齐**：`../Nexus_UI` 合并加固或能力变更后，必须在本仓执行 `pnpm pack:nexus` + `pnpm install`，两仓测试全绿后才能继续业务迭代。进入 M2 前必须确认消费的是含 Nexus Layer 0 加固的产物（Nexus 已知 P0/P1 缺陷清单与其修复状态见 `../Nexus_UI/docs/component-iteration.md` Layer 0）。
2. **guard 双端一致**：涉及 Catalog、校验行为的变更，用同一批 fixture 在两仓分别验证（本仓 guard 测试 + Nexus conformance 用例）。
3. **评审标准统一**：所有工程评审按本仓 `.claude/skills/code-review-expert/SKILL.md` 执行（P0–P3 分级、四份检查清单、`::code-comment` 指令、review-first 未确认不修码）；Nexus_UI 侧同一标准在其 `.zcode/skills/`，两仓保持同版。**每个里程碑（M1–M5）宣告完成前必须过一轮完整评审**（README 纪律）。

## 状态与文档入口

- 进度事实源：`docs/implementation-plan.md`（任务级进度，2026-09-29 时点：M0 穿刺完成，下一步 M1 T2.1 contracts 包）。
- 设计与验收门禁：`docs/architecture.md`（§8 阶段门禁；§10 是对 Nexus 公开面的源码级核查与陷阱清单，M2/M3 动工前逐条对照）。
- 状态快照不写进本文件——更新 implementation-plan 的任务行与进度注记，本文件只放不随时间变化的规则。

## 项目性质与叙事边界

个人项目，目标是可复现演示与可深挖的工程叙事（面试用，不宣称开源可用产品）。文档中"已实现 / 规划中"必须分别标注；mock 数据只报模拟结果，不宣称真实业务收益；auth、多租户、公网部署、npm 公开发布、消息队列/ORM 引入均不在当前范围。
