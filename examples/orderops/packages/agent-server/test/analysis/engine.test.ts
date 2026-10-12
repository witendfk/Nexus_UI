import { describe, expect, it } from 'vitest';
import { AnalysisError, analyzeCase } from '../../src/analysis/engine';
import { ModelClient } from '../../src/analysis/model-client';
import { chatCompletion, stalledContext, STALLED_CASE_ID } from '../fixtures/snapshot';
import type { AgentAnalysis } from '@orderops/contracts';

/** T3.4 判据：非法模型输出被拒并有明确失败结局；证据越界 → 不足证据而非可执行结论。 */

const MODEL_CONFIG = { baseUrl: 'http://model.test/v1', apiKey: 'k', model: 'test-model', timeoutMs: 5_000 };

function modelReturning(bodies: unknown[]): ModelClient {
  let index = 0;
  return new ModelClient(MODEL_CONFIG, () => {
    const body = bodies[Math.min(index, bodies.length - 1)]!;
    index += 1;
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
}

function analysisOf(evidence: string[]): AgentAnalysis {
  return {
    verdict: 'analysis',
    summary: '订单停滞',
    reason: '最后事件停滞超阈值',
    evidenceEventIds: evidence,
    recommendation: '建单',
    uncertainties: [],
  };
}

describe('analyzeCase（model 模式）', () => {
  it('合法输出一次通过，attempts=1', async () => {
    const model = modelReturning([chatCompletion(JSON.stringify(analysisOf(['evt-stalled-002'])))]);
    const outcome = await analyzeCase(stalledContext(), { mode: 'model', attempts: 2, model });
    expect(outcome.attempts).toBe(1);
    expect(outcome.analysis.verdict).toBe('analysis');
  });

  it('剥掉 ```json 围栏后解析', async () => {
    const fenced = '```json\n' + JSON.stringify(analysisOf(['evt-stalled-001', 'evt-stalled-002'])) + '\n```';
    const model = modelReturning([chatCompletion(fenced)]);
    const outcome = await analyzeCase(stalledContext(), { mode: 'model', attempts: 1, model });
    expect(outcome.analysis.verdict).toBe('analysis');
  });

  it('schema 非法 → 重试后成功（attempts 反映消耗）', async () => {
    const model = modelReturning([
      chatCompletion('这不是 JSON'),
      chatCompletion(JSON.stringify({ verdict: 'analysis', summary: '' })), // 缺字段
      chatCompletion(JSON.stringify(analysisOf(['evt-stalled-002']))),
    ]);
    const outcome = await analyzeCase(stalledContext(), { mode: 'model', attempts: 3, model });
    expect(outcome.attempts).toBe(3);
    expect(outcome.analysis.verdict).toBe('analysis');
  });

  it('证据越界重试耗尽 → insufficient_evidence，missingInformation 为越界 id（不给可执行结论）', async () => {
    const bogus = analysisOf(['evt-not-in-snapshot']);
    const model = modelReturning([chatCompletion(JSON.stringify(bogus))]);
    const outcome = await analyzeCase(stalledContext(), { mode: 'model', attempts: 2, model });
    expect(outcome.analysis).toMatchObject({
      verdict: 'insufficient_evidence',
      missingInformation: ['evt-not-in-snapshot'],
    });
  });

  it('结构非法耗尽 → AnalysisError 明确失败', async () => {
    const model = modelReturning([chatCompletion('仍然不是 JSON')]);
    await expect(
      analyzeCase(stalledContext(), { mode: 'model', attempts: 2, model }),
    ).rejects.toThrow(AnalysisError);
  });

  it('模型明确 insufficient_evidence → 原样通过（尊重如实不足）', async () => {
    const insufficient = {
      verdict: 'insufficient_evidence',
      reason: '快照缺少物流事件',
      missingInformation: ['物流事件'],
    };
    const model = modelReturning([chatCompletion(JSON.stringify(insufficient))]);
    const outcome = await analyzeCase(stalledContext(), { mode: 'model', attempts: 2, model });
    expect(outcome.analysis).toEqual(insufficient);
  });

  it('模型 HTTP 错误计入尝试；耗尽抛 AnalysisError', async () => {
    const model = new ModelClient(MODEL_CONFIG, () =>
      Promise.resolve(new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 500 })),
    );
    await expect(
      analyzeCase(stalledContext(), { mode: 'model', attempts: 2, model }),
    ).rejects.toThrow('模型输出连续 2 次');
  });
});

describe('analyzeCase（deterministic 模式）', () => {
  it('不触模型，直接出确定性结论', async () => {
    const outcome = await analyzeCase(stalledContext(), { mode: 'deterministic' });
    expect(outcome.mode).toBe('deterministic');
    expect(outcome.attempts).toBe(1);
    expect(outcome.analysis.verdict).toBe('analysis');
    void STALLED_CASE_ID;
  });
});
