# Nexus UI

Nexus UI 是基于 A2UI v0.9 消息模型的受宿主约束的 Agent UI Runtime SDK。Agent 生成候选声明式界面；宿主通过协议、Profile、Catalog 和 Policy guard 后渲染，绑定输入、回传 action，并在同一 surface 更新结果。当前交付的是 Nexus Agent Task Profile，不宣称完整 v0.9 或官方 Basic Catalog 兼容。

**SDK 是主产品，目标是达到生产级设计规范并提供可安装、可集成的公开能力。** 这是用于开源展示和面试的个人项目，但用途不降低 SDK 的边界、安全、兼容和验证标准。验证宿主与 Agent 尚未选定；`examples/agent-demo/` 仅为业务示例占位，不构成 SDK 验收的前置依赖。

## 当前状态

Nexus core/React/参考 server、独立宿主 Demo 已证明生成 → guard → SSE → 渲染 → action → 同 surface patch。Catalog Contract 带版本与 hash，可发现、校验并用于外部 Agent 接入。三包 `dist` 根入口可在 workspace 使用，当前仍为私有包；当前产物尚未通过完整的 SDK 发行门禁。内存 surface 快照和 action ledger 不代替业务事务。

S0 文档与 SDK 评审规范已完成；S1 安全基线与业务中立已实施：core 安全反例修复（保留段统一拒绝、媒体 URL 仅 http/https、schema.pattern 注册闸门 + 有界求值）、Adapter/guard 显式装配（registry 必填、policy 无默认、LLM 生成源须注入、catalogId 必填）、runs 查询宿主准入（`runsAccess` 未配置一律 403）、参考服务与演示 Catalog/LLM/Policy 迁至 `examples/playground-server/`。独立评审发现的四项已修复：组件/Catalog/renderMap 查表只读自有属性；渲染与 store 预算非法值立即报错；参考工厂显式接回演示 Policy；三包构建清理旧 dist 并校验文件清单。S1 已完成并推送（`b44b639`）。S2 已拆分为 S2.1–S2.7，S2.1 契约锁定已完成：Catalog Contract v2 声明形状、nexus action 元数据与注册/准入失败语义在 SPEC §4/§5.1/§8、DESIGN D8 定型，core/server 公开类型与共享正常/非法 fixture（`fixtures/catalog-v2/`）落地；复审补齐按 runId 固定提交基准与两种并发时序反例，禁止用最新 revision 给旧视图刷新资格。S2.2 共享 Catalog/schema/能力解释器及评审修复已完成：注册闸门拒绝非法配置，标准声明工厂隔离实例，checks/action 能力由宿主 Catalog 决定，FunctionCall 豁免仅限已校验的组件 checks.condition。S2.3 本地写回与输入收集已完成：`setInputValue` 按组件与绑定属性写回、值域由 Catalog `inputs` 声明决定（未注入 Catalog 即拒绝），最新输入草稿经 `getLatestInputs` 提取。S2.3 评审四项已修复：提取返回独立快照，组件或绑定变化立即清除旧草稿；Playground 从同源已发布 Catalog 装配 Provider；公开示例同步四参数签名与装配要求。后续实施 S2.4 服务端权威准入；查询、结果留存和浏览器接线由 S2.5 实施。后续按 S2 Catalog v2/通用交互 → S3 通用 server runtime → S4 client/Provider/Surface → S5 仓外契约验收推进。目标四包 core/client/react/server，当前 SDK 仍为三包；SDK review 仅覆盖 SDK 及公开接入契约，不评审接入方业务工程。S1 在 Node 24 下 build/typecheck/lint/test 已通过；全仓格式检查仍有既有差异，S1 新增与修改文件已另行定向检查。最新任务、历史证据与门禁见 [CURRENT](docs/tasks/CURRENT.md)。

```text
Agent / LLM → A2UI v0.9 JSONL → Host guard → SSE
  → @nexus-ui/core 状态 → @nexus-ui/react + Host renderMap
  → 人工输入与 action → Host 业务 handler → 同 surface patch
```

## 文档主链

| 文档                                 | 回答的问题                                       |
| ------------------------------------ | ------------------------------------------------ |
| [PRD](docs/PRD.md)                   | SDK 产品目标、生产级设计门禁与验证场景           |
| [SPEC](docs/SPEC.md)                 | 双端必须遵守的协议、Catalog、RPC、数据与状态契约 |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | 包边界、服务拓扑和生成/执行数据流                |
| [DESIGN](docs/DESIGN.md)             | 关键设计选择及代价                               |
| [CURRENT](docs/tasks/CURRENT.md)     | 当前任务、进度与验证门禁                         |

各示例的实际运行命令见其 README；A2UI 上游快照在 `specification/v0_9`。历史讨论可从 Git 记录查阅。

## 仓库地图

```text
Nexus_UI/
├─ packages/            当前 SDK 三包（dist 根入口，私有）
│  ├─ nexus-core        @nexus-ui/core    协议/Profile/Catalog 校验、surface 状态
│  ├─ nexus-react       @nexus-ui/react   Provider / 17 标准组件 / renderMap
│  └─ nexus-server      @nexus-ui/server  宿主装配 API、guard、SSE 传输（显式注入）
├─ web/nexus-playground 开发者试验台前端（vite proxy → :3001）
├─ examples/
│  ├─ playground-server/        参考服务（:3001）：演示 Catalog、LLM/mock 生成源、本地装配
│  ├─ agent-demo/               Agent 宿主应用（占位，演示业务接入 SDK）
│  └─ standalone-host-demo/     现有接入示例；后续 S5 契约验收参考
├─ specification/v0_9/  A2UI 官方上游快照（不进 workspace）
└─ docs/                PRD → SPEC → ARCHITECTURE → DESIGN → tasks/CURRENT
```

依赖单向：`core ← react / server`；`core + react ← playground`；`core + server ← playground-server`；业务宿主应用、standalone-host-demo 与 playground-server 只消费公开根入口，Nexus 不反向依赖业务。独立 client 尚未创建。完整职责与验收归属见 [ARCHITECTURE §2.0](docs/ARCHITECTURE.md)。

## 本地运行

Node 24、pnpm 9。仓库根目录：

```bash
pnpm install
cp .env.example .env
pnpm dev:server
pnpm dev:web
```

Workbench：`http://localhost:5173/`；参考服务 health：`http://localhost:3001/health`（`pnpm dev:server` 即 `examples/playground-server`，演示 Catalog/LLM 装配见其 [README](examples/playground-server/README.md)）。设置 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL` 可用真实 LLM；无 key 时走 fallback。`.env` 不入库。

无 key 的独立宿主演示：

```bash
NEXUS_DEMO_AGENT_MODE=deterministic NEXUS_DEMO_ACTION_MODE=local pnpm demo:standalone
```

打开 `http://127.0.0.1:3100/`，生成任务面、执行本地审批 action 并检查同 surface patch。外部 Agent 验收、discovery 和环境变量见 [独立宿主 Demo](examples/standalone-host-demo/README.md)；其最小复制点是 CatalogDefinition、renderMap、Host action handler 与 Agent endpoint。Agent 输出只是候选消息，必须经过 Host guard。

业务宿主应用（`examples/agent-demo/`）当前为空目录占位；仓库级质量门禁：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

测试通过仅证明当前仓库行为；SDK 的仓外可安装性与发行门禁仍需独立验收，mock 演示结果不代表真实业务收益。
