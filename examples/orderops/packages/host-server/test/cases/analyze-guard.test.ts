import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openDatabase, type SqliteDb } from '../../src/db/client';
import { detectStalledCases } from '../../src/cases/detect';
import { seedFixtures } from '../../src/fixtures/seed';
import { admitAnalyze, ANALYZABLE_CASE_STATUSES } from '../../src/cases/analyze-guard';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const SEEDED_CASE_ID = 'case-order-stalled-001-evt-stalled-002';

const dbs: SqliteDb[] = [];

function seededDb(): SqliteDb {
  const dir = mkdtempSync(join(tmpdir(), 'orderops-analyze-guard-unit-'));
  const db = openDatabase(join(dir, 'test.sqlite'), fileMigrationsDir());
  dbs.push(db);
  seedFixtures(db, NOW);
  detectStalledCases(db, { now: NOW, thresholdHours: 48 });
  return db;
}

function fileMigrationsDir(): string {
  return new URL('../../src/db/migrations', import.meta.url).pathname;
}

afterEach(() => {
  for (const db of dbs) db.close();
  dbs.length = 0;
});

it('准入白名单只含 open / in_review', () => {
  expect([...ANALYZABLE_CASE_STATUSES].sort()).toEqual(['in_review', 'open']);
});

it('不存在与越权路径都返回 not_found', () => {
  const db = seededDb();
  expect(admitAnalyze(db, 'case-not-exist')).toEqual({ ok: false, reason: 'not_found' });
});

it('open / in_review 可分析；ticket_created / dismissed 被状态拒绝', () => {
  const db = seededDb();
  expect(admitAnalyze(db, SEEDED_CASE_ID)).toMatchObject({ ok: true });

  for (const status of ['in_review', 'ticket_created', 'dismissed'] as const) {
    db.prepare('UPDATE anomaly_cases SET status = ? WHERE id = ?').run(status, SEEDED_CASE_ID);
    const admission = admitAnalyze(db, SEEDED_CASE_ID);
    if (status === 'in_review') {
      expect(admission).toMatchObject({ ok: true });
    } else {
      expect(admission).toEqual({ ok: false, reason: 'status_not_analyzable', status });
    }
  }
});
