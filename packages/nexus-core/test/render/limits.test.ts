import { expect } from 'chai';
import { buildTree } from '../../src/render';
import { A2UIRuntime } from '../../src/runtime';

describe('render budget configuration', () => {
  for (const key of ['maxNodes', 'maxDepth'] as const) {
    for (const value of [NaN, Infinity, -Infinity, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      it(`rejects ${key}=${value} before processing any messages`, () => {
        expect(() => new A2UIRuntime({ [key]: value })).to.throw(key);
        expect(() => buildTree({}, 's', undefined, { [key]: value })).to.throw(key);
      });
    }
  }

  it('keeps positive minimum budgets usable', () => {
    const root = buildTree(
      { root: { id: 'root', component: 'Text', text: 'hello' } },
      's',
      undefined,
      { maxNodes: 1, maxDepth: 1 },
    );
    expect(root?.props.text).to.equal('hello');
  });

  it('treats inherited component references as missing', () => {
    const root = buildTree(
      { root: { id: 'root', component: 'Column', children: ['toString'] } },
      's',
      undefined,
    );
    expect(root?.children?.[0]).to.include({ id: 'toString', type: '__placeholder__' });
    expect(
      buildTree(Object.create({ root: { id: 'root', component: 'Text' } }), 's', undefined),
    ).to.equal(null);
  });
});
