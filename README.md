# Nexus UI

Nexus UI 是基于 A2UI v0.9 消息模型的受约束 Agent Task Surface SDK。Agent 生成候选声明式界面；宿主通过协议、Profile、Catalog 和 Policy guard 后渲染，绑定输入、回传 action，并在同一 surface 更新结果。当前交付的是 Nexus Agent Task Profile，不宣称完整 v0.9 或官方 Basic Catalog 兼容。

**SDK 是主产品，目标是达到生产级设计规范并提供可安装、可集成的公开能力。** 这是用于开源展示和面试的个人项目，但用途不降低 SDK 的边界、安全、兼容和验证标准。[OrderOps Copilot](docs/PRD.md) 是自建的简化验证 Agent/宿主：确定性规则发现物流停滞，Agent 解释证据和建议，运营人员确认后由 Host 执行模拟建单。OrderOps 本身不以生产级业务系统为目标；它暂以 subtree 同居于 `examples/orderops/`，只消费 Nexus 公开入口。

## 当前状态

Nexus core/React/参考 server、独立宿主 Demo 已证明生成 → guard → SSE → 渲染 → action → 同 surface patch。Catalog Contract 带版本与 hash，可发现、校验并用于外部 Agent 接入。三包 `dist` 根入口可在 workspace 使用，当前仍为私有包；当前产物尚未通过完整的 SDK 发行门禁。内存 surface 快照和 action ledger 不代替业务事务。

SDK 主线仍需当前产物的仓外安装、公开 API/兼容、失败恢复、资源边界和独立宿主验收。OrderOps M0 接入和 M1 案件事实已完成，M2 Agent 分析进行中；Host 仍使用玩具生成源与回显 patch，人工确认建单 M3 尚未实现。2026-09-30 已知基线：Nexus Layer 0 七项关闭；官方 v0.9 conformance 9 份用例为 33 pass / 47 已决策偏差 / 0 fail。最新任务、证据和门禁见 [CURRENT](docs/tasks/CURRENT.md)，历史数字不代表当前未提交工作区已验证。

```text
Agent / LLM → A2UI v0.9 JSONL → Host guard → SSE
  → @nexus-ui/core 状态 → @nexus-ui/react + Host renderMap
  → 人工输入与 action → Host 业务 handler → 同 surface patch
```

## 文档主链

| 文档 | 回答的问题 |
| --- | --- |
| [PRD](docs/PRD.md) | SDK 产品目标、生产级设计门禁与验证场景 |
| [SPEC](docs/SPEC.md) | 双端必须遵守的协议、Catalog、RPC、数据与状态契约 |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | 包边界、服务拓扑和生成/执行数据流 |
| [DESIGN](docs/DESIGN.md) | 关键设计选择及代价 |
| [CURRENT](docs/tasks/CURRENT.md) | 当前任务、进度与验证门禁 |

各示例的实际运行命令见其 README；A2UI 上游快照在 `specification/v0_9`。历史讨论可从 Git 记录查阅。

## 本地运行

Node 24、pnpm 9。仓库根目录：

```bash
pnpm install
cp .env.example .env
pnpm dev:server
pnpm dev:web
```

Workbench：`http://localhost:5173/`；参考 server health：`http://localhost:3001/health`。设置 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL` 可用真实 LLM；无 key 时走 fallback。`.env` 不入库。

无 key 的独立宿主演示：

```bash
NEXUS_DEMO_AGENT_MODE=deterministic NEXUS_DEMO_ACTION_MODE=local pnpm demo:standalone
```

打开 `http://127.0.0.1:3100/`，生成任务面、执行本地审批 action 并检查同 surface patch。外部 Agent 验收、discovery 和环境变量见 [独立宿主 Demo](examples/standalone-host-demo/README.md)；其最小复制点是 CatalogDefinition、renderMap、Host action handler 与 Agent endpoint。Agent 输出只是候选消息，必须经过 Host guard。

OrderOps 在根目录安装依赖后运行 `pnpm -C examples/orderops dev`；测试与质量门禁：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

测试通过仅证明当前仓库行为；SDK 的仓外可安装性与发行门禁仍需独立验收，OrderOps 的 mock 结果不代表真实业务收益。
