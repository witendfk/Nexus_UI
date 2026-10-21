/**
 * Playground server executable — the local demo backend for web/nexus-playground.
 * Keep this file side-effectful; it is an example, not the SDK import surface.
 * All SDK capability comes from the @nexus-ui/server public entry.
 */
import Koa from 'koa';
import cors from '@koa/cors';
import {
  createAgentRouter,
  FileSurfaceHistoryStore,
  InMemorySurfaceHistoryStore,
  NEXUS_RUN_ID_HEADER,
} from '@nexus-ui/server';
import type { SurfaceHistoryStore } from '@nexus-ui/server';
import { loadProjectEnv } from './config/env';
import { isLlmAgentEnabled } from './agent/llm-agent';
import {
  createReferenceAgentAdapter,
  listReferencePublishedCatalogs,
} from './reference/reference-agent';

loadProjectEnv();

const historyFile = process.env.NEXUS_HISTORY_FILE;
const surfaceHistoryStore: SurfaceHistoryStore = historyFile
  ? new FileSurfaceHistoryStore(historyFile)
  : new InMemorySurfaceHistoryStore();
const agentAdapter = createReferenceAgentAdapter({ historyStore: surfaceHistoryStore });
const app = new Koa();

const PORT = Number(process.env.PORT ?? 3001);
const maxRequestBodyBytes = readPositiveIntegerEnv('NEXUS_MAX_REQUEST_BODY_BYTES');
const requestBodyTimeoutMs = readPositiveIntegerEnv('NEXUS_REQUEST_TIMEOUT_MS');
const router = createAgentRouter({
  adapter: agentAdapter,
  maxRequestBodyBytes,
  requestBodyTimeoutMs,
  healthAgentMode: isLlmAgentEnabled() ? 'llm' : 'fallback',
  // 本地开发试验台显式放开 runs 查询；真实宿主必须换成基于可信请求上下文的准入。
  runsAccess: () => true,
  // S2.6.1.1：实际入口发布参考服务执行中的三个 Catalog；发布列表取自
  // adapter 的固定执行声明，装配期与执行声明核对 hash，不一致即启动失败。
  catalogContracts: listReferencePublishedCatalogs(agentAdapter),
});

// S2.5.4：SSE 响应携带运行标识，跨源客户端可读需显式暴露。
// 在宿主已有暴露头（当前为空）上合并；只增补暴露，不接管 CORS 授权策略。
const hostExposeHeaders: string[] = [];
const exposeHeaders = [...new Set([...hostExposeHeaders, NEXUS_RUN_ID_HEADER])];

app.use(cors({ exposeHeaders }));
app.use(router.routes());
app.use(router.allowedMethods());

if (process.env.NODE_ENV !== 'test') {
  (surfaceHistoryStore instanceof FileSurfaceHistoryStore
    ? surfaceHistoryStore.initialize()
    : Promise.resolve()
  )
    .then(() => {
      app.listen(PORT, () => {
        // eslint-disable-next-line no-console
        console.log(
          `@nexus-ui/playground-server on http://localhost:${PORT}  (POST /api/a2ui/generate, POST /api/a2ui/event)`,
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
