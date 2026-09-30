# Nexus UI

Nexus UI 是基于 A2UI v0.9 消息模型的 **Agent Task Surface Runtime**。Agent 输出受约束的声明式消息；宿主校验消息与 Catalog，Nexus 逐步渲染、绑定用户输入、回传 action，并在同一个 surface 更新结果。当前交付的是 Nexus Agent Task Profile，不宣称完整 A2UI v0.9 或官方 Basic Catalog 一致性。

项目目标是让 Agent 生成的任务界面能够接入业务系统，并保持组件、数据和执行权由宿主控制。当前具象业务验证方向是 [OrderOps Copilot](docs/order-ops-copilot.md)：电商内部订单异常处理 Agent。Nexus 是运行时，OrderOps 的业务 Agent 与宿主位于同级独立仓 `../orderops-agent`；本仓记录已有 M0 tarball 接入验证，完整业务切片仍需在对方仓验收。

## 当前能力

- `@nexus-ui/core`：JSONL 流解析、协议/Profile/Catalog 校验、surface 状态、VNode 构建、dataModel 绑定、action context 和结构化 diagnostics。
- `@nexus-ui/react`：Provider、renderMap、基础任务组件和自定义 Catalog 组件映射。
- 参考 server：Agent Adapter、Catalog/Policy guard、SSE、外部 Agent JSONL RPC、宿主 action handler 与同 surface patch。
- 独立宿主 Demo：自定义 Catalog、外部 Agent、可切换的本地/远端 action 和坏输出验收。

Workbench 和独立宿主已证明最小交互闭环。Catalog Contract 有版本和 hash，外部 Agent 可发现并校验契约身份。服务端已有进程内 surface action 快照、action ledger 和运行状态；它们不等于业务事务或持久化会话。core/React/server 三包仍为私有包，公开入口已指向 `dist`；历史 tarball 安装冒烟见[迭代记录](docs/iteration-plan.md)，新快照仍须单独验证。

**当前验收状态（2026-09-30）：Layer 0.3 加固未通过 review。** [问题台账](docs/runtime-hardening-review.md)记录 4 项 P0、2 项 P1、1 项 P2，涉及 JSONL 丢消息、正则与渲染资源限制、共享对象写入、异常隔离、深链及 Protocol/Profile 分层。已有实现和历史测试记录不代表这些场景已关闭；当前改动不能作为 OrderOps M2 的加固基线。

```text
Agent / LLM
  -> A2UI v0.9 JSONL
  -> 宿主协议、Profile、Catalog、Policy guard
  -> SSE 参考传输
  -> @nexus-ui/core 状态与 VNode
  -> @nexus-ui/react + 宿主 renderMap
  -> 用户输入与 action
  -> 宿主业务 handler 或外部 Agent
  -> 同 surface patch
```

当前只显示一个 active surface。Nexus Basic Task Profile 使用 17 个 Basic-like 组件名，支持有限的组件字段、`{ path }` 绑定和最小 checks；完整字段与非目标见 [宿主接入契约](docs/host-integration.md)。不生成 HTML 或 React 源码，不替代业务后端的事实、事务和执行策略。

## 工程方向

1. 关闭 Runtime 加固台账，建立官方 conformance 基线和双仓共用 fixture 验证；补齐 action 取消、用户输入权威性与失败恢复验收。
2. 加固合并后先提升三包 patch 版本，同步 OrderOps deps/overrides，再在对方仓执行 `pnpm pack:nexus` + `pnpm install` 验证新产物；继续推进物流异常的查询、解释、人工建单与原 surface 更新。
3. 用第二类处理方式不同的异常验证 Catalog 和宿主 API 的复用性，再定型 client、guard、`NexusSurface` 等高层 SDK 能力。OrderOps 的 Daily Briefing、Exception Resolution 与 Monthly Review 继续逐步扩展。

具体问题和验收口径见 [工程现状与优先级](docs/engineering-priorities.md)，包改造见 [npm SDK 路线](docs/npm-sdk-transformation.md)。个人项目以可复现的工程与业务演示为目标；多租户、通用权限平台及公网部署不作为当前前置条件。

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [OrderOps Copilot](docs/order-ops-copilot.md) | 业务问题、Agent 工作流、功能路线和评测 |
| [工程现状与优先级](docs/engineering-priorities.md) | 已证明能力、待纠偏边界和下一步 |
| [Runtime 加固问题台账](docs/runtime-hardening-review.md) | 当前 7 项 review 问题、触发条件、关闭验收与快照门禁 |
| [npm SDK 路线](docs/npm-sdk-transformation.md) | 包边界、安装验证与发布要求 |
| [架构边界](docs/architecture-boundary.md) | 协议、能力、策略、渲染分层 |
| [宿主接入契约](docs/host-integration.md) | API、Catalog、HTTP/SSE 和支持范围 |
| [宿主 Quickstart](docs/host-quickstart.md) | 最小宿主接入步骤 |
| [外部 Agent 接入](docs/external-agent-onboarding.md) | discovery、Contract、RPC 与 verifier |
| [公开 API](docs/public-api.md) | root entry 与兼容策略 |
| [面试叙事](docs/interview-narrative.md) | 项目讲解与已实现样例 |

A2UI 协议事实源在 `specification/v0_9`；各包和示例的运行说明见其目录 README。历史需求和里程碑记录可从 Git 历史查阅，不作为当前能力事实源。

## 本地运行

```bash
pnpm install
cp .env.example .env
pnpm dev:server
pnpm dev:web
```

Web：`http://localhost:5173/`；server health：`http://localhost:3001/health`。配置 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL` 可运行真实 LLM；未配置 key 时使用 fallback。`.env` 被 Git 忽略。

无 key 的独立宿主演示：

```bash
NEXUS_DEMO_AGENT_MODE=deterministic NEXUS_DEMO_ACTION_MODE=local pnpm demo:standalone
```

打开 `http://127.0.0.1:3100/`，生成任务面并执行本地审批 action，检查同 surface 更新。真实 LLM 和外部 Agent 接入命令见 [独立宿主说明](examples/standalone-host-demo/README.md)。

质量门禁：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

测试通过只证明当前仓库行为；SDK 可安装性与 OrderOps 业务收益需要各自的独立验收。
