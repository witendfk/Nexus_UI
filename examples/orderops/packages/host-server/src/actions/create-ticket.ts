import { randomUUID } from 'node:crypto';
import { CreateTicketInputSchema } from '@orderops/contracts';
import { getSurfaceBinding } from '../cases/repository';
import type { AgentAction } from '@nexus-ui/server';
import type { SqliteDb } from '../db/client';

/**
 * createTicket 领域事务（M3/T4.1，docs/DESIGN.md D4/D5）：
 * - 归属：surfaceId 反查 `surface_bindings`（T3.6 落库），浏览器声明的案件字段一律忽略；
 * - 过期：binding.case_version 落后于案件当前版本 → 拒绝并要求重新分析；
 * - 幂等：`tickets.case_id UNIQUE` 兜底，双击（不同 actionId 的两个请求）只建一单；
 * - 事务：工单 + 案件状态/版本 + 操作记录 + 审计一次提交；patch 失败不回滚（T4.2 查询恢复）。
 */

export type CreateTicketOutcome =
  | { ok: true; ticketId: string; caseId: string; orderId: string; note: string }
  | {
      ok: false;
      code:
        | 'no-binding'
        | 'case-missing'
        | 'expired'
        | 'bad-status'
        | 'duplicate'
        | 'internal';
      message: string;
    };

export interface CreateTicketInput {
  surfaceId: string;
  /** 浏览器最新输入，经 resolveCreateTicketContext 提纯。 */
  note: string;
  /** 客户端请求重放识别（actionId；缺失按无请求键处理）。 */
  requestId?: string;
}

/**
 * 自定义 resolveActionContext（SPEC §3）：浏览器**最新输入**经此提纯后才是权威 context
 * ——默认 resolver 只读服务端 dataModel，拿不到浏览器后续编辑值。仅接受 `note`
 * 一个声明字段（换 path、伪造字段在此被拒），类型/长度按 contracts 契约校验。
 */
export function resolveCreateTicketContext(resolution: {
  action: AgentAction;
  clientContext: Record<string, unknown>;
}): Record<string, unknown> {
  const { action, clientContext } = resolution;
  if (action.name !== 'createTicket') {
    throw new Error(`未支持的领域 action: ${action.name}`);
  }
  const extraFields = Object.keys(clientContext).filter((key) => key !== 'note');
  if (extraFields.length > 0) {
    throw new Error(`未声明的 action 字段: ${extraFields.join(', ')}`);
  }
  const parsed = CreateTicketInputSchema.safeParse({ note: clientContext.note });
  if (!parsed.success) {
    throw new Error(`备注非法：${parsed.error.issues[0]?.message ?? '不是合法的 note 字段'}`);
  }
  return { note: parsed.data.note };
}

function recordAttempt(
  db: SqliteDb,
  input: { caseId: string; surfaceId: string; requestId?: string; status: string; resultId?: string; error?: string; now: string },
): void {
  // request_key 即客户端 actionId：既是重放识别键（唯一索引），也是
  // GET /api/actions/:actionId 的查询键（T4.2）。UUID 全局唯一，无需拼接。
  const requestKey = input.requestId ?? null;
  try {
    db.prepare(
      `INSERT INTO action_attempts (id, case_id, operation, request_key, status, result_id, error, created_at)
       VALUES (?, ?, 'createTicket', ?, ?, ?, ?, ?)`,
    ).run(
      `attempt-${randomUUID()}`,
      input.caseId,
      requestKey,
      input.status,
      input.resultId ?? null,
      input.error ?? null,
      input.now,
    );
  } catch {
    // request_key 唯一冲突 = 同请求重放，保留首条记录即可。
  }
}

export function createTicketForSurface(db: SqliteDb, input: CreateTicketInput): CreateTicketOutcome {
  const binding = getSurfaceBinding(db, input.surfaceId);
  if (binding === null) {
    return {
      ok: false,
      code: 'no-binding',
      message: 'surface 无案件绑定（绑定缺失或宿主重启前的旧 surface），请重新分析',
    };
  }

  try {
    return db.transaction((): CreateTicketOutcome => {
      const now = new Date().toISOString();
      const caseRow = db
        .prepare('SELECT id, order_id, status, version FROM anomaly_cases WHERE id = ?')
        .get(binding.caseId) as
        | { id: string; order_id: string; status: string; version: number }
        | undefined;
      if (caseRow === undefined) {
        return { ok: false, code: 'case-missing', message: `绑定指向的案件不存在: ${binding.caseId}` };
      }
      // 重复检查必须先于版本检查：第一次建单本身就会推进版本，双击的第二个请求
      // 应答"已建单"而不是误导性的"请重新分析"。
      const existing = db.prepare('SELECT id FROM tickets WHERE case_id = ?').get(caseRow.id) as
        | { id: string }
        | undefined;
      if (existing !== undefined) {
        const message = '该案件已建单，不能重复创建';
        recordAttempt(db, { caseId: caseRow.id, surfaceId: input.surfaceId, requestId: input.requestId, status: 'failed', error: message, now });
        return { ok: false, code: 'duplicate', message };
      }
      if (caseRow.version !== binding.caseVersion) {
        const message = `案件已推进到版本 ${caseRow.version}（surface 基于 v${binding.caseVersion}），请重新分析后再建单`;
        recordAttempt(db, { caseId: caseRow.id, surfaceId: input.surfaceId, requestId: input.requestId, status: 'failed', error: message, now });
        return { ok: false, code: 'expired', message };
      }
      if (caseRow.status !== 'open' && caseRow.status !== 'in_review') {
        const message = `案件状态 ${caseRow.status} 不允许建单`;
        recordAttempt(db, { caseId: caseRow.id, surfaceId: input.surfaceId, requestId: input.requestId, status: 'failed', error: message, now });
        return { ok: false, code: 'bad-status', message };
      }

      const ticketId = `ticket-${randomUUID()}`;
      db.prepare(
        'INSERT INTO tickets (id, case_id, order_id, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(ticketId, caseRow.id, caseRow.order_id, input.note, 'created', now);
      db.prepare('UPDATE anomaly_cases SET status = ?, version = version + 1 WHERE id = ?').run(
        'ticket_created',
        caseRow.id,
      );
      recordAttempt(db, {
        caseId: caseRow.id,
        surfaceId: input.surfaceId,
        requestId: input.requestId,
        status: 'succeeded',
        resultId: ticketId,
        now,
      });
      db.prepare(
        'INSERT INTO audit_events (id, case_id, kind, actor, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        `audit-${randomUUID()}`,
        caseRow.id,
        'ticket_created',
        'operator',
        JSON.stringify({ ticketId, note: input.note, surfaceId: input.surfaceId, caseVersion: binding.caseVersion }),
        now,
      );
      return { ok: true, ticketId, caseId: caseRow.id, orderId: caseRow.order_id, note: input.note };
    })();
  } catch (error) {
    return {
      ok: false,
      code: 'internal',
      message: `建单事务失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
