# Nexus UI Product Position and Landing Scope

状态：当前产品方向锚点。  
日期：2026-09-19。  
用途：后续迭代前先回到本文档校准方向，避免把项目做成组件画廊、UI 画板或无边界协议实现。

## 0. Project Success Mode

Nexus UI is a personal engineering and interview project, not a commercial-product bet. Its success is measured by whether it clearly demonstrates protocol runtime design, trust boundaries, frontend architecture, state binding, action回流, real LLM acceptance, and maintainable tests and documentation.

Commercial adoption, multi-tenant deployment, and a complete platform are non-goals for the MVP. They can be discussed as future engineering directions, but they must not expand the current scope away from a small, verifiable Agent Task Surface loop.

## 1. One-Sentence Position

Nexus UI is an A2UI-based Agent UI Runtime: agents emit declarative A2UI messages, and Nexus UI safely validates, incrementally renders, binds user input, dispatches business actions, and patches the same surface in place.

中文表述：

> Nexus UI 是基于 A2UI 协议的 Agent 动态任务界面运行时。  
> Agent 只输出声明式 UI 消息；Nexus UI 负责安全校验、流式渲染、用户输入绑定、业务 action 回流和同 surface 原地更新。

它不是 UI 画板。UI 画板的终点是“生成一张页面”；Nexus UI 的终点是“让 Agent 生成的界面可以安全运行，并把用户操作送回业务系统”。

## 2. Problem To Solve

When an agent needs to present UI, the common options are unsafe or hard to integrate:

| Agent output | Problem |
| --- | --- |
| HTML | XSS and styling risks; browser capabilities leak to the model |
| React / source code | Requires code execution and breaks trust boundaries |
| Arbitrary JSON | Every app must invent parsing, validation, rendering, state, and action contracts |
| Markdown / text only | Cannot express forms, selections, task state, or business operations |

Nexus UI replaces this with one protocol-backed execution path:

```text
Agent
  -> A2UI v0.9 JSONL
  -> server catalog / lifecycle / structure guard
  -> SSE or another transport
  -> framework-agnostic core
  -> VNode tree
  -> React renderMap
  -> user input writes dataModel
  -> Button action returns resolved context
  -> business handler updates the same surface
```

The important distinction is:

```text
UI canvas: prompt -> page -> end
Nexus UI:  protocol message stream -> live UI -> state -> action -> business result -> in-place patch
```

## 3. Product-Level Capabilities

### 3.1 Safe Agent UI Boundary

The agent cannot emit arbitrary frontend code. Output is constrained by:

- A2UI message structure.
- Surface lifecycle.
- Component catalog whitelist.
- Component field guard.
- Supported action names.
- Data binding rules.

Malformed model output is rejected before it reaches the client.

This is the primary platform value: model-generated UI is useful only when it is bounded and inspectable.

### 3.2 Streaming UI Execution

UI is not treated as one final page snapshot. A2UI messages arrive and apply progressively:

```text
createSurface
  -> root arrives
  -> child placeholders render
  -> later components fill placeholders
  -> dataModel arrives
  -> bindings refresh
```

Streaming happens at A2UI message granularity. The model may stream tokens, but incomplete JSON is not sent to the runtime as UI until a complete JSONL message is available.

### 3.3 State Binding

UI structure and state are separate:

```text
components: what controls exist and how they reference data
dataModel:  current values used by those controls
```

Examples:

```json
{
  "name": "A2UI Runtime",
  "subscribed": true
}
```

React reports user edits to the core runtime. The core resolves the bound path and writes the dataModel. React does not invent state ownership rules.

### 3.4 Business Action Loop

A Button action context may contain bindings such as:

```json
{
  "name": { "path": "/name" },
  "subscribed": { "path": "/subscribed" }
}
```

When clicked, core resolves the current model values:

```json
{
  "name": "A2UI Runtime",
  "subscribed": true
}
```

The host sends the action to the business agent or handler. The response updates the same surface and stable component IDs, so the UI is patched instead of rebuilt.

### 3.5 Catalog and Design-System Control

A2UI components are protocol names, not a forced visual implementation.

An enterprise can map them through React renderMap:

```text
A2UI TextField -> company TextField
A2UI CheckBox  -> company Checkbox
A2UI Button    -> company Button
```

This lets an agent generate task UI while the platform keeps brand, accessibility, component behavior, and security under control.

## 4. External Deliverables

The project should be presented as four layers, not as a demo page.

### 4.1 Core Runtime

Package:

```text
@nexus-ui/core
```

Responsibilities:

- JSONL buffering and parsing.
- Protocol validation.
- Surface lifecycle.
- Component storage.
- DataModel storage and JSON Pointer binding.
- VNode tree construction.
- Action context resolution.
- Framework-agnostic input write-back seam.

