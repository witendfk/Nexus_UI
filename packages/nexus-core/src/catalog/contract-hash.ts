/**
 * @nexus-ui/core/catalog/contract-hash —— 发布契约 hash 的规范化载荷。
 *
 * server 的 createCatalogContractHash 与浏览器（S2.6.3.1）共用同一份规范化：
 * 键序无关的 stableStringify({ contractVersion, catalog })。本模块刻意不引入
 * 摘要实现——Node 端用 node:crypto，浏览器端用 Web Crypto，摘要值必须一致。
 */
import type { CatalogDefinition } from './index';

/** 本 SDK 解释的已发布 Catalog 契约版本。 */
export const CATALOG_CONTRACT_VERSION = 2 as const;

/** 发布契约 hash 的完整格式：`sha256:` + 64 位小写十六进制。 */
export const CATALOG_CONTRACT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

export function isCatalogContractHash(value: unknown): value is string {
  return typeof value === 'string' && CATALOG_CONTRACT_HASH_PATTERN.test(value);
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

/** hash 摘要的规范化输入；同一 Catalog 在任何环境必须产生完全相同的字符串。 */
export function getCatalogContractHashInput(catalog: CatalogDefinition): string {
  return stableStringify({
    contractVersion: CATALOG_CONTRACT_VERSION,
    // 以真正发布的 JSON 形状为准：合法可选字段的 undefined 在传输时被省略。
    // 纯 JSON 声明的既有摘要不变，显式 undefined 与省略字段具有相同语义。
    catalog: JSON.parse(JSON.stringify(catalog)),
  });
}
