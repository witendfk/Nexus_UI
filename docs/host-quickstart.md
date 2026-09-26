# Host Quickstart

状态：P15-a Host Policy 注入。
适用版本：Nexus UI MVP `0.1.0`。  
目标：让宿主开发者以 `examples/standalone-host-demo` 为模板，接入自己的 catalog、renderMap、action handler 和外部 Agent endpoint。

完整契约见 [host-integration.md](host-integration.md)。本页只解决第一步：“我该复制什么、改什么、怎么验收。”

## 1. Copy The Minimum Template

从最小可运行闭环开始，不需要复制 Playground：

```text
examples/standalone-host-demo/src/shared/catalog.tsx
examples/standalone-host-demo/src/shared/catalog-contract.ts
examples/standalone-host-demo/src/shared/action-mode.ts
examples/standalone-host-demo/src/host/adapter.ts
examples/standalone-host-demo/src/host/local-action.ts
examples/standalone-host-demo/src/host/app.ts
examples/standalone-host-demo/src/browser/sse.ts
examples/standalone-host-demo/src/browser/app.tsx
examples/standalone-host-demo/scripts/run-host.ts
```

职责划分：

| File | Host responsibility |
| --- | --- |
| `shared/catalog-contract.ts` | 声明 catalogId、组件 / action 白名单、props schema 和 componentPolicies；宿主与 Agent 可共用 |
| `shared/catalog.tsx` | 导入 CatalogDefinition、注册 Registry，并声明 React renderMap |
| `shared/action-mode.ts` | 解析 external / local action 策略 |
| `host/adapter.ts` | 组装 Agent Adapter、外部 JSONL RPC source、action handler 和 history store |
| `host/local-action.ts` | 本地业务 action fixture，用于 action 留在宿主进程内处理 |
| `host/app.ts` | 暴露 `/health`、`/api/a2ui/generate`、`/api/a2ui/event`，并显式选择是否发布 catalog contract |
| `browser/sse.ts` | 消费宿主 API 的 POST + SSE 流 |
| `browser/app.tsx` | 挂载 React runtime，把 action 回传到宿主 API |
| `scripts/run-host.ts` | 读取端口、external Agent endpoint 和 action 策略配置 |

不要复制 `src/agent.ts`、`src/llm.ts` 和 `scripts/run-agent.ts`，它们只是本仓库用来演示真实 LLM Agent 的实现。你的完整业务 Agent 后续可以独立建仓。

当前 `@nexus-ui/server` 根入口提供有限的宿主装配 API（`SERVER_API_VERSION = 1`），standalone demo 已只依赖这个入口。它不是完整生产 SDK；内置 catalog、LLM 客户端、mock handler 和参考服务启动器仍可能调整。

可用的装配 API 是：

```ts
import {
  AgentAdapter,
  InMemorySurfaceHistoryStore,
  createAgentRouter,
  createExternalAgentActionHandler,
  createExternalAgentGenerationSource,
} from '@nexus-ui/server';
```

## 2. Replace The Catalog Contract

打开复制后的 `shared/catalog-contract.ts`，先替换四个边界：

```ts
export const hostCatalog: CatalogDefinition = {
  catalogId: 'https://your-host.example.com/catalogs/workbench/v1',
  components: ['CustomerSummary', 'Text', 'Button'],
  actions: ['submit'],
  componentSchemas: {
    CustomerSummary: {
      type: 'object',
      additionalProperties: false,
      required: ['customerName'],
      properties: {
        customerName: { type: 'string', dynamic: 'required' },
      },
    },
  },
  componentPolicies: {
    CustomerSummary: {
      origin: 'host-extension',
      fields: {
        customerName: { binding: 'required', origin: 'host-extension' },
      },
      action: { allowed: false },
    },
    Button: {
      fields: {
        child: { componentRef: true, binding: 'forbidden', origin: 'official-basic' },
        disabled: { binding: 'forbidden', origin: 'host-extension' },
      },
      action: { allowed: true },
    },
  },
};
```

同一个文件中的 renderMap 决定这些组件如何进入你的设计系统：

```tsx
export const hostRenderMap: RenderMap = {
  CustomerSummary: (vnode, children) => (
    <section key={vnode.id}>
      <h2>{toDisplayString(vnode.props.customerName)}</h2>
      {children}
    </section>
  ),
};
```

