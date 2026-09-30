import { expect, it } from 'vitest';
import { AgentAnalysisSchema } from '../src';

const validAnalysis = {
  verdict: 'analysis',
  summary: '物流已停滞 3 天，超出阈值',
  reason: '最近一次事件为 9 月 26 日 in_transit，之后无更新',
  evidenceEventIds: ['evt-2', 'evt-1'],
  recommendation: '建议向承运方发起查询并同步客户',
  uncertainties: ['承运方数据可能延迟上报'],
};

it('完整分析通过解析', () => {
  const parsed = AgentAnalysisSchema.parse(validAnalysis);
  expect(parsed.verdict).toBe('analysis');
});

it('insufficient_evidence 分支通过解析', () => {
  const parsed = AgentAnalysisSchema.parse({
    verdict: 'insufficient_evidence',
    reason: '快照缺少承运方最新状态',
    missingInformation: ['carrier 最新扫描记录'],
  });
  expect(parsed.verdict).toBe('insufficient_evidence');
});

it('未知 verdict 与未知字段（模型编造）被拒', () => {
  expect(() => AgentAnalysisSchema.parse({ ...validAnalysis, verdict: 'guess' })).toThrow();

  // strict：模型发明未声明字段即整体拒绝
  expect(() =>
    AgentAnalysisSchema.parse({ ...validAnalysis, suggestedRefundMinor: 100 }),
  ).toThrow();

  expect(() =>
    AgentAnalysisSchema.parse({
      verdict: 'insufficient_evidence',
      reason: 'x',
      missingInformation: [],
      actionProposal: { kind: 'refund' },
    }),
  ).toThrow();
});

it('字符串长度上限生效', () => {
  const longSummary = { ...validAnalysis, summary: 'a'.repeat(501) };
  expect(() => AgentAnalysisSchema.parse(longSummary)).toThrow();

  const tooManyEvidence = {
    ...validAnalysis,
    evidenceEventIds: Array.from({ length: 21 }, (_, i) => `evt-${i}`),
  };
  expect(() => AgentAnalysisSchema.parse(tooManyEvidence)).toThrow();

  // trim 后为空视为空结论
  expect(() =>
    AgentAnalysisSchema.parse({ ...validAnalysis, summary: '   ' }),
  ).toThrow();
});

it('trim 归一化首尾空白', () => {
  const parsed = AgentAnalysisSchema.parse({ ...validAnalysis, summary: '  停滞 3 天  ' });
  if (parsed.verdict === 'analysis') {
    expect(parsed.summary).toBe('停滞 3 天');
  }
});