Hard boundary:

```text
core must not know React, DOM, Node, SSE, or business agents
```

### 4.2 React Rendering Layer

Package:

```text
@nexus-ui/react
```

Responsibilities:

- Consume core VNodes.
- Map protocol components through renderMap.
- Render standard controls.
- Support catalog-specific render maps.
- Report user input and action triggers through core seams.

React is the first host, not the architecture boundary.

### 4.3 Agent Adapter and Guard Reference

Current implementation:

```text
server/nexus-playground-server
```

Responsibilities:

- Built-in LLM / fallback selection or host-injected generation source.
- Prompt boundary.
- A2UI stream guard.
- Catalog Registry.
- Action handler dispatch.
- SSE transport.
- Surface history.

This is the reference integration for an external business agent. It is not intended to become a vertical business agent itself.

### 4.4 Playground / Workbench Demo

Current implementation:

```text
web/nexus-playground
```

The playground is not the final product. It is the proof surface for:

- Natural-language generation.
- Real LLM output.
- Streaming protocol execution.
- Safe rendering.
- TextField, CheckBox, ChoicePicker, and DateTimeInput state binding.
- Search and submit action loops.
- Custom catalog rendering.
- Workbench customer-summary rendering, task priority selection, reminder-time selection, and CRM-style task creation loop.

Its narrative should eventually move from "type a prompt and draw UI" to "a host application embeds an Agent Task Surface".

## 5. Primary Abstraction

The reusable abstraction is:

> Agent Task Surface

A task surface is generated for a current job, not for a permanent page. It usually has:

1. Context summary: card, text, list, image, status.
2. User state: text input, boolean choice, selection, date, number.
3. Business actions: submit, approve, search, refresh, start, complete.
4. Stable component IDs for in-place updates.
5. A catalog boundary controlled by the host platform.

This abstraction applies across industries.

## 6. Landing Scenarios

The capability is horizontal, but the first entry scenario must be narrow and explainable.

### 6.1 First Wedge: Enterprise Agent Workbench

Example:

```text
Employee: "Create a follow-up task for this customer."
```

Agent emits:

- Customer summary card.
- Task title TextField.
- Priority / channel selector.
- Reminder DateTimeInput.
- Submit Button.

Action returns to CRM / OA / internal task systems. The surface updates to "task created".

Why this first:

- Business loop is obvious.
- Security requirements are real.
- Enterprises need agents but cannot trust generated HTML.
- P2 / P3 / P4 have implemented the minimal path: `CustomerSummary -> TextField -> ChoicePicker(/priority) -> DateTimeInput(/reminderAt) -> submit -> task created`, with the simulated CRM boundary isolated in the server action handler.

### 6.2 Customer Service and Tickets

Agent-generated surfaces:

- Order card.
- Refund form.
- Exchange option picker.
- Address update form.
- Progress query action.

Actions return to order, logistics, or ticket systems.

Value:

- Ticket workflows change often.
- Different issues need different forms.
- Premaking every page is slow.

### 6.3 SRE and Operations

Agent-generated surfaces:

- Incident summary.
- Affected service list.
- Recent changes.
- Rollback action.
- Scale action.
- Create incident ticket action.

Actions return to the operations platform.

Value:

- High variability by incident type.
- Dangerous operations need explicit protocol boundaries.
- Runtime UI should trigger controlled workflows, not execute arbitrary commands.

### 6.4 BI and Data Copilot

Agent-generated surfaces:

- Query filters.
- Metric cards.
- Result list.
- Chart placeholder for future chart component.
- Report subscribe toggle.

Actions return to query or reporting services.

Value:

- Query conditions are dynamic.
- Existing search action already proves input-to-query loop.

### 6.5 Approval and Workflow

Agent-generated surfaces:

- Request summary.
- Approval opinion TextField.
- Urgent CheckBox.
- Approve / reject Button.

Actions return to workflow state machines.

Value:

- Many form variants.
- Strong need for permission and audit boundaries.
- Stable component vocabulary.

### 6.6 Admin and System Configuration

Agent-generated surfaces:

- Feature toggles.
- Threshold input.
- Environment selector.
- Save action.

Actions return to a configuration center.

Value:

- Avoid frontend releases for every new setting group.
- Catalog can restrict allowed controls.

### 6.7 IoT and Device Console

Agent-generated surfaces:

- Device status card.
- Mode selector.
- Brightness or temperature slider.
- Execute action.

Actions return to device-control services.

Value:

- Device models have different panels.
- UI can be generated per device catalog.

### 6.8 Education and Training

Agent-generated surfaces:

