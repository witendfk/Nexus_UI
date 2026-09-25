## @nexus-ui/core

框架无关的 A2UI v0.9 流式协议运行时。它不 import React，不依赖 DOM，也不知道消息来自 SSE、Agent 还是业务后端。core 遵循 A2UI v0.9 消息模型，但当前校验范围是 Nexus Agent Task Profile，不等于官方 Basic Catalog 完整一致性实现。

## 当前能力

- JSONL 跨 chunk 缓冲和切分。
- 当前 Agent 线支持子集的信封与结构校验。
- create / update / delete surface 生命周期校验。
- 多 surface 状态隔离。
- 扁平组件表到 VNode 的渐进树构建。
- JSON Pointer 数据模型更新。
- `{ path }` 动态值和 action context 解析。
- Basic `TextField` / `CheckBox` / `ChoicePicker` / `DateTimeInput` / `Slider` 的双向输入写回 seam。
- Basic `Image` / `Video` / `AudioPlayer` 的媒体 URL 结构校验；`url` 和媒体说明支持字符串或 `{ path }` 绑定。
- Basic `TextField` / `Slider` / `Button` 的最小 A2UI `checks`：支持 `required` / `regex` / `length` / `numeric` / `email`，按当前 dataModel 求值并生成 `VNode.validation`；Button checks 失败会阻断 action。
- 框架无关 `ActionEvent` 出口。
- `CatalogRegistry`：登记 `catalogId`、组件名边界、可选 action 白名单和可选的自定义组件 props schema。
- `createCatalogPromptContract`：从同一份 `CatalogDefinition` 生成外部 Agent 可选使用的确定性 A2UI 输出提示词；guard 仍是最终放行边界。
- 结构化错误：`A2UIError` 可携带 `A2UIDiagnostic[]`，每条诊断包含 `path`、`message` 和可选 `dataPath`。
- 单条坏消息记录错误并丢弃，不中断后续流。

当前校验分两层：`validateProtocolMessage` 判断官方 A2UI v0.9 结构；`validateNexusProfileMessage` 判断 Profile 是否支持。`validateA2UIMessage` 保留兼容并串联两者。Catalog 能力、宿主策略和组件 schema 在后续边界继续收口。自定义组件 schema 支持 JSON 基础类型、required / enum / min / max / length / pattern、嵌套 object / array 与 `{ path }` 绑定策略，并会聚合返回全部确定性诊断。绑定路径在 dataModel 已有值时继续校验 resolved value，路径尚未出现时保持流式 pending。通用 FunctionCall、`checks` 组合条件、跨字段校验、Workbench checks 和端到端 `sendDataModel` 均被 Profile 拒绝；Profile 中 `TextField` / `Slider` / `Button` 的 5 个基础校验函数属于当前最小支持范围。

## 源码结构

```text
src/
  index.ts        对外唯一出口
  protocol/       A2UI 类型、结构校验
  buffer/         JSONL 跨 chunk 缓冲
  dataModel/      JSON Pointer 与动态绑定
  catalog/        Catalog Registry
  state/          surface / components / dataModel 状态
  render/         扁平组件表到 VNode
  checks/         CheckRule 最小求值
  action/         action context 解析与事件出口
  runtime/        A2UIRuntime 编排
```

Catalog Registry 不感知 React 或其他渲染器。未提供 schema 的组件仍只有组件名白名单；提供 schema 的组件会在注册时校验 schema 本身，并可在 runtime / server guard 中校验候选组件 props。`actions` 是可选宿主边界，不是 A2UI wire 字段；显式声明后 runtime 会在组件进入状态前校验 action 名称，空数组表示纯展示 catalog，未声明时 core 不强制内置 Basic fallback。

## 公开 API

`src/index.ts` 是唯一公开入口，当前 `CORE_API_VERSION = 1`。协议类型与校验、`A2UIRuntime`、`JSONLBuffer`、`CatalogRegistry`、`createCatalogPromptContract`、状态 / 渲染 / action seam 和 dataModel helper 均从根入口导出。`protocol/`、`state/`、`runtime/` 等内部路径不承诺兼容；新增或移除根导出必须同步更新 API 契约与测试。

## API 示例

```ts
import { A2UIRuntime, validateA2UIMessage } from '@nexus-ui/core';

const runtime = new A2UIRuntime({
  catalogRegistry,
  onRender: (root, surfaceId) => {
    // 宿主渲染器消费框架无关 VNode
  },
  onAction: (event) => {
    // Agent、业务后端或其他适配层处理事件
  },
  onError: (error) => {
    // 上报解析、结构或生命周期错误
  },
});

runtime.push('{"version":"v0.9",...}\\n');
runtime.end();
```

Catalog props 契约失败时，`onError` 收到的不是只有拼接文案：

```ts
onError: (error) => {
  error.diagnostics?.forEach((diagnostic) => {
    // diagnostic.path / diagnostic.message / diagnostic.dataPath?
  });
};
```

宿主渲染层在用户输入或点击时只调用框架无关 seam：

```ts
runtime.setInputValue(componentId, surfaceId, value);
runtime.triggerAction(componentId, surfaceId);
```

```ts
import { CatalogRegistry, createCatalogPromptContract } from '@nexus-ui/core';

const hostCatalog = {
  catalogId: 'https://example.com/catalogs/task/v1',
  components: ['TaskSummary'],
  componentSchemas: {
    TaskSummary: {
      type: 'object',
      additionalProperties: false,
      required: ['title'],
      properties: {
        title: { type: 'string', dynamic: 'required' },
      },
    },
  },
} as const;

const registry = new CatalogRegistry([hostCatalog]);
const agentPromptContract = createCatalogPromptContract(hostCatalog);
```

## 命令

```bash
pnpm --filter @nexus-ui/core typecheck
pnpm --filter @nexus-ui/core test
pnpm --filter @nexus-ui/core test:coverage
pnpm --filter @nexus-ui/core build
```
