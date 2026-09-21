# Milestone Log: Core Runtime and React Renderer

状态：已完成并冻结。本文档记录 M0-M2 的交付与验收，新的能力规划见 [agent-line-scope.md](agent-line-scope.md)。

## 交付内容

### M0: Workspace and Contracts

- 建立 pnpm workspace：`packages/*`、`web/*`、`server/*`。
- 定义 A2UI v0.9 协议类型和常量。
- 保持 `specification/v0_9` 为协议事实源，不修改 vendored 规范。
- 建立包级 typecheck / test / build 命令。

验收：

- 各 workspace 包可独立执行类型检查。
- core 不依赖 React、DOM 或 Node 专用 API。

### M1: Framework-agnostic Core

交付模块：

| 模块 | 职责 |
|---|---|
| `JSONLBuffer` | 跨 chunk 拼接并切分 JSONL |
| `validator` | 校验当前 Agent 线支持的消息结构和信封 |
| `store` | 管理 surface、组件表、数据模型和错误 |
| `tree-builder` | 扁平组件表转框架无关 VNode |
| `dataModel` | JSON Pointer、动态值解析和 action context 解析 |
| `event` | 从组件定义生成 `ActionEvent` |
| `A2UIRuntime` | 编排输入、状态、渲染输出和 action 出口 |

核心边界：

```text
IN   push(chunk) / dispatch(message)
OUT  onRender(VNode)
OUT  onAction(ActionEvent)
```

core 不知道事件最终会交给 Agent、既有后端还是其他适配层。

验收：

- JSONL 跨 chunk 可解析。
- 单条坏消息记录错误并丢弃，不中断后续流。
- create/update/delete 生命周期校验通过。
- root 到达前可先进入组件表，到达后构建可见树。
- `{ path }` 绑定可解析。
- Button action 输出包含解析后的 context。

### M2: React Renderer

交付：

- `ReactRenderer`：递归渲染 VNode，占位和未知组件降级显示。
- `standardRenderMap`：M2 交付 8 个组件；M8-a 起包含静态 `List`，M8-b 起包含静态 `Tabs`。
- `A2UIProvider`：持有 runtime 并渲染输出树。
- `useA2UI`：向宿主暴露 runtime。

边界：

- mount / update / unmount 全部交给 React。
- 不自研 reconciler。
- React 层不解析 SSE，也不包装 client-to-server 信封。

验收：

- 多条 `updateComponents` 渐进到达时可以逐步填充 UI。
- Button 点击后通过 runtime 输出 `ActionEvent`。
- 未知组件显示错误占位，不影响其他组件。

## 后续进入条件

M2 完成后，才允许接传输层和真实 Agent。传输实现不得反向污染 core。
