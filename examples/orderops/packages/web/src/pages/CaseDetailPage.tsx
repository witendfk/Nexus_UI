import type { ActionEvent } from '@nexus-ui/core';
import { useA2UI } from '@nexus-ui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CaseDetailPayload } from '../api/cases';
import { CaseApiError, fetchCaseDetail } from '../api/cases';
import { formatAmount } from '../format';
import { analyzeCase, dispatchAction, fetchActionStatus } from '../nexus/transport';
import { useActionBridge } from '../App';

type SurfaceStatus = 'idle' | 'streaming' | 'ready' | 'submitting' | 'error' | 'recovered';

interface CaseSurfaceProps {
  caseId: string;
}

/**
 * Agent 分析与提交区（T4.3）：生成受控 surface、提交 action，并对三种结局
 * 显式表态——成功（patch 渲染工单号）、可确认失败（允许重试）、结果未知
 * （以 Host 查询为准；查询不可用时锁定重发，docs/DESIGN.md D5）。
 * `done` 前丢弃 action 事件；流提交中同样不重入。
 */
function CaseSurface({ caseId }: CaseSurfaceProps) {
  const runtime = useA2UI();
  const actionHandlerRef = useActionBridge();
  const streamingRef = useRef(false);
  const submittingRef = useRef(false);
  /** 结果未知（查询不可用）时锁住重发，直到重新分析。 */
  const unknownResultRef = useRef(false);
  const [status, setStatus] = useState<SurfaceStatus>('idle');
  const [error, setError] = useState<string>();
  const [resultText, setResultText] = useState<string>();
  /** V1 流式可见化：已接收的 A2UI 消息条数（宿主演示节奏下逐条增长）。 */
  const [received, setReceived] = useState(0);
  /** V2 对抗模式：开关 + SDK 拒绝的边界码（非空时渲染拒绝横幅）。 */
  const [adversarial, setAdversarial] = useState(false);
  const [rejectCode, setRejectCode] = useState<string>();

  useEffect(() => {
    actionHandlerRef.current = (event: ActionEvent) => {
      if (streamingRef.current || submittingRef.current || unknownResultRef.current) return;
      const actionId = crypto.randomUUID();
      submittingRef.current = true;
      setStatus('submitting');
      setError(undefined);
      void dispatchAction(runtime, event, actionId).then((outcome) => {
        if (outcome.ok) {
          submittingRef.current = false;
          setStatus('ready');
          return;
        }
        // 流失败 ≠ 业务失败：以 Host 终态查询为准（不盲目重发）。
        void fetchActionStatus(actionId).then((query) => {
          submittingRef.current = false;
          if (query.kind === 'found' && query.payload.status === 'succeeded') {
            unknownResultRef.current = true;
            setResultText(
              `工单号：${query.payload.resultId ?? actionId}（Host 确认，界面流未完成）`,
            );
            setStatus('recovered');
            return;
          }
          if (query.kind === 'unavailable') {
            unknownResultRef.current = true;
            setStatus('error');
            setError(`提交结果未知（${outcome.error}）；请稍后刷新查询，确认前请勿重复提交。`);
            return;
          }
          setStatus('error');
          setError(outcome.error);
        });
      });
    };
  }, [runtime, actionHandlerRef]);

  const analyze = useCallback(async () => {
    streamingRef.current = true;
    unknownResultRef.current = false;
    setStatus('streaming');
    setError(undefined);
    setRejectCode(undefined);
    setReceived(0);
    try {
      const outcome = await analyzeCase(
        runtime,
        caseId,
        (count) => setReceived(count),
        { adversarial },
      );
      if (outcome.ok) {
        setStatus('ready');
      } else {
        if (outcome.code !== undefined) setRejectCode(outcome.code);
        setStatus('error');
        setError(outcome.error);
      }
    } finally {
      streamingRef.current = false;
    }
  }, [runtime, caseId, adversarial]);

  return (
    <section aria-label="agent 分析区">
      <h3>Agent 分析</h3>
      <button type="button" onClick={() => void analyze()} disabled={status === 'streaming' || status === 'submitting'}>
        {status === 'streaming' ? '生成中…' : '生成审核 surface'}
      </button>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 12, fontSize: 13, color: '#666' }}>
        <input
          type="checkbox"
          checked={adversarial}
          onChange={(event) => setAdversarial(event.target.checked)}
          disabled={status === 'streaming' || status === 'submitting'}
        />
        对抗模式（演示：模拟模型越权输出）
      </label>
      {status === 'streaming' && (
        <p aria-live="polite">
          {received === 0
            ? '正在生成受控界面…'
            : `SDK 已接收 ${received} 条界面消息，逐条渲染中（完成前操作按钮不可用）…`}
        </p>
      )}
      {status === 'submitting' && <p aria-live="polite">提交中，请勿重复操作…</p>}
      {status === 'recovered' && (
        <p role="status" aria-live="polite">
          {resultText}
        </p>
      )}
      {status === 'error' && rejectCode !== undefined && (
        <p
          role="alert"
          style={{ border: '1px solid #b91c1c', color: '#b91c1c', padding: '8px 10px', borderRadius: 6 }}
        >
          <strong>SDK 已拒绝模型输出</strong>（{rejectCode}）：{error}
        </p>
      )}
      {status === 'error' && rejectCode === undefined && <p role="alert">失败：{error}</p>}
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
  // T4.3 刷新恢复：终态案件不再提供分析入口（Host 侧 analyze 也会 409），与 Host 状态一致。
  const analyzable = caseSummary.status === 'open' || caseSummary.status === 'in_review';

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

      {analyzable ? (
        <CaseSurface caseId={caseSummary.id} />
      ) : (
        <section aria-label="处理状态">
          <h3>处理状态</h3>
          <p role="status">
            案件当前状态「{caseSummary.status}」，已关闭分析入口；以 Host 记录为准。
          </p>
        </section>
      )}
    </article>
  );
}
