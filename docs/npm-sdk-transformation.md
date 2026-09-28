# Nexus UI npm SDK Transformation

状态：改造方向与验证锚点。  
日期：2026-09-28。  
用途：把 Nexus UI 从 monorepo 内可运行的 reference implementation，推进为宿主应用可以安装和接入的 npm SDK。

## 1. Target Positioning

Nexus UI 不应该定位成通用 prompt-to-UI 平台，也不应该对标 AGenUI 的三端原生渲染引擎。

目标定位是：

> 一套 Web 宿主可安装的 Agent Task Surface Runtime。  
> Agent 输出 A2UI 声明式消息；SDK 负责流式解析、catalog 校验、React / Vue 渲染、dataModel 绑定、action 回流和同 surface 原地更新。

核心闭环：

```text
Agent / LLM
  -> A2UI v0.9 JSONL
  -> server guard
  -> transport
  -> @nexus-ui/core
  -> @nexus-ui/react / @nexus-ui/vue
  -> host design system
  -> user input writes dataModel
  -> action returns to host handler
  -> same surface patch
```

当前阶段不追求生产级多租户平台。认证、通用权限、租户隔离和横向扩容仍属于宿主部署边界。OrderOps 的模拟业务 action 仍需领域级输入校验、幂等和可追溯记录；这不等于建设通用审计平台。

## 2. Current Assets

项目已经具备的核心资产不是组件数量，而是协议执行链路。

### Core Runtime

`packages/nexus-core` 已经包含：

- JSONL 跨 chunk 缓冲。
- A2UI 消息解析与结构校验。
- surface lifecycle。
- component tree 和 VNode 构建。
- `dataModel` 与 `{ path }` 绑定。
- action context 解析。
- `CatalogRegistry` 与组件 props schema 校验。
- 结构化 diagnostics。
- 框架无关的 `onRender` / `onAction` / `onError` seams。

### React Renderer

`packages/nexus-react` 已经包含：

- `A2UIProvider` 和 `useA2UI`。
- standard render map。
- catalog-specific render maps。
- 标准输入控件和布局组件。
- React DOM 测试。
- core compatibility diagnostics。

### Server Reference

`server/nexus-playground-server` 已经包含：

- Agent Adapter。
- LLM / fallback / host source 选择。
- surface history store。
- JSONL RPC external Agent helper。
- SSE transport。
- catalog、lifecycle、action 和 stream guard。

### Host Examples

现有 minimal host 和 standalone host 示例已经证明：

- 自定义 catalog 可以接入。
- 外部 Agent RPC 可以接入。
- action 白名单可以约束。
- 业务 handler 响应可以 patch 同一 surface。
- 非法 Agent 输出不能绕过 guard。

## 3. Current Gap to npm Distribution

当前项目在 monorepo 内可运行，但还不是真正的可安装 SDK。

| 问题 | 当前状态 | 目标 |
| --- | --- | --- |
| 包发布 | core / react 均为 `private: true` | 发布 public alpha 包 |
| 包入口 | 指向 `src/index.ts` 或 `src/index.tsx` | 指向构建后的 `dist` |
| 产物字段 | 缺少完整 `files` / `exports` / `publishConfig` | 满足 npm 包消费语义 |
| 传输层 | SSE client 位于 web playground | 抽成 `@nexus-ui/client` |
| 高层组件 | 宿主需要自己 push 流 | 提供 `NexusSurface` |
| server guard | 位于 reference server | 抽出可复用的 `@nexus-ui/guard` |
| 安装验证 | 没有干净宿主 tarball 测试 | 新建 Vite 宿主验证安装产物 |
| Vue 支持 | 尚未开始 | React 发布闭环后按同一 renderer contract 实现 |
| 发布流程 | 无版本发布纪律 | 使用 changesets 和 alpha tag |

## 4. Target Package Graph

第一阶段计划发布的浏览器侧组合：

```text
@nexus-ui/core
@nexus-ui/react
@nexus-ui/client
```

在正式发布前，先将 `core`、`react` 和现有有限 `server` 根入口打成仅供独立宿主验收的本地 tarball。`server` 暂时提供受控 Adapter/guard/HTTP 装配面；待两条 OrderOps 业务流程验证边界后，再决定抽出独立 `@nexus-ui/guard` 和 `@nexus-ui/client` 的稳定 API。这个本地安装关口不等于 npm 发布承诺。

