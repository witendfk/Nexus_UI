import {
  CatalogRegistry,
  standardCatalogComponentDeclarations,
  type CatalogDefinition,
} from '@nexus-ui/core';

/**
 * Minimal host-style test catalog for SDK-generic tests. It deliberately carries
 * none of the playground demo catalogs; hosts register their own registries.
 * 标准组件复用 SDK 声明（Catalog v2）。
 */
export const TEST_CATALOG_ID = 'https://example.com/catalogs/server-test/v1';

export const TEST_CATALOG_COMPONENTS = ['Text', 'Button', 'Column', 'Row'] as const;
export const TEST_CATALOG_ACTIONS = ['submit', 'call'] as const;

const standard = standardCatalogComponentDeclarations();

export const testCatalog: CatalogDefinition = {
  catalogId: TEST_CATALOG_ID,
  components: {
    Text: standard.Text,
    Button: standard.Button,
    Column: standard.Column,
    Row: standard.Row,
  },
  actions: [
    // submit 允许 Button 与 Text：证明挂载由声明决定，不按组件名特判。
    // paramSchema 覆盖 SDK 通用测试实际绑定的字段；空 context（参数空对象）合法。
    {
      name: 'submit',
      sources: ['Button', 'Text'],
      paramSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          counter: { type: 'number' },
          note: { type: 'string' },
        },
      },
    },
    { name: 'call', sources: ['Button'] },
  ],
};

export function createTestRegistry(): CatalogRegistry {
  return new CatalogRegistry([testCatalog]);
}
