import { expect } from 'chai';
import { CatalogRegistry } from '../../src/catalog';

describe('Catalog component lookups use own properties', () => {
  for (const name of ['__proto__', 'constructor', 'toString']) {
    it(`does not invent schema or policy for ${name}`, () => {
      const registry = new CatalogRegistry([
        {
          catalogId: 'custom',
          components: { Text: { schema: { type: 'object' } } },
          actions: [],
        },
      ]);
      expect(registry.supportsComponent('custom', name)).to.equal(false);
      expect(registry.getComponentDeclaration('custom', name)).to.equal(undefined);
      expect(
        registry.getComponentDiagnostics('custom', { id: 'root', component: name }),
      ).to.deep.equal([
        {
          path: name,
          message: `Catalog custom 不支持组件: ${name}`,
        },
      ]);
    });
  }

  it('enforces an explicitly declared own schema with a prototype-like name', () => {
    const registry = new CatalogRegistry([
      {
        catalogId: 'custom',
        components: {
          toString: {
            schema: {
              type: 'object' as const,
              required: ['text'],
              properties: { text: { type: 'string' as const } },
            },
          },
        },
        actions: [],
      },
    ]);
    expect(
      registry.getComponentDiagnostics('custom', { id: 'root', component: 'toString' }),
    ).not.to.deep.equal([]);
  });
});
