import { applyDataModelUpdate, resolveContext } from '@nexus-ui/core';
import type {
  Component,
  DynamicValue,
  ServerActionEvent,
  UpdateDataModelPayload,
} from '@nexus-ui/core';

export interface SurfaceActionSnapshot {
  readonly surfaceId: string;
  readonly catalogId: string;
  readonly version: number;
  readonly components: ReadonlyMap<string, Component>;
  readonly dataModel: unknown;
}

interface MutableSurfaceActionSnapshot {
  surfaceId: string;
  catalogId: string;
  version: number;
  components: Map<string, Component>;
  dataModel: unknown;
}

export interface SurfaceActionStateStore {
  get(surfaceId: string): Promise<SurfaceActionSnapshot | undefined>;
  commitGeneration(
    surfaceId: string,
    catalogId: string,
    messages: readonly unknown[],
  ): Promise<void>;
  commitAction(messages: readonly unknown[]): Promise<void>;
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

export interface SurfaceActionLedger {
  begin(record: Omit<SurfaceActionLedgerRecord, 'startedAt' | 'status'>): boolean;
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
  private readonly maxSurfaces: number;

  constructor(options: InMemorySurfaceActionStateStoreOptions = {}) {
    this.maxSurfaces = options.maxSurfaces ?? 256;
  }

  async get(surfaceId: string): Promise<SurfaceActionSnapshot | undefined> {
    const snapshot = this.snapshots.get(surfaceId);
    return snapshot ? cloneSnapshot(snapshot) : undefined;
  }

  async commitGeneration(
    surfaceId: string,
    catalogId: string,
    messages: readonly unknown[],
  ): Promise<void> {
    const next: MutableSurfaceActionSnapshot = {
      surfaceId,
      catalogId,
      version: 1,
      components: new Map(),
      dataModel: undefined,
    };

    for (const message of messages) {
      applyMessage(next, message);
    }

    if (next.components.size === 0) {
      throw new Error('生成流缺少组件，不能建立 action 权威状态');
    }
    this.snapshots.set(surfaceId, next);
    while (this.snapshots.size > this.maxSurfaces) {
      const oldest = this.snapshots.keys().next().value;
      if (oldest === undefined) break;
      this.snapshots.delete(oldest);
    }
  }

  async commitAction(messages: readonly unknown[]): Promise<void> {
    const first = messages.find(isRecord);
    const surfaceId = readSurfaceId(first);
    if (!surfaceId) throw new Error('action 流缺少 surfaceId，不能更新 action 权威状态');

    const current = this.snapshots.get(surfaceId);
    if (!current) throw new Error(`Action surface 不存在: ${surfaceId}`);

    const next = cloneSnapshot(current);
    next.version += 1;
    for (const message of messages) applyMessage(next, message);
    this.snapshots.set(surfaceId, next);
  }
}

export class InMemorySurfaceActionLedger implements SurfaceActionLedger {
  private readonly records = new Map<string, SurfaceActionLedgerRecord>();
  private readonly maxRecords: number;

  constructor({ maxRecords = 1_024 }: { maxRecords?: number } = {}) {
    this.maxRecords = maxRecords;
  }

  begin(record: Omit<SurfaceActionLedgerRecord, 'startedAt' | 'status'>): boolean {
    if (this.records.has(record.key)) return false;
    this.records.set(record.key, {
      ...record,
      startedAt: new Date().toISOString(),
      status: 'running',
    });
    while (this.records.size > this.maxRecords) {
      const oldest = this.records.keys().next().value;
      if (oldest === undefined) break;
      this.records.delete(oldest);
    }
    return true;
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

export function resolveDeclaredActionContext(
  declaration: ServerActionEvent,
  dataModel: unknown,
): Record<string, unknown> {
  return resolveContext(declaration.context as Record<string, DynamicValue>, dataModel);
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
  return {
    ...snapshot,
    components: new Map(snapshot.components),
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
