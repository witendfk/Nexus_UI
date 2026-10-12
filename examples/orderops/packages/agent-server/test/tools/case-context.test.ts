import { describe, expect, it, vi } from 'vitest';
import { CaseContextClient, CaseContextError } from '../../src/tools/case-context';
import { INTERNAL_TOKEN, stalledContext } from '../fixtures/snapshot';

/** T3.4 前置：只读工具客户端 fail-closed 与错误映射。 */

function client(token: string, fetchImpl: typeof fetch): CaseContextClient {
  return new CaseContextClient({ hostBaseUrl: 'http://127.0.0.1:3201', internalToken: token, fetchImpl });
}

function jsonResponse(body: unknown, status = 200): typeof fetch {
  return vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  ) as unknown as typeof fetch;
}

describe('CaseContextClient', () => {
  it('携带 Bearer token 请求正确 URL，200 且出口过 contracts schema', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(stalledContext()), { status: 200 })),
    ) as unknown as typeof fetch;
    const context = await client(INTERNAL_TOKEN, fetchImpl).get('case-1');
    expect(context.caseId).toBe('case-order-stalled-001-evt-stalled-002');
    const call = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('http://127.0.0.1:3201/internal/cases/case-1/context');
    expect((call[1].headers as Record<string, string>).authorization).toBe(`Bearer ${INTERNAL_TOKEN}`);
  });

  it('token 未配置 → fail-closed 拒绝，fetch 完全不被调用', async () => {
    const fetchImpl = vi.fn();
    await expect(client('', fetchImpl as unknown as typeof fetch).get('case-1')).rejects.toThrow(
      'fail-closed',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('401 / 404 / 500 → 对应 kind 的 CaseContextError', async () => {
    await expect(client(INTERNAL_TOKEN, jsonResponse({}, 401)).get('c')).rejects.toMatchObject({
      kind: 'unauthorized',
    });
    await expect(client(INTERNAL_TOKEN, jsonResponse({}, 404)).get('c')).rejects.toMatchObject({
      kind: 'not-found',
    });
    await expect(client(INTERNAL_TOKEN, jsonResponse({}, 500)).get('c')).rejects.toMatchObject({
      kind: 'host-error',
    });
  });

  it('响应结构漂移 → invalid-response（出口即契约）', async () => {
    await expect(
      client(INTERNAL_TOKEN, jsonResponse({ contractVersion: 1 })).get('c'),
    ).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('错误类型可判别（instanceof）', async () => {
    const error = await client('', vi.fn() as unknown as typeof fetch)
      .get('c')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CaseContextError);
  });
});
