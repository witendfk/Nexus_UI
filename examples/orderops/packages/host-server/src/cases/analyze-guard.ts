import type { CaseStatus, CaseSummary } from '@orderops/contracts';
import type { SqliteDb } from '../db/client';
import { getCaseDetail } from './repository';

/**
 * 分析准入（T3.3b，docs/ARCHITECTURE.md §3）：案件生成入口在调用 adapter 之前
 * 由 Host 核对案件存在与状态，自由 message 不能绕过只读案件边界。
 * `open`/`in_review` 可（重新）分析；`ticket_created` 已有工单、`dismissed` 已关闭，拒绝。
 */
export const ANALYZABLE_CASE_STATUSES: readonly CaseStatus[] = ['open', 'in_review'];

export type AnalyzeAdmission =
  | { ok: true; caseSummary: CaseSummary }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'status_not_analyzable'; status: CaseStatus };

export function admitAnalyze(db: SqliteDb, caseId: string): AnalyzeAdmission {
  const detail = getCaseDetail(db, caseId);
  if (detail === null) return { ok: false, reason: 'not_found' };
  if (!ANALYZABLE_CASE_STATUSES.includes(detail.case.status)) {
    return { ok: false, reason: 'status_not_analyzable', status: detail.case.status };
  }
  return { ok: true, caseSummary: detail.case };
}
