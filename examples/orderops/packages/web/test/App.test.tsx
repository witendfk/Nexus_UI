// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../src/App';
import type { CaseDetailPayload } from '../src/api/cases';

const ORDEROPS_CATALOG_ID = 'https://example.com/catalogs/orderops/v1';

function sseResponse(events: Array<{ event: string; data: unknown }>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      events.forEach((entry, index) => {
        controller.enqueue(
          encoder.encode(
            `event: ${entry.event}\nid: t:${index}\ndata: ${JSON.stringify(entry.data)}\n\n`,
          ),
        );
      });
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

const generateEvents = [
  {
    event: 'message',
    data: { version: 'v0.9', createSurface: { surfaceId: 'surface-test', catalogId: ORDEROPS_CATALOG_ID } },
  },
  {
    event: 'message',
    data: {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'surface-test',
        components: [
          { id: 'root', component: 'Column', children: ['case-title', 'note', 'ping'] },
          { id: 'case-title', component: 'Text', text: { path: '/title' }, variant: 'h3' },
          {
            id: 'note',
            component: 'TextField',
            label: { path: '/noteLabel' },
            value: { path: '/draft/note' },
            variant: 'longText',
          },
          { id: 'ping-label', component: 'Text', text: { path: '/pingLabel' } },
          {
            id: 'ping',
            component: 'Button',
            child: 'ping-label',
            action: { event: { name: 'ping', context: { note: { path: '/draft/note' } } } },
          },
        ],
      },
    },
  },
  {
    event: 'message',
    data: {
      version: 'v0.9',
      updateDataModel: {
        surfaceId: 'surface-test',
        value: { title: '穿刺玩具案件', noteLabel: '处理备注', pingLabel: 'Ping', draft: { note: '' } },
      },
    },
  },
  { event: 'done', data: {} },
];

const actionEvents = [
  {
    event: 'message',
    data: {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'surface-test',
        components: [
          {
            id: 'ping',
            component: 'Button',
            child: 'ping-label',
            disabled: true,
            action: { event: { name: 'ping', context: { note: { path: '/draft/note' } } } },
          },
        ],
      },
    },
  },
  { event: 'done', data: {} },
];

const DETAIL_PAYLOAD: CaseDetailPayload = {
  case: {
    id: 'case-1',
    orderId: 'order-1',
    type: 'logistics_stalled',
    severity: 'high',
    status: 'open',
    detectedAt: '2026-09-30T12:00:00.000Z',
    lastEventId: 'evt-2',
  },
  order: {
    id: 'order-1',
    customerId: 'cust-1',
    currency: 'CNY',
    amountMinor: 129_900,
    promisedAt: '2026-09-29T12:00:00.000Z',
    status: 'shipping',
  },
  events: [
    { id: 'evt-1', orderId: 'order-1', status: 'picked_up', occurredAt: '2026-09-26T12:00:00.000Z', source: 'carrier-api' },
    { id: 'evt-2', orderId: 'order-1', status: 'in_transit', occurredAt: '2026-09-27T12:00:00.000Z', source: 'carrier-api' },
  ],
};

