import { expect, it } from 'vitest';
import { A2UIRuntime, CatalogRegistry } from '@nexus-ui/core';
import type { A2UIError } from '@nexus-ui/core';
import { ORDEROPS_CATALOG, ORDEROPS_CATALOG_ID } from '../../src/nexus/catalog';

/** 判据（T3.2）：guard 对越权组件 / 越权 action 报 CATALOG_UNSUPPORTED。每次用全新 runtime,错误互不污染。 */
function dispatchComponents(components: Array<Record<string, unknown>>): A2UIError[] {
  const errors: A2UIError[] = [];
  const probe = new A2UIRuntime({
    catalogRegistry: new CatalogRegistry([ORDEROPS_CATALOG]),
    onRender: () => undefined,
    onError: (error) => errors.push(error),
  });
  probe.dispatch({
    version: 'v0.9',
    createSurface: { surfaceId: 's1', catalogId: ORDEROPS_CATALOG_ID },
  });
  probe.dispatch({ version: 'v0.9', updateComponents: { surfaceId: 's1', components: components as never } });
  return errors;
}

it('Catalog v1 声明：6 组件、唯一 action createTicket、业务组件 host-extension 双声明', () => {
  expect([...ORDEROPS_CATALOG.components].sort()).toEqual([
    'Button',
    'Column',
    'LogisticsTimeline',
    'OrderSummary',
    'Text',
    'TextField',
  ]);
  expect(ORDEROPS_CATALOG.actions).toEqual(['createTicket']);
  expect(ORDEROPS_CATALOG.componentPolicies?.OrderSummary?.origin).toBe('host-extension');
  expect(ORDEROPS_CATALOG.componentPolicies?.LogisticsTimeline?.origin).toBe('host-extension');
  expect(ORDEROPS_CATALOG.componentPolicies?.OrderSummary?.action?.allowed).toBe(false);
  expect(ORDEROPS_CATALOG.componentPolicies?.LogisticsTimeline?.action?.allowed).toBe(false);
  // 双声明：业务组件必须同时有 schema 与 policy.fields
  for (const component of ['OrderSummary', 'LogisticsTimeline']) {
    expect(ORDEROPS_CATALOG.componentSchemas?.[component], component).toBeDefined();
    expect(ORDEROPS_CATALOG.componentPolicies?.[component]?.fields, component).toBeDefined();
  }
});

it('合法 surface：业务组件 + TextField(/draft/note) + createTicket 按钮全部通过 guard', () => {
  const errors = dispatchComponents([
    { id: 'root', component: 'Column', children: ['summary', 'timeline', 'note', 'submit'] },
    {
      id: 'summary',
      component: 'OrderSummary',
      orderId: { path: '/order/id' },
      product: { path: '/order/product' },
      currency: { path: '/order/currency' },
      amountMinor: { path: '/order/amountMinor' },
      customerSummary: { path: '/order/customerSummary' },
    },
    {
      id: 'timeline',
      component: 'LogisticsTimeline',
      events: {
        path: '/order/events',
      },
    },
    {
      id: 'note',
      component: 'TextField',
      label: '处理备注',
      value: { path: '/draft/note' },
      variant: 'longText',
    },
    {
      id: 'submit',
      component: 'Button',
      child: 'submit-label',
      action: { event: { name: 'createTicket', context: { note: { path: '/draft/note' } } } },
    },
    { id: 'submit-label', component: 'Text', text: '提交工单' },
  ]);
  expect(errors).toEqual([]);
});

it('越权组件（Image 未声明）→ CATALOG_UNSUPPORTED', () => {
  const errors = dispatchComponents([
    { id: 'logo', component: 'Image', url: 'https://example.com/x.png' },
  ]);
  expect(errors).toHaveLength(1);
  expect(errors[0]!.code).toBe('CATALOG_UNSUPPORTED');
  expect(errors[0]!.message).toContain('Image');
});

it('越权 action（ping 不在 Catalog）→ CATALOG_UNSUPPORTED', () => {
  const errors = dispatchComponents([
    {
      id: 'btn',
      component: 'Button',
      child: 'btn-label',
      action: { event: { name: 'ping', context: {} } },
    },
    { id: 'btn-label', component: 'Text', text: 'Ping' },
  ]);
  expect(errors).toHaveLength(1);
  expect(errors[0]!.code).toBe('CATALOG_UNSUPPORTED');
  expect(errors[0]!.message).toContain('ping');
});

it('OrderSummary 未知字段被拒（additionalProperties: false）', () => {
  const errors = dispatchComponents([
    {
      id: 'summary',
      component: 'OrderSummary',
      orderId: 'o-1',
      product: 'p',
      currency: 'CNY',
      amountMinor: 100,
      customerSummary: 'c',
      remark: '未声明字段',
    },
  ]);
  expect(errors).toHaveLength(1);
  expect(errors[0]!.code).toBe('CATALOG_UNSUPPORTED');
  expect(errors[0]!.message).toContain('remark');
});

it('LogisticsTimeline 事件缺必需字段 / 事件元素未知字段被拒', () => {
  const missing = dispatchComponents([
    {
      id: 'timeline',
      component: 'LogisticsTimeline',
      events: [{ id: 'e1', status: 'in_transit' }],
    },
  ]);
  expect(missing).toHaveLength(1);
  expect(missing[0]!.code).toBe('CATALOG_UNSUPPORTED');

  const unknownField = dispatchComponents([
    {
      id: 'timeline',
      component: 'LogisticsTimeline',
      events: [{ id: 'e1', status: 'in_transit', occurredAt: '2026-09-30T00:00:00Z', source: 'x', extra: 1 }],
    },
  ]);
  expect(unknownField).toHaveLength(1);
  expect(unknownField[0]!.code).toBe('CATALOG_UNSUPPORTED');
});

it('架构红线：Button.disabled 用 {path} 绑定被拒（只能字面布尔）', () => {
  const errors = dispatchComponents([
    {
      id: 'btn',
      component: 'Button',
      child: 'btn-label',
      disabled: { path: '/submitted' },
      action: { event: { name: 'createTicket', context: {} } },
    },
    { id: 'btn-label', component: 'Text', text: '提交' },
  ]);
  expect(errors).toHaveLength(1);
  expect(errors[0]!.code).toBe('CATALOG_UNSUPPORTED');
  expect(errors[0]!.message).toContain('disabled');
});

it('TextField.value 字面量被拒（policy 要求 {path} 绑定）', () => {
  const errors = dispatchComponents([
    { id: 'note', component: 'TextField', label: '备注', value: '写死的备注' },
  ]);
  expect(errors).toHaveLength(1);
  expect(errors[0]!.code).toBe('CATALOG_UNSUPPORTED');
  expect(errors[0]!.message).toContain('TextField.value');
});
