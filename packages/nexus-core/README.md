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
- Catalog `inputs` 声明驱动的输入写回 seam，支持标准控件与自定义绑定属性；最新输入通过 `getLatestInputs` 提取。
- Basic `Image` / `Video` / `AudioPlayer` 的媒体 URL 结构校验；`url` 和媒体说明支持字符串或 `{ path }` 绑定。
- Basic `TextField` / `Slider` / `Button` 的最小 A2UI `checks`：支持 `required` / `regex` / `length` / `numeric` / `email`，按当前 dataModel 求值并生成 `VNode.validation`；Button checks 失败会阻断 action。
- 框架无关 `ActionEvent` 出口。
- `CatalogRegistry`：登记 Catalog v2 的组件 schema、可写输入、checks 与 action 声明。
- `createCatalogPromptContract`：从同一份 `CatalogDefinition` 生成外部 Agent 可选使用的确定性 A2UI 输出提示词；guard 仍是最终放行边界。
- 结构化错误：`A2UIError` 可携带 `A2UIDiagnostic[]`，每条诊断包含 `path`、`message` 和可选 `dataPath`。
- 单条坏消息记录错误并丢弃，不中断后续流。

当前校验分两层：`validateProtocolMessage` 判断官方 A2UI v0.9 结构；`validateNexusProfileMessage` 判断 Profile 是否支持。`validateA2UIMessage` 保留兼容并串联两者。Catalog 能力、宿主策略和组件 schema 在后续边界继续收口。自定义组件 schema 支持 JSON 基础类型、required / enum / min / max / length / pattern、嵌套 object / array 与 `{ path }` 绑定策略，并会聚合返回全部确定性诊断。绑定路径在 dataModel 已有值时继续校验 resolved value，路径尚未出现时保持流式 pending。通用 FunctionCall、`checks` 组合条件、跨字段校验、Workbench checks 和端到端 `sendDataModel` 均被 Profile 拒绝；Profile 中 `TextField` / `Slider` / `Button` 的 5 个基础校验函数属于当前最小支持范围。

输入寻址与服务端复用 `normalizeJsonPointer` / `getStrictPath` / `setStrictPath`：禁止空串与 `/` 根目标，数组按实际容器拒绝非规范下标，对象字面键不误判成数组。既有协议 `updateDataModel` 根替换语义不变。`parseSurfaceCommit` 校验成功运行的固定提交元数据；`CATALOG_CONTRACT_VERSION` 为 core/server 共享的 Catalog 版本常量。

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

Catalog Registry 不感知 React 或其他渲染器。Catalog v2 的每个组件必须提供 `schema`，`actions` 必填（纯展示 Catalog 显式传 `[]`）；注册闸门校验声明，runtime / server guard 使用同一套组件规则。可写输入必须在组件 `inputs` 中声明，标准组件名不隐含写回能力。

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
runtime.setInputValue(componentId, surfaceId, 'value', value);
// 自定义控件也使用同一接口，例如 inputs.score → 组件 score: { path: '/rating' }
runtime.setInputValue(ratingComponentId, surfaceId, 'score', 7);
runtime.triggerAction(componentId, surfaceId);

// 每次提取返回独立快照，只包含组件 ID、绑定属性与最新合法值；不提交目标路径。
const inputs = runtime.getLatestInputs(surfaceId);
```

输入写回必须装配 `catalogRegistry`，并在当前组件 `inputs` 中声明对应属性及值 schema；属性的目标路径来自组件 `{ path }` 绑定。未装配或声明不符时返回 `false`。成功写回才更新草稿；同组件、同属性只保留最新值。组件类型、绑定路径或 Catalog 声明变化时清除旧草稿，恢复原组件或路径也不会恢复旧值；类型和绑定未变的组件属性更新保留草稿。`deleteSurface` 清理该 surface 的草稿。`getLatestInputs` 的条目和嵌套值均与内部模型、草稿隔离，服务端仍须权威准入（S2.4/S2.5）。

```ts
import {
  CatalogRegistry,
  createCatalogPromptContract,
  standardCatalogComponentDeclarations,
} from '@nexus-ui/core';

const hostCatalog = {
  catalogId: 'https://example.com/catalogs/task/v1',
  components: {
    ...standardCatalogComponentDeclarations(),
    TaskSummary: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['title'],
        properties: { title: { type: 'string', dynamic: 'required' } },
      },
    },
    RatingInput: {
      schema: {
        type: 'object',
        properties: { score: { type: 'integer', dynamic: 'required' } },
      },
      inputs: { score: { type: 'integer', minimum: 0, maximum: 10 } },
    },
  },
  actions: [],
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
