# @nexus-ui/playground

Agent 线 MVP 的端到端前端：自然语言输入、消费 POST SSE、渐进渲染、action 回传和同 surface 更新。

## 当前能力

- `src/app/index.tsx`：输入请求、控制生成 / 取消、展示 action 状态。
- `@nexus-ui/client`：唯一 SSE/Session 消费、提交基准、输入草稿发送确认与取消/销毁。
- `@nexus-ui/react`：`A2UIPreview` 只读渐进预览；完整提交后挂载 `A2UISurface`，动作禁用态与出口双重门控。

组件画廊、多轮对话 UI、协议调试面板和多 surface 工作台不属于当前 MVP。

源码入口为 `src/entry/main.tsx`，应用壳在 `src/app/`，契约加载与 renderMap 在 `src/catalog/`；应用不再自写 SSE 或 Session 状态机。重新生成显式替换会话，切换 Catalog/卸载销毁旧实例；action 期间允许编辑输入，取消不代表撤销宿主业务操作。

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
