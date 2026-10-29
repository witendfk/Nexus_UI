import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  A2UIRuntime,
  CatalogRegistry,
  standardCatalogComponentDeclarations,
  type CatalogDefinition,
  type SurfaceViewSnapshot,
} from '../../src/index';

/**
 * S4.1.2 检查点 A · core 受控状态原语：
 * - getSurfaceView 稳定读取（引用稳定）+ 出界深拷贝；
 * - restoreSurfaceView 校验后原子替换（Catalog 重验/资源预算/root/引用隔离），
 *   替换清除该 surface 草稿；恢复拒绝时原视图、草稿完全不变；
 * - subscribeSurface 按 surface 精确通知，解除后不再通知；
 * - 替换/删除 surface B 不影响 surface A。
 */

function catalog(): CatalogDefinition {
  return {
    catalogId: 'https://example.com/catalogs/view-test/v1',
    components: {
      ...standardCatalogComponentDeclarations(),
      Text: {
        ...standardCatalogComponentDeclarations().Text,
        inputs: { text: { type: 'string', maxLength: 200 } },
      },
    },
    actions: [],
  };
}

function makeRuntime(overrides: Record<string, unknown> = {}) {
  const registry = new CatalogRegistry([catalog()]);
  const runtime = new A2UIRuntime({ catalogRegistry: registry, ...overrides });
  const id = 'view-1';
  runtime.dispatch({
    version: 'v0.9',
    createSurface: { surfaceId: id, catalogId: 'https://example.com/catalogs/view-test/v1' },
  } as never);
  runtime.dispatch({
    version: 'v0.9',
    updateComponents: {
      surfaceId: id,
      components: [
        { id: 'root', component: 'Column', children: ['label'] },
        { id: 'label', component: 'Text', text: { path: '/note' } },
      ],
    },
  } as never);
  runtime.dispatch({
    version: 'v0.9',
    updateDataModel: { surfaceId: id, value: { note: 'v1' } },
  } as never);
  return { runtime, registry, surfaceId: id };
}

describe('S4.1.2-A · getSurfaceView 稳定读取与出界隔离', () => {
  it('快照冻结且出界：修改返回值在严格模式抛错；未变时引用稳定', () => {
    const { runtime, surfaceId } = makeRuntime();
    const first = runtime.getSurfaceView(surfaceId)!;
    assert.ok(first);
    assert.throws(
      () => {
        (first.components[0] as unknown as { id: string }).id = 'mutated';
      },
      TypeError,
      '冻结快照防消费方误改',
    );
    const again = runtime.getSurfaceView(surfaceId)!;
    assert.equal(again, first, '底层未变时引用稳定');
    assert.equal(again.components[0].id, 'root');
    assert.deepEqual(again.dataModel, { note: 'v1' });
  });

  it('状态变化后快照刷新（新引用、新内容）', () => {
    const { runtime, surfaceId } = makeRuntime();
    const before = runtime.getSurfaceView(surfaceId)!;
    runtime.dispatch({
      version: 'v0.9',
      updateDataModel: { surfaceId, value: { note: 'v2' } },
    } as never);
    const after = runtime.getSurfaceView(surfaceId)!;
    assert.notEqual(after, before);
    assert.deepEqual(after.dataModel, { note: 'v2' });
  });
});

