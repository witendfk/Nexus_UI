# Host Integration Contract

状态：P1 参考契约。  
适用版本：Nexus UI MVP `0.1.0`。  
目的：说明宿主应用如何接入 Agent Task Surface，以及当前实现公开承诺的范围。

如果你要从一个可复制模板开始接入，先读 [host-quickstart.md](host-quickstart.md)；本文件保留完整契约和边界。

## 1. Integration Model

Nexus UI is inserted between an untrusted UI producer and a trusted host application:

```text
Business Agent / LLM
  -> host server Agent Adapter
  -> catalog, lifecycle, structure, and action guards
  -> transport (reference implementation: POST + SSE)
  -> @nexus-ui/core runtime
  -> @nexus-ui/react renderMap
  -> user input writes dataModel
  -> action returns to a registered business handler
  -> same surface is patched in place
```

The integration boundary is intentionally asymmetric:

- The agent may only describe UI through the allowed A2UI subset.
- The host owns catalogs, rendering components, action handlers, business systems, and audit policy.
- The browser never receives or executes frontend source code from the agent.

## 2. Current Package Boundaries

### Embeddable runtime packages

`@nexus-ui/core` and `@nexus-ui/react` are the current host integration path.

Both packages expose a root-entry API only. See [public-api.md](public-api.md) for the exact export contract, forbidden internal imports, and core/renderer compatibility policy.

```tsx
import { A2UIProvider, useA2UI } from '@nexus-ui/react';
import type { ActionEvent } from '@nexus-ui/core';

function AgentSurface({
  onAction,
}: {
  onAction: (event: ActionEvent) => void;
}) {
  return (
    <A2UIProvider onAction={onAction}>
      <SurfaceTransport />
    </A2UIProvider>
  );
}
```

`SurfaceTransport` is host-owned. It may consume SSE, WebSocket, a local stream, or another transport. For each accepted server-to-client message it calls:

```ts
const runtime = useA2UI();
runtime.push(`${messageJson}\n`);
```

At the end of the stream:

```ts
runtime.end();
```

The host action adapter wraps the framework-neutral `ActionEvent` into the selected transport. The reference web adapter adds the timestamp and client-to-server envelope; this responsibility is not in core.

Current display scope:

- Core state can contain multiple surfaces.
- The playground server and React provider expose one active rendered surface.
- Multi-surface display and concurrent surface routing are not part of MVP.

### Reference server implementation

`server/nexus-playground-server` exposes a limited host-assembly API from its root entry (`SERVER_API_VERSION = 1`) and keeps its executable reference assembly in `src/main.ts`:

- A host can import `AgentAdapter`, external JSONL RPC helpers, `InMemorySurfaceHistoryStore`, and `createAgentRouter` without starting the reference listener.
- The public root entry is import-only.
- The root entry does not export built-in catalogs, LLM selection, mock business handlers, the module-global history store, or the reference Koa app.

An external enterprise host can use the limited assembly API or implement the same boundary in its own backend. The wider reference server remains a composition example, not a production SDK; authentication, tenant policy, durable storage, retries, and audit remain host responsibilities.

The standalone HTTP assembly pattern lives in:

```text
examples/standalone-host-demo/src/host
  adapter.ts  custom catalog + external JSONL RPC Agent + action loop
  app.ts      Koa /health, /api/a2ui/generate, /api/a2ui/event
```

It is an example-owned assembly, not part of the server package. Deployment credentials, authentication, tenant policy, rate limits, and audit logging are intentionally outside the MVP.

### Runnable standalone demo

The repository also includes a three-process demo under:

```text
examples/standalone-host-demo
```

Run it from the repository root:

```bash
pnpm demo:standalone
```

Without an explicit `NEXUS_DEMO_AGENT_ENDPOINT`, it starts an LLM-backed external demo Agent, a standalone host API, and a React host page. When that endpoint is configured, the same command starts only the host and web processes and connects them to the external Agent. Open `http://127.0.0.1:3100/`, use the default approval request, generate the surface, and click the generated approval button. The same surface patches to the approved state and the button is disabled. See [examples/standalone-host-demo/README.md](../examples/standalone-host-demo/README.md) for configuration, ports, environment variables, and acceptance steps.

