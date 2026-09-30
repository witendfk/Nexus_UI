import { createApp } from './http/app';
import { loadConfig } from './config';
import { openDatabase } from './db/client';
import { detectStalledCases } from './cases/detect';
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

// 启动扫描：occurrence_key 幂等，重复启动不重建。M1 静态 fixture 场景下
// 一次启动扫描即可让队列有数据；事件接入后的周期扫描随 M2 事件源另排。
const detection = detectStalledCases(db, {
  now: new Date(),
  thresholdHours: config.stallThresholdHours,
});
console.log(
  `stall detection: scanned ${detection.scanned} orders, created ${detection.createdCaseIds.length} cases`,
);

createApp({ db }).listen(config.port, '127.0.0.1', () => {
  console.log(`@orderops/host-server listening on http://127.0.0.1:${config.port}`);
});
