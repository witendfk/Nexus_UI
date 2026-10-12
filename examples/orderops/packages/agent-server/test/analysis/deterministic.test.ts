import { describe, expect, it } from 'vitest';
import { deterministicAnalysis } from '../../src/analysis/deterministic';
import { stalledContext } from '../fixtures/snapshot';

/** T3.4 判据（确定性模式）：只引用快照内事件、不取系统时钟、缺事实时明确不足。 */

describe('deterministicAnalysis', () => {
  it('正常停滞快照：verdict=analysis，事实来自快照，证据 ⊆ 快照事件且含案件标记事件', () => {
    const context = stalledContext();
    const analysis = deterministicAnalysis(context);
    expect(analysis.verdict).toBe('analysis');
    if (analysis.verdict !== 'analysis') return;

    const eventIds = new Set(context.snapshot.events.map((event) => event.id));
    expect(analysis.summary).toContain('order-stalled-001');
    expect(analysis.summary).toContain('stalled');
    expect(analysis.reason).toContain('evt-stalled-002');
    expect(analysis.recommendation).toContain('工单');
    expect(analysis.evidenceEventIds.length).toBeGreaterThan(0);
    expect(analysis.evidenceEventIds.length).toBeLessThanOrEqual(20);
    for (const id of analysis.evidenceEventIds) expect(eventIds.has(id)).toBe(true);
    expect(analysis.evidenceEventIds).toContain('evt-stalled-002');
    // 快照有承诺送达时间，无不确定性
    expect(analysis.uncertainties).toEqual([]);
  });

  it('停滞时长用 capturedAt 基准计算而非系统时钟', () => {
    const analysis = deterministicAnalysis(stalledContext());
    // 2026-09-28T06:00 → 2026-09-30T12:00 = 54 小时
    if (analysis.verdict !== 'analysis') return;
    expect(analysis.summary).toContain('54 小时');
  });

  it('承诺送达缺失 → uncertainties 明确列出，而不是编造延误量化', () => {
    const context = stalledContext();
    context.snapshot.order.promisedAt = null;
    const analysis = deterministicAnalysis(context);
    expect(analysis.verdict).toBe('analysis');
    if (analysis.verdict !== 'analysis') return;
    expect(analysis.uncertainties.join()).toContain('承诺送达');
  });

  it('快照无事件 → insufficient_evidence 并说明缺什么', () => {
    const context = stalledContext();
    context.snapshot.events = [];
    const analysis = deterministicAnalysis(context);
    expect(analysis).toMatchObject({
      verdict: 'insufficient_evidence',
      missingInformation: ['物流事件记录'],
    });
  });
});
