# OrderOps Agent — 工作区指令

## 与宿主仓的同居关系（每次会话必读）

本工程（OrderOps Copilot）自 2026-09-30 起以 `git subtree` 同居于 Nexus_UI 仓 `examples/orderops/`（**阶段性安排，后续拆回独立项目**；拆分出口 `git subtree split --prefix=examples/orderops`）。职责边界不变：

| 仓/目录 | 职责 | 不负责 |
| --- | --- | --- |
| Nexus_UI（宿主仓 packages/ 与 server/） | 受约束 A2UI v0.9 运行时：协议/Catalog/Policy 校验、surface 状态、渲染、SDK 打包 | 任何 OrderOps 业务模型（订单/物流/退款/工单） |
| 本工程（examples/orderops） | OrderOps Copilot 业务工程：agent-server（生成源 RPC）、host-server（案件事实 + Nexus 装配 + 领域事务）、contracts（M1 T2.1）、web（宿主 UI + 受控 surface） | 协议运行时本身的实现或修改 |

依赖方向单一：本工程通过 pnpm `workspace:*` 只消费 Nexus **公开入口**，绝不 import 其源码/深路径——由本工程 `eslint.config.js` 的 no-restricted-imports 边界墙强制；Nexus 不反向依赖本工程。

## 跨仓硬规则

1. **同居期 Nexus 变更即时生效**：core/react/server 变更后在 Nexus_UI 仓库根 `pnpm install` 即完成链接，随后本工程测试必须全绿才能继续业务迭代。进入 M2 前必须确认消费的是含 Nexus Layer 0 加固的产物（2026-09-30 起已满足：L0-01..07 修复经 workspace 链接直接被本工程 guard 测试覆盖）。
   **拆分时恢复 tarball 仪式**：先升 Nexus 三包 patch 版本（如 0.1.0 → 0.1.1）并同步 overrides/deps——pnpm 不重读同名同版本的 file: tarball（`pnpm install --force` 也不行），同版本覆盖不可审计；2026-09-29 刷新时已实际踩坑（靠删 node_modules 才生效）。
2. **guard 双端一致**：涉及 Catalog、校验行为的变更，用同一批 fixture 双端验证（本工程 guard 测试 + Nexus conformance 用例）；同居期同一 workspace，一次 `pnpm test` 覆盖。
3. **评审标准统一**：所有工程评审按本仓 `.claude/skills/code-review-expert/SKILL.md` 执行（P0–P3 分级、四份检查清单、`::code-comment` 指令、review-first 未确认不修码）；Nexus_UI 侧同一标准在其 `.zcode/skills/`，两仓保持同版。**每个里程碑（M1–M5）宣告完成前必须过一轮完整评审**（README 纪律）。
4. **Node 24 前置**：本仓所有 `pnpm`/`node` 命令必须先 `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"`（或 `nvm use 24`）——系统默认 node 是 18。2026-09-29 实际踩坑：删 node_modules 重装时漏了前置，`better-sqlite3` 原生模块被按 ABI 108（Node 18）编译，Node 24（ABI 137）下加载直接失败；修复须在 Node 24 下 `pnpm install --force`（绕过 pnpm side-effects cache，普通 `pnpm rebuild` 会把旧 ABI 构建还原回来，无效）。症状特征：`NODE_MODULE_VERSION 108 ... requires 137` 报错。

## 工程 SOP

日常工程作业按宿主仓根 `AGENTS.md` 的工程 SOP 执行（测试入口、验证门禁、文档同步、提交流程）；返工教训写回根 `AGENTS.md`。

## 状态与文档入口

- 产品及技术主链：宿主仓 `docs/PRD.md` → `docs/SPEC.md` → `docs/ARCHITECTURE.md` → `docs/DESIGN.md`。
- 唯一进度与任务事实源：宿主仓 `docs/tasks/CURRENT.md`；完成任务后更新判据和证据，本文件只放不随时间变化的规则。

## 项目性质与叙事边界

个人项目，目标是可复现演示与可深挖的工程叙事（面试用，不宣称开源可用产品）。文档中"已实现 / 规划中"必须分别标注；mock 数据只报模拟结果，不宣称真实业务收益；auth、多租户、公网部署、npm 公开发布、消息队列/ORM 引入均不在当前范围。
