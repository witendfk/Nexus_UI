import { expect } from 'chai';
import {
  applyDataModelUpdate,
  getByPath,
  removeAtPath,
  resolveContext,
  resolveDynamic,
  setValueAtPath,
  toDisplayString,
  isUnsafeDataPath,
} from '../src/dataModel';
import { A2UIRuntime } from '../src/runtime';

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
  it('保留段路径：读为 undefined，写/删抛错，原型不被污染', () => {
    const model = { user: { name: 'a' } };
    expect(getByPath(model, '/__proto__/polluted')).to.equal(undefined);
    expect(() => setValueAtPath(model, '/constructor/x', 1)).to.throw(/保留段/);
    expect(() => removeAtPath(model, '/__proto__/x')).to.throw(/保留段/);
    expect(Object.getPrototypeOf(model)).to.equal(Object.prototype);
    expect(isUnsafeDataPath('/a/__proto__/b')).to.equal(true);
    expect(isUnsafeDataPath('/a/b')).to.equal(false);
  });
});

describe('dataModel · L0-04 继承成员不是数据（自身属性遍历）', () => {
  const builtinToString = Object.prototype.toString;
  const builtinValueOf = Object.prototype.valueOf;

  afterEach(() => {
    // 内建函数对象绝不能被改动
    expect(Object.prototype.toString).to.equal(builtinToString);
    expect(Object.prototype.valueOf).to.equal(builtinValueOf);
    expect((builtinToString as unknown as Record<string, unknown>).polluted).to.equal(undefined);
    expect((builtinValueOf as unknown as Record<string, unknown>).polluted).to.equal(undefined);
  });

  it('写：继承名解析为「不存在」→ 创建同名自身数据，内建函数对象不变', () => {
    const next = setValueAtPath({}, '/toString/polluted', true);
    expect(next).to.deep.equal({ toString: { polluted: true } });
    expect(getByPath(next, '/toString/polluted')).to.equal(true);
    expect(Object.prototype.hasOwnProperty.call(next, 'toString')).to.equal(true);
  });

  it('写/删：中间节点是函数 → 显式拒绝，函数对象不被遍历、不被修改', () => {
    const fn = function probe(): void {};
    const fnRecord = fn as unknown as Record<string, unknown>;
    const model = { handler: fn };
    expect(() => setValueAtPath(model, '/handler/polluted', true)).to.throw(/数据容器/);
    expect(() => removeAtPath(model, '/handler/polluted')).to.throw(/数据容器/);
    expect(fnRecord.polluted).to.equal(undefined);
    expect(model.handler).to.equal(fn);
    expect(() => setValueAtPath(model, '/handler/deep/inner', 1)).to.throw(/数据容器/);
  });

  it('写：非容器根（字符串/函数）→ 显式拒绝，不静默丢失写入', () => {
    expect(() => setValueAtPath('str' as unknown, '/a', 1)).to.throw(/数据容器/);
    expect(() => setValueAtPath((() => 1) as unknown, '/a', 1)).to.throw(/数据容器/);
    expect(() => removeAtPath('str' as unknown, '/a')).to.throw(/数据容器/);
    // nullish 根与 undefined 等价：建容器
    expect(setValueAtPath(null, '/a', 1)).to.deep.equal({ a: 1 });
  });

  it('读/删：继承名读为 undefined、删为无操作；合法同名自身数据属性正常读写删', () => {
    expect(getByPath({}, '/toString')).to.equal(undefined);
    expect(getByPath({}, '/valueOf/x')).to.equal(undefined);
    expect(removeAtPath({}, '/toString/x')).to.deep.equal({});

    const own = { toString: { v: 'own-data' }, valueOf: 3 };
    expect(getByPath(own, '/toString/v')).to.equal('own-data');
    expect(getByPath(own, '/valueOf')).to.equal(3);
    expect(setValueAtPath(own, '/toString/v', 'updated')).to.deep.equal({
      toString: { v: 'updated' },
      valueOf: 3,
    });
    expect(removeAtPath(own, '/toString')).to.deep.equal({ valueOf: 3 });
    expect(own).to.deep.equal({ toString: { v: 'own-data' }, valueOf: 3 });
  });

  it('两个独立运行时写同名继承路径互不影响，全局原型不被污染', () => {
    const a = new A2UIRuntime();
    const b = new A2UIRuntime();
    for (const rt of [a, b]) {
      rt.dispatch({
        version: 'v0.9',
        createSurface: { surfaceId: 's', catalogId: 'basic' },
      } as never);
    }
    a.dispatch({
      version: 'v0.9',
      updateDataModel: { surfaceId: 's', path: '/toString/polluted', value: 'from-a' },
    } as never);

    const stateA = a.store.getState();
    const stateB = b.store.getState();
    expect(stateA.errors).to.have.lengthOf(0);
    expect(stateA.dataModelBySurface.s).to.deep.equal({ toString: { polluted: 'from-a' } });
    expect(stateB.dataModelBySurface.s).to.deep.equal(undefined);
    expect(Object.prototype.toString).to.equal(builtinToString);
  });
});
