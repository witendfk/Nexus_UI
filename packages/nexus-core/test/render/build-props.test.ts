/**
 * S1 证伪测试：渲染层 buildProps 对组件保留段自有键的继承属性防线。
 *
 * 修复前：组件对象的自有 `__proto__` 键（JSON.parse 注入）被逐键写入
 * `props[k] = v`，触发 `__proto__` 访问器把 VNode.props 的 [[Prototype]]
 * 改写为攻击者对象；`constructor` 等保留键也会作为杂质进入 props。
 * 修复后：保留段键一律跳过写入（运行层防御，静默跳过不进 props）。
 */
import { expect } from 'chai';
import { buildTree } from '../../src/render';
import type { Component, VNode } from '../../src/protocol/types';

/** 经 JSON.parse 构造携带自有保留段键的组件（字面量写不成自有 __proto__ 键）。 */
function parseComponent(json: string): Component {
  return JSON.parse(json) as Component;
}

const root: Component = { id: 'root', component: 'Row', children: ['t1'] };

function firstChildProps(component: Component): Record<string, unknown> {
  const tree = buildTree({ root, t1: component }, 's', {});
  const child = tree?.children?.[0] as VNode | undefined;
  if (!child) throw new Error('子组件未构建');
  return child.props as Record<string, unknown>;
}

describe('buildProps · 保留段键（继承属性防线）', () => {
  it('组件自有 __proto__ 键不写入 props，props 原型保持 Object.prototype', () => {
    const malicious = parseComponent(
      '{"id":"t1","component":"Text","text":"hi","__proto__":{"polluted":true}}',
    );
    const props = firstChildProps(malicious);
    expect(Object.getPrototypeOf(props)).to.equal(Object.prototype);
    expect(Object.keys(props)).to.deep.equal(['text']);
    expect(props.polluted).to.equal(undefined);
  });

  it('组件自有 constructor / prototype 键同样跳过，不进入 props', () => {
    const constructorKey = parseComponent(
      '{"id":"t1","component":"Text","text":"hi","constructor":1}',
    );
    expect(Object.keys(firstChildProps(constructorKey))).to.deep.equal(['text']);

    const prototypeKey = parseComponent('{"id":"t1","component":"Text","text":"hi","prototype":1}');
    expect(Object.keys(firstChildProps(prototypeKey))).to.deep.equal(['text']);
  });

  it('普通 props 键不受影响', () => {
    const normal: Component = { id: 't1', component: 'Text', text: 'hi' };
    expect(firstChildProps(normal)).to.deep.equal({ text: 'hi' });
  });
});
