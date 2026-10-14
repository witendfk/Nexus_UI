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
  /** 客户端（宿主）是否在响应前断开了连接（取消传播观测点）。 */
  get sawClientClose(): boolean;
}

export interface StubAgentOptions {
  status?: number;
  errorBody?: Record<string, unknown>;
  /** T4.4 样本：组件表注入 Catalog 未声明组件，host guard 应拒绝整条流。 */
  illegalSurface?: boolean;
  /** S1 样本：NDJSON 超过宿主外部 RPC 2MB 上限 → SSE error。 */
  oversized?: boolean;
  /** S1 取消传播样本：延迟响应，供客户端在生成期间中断。 */
  delayMs?: number;
}

function surfaceNdjson(surfaceId: string, options: StubAgentOptions | undefined): string {
  // V1：与编译器同形的分阶段 surface（createSurface 后多次交错 components/data）
  const lines: Array<Record<string, unknown>> = [
    { version: 'v0.9', createSurface: { surfaceId, catalogId: ORDEROPS_CATALOG.catalogId } },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Column', children: ['case-title', 'ticket-result', 'note', 'submit-ticket-label', 'submit-ticket'] },
          { id: 'case-title', component: 'Text', text: { path: '/title' }, variant: 'h3' },
        ],
      },
    },
    { version: 'v0.9', updateDataModel: { surfaceId, path: '/title', value: '物流异常分析：案件 stub' } },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          { id: 'ticket-result', component: 'Text', text: { path: '/result/ticketText' }, variant: 'body' },
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
          noteLabel: '处理备注',
          submitButtonLabel: '确认建单',
          result: { ticketText: '确认后此处显示工单号。' },
          draft: { note: '' },
        },
      },
    },
  ];
  if (options?.illegalSurface === true) {
    // Catalog v1 未声明的组件：host guard 应在流内拒绝整条生成。
    lines[1]!.updateComponents = {
      surfaceId,
      components: [
        ...(lines[1]!.updateComponents as { components: Array<Record<string, unknown>> }).components,
        { id: 'evil-chart', component: 'NotInCatalog', rows: [] },
      ],
    };
  }
  if (options?.oversized === true) {
    // 单条消息 ~2.1MB：超过宿主外部 RPC 的 2MB 响应上限。
    lines[1]!.updateComponents = {
      surfaceId,
      components: [
        ...(lines[1]!.updateComponents as { components: Array<Record<string, unknown>> }).components,
        { id: 'big', component: 'Text', text: 'x'.repeat(2_100_000) },
      ],
    };
  }
  return lines.map((line) => JSON.stringify(line)).join('\n');
}

export function stubAgentServer(options?: StubAgentOptions): Promise<StubAgent> {
  const state: { lastRequest: Record<string, unknown> | undefined; sawClose: boolean } = {
    lastRequest: undefined,
    sawClose: false,
  };
  const server: Server = createServer((req, res) => {
    req.on('close', () => {
      if (!res.writableEnded) state.sawClose = true;
    });
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      state.lastRequest = body === '' ? undefined : (JSON.parse(body) as Record<string, unknown>);
      const respond = (): void => {
        const status = options?.status ?? 200;
        if (status !== 200) {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(options?.errorBody ?? { error: { message: 'stub agent 失败' } }));
          return;
        }
        const surfaceId = String((state.lastRequest as { surfaceId?: string }).surfaceId);
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.end(surfaceNdjson(surfaceId, options));
      };
      if (options?.delayMs !== undefined) {
        // 生成期悬停：客户端此时中断 → 观测 sawClose
        setTimeout(respond, options.delayMs);
        return;
      }
      respond();
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
        get sawClientClose() {
          return state.sawClose;
        },
      });
    });
  });
}
