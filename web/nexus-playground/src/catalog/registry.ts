import { CatalogRegistry } from '@nexus-ui/core';
import type { CatalogDefinition } from '@nexus-ui/core';

/** 从同源参考服务加载已发布声明；浏览器不维护另一套 Catalog 能力表。 */
export async function loadPlaygroundCatalogRegistry(
  catalogIds: readonly string[],
  signal: AbortSignal,
): Promise<CatalogRegistry> {
  const catalogs = await Promise.all(
    catalogIds.map(async (catalogId) => {
      const response = await fetch(
        `/api/a2ui/catalog-contract?catalogId=${encodeURIComponent(catalogId)}`,
        { signal },
      );
      if (!response.ok) throw new Error(`Catalog 加载失败：HTTP ${response.status}`);
      const payload: unknown = await response.json();
      if (
        typeof payload !== 'object' ||
        payload === null ||
        !('kind' in payload) ||
        payload.kind !== 'catalog-contract' ||
        !('catalog' in payload) ||
        typeof payload.catalog !== 'object' ||
        payload.catalog === null ||
        !('catalogId' in payload.catalog) ||
        payload.catalog.catalogId !== catalogId
      ) {
        throw new Error(`Catalog 响应与请求不匹配：${catalogId}`);
      }
      // 完整声明形状与 schema 能力由 SDK 注册闸门校验。
      return payload.catalog as CatalogDefinition;
    }),
  );
  return new CatalogRegistry(catalogs);
}
