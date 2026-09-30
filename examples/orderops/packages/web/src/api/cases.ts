import type { CaseSummary, LogisticsEvent, OrderFacts } from '@orderops/contracts';

/** 案件详情载荷（对应 host GET /api/cases/:id）。 */
export interface CaseDetailPayload {
  case: CaseSummary;
  order: OrderFacts;
  events: LogisticsEvent[];
}

export interface CaseListQuery {
  status?: string;
  severity?: string;
  q?: string;
}

export class CaseApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function parseError(response: Response): Promise<never> {
  let message = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { message?: string; error?: string };
    if (body.message) message = body.message;
  } catch {
    // 非 JSON 错误体：保留状态码信息
  }
  throw new CaseApiError(response.status, message);
}

/** 案件队列查询；非法过滤参数由服务端 400，这里透出服务端 message。 */
export async function fetchCases(query: CaseListQuery): Promise<CaseSummary[]> {
  const search = new URLSearchParams();
  if (query.status) search.set('status', query.status);
  if (query.severity) search.set('severity', query.severity);
  if (query.q) search.set('q', query.q);
  const suffix = search.toString();
  const response = await fetch(`/api/cases${suffix ? `?${suffix}` : ''}`);
  if (!response.ok) await parseError(response);
  const body = (await response.json()) as { cases: CaseSummary[] };
  return body.cases;
}

export async function fetchCaseDetail(caseId: string): Promise<CaseDetailPayload> {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}`);
  if (!response.ok) await parseError(response);
  return (await response.json()) as CaseDetailPayload;
}
