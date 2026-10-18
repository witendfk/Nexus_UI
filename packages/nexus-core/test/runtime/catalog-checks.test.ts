import assert from 'node:assert/strict';
import fixture from '../../../../fixtures/checks-boundary.json';
import { CatalogRegistry } from '../../src/catalog';
import { standardCatalogComponentDeclarations } from '../../src/catalog/standard';
import { A2UIRuntime } from '../../src/runtime';
import type { A2UIError, A2UIMessage, Component } from '../../src/protocol/types';

describe('runtime checks 能力只由当前 Catalog 决定', () => {
  for (const props of fixture.components) {
    for (const enabled of [true, false, undefined]) {
      it(`${props.component}: enabled=${enabled}`, () => {
        const registry = new CatalogRegistry([
          {
            catalogId: 'host',
            components: {
              [props.component]: {
                schema: { type: 'object' },
                ...(enabled === undefined ? {} : { checks: { enabled, functions: ['required'] } }),
              },
            },
            actions: [],
          },
        ]);
        const errors: A2UIError[] = [];
        const runtime = new A2UIRuntime({
          catalogRegistry: registry,
          onError: (e) => errors.push(e),
        });
        runtime.dispatch({ version: 'v0.9', createSurface: { surfaceId: 's', catalogId: 'host' } });
        const component = { ...props, id: 'root', checks: fixture.checks } as Component;
        runtime.dispatch({
          version: 'v0.9',
          updateComponents: { surfaceId: 's', components: [component] },
        });
        if (enabled) {
          assert.deepEqual(errors, []);
          assert.deepEqual(runtime.store.getState().componentsBySurface.s?.root, component);
        } else {
          assert.equal(errors.length, 1);
          assert.equal(errors[0].code, 'CATALOG_UNSUPPORTED');
          assert.match(errors[0].message, /不支持 checks/);
          assert.equal(runtime.store.getState().componentsBySurface.s?.root, undefined);
        }
      });
    }
  }

  it('标准声明仍默认禁止 Card.checks，并执行宿主函数白名单', () => {
    const standard = standardCatalogComponentDeclarations();
    const registry = new CatalogRegistry([
      {
        catalogId: 'host',
        components: {
          Card: standard.Card,
          Custom: {
            schema: { type: 'object' },
            checks: { enabled: true, functions: ['email'] },
          },
        },
        actions: [],
      },
    ]);
    const runtime = new A2UIRuntime({ catalogRegistry: registry });
    runtime.dispatch({ version: 'v0.9', createSurface: { surfaceId: 's', catalogId: 'host' } });
    for (const component of ['Card', 'Custom']) {
      runtime.dispatch({
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's',
          components: [{ id: component, component, checks: fixture.checks } as Component],
        },
      });
    }
    assert.deepEqual(
      runtime.store.getState().errors.map((e) => e.code),
      ['CATALOG_UNSUPPORTED', 'CATALOG_UNSUPPORTED'],
    );
    assert.equal(runtime.store.getState().componentsBySurface.s?.Card, undefined);
    assert.equal(runtime.store.getState().componentsBySurface.s?.Custom, undefined);
  });

  for (const [index, message] of fixture.rejectedMessages.entries()) {
    it(`checks 键不能豁免任意 FunctionCall #${index + 1}，拒绝不改状态`, () => {
      const runtime = new A2UIRuntime();
      runtime.dispatch({ version: 'v0.9', createSurface: { surfaceId: 's', catalogId: 'host' } });
      const before = runtime.store.getState();
      runtime.dispatch(message as A2UIMessage);
      const after = runtime.store.getState();
      assert.equal(after.errors.length, 1);
      assert.equal(after.errors[0].code, 'FEATURE_UNSUPPORTED');
      assert.match(after.errors[0].message, /FunctionCall/);
      assert.equal(after.surfaces, before.surfaces);
      assert.equal(after.componentsBySurface, before.componentsBySurface);
      assert.equal(after.dataModelBySurface, before.dataModelBySurface);
    });
  }

  it('普通数据的 checks 键保持可用', () => {
    const runtime = new A2UIRuntime();
    runtime.dispatch({ version: 'v0.9', createSurface: { surfaceId: 's', catalogId: 'host' } });
    runtime.dispatch(fixture.ordinaryDataMessage as A2UIMessage);
    assert.deepEqual(runtime.store.getState().errors, []);
    assert.deepEqual(
      runtime.store.getState().dataModelBySurface.s,
      fixture.ordinaryDataMessage.updateDataModel.value,
    );
  });
});
