import { createApp } from './http/app';
import { loadConfig } from './config';
import { openDatabase } from './db/client';
import { seedFixtures } from './fixtures/seed';

const config = loadConfig();
// 启动即迁移（幂等，user_version 记版本）；案件查询与后续业务都挂在同一连接上。
const db = openDatabase(config.dbPath, config.migrationsDir);

if (config.seedFixtures) {
  const summary = seedFixtures(db, new Date());
  console.log(
    `fixtures seeded: ${summary.orders} orders, ${summary.events} events → ${config.dbPath}`,
  );
}

createApp({ db }).listen(config.port, '127.0.0.1', () => {
  console.log(`@orderops/host-server listening on http://127.0.0.1:${config.port}`);
});
