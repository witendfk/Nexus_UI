import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import type { CatalogDefinition } from '../src/catalog';
import { createCatalogPromptContract } from '../src/catalog/prompt';

describe('createCatalogPromptContract', () => {
  it('renders a deterministic contract from a catalog definition', () => {
    const catalog: CatalogDefinition = {
      catalogId: 'https://example.com/catalogs/workbench/v1',
      components: {
        CustomerSummary: {
          schema: {
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
          origin: 'host-extension',
        },
        Text: { schema: { type: 'object' } },
        Button: {
          schema: { type: 'object', additionalProperties: false, properties: {} },
          action: { required: true },
        },
      },
      actions: [{ name: 'submit', sources: ['Button'] }],
    };

    const first = createCatalogPromptContract(catalog);
    const second = createCatalogPromptContract(catalog);

    assert.equal(first, second);
    assert.match(first, /Protocol version: v0\.9/);
    assert.match(first, /Catalog ID: https:\/\/example\.com\/catalogs\/workbench\/v1/);
    assert.match(first, /Allowed components: CustomerSummary, Text, Button\./);
    assert.match(first, /Allowed actions: submit \(sources: Button; params=none\)\./);
    assert.match(first, /Component CustomerSummary props schema:/);
    assert.match(first, /"dynamic": "required"/);
    assert.match(first, /"minimum": 0/);
    assert.match(first, /Origin: host-extension/);
    assert.match(first, /Action: required; this component must carry action\.event\./);
    assert.match(first, /The host guard is authoritative\./);
  });

  it('distinguishes display-only catalogs from action-bearing catalogs', () => {
    const displayOnly = createCatalogPromptContract({
      catalogId: 'display-only',
      components: { Text: { schema: { type: 'object' } } },
      actions: [],
    });
    const withAction = createCatalogPromptContract({
      catalogId: 'interactive',
      components: {
        Button: { schema: { type: 'object', additionalProperties: false, properties: {} } },
      },
      actions: [
        {
          name: 'submit',
          sources: ['Button'],
          paramSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['name'],
            properties: { name: { type: 'string' } },
          },
        },
      ],
    });

    assert.match(displayOnly, /Allowed actions: None; this catalog is display-only\./);
    assert.match(
      withAction,
      /Allowed actions: submit \(sources: Button; params=\{"type":"object".*\}\)\./,
    );
    assert.match(withAction, /"name":\{"type":"string"\}/);
  });

  it('renders capability declarations as machine-derived prompt rules', () => {
    const contract = createCatalogPromptContract({
      catalogId: 'profile',
      components: {
        Button: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { disabled: { type: 'boolean' } },
          },
          fields: {
            disabled: { origin: 'nexus-extension' },
          },
          action: { required: true },
          checks: { enabled: true, functions: ['required'], maxRules: 8 },
          origin: 'nexus-extension',
        },
      },
      actions: [{ name: 'submit', sources: ['Button'] }],
    });

    assert.match(contract, /Component Button:\n/);
    assert.match(contract, /Origin: nexus-extension/);
    assert.match(contract, /- disabled: origin=nexus-extension/);
    assert.match(contract, /Action: required; this component must carry action\.event\./);
    assert.match(contract, /Checks: enabled=true, functions=required, maxRules=8/);
  });

  it('rejects the same invalid definitions as CatalogRegistry', () => {
    assert.throws(
      () =>
        createCatalogPromptContract({
          catalogId: 'invalid',
          components: { TaskSummary: { schema: { type: 'object' }, chek: {} } } as never,
          actions: [],
        }),
      /含未知键/,
    );
  });
});
