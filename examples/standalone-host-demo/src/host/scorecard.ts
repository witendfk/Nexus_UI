import type { AgentActionHandler, AgentGenerationSource } from '@nexus-ui/server';
import { SCORECARD_ACTION, SCORECARD_CATALOG_ID } from '../shared/scorecard-contract';

/**
 * S2.6.2.2 确定性夹具：不依赖外部 Agent RPC，支持连续 patch（handler 无状态，
 * 每次按当前权威参数重新生成 note）。surfaceId 由服务端分配。
 */
export function createScorecardFixture(surfaceId: string): unknown[] {
  return [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId,
        catalogId: SCORECARD_CATALOG_ID,
        theme: { primaryColor: '#0f766e' },
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          {
            id: 'root',
            component: 'Column',
            children: ['summary', 'scoreDial', 'pinnedToggle', 'submitCard'],
          },
        ],
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          {
            id: 'summary',
            component: 'FeedbackSummary',
            title: { path: '/title' },
            note: { path: '/note' },
          },
          { id: 'scoreDial', component: 'ScoreDial', score: { path: '/score' } },
          { id: 'pinnedToggle', component: 'PinnedToggle', pinned: { path: '/pinned' } },
          {
            id: 'submitCard',
            component: 'SubmitCard',
            children: ['submitCardLabel'],
            action: {
              event: {
                name: SCORECARD_ACTION,
                context: {
                  score: { path: '/score' },
                  pinned: { path: '/pinned' },
                },
              },
            },
          },
          { id: 'submitCardLabel', component: 'Text', text: '记录反馈' },
        ],
      },
    },
    {
      version: 'v0.9',
      updateDataModel: {
        surfaceId,
        value: {
          title: '会话反馈',
          note: '给本次会话打分并选择是否置顶',
          score: 50,
          pinned: false,
        },
      },
    },
  ];
}

/** 确定性生成源：忽略历史与请求文案，直接产出夹具流。 */
export const scorecardGenerationSource: AgentGenerationSource = (request) => {
  return (async function* () {
    yield* createScorecardFixture(request.surfaceId);
  })();
};

/**
 * 确定性 action handler：参数取服务端重算后的权威 context；patch 只做同
 * surface 的数据更新，不 create/delete surface，可连续提交。
 */
export const scorecardActionHandler: AgentActionHandler = (action) => {
  if (action.name !== SCORECARD_ACTION) {
    throw new Error(`Scorecard Agent 不支持 action: ${action.name}`);
  }
  const score = action.context.score;
  const pinned = action.context.pinned === true;
  return [
    {
      version: 'v0.9',
      updateDataModel: {
        surfaceId: action.surfaceId,
        path: '/note',
        value: `已记录：score=${String(score)}，pinned=${pinned ? 'true' : 'false'}`,
      },
    },
  ];
};
