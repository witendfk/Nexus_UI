import { applyDataModelUpdate, setStrictPath } from '@nexus-ui/core';
import { assertPositiveSafeInteger } from './limits';
import type {
  CatalogDefinition,
  Component,
  ServerActionEvent,
  UpdateDataModelPayload,
} from '@nexus-ui/core';

/** 提交边界固定的执行契约：hash/版本与实际使用的声明副本一体，不随 registry 漂移。 */
export interface SurfaceActionContract {
  /** `sha256:` 加 64 位十六进制；提交时按当时 Catalog 声明计算并固定。 */
  readonly catalogHash: string;
  readonly contractVersion: number;
  /** 当时 Catalog 声明的深拷贝；输入、参数与 guard 核对一律使用该副本。 */
  readonly catalog: CatalogDefinition;
}

export interface SurfaceActionSnapshot {
  readonly surfaceId: string;
  readonly catalogId: string;
  readonly version: number;
  /** 生成代：每次 commitGeneration 递增；action 排队提交不得跨代落库。 */
  readonly epoch: number;
  readonly components: ReadonlyMap<string, Component>;
  readonly dataModel: unknown;
  /** 提交边界固定的执行契约（含声明副本）；准入据此核对并解释。 */
  readonly contract: SurfaceActionContract;
}

interface MutableSurfaceActionSnapshot {
  surfaceId: string;
  catalogId: string;
  version: number;
  epoch: number;
  components: Map<string, Component>;
  dataModel: unknown;
  contract: SurfaceActionContract;
}

/** 一次 action 提交的基准与组合写入：准入输入随 patch 一次原子落库。 */
export interface SurfaceActionCommit {
  /** Action 所属 surface；空消息提交必须显式提供，省略时从非空消息推导。 */
  readonly surfaceId?: string;
  /**
   * prepareAction 读取快照时的生成代；与 expectedRevision 一起比较，
   * 任一基准变化都拒绝，包含同代其他 action 和重新生成。
   */
  readonly expectedEpoch: number;
  readonly expectedRevision: number;
  /** 已准入的输入写回（规范化路径 + 值快照）；先于 handler patch 应用。 */
  readonly inputWrites?: readonly SurfaceInputWrite[];
}

export interface SurfaceInputWrite {
  readonly path: string;
  readonly value: unknown;
}

/**
 * 提交事实三态（S3.3，SPEC §6.3）：确定性拒绝（revision/epoch 比较、结构校验、
 * surface 缺失、版本上溢）必须返回 `notCommitted`，不得以异常表达；实现无法证明
 * 写入是否落盘时返回 `unknown`。运行时把 store 抛出的任何异常一律映射为 unknown。
 */
export type SurfaceCommitOutcome = 'committed' | 'notCommitted' | 'unknown';

export type SurfaceCommitResult =
  | { readonly outcome: 'committed'; readonly snapshot: SurfaceActionSnapshot }
  | { readonly outcome: 'notCommitted'; readonly reason: string }
  | { readonly outcome: 'unknown'; readonly reason?: string };

export interface SurfaceActionStateStore {
  get(surfaceId: string): Promise<SurfaceActionSnapshot | undefined>;
  commitGeneration(
    surfaceId: string,
    catalogId: string,
    messages: readonly unknown[],
    contract: SurfaceActionContract,
  ): Promise<SurfaceCommitResult>;
  commitAction(
    messages: readonly unknown[],
    commit: SurfaceActionCommit,
  ): Promise<SurfaceCommitResult>;
  removeSnapshot(surfaceId: string): Promise<void>;
}

export interface SurfaceActionLedgerRecord {
  readonly key: string;
  readonly surfaceId: string;
  readonly actionName: string;
  readonly sourceComponentId: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly status: 'running' | 'succeeded' | 'failed';
}

/**
 * ledger 入账三态（S3.3，SPEC §6.4）：留存窗口内任何已知记录（running/
 * succeeded/failed）一律 `duplicate`——failed 不是重试许可；容量满且无可淘汰
 * 终态记录时 `capacity`，此时不得执行 handler。
 */
export type SurfaceLedgerBegin =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly reason: 'duplicate' | 'capacity' };

export interface SurfaceActionLedger {
  begin(record: Omit<SurfaceActionLedgerRecord, 'startedAt' | 'status'>): SurfaceLedgerBegin;
  complete(
    key: string,
    status: Extract<SurfaceActionLedgerRecord['status'], 'succeeded' | 'failed'>,
  ): void;
  get(key: string): SurfaceActionLedgerRecord | undefined;
}

export type InMemorySurfaceActionStateStoreOptions = {
  maxSurfaces?: number;
};

export class InMemorySurfaceActionStateStore implements SurfaceActionStateStore {
  private readonly snapshots = new Map<string, MutableSurfaceActionSnapshot>();
  // One bounded counter per store: no tombstone map, no identity reuse after eviction.
  private revision = 0;
  private readonly maxSurfaces: number;

