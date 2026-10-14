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
  | {
      version: 'v0.9';
      updateDataModel: { surfaceId: string; path?: string; value: unknown };
    };

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

  // D8/V1 分阶段产出：每批 updateComponents 只携带该阶段入场的组件，数据经
  // updateDataModel 的可选 path 定点写入（合并语义，不整表替换）——宿主以演示
  // 节奏逐条下发时，界面"逐块生长"。消息形状与一次性版本逐一等价，guard 规则
  // 允许 createSurface 后任意次交错更新。
  const components = (ids: string[]): unknown[] => {
    const byId: Record<string, unknown> = {
      root: {
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
      'case-title': { id: 'case-title', component: 'Text', text: { path: '/title' }, variant: 'h3' },
      'order-summary': {
        id: 'order-summary',
        component: 'OrderSummary',
        orderId: { path: '/order/id' },
        product: { path: '/order/product' },
        currency: { path: '/order/currency' },
        amountMinor: { path: '/order/amountMinor' },
        customerSummary: { path: '/order/customerSummary' },
      },
      timeline: { id: 'timeline', component: 'LogisticsTimeline', events: { path: '/timeline/events' } },
      'analysis-summary': { id: 'analysis-summary', component: 'Text', text: { path: '/analysis/summary' } },
      'analysis-reason': { id: 'analysis-reason', component: 'Text', text: { path: '/analysis/reason' } },
      'analysis-recommendation': {
        id: 'analysis-recommendation',
        component: 'Text',
        text: { path: '/analysis/recommendation' },
      },
      'analysis-uncertainties': {
        id: 'analysis-uncertainties',
        component: 'Text',
        text: { path: '/analysis/uncertaintyText' },
      },
      'analysis-evidence': { id: 'analysis-evidence', component: 'Text', text: { path: '/analysis/evidenceText' } },
      'ticket-result': {
        id: 'ticket-result',
        component: 'Text',
        text: { path: '/result/ticketText' },
        variant: 'body',
      },
      note: {
        id: 'note',
        component: 'TextField',
        label: { path: '/noteLabel' },
        value: { path: '/draft/note' },
        variant: 'longText',
      },
      'submit-ticket-label': { id: 'submit-ticket-label', component: 'Text', text: { path: '/submitButtonLabel' } },
      'submit-ticket': {
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
    };
    return ids.map((id) => byId[id]!);
  };
  const data = (path: string, value: unknown): A2uiMessage => ({
    version: 'v0.9',
    updateDataModel: { surfaceId, path, value },
  });

  return [
    createSurface,
    // 阶段 1：骨架 + 标题
    { version: 'v0.9', updateComponents: { surfaceId, components: components(['root', 'case-title']) } },
    data('/title', `物流异常分析：案件 ${snapshot.case.id}`),
    // 阶段 2：订单事实
    { version: 'v0.9', updateComponents: { surfaceId, components: components(['order-summary']) } },
    data('/order', {
      id: snapshot.order.id,
      // 商品名不在宿主快照事实内（orders 表无该列），用占位符而非编造；
      // M4 扩展契约时再决定是否补真实商品字段。
      product: '—',
      currency: snapshot.order.currency,
      amountMinor: snapshot.order.amountMinor,
      customerSummary: `客户 ${snapshot.order.customerId}；订单状态「${snapshot.order.status}」`,
    }),
    // 阶段 3：物流时间线（证据可回查）
    { version: 'v0.9', updateComponents: { surfaceId, components: components(['timeline']) } },
    data('/timeline', { events: toTimelineItems(context) }),
    // 阶段 4：分析结论
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: components([
          'analysis-summary',
          'analysis-reason',
          'analysis-recommendation',
          'analysis-uncertainties',
          'analysis-evidence',
        ]),
      },
    },
    data('/analysis', {
      summary: analysis.summary,
      reason: analysis.reason,
      recommendation: analysis.recommendation,
      uncertaintyText,
      evidenceText,
      evidenceEventIds: analysis.evidenceEventIds,
    }),
    // 阶段 5：可执行区（工单号槽位 + 备注输入 + 确认按钮）
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: components(['ticket-result', 'note', 'submit-ticket-label', 'submit-ticket']),
      },
    },
    data('/noteLabel', '处理备注'),
    data('/submitButtonLabel', '确认建单'),
    // T4.2：建单成功后由宿主 patch 在 /result 定点写入工单号（不整表替换）。
    data('/result', { ticketText: '确认后此处显示工单号。' }),
    data('/draft', { note: '' }),
  ];
}
