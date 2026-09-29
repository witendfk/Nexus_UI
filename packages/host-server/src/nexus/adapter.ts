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
          children: ['case-title', 'note', 'ping'],
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
          id: 'ping-label',
          component: 'Text',
          text: { path: '/pingLabel' },
        },
        {
          id: 'ping',
          component: 'Button',
          child: 'ping-label',
          action: {
            event: {
              name: 'ping',
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
        pingLabel: 'Ping',
        draft: { note: '' },
      },
    },
  };
}

/** action 回流穿刺：回一个禁用按钮的 patch，验证 guard → commit → SSE 全链。 */
async function* pingPatch(surfaceId: string): AgentMessageSource {
  yield {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [
        {
          id: 'ping',
          component: 'Button',
          child: 'ping-label',
          disabled: true,
          action: {
            event: {
              name: 'ping',
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
  adapter.registerActionHandler(ORDEROPS_CATALOG_ID, 'ping', (action) =>
    pingPatch(action.surfaceId),
  );
  return adapter;
}
