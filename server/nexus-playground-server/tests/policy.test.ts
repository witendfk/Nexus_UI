import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Component } from '@nexus-ui/core';
import { validateAgentSequence } from '../src/agent/agent-guard';
import { resolveAgentPolicy } from '../src/agent/policy';
import { AgentAdapter } from '../src/agent/adapter';
import { validateComponentPolicy } from '../src/agent/policy/component-policy';
import {
  getRequiredMediaPolicy,
  validateDynamicMediaPolicy,
} from '../src/agent/policy/media-policy';
import { validateWorkflowPolicy } from '../src/agent/policy/workflow-policy';

describe('host policy layer', () => {
  it('keeps cross-field component semantics out of the catalog capability contract', () => {
    const component = {
      id: 'reminderAt',
      component: 'DateTimeInput',
      value: { path: '/reminderAt' },
      enableDate: false,
      enableTime: false,
      min: 'not-a-date',
    } as unknown as Component;

    assert.equal(
      validateComponentPolicy(component),
      'DateTimeInput.enableDate/enableTime 至少一个为 true',
    );
  });

  it('classifies requested media and blocks URL-like text values', () => {
    assert.deepEqual(getRequiredMediaPolicy('生成一张带头像的联系人卡片'), {
      Image: true,
      Video: false,
      AudioPlayer: false,
    });

    const component = {
      id: 'leak',
      component: 'Text',
      text: { path: '/avatarUrl' },
    } as unknown as Component;
    const mediaError = validateDynamicMediaPolicy(component, {
      avatarUrl: 'https://example.com/a.png',
    });
    assert.ok(mediaError);
    assert.match(mediaError, /媒体 URL/);
  });

  it('validates workflow ownership at final-surface policy time', () => {
    const components = [
      { id: 'root', component: 'Column', children: ['keyword', 'button', 'result'] },
      { id: 'keyword', component: 'TextField', label: '关键词', value: { path: '/keyword' } },
      {
        id: 'button',
        component: 'Button',
        child: 'label',
        action: { event: { name: 'search', context: { keyword: 'literal' } } },
      },
      { id: 'label', component: 'Text', text: '搜索' },
      { id: 'searchResult', component: 'Text', text: '结果' },
    ] as unknown as Component[];

    const workflowError = validateWorkflowPolicy(
      { catalogId: 'https://example.com/catalogs/nexus-basic-task/v1', message: '搜索任务' },
      components,
    );
    assert.ok(workflowError);
    assert.match(workflowError, /keyword\.context/);
  });

  it('lets a host override policy hooks while retaining Nexus defaults', () => {
    const policy = resolveAgentPolicy({ name: 'host-policy' });
    const finalError = policy.validateFinal(
      {
        kind: 'generate',
        surfaceId: 'd',
        catalogId: 'https://example.com/catalogs/nexus-basic-task/v1',
        message: '搜索',
      },
      [],
    );

    assert.equal(policy.name, 'host-policy');
    assert.ok(finalError);
    assert.match(finalError, /搜索 UI/);
  });

  it('propagates an injected host policy into the agent sequence guard', () => {
    const message = {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'surface-1',
        components: [{ id: 'root', component: 'Text', text: 'allowed by catalog' }],
      },
    } as unknown as Parameters<typeof validateAgentSequence>[0];
    const error = validateAgentSequence(message, 1, {
      kind: 'generate',
      surfaceId: 'surface-1',
      policy: {
        name: 'host-policy',
        validateComponent: () => 'host policy rejected',
      },
    });

    assert.equal(error, 'host policy rejected');
  });

  it('attaches an adapter-level policy to generation runs', async () => {
    const adapter = new AgentAdapter({
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
            catalogId: 'https://example.com/catalogs/nexus-basic-task/v1',
          },
        },
      ],
    });
    const plan = await adapter.prepareGeneration({ message: '创建任务面' });

    assert.ok(plan.ok);
    assert.equal(plan.run.sequence.policy?.name, 'adapter-policy');
  });
});
