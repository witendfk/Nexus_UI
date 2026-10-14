import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type SqliteDb } from '../../src/db/client';
import { detectStalledCases } from '../../src/cases/detect';
import { seedFixtures } from '../../src/fixtures/seed';
import { insertSurfaceBinding, getSurfaceBinding } from '../../src/cases/repository';
import { createTicketForSurface, resolveCreateTicketContext, resolveHostActionContext } from '../../src/actions/create-ticket';

/** T4.1 判据（docs/tasks/CURRENT.md）：最新备注生效；换 path、伪造字段、过期、
 * 双击不能重复建单；事务一次写入工单/案件状态/操作记录/审计。
 * 评审修正（P2）：resolver 按 action 分发，未知 action 走声明字段默认语义。 */

const NOW = new Date('2026-09-30T12:00:00.000Z');
const SEEDED_CASE_ID = 'case-order-stalled-001-evt-stalled-002';
const SURFACE_ID = 'surface-test-1';

const dbs: SqliteDb[] = [];

function seededDbWithBinding(): SqliteDb {
  const dir = mkdtempSync(join(tmpdir(), 'orderops-create-ticket-'));
  const db = openDatabase(join(dir, 'test.sqlite'), fileMigrationsDir());
  dbs.push(db);
  seedFixtures(db, NOW);
  detectStalledCases(db, { now: NOW, thresholdHours: 48 });
  insertSurfaceBinding(db, {
    surfaceId: SURFACE_ID,
    caseId: SEEDED_CASE_ID,
    caseVersion: 1,
    catalogHash: 'sha256:test',
    createdAt: NOW.toISOString(),
  });
  return db;
}

function fileMigrationsDir(): string {
  return new URL('../../src/db/migrations', import.meta.url).pathname;
}

afterEach(() => {
  for (const db of dbs) db.close();
  dbs.length = 0;
});

describe('resolveCreateTicketContext（换 path / 伪造字段在此被拒）', () => {
  const action = { name: 'createTicket', surfaceId: SURFACE_ID, sourceComponentId: 'submit-ticket', timestamp: NOW.toISOString(), context: {} };

  it('只接受 note 一个声明字段，其余字段列出拒绝', () => {
    expect(() =>
      resolveCreateTicketContext({ action: { ...action, context: { note: 'x', orderId: 'fake' } }, clientContext: { note: 'x', orderId: 'fake' } }),
    ).toThrow('orderId');
  });

  it('note 非字符串 / 超长 → 契约校验拒绝', () => {
    expect(() =>
      resolveCreateTicketContext({ action, clientContext: { note: 123 } }),
    ).toThrow('备注非法');
    expect(() =>
      resolveCreateTicketContext({ action, clientContext: { note: 'x'.repeat(1001) } }),
    ).toThrow('备注非法');
  });

  it('合法 note 原样通过（允许为空字符串）', () => {
    expect(resolveCreateTicketContext({ action, clientContext: { note: '最新备注' } })).toEqual({ note: '最新备注' });
    expect(resolveCreateTicketContext({ action, clientContext: { note: '' } })).toEqual({ note: '' });
  });

  it('评审修正：未知 action 走声明字段默认语义（服务端快照权威，M4 扩展点不被全局假设拦截）', () => {
    const surfaceAction = {
      declaration: { name: 'approveSimulatedRefund', context: { amount: { path: '/order/amountMinor' } } },
      snapshot: { dataModel: { order: { amountMinor: 12900 } } },
    };
    const resolution = {
      action: { ...action, name: 'approveSimulatedRefund' },
      surfaceAction,
      clientContext: { amount: '浏览器伪造的金额' },
    };
    // 客户端伪造值被忽略，金额以服务端快照为权威
    expect(resolveHostActionContext(resolution)).toEqual({ amount: 12900 });

    // 未声明字段仍然拒绝
    expect(() =>
      resolveHostActionContext({ ...resolution, clientContext: { amount: 1, orderId: 'x' } }),
    ).toThrow('orderId');
  });
});