  constructor(options: InMemorySurfaceActionStateStoreOptions = {}) {
    this.maxSurfaces = options.maxSurfaces === undefined ? 256 : options.maxSurfaces;
    assertPositiveSafeInteger('maxSurfaces', this.maxSurfaces);
  }

  async get(surfaceId: string): Promise<SurfaceActionSnapshot | undefined> {
    const snapshot = this.snapshots.get(surfaceId);
    // 深拷贝出界：读取方（准入、resolver、handler 上下文）的任何改动都不得
    // 影响权威状态——resolver 拒绝也不能污染快照
    return snapshot ? cloneSnapshot(snapshot) : undefined;
  }

  async commitGeneration(
    surfaceId: string,
    catalogId: string,
    messages: readonly unknown[],
    contract: SurfaceActionContract,
  ): Promise<SurfaceCommitResult> {
    // 内存 store 的拒绝全部发生在写入之前，因此一律是确定性的 notCommitted；
    // 它永远不会产生 unknown（单线程、无外部 IO）。
    let version: number;
    try {
      version = this.nextVersion(this.revision);
    } catch (error) {
      return { outcome: 'notCommitted', reason: errorMessage(error) };
    }
    const epoch = version;
    const next: MutableSurfaceActionSnapshot = {
      surfaceId,
      catalogId,
      version,
      epoch,
      components: new Map(),
      dataModel: undefined,
      contract: cloneContract(contract),
    };

    try {
      for (const message of structuredClone(messages)) {
        applyMessage(next, message);
      }
    } catch (error) {
      return { outcome: 'notCommitted', reason: errorMessage(error) };
    }

    if (next.components.size === 0) {
      return { outcome: 'notCommitted', reason: '生成流缺少组件，不能建立 action 权威状态' };
    }
    // 每次写入刷新顺序，重生成不能淘汰刚提交的权威快照。
    this.snapshots.delete(surfaceId);
    this.snapshots.set(surfaceId, next);
    this.revision = version;
    while (this.snapshots.size > this.maxSurfaces) {
      const oldest = this.snapshots.keys().next().value;
      if (oldest === undefined) break;
      this.snapshots.delete(oldest);
    }
    return { outcome: 'committed', snapshot: cloneSnapshot(next) };
  }

  async commitAction(
    messages: readonly unknown[],
    commit: SurfaceActionCommit,
  ): Promise<SurfaceCommitResult> {
    const first = messages.find(isRecord);
    const surfaceId = commit.surfaceId ?? readSurfaceId(first);
    if (!surfaceId) {
      return {
        outcome: 'notCommitted',
        reason: 'action 流缺少 surfaceId，不能更新 action 权威状态',
      };
    }

    const current = this.snapshots.get(surfaceId);
    if (!current) return { outcome: 'notCommitted', reason: `Action surface 不存在: ${surfaceId}` };
    // 同时核对 revision 与生成代，拒绝任何基于旧快照准备的 patch。
    if (current.epoch !== commit.expectedEpoch || current.version !== commit.expectedRevision) {
      return {
        outcome: 'notCommitted',
        reason: `Action 提交基准已变化: surface ${surfaceId} 已被新提交（epoch ${current.epoch}）替换，读取时为 epoch ${commit.expectedEpoch}，过期 patch 拒绝应用`,
      };
    }

    // 全部变更先在克隆上完成；任何失败都不触碰权威状态，故为确定性 notCommitted。
    let next: MutableSurfaceActionSnapshot;
    let version: number;
    try {
      next = cloneSnapshot(current);
      // Input model is the base; handler output is authoritative, including root replacement.
      for (const write of commit.inputWrites ?? []) {
        next.dataModel = setStrictPath(next.dataModel, write.path, structuredClone(write.value));
      }
      for (const message of structuredClone(messages)) applyMessage(next, message);
      version = this.nextVersion(this.revision);
    } catch (error) {
      return { outcome: 'notCommitted', reason: errorMessage(error) };
    }
    next.version = version;
    this.revision = version;
    // 与 commitGeneration 同口径：刷新插入位，容量淘汰不选中刚提交的快照。
    this.snapshots.delete(surfaceId);
    this.snapshots.set(surfaceId, next);
    return { outcome: 'committed', snapshot: cloneSnapshot(next) };
  }

  async removeSnapshot(surfaceId: string): Promise<void> {
    this.snapshots.delete(surfaceId);
  }

  private nextVersion(counter: number): number {
    const version = counter + 1;
    if (!Number.isSafeInteger(version) || version <= 0) {
      throw new Error(
        `surface 提交版本超出安全整数上限（${counter} → ${version}），显式失败，不重置为可碰撞的基准`,
      );
    }
    return version;
  }
}