The demo Agent reads the repository's development LLM configuration and emits candidate A2UI JSONL. Its model output still passes the unified guard before SSE. A future full Agent project only needs to replace the JSONL RPC endpoint.

The demo also publishes its explicitly selected Catalog Contract. The browser button `查看 Catalog Contract` reads it through the host route below; the response uses the same `standaloneHostCatalog` object that the host guard registers.

The template also supports mixed ownership with `NEXUS_DEMO_ACTION_MODE=local`: initial generation comes from the external Agent while an action is handled by a host-local business handler. The browser shows `action: local handler`, and the local result reads `Approved locally` to make the policy visible. `tests/local-action.test.ts` locks the RPC boundary with a custom catalog and React render map; the local handler output still passes the unified guard and patches the same surface.

### Replaceable in-process generation source

P5-a adds a local host seam in the reference `AgentAdapter`. A host can replace the built-in LLM / fallback selection without changing core, React, or HTTP routing:

```ts
const adapter = new AgentAdapter({
  createGenerationSource: (sourceRequest) => createHostAgentMessages(sourceRequest),
});
```

`sourceRequest` contains the newly created `surfaceId`, user message, resolved `catalogId`, catalog definition, supported component names, and supported action names. The source returns an iterable or async iterable of candidate A2UI message objects; it does not write SSE frames.

Every custom-source message still passes the same `validateA2UIMessage` and Agent stream guard. Invalid output ends with an SSE `error`, never `done`, and is not committed to surface history.

### Replaceable host policy

`AgentAdapterOptions.policy` accepts a partial host policy. A host can override any subset of the default media, component-semantic, and workflow checks:

```ts
const adapter = new AgentAdapter({
  policy: {
    name: 'crm-approval-policy',
    validateFinal: (context, components) => {
      // Return null when the final surface satisfies host workflow rules.
      return null;
    },
  },
});
```

Omitted hooks continue to use `nexusAgentPolicy`. Overrides apply to generation and action streams for that adapter; every stream still passes protocol, profile, lifecycle, and Catalog boundaries before host policy results are emitted.

### Reusable external Agent verification

`verifyExternalAgentIntegration` accepts the host's Catalog, optional policy, external Agent RPC config, task message, and an action selector. It starts a temporary guarded host path, calls the external Agent for generation and action, verifies `POLICY_REJECTED` handling, and returns a structured report:

```ts
const report = await verifyExternalAgentIntegration({
  endpoint: 'https://agent.internal.example/a2ui',
  catalog: hostCatalog,
  policy: approvalPolicy,
  message: 'Create a customer follow-up task',
  actionSelector: (components) =>
    components.find((component) => component.id === 'submit') ?? null,
});
```

Use it in CI or a host-owned verification command. A successful report confirms generation, policy boundaries, action dispatch, and same-surface patching at the API contract level.

Business action handlers now receive a second read-only context:

```ts
adapter.registerActionHandler(catalogId, 'submit', (action, context) => {
  // context.catalogId, context.catalog, context.supportedActions, context.history
});
```

`context.history` contains the successful LLM / host-source generation turns for the same `surfaceId`, copied before dispatch so handlers cannot mutate runtime history. Existing handlers that use only the `action` parameter remain compatible.

### External business-agent JSONL RPC

P5-b adds a reference HTTP helper for a host-owned business Agent:

```ts
const rpc = {
  endpoint: 'https://agent.internal.example/a2ui',
  headers: { Authorization: 'Bearer host-owned-token' },
  timeoutMs: 15_000,
  maxBytes: 2_000_000,
};

const adapter = new AgentAdapter({
  createGenerationSource: createExternalAgentGenerationSource(rpc),
});
adapter.registerActionHandler(
  catalogId,
  'submit',
  createExternalAgentActionHandler(rpc),
);
```

Both helpers send one JSON request and expect one newline-delimited JSON response:

```json
{
  "version": 1,
  "kind": "generate",
  "surfaceId": "surface-xxx",
  "message": "Create this task surface",
  "catalogId": "https://example.com/catalogs/workbench/v1",
  "supportedComponents": ["CustomerSummary"],
  "supportedActions": ["submit"],
  "history": []
}
```

