# OrderOps Agent

电商内部订单异常运营 Agent，使用 [Nexus UI](../Nexus_UI/) 作为受控 Agent Task Surface Runtime。

架构设计见 [docs/architecture.md](docs/architecture.md)。

## 结构

| 包 | 端口 | 职责 |
| --- | --- | --- |
| `packages/agent-server` | 3202 | LLM Agent，消费 Catalog Contract，通过只读工具查询业务事实，输出 A2UI NDJSON |
| `packages/host-server` | 3201 | 业务 Host，组装 Nexus UI 受控装配 API，持有 SQLite 订单/物流/工单事实与领域幂等 |
| `packages/web` | 3200 | React 前端宿主，通过 Nexus UI 渲染受控 surface |
| `fixtures/` | — | 确定性测试数据（订单、物流事件、标注异常） |

## 快速开始

```bash
pnpm install
pnpm dev
```

打开 `http://127.0.0.1:3200`。
