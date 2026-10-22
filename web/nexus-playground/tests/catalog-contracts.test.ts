import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  CATALOG_CONTRACT_VERSION,
  createCatalogPromptContract,
  getCatalogContractHashInput,
  standardCatalogComponentDeclarations,
} from '@nexus-ui/core';
import type { CatalogDefinition } from '@nexus-ui/core';
import { loadPlaygroundCatalogContracts } from '../src/catalog/registry';

afterEach(() => {
  vi.unstubAllGlobals();
});

const CATALOG_ID = 'https://example.com/catalogs/loader-test/v1';

const legalCatalog: CatalogDefinition = {
  catalogId: CATALOG_ID,
  components: standardCatalogComponentDeclarations(),
  actions: [],
};

function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function contractOf(catalog: CatalogDefinition, overrides: Record<string, unknown> = {}) {
  let promptContract: string;
  try {
    promptContract = createCatalogPromptContract(catalog);
  } catch {
    promptContract = 'unregistrable';
  }
  return {
    serverApiVersion: 1,
    kind: 'catalog-contract',
    contractVersion: CATALOG_CONTRACT_VERSION,
    contractHash: sha256(getCatalogContractHashInput(catalog)),
    catalog,
    promptContract,
    ...overrides,
  };
}

function stubContractFetch(payload: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ) as unknown as typeof fetch,
  );
}

describe('S2.6.3.1 playground 契约加载校验', () => {
  it('合法契约通过：注册表来自下载声明，hash 与 Web Crypto 复算一致', async () => {
    stubContractFetch(contractOf(legalCatalog));
    const loaded = await loadPlaygroundCatalogContracts([CATALOG_ID], new AbortController().signal);
    expect(loaded.registry.get(CATALOG_ID)).toBeDefined();
    expect(loaded.contractHashes.get(CATALOG_ID)).toBe(
      sha256(getCatalogContractHashInput(legalCatalog)),
    );
  });

  it('契约版本不受支持拒绝', async () => {
    stubContractFetch(contractOf(legalCatalog, { contractVersion: 99 }));
    await expect(
      loadPlaygroundCatalogContracts([CATALOG_ID], new AbortController().signal),
    ).rejects.toThrow(/版本/);
  });

  it('响应 Catalog 与请求错配拒绝', async () => {
    stubContractFetch(contractOf({ ...legalCatalog, catalogId: 'https://example.com/other' }));
    await expect(
      loadPlaygroundCatalogContracts([CATALOG_ID], new AbortController().signal),
    ).rejects.toThrow(/不匹配/);
  });

  it('hash 格式合法但内容错配拒绝', async () => {
    const tampered = structuredClone(legalCatalog) as CatalogDefinition;
    (
      (tampered.components.Text.schema as { properties: Record<string, Record<string, unknown>> })
        .properties.text as Record<string, unknown>
    ).minLength = 1;
    // 正文是原 Catalog，hash 却取篡改内容：复算对不上。
    stubContractFetch(
      contractOf(legalCatalog, { contractHash: sha256(getCatalogContractHashInput(tampered)) }),
    );
    await expect(
      loadPlaygroundCatalogContracts([CATALOG_ID], new AbortController().signal),
    ).rejects.toThrow(/内容与 hash 不一致/);
  });

  it('标准 prompt 与声明不一致拒绝', async () => {
    stubContractFetch(contractOf(legalCatalog, { promptContract: '伪造 prompt' }));
    await expect(
      loadPlaygroundCatalogContracts([CATALOG_ID], new AbortController().signal),
    ).rejects.toThrow(/prompt/);
  });

  it('非法声明被注册闸门拒绝', async () => {
    const illegal = structuredClone(legalCatalog) as CatalogDefinition;
    (illegal.components.Text as unknown as Record<string, unknown>).unknownKey = true;
    stubContractFetch(contractOf(illegal));
    await expect(
      loadPlaygroundCatalogContracts([CATALOG_ID], new AbortController().signal),
    ).rejects.toThrow(/未知|unknown|Text/);
  });

  it('取消加载：signal 贯通 transport，中止后不得产出契约结果', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!(signal instanceof AbortSignal)) {
          reject(new Error('loader 必须把 AbortSignal 传给 transport'));
          return;
        }
        const abort = (): void =>
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort);
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const loading = loadPlaygroundCatalogContracts([CATALOG_ID], controller.signal);
    expect(fetchMock).toHaveBeenCalled();
    controller.abort();
    await expect(loading).rejects.toMatchObject({ name: 'AbortError' });
  });
});
