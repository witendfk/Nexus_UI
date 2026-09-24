import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDemoProcessPlan } from '../scripts/dev-plan';

describe('standalone demo process plan', () => {
  it('starts the built-in Agent, host, and web by default', () => {
    assert.deepEqual(
      createDemoProcessPlan({}).map((process) => process.name),
      ['agent', 'host', 'web'],
    );
  });

  it('skips the built-in Agent when an external endpoint is configured', () => {
    assert.deepEqual(
      createDemoProcessPlan({
        NEXUS_DEMO_AGENT_ENDPOINT: 'https://agent.example.com/a2ui',
      }).map((process) => process.name),
      ['host', 'web'],
    );
  });

  it('treats a blank endpoint as unset', () => {
    assert.deepEqual(
      createDemoProcessPlan({ NEXUS_DEMO_AGENT_ENDPOINT: '  ' }).map((process) => process.name),
      ['agent', 'host', 'web'],
    );
  });
});