For `kind: "action"`, `message` is replaced by the resolved client `action` object. The endpoint must return HTTP 2xx, `Content-Type: application/x-ndjson` (or `application/jsonl`), and one candidate A2UI message object per line. Generation still starts with `createSurface`; action response may only update the same surface. Markdown, arrays, HTML, and frontend source code are not accepted.

A non-2xx response should return:

```json
{
  "error": {
    "message": "Human-readable reason"
  }
}
```

Timeout, oversized output, malformed JSONL, wrong content type, and empty output are converted to local RPC errors. When used by `AgentAdapter`, those errors reach the browser as SSE `error` without `done`; a failed generation is not committed to history. There are no automatic retries, remote credential management, tenant routing, or durable RPC logs in this MVP slice.

### Injectable surface history store

P5-c turns surface history into a host-injectable asynchronous boundary instead of a module-global dependency:

```ts
const adapter = new AgentAdapter({
  historyStore: new InMemorySurfaceHistoryStore(),
});
```

The default in-memory implementation keeps the last 64 surfaces and the last 20 turns per surface. A successful generation calls one atomic `commitGeneration(surfaceId, catalogId, turns)` operation; generation source and action handlers receive copied read-only snapshots. This lets a database adapter persist the catalog mapping and user / assistant turns in one transaction.

A host may replace the store with its own implementation as long as it provides asynchronous `getHistory`, `getCatalogId`, and `commitGeneration`. `prepareGeneration` and `prepareAction` await store reads. After the complete A2UI stream passes its final guard, `sendAgentRun` awaits `commit`; only a successful commit emits SSE `done`. A commit failure emits `error` without `done`.

For local development or a single-process deployment, the reference server also provides `FileSurfaceHistoryStore`:

```ts
import { FileSurfaceHistoryStore } from './agent/file-history';

const historyStore = new FileSurfaceHistoryStore('./.nexus/surface-history.json');
await historyStore.initialize();

const adapter = new AgentAdapter({ historyStore });
```

The file adapter restores the same capacity policy after a restart: the last 64 surfaces and the last 20 turns per surface. Commits are serialized and write a same-directory temporary file before renaming it to the history file; a write failure rejects the generation and does not replace the previously committed state. The reference server enables it only when `NEXUS_HISTORY_FILE` is configured. Without that variable, surface history remains in memory.

This file adapter is intentionally local and single-process. It is not a multi-instance coordination mechanism, database replacement, tenant boundary, or audit system.

## 3. Runtime Contract

### Server-to-client messages

Generation stream:

```text
createSurface
updateComponents (must eventually include id=root)
updateDataModel (optional)
```

Action response stream:

```text
updateComponents
and/or updateDataModel
```

Rules:

1. A generation stream starts with exactly one `createSurface`.
2. All later generation messages use the same `surfaceId`.
3. Generation output may not delete the surface.
4. Action output may not create or delete a surface.
5. Components use stable IDs and are upserted in place.
6. Structure and binding errors are rejected before the browser renders a guarded server stream.
7. Core also validates direct messages and records bad lines without stopping later lines.

### Client-to-server action

The reference API accepts only:

```json
{
  "version": "v0.9",
  "action": {
    "name": "submit",
    "surfaceId": "surface-xxx",
    "sourceComponentId": "submitButton",
    "timestamp": "2026-09-18T00:00:00.000Z",
    "context": {
      "name": "A2UI Runtime",
      "subscribed": true
    }
  }
}
```

Unknown envelope fields and unknown action fields are rejected. The context values are resolved by core from `{ path }` bindings at interaction time.

## 4. Reference HTTP API

These routes belong to the playground server reference implementation.

### Generate a surface

```http
POST /api/a2ui/generate
Content-Type: application/json
Accept: text/event-stream
```

Request:

```json
{
  "message": "Create a follow-up task for this customer.",
  "catalogId": "https://example.com/catalogs/nexus-workbench/v1"
}
```

`message` is optional and defaults to a contact-card request. `catalogId` is optional and defaults to the Nexus Basic Task Profile. Unknown request fields are rejected.

Both JSON POST endpoints apply the reference server's request-boundary rules:

