import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AgentAdapter } from '../src/agent/adapter';
import { resolveAgentPolicy } from '../src/agent/policy';
import { TEST_CATALOG_ID, createTestRegistry } from './helpers/test-catalog';

describe('neutral SDK policy layer', () => {
  it('resolveAgentPolicy fills unset host hooks with no-op defaults', () => {
    const policy = resolveAgentPolicy({ name: 'host-policy' });
    const context = {
      kind: 'generate' as const,
      surfaceId: 's',
      catalogId: TEST_CATALOG_ID,
      message: '生成一张带头像的联系人卡片，搜索表单',
    };

    assert.equal(policy.name, 'host-policy');
    assert.equal(policy.validateComponent({} as never, context), null);
    assert.equal(policy.validateLiteralMedia({} as never, context), null);
    assert.equal(policy.validateDynamicMedia({} as never, undefined, context), null);
    assert.deepEqual(policy.getRequiredMedia(context), {
      Image: false,
      Video: false,
      AudioPlayer: false,
    });
    assert.equal(policy.validateFinal(context, []), null);
  });

  it('resolveAgentPolicy keeps explicit host hooks', () => {
    const policy = resolveAgentPolicy({
      validateFinal: () => 'host rule',
    });
    assert.equal(
      policy.validateFinal({ kind: 'generate', surfaceId: 's', catalogId: TEST_CATALOG_ID }, []),
      'host rule',
    );
  });

  it('attaches an adapter-level policy to generation runs', async () => {
    const adapter = new AgentAdapter({
      registry: createTestRegistry(),
      useLlm: () => false,
      policy: {
        name: 'adapter-policy',
        validateComponent: () => 'adapter policy rejected',
      },
      createGenerationSource: (request) => [
        {
          version: 'v0.9',
          createSurface: {
            surfaceId: request.surfaceId,
            catalogId: request.catalogId,
          },
        },
      ],
    });
    const plan = await adapter.prepareGeneration({
      message: '创建任务面',
      catalogId: TEST_CATALOG_ID,
    });

    assert.ok(plan.ok);
    assert.equal(plan.run.sequence.policy?.name, 'adapter-policy');
  });
});
