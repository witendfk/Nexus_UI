import type { AgentAnalysis, ReadContextResponse } from '@orderops/contracts';

/**
 * 分析结果 → A2UI v0.9 编译器（T3.5，docs/DESIGN.md D2）：模型只决定分析内容，
 * 组件树由本确定性代码编译，组件/字段/action 全部落在 Catalog v1 声明内
 * （bindings 走 {path}，action 用 guard 已验证的 event 形状）。
 *
 * 证据不足时编译**不可执行** surface：无 TextField/Button，只陈述缺什么
 * （docs/SPEC.md §5：不满足时输出明确的证据不足结果而非可执行 surface）。
 */

export type A2uiMessage =
  | { version: 'v0.9'; createSurface: { surfaceId: string; catalogId: string } }
  | { version: 'v0.9'; updateComponents: { surfaceId: string; components: unknown[] } }
  | { version: 'v0.9'; updateDataModel: { surfaceId: string; value: Record<string, unknown> } };

export interface CompileSurfaceInput {
  surfaceId: string;
  catalogId: string;
  context: ReadContextResponse;
  analysis: AgentAnalysis;
}

interface TimelineItem {
  id: string;
  status: string;
  occurredAt: string;
  source: string;
}

/** Catalog v1 LogisticsTimeline.items 只允许这四个字段；剔除快照里的 orderId 等多余字段。 */
function toTimelineItems(context: ReadContextResponse): TimelineItem[] {
  return context.snapshot.events.map((event) => ({
    id: event.id,
    status: event.status,
    occurredAt: event.occurredAt,
    source: event.source,
  }));
}

export function compileAnalysisSurface(input: CompileSurfaceInput): A2uiMessage[] {
  const { surfaceId, catalogId, context, analysis } = input;
  const { snapshot } = context;
  const createSurface: A2uiMessage = {
    version: 'v0.9',
    createSurface: { surfaceId, catalogId },
  };

  if (analysis.verdict === 'insufficient_evidence') {
    const missingText =
      analysis.missingInformation.length === 0
        ? '未提供缺失明细'
        : analysis.missingInformation.join('；');
    return [
      createSurface,
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId,
          components: [
            { id: 'root', component: 'Column', children: ['case-title', 'insufficient-title', 'insufficient-reason', 'insufficient-missing'] },
            { id: 'case-title', component: 'Text', text: { path: '/title' }, variant: 'h3' },
            { id: 'insufficient-title', component: 'Text', text: { path: '/insufficient/title' }, variant: 'body' },
            { id: 'insufficient-reason', component: 'Text', text: { path: '/insufficient/reason' } },
            { id: 'insufficient-missing', component: 'Text', text: { path: '/insufficient/missingText' } },
          ],
        },
      },
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId,
          value: {
            title: `物流异常核查：案件 ${snapshot.case.id}`,
            insufficient: {
              title: '证据不足，暂不能建单',
              reason: analysis.reason,
              missingText: `缺少信息：${missingText}`,
            },
          },
        },
      },
    ];
  }

  const uncertaintyText =
    analysis.uncertainties.length === 0 ? '无明显不确定性。' : `不确定性：${analysis.uncertainties.join('；')}`;
  const evidenceText =
    analysis.evidenceEventIds.length === 0
      ? ''
      : `引用证据：${analysis.evidenceEventIds.join('、')}（可在时间线中回查）。`;

  return [
    createSurface,
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          {
            id: 'root',
            component: 'Column',
            children: [
              'case-title',
              'order-summary',
              'timeline',
              'analysis-summary',
              'analysis-reason',
              'analysis-recommendation',
              'analysis-uncertainties',
              'analysis-evidence',
              'ticket-result',
              'note',
              'submit-ticket-label',
              'submit-ticket',
            ],
          },
          { id: 'case-title', component: 'Text', text: { path: '/title' }, variant: 'h3' },
          {
            id: 'order-summary',
            component: 'OrderSummary',
            orderId: { path: '/order/id' },
            product: { path: '/order/product' },
            currency: { path: '/order/currency' },
            amountMinor: { path: '/order/amountMinor' },
            customerSummary: { path: '/order/customerSummary' },
          },
          { id: 'timeline', component: 'LogisticsTimeline', events: { path: '/timeline/events' } },
          { id: 'analysis-summary', component: 'Text', text: { path: '/analysis/summary' } },
          { id: 'analysis-reason', component: 'Text', text: { path: '/analysis/reason' } },
          {
            id: 'analysis-recommendation',
            component: 'Text',
            text: { path: '/analysis/recommendation' },
          },
          {
            id: 'analysis-uncertainties',
            component: 'Text',
            text: { path: '/analysis/uncertaintyText' },
          },
          { id: 'analysis-evidence', component: 'Text', text: { path: '/analysis/evidenceText' } },
          {
            id: 'ticket-result',
            component: 'Text',
            text: { path: '/result/ticketText' },
            variant: 'body',
          },
          { id: 'note', component: 'TextField', label: { path: '/noteLabel' }, value: { path: '/draft/note' }, variant: 'longText' },
          { id: 'submit-ticket-label', component: 'Text', text: { path: '/submitButtonLabel' } },
          {
            id: 'submit-ticket',
            component: 'Button',
            child: 'submit-ticket-label',
            action: {
              event: {
                name: 'createTicket',
                context: { note: { path: '/draft/note' } },
              },
            },
          },
        ],
      },
    },
    {
      version: 'v0.9',
      updateDataModel: {
        surfaceId,
        value: {
          title: `物流异常分析：案件 ${snapshot.case.id}`,
          // 商品名不在宿主快照事实内（orders 表无该列），用占位符而非编造；
          // M4 扩展契约时再决定是否补真实商品字段。
          order: {
            id: snapshot.order.id,
            product: '—',
            currency: snapshot.order.currency,
            amountMinor: snapshot.order.amountMinor,
            customerSummary: `客户 ${snapshot.order.customerId}；订单状态「${snapshot.order.status}」`,
          },
          timeline: { events: toTimelineItems(context) },
          analysis: {
            summary: analysis.summary,
            reason: analysis.reason,
            recommendation: analysis.recommendation,
            uncertaintyText,
            evidenceText,
            evidenceEventIds: analysis.evidenceEventIds,
          },
          noteLabel: '处理备注',
          submitButtonLabel: '确认建单',
          // T4.2：建单成功后由宿主 patch 在 /result 定点写入工单号（不整表替换）。
          result: { ticketText: '确认后此处显示工单号。' },
          draft: { note: '' },
        },
      },
    },
  ];
}
