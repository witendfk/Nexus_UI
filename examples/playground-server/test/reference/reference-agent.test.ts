import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { A2UIMessage } from '@nexus-ui/core';
import {
  createAgentStreamState,
  validateAgentStreamFinalDetailed,
  validateAgentStreamMessageDetailed,
} from '@nexus-ui/server';
import type { AgentPolicy } from '@nexus-ui/server';
import { NEXUS_BASIC_TASK_CATALOG } from '../../src/agent/catalog';
import { createReferenceAgentAdapter } from '../../src/reference/reference-agent';

async function validateReference(policy?: AgentPolicy) {
  const adapter = createReferenceAgentAdapter({ useLlm: () => false, policy });
  const plan = await adapter.prepareGeneration({
    catalogId: NEXUS_BASIC_TASK_CATALOG,
    message: '搜索任务',
  });
  assert.ok(plan.ok, 'S3.2：入队即接受');
  // S3.2：sequence 在调度内准备完成后才可读，先等运行终态；本测试只消费 sequence
  // 校验公开 guard，fallback fixture 与搜索意图 Policy 的匹配不是本测试证伪点，
  // 故不断言运行成功（S2 下该运行从未被消费）。
  await plan.run.result;
  const seq = plan.run.sequence;
  const state = createAgentStreamState();
  const messages: A2UIMessage[] = [
    { version: 'v0.9', createSurface: { surfaceId: seq.surfaceId, catalogId: seq.catalogId } },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: seq.surfaceId,
        components: [
          { id: 'root', component: 'Column', children: ['label'] },
          { id: 'label', component: 'Text', text: 'plain text' },
        ],
      },
    },
  ];
  messages.forEach((message, index) =>
    assert.equal(validateAgentStreamMessageDetailed(message, index, seq, state), null),
  );
  return validateAgentStreamFinalDetailed(seq, state);
}

describe('reference policy assembly through the public SDK guard', () => {
  it('rejects a missing demo workflow through the actual reference factory', async () => {
    const issue = await validateReference();
    assert.equal(issue?.boundaryCode, 'POLICY_REJECTED');
    assert.match(issue?.message ?? '', /TextField/);
  });

  it('retains demo hooks when the caller overrides only the policy label', async () => {
    assert.equal(
      (await validateReference({ name: 'custom label' }))?.boundaryCode,
      'POLICY_REJECTED',
    );
  });

  it('allows an explicit override of a demo hook', async () => {
    assert.equal(await validateReference({ validateFinal: () => null }), null);
  });
});
