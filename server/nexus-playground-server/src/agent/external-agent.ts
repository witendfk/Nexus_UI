import { JSONLBuffer } from '@nexus-ui/core';
import type {
  AgentAction,
  AgentActionContext,
  AgentActionHandler,
  AgentGenerationSource,
  AgentMessageSource,
} from './adapter';
import type { AgentTurn } from './llm-agent';

export interface ExternalAgentRpcConfig {
  endpoint: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  fetch?: typeof fetch;
}

interface ExternalAgentCatalogContract {
  catalogId: string;
  supportedComponents: readonly string[];
  supportedActions: readonly string[];
}

type ExternalAgentRpcRequest =
  | ({
      version: 1;
      kind: 'generate';
      surfaceId: string;
      message: string;
      history: readonly AgentTurn[];
    } & ExternalAgentCatalogContract)
  | ({
      version: 1;
      kind: 'action';
      surfaceId: string;
      action: AgentAction;
      history: readonly AgentTurn[];
    } & ExternalAgentCatalogContract);

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 2_000_000;

function validatePositiveNumber(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} 必须是正数`);
  }
}

function validateEndpoint(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('外部 Agent endpoint 必须是合法 URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('外部 Agent endpoint 只支持 http/https');
  }
}

function isNdjsonContentType(contentType: string | null): boolean {
  return /^application\/(?:x-ndjson|jsonl)(?:;|$)/i.test(contentType ?? '');
}

function parseJsonlLine(line: string): unknown {
  if (line.trim() === '') return undefined;
  try {
    return JSON.parse(line);
  } catch {
    throw new Error('外部 Agent 返回的 JSONL 中包含非法 JSON');
  }
}

async function readRemoteError(response: Response): Promise<string> {
  let body = '';
  try {
    body = (await response.text()).trim();
  } catch {
    body = '';
  }
  if (!body) return '外部 Agent 返回空错误体';

  try {
    const value = JSON.parse(body) as unknown;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const error = (value as { error?: unknown }).error;
      if (typeof error === 'object' && error !== null && !Array.isArray(error)) {
        const message = (error as { message?: unknown }).message;
        if (typeof message === 'string' && message.trim()) return message;
      }
      const message = (value as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
  } catch {
    // Fall through and return a bounded raw body.
  }
  return body.slice(0, 200);
}

function createRequestHeaders(config: ExternalAgentRpcConfig): Record<string, string> {
  return {
    ...config.headers,
    'Content-Type': 'application/json',
    Accept: 'application/x-ndjson',
  };
}

async function* streamExternalAgentMessages(
  config: ExternalAgentRpcConfig,
  request: ExternalAgentRpcRequest,
): AsyncGenerator<unknown> {
  validateEndpoint(config.endpoint);
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES;
  validatePositiveNumber('timeoutMs', timeoutMs);
  validatePositiveNumber('maxBytes', maxBytes);

  const fetchImpl = config.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let messageCount = 0;

  try {
    const response = await fetchImpl(config.endpoint, {
      method: 'POST',
      headers: createRequestHeaders(config),
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`外部 Agent RPC 失败: ${await readRemoteError(response)}`);
    }
    if (!isNdjsonContentType(response.headers.get('content-type'))) {
      throw new Error('外部 Agent 必须返回 application/x-ndjson');
    }
    if (!response.body) {
      throw new Error('外部 Agent 未返回响应体');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const buffer = new JSONLBuffer();
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        throw new Error(`外部 Agent 响应超过 ${maxBytes} 字节上限`);
      }

      for (const line of buffer.push(decoder.decode(value, { stream: true }))) {
        const message = parseJsonlLine(line);
        if (message === undefined) continue;
        messageCount += 1;
        yield message;
      }
    }

    for (const line of buffer.flush()) {
      const message = parseJsonlLine(line);
      if (message === undefined) continue;
      messageCount += 1;
      yield message;
    }

    if (messageCount === 0) throw new Error('外部 Agent 未返回 A2UI 消息');
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`外部 Agent RPC 超过 ${timeoutMs}ms 未完成`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export function createExternalAgentGenerationSource(
  config: ExternalAgentRpcConfig,
): AgentGenerationSource {
  return (request) =>
    streamExternalAgentMessages(config, {
      version: 1,
      kind: 'generate',
      surfaceId: request.surfaceId,
      message: request.message,
      history: request.history,
      catalogId: request.catalogId,
      supportedComponents: request.supportedComponents,
      supportedActions: request.supportedActions,
    });
}

export function createExternalAgentActionHandler(
  config: ExternalAgentRpcConfig,
): AgentActionHandler {
  return async (action: AgentAction, context: AgentActionContext): Promise<AgentMessageSource> =>
    streamExternalAgentMessages(config, {
      version: 1,
      kind: 'action',
      surfaceId: action.surfaceId,
      action,
      history: context.history,
      catalogId: context.catalogId,
      supportedComponents: context.catalog.components,
      supportedActions: context.supportedActions,
    });
}
