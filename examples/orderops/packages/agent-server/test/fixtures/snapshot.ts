import { ORDEROPS_CATALOG } from '@orderops/contracts';
import type { ReadContextResponse } from '@orderops/contracts';

/** agent-server 测试夹具：与宿主 fixture 检测产出的案件对齐（order-stalled-001）。 */

export const INTERNAL_TOKEN = 'test-internal-token';

export const STALLED_CASE_ID = 'case-order-stalled-001-evt-stalled-002';

export function stalledContext(): ReadContextResponse {
  return {
    contractVersion: 1,
    caseId: STALLED_CASE_ID,
    caseVersion: 1,
    snapshot: {
      case: {
        id: STALLED_CASE_ID,
        orderId: 'order-stalled-001',
        type: 'logistics_stalled',
        severity: 'high',
        status: 'open',
        detectedAt: '2026-09-30T12:00:00.000Z',
        lastEventId: 'evt-stalled-002',
      },
      order: {
        id: 'order-stalled-001',
        customerId: 'cust-001',
        currency: 'CNY',
        amountMinor: 12900,
        promisedAt: '2026-09-28T18:00:00.000Z',
        status: 'shipped',
      },
      events: [
        {
          id: 'evt-stalled-001',
          orderId: 'order-stalled-001',
          status: 'in_transit',
          occurredAt: '2026-09-27T08:00:00.000Z',
          source: 'carrier-webhook',
        },
        {
          id: 'evt-stalled-002',
          orderId: 'order-stalled-001',
          status: 'stalled',
          occurredAt: '2026-09-28T06:00:00.000Z',
          source: 'carrier-webhook',
        },
      ],
      capturedAt: '2026-09-30T12:00:00.000Z',
    },
  };
}

/** 与 CatalogContractClient 消费的响应结构一致；hash 由调用方指定。 */
export function catalogContractPayload(hash = 'sha256:cat'): Record<string, unknown> {
  return {
    serverApiVersion: 1,
    kind: 'catalog-contract',
    contractVersion: 1,
    contractHash: hash,
    catalog: ORDEROPS_CATALOG,
    promptContract: 'PROMPT-V1',
  };
}

/** OpenAI 兼容 chat/completions 响应体。 */
export function chatCompletion(content: string): Record<string, unknown> {
  return { choices: [{ message: { content } }] };
}