describe('S4.1.2-A · restoreSurfaceView 校验后原子替换', () => {
  it('合法快照：整体替换成功且清除该 surface 草稿；数据模型/组件一致', () => {
    const { runtime, surfaceId } = makeRuntime();
    assert.equal(runtime.setInputValue('label', surfaceId, 'text', '本地草稿'), true);
    assert.ok(runtime.getLatestInputs(surfaceId).length > 0);
    const snapshot: SurfaceViewSnapshot = {
      surfaceId,
      catalogId: 'https://example.com/catalogs/view-test/v1',
      components: [
        { id: 'root', component: 'Column', children: ['label'] },
        { id: 'label', component: 'Text', text: { path: '/note' } },
      ],
      dataModel: { note: 'restored' },
    };
    runtime.restoreSurfaceView(snapshot);
    const view = runtime.getSurfaceView(surfaceId)!;
    assert.deepEqual(view.dataModel, { note: 'restored' });
    assert.equal(runtime.getLatestInputs(surfaceId).length, 0, '替换清除旧草稿');
  });

  it('恢复拒绝（缺 root/未注册 Catalog/超预算/catalogId 变更）：原视图与草稿完全不变', () => {
    const { runtime, surfaceId } = makeRuntime();
    assert.equal(runtime.setInputValue('label', surfaceId, 'text', 'keep'), true);
    const before = runtime.getSurfaceView(surfaceId)!;
    const drafts = runtime.getLatestInputs(surfaceId);

    const noRoot: SurfaceViewSnapshot = { ...before, components: [before.components[1]] };
    assert.throws(() => runtime.restoreSurfaceView(noRoot), /root/);
    const wrongCatalog: SurfaceViewSnapshot = { ...before, catalogId: 'https://other/catalog' };
    assert.throws(() => runtime.restoreSurfaceView(wrongCatalog), /绑定不一致|未注册/);
    const oversized: SurfaceViewSnapshot = {
      ...before,
      dataModel: { note: 'x'.repeat(2_000_000) },
    };
    assert.throws(() => runtime.restoreSurfaceView(oversized), /字节超过上限/);

    // 拒绝后原视图、基准与草稿完全不变（原子性）。
    const after = runtime.getSurfaceView(surfaceId)!;
    assert.deepEqual(after.dataModel, before.dataModel);
    assert.deepEqual(after.components, before.components);
    assert.deepEqual(runtime.getLatestInputs(surfaceId), drafts);
  });

  it('入界引用隔离：恢复后修改传入快照不影响内部状态', () => {
    const { runtime, surfaceId } = makeRuntime();
    const snapshot: SurfaceViewSnapshot = {
      surfaceId,
      catalogId: 'https://example.com/catalogs/view-test/v1',
      components: [
        { id: 'root', component: 'Column', children: ['label'] },
        { id: 'label', component: 'Text', text: { path: '/note' } },
      ],
      dataModel: { note: 'restored' },
    };
    runtime.restoreSurfaceView(snapshot);
    (snapshot.components[1] as unknown as { text: unknown }).text = 'mutated';
    (snapshot.dataModel as { note: string }).note = 'mutated';
    assert.deepEqual(runtime.getSurfaceView(surfaceId)!.dataModel, { note: 'restored' });
  });

  it('恢复未通过 Catalog 校验（组件不支持）整体拒绝', () => {
    const { runtime, surfaceId } = makeRuntime();
    const snapshot: SurfaceViewSnapshot = {
      surfaceId,
      catalogId: 'https://example.com/catalogs/view-test/v1',
      components: [
        { id: 'root', component: 'Column', children: ['ghost'] },
        { id: 'ghost', component: 'Ghost' },
      ],
      dataModel: { note: 'x' },
    };
    assert.throws(() => runtime.restoreSurfaceView(snapshot), /Catalog 校验/);
    assert.deepEqual(runtime.getSurfaceView(surfaceId)!.dataModel, { note: 'v1' });
  });
});

describe('S4.1.2-A · subscribeSurface 与隔离', () => {
  it('仅本 surface 变化通知；解除后不再通知；B surface 变化不触发 A 订阅', () => {
    const { runtime, surfaceId: surfaceA } = makeRuntime();
    let notifications = 0;
    const unsubscribe = runtime.subscribeSurface(surfaceA, () => {
      notifications += 1;
    });
    // A 的数据模型变化 → 通知。
    runtime.dispatch({
      version: 'v0.9',
      updateDataModel: { surfaceId: surfaceA, value: { note: 'v2' } },
    } as never);
    assert.equal(notifications, 1);
    // 另一 surface 的创建与变化 → 不通知。
    runtime.dispatch({
      version: 'v0.9',
      createSurface: {
        surfaceId: 'view-2',
        catalogId: 'https://example.com/catalogs/view-test/v1',
      },
    } as never);
    runtime.dispatch({
      version: 'v0.9',
      updateDataModel: { surfaceId: 'view-2', value: { note: 'other' } },
    } as never);
    assert.equal(notifications, 1, 'B surface 变化不触发 A 订阅');
    // A 再变化 → 通知；解除后不再通知。
    runtime.dispatch({
      version: 'v0.9',
      updateDataModel: { surfaceId: surfaceA, value: { note: 'v3' } },
    } as never);
    assert.equal(notifications, 2);
    unsubscribe();
    runtime.dispatch({
      version: 'v0.9',
      updateDataModel: { surfaceId: surfaceA, value: { note: 'v4' } },
    } as never);
    assert.equal(notifications, 2, '解除订阅后不再通知');
  });
});

