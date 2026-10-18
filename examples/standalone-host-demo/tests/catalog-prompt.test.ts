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
    assert.match(DEMO_SYSTEM_PROMPT, /Allowed actions: approve \(sources: Button; params=none\)\./);
    assert.match(DEMO_SYSTEM_PROMPT, /"dynamic": "required"/);
    assert.match(DEMO_SYSTEM_PROMPT, /Component ApprovalSummary:\n/);
    assert.match(DEMO_SYSTEM_PROMPT, /Origin: host-extension/);
    assert.match(DEMO_SYSTEM_PROMPT, /Origin: official-basic/);
    assert.match(DEMO_SYSTEM_PROMPT, /- disabled: origin=host-extension/);
    assert.match(
      DEMO_SYSTEM_PROMPT,
      /- Attach an action only to a component type listed in that action's sources/,
    );
  });
});
