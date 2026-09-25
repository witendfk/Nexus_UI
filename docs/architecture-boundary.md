# Architecture And Naming Boundary

状态：当前方向锚点。  
日期：2026-09-25。  
用途：统一协议兼容、Catalog 支持范围和产品边界的表述，避免把 “基于 A2UI v0.9” 误写成 “完整实现 Google Basic Catalog”。

## 1. Core Statement

Nexus UI uses the A2UI v0.9 message model as its protocol foundation. The current deliverable is a guarded Agent UI runtime for task surfaces, not a complete A2UI v0.9 renderer and not a complete Google Basic Catalog implementation.

中文口径：

> Nexus UI 遵循 A2UI v0.9 的消息模型、surface 生命周期、dataModel 绑定和 action 回流语义。  
> 当前对外交付的是 Nexus Agent Task Profile：一个受 Catalog 约束的 Agent 任务界面运行时。  
> 它不承诺接收任意合法 v0.9 Agent 输出，也不冒充官方 Basic Catalog 的完整实现。

## 2. Layers

| Layer | Responsibility | Must not do |
| --- | --- | --- |
| Protocol layer | Validate the A2UI v0.9 envelope, payload shape, surface lifecycle, and protocol-owned structures. | Reject a protocol-valid feature only because the current product MVP has not implemented it. |
| Capability layer | Declare and enforce the current Nexus runtime profile: supported components, props, actions, functions, templates, theme, and data-model synchronization. | Claim unsupported official features as implemented. |
| Policy layer | Enforce host business rules, action ownership, URL policy, workflow constraints, and rejection rules. | Become a hidden protocol dialect or bypass the catalog contract. |
| Renderer layer | Map guarded VNodes to host components and report interaction back through core seams. | Own protocol parsing, business authorization, or state ownership. |

The intended diagnostic vocabulary is:

| Code | Meaning |
| --- | --- |
| `PROTOCOL_INVALID` | The message is not valid A2UI v0.9. |
| `LIFECYCLE_INVALID` | The message shape is valid, but surface ordering or ownership is invalid. |
| `CATALOG_UNSUPPORTED` | The component, prop, or action is not declared by the active catalog. |
| `FEATURE_UNSUPPORTED` | The message is protocol-valid but outside the current runtime profile. |
| `POLICY_REJECTED` | The host rejects the output for workflow, safety, or business reasons. |

## 3. Catalog Naming

Do not use “Basic Catalog” as a vague synonym for “everything Nexus currently renders”.

| Name | Meaning |
| --- | --- |
| Nexus Agent Task Profile | The overall product/runtime positioning: a guarded Agent task-surface profile built on A2UI v0.9 semantics. |
| Nexus Basic Task Profile | The default catalog subset used by Nexus demos and the playground. It selects some official Basic component names but does not implement every official field or behavior. |
| Official Basic Catalog | The catalog declared by `specification/v0_9/json/basic_catalog.json`, including its official `catalogId`, components, fields, functions, and theme schema. |
| Host Catalog | A custom catalog owned by an application, such as task, workbench, or approval catalogs. It may define custom components and explicit host extensions. |

The current implementation still contains a legacy Basic Catalog ID that differs from the official file. Until that is reconciled, documentation and demos must describe the playground boundary as a Nexus profile, not as official Basic Catalog conformance.

## 4. Current Profile Boundary

The current runtime profile supports a deliberately narrow loop:

```text
createSurface
  -> static component tree
  -> selected Basic-like controls
  -> { path } dataModel bindings
  -> action.event with resolved context
  -> updateComponents / updateDataModel for the same surface
```

Supported capabilities are documented in `docs/agent-line-scope.md` and `docs/host-integration.md`. Those documents describe implementation reality, not official protocol completeness.

Intentionally outside the current profile:

- Official `Modal`.
- Generic `FunctionCall` in dynamic values and actions.
- `ChildList` templates and relative item scope.
- `sendDataModel` synchronization.
- Complete official component field coverage.
- Complete official function catalog.
- Multiple concurrently rendered surfaces.
- A2A, MCP, and WebSocket transports.

## 5. Direction Rule

Before adding a feature, classify it:

1. Is it required by a real Agent task workflow?
2. Is it a protocol-layer fix, a capability-layer addition, or a host policy extension?
3. Which catalog contract declares it?
4. Which official example or conformance fixture proves it?
5. How is an unsupported but protocol-valid message diagnosed?

A change may proceed only when it strengthens the guarded Agent Task Surface loop. Component count is not a success metric.

## 6. Convergence Milestones

### P14-a — Protocol / Profile Separation — Completed

P14-a separated protocol validity from profile capability in code, tests, diagnostics, and documentation.

The public core API now exposes:

```text
validateProtocolMessage()      -> official A2UI v0.9 structural validity
validateNexusProfileMessage()  -> current Nexus runtime-profile support
validateA2UIMessage()          -> compatibility composition of both checks
```

`A2UIRuntime`, the reference server stream guard, and compatibility tests use these boundaries. All 33 official Basic Catalog examples are classified as protocol-valid; none is claimed as fully profile-supported.

Runtime diagnostics now carry `PROTOCOL_INVALID`, `LIFECYCLE_INVALID`, `CATALOG_UNSUPPORTED`, and `FEATURE_UNSUPPORTED` codes. `POLICY_REJECTED` is reserved for the host policy boundary as server guard classification is migrated.

### P14-b — Catalog Identity — Next

Next, reconcile the legacy Basic Catalog ID with the official catalog ID, separate official fields from Nexus extensions such as `disabled`, and move component-specific guard rules from the server into catalog contracts.