后续扩展：

```text
@nexus-ui/vue
@nexus-ui/guard
@nexus-ui/server
```

### `@nexus-ui/core`

必须发布。职责：

- A2UI protocol types。
- JSONL buffer。
- runtime state。
- VNode tree。
- dataModel binding。
- action context resolution。
- `CatalogRegistry`。
- structured diagnostics。

边界：

- 不依赖 React。
- 不依赖 Vue。
- 不依赖 DOM API。
- 不依赖 Node API。
- 不感知 SSE / HTTP。

### `@nexus-ui/react`

必须发布。职责：

- `A2UIProvider`。
- `useA2UI`。
- React renderer。
- standard render map。
- catalog render maps。
- 标准组件。
- core compatibility diagnostics。

依赖策略：

```json
{
  "dependencies": {
    "@nexus-ui/core": "workspace:*"
  },
  "peerDependencies": {
    "react": ">=18"
  }
}
```

`react-dom` 应由宿主提供，除非 React 包内部直接调用 `react-dom` API。

### `@nexus-ui/client`

建议第一阶段发布。职责：

- HTTP + SSE client。
- generate 请求。
- client-to-server action 请求。
- timeout / max bytes / content-type 错误边界。
- transport 事件转成 runtime 可消费的消息。

边界：

- 不包含 UI。
- 不包含协议 runtime。
- 不假设具体业务 Agent。

外部 Agent JSONL RPC 属于服务端 Agent/Host 接入边界，不放进浏览器侧 client 包。

### `@nexus-ui/vue`

React 发布闭环后实施。目标不是重写协议逻辑，而是新增一个 renderer adapter：

- Vue provider。
- Vue standard render map。
- catalog render maps。
- input write-back。
- action trigger。
- diagnostics 上浮。

验收要求是与 React 共享同一批 A2UI conformance fixtures。

### `@nexus-ui/guard`

后续从 reference server 抽出。职责：

- A2UI sequence guard。
- surface lifecycle guard。
- catalog guard。
- action whitelist guard。
- props schema diagnostics。

目标消费者是宿主后端，而不是浏览器。前端 runtime 校验是最后防线，不能替代服务端 guard。

## 5. Host-Facing API

SDK 需要暴露两层 API。

### Low-Level API

面向平台型使用者：

```tsx
import { A2UIProvider, useA2UI } from '@nexus-ui/react';

function AgentHost() {
  return (
    <A2UIProvider
      catalogRegistry={registry}
      catalogRenderMaps={maps}
      onAction={(event) => {
        // host owns transport and business dispatch
      }}
      onError={(error) => {
        // host owns diagnostics UI
      }}
    >
      <HostTransport />
    </A2UIProvider>
  );
}
```

宿主负责读取 SSE / WebSocket / RPC stream，并调用：

```ts
runtime.push(chunk);
runtime.end();
```

这个 API 继续保留，因为它是 SDK 的可组合基础。

### High-Level API

面向普通宿主应用：

```tsx
import { NexusSurface } from '@nexus-ui/react';
import { createHttpClient } from '@nexus-ui/client';

const client = createHttpClient({
  baseUrl: '/api/a2ui',
  headers: () => ({
    Authorization: `Bearer ${getToken()}`,
  }),
});

export function ApprovalSurface() {
  return (
    <NexusSurface
      client={client}
      generate={{ message: '创建一个差旅审批任务' }}
      catalogRegistry={registry}
      catalogRenderMaps={maps}
      onAction={(event) => {
        // optional host-side observer
      }}
      onError={(error) => {
        // optional host-side diagnostics
      }}
    />
  );
}
```

`NexusSurface` 不是新 runtime，而是组合层：

```text
NexusSurface
  = A2UIProvider
  + transport subscription
  + action client
  + loading / error surface
```

## 6. Refactor Milestones

### M0: Minimal Package Contract

目标：确定首条业务流程需要的最小公开入口；两条不同业务流程通过前不冻结高层 API。

工作项：

1. 冻结 core 根入口导出面。
2. 冻结 React 根入口导出面。
3. 明确 internal path 不可依赖。
4. 补充 public API snapshot tests。
5. 为独立宿主明确服务端受控入口；首轮可复用有限 `@nexus-ui/server` 根入口。
6. 正式发布前决定 npm scope。若 `@nexus-ui` 不可用，切换到备选 scope。

验收：

