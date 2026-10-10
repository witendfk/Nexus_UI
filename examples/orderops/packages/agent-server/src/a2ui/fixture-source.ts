import type { RpcGenerateInput } from '../rpc/handler';

/**
 * 确定性 fixture 生成源（T3.3 判据「fixture 生成源 curl 打通」）。
 *
 * T3.4/T3.5 落地后，main.ts 的装配会替换为「分析（fixture/model）→ a2ui/compile」
 * 真实管线；本文件届时降级为回归测试专用或删除，不留双实现。
 *
 * 义务（§10.2）：首条消息必须是匹配 surfaceId/catalogId 的 createSurface，
 * 且组件表含 id=root；组件只使用 Catalog v1 声明的字段。
 */
export async function* fixtureGeneration(input: RpcGenerateInput): AsyncGenerator<unknown, void, void> {
  const { surfaceId, catalogId } = input;
  yield { version: 'v0.9', createSurface: { surfaceId, catalogId } };
  yield {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [
        { id: 'root', component: 'Column', children: ['fixture-title'] },
        { id: 'fixture-title', component: 'Text', text: 'Agent 分析：fixture 确定性输出', variant: 'h3' },
      ],
    },
  };
  yield {
    version: 'v0.9',
    updateDataModel: {
      surfaceId,
      value: { analysis: { source: 'fixture', caseId: input.message } },
    },
  };
}
