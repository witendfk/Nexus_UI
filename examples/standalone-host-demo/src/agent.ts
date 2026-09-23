import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { DEMO_AGENT_ACTION, DEMO_AGENT_CATALOG_ID } from './contract';
import { streamDemoLlmMessages } from './llm';
import type { DemoLlmRequest } from './llm';

export type DemoAgentMode = 'llm' | 'deterministic';

interface DemoAgentRequest {
  version?: unknown;
  kind?: unknown;
  surfaceId?: unknown;
  message?: unknown;
  action?: {
    name?: unknown;
    context?: Record<string, unknown>;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function writeJsonLine(response: ServerResponse, value: unknown): void {
  response.write(`${JSON.stringify(value)}\n`);
}

function writeGeneration(response: ServerResponse, surfaceId: string, message: string): void {
  writeJsonLine(response, {
    version: 'v0.9',
    createSurface: { surfaceId, catalogId: DEMO_AGENT_CATALOG_ID },
  });
  writeJsonLine(response, {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [
        {
          id: 'root',
          component: 'ApprovalSummary',
          title: { path: '/title' },
          amount: { path: '/amount' },
          children: ['approve'],
        },
        {
          id: 'approve',
          component: 'Button',
          child: 'approveLabel',
          action: {
            event: {
              name: DEMO_AGENT_ACTION,
              context: {
                approvalId: { path: '/approvalId' },
                amount: { path: '/amount' },
              },
            },
          },
        },
        { id: 'approveLabel', component: 'Text', text: 'Approve' },
      ],
    },
  });
  writeJsonLine(response, {
    version: 'v0.9',
    updateDataModel: {
      surfaceId,
      value: {
        title: `Approval requested: ${message}`,
        amount: 'USD 12,000',
        approvalId: 'approval-demo-001',
      },
    },
  });
}

function writeApproval(response: ServerResponse, surfaceId: string): void {
  writeJsonLine(response, {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [
        {
          id: 'root',
          component: 'ApprovalSummary',
          title: { path: '/title' },
          amount: { path: '/amount' },
          children: ['approve'],
        },
        { id: 'approve', component: 'Button', child: 'approveLabel', disabled: true },
        { id: 'approveLabel', component: 'Text', text: 'Approved' },
      ],
    },
  });
  writeJsonLine(response, {
    version: 'v0.9',
    updateDataModel: {
      surfaceId,
      value: { title: 'Approved: approval-demo-001', amount: 'USD 12,000' },
    },
  });
}

function invalidJson(response: ServerResponse, statusCode: number, message: string): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ error: { message } }));
}

async function readRequest(request: IncomingMessage): Promise<unknown> {
  let body = '';
  request.setEncoding('utf8');
  for await (const chunk of request) body += chunk;
  return JSON.parse(body);
}

async function writeLlmResponse(
  response: ServerResponse,
  request: DemoLlmRequest,
  incomingRequest: IncomingMessage,
): Promise<void> {
  const controller = new AbortController();
  const close = (): void => controller.abort();
  incomingRequest.once('close', close);

  try {
    const messages = streamDemoLlmMessages(request, controller.signal);
    const first = await messages.next();
    if (first.done) throw new Error('LLM 未返回 A2UI 消息');

    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/x-ndjson');
    writeJsonLine(response, first.value);
    for await (const message of messages) writeJsonLine(response, message);
    response.end();
  } finally {
    incomingRequest.off('close', close);
    controller.abort();
  }
}

/** An external business Agent implementing the Nexus JSONL RPC contract. */
export function createDemoAgentServer(options?: { mode?: DemoAgentMode }): Server {
  const mode = options?.mode ?? 'llm';

  return createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          status: 'ok',
          agent: 'standalone-demo',
          agentMode: mode,
          llmConfigured: mode === 'llm' ? Boolean(process.env.OPENAI_API_KEY) : undefined,
        }),
      );
      return;
    }

    if (request.method !== 'POST' || request.url !== '/agent') {
      response.statusCode = 404;
      response.end();
      return;
    }

    try {
      const body = await readRequest(request);
      if (!isRecord(body)) {
        invalidJson(response, 400, '请求体必须是 JSON 对象');
        return;
      }

      const rpc = body as DemoAgentRequest;
      if (rpc.version !== 1 || (rpc.kind !== 'generate' && rpc.kind !== 'action')) {
        invalidJson(response, 400, '不支持的 JSONL RPC 契约');
        return;
      }
      if (typeof rpc.surfaceId !== 'string' || rpc.surfaceId === '') {
        invalidJson(response, 400, 'surfaceId 必须是非空字符串');
        return;
      }

      if (mode === 'llm') {
        if (rpc.kind === 'action' && rpc.action?.name !== DEMO_AGENT_ACTION) {
          invalidJson(response, 400, `Demo Agent 只支持 ${DEMO_AGENT_ACTION} action`);
          return;
        }
        await writeLlmResponse(
          response,
          rpc.kind === 'generate'
            ? {
                kind: 'generate',
                surfaceId: rpc.surfaceId,
                message:
                  typeof rpc.message === 'string' && rpc.message.trim()
                    ? rpc.message
                    : 'marketing campaign approval',
              }
            : {
                kind: 'action',
                surfaceId: rpc.surfaceId,
                action: {
                  name: String(rpc.action?.name ?? ''),
                  context: rpc.action?.context,
                },
              },
          request,
        );
      } else {
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/x-ndjson');
        if (rpc.kind === 'generate') {
          const message =
            typeof rpc.message === 'string' && rpc.message.trim()
              ? rpc.message
              : 'marketing campaign approval';
          writeGeneration(response, rpc.surfaceId, message);
        } else {
          writeApproval(response, rpc.surfaceId);
        }
        response.end();
      }
    } catch {
      if (!response.headersSent) {
        invalidJson(response, 503, 'Demo Agent LLM 请求失败');
        return;
      }
      response.end();
    }
  });
}
