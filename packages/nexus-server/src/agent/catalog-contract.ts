import { createHash } from 'node:crypto';
import type { CatalogDefinition } from '@nexus-ui/core';

export const CATALOG_CONTRACT_VERSION = 1 as const;

export interface CatalogContractReference {
  readonly version: typeof CATALOG_CONTRACT_VERSION;
  readonly hash: string;
  readonly url?: string;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value !== 'object' || value === null) return JSON.stringify(value) ?? 'null';
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
    )
    .join(',')}}`;
}

/** Fingerprint the normalized CatalogDefinition and its generated prompt contract. */
export function createCatalogContractHash(catalog: CatalogDefinition): string {
  const payload = {
    contractVersion: CATALOG_CONTRACT_VERSION,
    catalog,
  };
  const hash = createHash('sha256').update(stableStringify(payload)).digest('hex');
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
