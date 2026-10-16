import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { A2UIMessage, Component } from '@nexus-ui/core';
import {
  createAgentStreamState,
  validateAgentStreamFinalDetailed,
  validateAgentStreamMessageDetailed,
} from '@nexus-ui/server';
import { resolveAgentPolicy } from '../src/agent/policy';
import { validateComponentPolicy } from '../src/agent/policy/component-policy';
import {
  getRequiredMediaPolicy,
  validateDynamicMediaPolicy,
} from '../src/agent/policy/media-policy';
import { validateWorkflowPolicy } from '../src/agent/policy/workflow-policy';
import {
  NEXUS_BASIC_TASK_CATALOG,
  agentCatalogRegistry,
} from '../src/agent/catalog';

describe('playground demo policy layer', () => {
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
      { catalogId: NEXUS_BASIC_TASK_CATALOG, message: '搜索任务' },
      components,
    );
    assert.ok(workflowError);
    assert.match(workflowError, /keyword\.context/);
  });

  it('lets a demo policy override hooks while retaining playground defaults', () => {
    const policy = resolveAgentPolicy({ name: 'demo-policy' });
    const finalError = policy.validateFinal(
      {
        kind: 'generate',
        surfaceId: 'd',
        catalogId: NEXUS_BASIC_TASK_CATALOG,
        message: '搜索',
      },
      [],
    );

    assert.equal(policy.name, 'demo-policy');
    assert.ok(finalError);
    assert.match(finalError, /搜索 UI/);
  });

  it('propagates an injected demo policy into the agent sequence guard', () => {
    const message = {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'surface-1',
        components: [{ id: 'root', component: 'Text', text: 'allowed by catalog' }],
      },
    } as unknown as A2UIMessage;
    const issue = validateAgentStreamMessageDetailed(
      message,
      1,
      {
        kind: 'generate',
        surfaceId: 'surface-1',
        registry: agentCatalogRegistry,
        catalogId: NEXUS_BASIC_TASK_CATALOG,
        supportedActions: [],
        policy: {
          name: 'demo-policy',
          validateComponent: () => 'demo policy rejected',
        },
      },
      createAgentStreamState(),
    );

    assert.deepEqual(issue, {
      boundaryCode: 'POLICY_REJECTED',
      message: 'demo policy rejected',
    });
  });

  it('marks final demo workflow rejections as POLICY_REJECTED', () => {
    const state = createAgentStreamState();
    state.hasRoot = true;
    state.componentsById.set('root', {
      id: 'root',
      component: 'Text',
      text: 'final surface',
    });
    const issue = validateAgentStreamFinalDetailed(
      {
        kind: 'generate',
        surfaceId: 'surface-1',
        registry: agentCatalogRegistry,
        catalogId: NEXUS_BASIC_TASK_CATALOG,
        supportedActions: [],
        policy: {
          name: 'demo-policy',
          validateFinal: () => 'workflow rejected',
        },
      },
      state,
    );

    assert.deepEqual(issue, {
      boundaryCode: 'POLICY_REJECTED',
      message: 'workflow rejected',
    });
  });
});