- Concept card.
- Choice picker.
- Short answer field.
- Submit answer action.
- Feedback update.

Value:
- Dynamic learning interactions.
- Actions return to grading and progress systems.

### 6.9 Long-Term Platform Scenario

A unified enterprise agent portal:

```text
One agent entry
  -> CRM task surface
  -> approval surface
  -> incident surface
  -> BI query surface
```

Each surface may route actions to a different business system. This is the future platform direction, not the current MVP scope.

## 7. Non-Goals

Nexus UI is not:

- A general UI generator.
- A prompt-to-page drawing board.
- A replacement for all handwritten frontend.
- A complete A2UI v0.9 implementation.
- A low-code form platform.
- A vertical business agent.
- An Agent-to-Agent protocol framework.
- A code execution runtime.

Poor-fit UI:

- Marketing websites.
- Long-lived highly polished pages.
- Complex editors such as design tools or IDEs.
- Game UI.
- Pages dominated by custom interaction algorithms.

Good-fit UI:

- Generated for a task.
- Requires context display.
- Requires user state.
- Requires a business action.
- Must respect a design system.
- Should patch rather than rebuild.

## 8. Current Capability Baseline

As of P5-b:

- Real LLM streaming generation is working.
- Invalid output is rejected by server guard.
- Core progressively builds VNodes from JSONL.
- React renders through standard renderMap.
- Custom catalog render maps are supported.
- TextField supports four variants and `validationRegexp`.
- TextField and CheckBox write user state back to dataModel.
- ChoicePicker writes single or multiple string selections back to dataModel.
- DateTimeInput writes an ISO 8601 date, time, or date-time string back to dataModel.
- Search and submit actions carry current context values.
- The same surface is patched in place.
- Basic Catalog current subset is implemented.
- Task catalog demonstrates custom components and in-process business state.
- Workbench catalog demonstrates a customer follow-up task with customer context, task input, task priority, reminder time, submit handler, disabled submit button, and duplicate-submission rejection.
- A host can inject an in-process generation source whose output still passes the same guard; action handlers receive surface-scoped catalog and successful-generation history.
- A host-owned business Agent can integrate through a minimal HTTP JSONL RPC helper for both generation and actions; timeout, response size, content type, and remote errors are bounded.
- Host integration contract, support matrix, and interview narrative are documented.

Real M10 acceptance:

```text
Input:
A2UI Runtime

CheckBox:
true

Submit result:
已提交：name=A2UI Runtime，subscribed=true

Generation status:
done

Action status:
done
```

Browser error and warning checks passed.

Real P2 acceptance:

```text
Customer:
华云科技

Task title:
发送方案修订版

Reminder:
true

Submit result:
任务已创建：followup-0002 · 发送方案修订版 · 已设置提醒

Generation status:
done

Action status:
done
```

The submit button is disabled after success, duplicate submission is rejected, and browser error and warning checks passed.

## 9. Iteration Principles

Before adding any capability, answer:

1. Which landing scenario needs it?
2. Which protocol contract does it implement?
3. Which boundary does the server guard enforce?
4. Does core remain framework-agnostic?
5. Does React only consume VNode and report interaction?
6. How does the action return to a business handler?
7. What test proves the full loop?
8. What real LLM prompt and page acceptance prove it?

If a component only increases the component count but does not strengthen a landing workflow, defer it.

## 10. Next Work Should Productize The Path

Do not start M11 merely by adding another component.

Recommended order:

### Step P1: Product Narrative and Integration Contract — Completed

Completed on 2026-09-18:

- The mental model is anchored as Agent Task Surface rather than a playground page.
- Host integration points and current package boundaries are documented in [host-integration.md](host-integration.md).
- The reference HTTP/SSE, runtime, catalog, action, and security contracts are documented.
- The allowed A2UI subset is documented as a support matrix.
- A three-minute interview and open-source explanation is documented in [interview-narrative.md](interview-narrative.md).

### Step P2: One Concrete Workbench Demo — Completed

Completed on 2026-09-18 around the existing loop:

```text
customer summary
  -> task TextField
  -> notification CheckBox
  -> submit action
  -> task-created result
```

Implementation and acceptance cover the Workbench catalog, LLM prompt contract, fallback output, server field and loop guards, React customer summary, CRM-style submit handler, same-surface patch, disabled button, and duplicate-submission rejection. The in-process store is a demo boundary, not a claim of production CRM integration.

### Step P3: Expand Components Only By Scenario

Completed on 2026-09-18 through the Workbench priority workflow:

- Core validates ChoicePicker options, selection variants, display styles, and `string[]` path binding.
- React renders single/multiple selection as checkbox or chips, with optional filtering, and reports changes through core.
- Server guard rejects illegal fields, invalid options, actions on ChoicePicker, and Workbench output that omits or misbinds priority.
- Workbench submit context carries `/priority`; the handler accepts exactly one of `high / normal / low`, creates a prioritized task, and patches the same surface.