- `Content-Type` must be `application/json` or a `+json` media type.
- An oversized `Content-Length` is rejected before the body is read.
- Streamed body bytes are counted and rejected when they exceed the configured limit.
- A request body that does not finish within the configured timeout is rejected and the socket is closed.
- Defaults are 1 MiB and 10 seconds; configure them with `NEXUS_MAX_REQUEST_BODY_BYTES` and `NEXUS_REQUEST_TIMEOUT_MS`.

These are local DoS guards for the reference assembly, not authentication or tenant authorization.

Successful response content type is `text/event-stream`:

```text
event: message
data: {"version":"v0.9","createSurface":{...}}

event: message
data: {"version":"v0.9","updateComponents":{...}}

event: done
data: {}
```

For generation, `done` is emitted only after the complete stream passes its final guard and surface history commits successfully. Guard or commit failure emits an `error` event and no `done` event.

Guard failures caused by catalog component contracts can carry structured diagnostics:

```json
{
  "code": "AGENT_STREAM_ERROR",
  "boundaryCode": "CATALOG_UNSUPPORTED",
  "message": "TaskSummary.amount 必须是 number",
  "diagnostics": [
    {
      "path": "TaskSummary.amount",
      "message": "TaskSummary.amount 必须是 number",
      "dataPath": "/amount"
    }
  ]
}
```

`boundaryCode` identifies the failed boundary (`PROTOCOL_INVALID`, `LIFECYCLE_INVALID`, `CATALOG_UNSUPPORTED`, `FEATURE_UNSUPPORTED`, or `POLICY_REJECTED`). `POLICY_REJECTED` is used by default media/component rules and injected host policies. Each diagnostic contains `path`, `message`, and optional `dataPath`. `path` identifies the component props location; `dataPath` identifies the dataModel path behind a `{ path }` binding when applicable. The `diagnostics` field is omitted for ordinary stream and transport failures. Hosts should consume these fields instead of parsing `message`.

### Send an action

```http
POST /api/a2ui/event
Content-Type: application/json
Accept: text/event-stream
```

Request body is the client-to-server action envelope above. Successful handler output is streamed through the same `message` / `error` / `done` SSE contract.

### Read a published Catalog Contract

Catalog registration is an internal guard boundary. A host must explicitly pass selected catalogs to the assembly API before they become externally discoverable:

```ts
createAgentRouter({
  adapter,
  catalogContracts: [hostCatalog],
});
```

The optional read-only route is:

```http
GET /api/a2ui/catalog-contract?catalogId=<encoded-catalog-id>
```

Successful response:

```json
{
  "serverApiVersion": 1,
  "kind": "catalog-contract",
  "catalog": {},
  "promptContract": "# A2UI Catalog Contract\n..."
}
```

`promptContract` is generated by `createCatalogPromptContract(catalog)`. It is documentation for an external Agent, not an authorization decision: generated output still passes the unified lifecycle, catalog, schema, and action guards.

Semantics:

- Missing or empty `catalogId`: HTTP 400.
- Registered internally but not explicitly published: HTTP 404.
- Duplicate `catalogId` publication: host assembly throws.
- The route returns the catalog definition and prompt only; it does not expose React render maps, action handlers, credentials, or business systems.
- Authentication, tenant authorization, and public rate limiting remain host deployment responsibilities.

### Read a published Agent Onboarding Contract

```http
GET /api/a2ui/agent-onboarding?catalogId=<encoded-catalog-id>
```

This route is available only for a catalog explicitly passed through `catalogContracts`. It combines the Catalog Contract with external JSONL RPC request/response rules, SSE error boundary codes, and acceptance checks. The host may disclose its Agent endpoint and verification command through:

```ts
createAgentRouter({
  adapter,
  catalogContracts: [hostCatalog],
  agentOnboarding: {
    rpcEndpoint: 'https://agent.internal.example/a2ui',
    verificationCommand: 'pnpm verify-agent',
  },
});
```

Missing or unpublished catalogs return HTTP 404. The contract is documentation and a verification target; it does not authorize an Agent or bypass the guard.

## 5. Catalog Contract

The reference server registers:

