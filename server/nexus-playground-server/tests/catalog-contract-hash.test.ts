import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CATALOG_CONTRACT_VERSION,
  createCatalogContractHash,
  createCatalogContractReference,
} from '../src/agent/catalog-contract';
import type { CatalogDefinition } from '@nexus-ui/core';

describe('catalog contract hash', () => {
  it('is stable when semantically identical catalog keys are reordered', () => {
    const first: CatalogDefinition = {
      catalogId: 'https://example.com/catalogs/hash/v1',
      components: ['Text', 'Button'],
      componentSchemas: {
        Text: {
          type: 'object',
          additionalProperties: false,
          properties: { text: { type: 'string', dynamic: 'allowed' } },
        },
      },
    };
    const second: CatalogDefinition = {
      componentSchemas: {
        Text: {
          additionalProperties: false,
          properties: { text: { dynamic: 'allowed', type: 'string' } },
          type: 'object',
        },
      },
      components: ['Text', 'Button'],
      catalogId: 'https://example.com/catalogs/hash/v1',
    };

    assert.equal(createCatalogContractHash(first), createCatalogContractHash(second));
  });

  it('changes when a catalog capability changes', () => {
    const base: CatalogDefinition = {
      catalogId: 'https://example.com/catalogs/hash/v1',
      components: ['Text', 'Button'],
    };
    const changed: CatalogDefinition = {
      catalogId: 'https://example.com/catalogs/hash/v1',
      components: ['Text', 'Button'],
      actions: ['submit'],
    };

    assert.notEqual(createCatalogContractHash(base), createCatalogContractHash(changed));
  });

  it('creates a versioned reference and supports an optional URL', () => {
    const catalog: CatalogDefinition = {
      catalogId: 'https://example.com/catalogs/hash/v1',
      components: ['Text'],
    };
    const reference = createCatalogContractReference(
      catalog,
      'https://host.example/catalog-contract',
    );

    assert.equal(reference.version, CATALOG_CONTRACT_VERSION);
    assert.equal(reference.hash, createCatalogContractHash(catalog));
    assert.equal(reference.url, 'https://host.example/catalog-contract');
  });
});
