import { expect } from 'chai';
import { CatalogRegistry } from '../../src/catalog';
import { standardCatalogComponentDeclarations } from '../../src/catalog/standard';
import { removeAtPath, setValueAtPath } from '../../src/dataModel';
import { setStrictPath } from '../../src/dataModel/strict-path';
import { A2UIRuntime } from '../../src/runtime';

function inputRuntime(maxDataModelBytes: number): A2UIRuntime {
  const catalog = {
    catalogId: 'bounded-input',
    components: standardCatalogComponentDeclarations(),
    actions: [],
  };
  const runtime = new A2UIRuntime({
    catalogRegistry: new CatalogRegistry([catalog]),
    maxDataModelBytes,
  });
  runtime.dispatch({
    version: 'v0.9',
    createSurface: { surfaceId: 's', catalogId: catalog.catalogId },
  });
  runtime.dispatch({
    version: 'v0.9',
    updateDataModel: { surfaceId: 's', value: { sent: '', note: '' } },
  });
  runtime.dispatch({
    version: 'v0.9',
    updateComponents: {
      surfaceId: 's',
      components: [
        { id: 'root', component: 'Column', children: ['sent', 'note'] },
        { id: 'sent', component: 'TextField', label: 'sent', value: { path: '/sent' } },
        { id: 'note', component: 'TextField', label: 'note', value: { path: '/note' } },
      ],
    },
  });
  expect(runtime.store.getState().errors).to.deep.equal([]);
  return runtime;
}

/**
 * S4.0 core 直调用资源边界（CURRENT S4 入口项；S2 报告 P3 挂账的修复）：
 * - 两条写路径（协议 setValueAtPath/removeAtPath 与输入 setStrictPath）对数组
 *   越界下标一律确定性拒绝，不稀疏扩长、不用空洞填充；合法下标行为不变；
 * - 数据模型字节与单 surface 组件数量有显式上限：超限整条消息拒绝（状态不变）、
 *   本地输入写回超限返回 false；非法配置构造时抛错。
 * 证伪口径：移除对应保护后拒绝断言失败；合法对照先证明声明与写路径前置可通过。
 */

describe('S4.0 · 写路径数组越界确定性拒绝', () => {
  const model = { tags: ['a', 'b'] };

  it('setValueAtPath 越界下标抛错，入参不变、不稀疏扩长', () => {
    expect(() => setValueAtPath(model, '/tags/5', 'x')).to.throw(/数组下标越界/);
    // 抛错即不扩长：入参与共享模型不变（无稀疏空洞可检查）。
    expect(model).to.deep.equal({ tags: ['a', 'b'] });
  });

  it('removeAtPath 越界下标抛错；界内删除保留长度', () => {
    expect(() => removeAtPath(model, '/tags/9')).to.throw(/数组下标越界/);
    const next = removeAtPath(model, '/tags/1');
    expect((next as { tags: unknown[] }).tags).to.deep.equal(['a', undefined]);
    expect((next as { tags: unknown[] }).tags).to.have.length(2);
  });

  it('中间段越界同样拒绝（自动建节点不得稀疏扩长）；末尾紧凑追加放行', () => {
    expect(() => setValueAtPath(model, '/tags/3/inner', 'x')).to.throw(/数组下标越界/);
    expect(() => setValueAtPath(model, '/matrix/5/0', 1)).to.throw(/数组下标越界/);
    // 对照：空数组上的紧凑追加（自动建数组的第一段）保持原语义。
    expect(setValueAtPath({}, '/matrix/0/0', 1)).to.deep.equal({ matrix: [[1]] });
  });

  it('界内写入行为不变（对照）', () => {
    const next = setValueAtPath(model, '/tags/1', 'B');
    expect((next as { tags: unknown[] }).tags).to.deep.equal(['a', 'B']);
    expect(setValueAtPath({}, '/list/0', 'x')).to.deep.equal({ list: ['x'] });
  });

  it('setStrictPath（输入写回/server inputWrites 共用路径）越界抛错', () => {
    expect(() => setStrictPath(model, '/tags/7', 'x')).to.throw(/数组下标越界/);
    expect(() => setStrictPath({ list: [{ id: 1 }] }, '/list/3/id', 2)).to.throw(/数组下标越界/);
    const next = setStrictPath(model, '/tags/0', 'A');
    expect((next as { tags: unknown[] }).tags).to.deep.equal(['A', 'b']);
  });
});

