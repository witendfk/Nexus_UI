import type { AgentTurn } from './llm-agent';

export interface SurfaceHistoryStore {
  getHistory(surfaceId: string): Promise<readonly AgentTurn[]>;
  getCatalogId(surfaceId: string): Promise<string | undefined>;
  commitGeneration(
    surfaceId: string,
    catalogId: string,
    turns: readonly AgentTurn[],
  ): Promise<void>;
}

export interface InMemorySurfaceHistoryStoreOptions {
  maxSurfaces?: number;
  maxTurnsPerSurface?: number;
}

const DEFAULT_MAX_SURFACES = 64;
const DEFAULT_MAX_TURNS_PER_SURFACE = 20;

function cloneTurns(turns: readonly AgentTurn[]): AgentTurn[] {
  return turns.map((turn) => ({ ...turn }));
}

export class InMemorySurfaceHistoryStore implements SurfaceHistoryStore {
  private readonly historiesBySurface = new Map<string, AgentTurn[]>();
  private readonly catalogsBySurface = new Map<string, string>();
  private readonly surfaceIds = new Set<string>();
  private readonly maxSurfaces: number;
  private readonly maxTurnsPerSurface: number;

  constructor({
    maxSurfaces = DEFAULT_MAX_SURFACES,
    maxTurnsPerSurface = DEFAULT_MAX_TURNS_PER_SURFACE,
  }: InMemorySurfaceHistoryStoreOptions = {}) {
    this.maxSurfaces = maxSurfaces;
    this.maxTurnsPerSurface = maxTurnsPerSurface;
  }

  async getHistory(surfaceId: string): Promise<readonly AgentTurn[]> {
    return cloneTurns(this.historiesBySurface.get(surfaceId) ?? []);
  }

  async getCatalogId(surfaceId: string): Promise<string | undefined> {
    return this.catalogsBySurface.get(surfaceId);
  }

  async commitGeneration(
    surfaceId: string,
    catalogId: string,
    turns: readonly AgentTurn[],
  ): Promise<void> {
    this.touchSurface(surfaceId);
    this.catalogsBySurface.set(surfaceId, catalogId);
    if (turns.length === 0) return;
    const history = this.historiesBySurface.get(surfaceId) ?? [];
    history.push(...cloneTurns(turns));
    while (history.length > this.maxTurnsPerSurface) history.shift();
    this.historiesBySurface.set(surfaceId, history);
    this.touchSurface(surfaceId);
  }

  private touchSurface(surfaceId: string): void {
    if (this.surfaceIds.has(surfaceId)) return;
    this.surfaceIds.add(surfaceId);
    while (this.surfaceIds.size > this.maxSurfaces) {
      const oldestSurface = this.surfaceIds.keys().next().value;
      if (oldestSurface === undefined) break;
      this.surfaceIds.delete(oldestSurface);
      this.historiesBySurface.delete(oldestSurface);
      this.catalogsBySurface.delete(oldestSurface);
    }
  }
}

const defaultSurfaceHistoryStore = new InMemorySurfaceHistoryStore();
export { defaultSurfaceHistoryStore };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function findSurfaceCatalog(
  messages: unknown[],
): { surfaceId: string; catalogId: string } | undefined {
  for (const message of messages) {
    if (!isRecord(message) || !isRecord(message.createSurface)) continue;
    if (typeof message.createSurface.surfaceId !== 'string') continue;
    if (typeof message.createSurface.catalogId !== 'string') continue;
    return {
      surfaceId: message.createSurface.surfaceId,
      catalogId: message.createSurface.catalogId,
    };
  }
  return undefined;
}
