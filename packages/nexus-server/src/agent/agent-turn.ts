/**
 * Neutral conversation turn shared by history stores, generation sources, and
 * guards. It carries no transport or model-SDK semantics.
 */
export interface AgentTurn {
  role: 'user' | 'assistant';
  content: string;
}
