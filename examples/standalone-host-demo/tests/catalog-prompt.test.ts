import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCatalogPromptContract } from '@nexus-ui/core';
import { DEMO_SYSTEM_PROMPT } from '../src/llm';
import { standaloneHostCatalog } from '../src/shared/catalog-contract';

describe('standalone demo catalog prompt', () => {
  it('builds the Agent system prompt from the host catalog definition', () => {
    const contract = createCatalogPromptContract(standaloneHostCatalog);

    assert.ok(DEMO_SYSTEM_PROMPT.startsWith(contract));
    assert.match(
      DEMO_SYSTEM_PROMPT,
      /Catalog ID: https:\/\/example\.com\/catalogs\/host-approval\/v1/,
    );
    assert.match(DEMO_SYSTEM_PROMPT, /Allowed components: ApprovalSummary, Text, Button\./);
    assert.match(DEMO_SYSTEM_PROMPT, /Allowed action names: approve\./);
    assert.match(DEMO_SYSTEM_PROMPT, /"dynamic": "required"/);
  });
});
