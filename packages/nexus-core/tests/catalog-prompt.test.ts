import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import type { CatalogDefinition } from '../src/catalog';
import { createCatalogPromptContract } from '../src/catalog/prompt';

describe('createCatalogPromptContract', () => {
  it('renders a deterministic contract from a catalog definition', () => {
    const catalog: CatalogDefinition = {
      catalogId: 'https://example.com/catalogs/workbench/v1',
      components: ['CustomerSummary', 'Text', 'Button'],
      actions: ['submit'],
      componentSchemas: {
        CustomerSummary: {
          type: 'object',
          additionalProperties: false,
          required: ['customerName', 'priority'],
          properties: {
            customerName: { type: 'string', minLength: 1, dynamic: 'required' },
            priority: {
              type: 'string',
              enum: ['high', 'normal', 'low'],
              dynamic: 'allowed',
            },
            score: { type: 'number', minimum: 0, maximum: 100 },
            tags: { type: 'array', items: { type: 'string', maxLength: 20 } },
          },
        },
      },
    };

    const first = createCatalogPromptContract(catalog);
    const second = createCatalogPromptContract(catalog);

    assert.equal(first, second);
    assert.match(first, /Protocol version: v0\.9/);
    assert.match(first, /Catalog ID: https:\/\/example\.com\/catalogs\/workbench\/v1/);
    assert.match(first, /Allowed components: CustomerSummary, Text, Button\./);
    assert.match(first, /Allowed action names: submit\./);
    assert.match(first, /Component CustomerSummary props schema:/);
    assert.match(first, /"dynamic": "required"/);
    assert.match(first, /"minimum": 0/);
    assert.match(first, /Components without a catalog schema here: Text, Button\./);
    assert.match(first, /The host guard is authoritative\./);
  });

  it('distinguishes display-only catalogs from undeclared action boundaries', () => {
    const displayOnly = createCatalogPromptContract({
      catalogId: 'display-only',
      components: ['Text'],
      actions: [],
    });
    const undeclared = createCatalogPromptContract({
      catalogId: 'undeclared',
      components: ['Text'],
    });

    assert.match(displayOnly, /Allowed action names: None; this catalog is display-only\./);
    assert.match(
      undeclared,
      /Allowed action names: Not declared by this CatalogDefinition; do not invent actions from this contract\./,
    );
  });

  it('renders capability policies as machine-derived prompt rules', () => {
    const contract = createCatalogPromptContract({
      catalogId: 'profile',
      components: ['Button'],
      actions: ['submit'],
      componentPolicies: {
        Button: {
          origin: 'nexus-extension',
          fields: {
            disabled: { binding: 'forbidden', origin: 'nexus-extension' },
          },
          action: { allowed: true },
          checks: { enabled: true, functions: ['required'], maxRules: 8 },
        },
      },
    });

    assert.match(contract, /Component Button policy:/);
    assert.match(contract, /Origin: nexus-extension/);
    assert.match(contract, /- disabled: binding=forbidden, origin=nexus-extension/);
    assert.match(contract, /Action: allowed=true, required=false/);
    assert.match(contract, /Checks: enabled=true, functions=required, maxRules=8/);
  });

  it('rejects the same invalid definitions as CatalogRegistry', () => {
    assert.throws(
      () =>
        createCatalogPromptContract({
          catalogId: 'invalid',
          components: ['TaskSummary'],
          componentSchemas: {
            Unknown: { type: 'object' },
          },
        }),
      /未注册组件/,
    );
  });
});
