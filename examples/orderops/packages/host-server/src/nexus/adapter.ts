import { CatalogRegistry } from '@nexus-ui/core';
import { AgentAdapter, createExternalAgentGenerationSource } from '@nexus-ui/server';
import type { ExternalAgentRpcConfig } from '@nexus-ui/server';
import { ORDEROPS_CATALOG, ORDEROPS_CATALOG_ID } from './catalog';
import { createTicketForSurface, resolveCreateTicketContext } from '../actions/create-ticket';
import type { SqliteDb } from '../db/client';

const registry = new CatalogRegistry([ORDEROPS_CATALOG]);

export interface CreateAgentAdapterOptions {
  /** T3.6：配置后生成走外部 Agent `/rpc`；缺省时 prepareGeneration 显式失败（不静默降级）。 */
  agentRpc?: ExternalAgentRpcConfig;
  /** M3/T4.1：提供后 createTicket 走本地领域事务（resolver 提纯最新备注 + 事务建单）。 */
  db?: SqliteDb;
}

/**
 * M2/M3 装配：生成源 = 外部 Agent RPC（T3.6）；action = 本地领域事务（D4：
 * 事实与执行权在 Host）。resolver 限定 `/draft/note` 提纯最新输入，handler
 * 事务写唯一工单并回禁用按钮 patch（工单号 patch 属 T4.2）。
 */
export function createAgentAdapter(options: CreateAgentAdapterOptions = {}): AgentAdapter {
  const adapter = new AgentAdapter({
    registry,
    ...(options.agentRpc === undefined
      ? {}
      : { createGenerationSource: createExternalAgentGenerationSource(options.agentRpc) }),
    ...(options.db === undefined
      ? {}
      : {
          resolveActionContext: resolveCreateTicketContext,
        }),
  });
  if (options.db !== undefined) {
    const db = options.db;
    adapter.registerActionHandler(ORDEROPS_CATALOG_ID, 'createTicket', (action) => {
      const outcome = createTicketForSurface(db, {
        surfaceId: action.surfaceId,
        note: String(action.context.note ?? ''),
        requestId: action.actionId,
      });
      if (!outcome.ok) throw new Error(outcome.message);
      return ticketCreatedPatch(action.surfaceId, outcome.ticketId);
    });
  }
  return adapter;
}

/**
 * 建单成功的确定性 patch（T4.2）：禁用提交按钮 + 在 /result 定点写工单号
 * （官方 UpdateDataModel 的可选 path 语义，定点合并不清空 draft 等其余字段）。
 */
async function* ticketCreatedPatch(
  surfaceId: string,
  ticketId: string,
): AsyncGenerator<unknown, void, void> {
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
  yield {
    version: 'v0.9',
    updateDataModel: {
      surfaceId,
      path: '/result',
      value: { ticketText: `工单号：${ticketId}`, ticketId },
    },
  };
}