function jsonResponse(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload } as unknown as Response;
}

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((input) => {
    const url = String(input);
    if (url.includes('/analyze')) return Promise.resolve(sseResponse(generateEvents));
    if (url.endsWith('/api/a2ui/event')) return Promise.resolve(sseResponse(actionEvents));
    if (url.includes('/api/cases/')) return Promise.resolve(jsonResponse(DETAIL_PAYLOAD));
    if (url.includes('/api/cases')) return Promise.resolve(jsonResponse({ cases: [] }));
    return Promise.reject(new Error(`意外的请求：${url}`));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('穿刺全链：详情页生成 → 渲染 → 编辑备注 → action 回流 → patch 禁用按钮', async () => {
  render(
    <MemoryRouter initialEntries={['/cases/case-1']}>
      <App />
    </MemoryRouter>,
  );
  expect(await screen.findByText('订单摘要')).toBeDefined();

  fireEvent.click(screen.getByRole('button', { name: '生成审核 surface' }));

  expect(await screen.findByText('穿刺玩具案件')).toBeDefined();
  const noteInput = screen.getByRole('textbox') as HTMLInputElement;
  fireEvent.change(noteInput, { target: { value: '穿刺时的最新备注' } });

  fireEvent.click(screen.getByRole('button', { name: 'Ping' }));

  await waitFor(() => {
    expect((screen.getByRole('button', { name: 'Ping' }) as HTMLButtonElement).disabled).toBe(true);
  });

  const eventCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/api/a2ui/event'));
  expect(eventCall).toBeDefined();
  const payload = JSON.parse(String(eventCall?.[1]?.body)) as {
    action: { name: string; surfaceId: string; timestamp: string; actionId: string; context: { note: string } };
  };
  expect(payload.action.name).toBe('ping');
  expect(payload.action.surfaceId).toBe('surface-test');
  expect(payload.action.timestamp).toBeTruthy();
  expect(payload.action.actionId).toBeTruthy();
  // 关键断言：context 带的是编辑后的最新备注，不是生成时的 dataModel 快照。
  expect(payload.action.context.note).toBe('穿刺时的最新备注');
});

it('生成请求网络失败时进入 error 态且按钮恢复可点', async () => {
  fetchMock.mockImplementation((input) => {
    const url = String(input);
    if (url.includes('/analyze')) return Promise.reject(new TypeError('Failed to fetch'));
    if (url.includes('/api/cases/')) return Promise.resolve(jsonResponse(DETAIL_PAYLOAD));
    return Promise.reject(new TypeError('Failed to fetch'));
  });
  render(
    <MemoryRouter initialEntries={['/cases/case-1']}>
      <App />
    </MemoryRouter>,
  );
  await screen.findByText('订单摘要');

  fireEvent.click(screen.getByRole('button', { name: '生成审核 surface' }));

  expect(await screen.findByRole('alert')).toBeDefined();
  const button = screen.getByRole('button', { name: '生成审核 surface' }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
});

/** T4.3 判据（docs/tasks/CURRENT.md）：断线/刷新后与 Host 状态一致，不盲目重发。 */

const actionErrorEvents = [
  {
    event: 'error',
    data: { code: 'AGENT_STREAM_ERROR', message: '连接中断，patch 未送达' },
  },
];

async function openCaseWithSurface(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/cases/case-1']}>
      <App />
    </MemoryRouter>,
  );
  await screen.findByText('订单摘要');
  fireEvent.click(screen.getByRole('button', { name: '生成审核 surface' }));
  await screen.findByText('穿刺玩具案件');
}

function postedActionIds(): string[] {
  return fetchMock.mock.calls
    .filter((call) => String(call[0]).endsWith('/api/a2ui/event'))
    .map((call) => (JSON.parse(String(call[1]?.body)) as { action: { actionId: string } }).action.actionId);
}

it('action 流失败但 Host 确认成功 → 展示工单号（D5 恢复），不重发业务动作', async () => {
  fetchMock.mockImplementation((input) => {
    const url = String(input);
    if (url.includes('/analyze')) return Promise.resolve(sseResponse(generateEvents));
    if (url.endsWith('/api/a2ui/event')) return Promise.resolve(sseResponse(actionErrorEvents));
    if (url.includes('/api/actions/')) {
      const actionId = decodeURIComponent(url.split('/api/actions/')[1] ?? '');
      return Promise.resolve(
        jsonResponse({
          actionId,
          operation: 'createTicket',
          caseId: 'case-1',
          status: 'succeeded',
          resultId: 'ticket-77',
          createdAt: '2026-09-30T12:00:00.000Z',
        }),
      );
    }
    if (url.includes('/api/cases/')) return Promise.resolve(jsonResponse(DETAIL_PAYLOAD));
    return Promise.reject(new Error(`意外的请求：${url}`));
  });
  await openCaseWithSurface();

  fireEvent.click(screen.getByRole('button', { name: 'Ping' }));
  const statusEl = await screen.findByRole('status');
  expect(statusEl.textContent).toContain('ticket-77');
  expect(statusEl.textContent).toContain('Host 确认');

  // 查询用的 actionId 与提交一致（按同一请求恢复）
  const [postedId] = postedActionIds();
  expect(fetchMock.mock.calls.some((call) => String(call[0]).includes(`/api/actions/${postedId}`))).toBe(true);

  // Host 已确认成功：再点击 surface 按钮也不得重发
  fireEvent.click(screen.getByRole('button', { name: 'Ping' }));
  expect(postedActionIds()).toHaveLength(1);
});

it('action 失败且查询不可用 → 结果未知：锁定重发并明确提示，而非误报失败', async () => {
  fetchMock.mockImplementation((input) => {
    const url = String(input);
    if (url.includes('/analyze')) return Promise.resolve(sseResponse(generateEvents));
    if (url.endsWith('/api/a2ui/event')) return Promise.resolve(sseResponse(actionErrorEvents));
    if (url.includes('/api/actions/')) return Promise.reject(new TypeError('network down'));
    if (url.includes('/api/cases/')) return Promise.resolve(jsonResponse(DETAIL_PAYLOAD));
    return Promise.reject(new Error(`意外的请求：${url}`));
  });
  await openCaseWithSurface();

  fireEvent.click(screen.getByRole('button', { name: 'Ping' }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('结果未知');
  expect(alert.textContent).toContain('勿重复提交');

  // 结果未知期间不得重发业务动作
  fireEvent.click(screen.getByRole('button', { name: 'Ping' }));
  expect(postedActionIds()).toHaveLength(1);
});

it('action 失败且 Host 无记录（404）→ 确认可重试', async () => {
  fetchMock.mockImplementation((input) => {
    const url = String(input);
    if (url.includes('/analyze')) return Promise.resolve(sseResponse(generateEvents));
    if (url.endsWith('/api/a2ui/event')) return Promise.resolve(sseResponse(actionErrorEvents));
    if (url.includes('/api/actions/')) return Promise.resolve({ ok: false, status: 404 } as unknown as Response);
    if (url.includes('/api/cases/')) return Promise.resolve(jsonResponse(DETAIL_PAYLOAD));
    return Promise.reject(new Error(`意外的请求：${url}`));
  });
  await openCaseWithSurface();

  fireEvent.click(screen.getByRole('button', { name: 'Ping' }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('连接中断，patch 未送达');
  expect(alert.textContent).not.toContain('结果未知');
});

it('刷新恢复：ticket_created 案件不再提供分析入口，也不发起 analyze 请求', async () => {
  fetchMock.mockImplementation((input) => {
    const url = String(input);
    if (url.includes('/api/cases/')) {
      return Promise.resolve(
        jsonResponse({ ...DETAIL_PAYLOAD, case: { ...DETAIL_PAYLOAD.case, status: 'ticket_created' } }),
      );
    }
    if (url.includes('/analyze')) return Promise.reject(new Error('终态案件不得发起分析'));
    if (url.includes('/api/cases')) return Promise.resolve(jsonResponse({ cases: [] }));
    return Promise.reject(new Error(`意外的请求：${url}`));
  });
  render(
    <MemoryRouter initialEntries={['/cases/case-1']}>
      <App />
    </MemoryRouter>,
  );

  expect(await screen.findByText(/已关闭分析入口/)).toBeDefined();
  expect(screen.queryByRole('button', { name: '生成审核 surface' })).toBeNull();
  expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes('/analyze'))).toHaveLength(0);
});