- core 和 React 的 public API 有测试锁定。
- 文档明确最小支持范围、禁止依赖的内部路径，以及仍可调整的高层 API。

### M1: Build and Local Package

目标：让 core、React 和有限 server 入口产生可被独立宿主安装的本地 tarball。

工作项：

1. core、React 和 server 的 `main` / `types` / `exports` 指向 `dist`。
2. 补 `files` 等产物字段，确保宿主无需解析 TypeScript 源码。
3. 使用 `npm pack` 检查三个 tarball 的实际内容与依赖。
4. 正式 alpha 发布前再处理 `private: false`、npm scope、`publishConfig` 和 `prepublishOnly`；本地安装验证不依赖先公开发布。

验收：

```bash
pnpm --filter @nexus-ui/core build
pnpm --filter @nexus-ui/react build
pnpm --filter @nexus-ui/server build
npm pack packages/nexus-core
npm pack packages/nexus-react
npm pack server/nexus-playground-server
```

tarball 只包含构建产物、README、LICENSE 和 package metadata，不包含 tests、examples、TypeScript 源码或 workspace 配置。server 先保留有限公开装配入口；参考可执行程序不是宿主依赖的 API。

### M2: Clean Host Install Test

目标：先证明安装产物可以脱离 monorepo 使用，再让同一宿主完成真实 OrderOps 闭环。

工作项：

1. 新建干净 Vite React 宿主项目。
2. 安装 core / React 及受控服务端入口的 tarball。
3. 只使用 public API。
4. 渲染一条静态 A2UI JSONL 流。
5. 验证 TextField 写回 dataModel。
6. 验证 Button action context 携带最新值。
7. 在该宿主接入 OrderOps Agent，完成业务查询、人工确认、Host action 和同 surface patch。

验收：

- 宿主不引用 monorepo source path。
- 浏览器无 runtime error。
- action context 与 UI 输入一致。
- Host 的业务 action 和 Agent 输出均经过服务端受控边界；不从 monorepo 源码路径导入。

### M3: Extract `@nexus-ui/client`

目标：把传输能力 SDK 化。

工作项：

1. 从 web playground 抽出 SSE parser。
2. 增加 HTTP generate client。
3. 增加 action client。
4. 增加 timeout、max bytes、非 2xx、非法 content-type 的错误处理。
5. 保持 transport 与 React 解耦。

验收：

- client 不 import React。
- React 宿主可以通过 client 完成 generate / action 闭环。
- 换成自定义 transport 时不需要修改 core。

### M4: Add `NexusSurface`

目标：提供安装即用的宿主组件。

工作项：

1. 组合 runtime、client、render map 和 error surface。
2. 支持受控重试 / 重新生成。
3. 暴露 loading / error / empty states。
4. 保持低层 `A2UIProvider` 可用。

验收：

```bash
npm install @nexus-ui/react @nexus-ui/client
```

宿主只需提供 `client`、catalog 和 action handler，即可渲染并提交任务 surface。

### M5: Extract Guard SDK

目标：在两条不同业务流程验证后，把已证明的宿主边界抽成独立 guard 包。

工作项：

1. 从 reference server 抽出 sequence guard。
2. 移除对具体 HTTP 框架的强依赖。
3. 公开错误结构和 diagnostics。
4. 支持自定义 `CatalogRegistry`。
5. 保持非法流不产生 `done`、不提交 history。

验收：

- 宿主后端可以独立安装 guard。
- 外部 Agent 输出必须经过 guard 才能进入 transport。
- 未声明 action 在进入 SSE 前被拒绝。
- 现有 `@nexus-ui/server` 有限装配入口保持兼容，独立宿主无需因拆包重写业务接入。

### M6: Conformance Fixtures and Vue

目标：证明 renderer 语义不绑定 React。

工作项：

1. 抽出共享合法 / 非法 A2UI fixtures。
2. 定义 renderer conformance contract。
3. React 和 Vue 运行同一批 fixture。
4. 比较 rendering、binding、action、error 语义。

验收：

```text
same A2UI JSONL
  -> same dataModel transition
  -> same action context
  -> same structured diagnostics
  -> React DOM result and Vue DOM result follow the same contract
```

## 7. Release Criteria

第一个发布版本建议使用：

```text
0.1.0-alpha.1
```

