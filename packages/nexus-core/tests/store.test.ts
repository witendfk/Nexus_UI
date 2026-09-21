import { expect } from 'chai';
import { createCoreStore } from '../src/state';
import type { Component } from '../src/protocol/types';

const comp = (id: string, component: string, extra: Record<string, unknown> = {}): Component => ({
  id,
  component,
  ...extra,
});

describe('createCoreStore', () => {
  it('createSurface + upsertComponents', () => {
    const s = createCoreStore();
    s.getState().createSurface({ id: 'demo', catalogId: 'basic' });
    s.getState().upsertComponents('demo', [
      comp('root', 'Column', { children: ['t1'] }),
      comp('t1', 'Text', { text: 'hi' }),
    ]);
    const st = s.getState();
    expect(st.surfaces['demo']).to.deep.equal({ id: 'demo', catalogId: 'basic' });
    expect(Object.keys(st.componentsBySurface['demo'])).to.deep.equal(['root', 't1']);
  });

  it('upsert 同 id 后到覆盖先到', () => {
    const s = createCoreStore();
    s.getState().createSurface({ id: 'd', catalogId: 'basic' });
    s.getState().upsertComponents('d', [comp('t', 'Text', { text: 'old' })]);
    s.getState().upsertComponents('d', [comp('t', 'Text', { text: 'new' })]);
    expect(s.getState().componentsBySurface['d']['t']).to.deep.include({ text: 'new' });
  });

  it('多 surface 隔离', () => {
    const s = createCoreStore();
    s.getState().createSurface({ id: 'a', catalogId: 'basic' });
    s.getState().createSurface({ id: 'b', catalogId: 'basic' });
    s.getState().upsertComponents('a', [comp('root', 'Column')]);
    s.getState().upsertComponents('b', [comp('root', 'Row')]);
    const st = s.getState();
    expect(st.componentsBySurface['a']['root'].component).to.equal('Column');
    expect(st.componentsBySurface['b']['root'].component).to.equal('Row');
  });

  it('applyDataModel upsert + setDataModelValueAtPath 双向写', () => {
    const s = createCoreStore();
    s.getState().createSurface({ id: 'd', catalogId: 'basic' });
    s.getState().applyDataModel({ surfaceId: 'd', path: '/user', value: { name: 'Alice' } });
    s.getState().setDataModelValueAtPath('d', '/user/age', 30);
    expect(s.getState().dataModelBySurface['d']).to.deep.equal({
      user: { name: 'Alice', age: 30 },
    });
  });

  it('deleteSurface 级联清理组件表 + 数据', () => {
    const s = createCoreStore();
    s.getState().createSurface({ id: 'd', catalogId: 'basic' });
    s.getState().upsertComponents('d', [comp('root', 'Column')]);
    s.getState().applyDataModel({ surfaceId: 'd', value: { x: 1 } });
    s.getState().deleteSurface('d');
    const st = s.getState();
    expect(st.surfaces['d']).to.equal(undefined);
    expect(st.componentsBySurface['d']).to.equal(undefined);
    expect(st.dataModelBySurface['d']).to.equal(undefined);
  });

  it('addError 累积', () => {
    const s = createCoreStore();
    s.getState().addError({ message: 'e1' });
    s.getState().addError({ message: 'e2' });
    expect(s.getState().errors.map((e) => e.message)).to.deep.equal(['e1', 'e2']);
  });
});
