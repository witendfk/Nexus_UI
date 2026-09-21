# Nexus UI Interview Narrative

状态：个人工程项目叙事锚点。  
目的：用一致、克制、可验证的方式解释 Nexus UI 的价值，避免把它讲成 UI 画板或完整商业化产品。

## 1. Thirty-Second Version

> Nexus UI is an A2UI-based Agent UI runtime. An agent emits declarative JSONL messages instead of HTML or React code. The runtime validates the protocol, enforces a component and action boundary, renders progressively through React, binds user input to a data model, and returns actions to business handlers. The same surface is patched in place, so an agent can generate task UI while the host keeps security and design control.

中文版本：

> 我做的是一个 Agent UI Runtime：Agent 只输出 A2UI 声明式消息，Nexus UI 负责协议校验、组件白名单、流式渲染、dataModel 绑定和 action 回流。React 层可以通过 renderMap 接入企业组件库，所以 Agent 能动态生成任务界面，但安全边界、视觉体系和业务入口仍由宿主控制。

## 2. Three-Minute Story

### 问题

Agent 进入真实应用时，只输出文本无法承载结构化任务。一个任务通常需要：

- 上下文摘要。
- 表单输入。
- 布尔选择，后续扩展枚举、日期和数值控制。
- 明确的业务操作，例如提交、审批、搜索、开始或完成。
- 同一界面上的结果更新。

让模型返回 HTML 会引入 XSS 和浏览器能力泄露；返回 React 代码需要代码执行边界；返回任意 JSON 又会让每个宿主重复发明校验、状态、渲染和 action 契约。

### 方案

Nexus UI 提供一条受信执行路径：

```text
Agent
  -> A2UI v0.9 JSONL
  -> server catalog / lifecycle / structure / action guards
  -> SSE reference transport
  -> framework-agnostic core
  -> VNode tree
  -> React renderMap
  -> dataModel write-back
  -> registered business handler
  -> same-surface patch
```

核心产品对象不是长期页面，而是 **Agent Task Surface**：由 Agent 为当前任务生成、安全嵌入宿主应用、并把用户操作回流到业务系统的临时界面。

### 当前证明

MVP 已经证明最小有用闭环：

- 真实 LLM 流式生成。
- 非法模型输出被 server guard 拦截。
- VNode 渐进构建。
- React 标准组件和自定义 catalog renderMap 渲染。
- TextField 写回 dataModel。
- CheckBox 布尔值写回 dataModel。
- ChoicePicker 单选 / 多选值写回 dataModel。
- DateTimeInput 把日期 / 时间写回 dataModel。
- action context 动态解析。
- 搜索和提交业务 handler。
- 企业客户跟进任务的上下文摘要、输入、优先级、提醒时间、提交和任务创建结果。
- 稳定 ID 的同 surface 原地更新。
- core / React / web / server 测试。

## 3. 为什么不是 UI 画板

| Prompt-to-UI canvas | Nexus UI |
| --- | --- |
| 输入是页面生成 prompt。 | 输入是任务请求和 A2UI 消息流。 |
| 输出是静态或生成页面。 | 输出是活的、有状态的任务 surface。 |
| 渲染完成基本结束。 | 用户输入会写回 `dataModel`。 |
| 交互偏视觉演示。 | action 会分发到业务 handler。 |
| 组件数量是卖点。 | 协议、guard、状态、action、patch 保证是卖点。 |
| 默认信任生成 UI。 | 把生成 UI 当作不可信输入。 |

这也是回答“这个项目有什么用”的核心。

## 4. 值得讲的工程决策

### core 框架无关

core 负责协议缓冲、状态、树构建、数据绑定和 action context，不 import React、DOM、Node 或 SSE。协议运行时可以被其他渲染层复用，渲染器职责也被明确限制。

证据：

- `packages/nexus-core/src/runtime`
- `packages/nexus-core/src/protocol`
- `packages/nexus-core/src/dataModel`

### React 是渲染适配层

React 只通过 `renderMap` 消费 VNode，不拥有协议、dataModel 或 action 语义。企业可以把自己的设计系统组件映射到 A2UI 协议名，Agent 契约不用改变。

证据：

- `packages/nexus-react/src/provider`
- `packages/nexus-react/src/renderer`
- `packages/nexus-react/src/components`

### server guard 是信任边界

