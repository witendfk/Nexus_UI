/**
 * S1 证伪测试：resolveContext 对保留段键的原型污染。
 *
 * JSON.parse 是让对象携带自有 `__proto__` 键的唯一字面量入口（对象字面量会命中
 * 原型访问器，写不成自有键）。修复前：自有保留段键经 resolveContext 写入返回对象，
 * `out[key] = ...` 触发 `__proto__` 访问器，把返回对象的 [[Prototype]] 改为攻击者对象。
 * 修复后：遇保留段键显式抛错（信息说明保留段）。
 */
import { expect } from 'chai';
import { resolveContext } from '../../src/dataModel';
import type { DynamicValue } from '../../src/protocol/types';

/** 构造携带自有保留段键的 context（经 JSON.parse 落为自有数据属性）。 */
function ownKeyContext(json: string): Record<string, DynamicValue> {
  return JSON.parse(json) as Record<string, DynamicValue>;
}

describe('resolveContext · 保留段键（原型污染防线）', () => {
  const model = { price: 7, name: 'nexus' };

  it('自有 __proto__ 键 → 显式抛错，不再改写返回对象原型', () => {
    const context = ownKeyContext('{"__proto__": {"polluted": "yes"}}');
    expect(() => resolveContext(context, model)).to.throw(/保留段/);
  });

  it('自有 constructor / prototype 键 → 显式抛错', () => {
    expect(() => resolveContext(ownKeyContext('{"constructor": 1}'), model)).to.throw(/保留段/);
    expect(() => resolveContext(ownKeyContext('{"prototype": 1}'), model)).to.throw(/保留段/);
  });

  it('正常键不受影响：解析为真值且返回对象原型是 Object.prototype', () => {
    const out = resolveContext({ price: { path: '/price' }, note: 'ok' }, model);
    expect(out).to.deep.equal({ price: 7, note: 'ok' });
    expect(Object.getPrototypeOf(out)).to.equal(Object.prototype);
  });
});
