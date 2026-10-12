import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ORDEROPS_CATALOG } from '../../src/nexus/catalog';

/**
 * Agent `/rpc` 替身（T3.6 集成测试用）：echo 请求里的 surfaceId，返回一条
 * 与编译器输出同形的受控 surface（guard 可过）。仅测试 wire 层，不是第二实现。
 */

export interface StubAgent {
  url: string;
  close: () => void;
  /** 最近一次收到的 generate 请求体。 */
  lastRequest: Record<string, unknown> | undefined;
}

export function stubAgentServer(options?: {
  status?: number;
  errorBody?: Record<string, unknown>;
}): Promise<StubAgent> {
  const state: { lastRequest: Record<string, unknown> | undefined } = { lastRequest: undefined };
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      state.lastRequest = body === '' ? undefined : (JSON.parse(body) as Record<string, unknown>);
      const status = options?.status ?? 200;
      if (status !== 200) {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(options?.errorBody ?? { error: { message: 'stub agent 失败' } }));
        return;
      }
      const surfaceId = String((state.lastRequest as { surfaceId?: string }).surfaceId);
      const lines = [
        { version: 'v0.9', createSurface: { surfaceId, catalogId: ORDEROPS_CATALOG.catalogId } },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId,
            components: [
              {
                id: 'root',
                component: 'Column',
                children: ['case-title', 'note', 'submit-ticket-label', 'submit-ticket'],
              },
              { id: 'case-title', component: 'Text', text: { path: '/title' }, variant: 'h3' },
              {
                id: 'note',
                component: 'TextField',
                label: { path: '/noteLabel' },
                value: { path: '/draft/note' },
                variant: 'longText',
              },
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
              title: '物流异常分析：案件 stub',
              noteLabel: '处理备注',
              submitButtonLabel: '确认建单',
              draft: { note: '' },
            },
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join('\n');
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.end(`${lines}\n`);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/rpc`,
        close: () => server.close(),
        get lastRequest() {
          return state.lastRequest;
        },
      });
    });
  });
}
