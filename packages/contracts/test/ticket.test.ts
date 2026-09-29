import { expect, it } from 'vitest';
import { CreateTicketInputSchema } from '../src';

it('合法备注通过解析', () => {
  const parsed = CreateTicketInputSchema.parse({ note: '已与客户沟通，同意建单' });
  expect(parsed.note).toBe('已与客户沟通，同意建单');
});

it('允许空备注（备注非建单前置条件），但拒绝超长', () => {
  expect(CreateTicketInputSchema.parse({ note: '' }).note).toBe('');

  expect(() => CreateTicketInputSchema.parse({ note: 'a'.repeat(1001) })).toThrow();
});

it('strict：浏览器注入的任何额外字段被整体拒绝', () => {
  expect(() =>
    CreateTicketInputSchema.parse({ note: 'ok', orderId: 'order-1' }),
  ).toThrow();
  expect(() =>
    CreateTicketInputSchema.parse({ note: 'ok', amountMinor: 1, caseId: 'case-1' }),
  ).toThrow();
});

it('缺失 note 视为非法（字段必须显式出现）', () => {
  expect(() => CreateTicketInputSchema.parse({})).toThrow();
});
