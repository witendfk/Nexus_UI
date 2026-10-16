import { CatalogRegistry } from '@nexus-ui/core';

/**
 * Minimal host-style test catalog for SDK-generic tests. It deliberately carries
 * none of the playground demo catalogs; hosts register their own registries.
 */
export const TEST_CATALOG_ID = 'https://example.com/catalogs/server-test/v1';

export const TEST_CATALOG_COMPONENTS = ['Text', 'Button', 'Column', 'Row'] as const;
export const TEST_CATALOG_ACTIONS = ['submit', 'call'] as const;

export const testCatalog = {
  catalogId: TEST_CATALOG_ID,
  components: TEST_CATALOG_COMPONENTS,
  actions: TEST_CATALOG_ACTIONS,
};

export function createTestRegistry(): CatalogRegistry {
  return new CatalogRegistry([testCatalog]);
}