模型可能输出语法正确但越界的 JSON。server 在进入 SSE 前检查信封、surface 生命周期、组件 catalog、action 名称、action 挂载位置和部分组件字段。

证据：

- `server/nexus-playground-server/src/agent/agent-guard.ts`
- `server/nexus-playground-server/src/api/send-messages.ts`

### action 闭环，而不是单向生成

输入组件即时写 dataModel；Button 点击时 core 把绑定 path 解析成 `ActionEvent`；server 按 `catalogId + action.name` 找业务 handler；handler 响应只 patch 现有 surface。

证据：

- `packages/nexus-core/src/action`
- `server/nexus-playground-server/src/agent/adapter.ts`
- `server/nexus-playground-server/src/agent/external-agent.ts`
- `docs/agent-line-scope.md` 中 M9、M10、P2-P4 与 P5-a/P5-b 验收记录

## 5. 落地叙事

首选窄场景是企业 Agent Workbench：

```text
员工：
帮我给这个客户创建跟进任务。

Agent task surface：
客户摘要
任务标题 TextField
优先级 ChoicePicker
提醒时间 DateTimeInput
提交 Button

action：
调用 CRM / OA 创建任务

patch：
同一个 surface 更新为“任务已创建”
```

P2/P3/P4 已把这条叙事落成可运行验收：真实 LLM 生成 Workbench UI，用户输入任务、选择优先级并确认提醒时间后，submit handler 创建模拟 CRM 任务，页面原地显示任务号、优先级和提醒时间并禁用按钮，重复提交被拒绝。

P5-a/P5-b 把这条线从“内置 Demo”推进到“宿主可接入”：进程内 source 可替换，业务 Agent 也可通过有超时、大小和错误边界的 HTTP JSONL RPC 接入生成与 action。远端 Agent 无论是什么实现，返回的仍只能是候选 A2UI 消息，必须经过同一 guard 才能到达浏览器。

同一模型可以迁移到客服工单、SRE 故障处理、BI 查询条件、审批表单、后台配置和设备控制台。组件扩展必须跟随这些工作流，而不是以组件数量为目标。

## 6. 常见追问

### “这和 JSON renderer 有什么区别？”

JSON renderer 只解决组件名到 React 组件的映射。Nexus UI 还包括协议解析、校验、surface 生命周期、流式状态、JSON Pointer 绑定、action context 解析、catalog 边界、handler 分发和稳定 ID patch。渲染层只是其中一层。

### “为什么用 A2UI？”

A2UI 提供了声明式、流式、catalog-aware 的消息模型，正好匹配这个问题。项目不追求完整实现 v0.9；A2UI 是协议基础，长期工程价值是安全 Agent UI Runtime 边界。

### “为什么不让模型直接返回 React？”

生成源码需要代码执行环境并扩大浏览器信任边界。Nexus UI 让模型停留在结构与数据层，可执行行为只来自宿主批准的 renderMap 和注册过的业务 handler。

### “这是低代码平台吗？”

不是。低代码通常面向人配置的长期页面；Nexus UI 面向 Agent 交互过程中生成的任务级 surface，并连接真实业务 action。

### “距离生产还缺什么？”

要主动说清楚：

- `Slider` 等剩余表单控件和跨字段校验。
- 完整 catalog JSON Schema 校验。
- 认证、授权、租户隔离和审计。
- surface / task 状态持久化。
- 远程媒体资源 allowlist。
- 多 surface 和多实例部署。

主动讲这些边界会体现工程判断，而不是暴露弱点。

## 7. 个人项目成功标准

这不是商业化产品 pitch。作为个人工程项目，它成功的标准是：

1. 能清楚陈述一个真实接入问题。
2. 有协议驱动的 runtime 设计。
3. core、renderer、transport、业务 handler 职责分离。
4. 安全和失败处理不是后补。
5. 有真实 LLM 验收，而不只有单测。
6. 测试和文档与实现边界一致。
7. 前端、平台或 Agent 应用方向的面试官都能在几分钟内理解价值。

## 8. 项目讲解顺序

1. `README.md`：产品主张和架构。
2. `docs/product-position.md`：定位和 non-goals。
3. `packages/nexus-core`：协议运行时。
4. `packages/nexus-react`：renderMap 宿主层。
5. `server/nexus-playground-server`：guard 和 adapter 参考实现。
6. `web/nexus-playground`：真实 LLM 和 action 闭环证明面。
7. `docs/agent-line-scope.md`：MVP 边界和验收历史。