export class InMemorySurfaceActionLedger implements SurfaceActionLedger {
  private readonly records = new Map<string, SurfaceActionLedgerRecord>();
  private readonly maxRecords: number;

  constructor({ maxRecords = 1_024 }: { maxRecords?: number } = {}) {
    assertPositiveSafeInteger('maxRecords', maxRecords);
    this.maxRecords = maxRecords;
  }

  begin(record: Omit<SurfaceActionLedgerRecord, 'startedAt' | 'status'>): SurfaceLedgerBegin {
    // 留存窗口内任何已知记录都拒绝重入：failed/canceled 的 handler 可能已执行，
    // SDK 无法证明副作用未发生，重试许可归宿主业务幂等（SPEC §6.4）。
    if (this.records.has(record.key)) return { admitted: false, reason: 'duplicate' };
    // 容量先于入账：只有终态记录可淘汰，全部活动时拒绝新条目而不是越界增长。
    while (this.records.size >= this.maxRecords) {
      const evictable = this.findOldestTerminalKey();
      if (evictable === undefined) return { admitted: false, reason: 'capacity' };
      this.records.delete(evictable);
    }
    this.records.set(record.key, {
      ...record,
      startedAt: new Date().toISOString(),
      status: 'running',
    });
    return { admitted: true };
  }

  private findOldestTerminalKey(): string | undefined {
    for (const [key, record] of this.records) {
      if (record.status !== 'running') return key;
    }
    return undefined;
  }

  complete(
    key: string,
    status: Extract<SurfaceActionLedgerRecord['status'], 'succeeded' | 'failed'>,
  ): void {
    const record = this.records.get(key);
    if (!record) return;
    this.records.set(key, {
      ...record,
      status,
      completedAt: new Date().toISOString(),
    });
  }

  get(key: string): SurfaceActionLedgerRecord | undefined {
    const record = this.records.get(key);
    return record ? { ...record } : undefined;
  }
}

export interface ResolvedSurfaceAction {
  readonly declaration: ServerActionEvent;
  readonly component: Component;
  readonly snapshot: SurfaceActionSnapshot;
}

export function findSurfaceAction(
  snapshot: SurfaceActionSnapshot,
  actionName: string,
  sourceComponentId: string,
): ResolvedSurfaceAction | undefined {
  const component = snapshot.components.get(sourceComponentId);
  const declaration = component?.action?.event;
  if (!component || !declaration || declaration.name !== actionName) return undefined;
  return { component, declaration, snapshot };
}

function applyMessage(snapshot: MutableSurfaceActionSnapshot, message: unknown): void {
  if (!isRecord(message)) return;

  if (isRecord(message.createSurface)) {
    if (
      message.createSurface.surfaceId !== snapshot.surfaceId ||
      message.createSurface.catalogId !== snapshot.catalogId
    ) {
      throw new Error('生成流 surface 契约不一致，不能建立 action 权威状态');
    }
    return;
  }

  if (isRecord(message.updateComponents)) {
    const payload = message.updateComponents;
    if (payload.surfaceId !== snapshot.surfaceId) {
      throw new Error('action 流 surface 契约不一致');
    }
    if (!Array.isArray(payload.components)) {
      throw new Error('updateComponents.components 必须是数组');
    }
    for (const component of payload.components) {
      snapshot.components.set(component.id, component);
    }
    return;
  }

  if (isRecord(message.updateDataModel)) {
    const payload = message.updateDataModel;
    if (payload.surfaceId !== snapshot.surfaceId) {
      throw new Error('action 流 surface 契约不一致');
    }
    snapshot.dataModel = applyDataModelUpdate(
      snapshot.dataModel,
      payload as unknown as UpdateDataModelPayload,
    );
  }
}

function cloneSnapshot(snapshot: MutableSurfaceActionSnapshot): MutableSurfaceActionSnapshot {
  // 嵌套引用全部隔离：组件表、模型与固定契约的声明副本各自独立，
  // 读取方/resolver/handler 上下文的改动不会穿透回权威状态
  return {
    surfaceId: snapshot.surfaceId,
    catalogId: snapshot.catalogId,
    version: snapshot.version,
    epoch: snapshot.epoch,
    components: new Map(
      [...snapshot.components].map(([id, component]) => [id, structuredClone(component)]),
    ),
    dataModel: structuredClone(snapshot.dataModel),
    contract: cloneContract(snapshot.contract),
  };
}

function cloneContract(contract: SurfaceActionContract): SurfaceActionContract {
  return {
    catalogHash: contract.catalogHash,
    contractVersion: contract.contractVersion,
    catalog: structuredClone(contract.catalog),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSurfaceId(message: unknown): string | undefined {
  if (!isRecord(message)) return undefined;
  for (const payloadKey of ['createSurface', 'updateComponents', 'updateDataModel']) {
    const payload = message[payloadKey];
    if (isRecord(payload) && typeof payload.surfaceId === 'string') return payload.surfaceId;
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
