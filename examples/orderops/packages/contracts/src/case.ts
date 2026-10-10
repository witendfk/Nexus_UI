import { z } from 'zod';

/** 契约版本：任何字段变更必须升版本，并同步所有消费方（docs/SPEC.md §5）。 */
export const CONTRACTS_VERSION = 1;

const isoDatetime = z.string().datetime({ offset: true });

// ---------- 共享枚举（对齐 docs/SPEC.md §5 数据与状态契约）----------

/** M4 增加第二种异常时在此扩展（如 'high_amount_refund'），并升 CONTRACTS_VERSION。 */
export const CaseTypeSchema = z.enum(['logistics_stalled']);
export const CaseSeveritySchema = z.enum(['high', 'medium', 'low']);
export const CaseStatusSchema = z.enum(['open', 'in_review', 'ticket_created', 'dismissed']);
export const OperationStatusSchema = z.enum(['pending', 'succeeded', 'failed', 'needs_reconcile']);

// ---------- 只读工具契约（Host 产出 → Agent 消费，经 GET /internal/cases/:id/context）----------
// 生产方是可信的 Host，因此不设 strict：新增字段对旧消费方向前兼容（strip 掉即可）。

export const LogisticsEventSchema = z.object({
  id: z.string().min(1),
  orderId: z.string().min(1),
  status: z.string().min(1),
  occurredAt: isoDatetime,
  source: z.string().min(1),
});

export const OrderFactsSchema = z.object({
  id: z.string().min(1),
  customerId: z.string().min(1),
  /** ISO 4217 大写三字母。 */
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** 整数最小货币单位，禁止小数（docs/SPEC.md §5）。 */
  amountMinor: z.number().int().nonnegative(),
  promisedAt: isoDatetime.nullable(),
  status: z.string().min(1),
});

export const CaseSummarySchema = z.object({
  id: z.string().min(1),
  orderId: z.string().min(1),
  type: CaseTypeSchema,
  severity: CaseSeveritySchema,
  status: CaseStatusSchema,
  detectedAt: isoDatetime,
  /** 可回查的触发事件 ID；正常对照样本无触发事件时为 null。 */
  lastEventId: z.string().min(1).nullable(),
});

export const CaseSnapshotSchema = z.object({
  case: CaseSummarySchema,
  order: OrderFactsSchema,
  events: z.array(LogisticsEventSchema).max(200),
  /** 快照基准时间：Agent 以此判断"停滞至今多久"，不得自行取系统时间。 */
  capturedAt: isoDatetime,
});

export const ReadContextResponseSchema = z.object({
  contractVersion: z.literal(CONTRACTS_VERSION),
  caseId: z.string().min(1),
  caseVersion: z.number().int().positive(),
  snapshot: CaseSnapshotSchema,
});

export type CaseType = z.infer<typeof CaseTypeSchema>;
export type CaseSeverity = z.infer<typeof CaseSeveritySchema>;
export type CaseStatus = z.infer<typeof CaseStatusSchema>;
export type OperationStatus = z.infer<typeof OperationStatusSchema>;
export type LogisticsEvent = z.infer<typeof LogisticsEventSchema>;
export type OrderFacts = z.infer<typeof OrderFactsSchema>;
export type CaseSummary = z.infer<typeof CaseSummarySchema>;
export type CaseSnapshot = z.infer<typeof CaseSnapshotSchema>;
export type ReadContextResponse = z.infer<typeof ReadContextResponseSchema>;
