/**
 * Protocol-level catalog identity guard: the official A2UI v0.9 Basic Catalog
 * is not registered by this runtime. Hosts register their own CatalogRegistry.
 */
export const OFFICIAL_BASIC_CATALOG = 'https://a2ui.org/specification/v0_9/basic_catalog.json';

/** Explicitly reject the official Basic identity unless a host registers a conformant catalog. */
export function isOfficialBasicCatalog(catalogId: string): boolean {
  return catalogId === OFFICIAL_BASIC_CATALOG;
}