接入规则：

- `catalogId` 由宿主命名并保持稳定。
- `components` 是 Agent 可用组件的白名单，不在列表内的组件会被拒绝。
- `actions` 是该 catalog 的 action 白名单，未声明 action 不能出现在 UI 或请求中。
- `componentSchemas` 声明自定义组件 props 契约；Agent 不能输出未知字段。
- `componentPolicies` 声明字段允许范围、`{ path }` 绑定、action 挂载和 checks 范围；`origin` 区分官方 Basic 字段、Nexus 扩展和宿主扩展。
- renderMap 只由宿主持有；Agent 输出描述，不输出 React / HTML 源码。
- 在 React 装配层保持 catalog registry 是稳定实例，不要在每次 render 时重建。

外部 Agent 需要理解上述边界，但不要求复制 Nexus 的固定 prompt。core 提供可选生成器：

```ts
import { createCatalogPromptContract } from '@nexus-ui/core';

const systemPrompt = [
  createCatalogPromptContract(hostCatalog),
  '# Host Business Rules',
  'Describe the task-specific component ids, data paths, action semantics, and expected updates here.',
].join('\n\n');
```

生成内容包括 A2UI NDJSON 生命周期、组件和 action 白名单、props schema、componentPolicies、dynamic binding 语义，以及“宿主 guard 是最终边界”。宿主仍需为业务语义补充说明；prompt 不是放行条件，非法输出会被 guard 拒绝。

如果希望把契约提供给外部 Agent 开发者或验收页面，必须在 HTTP 装配时显式发布；仅注册 Catalog 不会自动公开：

```ts
createAgentRouter({
  adapter,
  catalogContracts: [hostCatalog],
});
```

随后可通过只读接口读取：

```http
GET /api/a2ui/catalog-contract?catalogId=https%3A%2F%2Fyour-host.example.com%2Fcatalogs%2Fworkbench%2Fv1
```

成功响应包含 `serverApiVersion: 1`、`kind: "catalog-contract"`、原始 `catalog` 和可注入 system prompt 的 `promptContract`。缺失或空 `catalogId` 返回 400；未显式传入 `catalogContracts` 的 catalog 返回 404；重复 `catalogId` 会在宿主装配期失败。

同一个已发布 catalog 也会生成 Agent Onboarding Contract：

```http
GET /api/a2ui/agent-onboarding?catalogId=https%3A%2F%2Fyour-host.example.com%2Fcatalogs%2Fworkbench%2Fv1
```

它把 catalog contract、外部 RPC 请求 / 响应形状、错误边界码和带稳定 id 的验收要求合并成机器可读 JSON。宿主可在 `agentOnboarding.rpcEndpoint` 中显式选择是否披露 Agent endpoint。`verifyExternalAgentIntegration` 的 report 会按这些 id 返回逐项 check 结果。

外部 Agent 也可以先读取 `/api/a2ui/published-catalogs` 发现宿主显式发布的 catalog 摘要和两个 contract 的绝对 URL；该接口不会列出只注册在 adapter 内、未显式发布的 catalog。

## 3. Register The Action Path

`host/adapter.ts` 是 action 的组合点。当前模板中：

```ts
adapter.registerActionHandler(
  DEMO_AGENT_CATALOG_ID,
  DEMO_AGENT_ACTION,
  createExternalAgentActionHandler(options),
);
```

替换为你自己的 `catalogId` 和 action 名称。使用外部 Agent 时，action handler 会把已解析的用户输入和 surface history 发回同一个 endpoint，由 Agent 返回更新同一 surface 的 A2UI JSONL。

如果某个 action 想留在宿主进程内处理，也可以注册本地异步 handler；无论输出来自远端 Agent 还是本地业务系统，都必须通过同一个 catalog / lifecycle / action guard 后才能进入 SSE。

当前模板把这个替换点显式暴露为 `actionHandler`。默认不传时会回传外部 Agent；传入本地 handler 时，初始生成仍来自 external Agent endpoint，action 则由宿主业务进程处理：

