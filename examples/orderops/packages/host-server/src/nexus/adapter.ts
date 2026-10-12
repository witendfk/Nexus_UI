import { CatalogRegistry } from '@nexus-ui/core';
import { AgentAdapter, createExternalAgentGenerationSource } from '@nexus-ui/server';
import type { ExternalAgentRpcConfig } from '@nexus-ui/server';
import { ORDEROPS_CATALOG, ORDEROPS_CATALOG_ID } from './catalog';

const registry = new CatalogRegistry([ORDEROPS_CATALOG]);

export interface CreateAgentAdapterOptions {
  /** T3.6：配置后生成走外部 Agent `/rpc`；缺省时 prepareGeneration 显式失败（不静默降级）。 */
  agentRpc?: ExternalAgentRpcConfig;
}

/**
 * M2 生成管线（T3.6）：生成源 = 外部 Agent RPC（fixture 双实现已删）；
 * action = 本地 handler（D4：领域事务在 Host，T4.1 起接真实建单事务）。
 */
export function createAgentAdapter(options: CreateAgentAdapterOptions = {}): AgentAdapter {
  const adapter = new AgentAdapter({
    registry,
    ...(options.agentRpc === undefined
      ? {}
      : { createGenerationSource: createExternalAgentGenerationSource(options.agentRpc) }),
  });
  adapter.registerActionHandler(ORDEROPS_CATALOG_ID, 'createTicket', (action) =>
    disableSubmitPatch(action.surfaceId),
  );
  return adapter;
}

/** action 回流穿刺：回一个禁用按钮的 patch，验证 guard → commit → SSE 全链。T4.1 起由本地事务 handler 替换。 */
async function* disableSubmitPatch(surfaceId: string): AsyncGenerator<unknown, void, void> {
  yield {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [
        {
          id: 'submit-ticket',
          component: 'Button',
          child: 'submit-ticket-label',
          disabled: true,
          action: {
            event: {
              name: 'createTicket',
              context: { note: { path: '/draft/note' } },
            },
          },
        },
      ],
    },
  };
}
