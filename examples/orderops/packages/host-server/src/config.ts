import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// config.ts 位于 <pkg>/src/ 下：'..' 相对文件解析后即包根目录。
const packageRoot = fileURLToPath(new URL('..', import.meta.url));

export interface HostConfig {
  dbPath: string;
  migrationsDir: string;
  seedFixtures: boolean;
  port: number;
  /** 停滞检测阈值（小时）：最新物流事件距今超过该值才建案（architecture.md §4）。 */
  stallThresholdHours: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): HostConfig {
  const thresholdHours = Number(env.ORDEROPS_STALL_THRESHOLD_HOURS ?? 48);
  return {
    dbPath: env.ORDEROPS_DB_PATH ?? join(packageRoot, 'var', 'orderops.sqlite'),
    migrationsDir: join(packageRoot, 'src', 'db', 'migrations'),
    seedFixtures: env.ORDEROPS_SEED_FIXTURES === '1',
    port: Number(env.PORT ?? 3201),
    stallThresholdHours:
      Number.isFinite(thresholdHours) && thresholdHours > 0 ? thresholdHours : 48,
  };
}