describe('S4.0 · runtime 模型规模与组件数量上限', () => {
  it('非法配置构造时抛错，0 不表示关闭', () => {
    expect(() => new A2UIRuntime({ maxDataModelBytes: 0 })).to.throw(/maxDataModelBytes/);
    expect(() => new A2UIRuntime({ maxComponentsPerSurface: -1 })).to.throw(
      /maxComponentsPerSurface/,
    );
    expect(() => new A2UIRuntime({ maxDataModelBytes: null as unknown as undefined })).to.throw(
      /maxDataModelBytes/,
    );
  });

  it('updateDataModel 应用后超字节上限：整条消息拒绝，状态不变', () => {
    const runtime = new A2UIRuntime({ maxDataModelBytes: 200 });
    runtime.dispatch({
      version: 'v0.9',
      createSurface: { surfaceId: 'cap-s', catalogId: 'unknown-catalog' },
    } as never);
    const before = JSON.stringify(runtime.store.getState().dataModelBySurface['cap-s']);
    runtime.dispatch({
      version: 'v0.9',
      updateDataModel: { surfaceId: 'cap-s', value: { fill: 'z'.repeat(500) } },
    } as never);
    const errors = runtime.store.getState().errors;
    expect(errors.some((e) => /数据模型字节超过上限/.test(e.message))).to.equal(true);
    expect(JSON.stringify(runtime.store.getState().dataModelBySurface['cap-s'])).to.equal(before);
  });

  it('界内数据模型不受影响（对照）', () => {
    const runtime = new A2UIRuntime({ maxDataModelBytes: 200 });
    runtime.dispatch({
      version: 'v0.9',
      createSurface: { surfaceId: 'cap-ok', catalogId: 'unknown-catalog' },
    } as never);
    runtime.dispatch({
      version: 'v0.9',
      updateDataModel: { surfaceId: 'cap-ok', value: { note: 'ok' } },
    } as never);
    expect(runtime.store.getState().dataModelBySurface['cap-ok']).to.deep.equal({ note: 'ok' });
  });

  it('合法输入恰好达到 UTF-8 字节上限可写，超限拒绝且模型与草稿均不变', () => {
    const cap = 120;
    const runtime = inputRuntime(cap);
    expect(runtime.setInputValue('note', 's', 'value', 'ok')).to.equal(true);
    const overhead = Buffer.byteLength(JSON.stringify({ sent: '', note: '' }));
    const exact = 'z'.repeat(cap - overhead);
    expect(runtime.setInputValue('note', 's', 'value', exact)).to.equal(true);
    const before = runtime.store.getState().dataModelBySurface.s;
    expect(Buffer.byteLength(JSON.stringify(before))).to.equal(cap);
    const drafts = runtime.extractLatestInputDrafts('s');
    for (const value of [exact + 'z', '汉'.repeat(exact.length)]) {
      expect(runtime.setInputValue('note', 's', 'value', value)).to.equal(false);
      expect(runtime.store.getState().dataModelBySurface.s).to.equal(before);
      expect(runtime.extractLatestInputDrafts('s')).to.deep.equal(drafts);
    }
  });

  it('输入数组跳写拒绝且不改草稿，末尾紧凑追加成功', () => {
    const runtime = inputRuntime(120);
    runtime.dispatch({
      version: 'v0.9',
      updateDataModel: { surfaceId: 's', value: { sent: '', note: '', arr: ['a'] } },
    });
    const bind = (path: string) =>
      runtime.dispatch({
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's',
          components: [{ id: 'note', component: 'TextField', label: 'note', value: { path } }],
        },
      });
    bind('/arr/5');
    expect(runtime.store.getState().errors).to.deep.equal([]);
    const before = runtime.store.getState().dataModelBySurface.s;
    const drafts = runtime.extractLatestInputDrafts('s');
    expect(runtime.setInputValue('note', 's', 'value', 'x')).to.equal(false);
    expect(runtime.store.getState().dataModelBySurface.s).to.equal(before);
    expect(runtime.extractLatestInputDrafts('s')).to.deep.equal(drafts);
    bind('/arr/1');
    expect(runtime.setInputValue('note', 's', 'value', 'x')).to.equal(true);
    expect(runtime.store.getState().dataModelBySurface.s).to.deep.equal({
      sent: '',
      note: '',
      arr: ['a', 'x'],
    });
  });

  it('确认时剩余草稿超预算整体拒绝；减少权威模型后可完整恢复并确认', () => {
    const cap = 120;
    const runtime = inputRuntime(cap);
    expect(runtime.setInputValue('sent', 's', 'value', 'sent')).to.equal(true);
    const sent = runtime.extractLatestInputDrafts('s');
    const note = 'n'.repeat(50);
    expect(runtime.setInputValue('note', 's', 'value', note)).to.equal(true);
    const serverModel = { sent: 'normalized', note: '', fill: 'x'.repeat(70) };
    expect(Buffer.byteLength(JSON.stringify(serverModel))).to.be.at.most(cap);
    expect(Buffer.byteLength(JSON.stringify({ ...serverModel, note }))).to.be.greaterThan(cap);
    runtime.dispatch({ version: 'v0.9', updateDataModel: { surfaceId: 's', value: serverModel } });
    expect(runtime.store.getState().errors).to.deep.equal([]);
    const before = runtime.store.getState().dataModelBySurface.s;
    const drafts = runtime.extractLatestInputDrafts('s');
    expect(runtime.confirmInputDrafts(sent)).to.equal(false);
    expect(runtime.store.getState().dataModelBySurface.s).to.equal(before);
    expect(runtime.extractLatestInputDrafts('s')).to.deep.equal(drafts);

    const smaller = { ...serverModel, fill: '' };
    runtime.dispatch({ version: 'v0.9', updateDataModel: { surfaceId: 's', value: smaller } });
    expect(runtime.confirmInputDrafts(sent)).to.equal(true);
    expect(runtime.store.getState().dataModelBySurface.s).to.deep.equal({ ...smaller, note });
    expect(runtime.extractLatestInputDrafts('s').entries).to.deep.equal(
      drafts.entries.filter((entry) => entry.input.componentId === 'note'),
    );
  });

  it('updateComponents 超组件数量上限：整条消息拒绝，状态不变', () => {
    const runtime = new A2UIRuntime({ maxComponentsPerSurface: 3 });
    runtime.dispatch({
      version: 'v0.9',
      createSurface: { surfaceId: 'comp-cap', catalogId: 'unknown-catalog' },
    } as never);
    runtime.dispatch({
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'comp-cap',
        components: [
          { id: 'a', component: 'Text', text: '1' },
          { id: 'b', component: 'Text', text: '2' },
        ],
      },
    } as never);
    runtime.dispatch({
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'comp-cap',
        components: [
          { id: 'c', component: 'Text', text: '3' },
          { id: 'd', component: 'Text', text: '4' },
        ],
      },
    } as never);
    const errors = runtime.store.getState().errors;
    expect(errors.some((e) => /组件数量超过上限/.test(e.message))).to.equal(true);
    expect(
      Object.keys(runtime.store.getState().componentsBySurface['comp-cap']).sort(),
    ).to.deep.equal(['a', 'b']);
  });
});
