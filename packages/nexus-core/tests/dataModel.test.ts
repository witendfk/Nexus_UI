import { expect } from 'chai';
import {
  applyDataModelUpdate,
  getByPath,
  removeAtPath,
  resolveContext,
  resolveDynamic,
  setValueAtPath,
  toDisplayString,
} from '../src/dataModel';

describe('dataModel · JSON Pointer get', () => {
  const model = { user: { name: 'Alice', tags: ['a', 'b'] } };

  it('取嵌套值 / 数组索引', () => {
    expect(getByPath(model, '/user/name')).to.equal('Alice');
    expect(getByPath(model, '/user/tags/0')).to.equal('a');
  });
  it('不存在路径 → undefined', () => {
    expect(getByPath(model, '/user/missing')).to.equal(undefined);
    expect(getByPath(undefined, '/x')).to.equal(undefined);
  });
  it('空/根路径返回整模型', () => {
    expect(getByPath(model, '')).to.deep.equal(model);
    expect(getByPath(model, '/')).to.deep.equal(model);
  });
});

describe('dataModel · 转义 ~0 / ~1', () => {
  it('键含 / 和 ~', () => {
    const model = { 'a/b': 1, 'c~d': 2 };
    expect(getByPath(model, '/a~1b')).to.equal(1);
    expect(getByPath(model, '/c~0d')).to.equal(2);
  });
});

describe('dataModel · setValueAtPath（不可变 upsert）', () => {
  it('写入新路径，自动建中间节点；不改入参', () => {
    const model = {};
    const next = setValueAtPath(model, '/user/name', 'Bob');
    expect(next).to.deep.equal({ user: { name: 'Bob' } });
    expect(model).to.deep.equal({});
  });
  it('数字段自动建数组', () => {
    expect(setValueAtPath({}, '/list/0', 'x')).to.deep.equal({ list: ['x'] });
  });
  it('更新已有值', () => {
    expect(setValueAtPath({ a: { b: 1 } }, '/a/b', 2)).to.deep.equal({ a: { b: 2 } });
  });
  it('空路径返回 value', () => {
    expect(setValueAtPath({ a: 1 }, '', { z: 9 })).to.deep.equal({ z: 9 });
  });
});

describe('dataModel · removeAtPath（不可变）', () => {
  it('删对象 key；不改入参', () => {
    const model = { a: 1, b: 2 };
    expect(removeAtPath(model, '/a')).to.deep.equal({ b: 2 });
    expect(model).to.deep.equal({ a: 1, b: 2 });
  });
  it('数组置 undefined（保长度）', () => {
    expect(removeAtPath([1, 2, 3], '/1')).to.deep.equal([1, undefined, 3]);
  });
});

describe('dataModel · applyDataModelUpdate', () => {
  it('无 path：整表替换', () => {
    expect(applyDataModelUpdate({ a: 1 }, { surfaceId: 's', value: { b: 2 } })).to.deep.equal({
      b: 2,
    });
  });
  it('path 无 value：删除', () => {
    expect(applyDataModelUpdate({ a: 1, b: 2 }, { surfaceId: 's', path: '/a' })).to.deep.equal({
      b: 2,
    });
  });
  it('path + value：upsert', () => {
    expect(applyDataModelUpdate({}, { surfaceId: 's', path: '/a/b', value: 5 })).to.deep.equal({
      a: { b: 5 },
    });
  });
});

describe('dataModel · resolveDynamic', () => {
  const model = { user: { name: 'Alice' } };
  it('字面量原样返回', () => {
    expect(resolveDynamic('hi', model)).to.equal('hi');
    expect(resolveDynamic(42, model)).to.equal(42);
  });
  it('{path} 取值', () => {
    expect(resolveDynamic({ path: '/user/name' }, model)).to.equal('Alice');
    expect(resolveDynamic({ path: '/none' }, model)).to.equal(undefined);
  });
});

describe('dataModel · resolveContext', () => {
  it('批量解析 action.context', () => {
    const model = { who: 'Nexus', n: 3 };
    const ctx = { a: 'lit', b: { path: '/who' }, c: { path: '/n' } };
    expect(resolveContext(ctx, model)).to.deep.equal({ a: 'lit', b: 'Nexus', c: 3 });
  });
  it('无 context 返回空对象', () => {
    expect(resolveContext(undefined, {})).to.deep.equal({});
  });
});

describe('dataModel · toDisplayString', () => {
  it('null/undefined → 空', () => {
    expect(toDisplayString(null)).to.equal('');
    expect(toDisplayString(undefined)).to.equal('');
  });
  it('对象 → JSON', () => {
    expect(toDisplayString({ a: 1 })).to.equal('{"a":1}');
  });
});
