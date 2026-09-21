# @nexus-ui/playground

Agent 线 MVP 的端到端前端：自然语言输入、消费 POST SSE、渐进渲染、action 回传和同 surface 更新。

## 当前能力

- `src/app/index.tsx`：输入请求、控制生成 / 取消、展示 action 状态。
- `src/lib/sse-client.ts`：基于 fetch streaming 的 POST SSE 解析器。
- `src/lib/client-action.ts`：把 core `ActionEvent` 包装为 v0.9 client-to-server action 消息。
- 使用 `@nexus-ui/react` 渲染当前 8 组件子集。

组件画廊、多轮对话 UI、协议调试面板和多 surface 工作台不属于当前 MVP。

源码入口为 `src/entry/main.tsx`，应用壳在 `src/app/`，传输与协议适配工具在 `src/lib/`。

## 本地开发

先启动 server：

```bash
pnpm dev:server
```

再启动 Web：

```bash
pnpm dev:web
```

默认地址是 `http://localhost:5173/`，`/api` 代理到 `http://localhost:3001`。

## 命令

```bash
pnpm --filter @nexus-ui/playground dev
pnpm --filter @nexus-ui/playground test
pnpm --filter @nexus-ui/playground typecheck
pnpm --filter @nexus-ui/playground build
```