describe('S4 复核 · 完整准入与发布原子性', () => {
  it('合法恢复成功后，非法媒体 URL、保留 id、协议形状和引用环均不改变状态/草稿', () => {
    const { runtime, surfaceId } = makeRuntime();
    runtime.restoreSurfaceView(runtime.getSurfaceView(surfaceId)!);
    assert.equal(runtime.setInputValue('label', surfaceId, 'text', 'keep'), true);
    const before = runtime.getSurfaceView(surfaceId)!;
    const drafts = runtime.extractLatestInputDrafts(surfaceId);
    const invalid = [
      [{ id: 'root', component: 'Video', url: 'javascript:alert(1)' }],
      [
        { id: 'root', component: 'Column', children: ['__proto__'] },
        { id: '__proto__', component: 'Text', text: 'x' },
      ],
      [{ id: 'root', component: 'Column', children: 'invalid' }],
      [{ id: 'root', component: 'Column', children: ['missing'] }],
      [
        { id: 'root', component: 'Column', children: ['label'] },
        { id: 'label', component: 'Column', child: 'root' },
      ],
    ];
    for (const components of invalid) {
      assert.throws(() =>
        runtime.restoreSurfaceView({ ...before, components } as SurfaceViewSnapshot),
      );
      assert.equal(runtime.getSurfaceView(surfaceId), before);
      assert.deepEqual(runtime.extractLatestInputDrafts(surfaceId), drafts);
    }
  });

  it('surface/render 观察者抛错不导致半恢复；其他观察者读取协调后的草稿', () => {
    const { runtime, surfaceId } = makeRuntime({
      onRender: () => {
        throw new Error('render');
      },
    });
    assert.equal(runtime.setInputValue('label', surfaceId, 'text', 'draft'), true);
    let observed = 0;
    runtime.subscribeSurface(surfaceId, () => {
      throw new Error('observer');
    });
    runtime.subscribeSurface(surfaceId, () => {
      observed++;
      assert.equal(runtime.getLatestInputs(surfaceId).length, 0);
    });
    runtime.subscribeSurfaceRender(surfaceId, () => {
      throw new Error('render observer');
    });
    assert.doesNotThrow(() =>
      runtime.restoreSurfaceView({
        ...runtime.getSurfaceView(surfaceId)!,
        dataModel: { note: 'restored' },
      }),
    );
    assert.equal(observed, 1);
    assert.deepEqual(runtime.getSurfaceView(surfaceId)!.dataModel, { note: 'restored' });
    assert.equal(runtime.getLatestInputs(surfaceId).length, 0);
  });

  it('受控删除清除渲染缓存并通知 null，另一 surface 及其订阅不受影响', () => {
    const { runtime, surfaceId } = makeRuntime();
    runtime.restoreSurfaceView({ ...runtime.getSurfaceView(surfaceId)!, surfaceId: 'other' });
    const other = runtime.getLastRoot('other');
    const events: unknown[] = [];
    let otherNotified = 0;
    runtime.subscribeSurfaceRender(surfaceId, (root) => events.push(root));
    runtime.subscribeSurfaceRender('other', () => otherNotified++);
    assert.ok(runtime.getLastRoot(surfaceId));
    runtime.removeSurfaceView(surfaceId);
    assert.equal(runtime.getSurfaceView(surfaceId), undefined);
    assert.equal(runtime.getLastRoot(surfaceId), null);
    assert.deepEqual(events, [null]);
    assert.equal(runtime.getLastRoot('other'), other);
    assert.equal(otherNotified, 0);
  });

  it('候选发布只确认发送代次，合并失败不改变视图或草稿', () => {
    const { runtime, surfaceId } = makeRuntime();
    assert.equal(runtime.setInputValue('label', surfaceId, 'text', 'sent'), true);
    const sent = runtime.extractLatestInputDrafts(surfaceId);
    assert.equal(runtime.setInputValue('label', surfaceId, 'text', 'later'), true);
    const candidate = { ...runtime.getSurfaceView(surfaceId)!, dataModel: { note: 'server' } };
    runtime.commitSurfaceView(candidate, sent);
    assert.deepEqual(runtime.getSurfaceView(surfaceId)!.dataModel, { note: 'later' });
    assert.equal(runtime.getLatestInputs(surfaceId)[0].value, 'later');
    const before = runtime.getSurfaceView(surfaceId);
    const drafts = runtime.extractLatestInputDrafts(surfaceId);
    assert.throws(() => runtime.commitSurfaceView({ ...candidate, dataModel: { note: 1 } }, sent));
    assert.equal(runtime.getSurfaceView(surfaceId), before);
    assert.deepEqual(runtime.extractLatestInputDrafts(surfaceId), drafts);
  });

  it('独立视图运行时复用 Catalog/预算，不调用宿主回调或改动原状态', () => {
    let rendered = 0;
    const { runtime, surfaceId } = makeRuntime({
      maxDataModelBytes: 80,
      onRender: () => rendered++,
    });
    const before = runtime.getSurfaceView(surfaceId);
    const calls = rendered;
    const isolated = runtime.createViewRuntime();
    isolated.restoreSurfaceView(before!);
    assert.equal(
      isolated.dispatchChecked({
        version: 'v0.9',
        updateDataModel: { surfaceId, value: { note: 'x'.repeat(100) } },
      }).ok,
      false,
    );
    assert.equal(
      isolated.dispatchChecked({
        version: 'v0.9',
        updateComponents: { surfaceId, components: [{ id: 'root', component: 'Ghost' }] },
      }).ok,
      false,
    );
    assert.equal(runtime.getSurfaceView(surfaceId), before);
    assert.equal(rendered, calls);
  });
});

