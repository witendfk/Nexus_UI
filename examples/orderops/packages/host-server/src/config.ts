import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// config.ts 位于 <pkg>/src/ 下：'..' 相对文件解析后即包根目录。
const packageRoot = fileURLToPath(new URL('..', import.meta.url));

export interface HostConfig {
  dbPath: string;
  migrationsDir: string;
  seedFixtures: boolean;
  port: number;
  /** 停滞检测阈值（小时）：最新物流事件距今超过该值才建案（docs/PRD.md §5.1）。 */
  stallThresholdHours: number;
  /** Agent /rpc 端点（T3.6 外部生成源）；仅 Host 网络可达，无浏览器面。 */
  agentRpc: {
    endpoint: string;
    /** SPEC §3：接真实模型时提高至 120s；deterministic agent 响应在毫秒级。 */
    timeoutMs: number;
  };
  /** D8/V1 演示节奏：analyze 流每条消息的间隔毫秒数（0 = CI 全速）。只影响
   *  下发节奏，不影响 guard/提交语义——演示配置，不是模型延迟。 */
  demoPacingMs: number;
}

function requirePositive(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`配置非法：${key} 必须是正数，当前为 ${String(raw)}`);
  }
  return value;
}

function requireNonNegative(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`配置非法：${key} 必须是非负整数，当前为 ${String(raw)}`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): HostConfig {
  const thresholdHours = Number(env.ORDEROPS_STALL_THRESHOLD_HOURS ?? 48);
  if (!Number.isFinite(thresholdHours) || thresholdHours <= 0) {
    throw new Error(`配置非法：ORDEROPS_STALL_THRESHOLD_HOURS 必须是正数，当前为 ${String(env.ORDEROPS_STALL_THRESHOLD_HOURS)}`);
  }
  return {
    dbPath: env.ORDEROPS_DB_PATH ?? join(packageRoot, 'var', 'orderops.sqlite'),
    migrationsDir: join(packageRoot, 'src', 'db', 'migrations'),
    seedFixtures: env.ORDEROPS_SEED_FIXTURES === '1',
    port: Number(env.PORT ?? 3201),
    stallThresholdHours: thresholdHours,
    agentRpc: {
      endpoint: env.ORDEROPS_AGENT_URL ?? 'http://127.0.0.1:3202/rpc',
      timeoutMs: requirePositive(env, 'ORDEROPS_AGENT_TIMEOUT_MS', 120_000),
    },
    demoPacingMs: requireNonNegative(env, 'ORDEROPS_DEMO_PACING_MS', 0),
  };
}
