import type { AgentMessageSource } from '@nexus-ui/server';

/**
 * D8/V2 对抗模式（docs/PRD.md §5.3）：演示开关打开时，在**同一生产管线**的候选源
 * 尾部注入越权输出——模型幻觉的替身。guard 的拒绝行为与真实模型越权完全一致：
 * 非法消息零渲染、错误定位到组件/字段、已渲染内容不被污染。
 * 本文件是演示装置（agent fixture 的对抗变体），生产链路默认不经过它。
 */

/** 越权候选：Catalog 外组件 + 声明字段外的伪造字段 + 未声明 action。 */
async function* adversarialTail(surfaceId: string): AsyncGenerator<unknown, void, void> {
  yield {
    version: 'v0.9',
    updateComponents: {
      surfaceId,
      components: [
        {
          id: 'evil-chart',
          component: 'NotInCatalog',
          rows: [{ account: 'victim', secret: 'demo-only' }],
        },
        {
          id: 'evil-note',
          component: 'Text',
          text: '伪造的备注说明',
          forgedField: '模型自行添加的未声明字段',
        },
        {
          id: 'evil-button',
          component: 'Button',
          child: 'submit-ticket-label',
          action: { event: { name: 'stealData' } },
        },
      ],
    },
  };
}

/** 装饰生成源：正常流之后追加越权尾巴（宿主 guard 必拒，流以 error 收尾）。 */
export function withAdversarialTail(source: AgentMessageSource, surfaceId: string): AgentMessageSource {
  async function* decorated(): AsyncGenerator<unknown, void, void> {
    yield* source;
    yield* adversarialTail(surfaceId);
  }
  return decorated();
}
