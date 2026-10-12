import { AgentAnalysisSchema, type AgentAnalysis, type ReadContextResponse } from '@orderops/contracts';
import { deterministicAnalysis } from './deterministic';
import type { ModelClient } from './model-client';

/**
 * 分析引擎（T3.4，docs/DESIGN.md D2）：模型输出属于不可信输入——
 * schema strict 校验 + 证据 ID 必须 ⊆ 只读快照；不满足按次数重试，
 * 重试耗尽时：证据越界 → 明确的 insufficient_evidence（而非可执行 surface），
 * 结构非法 → AnalysisError 明确失败结局。CI 走 deterministic 模式。
 */

export type AnalysisMode = 'deterministic' | 'model';

export interface AnalysisOutcome {
  analysis: AgentAnalysis;
  mode: AnalysisMode;
  /** 实际消耗的模型尝试次数（deterministic 恒为 1）。 */
  attempts: number;
}

export class AnalysisError extends Error {}

export interface AnalyzeOptions {
  mode: AnalysisMode;
  attempts?: number;
  model?: ModelClient;
  /** 宿主 prompt contract（能力边界声明），进入模型系统提示。 */
  promptContract?: string;
}

/** 剥掉模型常见的 ```json 围栏再解析。 */
function parseJsonLoose(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(raw);
  const text = fenced === null ? raw : fenced[1]!;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('输出不是合法 JSON');
  }
}

function evidenceOutsideSnapshot(
  analysis: AgentAnalysis,
  context: ReadContextResponse,
): string[] {
  if (analysis.verdict !== 'analysis') return [];
  const known = new Set(context.snapshot.events.map((event) => event.id));
  return analysis.evidenceEventIds.filter((id) => !known.has(id));
}

export async function analyzeCase(
  context: ReadContextResponse,
  options: AnalyzeOptions,
): Promise<AnalysisOutcome> {
  if (options.mode === 'deterministic' || options.model === undefined) {
    return { analysis: deterministicAnalysis(context), mode: 'deterministic', attempts: 1 };
  }

  const attempts = options.attempts ?? 2;
  const systemPrompt =
    `你是订单物流异常分析助手。只输出一个 JSON 对象，不要输出任何其他文本。\n` +
    `JSON 必须满足二选一：\n` +
    `1) {"verdict":"analysis","summary":string(≤500),"reason":string(≤1000),` +
    `"evidenceEventIds":string[](≤20，必须逐字来自快照事件的 id 字段),` +
    `"recommendation":string(≤500),"uncertainties":string[](≤10)}\n` +
    `2) {"verdict":"insufficient_evidence","reason":string(≤1000),"missingInformation":string[](≤10)}\n` +
    `规则：不得引用快照中不存在的事件 id；证据不足时必须如实输出第 2 种，而不是编造。\n` +
    `可用的组件能力边界（prompt contract，仅约束后续界面，不影响本 JSON）：\n${options.promptContract ?? '（未提供）'}`;
  const userContent = JSON.stringify({ snapshot: context.snapshot });

  let lastSchemaError = '';
  let lastInvalidEvidence: string[] = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let parsed: unknown;
    try {
      const raw = await options.model.complete(systemPrompt, userContent);
      parsed = parseJsonLoose(raw);
    } catch (error) {
      lastSchemaError = error instanceof Error ? error.message : String(error);
      continue;
    }
    const result = AgentAnalysisSchema.safeParse(parsed);
    if (!result.success) {
      lastSchemaError = result.error.message;
      continue;
    }
    const invalid = evidenceOutsideSnapshot(result.data, context);
    if (invalid.length > 0) {
      lastInvalidEvidence = invalid;
      continue;
    }
    return { analysis: result.data, mode: 'model', attempts: attempt };
  }

  if (lastInvalidEvidence.length > 0) {
    // SPEC §5：证据越界时不给可执行结论，输出明确的证据不足结果。
    return {
      analysis: {
        verdict: 'insufficient_evidence',
        reason: `模型连续 ${attempts} 次引用了只读快照中不存在的物流事件，结果不可信。`,
        missingInformation: lastInvalidEvidence,
      },
      mode: 'model',
      attempts,
    };
  }
  throw new AnalysisError(`模型输出连续 ${attempts} 次不满足分析契约：${lastSchemaError}`);
}