| Catalog | Allowed components | Allowed actions |
| --- | --- | --- |
| Nexus Basic Task Profile | 14-component guarded subset | `call`, `search`, `submit` |
| Task Catalog | `TaskSummary`, `TaskButton` | `start`, `complete` |
| Workbench Catalog | `CustomerSummary`, `Text`, `TextField`, `ChoicePicker`, `DateTimeInput`, `Button`, `Column`, `Row`, `Divider` | `submit` |

Nexus Basic Task Profile ID:

```text
https://example.com/catalogs/nexus-basic-task/v1
```

Legacy compatibility input:

```text
https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json
```

The legacy URL is normalized to the canonical profile for new generations and action dispatch. It is not an official Basic Catalog identity.

Official Basic Catalog ID (not registered by this profile):

```text
https://a2ui.org/specification/v0_9/basic_catalog.json
```

Task Catalog ID:

```text
https://example.com/catalogs/nexus-task/v1
```

Workbench Catalog ID:

```text
https://example.com/catalogs/nexus-workbench/v1
```

A host custom catalog must satisfy four conditions:

1. Server registers a stable `catalogId`, component-name whitelist, optional `actions` whitelist, and, for custom components, props schemas.
2. React supplies a matching `catalogRenderMaps[catalogId]`.
3. Every supported action has a business handler registered by `catalogId + action.name`.
4. Guard tests reject unregistered components, cross-catalog components, unsupported actions, and action responses that change surface lifecycle.

Current boundary: Catalog Registry enforces component names, declarative component capability policies (allowed fields, binding policy, action attachment, checks scope, and field origin), a deterministic schema subset for custom catalog props (`type`, `required`, `enum`, ranges, lengths, `pattern`, nested arrays / objects, and `{ path }` binding policy). A separate host policy layer enforces media safety, cross-field component semantics, and workflow ownership such as search, submit, and Workbench loops. Diagnostics are aggregated. When a `{ path }` binding resolves to an existing dataModel value, that resolved value is also validated; a missing path remains pending to preserve streaming semantics. This is not a complete standard JSON Schema engine, official Basic Catalog conformance layer, or replacement for host authorization. Enterprises should not treat catalog registration alone as a full security policy.

`CatalogDefinition.actions` is a Nexus host-boundary extension, not a new A2UI wire field:

```ts
const catalog = new CatalogRegistry([
  {
    catalogId: 'https://example.com/catalogs/host-approval/v1',
    components: ['ApprovalSummary', 'Text', 'Button'],
    actions: ['approve'],
    componentSchemas: { /* ... */ },
  },
]);
```

The reference `AgentAdapter` and stream guard use the declared action list for generation-source requests, action-handler context, and component action validation. An `A2UIRuntime` with the same `catalogRegistry` also rejects an undeclared component action before it enters state, including direct JSONL / dispatch consumption. An empty list declares a display-only catalog. Core does not force a fallback when `actions` is omitted; the reference server retains the built-in Basic-compatible fallback for pre-P7-a assemblies.

## 6. Supported Subset

### Nexus Basic Task Profile components

| Component | MVP status | Notes |
| --- | --- | --- |
| `Text` | Supported | Literal text and `{ path }` binding; URL-like media must use `Image`. |
| `Image` | Supported | `url`, `description`, `fit`, `variant`; HTML-style `src` / `alt` rejected. |
| `Icon` | Supported | Basic renderMap implementation. |
| `Row` | Supported | Static `children`. |
| `Column` | Supported | Static `children`. |
| `List` | Supported | Static `children`, `direction`, `align`; no ChildList template. |
| `Card` | Supported | Static child structure. |
| `Tabs` | Supported | Static `tabs`; activation state is local to React renderer. |
| `Divider` | Supported | Basic layout divider. |
| `Button` | Supported | `action.event` only; minimal `checks` can disable the button. |
| `TextField` | Supported | Four variants, `{ path }` write-back, `validationRegexp`, and minimal `checks`. |
| `CheckBox` | Supported | Boolean `{ path }` write-back. |
| `ChoicePicker` | Supported | Single or multiple selection, `checkbox` / `chips`, filtering, and `string[]` `{ path }` write-back. |
| `DateTimeInput` | Supported | Date, time, or date-time input; `min` / `max`; ISO 8601 string `{ path }` write-back. |
| `Slider` | Supported | Finite numeric range with `min` / `max`; numeric `{ path }` write-back and minimal `checks`; no component action. |
| `Video` | Supported | Required `url` as a string or `{ path }`; rendered with the host's native video player. No component action or HTML-style fields. |
| `AudioPlayer` | Supported | Required `url` and optional `description` as strings or `{ path }`; rendered with the host's native audio player. No component action or HTML-style fields. |
| `Modal` | Not open | No runtime or renderMap implementation. |

