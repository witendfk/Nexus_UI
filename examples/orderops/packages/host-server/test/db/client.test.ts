import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { openDatabase, type SqliteDb } from '../../src/db/client';

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

const tempDirs: string[] = [];
const dbs: SqliteDb[] = [];

function newDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'orderops-db-'));
  tempDirs.push(dir);
  return join(dir, 'test.sqlite');
}

function tableNames(db: SqliteDb): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name).sort();
}

afterEach(() => {
  for (const db of dbs) db.close();
  dbs.length = 0;
});

it('首次打开应用 0001：7 张业务表齐全，user_version=1', () => {
  const db = openDatabase(newDbPath(), migrationsDir);
  dbs.push(db);
  expect(db.pragma('user_version', { simple: true })).toBe(1);
  expect(tableNames(db)).toEqual([
    'action_attempts',
    'anomaly_cases',
    'audit_events',
    'logistics_events',
    'orders',
    'surface_bindings',
    'tickets',
  ]);
});

it('重复打开同一文件不重复建表、不报错', () => {
  const path = newDbPath();
  const first = openDatabase(path, migrationsDir);
  dbs.push(first);
  const before = tableNames(first);

  const second = openDatabase(path, migrationsDir);
  dbs.push(second);
  expect(second.pragma('user_version', { simple: true })).toBe(1);
  expect(tableNames(second)).toEqual(before);
});

it('逐版本前进：新增 migration 文件后重开只应用新版本', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orderops-mig-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, '0001_a.sql'), 'CREATE TABLE a (id TEXT PRIMARY KEY);');
  const path = newDbPath();

  const first = openDatabase(path, dir);
  dbs.push(first);
  expect(first.pragma('user_version', { simple: true })).toBe(1);

  writeFileSync(join(dir, '0002_b.sql'), 'CREATE TABLE b (id TEXT PRIMARY KEY);');
  const second = openDatabase(path, dir);
  dbs.push(second);
  expect(second.pragma('user_version', { simple: true })).toBe(2);
  expect(tableNames(second)).toContain('b');
});

it('领域幂等约束生效：occurrence_key 与 tickets.case_id 重复插入被拒', () => {
  const db = openDatabase(newDbPath(), migrationsDir);
  dbs.push(db);
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO orders (id, customer_id, currency, amount_minor, promised_at, status) VALUES ('o1','c1','CNY',100,NULL,'shipping')",
  ).run();
  const insertCase = db.prepare(
    "INSERT INTO anomaly_cases (id, order_id, type, occurrence_key, severity, status, detected_at) VALUES (?,'o1','logistics_stalled',?,'high','open',?)",
  );
  insertCase.run('case-1', 'stall-1', now);
  expect(() => insertCase.run('case-2', 'stall-1', now)).toThrow();

  const insertTicket = db.prepare(
    "INSERT INTO tickets (id, case_id, order_id, note, status, created_at) VALUES (?,'case-1','o1','','created',?)",
  );
  insertTicket.run('t-1', now);
  expect(() => insertTicket.run('t-2', now)).toThrow();
});

it('foreign_keys 开启：孤儿物流事件被拒', () => {
  const db = openDatabase(newDbPath(), migrationsDir);
  dbs.push(db);
  expect(() =>
    db
      .prepare(
        "INSERT INTO logistics_events (id, order_id, status, occurred_at, source) VALUES ('e1','missing','in_transit',?,'carrier')",
      )
      .run(new Date().toISOString()),
  ).toThrow();
});
