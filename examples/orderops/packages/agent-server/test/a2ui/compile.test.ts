import { describe, expect, it } from 'vitest';
import {
  CatalogRegistry,
  validateNexusProfileMessage,
  validateProtocolMessage,
} from '@nexus-ui/core';
import { ORDEROPS_CATALOG } from '@orderops/contracts';
import type { AgentAnalysis } from '@orderops/contracts';
import { compileAnalysisSurface } from '../../src/a2ui/compile';
import { stalledContext } from '../fixtures/snapshot';

/** T3.5 判据：稳定快照；root、证据链接与 Catalog 双声明全部过 guard 等价校验
 *  （protocol → profile → CatalogRegistry schema/policy，与宿主准入同源）。
 *  V1 起分阶段产出：createSurface 后多次交错 updateComponents/updateDataModel。 */

const registry = new CatalogRegistry([ORDEROPS_CATALOG]);

function successAnalysis(): AgentAnalysis {
  return {
    verdict: 'analysis',
    summary: '订单 order-stalled-001 物流停滞：最后事件「stalled」距今约 54 小时。',
    reason: '快照共 2 条事件，最近有效事件 evt-stalled-002（stalled，来源 carrier-webhook）。',
    evidenceEventIds: ['evt-stalled-001', 'evt-stalled-002'],
    recommendation: '建议人工核对物流时间线并与客户确认后创建处理工单。',
    uncertainties: [],
  };
}

/** 按 updateDataModel 的 path 语义顺序合并（'/' 或缺省为整表，其余定点写）。 */
function mergeDataModelMessages(messages: Array<Record<string, unknown>>): Record<string, unknown> {
  return messages.reduce<Record<string, unknown>>((model, message) => {
    if ('updateDataModel' in message) {
      const { path, value } = message.updateDataModel as { path?: string; value?: unknown };
      if (value === undefined) return model;
      if (typeof path !== 'string' || path === '' || path === '/') {
        return value === null ? model : ({ ...(value as Record<string, unknown>) });
      }
      const keys = path.split('/').filter(Boolean);
      let cursor: Record<string, unknown> = model;
      for (let i = 0; i < keys.length - 1; i += 1) {
        const key = keys[i]!;
        if (cursor[key] === undefined || typeof cursor[key] !== 'object') cursor[key] = {};
        cursor = cursor[key] as Record<string, unknown>;
      }
      cursor[keys[keys.length - 1]!] = value;
    }
    return model;
  }, {});
}

/** 与宿主 guard 同源的组合校验：协议 → Profile → Catalog（schema+policy，带最终 dataModel）。 */
function guardCheck(messages: ReturnType<typeof compileAnalysisSurface>): void {
  const modelValue = mergeDataModelMessages(messages as unknown as Array<Record<string, unknown>>);

  const allComponents = messages.flatMap((message) =>
    'updateComponents' in message
      ? (message.updateComponents.components as Array<Record<string, unknown>>)
      : [],
  );

  for (const message of messages) {
    expect(validateProtocolMessage(message).ok, JSON.stringify(message).slice(0, 200)).toBe(true);
    expect(validateNexusProfileMessage(message), JSON.stringify(message).slice(0, 200)).toBeNull();
  }
  for (const component of allComponents) {
    const diagnostics = registry.getComponentDiagnostics(
      ORDEROPS_CATALOG.catalogId,
      component as never,
      modelValue,
    );
    expect(diagnostics, JSON.stringify(component)).toEqual([]);
  }
}

