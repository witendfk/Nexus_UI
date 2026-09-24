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

Demo Agent 的 system prompt 由 `createCatalogPromptContract(standaloneHostCatalog)` 生成基础协议契约，再追加本 Demo 的审批业务规则；宿主和 Agent 共用 `shared/catalog-contract.ts` 中的同一份 CatalogDefinition，但 Agent 不依赖 React renderMap。外部 Agent 不强制使用这段 prompt，输出仍必须通过统一 guard。

宿主把这份 CatalogDefinition 显式传入 `catalogContracts`，因此浏览器可以通过只读接口 `GET /api/a2ui/catalog-contract?catalogId=...` 读取与 guard 完全同源的契约；页面上的 `查看 Catalog Contract` 按钮就是该路径的验收入口。

外部宿主最小复制路径、catalog / renderMap / action 替换点和坏输出验收见 [../../docs/host-quickstart.md](../../docs/host-quickstart.md)。

## Run

在仓库根目录执行：

```bash
pnpm demo:standalone
```

验证宿主本地 action 模式时使用：

```bash
NEXUS_DEMO_AGENT_MODE=deterministic NEXUS_DEMO_ACTION_MODE=local pnpm demo:standalone
```

默认地址：

| Service | URL |
| --- | --- |
| Web host page | http://127.0.0.1:3100/ |
| Host API health | http://127.0.0.1:3101/health |
| External Agent RPC | http://127.0.0.1:3102/agent |

外部 Agent 的 `/health` 默认返回 `agentMode: "llm"`；宿主 `/health` 返回 `agentMode: "external-rpc"`，表示初始生成始终接外部 RPC Agent，并通过 `actionMode` 报告 action 策略。

LLM 配置读取仓库根目录 `.env` 中的 `OPENAI_API_KEY`、`OPENAI_BASE_URL` 和 `OPENAI_MODEL`。不要提交或泄露 key；部署时由外部 Agent 服务使用自己的安全环境变量。

可用环境变量：

| Variable | Default | Description |
| --- | --- | --- |
| `NEXUS_DEMO_WEB_PORT` | `3100` | Vite web port |
| `NEXUS_DEMO_HOST_PORT` | `3101` | Standalone host API port |
| `NEXUS_DEMO_AGENT_PORT` | `3102` | Demo Agent port |
| `NEXUS_DEMO_AGENT_ENDPOINT` | `http://127.0.0.1:3102/agent` | Host-to-Agent RPC endpoint |
| `NEXUS_DEMO_AGENT_MODE` | `llm` | `llm` 为默认真实模型模式；`deterministic` 仅用于隔离测试 |
| `NEXUS_DEMO_ACTION_MODE` | `external` | `external` 把 action 回传外部 Agent；`local` 由宿主本地 handler 处理 |

显式配置 `NEXUS_DEMO_AGENT_ENDPOINT` 时，`pnpm demo:standalone` 只启动 web 和 host，不再启动内置 demo Agent；未配置时才使用内置三进程编排。

## Acceptance

### External action

1. Open http://127.0.0.1:3100/.
2. Keep the default request and click `生成任务面`.
3. Confirm the LLM-generated surface shows an approval title, `USD 12,000`, and an approval button.
4. Click the approval button.
5. Confirm the same surface changes to `Approved: approval-demo-001`, the button becomes disabled, and the page reports `action: approve`.
6. Confirm the host health endpoint reports `agentMode: "external-rpc"`.

### Local action

1. Start the demo with `NEXUS_DEMO_ACTION_MODE=local`.
2. Open http://127.0.0.1:3100/ and confirm the controls show `action: local handler`.
3. Generate the approval surface and click the approval button.
4. Confirm the same surface changes to `Approved locally: approval-demo-001`, the button reads `Approved locally`, and it is disabled.
5. Confirm host health reports `agentMode: "external-rpc"` and `actionMode: "local"`.

### Catalog Contract

1. Open the web host page.
2. Click `查看 Catalog Contract`.
3. Confirm the status becomes `done` and the panel shows the A2UI NDJSON lifecycle, allowed components and actions, props schema, dynamic binding rules, and the final guard boundary.
4. The same contract can be fetched directly from the host API using the demo catalog ID and a URL-encoded `catalogId` query.

The browser run should finish with no page errors or console errors. The automated HTTP tests use deterministic mode so they never read the developer key or consume an LLM request; they verify that generation and action responses keep the original `surfaceId`, disable the button, and end with an SSE `done` event. One test keeps initial generation on the external Agent while handling `approve` through a local host action handler, proving that action forwarding policy is host-owned. Another HTTP test replaces the external endpoint with a malformed JSONL Agent and requires SSE `error` without `done`. A React DOM regression test also mocks health and both SSE streams, then mounts the actual browser app: it checks the local-action badge, verifies the runtime remains stable after the action, requires the action request to carry the original `surfaceId`, and confirms the same `section` patches in place with the approval button disabled.

## Boundary

- The host owns the catalog, render map, HTTP entrypoints, and action forwarding policy; an action can be sent back to the external Agent or handled by a local business handler.
- The demo Agent can only return candidate A2UI JSONL; LLM output still passes the unified guard.
- The catalog allows only `ApprovalSummary`, `Text`, and `Button`, and only the `approve` action.
- No Playground catalog, built-in fallback, or browser-generated code is used.
- Authentication, tenant isolation, audit logging, retries, and durable state are intentionally outside this demo.