### Protocol features

| Feature | Status |
| --- | --- |
| JSONL buffering | Supported |
| Progressive component rendering | Supported |
| Stable component ID patching | Supported |
| `createSurface` / `updateComponents` / `updateDataModel` | Supported |
| `deleteSurface` | Core supports it; guarded Agent generation/action streams reject it |
| Static `child` / `children` | Supported |
| `{ path }` dynamic values | Supported |
| `action.event` | Supported |
| `action.functionCall` | Not supported |
| `checks` validation | Minimal support |
| ChildList template | Not supported |
| `sendDataModel` | Not supported end to end |
| Theme | Stored by core; standard React components do not yet apply it |
| Multiple active rendered surfaces | Not supported in playground |
| WebSocket / A2A / MCP transport | Not implemented |

Minimal `checks` support means Nexus Basic Task Profile `TextField` / `Slider` / `Button` may use the official `{ condition, message }` rule shape with `required`, `regex`, `length`, `numeric`, or `email`. Core derives the first failed message from the current dataModel, React exposes it with invalid-state accessibility attributes, and a failed Button check blocks `triggerAction`. Composite functions (`and` / `or` / `not`), custom functions, cross-field validation, and Workbench checks remain unsupported.

## 7. Security Boundaries

The reference guard rejects:

- Unknown or unregistered components.
- Unsupported action names.
- Actions attached to components outside the catalog contract.
- Surface lifecycle violations.
- Generation or action streams that change `surfaceId`.
- Missing `root`.
- Multi-payload envelopes.
- HTML-style `Image.src` / `Image.alt`.
- URL-like values intended for `Text` when an image URL was requested.
- Illegal TextField fields, variants, and regular expressions.
- Illegal CheckBox fields and non-bound values.
- Illegal ChoicePicker fields, duplicate or empty option values, and non-bound values.
- Illegal DateTimeInput fields, invalid ISO 8601 min/max values, missing date/time capability, and non-bound values.
- Basic `checks` outside `TextField` / `Slider` / `Button`, unsupported functions, invalid bounds or regexes, overlong messages or regexes, and more than 8 rules.
- Workbench customer-summary fields that are not bound through allowed dataModel paths.
- Custom catalog props that are missing required fields, use unknown fields, violate enum / type rules, or bypass the declared `{ path }` binding policy.
- Workbench generation that omits the required task input, priority, date-time reminder, submit button, result component, or customer action context.

The reference HTTP adapter also rejects non-JSON request media types, oversized request bodies, and request bodies that exceed the configured read timeout. Authentication, tenant policy, and public-network rate limiting remain host responsibilities.

Known gaps that an enterprise deployment must add:

- Domain allowlist for remote images and other media.
- Authentication, authorization, tenant isolation, and audit logging.
- Persistent surface and task state.
- Rate limiting and abuse controls.
- Complete standard JSON Schema validation and cross-field checks.
- URL, media type, content-size, and privacy checks for remote resources.

These gaps are intentional MVP boundaries, not claims of production completeness.

## 8. Host Acceptance Checklist

A new integration should be accepted only when all eight items pass:

1. The agent stream is fully rejected before rendering when it violates the catalog or lifecycle.
2. The first accepted generation creates and renders `root`.
3. Later component updates patch the same component IDs.
4. TextField, CheckBox, ChoicePicker, and DateTimeInput changes are visible in core dataModel state.
5. A Button action carries the latest resolved context.
6. The business handler is selected by `catalogId + action.name`.
7. The handler response patches the same surface.
8. Real LLM and adversarial-output tests both pass.

For the current playground, this checklist is covered by package tests plus the M5-M10, P2-P4, and P5-a acceptance records in [agent-line-scope.md](agent-line-scope.md).