```ts
import { createLocalApprovalActionHandler } from './local-action';

const adapter = createStandaloneHostAdapter({
  endpoint: 'https://agent.your-domain.example/a2ui',
  actionHandler: createLocalApprovalActionHandler(),
});
```

复制模板时应把 `local-action.ts` 的审批逻辑替换成自己的 CRM / OA / 工单调用。它没有独立放行通道，返回的仍是候选 A2UI JSONL。

可运行的 standalone demo 把这个选择暴露为环境变量：

```bash
NEXUS_DEMO_AGENT_MODE=deterministic NEXUS_DEMO_ACTION_MODE=local pnpm demo:standalone
```

`external` 是默认值；`local` 只改变 action 处理位置，不改变初始生成的 external Agent RPC。宿主 `/health` 会分别返回：

```json
{
  "agentMode": "external-rpc",
  "actionMode": "local"
}
```

### Inject Host Policy

宿主业务工作流不必写死在 Nexus guard 里。`AgentAdapterOptions.policy` 可以注入部分或完整策略：

```ts
import type { AgentPolicy } from '@nexus-ui/server';

const policy: AgentPolicy = {
  name: 'approval-policy',
  validateFinal: (context, components) => {
    const submit = components.find((component) => component.id === 'submit');
    return submit ? null : 'approval workflow requires a submit control';
  },
};

const adapter = createStandaloneHostAdapter({
  endpoint: 'https://agent.your-domain.example/a2ui',
  policy,
});
```

可覆盖的 hook：

| Hook | 用途 |
| --- | --- |
| `validateComponent` | 跨字段组件语义和宿主组件规则 |
| `validateLiteralMedia` | 字面量媒体安全 |
| `validateDynamicMedia` | 基于 dataModel 的动态媒体安全 |
| `getRequiredMedia` | 根据任务请求声明必需媒体组件 |
| `validateFinal` | 最终 surface 的工作流归属校验 |

未覆盖的 hook 使用 `nexusAgentPolicy` 默认实现。注入策略运行在协议、Profile、Catalog 和生命周期 guard 之后，适合承载审批、工单和权限上下文等宿主业务规则。

### Verify A Real Agent

实现外部 Agent 后，用一条命令验收完整宿主契约：

```bash
NEXUS_VERIFY_AGENT_ENDPOINT=https://agent.your-domain.example/a2ui \
  pnpm --filter @nexus-ui/standalone-host-demo verify
```

也可以传参：

```bash
pnpm --filter @nexus-ui/standalone-host-demo verify -- \
  --endpoint https://agent.your-domain.example/a2ui
```

验收器会启动临时 host API，并检查：

1. 外部 Agent 返回 NDJSON 生成流，最终以 `done` 结束。
2. host policy 要求 root 是 `ApprovalSummary` 且存在可执行 action。
3. runtime 能解析 action context 并触发回流。
4. action 响应保持同一 `surfaceId`，不 create surface，且 `root` 仍可 patch。
5. 一个独立的 `POLICY_REJECTED` 探针会验证 host policy 拒绝能进入 SSE `boundaryCode`。

成功时输出 JSON report；失败时非零退出并显示第一个未满足的契约。

## 4. Replace The Agent Endpoint

外部 Agent 不需要理解 React、HTML、浏览器 DOM 或你的设计系统内部实现。它只需要实现一个 HTTP POST endpoint：

```text
POST https://agent.your-domain.example/a2ui
Content-Type: application/json
Accept: application/x-ndjson
```

初始生成请求：

```json
{
  "version": 1,
  "kind": "generate",
  "surfaceId": "surface-xxx",
  "message": "Create a customer follow-up task",
  "catalogId": "https://your-host.example.com/catalogs/workbench/v1",
  "supportedComponents": ["CustomerSummary", "Text", "Button"],
  "supportedActions": ["submit"],
  "history": []
}
```

action 请求把 `message` 替换为已解析的 action：

```json
{
  "version": 1,
  "kind": "action",
  "surfaceId": "surface-xxx",
  "action": {
    "name": "submit",
    "surfaceId": "surface-xxx",
    "sourceComponentId": "submit-button",
    "timestamp": "2026-09-23T00:00:00.000Z",
    "context": {
      "taskTitle": "Send revised proposal",
      "priority": "high"
    }
  },
  "catalogId": "https://your-host.example.com/catalogs/workbench/v1",
  "supportedComponents": ["CustomerSummary", "Text", "Button"],
  "supportedActions": ["submit"],
  "history": []
}
```

