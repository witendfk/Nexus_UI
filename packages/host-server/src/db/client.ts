import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';

export type SqliteDb = Database.Database;

/**
 * 按文件名前缀数字升序应用 migrations。每个 migration 独立事务执行，
 * `user_version` 记录已应用版本：重复启动时已应用的直接跳过，不重复建表。
 */
export function migrate(db: SqliteDb, migrationsDir: string): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const version = Number.parseInt(file, 10);
    if (!Number.isFinite(version) || version <= current) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    })();
  }
}

export function openDatabase(dbPath: string, migrationsDir: string): SqliteDb {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db, migrationsDir);
  return db;
}