describe('S4 复核 · 预算合并与自有属性边界', () => {
  it('候选本身合法但新草稿合并超预算：不发布视图或确认草稿', () => {
    const { runtime, surfaceId } = makeRuntime({ maxDataModelBytes: 80 });
    assert.equal(runtime.setInputValue('label', surfaceId, 'text', 'sent'), true);
    const sent = runtime.extractLatestInputDrafts(surfaceId);
    assert.equal(runtime.setInputValue('label', surfaceId, 'text', 'x'.repeat(30)), true);
    const candidate = {
      ...runtime.getSurfaceView(surfaceId)!,
      dataModel: { note: 'v', padding: 'x'.repeat(35) },
    };
    const isolated = runtime.createViewRuntime();
    assert.doesNotThrow(
      () => isolated.restoreSurfaceView(candidate),
      '同 Catalog 候选本身可合法发布',
    );
    const before = runtime.getSurfaceView(surfaceId),
      drafts = runtime.extractLatestInputDrafts(surfaceId);
    assert.throws(() => runtime.commitSurfaceView(candidate, sent), /字节上限/);
    assert.equal(runtime.getSurfaceView(surfaceId), before);
    assert.deepEqual(runtime.extractLatestInputDrafts(surfaceId), drafts);
    runtime.commitSurfaceView({ ...candidate, dataModel: { note: 'v', padding: 'x' } }, sent);
    assert.deepEqual(runtime.getSurfaceView(surfaceId)?.dataModel, {
      note: 'x'.repeat(30),
      padding: 'x',
    });
  });

  it('继承名不冒充 surface，但显式同名 surface 仍可恢复和删除', () => {
    const { runtime, surfaceId } = makeRuntime();
    assert.equal(runtime.getSurfaceView('toString'), undefined);
    runtime.restoreSurfaceView({ ...runtime.getSurfaceView(surfaceId)!, surfaceId: 'toString' });
    assert.ok(runtime.getSurfaceView('toString'));
    runtime.removeSurfaceView('toString');
    assert.equal(runtime.getSurfaceView('toString'), undefined);
    assert.ok(runtime.getSurfaceView(surfaceId));
  });
});
