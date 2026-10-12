import { ReadContextResponseSchema, type ReadContextResponse } from '@orderops/contracts';

/**
 * Host 只读工具客户端（T3.4，docs/SPEC.md §5）：`GET /internal/cases/:caseId/context`。
 *
 * fail-closed：internalToken 为空时直接抛错，绝不无鉴权调用；
 * 出口按 contracts schema 校验，宿主响应结构漂移在此显式失败。
 */

export class CaseContextError extends Error {
  constructor(
    message: string,
    readonly kind: 'no-token' | 'unauthorized' | 'not-found' | 'host-error' | 'invalid-response',
  ) {
    super(message);
  }
}

export interface CaseContextClientOptions {
  hostBaseUrl: string;
  internalToken: string;
  fetchImpl?: typeof fetch;
}

export class CaseContextClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: CaseContextClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async get(caseId: string): Promise<ReadContextResponse> {
    if (this.options.internalToken === '') {
      throw new CaseContextError('ORDEROPS_INTERNAL_TOKEN 未配置，拒绝调用内部工具（fail-closed）', 'no-token');
    }
    const url = `${this.options.hostBaseUrl}/internal/cases/${encodeURIComponent(caseId)}/context`;
    const response = await this.fetchImpl(url, {
      headers: { authorization: `Bearer ${this.options.internalToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401) {
      throw new CaseContextError('内部工具鉴权失败（401）：检查两侧 ORDEROPS_INTERNAL_TOKEN', 'unauthorized');
    }
    if (response.status === 404) {
      throw new CaseContextError(`案件不存在: ${caseId}`, 'not-found');
    }
    if (!response.ok) {
      throw new CaseContextError(`宿主内部工具错误：HTTP ${response.status}`, 'host-error');
    }
    const parsed = ReadContextResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new CaseContextError(`宿主快照结构非法：${parsed.error.message}`, 'invalid-response');
    }
    return parsed.data;
  }
}
