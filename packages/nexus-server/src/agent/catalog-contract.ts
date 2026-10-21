import { createHash } from 'node:crypto';
import type { CatalogDefinition } from '@nexus-ui/core';

import { CATALOG_CONTRACT_VERSION, getCatalogContractHashInput } from '@nexus-ui/core';
export { CATALOG_CONTRACT_VERSION } from '@nexus-ui/core';
export { CATALOG_CONTRACT_HASH_PATTERN, isCatalogContractHash } from '@nexus-ui/core';

export interface CatalogContractReference {
  readonly version: typeof CATALOG_CONTRACT_VERSION;
  readonly hash: string;
  readonly url?: string;
}

/** Fingerprint the normalized CatalogDefinition and its generated prompt contract. */
export function createCatalogContractHash(catalog: CatalogDefinition): string {
  // 规范化载荷与浏览器（core 公开导出 + Web Crypto）完全同源，摘要值一致。
  const hash = createHash('sha256').update(getCatalogContractHashInput(catalog)).digest('hex');
  return `sha256:${hash}`;
}

export function createCatalogContractReference(
  catalog: CatalogDefinition,
  url?: string,
): CatalogContractReference {
  return {
    version: CATALOG_CONTRACT_VERSION,
    hash: createCatalogContractHash(catalog),
    ...(url === undefined ? {} : { url }),
  };
}
