import { createApp } from './http/app';
import { loadConfig } from './config';
import { openDatabase } from './db/client';
import { seedFixtures } from './fixtures/seed';

const config = loadConfig();

if (config.seedFixtures) {
  const db = openDatabase(config.dbPath, config.migrationsDir);
  const summary = seedFixtures(db, new Date());
  console.log(
    `fixtures seeded: ${summary.orders} orders, ${summary.events} events → ${config.dbPath}`,
  );
}

createApp().listen(config.port, '127.0.0.1', () => {
  console.log(`@orderops/host-server listening on http://127.0.0.1:${config.port}`);
});
