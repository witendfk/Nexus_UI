import type { ActionEvent, A2UIRuntime } from '@nexus-ui/core';

export interface StreamOutcome {
  ok: boolean;
  error?: string;
}

interface SseBlock {
  event: string;
  data: unknown;
}

/** 解析一个 SSE 块（event/id/data 三行，data 为单条 A2UI 消息）。 */
function parseBlock(block: string): SseBlock | undefined {
  const event = /^event: (.+)$/m.exec(block)?.[1];
  const dataLine = /^data: (.+)$/m.exec(block)?.[1];
  if (dataLine === undefined) return undefined;
  return { event: event ?? 'message', data: JSON.parse(dataLine) };
}

/** 把 Host 的 SSE 流逐条喂给 runtime；`done` 前禁用业务 action 由消费方保证。 */
export async function streamIntoRuntime(
  response: Response,
  runtime: A2UIRuntime,
): Promise<StreamOutcome> {
  if (!response.ok || !response.body) {
    return { ok: false, error: `请求失败：HTTP ${response.status}` };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let outcome: StreamOutcome = { ok: true };
  // 收到 done/error 事件才算流正常收尾；连接提前断开不得误报成功。
  let settled = false;

  const handleBlock = (block: string): void => {
    const parsed = parseBlock(block);
    if (!parsed) return;
    if (parsed.event === 'message') {
      runtime.push(`${JSON.stringify(parsed.data)}\n`);
    } else if (parsed.event === 'done') {
      settled = true;
    } else if (parsed.event === 'error') {
      const message = (parsed.data as { message?: string } | undefined)?.message;
      outcome = { ok: false, error: message ?? 'Agent 流式输出失败' };
      settled = true;
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        handleBlock(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
      }
    }
  } catch (error) {
    outcome = {
      ok: false,
      error: `连接中断：${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    // 无论哪种收尾都冲刷 runtime 缓冲（end 幂等且无终结态）。
    runtime.end();
    // 读完但没收到 done/error 事件 = 连接提前断开，不得误报成功。
    if (!settled && outcome.ok) {
      outcome = { ok: false, error: '连接中断：生成流未正常结束' };
    }
  }
  return outcome;
}

/** 网络层失败（断网、Host 不可达）与 SSE error 事件统一收敛为 StreamOutcome，调用方永不面对 rejection。 */
function toNetworkErrorOutcome(error: unknown): StreamOutcome {
  const message = error instanceof Error && error.message ? error.message : '网络请求失败';
  return { ok: false, error: `网络错误：${message}` };
}

export async function analyzeCase(
  runtime: A2UIRuntime,
  caseId: string,
): Promise<StreamOutcome> {
  try {
    const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/analyze`, {
      method: 'POST',
    });
    return await streamIntoRuntime(response, runtime);
  } catch (error) {
    return toNetworkErrorOutcome(error);
  }
}

function newActionId(): string {
  return crypto.randomUUID();
}

/** action 回流：core 不生成 timestamp/actionId，由 transport 补齐后 POST 给 Host。 */
export async function dispatchAction(
  runtime: A2UIRuntime,
  event: ActionEvent,
): Promise<StreamOutcome> {
  try {
    const response = await fetch('/api/a2ui/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 'v0.9',
        action: {
          ...event,
          timestamp: new Date().toISOString(),
          actionId: newActionId(),
        },
      }),
    });
    return await streamIntoRuntime(response, runtime);
  } catch (error) {
    return toNetworkErrorOutcome(error);
  }
}
