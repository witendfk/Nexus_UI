import type { CaseStatus, CaseSeverity, CaseSummary } from '@orderops/contracts';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CaseApiError, fetchCases } from '../api/cases';

const STATUS_OPTIONS: Array<CaseStatus | ''> = ['', 'open', 'in_review', 'ticket_created', 'dismissed'];
const SEVERITY_OPTIONS: Array<CaseSeverity | ''> = ['', 'high', 'medium', 'low'];

const STATUS_LABELS: Record<string, string> = {
  open: '待处理',
  in_review: '审核中',
  ticket_created: '已建单',
  dismissed: '已忽略',
};
const SEVERITY_LABELS: Record<string, string> = { high: '高', medium: '中', low: '低' };

/** 案件队列（T2.6）：筛选/搜索条件经 URL search params 持有——刷新后状态一致。 */
export function QueuePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get('status') ?? '';
  const severity = searchParams.get('severity') ?? '';
  const q = searchParams.get('q') ?? '';

  const [qDraft, setQDraft] = useState(q);
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setQDraft(q); // URL 是唯一事实源：前进/后退时同步输入框
    setLoading(true);
    setError(null);
    fetchCases({ status: status || undefined, severity: severity || undefined, q: q || undefined })
      .then((result) => {
        setCases(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof CaseApiError ? err.message : '网络错误：案件队列不可用');
        setLoading(false);
      });
  }, [status, severity, q]);

  const applyFilters = (next: { status: string; severity: string; q: string }): void => {
    const params = new URLSearchParams();
    if (next.status) params.set('status', next.status);
    if (next.severity) params.set('severity', next.severity);
    if (next.q) params.set('q', next.q);
    setSearchParams(params);
  };

  return (
    <section>
      <h2>案件队列</h2>
      <form
        aria-label="案件筛选"
        onSubmit={(event) => {
          event.preventDefault();
          applyFilters({ status, severity, q: qDraft });
        }}
      >
        <label>
          状态
          <select
            value={status}
            onChange={(event) => applyFilters({ status: event.target.value, severity, q })}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option || 'all'} value={option}>
                {option === '' ? '全部' : STATUS_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <label>
          严重度
          <select
            value={severity}
            onChange={(event) => applyFilters({ status, severity: event.target.value, q })}
          >
            {SEVERITY_OPTIONS.map((option) => (
              <option key={option || 'all'} value={option}>
                {option === '' ? '全部' : SEVERITY_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <label>
          搜索
          <input
            type="search"
            value={qDraft}
            placeholder="案件 ID / 订单 ID"
            onChange={(event) => setQDraft(event.target.value)}
          />
        </label>
        <button type="submit">搜索</button>
      </form>

      {error !== null && <p role="alert">加载失败：{error}</p>}
      {loading && <p aria-live="polite">加载中…</p>}
      {!loading && cases !== null && cases.length === 0 && <p>没有符合条件的案件</p>}
      {!loading && cases !== null && cases.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>案件</th>
              <th>订单</th>
              <th>严重度</th>
              <th>状态</th>
              <th>检出时间</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((entry) => (
              <tr key={entry.id}>
                <td>
                  <Link to={`/cases/${encodeURIComponent(entry.id)}`}>{entry.id}</Link>
                </td>
                <td>{entry.orderId}</td>
                <td>{SEVERITY_LABELS[entry.severity] ?? entry.severity}</td>
                <td>{STATUS_LABELS[entry.status] ?? entry.status}</td>
                <td>{entry.detectedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
