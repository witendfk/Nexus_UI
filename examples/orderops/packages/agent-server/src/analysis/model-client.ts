/**
 * OpenAI 兼容 chat/completions 客户端（T3.4 真实模型模式）。
 * CI 不依赖本模块（deterministic 默认）；真实模型按 SPEC §3 单独冒烟。
 * 响应体有字节上限（与宿主→agent 方向的 2MB 对齐），模型异常输出不得拖垮内存。
 */

export class ModelError extends Error {}

export interface ModelClientConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** 响应体字节上限；缺省 2MB（对齐宿主外部 RPC 上限）。 */
  maxBytes?: number;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  error?: { message?: unknown };
}

const DEFAULT_MAX_BYTES = 2_000_000;

export class ModelClient {
  private readonly maxBytes: number;

  constructor(
    private readonly config: ModelClientConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  /** 有界读取响应体；超限取消读取并抛 ModelError。 */
  private async readBodyCapped(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (reader === undefined) return '';
    const decoder = new TextDecoder();
    let received = 0;
    let text = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > this.maxBytes) {
          throw new ModelError(`模型响应超过 ${this.maxBytes} 字节上限`);
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      return text;
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }

  /** 返回模型文本输出；HTTP/结构/超限失败抛 ModelError（由引擎决定重试或失败）。 */
  async complete(systemPrompt: string, userContent: string): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw new ModelError(`模型请求失败：${error instanceof Error ? error.message : String(error)}`);
    }
    const bodyText = await this.readBodyCapped(response);
    if (!response.ok) {
      const detail = parseJsonOrNull(bodyText) as ChatCompletionResponse | null;
      const message = typeof detail?.error?.message === 'string' ? detail.error.message : '';
      throw new ModelError(`模型 HTTP ${response.status}${message === '' ? '' : `：${message}`}`);
    }
    const body = parseJsonOrNull(bodyText) as ChatCompletionResponse | null;
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new ModelError('模型响应缺少 choices[0].message.content 文本');
    }
    return content;
  }
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
