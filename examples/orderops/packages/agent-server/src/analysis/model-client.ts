/**
 * OpenAI 兼容 chat/completions 客户端（T3.4 真实模型模式）。
 * CI 不依赖本模块（deterministic 默认）；真实模型按 SPEC §3 单独冒烟。
 */

export class ModelError extends Error {}

export interface ModelClientConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  error?: { message?: unknown };
}

export class ModelClient {
  constructor(
    private readonly config: ModelClientConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** 返回模型文本输出；HTTP/结构失败抛 ModelError（由引擎决定重试或失败）。 */
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
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as ChatCompletionResponse | null;
      const message = typeof detail?.error?.message === 'string' ? detail.error.message : '';
      throw new ModelError(`模型 HTTP ${response.status}${message === '' ? '' : `：${message}`}`);
    }
    const body = (await response.json().catch(() => null)) as ChatCompletionResponse | null;
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new ModelError('模型响应缺少 choices[0].message.content 文本');
    }
    return content;
  }
}
