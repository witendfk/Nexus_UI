/**
 * Catalog Contract 客户端（T3.3）：从宿主 `GET /api/a2ui/catalog-contract` 拉取
 * Catalog 能力契约，按 `contractHash` 缓存（docs/SPEC.md §2 约定：
 * hash 不同说明 catalog 能力契约已变更，必须重新读取完整 contract）。
 *
 * 契约引用由宿主 RPC 请求内联携带（`catalogContract: {version, hash, url?}`）；
 * 本客户端只保证「缓存条目与引用 hash 一致」，不一致或拉取失败一律抛错，
 * 让 /rpc 以非 2xx + `{error:{message}}` 收敛（§10.1 错误语义）。
 */

/** 宿主 catalog-contract 端点的响应体（结构跨进程 JSON 对齐，本地声明）。 */
export interface CatalogContractPayload {
  readonly serverApiVersion: number;
  readonly kind: 'catalog-contract';
  readonly contractVersion: number;
  readonly contractHash: string;
  readonly catalog: unknown;
  readonly promptContract: string;
}

/** 宿主 RPC 请求内联的契约引用（结构对齐 `@nexus-ui/server` 的公开类型）。 */
export interface CatalogContractReference {
  readonly version: number;
  readonly hash: string;
  readonly url?: string;
}

export class CatalogContractError extends Error {}

export interface CatalogContractClientOptions {
  /** 引用未携带 url 时的兜底地址：`<hostBaseUrl>/api/a2ui/catalog-contract?catalogId=...`。 */
  hostBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class CatalogContractClient {
  private cache: CatalogContractPayload | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: CatalogContractClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** 取与引用 hash 一致的契约；缓存命中且 hash 相同则不发起网络请求。 */
  async get(reference: CatalogContractReference, catalogId: string): Promise<CatalogContractPayload> {
    if (this.cache !== null && this.cache.contractHash === reference.hash) {
      return this.cache;
    }
    if (typeof reference.hash !== 'string' || reference.hash === '') {
      throw new CatalogContractError('catalogContract.hash 缺失');
    }

    const url =
      reference.url ??
      (this.options.hostBaseUrl
        ? `${this.options.hostBaseUrl}/api/a2ui/catalog-contract?catalogId=${encodeURIComponent(catalogId)}`
        : undefined);
    if (url === undefined) {
      throw new CatalogContractError('catalogContract 未携带 url 且未配置宿主地址');
    }

    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new CatalogContractError(`宿主 catalog-contract 拉取失败：HTTP ${response.status}`);
    }
    const payload = (await response.json()) as Partial<CatalogContractPayload> | null;
    if (
      payload === null ||
      typeof payload !== 'object' ||
      payload.kind !== 'catalog-contract' ||
      typeof payload.contractHash !== 'string' ||
      typeof payload.promptContract !== 'string' ||
      payload.catalog === undefined
    ) {
      throw new CatalogContractError('宿主 catalog-contract 响应结构非法');
    }
    if (payload.contractHash !== reference.hash) {
      throw new CatalogContractError(
        `契约 hash 不一致：宿主请求 ${reference.hash}，端点返回 ${payload.contractHash}`,
      );
    }

    const validated = payload as CatalogContractPayload;
    this.cache = validated;
    return validated;
  }
}
