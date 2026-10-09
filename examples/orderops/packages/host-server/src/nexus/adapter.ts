import { CatalogRegistry } from '@nexus-ui/core';
import { AgentAdapter } from '@nexus-ui/server';
import type { AgentGenerationSourceRequest, AgentMessageSource } from '@nexus-ui/server';
import { ORDEROPS_CATALOG, ORDEROPS_CATALOG_ID } from './catalog';

const registry = new CatalogRegistry([ORDEROPS_CATALOG]);

/** T1.2 穿刺生成源：手写三条消息替代 Agent RPC；M2 换成 createExternalAgentGenerationSource。 */
async function* toyGeneration(request: AgentGenerationSourceRequest): AgentMessageSource {
  const { surfaceId, catalogId } = request;
  yield { version: 'v0.9', createSurface: { surfaceId, catalogId } };
  yield {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [
        {
          id: 'root',
          component: 'Column',
          children: ['case-title', 'note', 'submit-ticket'],
        },
        {
          id: 'case-title',
          component: 'Text',
          text: { path: '/title' },
          variant: 'h3',
        },
        {
          id: 'note',
          component: 'TextField',
          label: { path: '/noteLabel' },
          value: { path: '/draft/note' },
          variant: 'longText',
        },
        {
          id: 'submit-ticket-label',
          component: 'Text',
          text: { path: '/submitButtonLabel' },
        },
        {
          id: 'submit-ticket',
          component: 'Button',
          child: 'submit-ticket-label',
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
      value: {
        title: '穿刺玩具案件',
        noteLabel: '处理备注',
        submitButtonLabel: '提交工单',
        draft: { note: '' },
      },
    },
  };
}

/** action 回流穿刺：回一个禁用按钮的 patch，验证 guard → commit → SSE 全链。T4.1 起由本地事务 handler 替换。 */
async function* disableSubmitPatch(surfaceId: string): AgentMessageSource {
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

export function createAgentAdapter(): AgentAdapter {
  const adapter = new AgentAdapter({
    registry,
    useLlm: () => false,
    fallbackGeneration: toyGeneration,
  });
  adapter.registerActionHandler(ORDEROPS_CATALOG_ID, 'createTicket', (action) =>
    disableSubmitPatch(action.surfaceId),
  );
  return adapter;
}
