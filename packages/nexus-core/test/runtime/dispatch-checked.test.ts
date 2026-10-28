import { expect } from 'chai';
import { A2UIRuntime } from '../../src/runtime';
import { CatalogRegistry } from '../../src/catalog';
import { standardCatalogComponentDeclarations } from '../../src/catalog/standard';

describe('dispatchChecked 完整准入结果', () => {
  it('错误日志达到容量仍返回本次拒绝，不以累计错误数量推断成功', () => {
    const runtime = new A2UIRuntime({ maxDataModelBytes: 32 });
    const create = { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: 'c' } };
    expect(runtime.dispatchChecked(create).ok).to.equal(true);
    const update = (note: string) => ({
      version: 'v0.9',
      updateDataModel: { surfaceId: 's', value: { note } },
    });
    expect(runtime.dispatchChecked(update('ok')).ok).to.equal(true);
    for (let i = 0; i < 205; i++) runtime.dispatchChecked({});
    const errorCount = runtime.store.getState().errors.length;
    const result = runtime.dispatchChecked(update('x'.repeat(100)));
    expect(result.ok).to.equal(false);
    expect(result.error?.code).to.equal('FEATURE_UNSUPPORTED');
    expect(runtime.store.getState().errors.length).to.equal(errorCount);
    expect(runtime.store.getState().dataModelBySurface.s).to.deep.equal({ note: 'ok' });
    expect(runtime.dispatchChecked(create).error?.code).to.equal('LIFECYCLE_INVALID');
    expect(runtime.dispatchChecked(update('new')).ok).to.equal(true);
  });

  it('复用 Protocol/Profile/Catalog 校验，并保留 dispatch 的 void 兼容', () => {
    const runtime = new A2UIRuntime({
      catalogRegistry: new CatalogRegistry([
        {
          catalogId: 'c',
          components: standardCatalogComponentDeclarations(),
          actions: [],
        },
      ]),
    });
    expect(runtime.dispatchChecked({}).error?.code).to.equal('PROTOCOL_INVALID');
    expect(
      runtime.dispatchChecked({
        version: 'v0.9',
        createSurface: { surfaceId: 's', catalogId: 'missing' },
      }).ok,
    ).to.equal(false);
    expect(
      runtime.dispatch({ version: 'v0.9', createSurface: { surfaceId: 's', catalogId: 'c' } }),
    ).to.equal(undefined);
    expect(
      runtime.dispatchChecked({
        version: 'v0.9',
        updateComponents: { surfaceId: 's', components: [{ id: 'root', component: 'Unknown' }] },
      }).ok,
    ).to.equal(false);
    expect(
      runtime.dispatchChecked({
        version: 'v0.9',
        updateDataModel: { surfaceId: 's', path: '/__proto__/x', value: 1 },
      }).ok,
    ).to.equal(false);
    expect(runtime.store.getState().dataModelBySurface.s).to.equal(undefined);
  });
});