describe('compileAnalysisSurface（成功分析）', () => {
  const messages = compileAnalysisSurface({
    surfaceId: 'surface-1',
    catalogId: ORDEROPS_CATALOG.catalogId,
    context: stalledContext(),
    analysis: successAnalysis(),
  });

  const allComponents = messages.flatMap((message) =>
    'updateComponents' in message
      ? (message.updateComponents.components as Array<{
          id: string;
          component: string;
          action?: { event: { name: string } };
          value?: unknown;
          text?: unknown;
        }>)
      : [],
  );
  const mergedModel = mergeDataModelMessages(messages as unknown as Array<Record<string, unknown>>);

  it('分阶段产出：首条 createSurface，其后多次交错更新，末条写入 /draft', () => {
    expect(messages[0]).toEqual({
      version: 'v0.9',
      createSurface: { surfaceId: 'surface-1', catalogId: ORDEROPS_CATALOG.catalogId },
    });
    expect(messages.length).toBeGreaterThanOrEqual(11);
    for (const message of messages.slice(1)) {
      expect('updateComponents' in message || 'updateDataModel' in message).toBe(true);
    }
    const last = messages.at(-1)!;
    expect('updateDataModel' in last && last.updateDataModel.path).toBe('/draft');
  });

  it('root 组件存在于首个 updateComponents', () => {
    const first = (messages[1!] as { updateComponents: { components: Array<{ id: string; component: string }> } })
      .updateComponents.components;
    expect(first[0]).toMatchObject({ id: 'root', component: 'Column' });
  });

  it('组件与 action 全部在 Catalog v1 声明内', () => {
    for (const component of allComponents) {
      expect(ORDEROPS_CATALOG.components).toContain(component.component);
    }
    const button = allComponents.find((c) => c.component === 'Button')!;
    expect(button.action?.event.name).toBe('createTicket');
  });

  it('证据可回查：时间线含全部快照事件 id，分析区引用证据', () => {
    const timeline = mergedModel.timeline as { events: Array<{ id: string }> };
    expect(timeline.events.map((event) => event.id)).toEqual(['evt-stalled-001', 'evt-stalled-002']);
    const analysis = mergedModel.analysis as { evidenceEventIds: string[]; evidenceText: string };
    expect(analysis.evidenceEventIds).toContain('evt-stalled-002');
    expect(analysis.evidenceText).toContain('evt-stalled-002');
  });

  it('可执行面：TextField 绑定 /draft/note，Button 挂唯一 action，工单号槽位就位', () => {
    const note = allComponents.find((c) => c.id === 'note')!;
    expect(note.value).toEqual({ path: '/draft/note' });
    const root = allComponents.find((c) => c.id === 'root') as unknown as { children: string[] };
    expect(root.children).toContain('ticket-result');
    const slot = allComponents.find((c) => c.id === 'ticket-result')!;
    expect(slot.text).toEqual({ path: '/result/ticketText' });
    const draft = mergedModel.draft as { note: string };
    expect(draft.note).toBe('');
    const result = mergedModel.result as { ticketText: string };
    expect(result.ticketText).toContain('工单号');
  });

  it('全消息过 guard 等价校验（protocol → profile → catalog schema/policy）', () => {
    guardCheck(messages);
  });

  it('编译确定性：同输入两次编译完全一致（稳定快照）', () => {
    const again = compileAnalysisSurface({
      surfaceId: 'surface-1',
      catalogId: ORDEROPS_CATALOG.catalogId,
      context: stalledContext(),
      analysis: successAnalysis(),
    });
    expect(again).toEqual(messages);
  });
});

describe('compileAnalysisSurface（证据不足）', () => {
  const messages = compileAnalysisSurface({
    surfaceId: 'surface-2',
    catalogId: ORDEROPS_CATALOG.catalogId,
    context: stalledContext(),
    analysis: {
      verdict: 'insufficient_evidence',
      reason: '快照缺少物流事件。',
      missingInformation: ['物流事件记录', '承诺送达时间'],
    },
  });

  it('不可执行：没有 TextField 也没有 Button（无 action 挂点）', () => {
    const components = (messages[1!] as { updateComponents: { components: Array<{ component: string }> } })
      .updateComponents.components;
    expect(components.map((c) => c.component)).not.toContain('TextField');
    expect(components.map((c) => c.component)).not.toContain('Button');
    expect(components.map((c) => c.component)).not.toContain('LogisticsTimeline');
  });

  it('明确陈述缺失信息，并过 guard 等价校验', () => {
    const model = (messages[2!] as unknown as { updateDataModel: { value: { insufficient: { missingText: string } } } })
      .updateDataModel.value.insufficient;
    expect(model.missingText).toContain('物流事件记录');
    guardCheck(messages);
  });
});
