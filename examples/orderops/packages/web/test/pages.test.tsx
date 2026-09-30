// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../src/App';
import type { CaseSummary } from '@orderops/contracts';
import type { CaseDetailPayload } from '../src/api/cases';

const SUMMARY: CaseSummary = {
  id: 'case-order-stalled-001-evt-stalled-002',
  orderId: 'order-stalled-001',
  type: 'logistics_stalled',
  severity: 'high',
  status: 'open',
  detectedAt: '2026-09-30T12:00:00.000Z',
  lastEventId: 'evt-stalled-002',
};

const DETAIL: CaseDetailPayload = {
  case: SUMMARY,
  order: {
    id: 'order-stalled-001',
    customerId: 'cust-1001',
    currency: 'CNY',
    amountMinor: 129_900,
    promisedAt: '2026-09-29T12:00:00.000Z',
    status: 'shipping',
  },
  events: [
    {
      id: 'evt-stalled-001',
      orderId: 'order-stalled-001',
      status: 'picked_up',
      occurredAt: '2026-09-26T12:00:00.000Z',
      source: 'carrier-api',
    },
    {
      id: 'evt-stalled-002',
      orderId: 'order-stalled-001',
      status: 'in_transit',
      occurredAt: '2026-09-27T12:00:00.000Z',
      source: 'carrier-api',
    },
  ],
};

function jsonResponse(payload: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => payload } as unknown as Response;
}

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((input) => {
    const url = String(input);
    if (url.includes('/api/cases/')) return Promise.resolve(jsonResponse(DETAIL));
    if (url.includes('/api/cases')) return Promise.resolve(jsonResponse({ cases: [SUMMARY] }));
    return Promise.reject(new Error(`意外的请求：${url}`));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAt(initialPath: string): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>,
  );
}

it('队列页渲染案件列表，链接指向详情路由', async () => {
  renderAt('/');

  expect(await screen.findByText('case-order-stalled-001-evt-stalled-002')).toBeDefined();
  const link = screen.getByRole('link', { name: 'case-order-stalled-001-evt-stalled-002' });
  expect(link.getAttribute('href')).toBe('/cases/case-order-stalled-001-evt-stalled-002');
});

it('T2.6 判据：路由参数驱动查询——初始 URL 的过滤条件直接进入请求', async () => {
  renderAt('/?status=open&severity=high&q=stalled');

  await screen.findByText('case-order-stalled-001-evt-stalled-002');
  const listCall = fetchMock.mock.calls.find((call) => String(call[0]).includes('/api/cases?'));
  expect(String(listCall?.[0])).toBe('/api/cases?status=open&severity=high&q=stalled');
});

it('T2.6 判据：队列 → 详情 → 刷新（直接以详情路由载入）状态一致', async () => {
  renderAt('/');
  fireEvent.click(await screen.findByRole('link', { name: /case-order-stalled-001/ }));

  // 路由切换后详情页数据齐备：订单摘要 / 触发原因 / 时间线
  expect(await screen.findByText('订单摘要')).toBeDefined();
  expect(screen.getByText('cust-1001')).toBeDefined();
  expect(screen.getByText('CNY 1299.00')).toBeDefined();
  expect(screen.getByText(/触发事件 evt-stalled-002/)).toBeDefined();
  // 时间线升序两条事件，ID / 时间 / 来源齐备
  const timeline = screen.getByRole('list');
  expect(timeline.children).toHaveLength(2);
  expect(timeline.children[0]!.textContent).toContain('evt-stalled-001');
  expect(timeline.children[0]!.textContent).toContain('picked_up');
  expect(timeline.children[1]!.textContent).toContain('evt-stalled-002');

  // 刷新恢复：不经过队列，直接按详情 URL 载入，内容一致
  cleanup();
  renderAt('/cases/case-order-stalled-001-evt-stalled-002');
  expect(await screen.findByText('订单摘要')).toBeDefined();
  expect(screen.getByText('CNY 1299.00')).toBeDefined();
  expect(screen.getByRole('list').children).toHaveLength(2);
});

it('队列页 API 失败显示错误告警', async () => {
  fetchMock.mockImplementation(
    () => Promise.resolve(jsonResponse({ error: 'SERVICE_UNAVAILABLE', message: '案件存储未接线' }, 503)),
  );
  renderAt('/');
  expect((await screen.findByRole('alert')).textContent).toContain('案件存储未接线');
});

it('详情页 404 显示案件不存在并提供返回队列入口', async () => {
  fetchMock.mockImplementation(() =>
    Promise.resolve(jsonResponse({ error: 'NOT_FOUND', message: '案件不存在: case-x' }, 404)),
  );
  renderAt('/cases/case-x');

  expect((await screen.findByRole('alert')).textContent).toContain('案件不存在');
  expect(screen.getByRole('link', { name: '返回案件队列' })).toBeDefined();
});
