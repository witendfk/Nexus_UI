import { expect, it } from 'vitest';
import {
  CaseSnapshotSchema,
  CONTRACTS_VERSION,
  ReadContextResponseSchema,
} from '../src';

const validSnapshot = {
  case: {
    id: 'case-1',
    orderId: 'order-1',
    type: 'logistics_stalled',
    severity: 'high',
    status: 'open',
    detectedAt: '2026-09-29T03:00:00.000Z',
    lastEventId: 'evt-2',
  },
  order: {
    id: 'order-1',
    customerId: 'cust-1',
    currency: 'CNY',
    amountMinor: 129900,
    promisedAt: '2026-09-27T18:00:00.000Z',
    status: 'shipping',
  },
  events: [
    { id: 'evt-1', orderId: 'order-1', status: 'picked_up', occurredAt: '2026-09-25T08:00:00.000Z', source: 'carrier-api' },
    { id: 'evt-2', orderId: 'order-1', status: 'in_transit', occurredAt: '2026-09-26T09:30:00.000Z', source: 'carrier-api' },
  ],
  capturedAt: '2026-09-29T03:00:00.000Z',
};

it('合法快照通过解析', () => {
  const parsed = CaseSnapshotSchema.parse(validSnapshot);
  expect(parsed.case.id).toBe('case-1');
  expect(parsed.order.amountMinor).toBe(129900);
});

it('read-context 响应契约要求版本字面量与正数案件版本', () => {
  expect(() =>
    ReadContextResponseSchema.parse({ contractVersion: CONTRACTS_VERSION + 1, caseId: 'case-1', caseVersion: 1, snapshot: validSnapshot }),
  ).toThrow();
  expect(() =>
    ReadContextResponseSchema.parse({ contractVersion: CONTRACTS_VERSION, caseId: 'case-1', caseVersion: 0, snapshot: validSnapshot }),
  ).toThrow();
  const ok = ReadContextResponseSchema.parse({
    contractVersion: CONTRACTS_VERSION,
    caseId: 'case-1',
    caseVersion: 3,
    snapshot: validSnapshot,
  });
  expect(ok.snapshot.order.currency).toBe('CNY');
});

it('非法枚举、负金额与坏货币码被拒', () => {
  const badType = { ...validSnapshot, case: { ...validSnapshot.case, type: 'made_up_type' } };
  expect(() => CaseSnapshotSchema.parse(badType)).toThrow();

  const badSeverity = { ...validSnapshot, case: { ...validSnapshot.case, severity: 'urgent' } };
  expect(() => CaseSnapshotSchema.parse(badSeverity)).toThrow();

  const negativeAmount = { ...validSnapshot, order: { ...validSnapshot.order, amountMinor: -1 } };
  expect(() => CaseSnapshotSchema.parse(negativeAmount)).toThrow();

  const floatAmount = { ...validSnapshot, order: { ...validSnapshot.order, amountMinor: 12.5 } };
  expect(() => CaseSnapshotSchema.parse(floatAmount)).toThrow();

  const lowercaseCurrency = { ...validSnapshot, order: { ...validSnapshot.order, currency: 'cny' } };
  expect(() => CaseSnapshotSchema.parse(lowercaseCurrency)).toThrow();
});

it('非 ISO 时间被拒；Host 新增字段对旧消费方透明（strip）', () => {
  const badTime = { ...validSnapshot, capturedAt: '2026-09-29 03:00:00' };
  expect(() => CaseSnapshotSchema.parse(badTime)).toThrow();

  const withExtraField = {
    ...validSnapshot,
    futureField: 'forward-compatible',
  };
  expect(() => CaseSnapshotSchema.parse(withExtraField)).not.toThrow();
});
