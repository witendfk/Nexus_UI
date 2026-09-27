export type AgentRunState = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface AgentRunRecord {
  readonly id: string;
  readonly surfaceId: string;
  readonly kind: 'generate' | 'action';
  state: AgentRunState;
  readonly createdAt: string;
  startedAt?: string;
  endedAt?: string;
  message?: string;
}

export interface AgentRunManager {
  create(input: { id: string; surfaceId: string; kind: 'generate' | 'action' }): AgentRunRecord;
  transition(
    id: string,
    state: Extract<AgentRunState, 'running' | 'succeeded' | 'failed' | 'canceled'>,
    message?: string,
  ): void;
  get(id: string): AgentRunRecord | undefined;
  listBySurface(surfaceId: string): readonly AgentRunRecord[];
}

export interface InMemoryAgentRunManagerOptions {
  maxRecords?: number;
}

export class InMemoryAgentRunManager implements AgentRunManager {
  private readonly records = new Map<string, AgentRunRecord>();
  private readonly maxRecords: number;

  constructor(options: InMemoryAgentRunManagerOptions = {}) {
    this.maxRecords = options.maxRecords ?? 512;
    if (!Number.isSafeInteger(this.maxRecords) || this.maxRecords <= 0) {
      throw new Error('maxRecords 必须是正整数');
    }
  }

  create(input: { id: string; surfaceId: string; kind: 'generate' | 'action' }): AgentRunRecord {
    const record: AgentRunRecord = {
      ...input,
      state: 'queued',
      createdAt: new Date().toISOString(),
    };
    this.records.set(record.id, record);
    while (this.records.size > this.maxRecords) {
      const oldest = this.records.keys().next().value;
      if (oldest === undefined) break;
      this.records.delete(oldest);
    }
    return { ...record };
  }

  transition(
    id: string,
    state: Extract<AgentRunState, 'running' | 'succeeded' | 'failed' | 'canceled'>,
    message?: string,
  ): void {
    const record = this.records.get(id);
    if (!record) return;
    const completed = state === 'succeeded' || state === 'failed' || state === 'canceled';
    this.records.set(id, {
      ...record,
      state,
      startedAt: state === 'running' ? new Date().toISOString() : record.startedAt,
      endedAt: completed ? new Date().toISOString() : undefined,
      ...(message === undefined ? {} : { message }),
    });
  }

  get(id: string): AgentRunRecord | undefined {
    const record = this.records.get(id);
    return record ? { ...record } : undefined;
  }

  listBySurface(surfaceId: string): readonly AgentRunRecord[] {
    return [...this.records.values()]
      .filter((record) => record.surfaceId === surfaceId)
      .reverse()
      .map((record) => ({ ...record }));
  }
}

export const defaultAgentRunManager = new InMemoryAgentRunManager();
