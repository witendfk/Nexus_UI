# External Agent Onboarding

状态：P20-a 外部 Agent 最短接入路径。  
适用版本：A2UI `v0.9` / Nexus Agent Task Profile。  
目标：回答外部 Agent 开发者最短路径的四个问题——发现哪个 catalog、读取哪份契约、实现什么 RPC、怎样验收。

这不是完整 A2UI v0.9 conformance 指南。当前接入目标是 Nexus Agent Task Profile：一个任务 surface、受 catalog 约束的组件、dataModel 绑定和 action 回流。

## 0. Prepare Three Values

从宿主方获取：

1. Discovery URL，例如：`https://host.example/api/a2ui/published-catalogs`
2. 要接入的 `catalogId`。
3. 你的 Agent JSONL RPC endpoint。

如果宿主在 onboarding contract 中披露了 Agent endpoint，第三项可以暂不手填；验收时会使用契约中的 URL。未披露时，宿主必须单独提供 endpoint。

## 1. Discover The Catalog

优先使用公共客户端，不要手工拼接 catalog ID：

```ts
import { fetchPublishedCatalogs } from '@nexus-ui/server';

const discovery = await fetchPublishedCatalogs({
  url: process.env.NEXUS_DISCOVERY_URL!,
  timeoutMs: 15_000,
});

const catalogId = 'https://host.example/catalogs/workbench/v1';
const selected = discovery.catalogs.find((item) => item.catalogId === catalogId);
if (!selected) throw new Error(`Catalog not published: ${catalogId}`);

console.log(selected.agentOnboardingUrl);
```

`selected.agentOnboardingUrl` 是后续验收入口；`selected.catalogContractUrl` 只用于查看组件、schema 和 policy 边界。

## 2. Read The Onboarding Contract

`agentOnboardingUrl` 返回机器可读契约，包含：

- A2UI `v0.9` + JSONL 传输约束；
- 原始 catalog contract 和可注入 system prompt 的 `promptContract`；
- generate / action 请求字段；
- NDJSON 响应约束；
- SSE 错误边界码；
- 六个稳定验收 checks；
- 宿主可选提供的 Agent endpoint 和 verification command。

可以先直接 `GET` 该 URL 人工检查；下一步的 verifier 也会自动校验同一份契约。

## 3. Implement The JSONL RPC

Agent 暴露一个 `POST` endpoint，接收 `application/json`，返回 `application/x-ndjson`。

生成请求形状：

```json
{
  "version": 1,
  "kind": "generate",
  "surfaceId": "surface-from-host",
  "message": "Create a customer follow-up task",
  "catalogId": "https://host.example/catalogs/workbench/v1",
  "supportedComponents": ["CustomerSummary", "Text", "Button"],
  "supportedActions": ["submit"],
  "history": []
}
```

响应必须按行返回候选 A2UI v0.9 消息：

```jsonl
{"version":"v0.9","createSurface":{"surfaceId":"surface-from-host","catalogId":"https://host.example/catalogs/workbench/v1"}}
{"version":"v0.9","updateComponents":{"surfaceId":"surface-from-host","components":[{"id":"root","component":"CustomerSummary","customerName":{"path":"/customerName"},"children":["submit"]},{"id":"submit","component":"Button","child":"submitLabel","action":{"event":{"name":"submit","context":{"customerName":{"path":"/customerName"}}}}},{"id":"submitLabel","component":"Text","text":"Submit"}]}}
{"version":"v0.9","updateDataModel":{"surfaceId":"surface-from-host","value":{"customerName":"Ada"}}}
```

action 请求中的 `action` 由宿主根据用户操作构造。Agent 必须返回同一个 `surfaceId` 的 patch，只能使用 `updateComponents` / `updateDataModel`，不能 `createSurface` 或 `deleteSurface`。

硬性要求：

- 第一条生成消息必须是 `createSurface`。
- 必须渲染 `id: "root"`。
- 组件名、action 名、props 和 dynamic binding 必须符合 catalog contract。
- 稳定组件 id 必须保持不变。
- action 后 `root` 必须仍存在。
- 不要返回 Markdown、HTML、React 源码、JSON 数组或 prose。

宿主 guard 是最终边界；即使 system prompt 写错，非法候选输出也不会进入前端。

## 4. Verify

优先使用宿主 onboarding contract 中给出的 `verification.command`。standalone demo 提供的 discovery 验收命令是：

```bash
NEXUS_DISCOVERY_URL='http://127.0.0.1:3101/api/a2ui/published-catalogs' \
  pnpm --filter @nexus-ui/standalone-host-demo verify
```

如需锁定 catalog 或补充未披露 endpoint：

```bash
NEXUS_DISCOVERY_URL='https://host.example/api/a2ui/published-catalogs' \
NEXUS_VERIFY_CATALOG_ID='https://host.example/catalogs/workbench/v1' \
NEXUS_VERIFY_AGENT_ENDPOINT='https://your-agent.example/a2ui' \
  pnpm --filter @nexus-ui/standalone-host-demo verify
```

宿主侧也可以直接使用公共 API：

```ts
import { verifyExternalAgentOnboarding } from '@nexus-ui/server';

const report = await verifyExternalAgentOnboarding({
  contractUrl: selected.agentOnboardingUrl,
  // endpoint: 'https://your-agent.example/a2ui', // only when disclosure is disabled
  message: 'Create a customer follow-up task',
});

console.log(report.checks);
```

验收通过必须看到六个 checks 全部 `passed`：

| Check | Meaning |
| --- | --- |
| `generation-lifecycle` | 生成流以 `createSurface` 开始并以 `done` 结束 |
| `catalog-stability` | catalogId 在流中保持稳定 |
| `generation-root` | 渲染树包含 `root` |
| `action-same-surface` | action 只 patch 同一 surface |
| `action-root-stability` | action 后 `root` 仍存在 |
| `policy-rejection` | host policy 拒绝返回 `POLICY_REJECTED` |

失败时先修 Agent 输出，再检查 catalog 是否选择正确；不要绕过 guard 或修改验收 checks。

## Boundaries

- Discovery 只列出宿主显式发布的 catalog，不等于授权。
- Onboarding contract 是接入说明和验收目标，不是免检通道。
- Agent endpoint 的认证、限流、租户隔离和审计由宿主部署层负责。
- 完整 HTTP/SSE、catalog schema 和错误诊断参考见 [host-integration.md](host-integration.md)。