Agent 必须返回 HTTP 2xx 和：

```text
Content-Type: application/x-ndjson
```

生成响应的 JSONL 形状：

```jsonl
{"version":"v0.9","createSurface":{"surfaceId":"surface-xxx","catalogId":"https://your-host.example.com/catalogs/workbench/v1"}}
{"version":"v0.9","updateComponents":{"surfaceId":"surface-xxx","components":[{"id":"root","component":"CustomerSummary","customerName":{"path":"/customerName"},"children":["submit"]}]}}
{"version":"v0.9","updateDataModel":{"surfaceId":"surface-xxx","value":{"customerName":"Acme Cloud"}}}
```

action 响应只能 `updateComponents` / `updateDataModel`，且必须使用同一个 `surfaceId`：

```jsonl
{"version":"v0.9","updateComponents":{"surfaceId":"surface-xxx","components":[{"id":"submit","component":"Button","child":"submit-label","disabled":true}]}}
{"version":"v0.9","updateDataModel":{"surfaceId":"surface-xxx","value":{"result":"Task created"}}}
```

在当前 demo 脚本中，endpoint 来自：

```bash
NEXUS_DEMO_AGENT_ENDPOINT=https://agent.your-domain.example/a2ui
```

`pnpm demo:standalone` 默认同时启动内置 demo Agent、host 和 web；显式配置 `NEXUS_DEMO_AGENT_ENDPOINT` 时，它会跳过内置 Agent，只启动 host 和 web。

## 5. Acceptance

### Happy Path

1. Host `/health` 返回 `agentMode: "external-rpc"`；local 模式还返回 `actionMode: "local"`。
2. 如已显式发布 catalog contract，浏览器或 curl 能读取同一份 Catalog 与 prompt。
3. 浏览器发起一次生成请求。
4. SSE 输出 `message` 流，最终包含 `event: done`，不包含 `event: error`。
5. 页面渲染的组件全部来自宿主 renderMap。
6. 触发按钮 action 后，请求携带原 `surfaceId` 和最新 dataModel context。
7. Agent 返回更新，同一个 DOM surface 原地 patch，不整页或整卡重建。
8. action 流最终也是 `done`，按钮按业务需要禁用。

本地 action 浏览器验收额外要求：页面显示 `action: local handler`；外部 Agent 只收到一次 `generate` 请求，不收到 `action` 请求；本地 handler 返回的更新仍保持原 `surfaceId`，以 `done` 结束，React 后显示 `Approved locally` 且按钮禁用。

接口级验收：

```bash
curl -N http://127.0.0.1:3101/api/a2ui/generate \
  -H 'Content-Type: application/json' \
  -d '{"message":"Create a customer follow-up task","catalogId":"https://your-host.example.com/catalogs/workbench/v1"}'
```

### Bad Output Path

把 endpoint 指向一个返回错误 Content-Type、非法 JSON、Markdown、数组、HTML、React 源码或空响应的 Agent。通过标准是：

```text
SSE event: error
no event: done
no partial surface committed to successful history
```

例如 Agent 返回 `application/x-ndjson` 但首行 JSON 未闭合时，宿主会输出：

```text
event: error
data: {"code":"AGENT_STREAM_ERROR","message":"外部 Agent 返回的 JSONL 中包含非法 JSON"}
```

不会输出 `event: done`。这条路径由 `examples/standalone-host-demo/tests/host-guard.test.ts` 锁定。

## 6. Out Of Scope

Quickstart 不代表以下能力已经进入 MVP：

- 认证、租户隔离、权限、审计和限流。
- 自动重试、服务发现和多实例 Agent 路由。
- 数据库、Redis 或消息队列版 surface history。
- 多 surface 并发展示。
- 把完整参考 server 实现当作稳定 npm SDK 使用；当前只承诺根入口的宿主装配 API。

这些属于宿主部署层或后续产品化边界。MVP 的验收点是：外部 Agent 可以替换，但它的输出不能绕过 Nexus UI 的统一 guard。
