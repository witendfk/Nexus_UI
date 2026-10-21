import {
  CATALOG_CONTRACT_VERSION,
  CatalogRegistry,
  createCatalogPromptContract,
  getCatalogContractHashInput,
  isCatalogContractHash,
} from '@nexus-ui/core';
import type { CatalogDefinition } from '@nexus-ui/core';

export interface PlaygroundCatalogContracts {
  /** 全部通过校验后由实际下载的声明新建；浏览器不维护另一套 Catalog 能力表。 */
  readonly registry: CatalogRegistry;
  /** catalogId → 已核对的 contractHash；消费运行时用它核对 done 的 catalogHash。 */
  readonly contractHashes: ReadonlyMap<string, string>;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * S2.6.3.1：从同源参考服务加载已发布声明，并在挂载前核对契约版本、Catalog
 * 身份、hash 格式与内容一致性（Web Crypto 复算 core 公开的规范化载荷）、标准
 * prompt，最后经 SDK 注册闸门。任一 Catalog 非法则整体失败，不部分挂载。
 */
export async function loadPlaygroundCatalogContracts(
  catalogIds: readonly string[],
  signal: AbortSignal,
): Promise<PlaygroundCatalogContracts> {
  const loaded = await Promise.all(
    catalogIds.map(async (catalogId) => {
      const response = await fetch(
        `/api/a2ui/catalog-contract?catalogId=${encodeURIComponent(catalogId)}`,
        { signal },
      );
      if (!response.ok) throw new Error(`Catalog 加载失败：HTTP ${response.status}`);
      const payload = (await response.json()) as {
        kind?: unknown;
        serverApiVersion?: unknown;
        contractVersion?: unknown;
        contractHash?: unknown;
        catalog?: unknown;
        promptContract?: unknown;
      };
      if (payload.kind !== 'catalog-contract' || payload.serverApiVersion !== 1) {
        throw new Error(`Catalog 响应身份非法：${catalogId}`);
      }
      if (payload.contractVersion !== CATALOG_CONTRACT_VERSION) {
        throw new Error(`契约版本不受支持：${catalogId} (${String(payload.contractVersion)})`);
      }
      if (
        typeof payload.catalog !== 'object' ||
        payload.catalog === null ||
        (payload.catalog as { catalogId?: unknown }).catalogId !== catalogId
      ) {
        throw new Error(`Catalog 响应与请求不匹配：${catalogId}`);
      }
      if (!isCatalogContractHash(payload.contractHash)) {
        throw new Error(`契约 hash 格式非法：${catalogId}`);
      }
      const catalog = payload.catalog as CatalogDefinition;
      const recomputed = `sha256:${await sha256Hex(getCatalogContractHashInput(catalog))}`;
      if (recomputed !== payload.contractHash) {
        throw new Error(`契约内容与 hash 不一致：${catalogId}`);
      }
      // 注册闸门先于 prompt 核对：非法声明在此显式失败，不以 prompt 差异掩盖。
      new CatalogRegistry([structuredClone(catalog)]);
      if (payload.promptContract !== createCatalogPromptContract(catalog)) {
        throw new Error(`标准 prompt 与声明不一致：${catalogId}`);
      }
      return { catalog, contractHash: payload.contractHash };
    }),
  );
  return {
    registry: new CatalogRegistry(loaded.map((entry) => structuredClone(entry.catalog))),
    contractHashes: new Map(loaded.map((entry) => [entry.catalog.catalogId, entry.contractHash])),
  };
}
