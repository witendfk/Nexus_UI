# @nexus-ui/react

A2UI 的 React 渲染层。它消费 `@nexus-ui/core` 输出的 VNode，通过 `renderMap` 映射为 React 元素；mount、update 和 unmount 全部交给 React。

## 当前组件

`standardRenderMap` 实现当前 Agent 线的 15 个组件：

```text
Text, TextField, CheckBox, ChoicePicker, DateTimeInput, Slider, Button, Column, Row, List, Tabs, Image, Card, Icon, Divider
```

`List` 当前只支持静态 `children` id 数组、`direction` 和 `align`；协议的 ChildList template 属于后续版本。

`Tabs` 当前只支持静态 `tabs` 定义、动态 `title` 和静态 `child` 引用；激活状态由 React 渲染层本地维护。

`Image` 使用协议字段 `url` 渲染图片，`description` 映射为 HTML `alt`，远程图片以 `no-referrer` 加载以兼容防盗链 CDN；不兼容 HTML 风格 `src` / `alt`。

A2UI v0.9 Basic Catalog 共有 18 个组件；当前只开放上述 15 个。`TextField` 支持 `shortText / longText / number / obscured`、`validationRegexp` 和 `{ path }` 双向绑定；`CheckBox` 支持布尔 `{ path }` 双向绑定；`ChoicePicker` 支持单选 / 多选、`checkbox / chips`、筛选和 `string[]` `{ path }` 双向绑定；`DateTimeInput` 支持 date / time / date-time、`min` / `max` 和 ISO 8601 字符串 `{ path }` 双向绑定；`Slider` 使用原生 range 输入、支持有限数字范围和小数步进，并把数字 `value: { path }` 写回 dataModel。`checks` 和 FunctionCall 属于后续版本。

## 源码结构

```text
src/
  index.tsx       对外唯一出口
  provider/       A2UIProvider、useA2UI
  renderer/       ReactRenderer
  components/     标准 15 组件与 standardRenderMap
  types/          RenderMap 等渲染契约
  version/        包版本与协议版本
  style/          浏览器端挂载动画样式
  examples/       可测试的最小宿主接入示例
```

## 公开 API

`src/index.tsx` 是唯一公开入口，当前 `REACT_API_VERSION = 1`。Provider / hook、Renderer、RenderMap 类型、`standardRenderMap` 和 15 个标准组件均从根入口导出。当前渲染层支持 core `0.1.x`、core API `1` 和 A2UI `v0.9`；宿主可用 `getReactCoreCompatibility()` 做装配期诊断。内部组件、renderer 和 style 路径不承诺兼容。

## 使用

```tsx
import { A2UIProvider } from '@nexus-ui/react';

function App() {
  return (
    <A2UIProvider
      onAction={(event) => {
        // 这里只暴露范式无关事件，不内置 HTTP 或 Agent 逻辑
      }}
      onError={(error) => {
        // core A2UIError；error.diagnostics 保留结构化 Catalog 诊断
      }}
    >
      <Controls />
    </A2UIProvider>
  );
}
```

`A2UIProviderProps.renderMap` 可以替换当前组件实现。企业设计系统可以通过它覆盖协议组件的实现，但组件行为和 props 语义仍以 catalog 契约为准。

`catalogRenderMaps` 可以按 surface 的 `catalogId` 选择组件实现；未匹配的 catalog 会回退到 `renderMap`。服务端必须注册同名 catalog 并约束 Agent 输出，不能只靠前端 renderMap 扩展。

`catalogRegistry` 是可选的宿主边界。传入后，core runtime 会拒绝未注册 catalog、未注册组件和违反 `componentSchemas` 的候选组件；前端渲染器仍只负责把已放行的 VNode 映射为 React 元素。

最小宿主示例见 [`examples/minimal-host.tsx`](examples/minimal-host.tsx)。它演示本地 JSONL 输入、catalog registry、自定义 props schema、自定义 renderMap 和 action 出口；真实宿主只需把示例中的本地 JSONL 替换为 SSE / WebSocket 读取逻辑。

```tsx
<A2UIProvider
  catalogRegistry={registry}
  catalogRenderMaps={{
    'https://example.com/catalogs/task/v1': {
      TaskSummary: (vnode) => <section>{vnode.props.title}</section>,
    },
  }}
/>
```

## 行为

- VNode 子组件未到达时渲染占位。
- 未知组件渲染错误占位，不抛出异常。
- Button 点击后调用 runtime 的 `triggerAction`。
- React 层不解析 JSONL / SSE，也不包装 client-to-server 信封。

## 命令

```bash
pnpm --filter @nexus-ui/react typecheck
pnpm --filter @nexus-ui/react test
pnpm --filter @nexus-ui/react build
```
