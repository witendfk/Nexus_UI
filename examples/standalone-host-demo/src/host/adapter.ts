import {
  AgentAdapter,
  createExternalAgentActionHandler,
  createExternalAgentGenerationSource,
  InMemorySurfaceHistoryStore,
} from '@nexus-ui/server';
import type {
  AgentActionHandler,
  AgentGenerationSource,
  AgentPolicy,
  ExternalAgentRpcConfig,
} from '@nexus-ui/server';
import { DEMO_AGENT_CATALOG_ID, DEMO_AGENT_ACTION } from '../contract';
import {
  createStandaloneHostRegistry,
  SCORECARD_ACTION,
  SCORECARD_CATALOG_ID,
} from '../shared/catalog';
import { scorecardActionHandler, scorecardGenerationSource } from './scorecard';

export interface StandaloneHostAdapterOptions extends ExternalAgentRpcConfig {
  createSurfaceId?: () => string;
  actionHandler?: AgentActionHandler;
  policy?: AgentPolicy;
}

/** S2.6.2.2 可信白名单：审批面无输入组件；反馈面只开放 score/pinned 两个绑定。 */
const HOST_EDITABLE_PATHS: ReadonlyMap<string, readonly string[]> = new Map([
  [DEMO_AGENT_CATALOG_ID, []],
  [SCORECARD_CATALOG_ID, ['/score', '/pinned']],
]);

const SURFACE_CATALOG_CAPACITY = 512;

/**
 * surface → catalog 映射与 playground 同一语义：生成提交边界刷新、容量淘汰、
 * 未记录 surface 返回空数组（非空输入走 SDK 缺省拒绝）。
 */
class HostSurfaceCatalogIndex {
  private readonly entries = new Map<string, string>();

  record(surfaceId: string, catalogId: string): void {
    this.entries.delete(surfaceId);
    this.entries.set(surfaceId, catalogId);
    while (this.entries.size > SURFACE_CATALOG_CAPACITY) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  catalogOf(surfaceId: string): string | undefined {
    return this.entries.get(surfaceId);
  }
}

/**
 * Assemble a host-owned Agent Adapter with two custom catalogs: the approval
 * flow runs through the external JSONL RPC Agent, the neutral scorecard fixture
 * uses a deterministic local source. Every message still passes the same
 * server guard.
 */
export function createStandaloneHostAdapter(options: StandaloneHostAdapterOptions): AgentAdapter {
  const actionHandler = options.actionHandler ?? createExternalAgentActionHandler(options);
  const externalGenerationSource = createExternalAgentGenerationSource(options);
  // 审批 Catalog 仍走外部 RPC；中立夹具走确定性本地源（S2.6.2.2）。
  const generationSource: AgentGenerationSource = (request) =>
    request.catalogId === SCORECARD_CATALOG_ID
      ? scorecardGenerationSource(request)
      : externalGenerationSource(request);

  const surfaceCatalogIndex = new HostSurfaceCatalogIndex();
  const adapter = new AgentAdapter({
    registry: createStandaloneHostRegistry(),
    actionHandlers: new Map(),
    historyStore: new InMemorySurfaceHistoryStore(),
    useLlm: () => false,
    createSurfaceId: options.createSurfaceId,
    createGenerationSource: generationSource,
    policy: options.policy,
    editablePaths: (surfaceId) => {
      const catalogId = surfaceCatalogIndex.catalogOf(surfaceId);
      return catalogId === undefined ? [] : (HOST_EDITABLE_PATHS.get(catalogId) ?? []);
    },
    onGenerationCommitted: (event) => {
      surfaceCatalogIndex.record(event.surfaceId, event.catalogId);
    },
  });
  adapter.registerActionHandler(DEMO_AGENT_CATALOG_ID, DEMO_AGENT_ACTION, actionHandler);
  adapter.registerActionHandler(SCORECARD_CATALOG_ID, SCORECARD_ACTION, scorecardActionHandler);
  return adapter;
}
