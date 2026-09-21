# Public API And Compatibility

状态：P5-d API 契约。  
适用版本：Nexus UI MVP `0.1.0`。  
目的：定义宿主可以 import 的稳定入口、禁止依赖的内部路径，以及协议版本、包版本和 API 版本的兼容规则。

## API Principles

Nexus UI uses root-entry APIs only:

```ts
import { A2UIRuntime } from '@nexus-ui/core';
import { A2UIProvider } from '@nexus-ui/react';
```

Internal module paths such as `@nexus-ui/core/dist/runtime` or source files under `packages/*/src/**` are not public. A host should not import them, and changes to those modules do not require a public API version bump.

The reference server is an assembly example, not a production SDK. Its Koa app, router, Agent Adapter, LLM client, catalogs, action handlers, and history stores may change as the reference evolves. Hosts should copy the integration pattern or assemble an equivalent server in their own codebase.

## `@nexus-ui/core`

Current API version: `CORE_API_VERSION = 1`.

Stable root-entry exports in `0.1.x`:

- Runtime: `A2UIRuntime`, `RuntimeOptions`.
- Protocol: `JSONLBuffer`, `isA2UIMessage`, `validateA2UIMessage`, `PROTOCOL_VERSION`, `A2UIError`, `A2UIDiagnostic`, and the A2UI v0.9 message / payload / component / action types.
- Catalog boundary: `CatalogRegistry`, `CatalogDefinition`, `validateComponentProps`, `validateComponentPropsDiagnostics`, `validateComponentSchema`, `ComponentSchemaDiagnostic`, and the component schema node types.
- State and render seams: `createCoreStore`, `CoreState`, `CoreStore`, `buildTree`, `VNode`, `Surface`, `RenderFn`, and `RenderMap`.
- Interaction and data helpers: `buildActionEvent`, `ActionEvent`, `getByPath`, `setValueAtPath`, `removeAtPath`, `applyDataModelUpdate`, `resolveDynamic`, `resolveContext`, and `toDisplayString`.
- Compatibility metadata: `VERSION`, `CORE_API_VERSION`.

Core remains framework-neutral. It must not import React, DOM APIs, Node-only APIs, SSE, Koa, or a business Agent.

Runtime errors use `A2UIError`. Catalog schema failures may include structured `A2UIDiagnostic[]` in `error.diagnostics`; each item has `path`, `message`, and optional `dataPath`. Runtime `onError` and store error records preserve these diagnostics so hosts can locate the failing props or data binding without parsing message text.

## `@nexus-ui/react`

Current API version: `REACT_API_VERSION = 1`.

Stable root-entry exports in `0.1.x`:

- Provider: `A2UIProvider`, `A2UIProviderProps`, `useA2UI`.
- Renderer: `ReactRenderer`, `RenderContext`, `RenderFn`, `RenderMap`.
- Standard render map and 14 components: `standardRenderMap`, `Text`, `TextField`, `CheckBox`, `ChoicePicker`, `DateTimeInput`, `Button`, `Column`, `Row`, `List`, `Tabs`, `Image`, `Card`, `Icon`, `Divider`.
- Compatibility metadata: `CORE_VERSION`, `PROTOCOL_VERSION`, `REACT_RENDERER_VERSION`, `REACT_API_VERSION`, `SUPPORTED_CORE_API_VERSION`, `SUPPORTED_CORE_VERSION_RANGE`, `getReactCoreCompatibility`, and `ReactCoreCompatibility`.

The React package does not own transport, client action envelopes, credentials, or business handlers. It maps guarded VNodes to React elements and exposes interaction through the core runtime.

`A2UIProviderProps.onError` receives the core `A2UIError` emitted by the runtime. It is called through a stable runtime seam and preserves `diagnostics` for host telemetry, toast, or debug UI integration.

An executable minimal host is maintained at [`packages/nexus-react/examples/minimal-host.tsx`](../packages/nexus-react/examples/minimal-host.tsx). It feeds local JSONL into core through the public React Provider, registers a catalog boundary with `catalogRegistry`, and renders a custom catalog with `catalogRenderMaps`; replace the local JSONL constant with an SSE/WebSocket reader when connecting a real Agent.

Use `getReactCoreCompatibility()` when assembling a host:

```ts
import { getReactCoreCompatibility } from '@nexus-ui/react';

const compatibility = getReactCoreCompatibility();
if (!compatibility.compatible) throw new Error('Incompatible Nexus UI core/renderer pair');
```

## Compatibility Policy

There are three independent version layers:

| Layer | Current value | Meaning |
| --- | --- | --- |
| A2UI protocol | `v0.9` | Exact wire contract accepted by core |
| Package version | `0.1.0` | Implementation release version |
| Root API version | Core `1`, React `1` | Shape of the root-entry contract |

While Nexus UI remains in `0.x`, all packages are private and pre-stable. Within the workspace, however, these rules apply:

1. Removing or changing a documented root-entry export requires a public API version bump.
2. Adding an export is allowed without changing the API version in `0.1.x`; the API surface test must be updated intentionally.
3. A protocol change is not a normal minor implementation change. It must be introduced as a separately documented protocol target, not silently mixed into renderer work.
4. React `0.1.x` supports core package versions `0.1.x` with core API version `1` and protocol version `v0.9`.
5. The API version does not describe runtime completeness. Unsupported protocol features remain tracked in the support matrix and must not be advertised as stable capabilities.

This policy intentionally keeps the product honest: a host can detect the core/renderer contract and know exactly which entry points are part of the runtime, while unfinished A2UI v0.9 features remain outside the supported matrix.
