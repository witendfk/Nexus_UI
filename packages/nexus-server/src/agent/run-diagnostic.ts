/** 扩展面故障不改写 UI 提交事实；记录状态仍以实际记录所有者为准。 */
export interface NexusRunDiagnostic {
  readonly runId: string;
  readonly surfaceId: string;
  readonly stage:
    | 'generation-hook'
    | 'history-commit'
    | 'record-commit'
    | 'record-transition'
    | 'commit-identity'
    | 'ledger-complete'
    | 'ledger-begin'
    | 'run-dispose';
  readonly message: string;
}

export type RunDiagnosticReporter = (stage: NexusRunDiagnostic['stage'], message: string) => void;

export function reportRunDiagnostic(
  callback: ((diagnostic: NexusRunDiagnostic) => void) | undefined,
  diagnostic: NexusRunDiagnostic,
): void {
  try {
    // TypeScript 的 void 回调也允许 async 函数；观察者拒绝不能泄漏为 unhandled rejection。
    void Promise.resolve(callback?.(diagnostic)).catch(() => undefined);
  } catch {
    // 诊断缺席不影响提交事实。
  }
}
