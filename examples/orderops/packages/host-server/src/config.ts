import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// config.ts 位于 <pkg>/src/ 下：'..' 相对文件解析后即包根目录。
const packageRoot = fileURLToPath(new URL('..', import.meta.url));

export interface HostConfig {
  dbPath: string;
  migrationsDir: string;
  seedFixtures: boolean;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): HostConfig {
  return {
    dbPath: env.ORDEROPS_DB_PATH ?? join(packageRoot, 'var', 'orderops.sqlite'),
    migrationsDir: join(packageRoot, 'src', 'db', 'migrations'),
    seedFixtures: env.ORDEROPS_SEED_FIXTURES === '1',
    port: Number(env.PORT ?? 3201),
  };
}
