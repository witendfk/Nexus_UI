// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/App';

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

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((input) => {
    const url = String(input);
    if (url.includes('/analyze')) return Promise.resolve(sseResponse(generateEvents));
    if (url.endsWith('/api/a2ui/event')) return Promise.resolve(sseResponse(actionEvents));
    return Promise.reject(new Error(`意外的请求：${url}`));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('穿刺全链：生成 → 渲染 → 编辑备注 → action 回流 → patch 禁用按钮', async () => {
  render(<App />);

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
  fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
  render(<App />);

  fireEvent.click(screen.getByRole('button', { name: '生成审核 surface' }));

  expect(await screen.findByRole('alert')).toBeDefined();
  const button = screen.getByRole('button', { name: '生成审核 surface' }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
});
