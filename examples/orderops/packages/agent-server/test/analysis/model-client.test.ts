import { describe, expect, it } from 'vitest';
import { ModelClient, ModelError } from '../../src/analysis/model-client';
import { chatCompletion } from '../fixtures/snapshot';

/** 评审修正（P2）：模型响应有字节上限（与宿主→agent 方向对齐），异常输出不得拖垮内存。 */

const CONFIG = { baseUrl: 'http://model.test/v1', apiKey: 'k', model: 'm', timeoutMs: 5_000, maxBytes: 64 };

function modelWithBody(body: unknown): ModelClient {
  return new ModelClient(CONFIG, () =>
    Promise.resolve(new Response(body as never, { status: 200 })),
  );
}

describe('ModelClient 响应上限', () => {
  it('响应超过 maxBytes → ModelError，且错误先于 JSON 解析', async () => {
    const big = 'x'.repeat(200);
    const model = modelWithBody(
      new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode('{"choices":[{"message":{"content":"'));
          controller.enqueue(encoder.encode(big));
        },
      }),
    );
    await expect(model.complete('s', 'u')).rejects.toThrow('字节上限');
    await expect(model.complete('s', 'u')).rejects.toBeInstanceOf(ModelError);
  });

  it('上限内正常解析 content', async () => {
    const model = modelWithBody(JSON.stringify(chatCompletion('分析结果')));
    expect(await model.complete('s', 'u')).toBe('分析结果');
  });

  it('HTTP 错误体同样受上限保护，错误信息透出 error.message', async () => {
    const model = new ModelClient(CONFIG, () =>
      Promise.resolve(new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 429 })),
    );
    await expect(model.complete('s', 'u')).rejects.toThrow('quota exceeded');
  });
});
