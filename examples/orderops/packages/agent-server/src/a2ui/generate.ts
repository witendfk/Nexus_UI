import type { ReadContextResponse } from '@orderops/contracts';
import type { CaseContextClient } from '../tools/case-context';
import type { AnalysisOutcome } from '../analysis/engine';
import { compileAnalysisSurface, type A2uiMessage } from './compile';
import type { RpcGenerateInput } from '../rpc/handler';

/**
 * T3.4/T3.5 真实生成管线：`message` 规范化为 caseId（docs/SPEC.md §3）→
 * Host 只读快照 → 分析引擎（deterministic/model）→ 确定性 A2UI 编译。
 * 生成器只产出 Catalog v1 声明内的组件，宿主 guard 仍是最终裁决。
 */

export interface AnalysisGenerationDeps {
  contextClient: CaseContextClient;
  analyze: (context: ReadContextResponse, promptContract?: string) => Promise<AnalysisOutcome>;
}

export function createAnalysisGeneration(
  deps: Pick<AnalysisGenerationDeps, 'contextClient' | 'analyze'>,
) {
  return async function* generateAnalysis(input: RpcGenerateInput): AsyncGenerator<A2uiMessage, void, void> {
    const caseId = input.message;
    const context = await deps.contextClient.get(caseId);
    const outcome = await deps.analyze(context, input.promptContract);
    yield* compileAnalysisSurface({
      surfaceId: input.surfaceId,
      catalogId: input.catalogId,
      context,
      analysis: outcome.analysis,
    });
  };
}
