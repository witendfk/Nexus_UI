/**
 * Reference server executable. Keep this file side-effectful; src/index.ts is
 * the importable host-assembly API and must not start a listener.
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