Later components still enter only through a concrete workflow.

### Step P4: DateTimeInput For Reminder Workflow — Completed

Completed on 2026-09-19 through the Workbench reminder workflow:

```text
appointment / reminder intent
  -> DateTimeInput
  -> submit context
  -> scheduled follow-up result
```

- Core validates date, time, and date-time literals, `enableDate` / `enableTime`, `min` / `max`, and string path binding.
- React renders native date, time, or datetime-local controls and reports ISO 8601 values through the core seam.
- Server guard rejects illegal fields, invalid ISO literals, missing date/time capability, actions, and misbound Workbench reminder input.
- Workbench submit context carries `/reminderAt`; the handler validates and normalizes the value, creates a task with reminder time, and patches the same surface.

P3 real acceptance passed: the generated Workbench surface included a mutually exclusive priority picker, the submit context carried `/priority`, and the same surface patched to `followup-0003` with priority `高`; the button was disabled, action status was `done`, and browser errors/warnings were empty.

P4 real acceptance passed: the LLM resolved “明天 10:00” to `2026-09-20T10:00:00`, generated a native datetime-local control, and bound `/reminderAt`; after submit, the same surface showed the follow-up ID, priority `高`, and reminder time, the button was disabled, action status was `done`, and browser errors/warnings were empty.

### Step P5-a: Replaceable In-Process Agent Source — Completed

Completed on 2026-09-19 as the narrow first slice of host integration:

```text
host generation source
  -> Agent Adapter catalog/action boundary
  -> unified A2UI guard
  -> successful surface history
  -> business action context
```

- A host can replace the built-in LLM / fallback source locally without modifying core, React, or Koa routing.
- The source receives `surfaceId`, request text, catalog definition, component whitelist, and action whitelist.
- Its output is still candidate A2UI JSON only; every message passes the same structure and lifecycle guard.
- Invalid custom output emits SSE `error`, omits `done`, and does not commit surface history.
- Action handlers receive copied surface-scoped catalog and successful-generation history; one-parameter handlers remain compatible.

This proves the runtime can be inserted between an external Agent and a host application without giving the Agent frontend execution capability.

### Step P5-b: External Agent JSONL RPC — Completed

Completed on 2026-09-19 through the smallest useful remote integration:

```text
Agent Adapter
  -> host-owned HTTP RPC endpoint
  -> bounded JSONL response
  -> unified A2UI guard
  -> same-surface patch
```

- Generation and action helpers share one `version: 1` request contract.
- Requests carry the resolved surface, catalog, component whitelist, action whitelist, surface history, and for actions the resolved client action.
- Successful responses are 2xx JSONL, one candidate A2UI message per line.
- The host controls endpoint and headers; timeout and response-byte limits protect Nexus UI.
- HTTP errors use a simple `{ error: { message } }` contract; timeouts and malformed output become local RPC errors.
- RPC output has no bypass path. It still passes the same structure, lifecycle, catalog, and action guards before SSE.

The implementation intentionally omits retries, remote secret management, tenant routing, audit logs, and durable sessions. Those are deployment hardening, not the first integration slice.

### Step P5-c: Host Integration Hardening

Only after the product path is clear:

- Public package APIs.
- Versioning and compatibility policy.
- Permission and tenant boundaries.
- Persistent surface history.
- Multi-surface strategy.
- Deployment-grade external-agent operations.

## 11. Interview Script

Use [interview-narrative.md](interview-narrative.md) as the canonical explanation. Its core version is:

> I am building an A2UI-based Agent UI Runtime. Instead of letting an agent generate HTML or frontend code, the agent emits declarative A2UI JSONL. The server validates catalog, lifecycle, component fields, and actions before the UI reaches the client. A framework-agnostic core parses the stream, maintains components and dataModel, builds VNodes, and resolves action bindings. React renders through a replaceable renderMap, so an enterprise design system can stay in control. User input writes back to the dataModel; Button actions return resolved context to a business handler, and the response patches the same surface instead of rebuilding the page. I have validated the path with real LLM generation, invalid-output guards, TextField validation, CheckBox boolean binding, ChoicePicker selection, submit action flow, and custom catalogs.

This is stronger than saying "I implemented A2UI components". The value is the safe execution path and business loop.

## 12. Direction Checkpoint

When development feels unclear, return to this test:

```text
Is this iteration making an Agent-generated task surface safer, more usable, more integrable, or more production-ready?
```

If the answer is no, the work is likely drifting toward a component gallery or UI drawing board.
