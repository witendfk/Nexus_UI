import { describe, expect, it, vi } from 'vitest';
import { CatalogContractClient, CatalogContractError } from '../../src/catalog-contract/client';

const CONTRACT = {
  serverApiVersion: 1,
  kind: 'catalog-contract',
  contractVersion: 1,
  contractHash: 'sha256:abc',
  catalog: { catalogId: 'https://example.com/catalogs/orderops/v1', components: ['Text'] },
  promptContract: 'PROMPT',
};

function jsonResponse(payload: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => payload } as unknown as Response;
}

const REFERENCE = { version: 1, hash: 'sha256:abc', url: 'https://host.example/contract' };

describe('CatalogContractClient', () => {
  it('拉取成功并校验结构；同 hash 二次调用命中缓存（fetch 只发生一次）', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(CONTRACT)));
    const client = new CatalogContractClient({ fetchImpl });

    const first = await client.get(REFERENCE, 'cat-1');
    expect(first.promptContract).toBe('PROMPT');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const second = await client.get(REFERENCE, 'cat-1');
    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('hash 变化时重新拉取并替换缓存', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(CONTRACT)));
    const client = new CatalogContractClient({ fetchImpl });
    await client.get(REFERENCE, 'cat-1');

    const updated = { ...CONTRACT, contractHash: 'sha256:new' };
    fetchImpl.mockImplementation(() => Promise.resolve(jsonResponse(updated)));
    const refreshed = await client.get({ version: 1, hash: 'sha256:new', url: REFERENCE.url }, 'cat-1');
    expect(refreshed.contractHash).toBe('sha256:new');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('端点返回的 hash 与引用不一致 → 显式报错', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({ ...CONTRACT, contractHash: 'sha256:other' })),
    );
    const client = new CatalogContractClient({ fetchImpl });
    await expect(client.get(REFERENCE, 'cat-1')).rejects.toThrow(CatalogContractError);
    await expect(client.get(REFERENCE, 'cat-1')).rejects.toThrow('hash 不一致');
  });

  it('非 2xx / 结构非法 → CatalogContractError', async () => {
    const failing = new CatalogContractClient({
      fetchImpl: () => Promise.resolve(jsonResponse({ error: 'x' }, 404)),
    });
    await expect(failing.get(REFERENCE, 'cat-1')).rejects.toThrow('HTTP 404');

    const malformed = new CatalogContractClient({
      fetchImpl: () => Promise.resolve(jsonResponse({ kind: 'other' })),
    });
    await expect(malformed.get(REFERENCE, 'cat-1')).rejects.toThrow('结构非法');
  });

  it('引用未携带 url 且未配置宿主地址 → 报错；携带宿主地址时按其拼接', async () => {
    const noUrl = new CatalogContractClient({ fetchImpl: vi.fn() });
    await expect(noUrl.get({ version: 1, hash: 'sha256:abc' }, 'cat-1')).rejects.toThrow('宿主地址');

    const fetchImpl = vi.fn((_url: string | URL | Request) => Promise.resolve(jsonResponse(CONTRACT)));
    const withFallback = new CatalogContractClient({ hostBaseUrl: 'http://127.0.0.1:3201', fetchImpl });
    await withFallback.get({ version: 1, hash: 'sha256:abc' }, 'cat-1');
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      'http://127.0.0.1:3201/api/a2ui/catalog-contract?catalogId=cat-1',
    );
  });
});