发布前必须通过：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
npm pack
clean-host-install-test
```

alpha 包文档必须明确：

- 支持的 A2UI v0.9 子集。
- 支持的组件。
- 不支持的组件和 protocol feature。
- transport contract。
- catalog contract。
- action contract。
- server guard 为什么不能省略。
- 当前非目标：auth、tenant、audit、multi-instance persistence。

## 8. Concrete Product Agent: OrderOps Copilot

当前具象业务 Agent 收敛为 **OrderOps Copilot**：电商内部订单异常运营 Agent。

一句话定位：

> OrderOps Copilot 自动扫描订单、物流、库存、退款和客诉数据，发现异常并解释原因；它给出处理建议，但退款、补发、优惠券、升级和建单等高风险动作必须由内部人员在受控确认界面中批准后执行。

该方向的详细产品边界、surface、catalog、mock dataset、评测指标和交付顺序见 [order-ops-copilot.md](order-ops-copilot.md)。

在 npm SDK 改造中，OrderOps Copilot 承担三个作用：

1. 作为真实业务验收面，验证 `NexusSurface` 不只是渲染静态 JSONL，而是能支撑动态内部运营任务。
2. 作为自定义 catalog 样例，验证业务组件 schema、action 白名单和 guard 的宿主边界。
3. 作为干净宿主安装测试场景，证明宿主应用可以通过 npm 包渲染异常简报、处理订单异常并回流 mock CRM / 工单 / 物流 action。

叙事口径：

> OrderOps Copilot 是一个电商内部订单异常运营 Agent；Nexus UI 是它的人机协同执行层。

## 9. Validation Matrix

| 层级 | 验证目标 | 成功标准 |
| --- | --- | --- |
| npm install | 干净宿主安装 tarball | 只 import public API 即可运行 |
| renderer | A2UI 消息渲染 | React DOM 正确呈现组件树 |
| state | 输入写回 dataModel | action context 拿到最新值 |
| action | 业务回流 | handler 收到解析后的 action |
| patch | 同 surface 更新 | 不重建页面，组件状态合理保留 |
| guard | 非法输出拦截 | malformed / unregistered / undeclared action 被拒绝 |
| history | 失败隔离 | 失败流无 `done`，不提交 history |
| transport | 外部 Agent RPC | 超时、超限、非 NDJSON 有明确错误 |
| DX | 开发者体验 | 新宿主 30 分钟内跑通 demo |
| business | OrderOps Copilot 产品价值 | 标注样本上验证识别、证据引用、风险拦截和处理记录；采纳率与处理时长收益须有实际参与者和人工基线后再报告 |

## 10. Recommended Validation Order

1. 恢复全仓测试全绿，修正通用 action 执行顺序、失败生成残留、输入校验边界和失败状态；领域幂等由 OrderOps Host 负责，见 [engineering-priorities.md](engineering-priorities.md)。
2. 将 core / React / 有限 server 接入面打成本地 tarball，在干净宿主验证静态 A2UI、输入与 action 冒烟；暂不发布 npm。
3. 用一个标注的物流停滞案例定义 OrderOps Catalog、查询工具与业务 action 契约；接入真实 Agent、订单/物流证据组件和 mock 建单，完成同 surface patch。
4. 用确定性 fixture 和真实模型分别验收：事实引用、人工输入、非法输出、伪造 context、重复提交、并发和中断。
5. 增加处理界面与 action 不同的高金额退款案例，检验同一宿主边界能否复用；发现业务特判时先修抽象。
6. 再扩充到 30 SKU、90 天订单、20-30 个标注异常，并逐步增加 Daily Briefing、Monthly Review 与其他 action。采纳率和处理时长收益需要实际参与者和人工基线。
7. 在两条流程暴露的重复接入逻辑上定型 client、`NexusSurface` 和独立 guard；保持原有限 server 入口兼容，重新跑干净宿主安装验收。
8. 最后评估 Vue renderer、共享 conformance fixtures 和正式 alpha 发布。

## 11. Non-Goals

以下能力不阻塞 alpha SDK：

- 登录认证。
- 租户隔离。
- 权限模型。
- 通用审计平台；OrderOps Host 的业务 action 记录仍需实现。
- 多实例数据库持久化。
- 完整 A2UI v0.9 组件集。
- 多 surface UI router。
- 三端原生渲染。
- 通用低代码页面编辑器。

这些内容应该写进宿主接入文档的责任边界，而不是混入 SDK alpha 的成功标准。
