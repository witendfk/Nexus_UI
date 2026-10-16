import { expect } from 'chai';
import { CatalogRegistry } from '../../src/catalog';

describe('Catalog component lookups use own properties', () => {
  for (const name of ['__proto__', 'constructor', 'toString']) {
    it(`does not invent schema or policy for ${name}`, () => {
      const registry = new CatalogRegistry([
        { catalogId: 'custom', components: [name], componentSchemas: {}, componentPolicies: {} },
      ]);
      expect(registry.getComponentSchema('custom', name)).to.equal(undefined);
      expect(registry.getComponentPolicy('custom', name)).to.equal(undefined);
      expect(
        registry.getComponentDiagnostics('custom', { id: 'root', component: name }),
      ).to.deep.equal([]);
    });
  }

  it('enforces an explicitly declared own schema with a prototype-like name', () => {
    const registry = new CatalogRegistry([
      {
        catalogId: 'custom',
        components: ['toString'],
        componentSchemas: {
          toString: {
            type: 'object' as const,
            required: ['text'],
            properties: { text: { type: 'string' as const } },
          },
        },
      },
    ]);
    expect(
      registry.getComponentDiagnostics('custom', { id: 'root', component: 'toString' }),
    ).not.to.deep.equal([]);
  });
});
