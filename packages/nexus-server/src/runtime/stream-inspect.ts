import { validateNexusProfileMessage, validateProtocolMessage } from '@nexus-ui/core';
import {
  createAgentStreamState,
  validateAgentStreamFinalDetailed,
  validateAgentStreamMessageDetailed,
  type AgentSequenceOptions,
  type AgentStreamState,
} from '../agent/agent-guard';

/** A rejected candidate: boundaryCode carries the protocol/profile diagnostics code. */
export class AgentCandidateError extends Error {
  readonly boundaryCode?: string;
  readonly diagnostics?: readonly unknown[];

  constructor(
    message: string,
    extra?: { boundaryCode?: string; diagnostics?: readonly unknown[] },
  ) {
    super(message);
    if (extra?.boundaryCode) this.boundaryCode = extra.boundaryCode;
    if (extra?.diagnostics) this.diagnostics = extra.diagnostics;
  }
}

export interface InspectedCandidate {
  /** The validated message object (same shape pumpMessages published in S2). */
  message: unknown;
  /** Whether this message carried a `root` component update. */
  hasRootUpdate: boolean;
}

/**
 * Single candidate guard shared by the scheduled task and the raw tool path:
 * protocol → profile → sequence, plus root tracking for generation streams.
 */
export function inspectCandidate(
  candidate: unknown,
  index: number,
  sequence: AgentSequenceOptions,
  state: AgentStreamState,
): InspectedCandidate {
  const protocolResult = validateProtocolMessage(candidate);
  if (!protocolResult.ok || !protocolResult.message) {
    throw new AgentCandidateError(protocolResult.error?.message ?? 'A2UI 消息结构非法', {
      boundaryCode: protocolResult.error?.code,
    });
  }
  const profileError = validateNexusProfileMessage(protocolResult.message);
  if (profileError) {
    throw new AgentCandidateError(profileError.message, { boundaryCode: profileError.code });
  }
  const message = protocolResult.message;
  const sequenceIssue = validateAgentStreamMessageDetailed(message, index, sequence, state);
  if (sequenceIssue) {
    throw new AgentCandidateError(sequenceIssue.message, {
      boundaryCode: sequenceIssue.boundaryCode,
      diagnostics: sequenceIssue.diagnostics,
    });
  }
  let hasRootUpdate = false;
  if (
    'updateComponents' in message &&
    message.updateComponents.components.some((component) => component.id === 'root')
  ) {
    hasRootUpdate = true;
  }
  return { message, hasRootUpdate };
}

/** End-of-stream checks: non-empty generation, root presence and final validation. */
export function finalizeCandidates(
  sentCount: number,
  hasRoot: boolean,
  sequence: AgentSequenceOptions,
  state: AgentStreamState,
): void {
  if (sentCount === 0 && sequence.kind !== 'action') {
    throw new Error('Agent 没有返回 A2UI 消息');
  }
  if (!hasRoot) throw new Error('生成流必须包含 id 为 root 的组件');
  const finalIssue = validateAgentStreamFinalDetailed(sequence, state);
  if (finalIssue) {
    throw new AgentCandidateError(finalIssue.message, {
      boundaryCode: finalIssue.boundaryCode,
      diagnostics: finalIssue.diagnostics,
    });
  }
}

/** Full re-validation of a complete candidate list (authoritative commit-side guard). */
export function validateAgentCandidateSequence(
  messages: readonly unknown[],
  sequence: AgentSequenceOptions,
): void {
  const state = createAgentStreamState(sequence);
  let hasRoot = sequence.kind === 'action';
  for (const [index, candidate] of messages.entries()) {
    const inspected = inspectCandidate(candidate, index, sequence, state);
    hasRoot = hasRoot || inspected.hasRootUpdate;
  }
  finalizeCandidates(messages.length, hasRoot, sequence, state);
}
