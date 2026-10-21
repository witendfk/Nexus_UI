import {
  CATALOG_CONTRACT_VERSION,
  CatalogRegistry,
  createCatalogPromptContract,
  getCatalogContractHashInput,
  isCatalogContractHash,
} from '@nexus-ui/core';
import type { CatalogDefinition } from '@nexus-ui/core';

/**
 * S2.6.3.1 浏览器契约加载：保留声明、contractVersion、contractHash，核对版本、
 * 身份、完整注册闸门、标准 prompt 与 hash↔内容一致后，才允许挂载对应
 * registry/renderMap。hash 用 Web Crypto 复算 core 公开的规范化载荷——浏览器
 * 不 import server 实现或 Node crypto，也不维护第二套 Catalog 表。
 */

export interface LoadedHostCatalog {
  readonly catalog: CatalogDefinition;
  readonly contractHash: string;
  /** 通过全部校验后新建的注册表；声明来自实际下载的契约副本。 */
  readonly registry: CatalogRegistry;
  readonly catalogContractUrl: string;
  readonly agentOnboardingUrl: string;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadOne(
  baseUrl: string,
  catalogId: string,
  signal: AbortSignal,
): Promise<LoadedHostCatalog> {
  const discovery = await fetch(`${baseUrl}/api/a2ui/published-catalogs`, { signal });
  if (!discovery.ok) throw new Error(`published-catalogs 加载失败：HTTP ${discovery.status}`);
  const list = (await discovery.json()) as {
    kind?: unknown;
    catalogs?: readonly {
      catalogId?: unknown;
      contractVersion?: unknown;
      contractHash?: unknown;
      catalogContractUrl?: unknown;
    }[];
  };
  if (list.kind !== 'published-catalog-list' || !Array.isArray(list.catalogs)) {
    throw new Error('published-catalogs 响应形状非法');
  }
  const summary = list.catalogs.find((entry) => entry.catalogId === catalogId);
  if (!summary) throw new Error(`请求的 Catalog 未发布：${catalogId}`);
  if (summary.contractVersion !== CATALOG_CONTRACT_VERSION) {
    throw new Error(`契约版本不受支持：${catalogId} (${String(summary.contractVersion)})`);
  }
  if (!isCatalogContractHash(summary.contractHash)) {
    throw new Error(`发布 hash 格式非法：${catalogId}`);
  }
  if (typeof summary.catalogContractUrl !== 'string' || summary.catalogContractUrl === '') {
    throw new Error(`发布条目缺少 catalogContractUrl：${catalogId}`);
  }
  // 相对 URL 以 discovery 响应的最终 URL 为基；桩响应无 url 时回退当前文档地址。
  const discoveryBase =
    discovery.url || (typeof location === 'undefined' ? undefined : location.href);
  const catalogContractUrl = new URL(summary.catalogContractUrl, discoveryBase).toString();

  const contractResponse = await fetch(catalogContractUrl, { signal });
  if (!contractResponse.ok) {
    throw new Error(`catalog-contract 加载失败：HTTP ${contractResponse.status}`);
  }
  const contract = (await contractResponse.json()) as {
    kind?: unknown;
    serverApiVersion?: unknown;
    contractVersion?: unknown;
    contractHash?: unknown;
    catalog?: unknown;
    promptContract?: unknown;
  };
  if (contract.kind !== 'catalog-contract' || contract.serverApiVersion !== 1) {
    throw new Error(`catalog-contract 响应身份非法：${catalogId}`);
  }
  // 请求 Catalog 与响应错配、版本不符、hash 格式合法但内容错配，全部失败。
  if (
    contract.contractVersion !== CATALOG_CONTRACT_VERSION ||
    typeof contract.catalog !== 'object' ||
    contract.catalog === null ||
    (contract.catalog as { catalogId?: unknown }).catalogId !== catalogId
  ) {
    throw new Error(`catalog-contract 与请求错配：${catalogId}`);
  }
  if (contract.contractHash !== summary.contractHash) {
    throw new Error(`契约 hash 与发布摘要不一致：${catalogId}`);
  }
  const catalog = contract.catalog as CatalogDefinition;
  const recomputed = `sha256:${await sha256Hex(getCatalogContractHashInput(catalog))}`;
  if (recomputed !== summary.contractHash) {
    throw new Error(`契约内容与 hash 不一致：${catalogId}`);
  }
  // 完整声明形状与能力由 SDK 注册闸门校验，非法配置在此显式失败。
  const registry = new CatalogRegistry([structuredClone(catalog)]);
  if (contract.promptContract !== createCatalogPromptContract(catalog)) {
    throw new Error(`标准 prompt 与声明不一致：${catalogId}`);
  }
  // onboarding URL 与契约 URL 同源同代；onboarding 契约在装配期已与发布契约核对。
  const agentOnboardingUrl = `${new URL(catalogContractUrl).origin}/api/a2ui/agent-onboarding?catalogId=${encodeURIComponent(catalogId)}`;
  return {
    catalog,
    contractHash: summary.contractHash,
    registry,
    catalogContractUrl,
    agentOnboardingUrl,
  };
}

/** 并行加载全部请求的 Catalog；任一非法整体失败，不部分挂载。 */
export async function loadHostCatalogs(
  baseUrl: string,
  catalogIds: readonly string[],
  signal: AbortSignal,
): Promise<ReadonlyMap<string, LoadedHostCatalog>> {
  const entries = await Promise.all(
    catalogIds.map(
      async (catalogId) => [catalogId, await loadOne(baseUrl, catalogId, signal)] as const,
    ),
  );
  return new Map(entries);
}