describe('createTicketForSurface（领域事务）', () => {
  it('正常建单：最新备注生效，案件状态/版本推进，操作与审计一次写入', () => {
    const db = seededDbWithBinding();
    const outcome = createTicketForSurface(db, { surfaceId: SURFACE_ID, note: '最新备注', requestId: 'req-1' });
    expect(outcome).toMatchObject({ ok: true, caseId: SEEDED_CASE_ID, note: '最新备注' });
    if (!outcome.ok) return;

    const ticket = db.prepare('SELECT case_id, note, status FROM tickets').get() as { case_id: string; note: string; status: string };
    expect(ticket).toMatchObject({ case_id: SEEDED_CASE_ID, note: '最新备注', status: 'created' });
    const c = db.prepare('SELECT status, version FROM anomaly_cases WHERE id = ?').get(SEEDED_CASE_ID) as { status: string; version: number };
    expect(c).toEqual({ status: 'ticket_created', version: 2 });
    const attempt = db.prepare('SELECT status, result_id FROM action_attempts').get() as { status: string; result_id: string };
    expect(attempt.status).toBe('succeeded');
    expect(attempt.result_id).toBe(outcome.ticketId);
    const audit = db.prepare("SELECT kind, payload FROM audit_events WHERE kind = 'ticket_created'").get() as { kind: string; payload: string };
    expect(audit.kind).toBe('ticket_created');
    expect(audit.payload).toContain('最新备注');
  });

  it('surface 无绑定 → 拒绝（fail-closed）', () => {
    const db = seededDbWithBinding();
    const outcome = createTicketForSurface(db, { surfaceId: 'surface-unknown', note: 'x' });
    expect(outcome).toMatchObject({ ok: false, code: 'no-binding' });
  });

  it('案件版本推进 → 过期拒绝并要求重新分析，操作记录记 failed', () => {
    const db = seededDbWithBinding();
    db.prepare('UPDATE anomaly_cases SET version = 2 WHERE id = ?').run(SEEDED_CASE_ID);
    const outcome = createTicketForSurface(db, { surfaceId: SURFACE_ID, note: 'x' });
    expect(outcome).toMatchObject({ ok: false, code: 'expired' });
    if (!outcome.ok) expect(outcome.message).toContain('重新分析');
    const attempt = db.prepare('SELECT status, error FROM action_attempts').get() as { status: string; error: string };
    expect(attempt.status).toBe('failed');
    expect(attempt.error).toContain('重新分析');
  });

  it('dismissed 状态 → 状态拒绝', () => {
    const db = seededDbWithBinding();
    db.prepare('UPDATE anomaly_cases SET status = ? WHERE id = ?').run('dismissed', SEEDED_CASE_ID);
    const outcome = createTicketForSurface(db, { surfaceId: SURFACE_ID, note: 'x' });
    expect(outcome).toMatchObject({ ok: false, code: 'bad-status' });
  });

  it('双击（两个不同 requestId）→ 只建一单，第二次 duplicate，attempts 一成功一失败', () => {
    const db = seededDbWithBinding();
    const first = createTicketForSurface(db, { surfaceId: SURFACE_ID, note: '第一次', requestId: 'req-a' });
    expect(first.ok).toBe(true);
    const second = createTicketForSurface(db, { surfaceId: SURFACE_ID, note: '第二次', requestId: 'req-b' });
    expect(second).toMatchObject({ ok: false, code: 'duplicate' });

    const tickets = db.prepare('SELECT note FROM tickets').all() as Array<{ note: string }>;
    expect(tickets).toHaveLength(1);
    expect(tickets[0]?.note).toBe('第一次');
    const attempts = db.prepare('SELECT status FROM action_attempts ORDER BY created_at').all() as Array<{ status: string }>;
    expect(attempts.map((a) => a.status)).toEqual(['succeeded', 'failed']);
    // 第一单不受影响：案件仍 ticket_created
    const c = db.prepare('SELECT status FROM anomaly_cases WHERE id = ?').get(SEEDED_CASE_ID) as { status: string };
    expect(c.status).toBe('ticket_created');
  });

  it('绑定与案件一致时 version 核对以绑定值为准（surface 基于的版本）', () => {
    const db = seededDbWithBinding();
    expect(getSurfaceBinding(db, SURFACE_ID)?.caseVersion).toBe(1);
    const outcome = createTicketForSurface(db, { surfaceId: SURFACE_ID, note: 'ok' });
    expect(outcome.ok).toBe(true);
  });
});
