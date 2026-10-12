import type { AgentAnalysis, ReadContextResponse } from '@orderops/contracts';

/**
 * 确定性分析（T3.4 默认模式，docs/DESIGN.md D2）：停滞判定由宿主规则完成，
 * Agent 从快照做事实综合——只引用快照里存在的事件，绝不补造。
 * 时间基准用 snapshot.capturedAt（contracts 约定），不取系统时钟。
 */
export function deterministicAnalysis(context: ReadContextResponse): AgentAnalysis {
  const { snapshot } = context;
  const events = snapshot.events;
  if (events.length === 0) {
    return {
      verdict: 'insufficient_evidence',
      reason: `案件 ${snapshot.case.id} 的只读快照没有任何物流事件，无法判断停滞原因。`,
      missingInformation: ['物流事件记录'],
    };
  }

  const last = events[events.length - 1]!;
  const capturedAt = Date.parse(snapshot.capturedAt);
  const lastAt = Date.parse(last.occurredAt);
  const stalledHours =
    Number.isFinite(capturedAt) && Number.isFinite(lastAt)
      ? Math.max(0, Math.round((capturedAt - lastAt) / 3_600_000))
      : null;

  // 证据 = 快照内最近事件（≤20），并保证案件标记的最后事件在列。
  const recent = events.slice(-20).map((event) => event.id);
  const marked = snapshot.case.lastEventId;
  if (marked !== null && !recent.includes(marked)) {
    recent.unshift(marked);
    if (recent.length > 20) recent.pop();
  }

  const uncertainties: string[] = [];
  if (snapshot.order.promisedAt === null) {
    uncertainties.push('订单缺少承诺送达时间，无法量化延误程度');
  }
  if (stalledHours === null) {
    uncertainties.push('快照时间戳无法解析，停滞时长未知');
  }

  return {
    verdict: 'analysis',
    summary: `订单 ${snapshot.order.id} 物流停滞：最后事件「${last.status}」距今约 ${
      stalledHours === null ? '未知' : `${stalledHours} 小时`
    }。`,
    reason:
      `快照共 ${events.length} 条事件，最近有效事件 ${last.id}（${last.status}，来源 ${last.source}，发生于 ${last.occurredAt}）。` +
      `订单当前状态「${snapshot.order.status}」，承诺送达 ${
        snapshot.order.promisedAt ?? '未提供'
      }；检测规则判定为 ${snapshot.case.severity} 级物流停滞。`,
    evidenceEventIds: recent,
    recommendation: '建议人工核对物流时间线并与客户确认后创建处理工单。',
    uncertainties,
  };
}
