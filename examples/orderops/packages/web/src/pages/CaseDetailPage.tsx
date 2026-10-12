import type { ActionEvent } from '@nexus-ui/core';
import { useA2UI } from '@nexus-ui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CaseDetailPayload } from '../api/cases';
import { CaseApiError, fetchCaseDetail } from '../api/cases';
import { formatAmount } from '../format';
import { analyzeCase, dispatchAction } from '../nexus/transport';
import { useActionBridge } from '../App';

type SurfaceStatus = 'idle' | 'streaming' | 'ready' | 'error';

interface CaseSurfaceProps {
  caseId: string;
}

/**
 * Agent 分析区（T3.7）：业务 renderMap 渲染 surface；`done` 前丢弃 action 事件
 * （SPEC §3：流未提交前不存在可执行快照，点击不得外发）；SSE error 与网络失败
 * 由 transport 区分后统一展示。
 */
function CaseSurface({ caseId }: CaseSurfaceProps) {
  const runtime = useA2UI();
  const actionHandlerRef = useActionBridge();
  const streamingRef = useRef(false);
  const [status, setStatus] = useState<SurfaceStatus>('idle');
  const [error, setError] = useState<string>();

  useEffect(() => {
    actionHandlerRef.current = (event: ActionEvent) => {
      if (streamingRef.current) return;
      void dispatchAction(runtime, event).then((outcome) => {
        if (!outcome.ok) {
          setStatus('error');
          setError(outcome.error);
        }
      });
    };
  }, [runtime, actionHandlerRef]);

  const analyze = useCallback(async () => {
    streamingRef.current = true;
    setStatus('streaming');
    setError(undefined);
    try {
      const outcome = await analyzeCase(runtime, caseId);
      if (outcome.ok) {
        setStatus('ready');
      } else {
        setStatus('error');
        setError(outcome.error);
      }
    } finally {
      streamingRef.current = false;
    }
  }, [runtime, caseId]);

  return (
    <section aria-label="agent 分析区">
      <h3>Agent 分析</h3>
      <button type="button" onClick={() => void analyze()} disabled={status === 'streaming'}>
        {status === 'streaming' ? '生成中…' : '生成审核 surface'}
      </button>
      {status === 'streaming' && <p aria-live="polite">生成中，操作按钮暂不可用…</p>}
      {status === 'error' && <p role="alert">生成失败：{error}</p>}
    </section>
  );
}

/** 案件详情（T2.6）：订单摘要、物流时间线、触发原因；路由参数驱动，刷新后状态一致。 */
export function CaseDetailPage() {
  const { caseId = '' } = useParams();
  const [detail, setDetail] = useState<CaseDetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setDetail(null);
    fetchCaseDetail(caseId)
      .then((payload) => {
        if (!active) return;
        setDetail(payload);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof CaseApiError ? err.message : '网络错误：案件详情不可用');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [caseId]);

  if (loading) return <p aria-live="polite">加载中…</p>;
  if (error !== null) {
    return (
      <section>
        <p role="alert">{error}</p>
        <Link to="/">返回案件队列</Link>
      </section>
    );
  }
  if (detail === null) return null;

  const { case: caseSummary, order, events } = detail;
  const triggerEvent =
    caseSummary.lastEventId === null
      ? undefined
      : events.find((event) => event.id === caseSummary.lastEventId);

  return (
    <article>
      <p>
        <Link to="/">← 返回案件队列</Link>
      </p>
      <h2>
        案件 {caseSummary.id}（{caseSummary.type} · 严重度 {caseSummary.severity} ·{' '}
        {caseSummary.status}）
      </h2>

      <section aria-label="订单摘要">
        <h3>订单摘要</h3>
        <dl>
          <dt>订单号</dt>
          <dd>{order.id}</dd>
          <dt>客户</dt>
          <dd>{order.customerId}</dd>
          <dt>金额</dt>
          <dd>{formatAmount(order.amountMinor, order.currency)}</dd>
          <dt>承诺送达</dt>
          <dd>{order.promisedAt ?? '—'}</dd>
          <dt>订单状态</dt>
          <dd>{order.status}</dd>
        </dl>
      </section>

      <section aria-label="触发原因">
        <h3>触发原因</h3>
        <p>
          检出时间 {caseSummary.detectedAt}；触发事件{' '}
          {triggerEvent ? `${triggerEvent.id}（${triggerEvent.occurredAt}）` : caseSummary.lastEventId ?? '—'}
          ，此后物流无新事件，超出停滞阈值建案。
        </p>
      </section>

      <section aria-label="物流时间线">
        <h3>物流时间线</h3>
        <ol>
          {events.map((event) => (
            <li key={event.id} id={event.id}>
              {event.occurredAt} · {event.status} · 来源 {event.source} · {event.id}
            </li>
          ))}
        </ol>
      </section>

      <CaseSurface caseId={caseSummary.id} />
    </article>
  );
}
