import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveDemoAgentMode } from '../src/agent';

describe('demo Agent mode', () => {
  it('defaults to LLM mode', () => {
    assert.equal(resolveDemoAgentMode(undefined), 'llm');
  });

  it('supports explicit LLM and deterministic modes', () => {
    assert.equal(resolveDemoAgentMode('llm'), 'llm');
    assert.equal(resolveDemoAgentMode('deterministic'), 'deterministic');
  });

  it('rejects an unknown mode', () => {
    assert.throws(() => resolveDemoAgentMode('mock'), /只支持 llm 或 deterministic/);
  });
});
