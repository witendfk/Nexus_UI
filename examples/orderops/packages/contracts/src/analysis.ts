import { z } from 'zod';

// ---------- Agent 分析契约（Agent 产出 → Host 消费）----------
// 模型输出属于不可信输入：strict 拒绝一切未声明字段（docs/DESIGN.md D2）。

export const AnalysisVerdictSchema = z.enum(['analysis', 'insufficient_evidence']);

/** 证据充分的完整分析。evidenceEventIds 由 Host 再校验"必须属于工具快照"。 */
export const AnalysisResultSchema = z
  .object({
    verdict: z.literal('analysis'),
    summary: z.string().trim().min(1).max(500),
    reason: z.string().trim().min(1).max(1000),
    evidenceEventIds: z.array(z.string().min(1)).max(20),
    recommendation: z.string().trim().min(1).max(500),
    uncertainties: z.array(z.string()).max(10),
  })
  .strict();

/** 证据不足：Agent 必须明确说缺什么，而不是编造结论（docs/PRD.md §5.1）。 */
export const InsufficientEvidenceSchema = z
  .object({
    verdict: z.literal('insufficient_evidence'),
    reason: z.string().trim().min(1).max(1000),
    missingInformation: z.array(z.string()).max(10),
  })
  .strict();

export const AgentAnalysisSchema = z.discriminatedUnion('verdict', [
  AnalysisResultSchema,
  InsufficientEvidenceSchema,
]);

export type AnalysisVerdict = z.infer<typeof AnalysisVerdictSchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type InsufficientEvidence = z.infer<typeof InsufficientEvidenceSchema>;
export type AgentAnalysis = z.infer<typeof AgentAnalysisSchema>;
