# Nexus UI Standalone Host Demo

这是一个仓库内可运行的独立宿主 Demo，用来验证 Nexus UI 作为 A2UI Agent UI Runtime 的完整接入链路：

```text
LLM-backed external business Agent
  -> HTTP JSONL RPC
  -> standalone host API
  -> unified catalog / lifecycle / action guard
  -> POST + SSE
  -> React standalone host page
  -> approve action
  -> same surface patched in place
```

这个 Demo 的业务 Agent 默认真实调用 OpenAI-compatible LLM，并把模型输出作为候选 A2UI JSONL 交给宿主 guard。它不是完整业务 Agent 工程；后续完整 Agent 可以独立建仓，只要实现相同的 JSONL RPC endpoint，宿主侧替换 `NEXUS_DEMO_AGENT_ENDPOINT` 即可接入。

## Run

在仓库根目录执行：

```bash
pnpm demo:standalone
```

默认地址：

| Service | URL |
| --- | --- |
| Web host page | http://127.0.0.1:3100/ |
| Host API health | http://127.0.0.1:3101/health |
| External Agent RPC | http://127.0.0.1:3102/agent |

外部 Agent 的 `/health` 默认返回 `agentMode: "llm"`；宿主 `/health` 返回 `agentMode: "external-rpc"`，表示 UI Runtime 当前接的是外部 RPC Agent。

LLM 配置读取仓库根目录 `.env` 中的 `OPENAI_API_KEY`、`OPENAI_BASE_URL` 和 `OPENAI_MODEL`。不要提交或泄露 key；部署时由外部 Agent 服务使用自己的安全环境变量。

可用环境变量：

| Variable | Default | Description |
| --- | --- | --- |
| `NEXUS_DEMO_WEB_PORT` | `3100` | Vite web port |
| `NEXUS_DEMO_HOST_PORT` | `3101` | Standalone host API port |
| `NEXUS_DEMO_AGENT_PORT` | `3102` | Demo Agent port |
| `NEXUS_DEMO_AGENT_ENDPOINT` | `http://127.0.0.1:3102/agent` | Host-to-Agent RPC endpoint |
| `NEXUS_DEMO_AGENT_MODE` | `llm` | `llm` 为默认真实模型模式；`deterministic` 仅用于隔离测试 |

## Acceptance

1. Open http://127.0.0.1:3100/.
2. Keep the default request and click `生成任务面`.
3. Confirm the LLM-generated surface shows an approval title, `USD 12,000`, and an approval button.
4. Click the approval button.
5. Confirm the same surface changes to `Approved: approval-demo-001`, the button becomes disabled, and the page reports `action: approve`.
6. Confirm the host health endpoint reports `agentMode: "external-rpc"`.

The browser run should finish with no page errors or console errors. The automated HTTP tests use deterministic mode so they never read the developer key or consume an LLM request; they verify that generation and action responses keep the original `surfaceId`, disable the button, and end with an SSE `done` event. A React DOM regression test also mocks both SSE streams and mounts the actual browser app: after the action rerenders the host, the runtime must remain stable, the action request must carry the original `surfaceId`, the same `section` must patch in place, and the approval button must be disabled.

## Boundary

- The host owns the catalog, render map, HTTP entrypoints, and action forwarding policy.
- The demo Agent can only return candidate A2UI JSONL; LLM output still passes the unified guard.
- The catalog allows only `ApprovalSummary`, `Text`, and `Button`, and only the `approve` action.
- No Playground catalog, built-in fallback, or browser-generated code is used.
- Authentication, tenant isolation, audit logging, retries, and durable state are intentionally outside this demo.
