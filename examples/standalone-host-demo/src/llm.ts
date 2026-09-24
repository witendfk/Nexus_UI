import { createCatalogPromptContract, JSONLBuffer } from '@nexus-ui/core';
import { standaloneHostCatalog } from './shared/catalog-contract';

export interface DemoLlmAction {
  name: string;
  context?: Record<string, unknown>;
}

export type DemoLlmRequest =
  | { kind: 'generate'; surfaceId: string; message: string }
  | { kind: 'action'; surfaceId: string; action: DemoLlmAction };

export const DEMO_SYSTEM_PROMPT = `${createCatalogPromptContract(standaloneHostCatalog)}

# Standalone Host Demo Rules

Generation components must use ids root, approve, and approveLabel:
- root is ApprovalSummary with title bound to /title, amount bound to /amount, and children ["approve"].
- approve is Button with child "approveLabel" and an action.event named "approve".
- approveLabel is Text with a concise approval label.
Infer a useful approval title and amount from the user request. If no amount is stated, use "USD 12,000".
Set /approvalId to "approval-demo-001". Bind /approvalId and /amount in the approve action context.

For an action response, return only updateComponents then updateDataModel for the same surfaceId:
- root remains ApprovalSummary with title bound to /title, amount bound to /amount, and children ["approve"].
- approve remains Button with child "approveLabel" and disabled set to true; omit its action.
- approveLabel becomes Text with text "Approved".
- Set /title to "Approved: " plus action.context.approvalId when available.
- Preserve action.context.amount as /amount.
Never emit comments, fences, HTML, React code, or extra fields.`;

function createUserPrompt(request: DemoLlmRequest): string {
  if (request.kind === 'generate') {
    return `Create the initial approval surface.\nsurfaceId: ${request.surfaceId}\nrequest: ${request.message}`;
  }
  return `Update the existing approval surface after the user action.\nsurfaceId: ${request.surfaceId}\naction: ${JSON.stringify(
    request.action,
  )}`;
}

const GENERATION_EXAMPLE = `{"version":"v0.9","createSurface":{"surfaceId":"example-surface","catalogId":"https://example.com/catalogs/host-approval/v1"}}
{"version":"v0.9","updateComponents":{"surfaceId":"example-surface","components":[{"id":"root","component":"ApprovalSummary","title":{"path":"/title"},"amount":{"path":"/amount"},"children":["approve"]},{"id":"approve","component":"Button","child":"approveLabel","action":{"event":{"name":"approve","context":{"approvalId":{"path":"/approvalId"},"amount":{"path":"/amount"}}}}},{"id":"approveLabel","component":"Text","text":"Approve"}]}}
{"version":"v0.9","updateDataModel":{"surfaceId":"example-surface","value":{"title":"Approval requested: marketing campaign","amount":"USD 12,000","approvalId":"approval-demo-001"}}}`;

const ACTION_EXAMPLE = `{"version":"v0.9","updateComponents":{"surfaceId":"example-surface","components":[{"id":"root","component":"ApprovalSummary","title":{"path":"/title"},"amount":{"path":"/amount"},"children":["approve"]},{"id":"approve","component":"Button","child":"approveLabel","disabled":true},{"id":"approveLabel","component":"Text","text":"Approved"}]}}
{"version":"v0.9","updateDataModel":{"surfaceId":"example-surface","value":{"title":"Approved: approval-demo-001","amount":"USD 12,000"}}}`;

function requireLlmConfig(): { apiKey: string; baseUrl?: string; model: string } {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

  return {
    apiKey,
    baseUrl: process.env.OPENAI_BASE_URL?.replace(/\/+$/, ''),
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  };
}

async function readApiError(response: Response): Promise<string> {
  let body = '';
  try {
    body = (await response.text()).trim();
  } catch {
    body = '';
  }
  if (!body) return `HTTP ${response.status}`;

  try {
    const value = JSON.parse(body) as { error?: { message?: unknown }; message?: unknown };
    const message = value.error?.message ?? value.message;
    if (typeof message === 'string' && message.trim()) return message;
  } catch {
    // Return a bounded raw body below.
  }
  return body.slice(0, 200);
}

/** Stream OpenAI-compatible text deltas and expose complete candidate A2UI JSON objects. */
export async function* streamDemoLlmMessages(
  request: DemoLlmRequest,
  signal?: AbortSignal,
): AsyncGenerator<unknown> {
  const config = requireLlmConfig();
  const response = await fetch(
    `${config.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`,
    {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: DEMO_SYSTEM_PROMPT },
          { role: 'user', content: 'Return the required NDJSON format for an initial generation.' },
          { role: 'assistant', content: GENERATION_EXAMPLE },
          { role: 'user', content: 'Return the required NDJSON format for an action response.' },
          { role: 'assistant', content: ACTION_EXAMPLE },
          { role: 'user', content: createUserPrompt(request) },
        ],
        temperature: 0,
        stream: true,
      }),
    },
  );

  if (!response.ok || !response.body) throw new Error(await readApiError(response));

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const jsonLines = new JSONLBuffer();
  let sseBuffer = '';
  let streamDone = false;

  const consumeSseLine = function* (rawLine: string): Generator<unknown> {
    if (!rawLine.startsWith('data:')) return;
    const data = rawLine.slice(5).trim();
    if (!data || data === '[DONE]') return;

    const chunk = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string } }>;
    };
    const content = chunk.choices?.[0]?.delta?.content;
    if (!content) return;
    for (const line of jsonLines.push(content)) yield JSON.parse(line);
  };

  while (!streamDone) {
    const { done, value } = await reader.read();
    if (done) {
      streamDone = true;
      continue;
    }

    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split(/\r\n|\n|\r/);
    sseBuffer = lines.pop() ?? '';
    for (const line of lines) yield* consumeSseLine(line);
  }

  sseBuffer += decoder.decode();
  for (const line of sseBuffer.split(/\r\n|\n|\r/)) yield* consumeSseLine(line);
  for (const line of jsonLines.flush()) yield JSON.parse(line);
}
