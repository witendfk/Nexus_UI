/**
 * @nexus-ui/server —— Agent 线第一版服务组合根。
 *
 * 本模块只负责加载配置、装配 Koa/router/cors 和监听端口；
 * Agent 生成与校验、API 请求处理、SSE 传输分别在子目录中实现。
 */
import Koa from 'koa';
import cors from '@koa/cors';
import { createAgentRouter } from './api/routes';
import { AgentAdapter } from './agent/adapter';
import { defaultSurfaceHistoryStore } from './agent/history';
import { FileSurfaceHistoryStore } from './agent/file-history';
import { loadProjectEnv } from './config/env';

loadProjectEnv();

const historyFile = process.env.NEXUS_HISTORY_FILE;
const surfaceHistoryStore = historyFile
  ? new FileSurfaceHistoryStore(historyFile)
  : defaultSurfaceHistoryStore;
const agentAdapter = new AgentAdapter({ historyStore: surfaceHistoryStore });
const app = new Koa();

const PORT = Number(process.env.PORT ?? 3001);
const maxRequestBodyBytes = readPositiveIntegerEnv('NEXUS_MAX_REQUEST_BODY_BYTES');
const requestBodyTimeoutMs = readPositiveIntegerEnv('NEXUS_REQUEST_TIMEOUT_MS');
const router = createAgentRouter({
  adapter: agentAdapter,
  maxRequestBodyBytes,
  requestBodyTimeoutMs,
});

app.use(cors());
app.use(router.routes());
app.use(router.allowedMethods());

// 测试环境导入时只装配不监听，避免占用端口。
if (process.env.NODE_ENV !== 'test') {
  (surfaceHistoryStore instanceof FileSurfaceHistoryStore
    ? surfaceHistoryStore.initialize()
    : Promise.resolve()
  )
    .then(() => {
      app.listen(PORT, () => {
        // eslint-disable-next-line no-console
        console.log(
          `@nexus-ui/server on http://localhost:${PORT}  (POST /api/a2ui/generate, POST /api/a2ui/event)`,
        );
      });
    })
    .catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error(
        `Surface history 初始化失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    });
}

export { app, router, PORT };

function readPositiveIntegerEnv(key: string): number | undefined {
  const value = process.env[key];
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} 必须是正整数`);
  }
  return parsed;
}
