// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { VNode } from '@nexus-ui/core';
import { businessRenderMap } from '../../src/nexus/renderMap';

/** T3.7 判据：证据可回查（时间线渲染页内锚点链接）；业务组件只展示事实。 */

function vnodeOf(props: Record<string, unknown>, id = 'c1'): VNode {
  return { id, surfaceId: 's-1', component: 'Test', props } as unknown as VNode;
}

afterEach(cleanup);

describe('业务 renderMap（T3.7）', () => {
  it('OrderSummary：渲染订单事实，金额按两位小数呈现', () => {
    const element = businessRenderMap.OrderSummary!(
      vnodeOf({
        orderId: 'order-stalled-001',
        product: '—',
        currency: 'CNY',
        amountMinor: 12900,
        customerSummary: '客户 cust-001；订单状态「shipped」',
      }),
      [],
      { triggerAction: () => {}, setInputValue: () => false },
    );
    const { container } = render(<>{element}</>);
    expect(screen.getByText('order-stalled-001')).toBeTruthy();
    expect(screen.getByText('CNY 129.00')).toBeTruthy();
    expect(screen.getByText(/cust-001/)).toBeTruthy();
    expect(container.querySelector('dl')).not.toBeNull();
  });

  it('LogisticsTimeline：事件渲染为页内锚点链接（证据可回查）', () => {
    const element = businessRenderMap.LogisticsTimeline!(
      vnodeOf({
        events: [
          { id: 'evt-stalled-001', status: 'in_transit', occurredAt: '2026-09-27T08:00:00.000Z', source: 'carrier-webhook' },
          { id: 'evt-stalled-002', status: 'stalled', occurredAt: '2026-09-28T06:00:00.000Z', source: 'carrier-webhook' },
        ],
      }),
      [],
      { triggerAction: () => {}, setInputValue: () => false },
    );
    const { container } = render(<>{element}</>);
    const links = container.querySelectorAll('a');
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute('href')).toBe('#evt-stalled-001');
    expect(links[1]?.getAttribute('href')).toBe('#evt-stalled-002');
    expect(links[1]?.textContent).toContain('evt-stalled-002');
  });

  it('LogisticsTimeline：events 非数组时不渲染条目也不抛错', () => {
    const element = businessRenderMap.LogisticsTimeline!(
      vnodeOf({ events: 'oops' }, 'c2'),
      [],
      { triggerAction: () => {}, setInputValue: () => false },
    );
    const { container } = render(<>{element}</>);
    expect(container.querySelectorAll('li')).toHaveLength(0);
  });
});
