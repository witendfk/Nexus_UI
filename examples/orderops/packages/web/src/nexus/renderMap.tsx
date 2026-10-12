import { toDisplayString } from '@nexus-ui/core';
import type { RenderMap } from '@nexus-ui/react';
import { formatAmount } from '../format';

/**
 * 业务 renderMap（T3.7，docs/ARCHITECTURE.md §1.2）：OrderSummary / LogisticsTimeline
 * 只展示事实、不挂 action（Catalog v1 策略即如此声明）；props 已由 core 解析
 * {path} 绑定。证据 id 渲染为页内链接，回查宿主时间线锚点。
 */

interface TimelineItem {
  id: string;
  status: string;
  occurredAt: string;
  source: string;
}

export const businessRenderMap: RenderMap = {
  OrderSummary: (vnode) => {
    const props = vnode.props;
    const amountMinor = typeof props.amountMinor === 'number' ? props.amountMinor : Number.NaN;
    const rows: Array<[string, string]> = [
      ['订单号', toDisplayString(props.orderId)],
      ['商品', toDisplayString(props.product)],
      ['金额', formatAmount(amountMinor, toDisplayString(props.currency))],
      ['客户', toDisplayString(props.customerSummary)],
    ];
    return (
      <dl aria-label="订单摘要">
        {rows.map(([term, value]) => (
          <div key={term} style={{ display: 'flex', gap: 8 }}>
            <dt style={{ minWidth: 56, color: '#666' }}>{term}</dt>
            <dd style={{ margin: 0 }}>{value}</dd>
          </div>
        ))}
      </dl>
    );
  },
  LogisticsTimeline: (vnode) => {
    const events = Array.isArray(vnode.props.events)
      ? (vnode.props.events as unknown[]).filter(
          (item): item is TimelineItem =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as TimelineItem).id === 'string',
        )
      : [];
    return (
      <ol aria-label="物流时间线" style={{ margin: 0, paddingLeft: 20 }}>
        {events.map((event) => (
          <li key={event.id}>
            {event.occurredAt} · {event.status} · 来源 {event.source} ·{' '}
            <a href={`#${event.id}`}>{event.id}</a>
          </li>
        ))}
      </ol>
    );
  },
};
