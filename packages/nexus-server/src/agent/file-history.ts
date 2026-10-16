import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { AgentTurn } from './llm-agent';
import type { SurfaceHistoryStore } from './history';

interface SurfaceRecord {
  surfaceId: string;
  catalogId: string;
  turns: AgentTurn[];
}

interface PersistedSurfaceHistory {
  version: 1;
  surfaces: SurfaceRecord[];
}

export interface FileSurfaceHistoryStoreOptions {
  maxSurfaces?: number;
  maxTurnsPerSurface?: number;
}

const DEFAULT_MAX_SURFACES = 64;
const DEFAULT_MAX_TURNS_PER_SURFACE = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTurn(value: unknown): value is AgentTurn {
  return (
    isRecord(value) &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.content === 'string'
  );
}

function parseSurfaceRecord(value: unknown): SurfaceRecord {
  if (
    !isRecord(value) ||
    typeof value.surfaceId !== 'string' ||
    value.surfaceId.length === 0 ||
    typeof value.catalogId !== 'string' ||
    value.catalogId.length === 0 ||
    !Array.isArray(value.turns) ||
    !value.turns.every(isTurn)
  ) {
    throw new Error('Surface history 文件中的 surface 记录格式非法');
  }

  return {
    surfaceId: value.surfaceId,
    catalogId: value.catalogId,
    turns: value.turns.map((turn) => ({ ...turn })),
  };
}

function parsePersistedHistory(source: string, filePath: string): PersistedSurfaceHistory {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(
      `Surface history 文件不是合法 JSON: ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.surfaces) ||
    !value.surfaces.every(isRecord)
  ) {
    throw new Error(`Surface history 文件格式非法: ${filePath}`);
  }

  const surfaces = value.surfaces.map(parseSurfaceRecord);
  const surfaceIds = new Set<string>();
  for (const surface of surfaces) {
    if (surfaceIds.has(surface.surfaceId)) {
      throw new Error(`Surface history 文件包含重复 surfaceId: ${surface.surfaceId}`);
    }
    surfaceIds.add(surface.surfaceId);
  }

  return { version: 1, surfaces };
}

function cloneRecords(records: readonly SurfaceRecord[]): SurfaceRecord[] {
  return records.map((record) => ({
    ...record,
    turns: record.turns.map((turn) => ({ ...turn })),
  }));
}

function createNextRecords(
  records: readonly SurfaceRecord[],
  surfaceId: string,
  catalogId: string,
  turns: readonly AgentTurn[],
  maxSurfaces: number,
  maxTurnsPerSurface: number,
): SurfaceRecord[] {
  const retained = records.filter((record) => record.surfaceId !== surfaceId);
  const previous = records.find((record) => record.surfaceId === surfaceId);
  const nextTurns = [...(previous?.turns ?? []), ...turns].slice(-maxTurnsPerSurface);
  retained.push({
    surfaceId,
    catalogId,
    turns: nextTurns.map((turn) => ({ ...turn })),
  });
  return retained.slice(-maxSurfaces);
}

/**
 * Single-process, restart-safe file adapter for the host-injectable history store.
 * Writes are serialized and use a same-directory temporary file plus rename.
 */
export class FileSurfaceHistoryStore implements SurfaceHistoryStore {
  private readonly filePath: string;
  private readonly maxSurfaces: number;
  private readonly maxTurnsPerSurface: number;
  private records: SurfaceRecord[] = [];
  private loadPromise: Promise<void> | undefined;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string, options: FileSurfaceHistoryStoreOptions = {}) {
    if (filePath.trim().length === 0) throw new Error('Surface history 文件路径不能为空');
    this.filePath = resolve(filePath);
    this.maxSurfaces = options.maxSurfaces ?? DEFAULT_MAX_SURFACES;
    this.maxTurnsPerSurface = options.maxTurnsPerSurface ?? DEFAULT_MAX_TURNS_PER_SURFACE;
  }

  initialize(): Promise<void> {
    this.loadPromise ??= this.load();
    return this.loadPromise;
  }

  async getHistory(surfaceId: string): Promise<readonly AgentTurn[]> {
    await this.initialize();
    const record = this.records.find((item) => item.surfaceId === surfaceId);
    return record ? record.turns.map((turn) => ({ ...turn })) : [];
  }

  async getCatalogId(surfaceId: string): Promise<string | undefined> {
    await this.initialize();
    return this.records.find((item) => item.surfaceId === surfaceId)?.catalogId;
  }

  commitGeneration(
    surfaceId: string,
    catalogId: string,
    turns: readonly AgentTurn[],
  ): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      await this.initialize();
      const nextRecords = createNextRecords(
        this.records,
        surfaceId,
        catalogId,
        turns,
        this.maxSurfaces,
        this.maxTurnsPerSurface,
      );
      await this.writeAtomically(nextRecords);
      this.records = nextRecords;
    });

    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  private async load(): Promise<void> {
    let source: string;
    try {
      source = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.records = [];
        return;
      }
      throw error;
    }

    const persisted = parsePersistedHistory(source, this.filePath);
    this.records = cloneRecords(persisted.surfaces);
  }

  private async writeAtomically(records: readonly SurfaceRecord[]): Promise<void> {
    const payload: PersistedSurfaceHistory = {
      version: 1,
      surfaces: cloneRecords(records),
    };
    const directory = dirname(this.filePath);
    const temporaryPath = join(directory, `.${basename(this.filePath)}.${randomUUID()}.tmp`);

    try {
      await mkdir(directory, { recursive: true });
      await writeFile(temporaryPath, `${JSON.stringify(payload, undefined, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
