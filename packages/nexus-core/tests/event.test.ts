import { expect } from 'chai';
import { buildActionEvent } from '../src/action';
import type { Component } from '../src/protocol/types';

describe('buildActionEvent', () => {
  it('组件无 action → null', () => {
    expect(buildActionEvent({ id: 't', component: 'Text', text: 'x' }, 's', {})).to.equal(null);
  });

  it('解析 context 的 {path} 绑定', () => {
    const component: Component = {
      id: 'btn',
      component: 'Button',
      action: { event: { name: 'ping', context: { who: { path: '/who' }, n: 3 } } },
    };
    expect(buildActionEvent(component, 'demo', { who: 'Nexus' })).to.deep.equal({
      name: 'ping',
      surfaceId: 'demo',
      sourceComponentId: 'btn',
      context: { who: 'Nexus', n: 3 },
    });
  });

  it('无 context → 空 context', () => {
    const component: Component = {
      id: 'btn',
      component: 'Button',
      action: { event: { name: 'go' } },
    };
    expect(buildActionEvent(component, 's', {})).to.deep.equal({
      name: 'go',
      surfaceId: 's',
      sourceComponentId: 'btn',
      context: {},
    });
  });
});
