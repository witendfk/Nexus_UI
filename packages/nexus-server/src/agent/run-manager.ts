import { parseSurfaceCommit } from '@nexus-ui/core';
import type { NexusSurfaceCommit } from '@nexus-ui/core';
import { assertPositiveSafeInteger } from './limits';

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
  /**
   * 提交边界捕获的固定成功提交结果（S2.5.2）：只在确认提交后由 `recordCommit`
   * 写入一次，重复写入与终态补记显式拒绝；存储与读取均深拷贝，后续状态迁移
   * 不覆盖。查询不得用最新快照事后拼装。
   */
  readonly commit?: NexusSurfaceCommit;
}

export interface AgentRunManager {
  create(input: { id: string; surfaceId: string; kind: 'generate' | 'action' }): AgentRunRecord;
  /**
   * 在提交边界记录本次运行固定的 `NexusSurfaceCommit`（成功 done 之前可读）。
   * 记录必须已由 `create` 建立；没有记录的运行不能隐式建立。重复 ID、
   * 重复 recordCommit 与终态补记均显式拒绝。
   */
  recordCommit(id: string, commit: NexusSurfaceCommit): void;
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

function isTerminalState(state: AgentRunState): boolean {
  return state === 'succeeded' || state === 'failed' || state === 'canceled';
}

/** 读取边界深拷贝：调用方拿到的是独立值快照，不共享存储引用。 */
function cloneRecord(record: AgentRunRecord): AgentRunRecord {
  return record.commit === undefined
    ? { ...record }
    : { ...record, commit: structuredClone(record.commit) };
}

/** Validate stored/published facts at the owning run boundary, never repair mismatched identity. */
export function assertRunCommit(
  value: unknown,
  expected: { id: string; surfaceId: string; catalogId?: string; catalogHash?: string },
): NexusSurfaceCommit {
  const commit = parseSurfaceCommit(value);
  if (!commit) throw new Error('运行没有可确认的 NexusSurfaceCommit 提交结果');
  if (
    commit.runId !== expected.id ||
    commit.surfaceId !== expected.surfaceId ||
    (expected.catalogId !== undefined && commit.catalogId !== expected.catalogId) ||
    (expected.catalogHash !== undefined && commit.catalogHash !== expected.catalogHash)
  ) {
    throw new Error('NexusSurfaceCommit 与本次 runId/surfaceId/Catalog 不一致');
  }
  return structuredClone({
    sessionVersion: commit.sessionVersion,
    runId: commit.runId,
    surfaceId: commit.surfaceId,
    catalogId: commit.catalogId,
    contractVersion: commit.contractVersion,
    catalogHash: commit.catalogHash,
    surfaceRevision: commit.surfaceRevision,
  });
}

export class InMemoryAgentRunManager implements AgentRunManager {
  private readonly records = new Map<string, AgentRunRecord>();
  private readonly maxRecords: number;

  constructor(options: InMemoryAgentRunManagerOptions = {}) {
    this.maxRecords = options.maxRecords === undefined ? 512 : options.maxRecords;
    assertPositiveSafeInteger('maxRecords', this.maxRecords);
  }

  create(input: { id: string; surfaceId: string; kind: 'generate' | 'action' }): AgentRunRecord {
    if (this.records.has(input.id)) {
      throw new Error(`运行记录 ID 重复，不能覆盖既有运行: ${input.id}`);
    }
    if (this.records.size >= this.maxRecords) {
      // 容量优先淘汰终态记录（按插入序取最旧）；排队/执行中的记录受保护，
      // 不得为新建让位。全部活动时显式拒绝新建，不做无限增长。
      for (const [key, record] of this.records) {
        if (this.records.size < this.maxRecords) break;
        if (isTerminalState(record.state)) this.records.delete(key);
      }
      if (this.records.size >= this.maxRecords) {
        throw new Error(
          `运行记录容量已满且全部为排队/执行中的受保护记录，拒绝新建运行记录: ${input.id}`,
        );
      }
    }
    const record: AgentRunRecord = {
      ...input,
      state: 'queued',
      createdAt: new Date().toISOString(),
    };
    this.records.set(record.id, record);
    return { ...record };
  }

  recordCommit(id: string, commit: NexusSurfaceCommit): void {
    const record = this.records.get(id);
    if (!record) {
      throw new Error(`运行记录不存在，不能记录提交结果: ${id}`);
    }
    if (isTerminalState(record.state)) {
      throw new Error(`运行已终态(${record.state})，不能补记提交结果: ${id}`);
    }
    if (record.commit) {
      throw new Error(`运行已有固定提交结果，重复 recordCommit 被拒绝: ${id}`);
    }
    this.records.set(id, {
      ...record,
      commit: assertRunCommit(commit, { id, surfaceId: record.surfaceId }),
    });
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
    return record ? cloneRecord(record) : undefined;
  }

  listBySurface(surfaceId: string): readonly AgentRunRecord[] {
    return [...this.records.values()]
      .filter((record) => record.surfaceId === surfaceId)
      .reverse()
      .map((record) => cloneRecord(record));
  }
}
