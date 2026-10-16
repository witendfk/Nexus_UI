import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createAgentStreamState,
  validateAgentSequence,
  validateAgentStreamFinalDetailed,
  validateAgentStreamMessageDetailed,
} from '../src/agent/agent-guard';
import { TEST_CATALOG_ID, createTestRegistry } from './helpers/test-catalog';
import type { A2UIMessage } from '@nexus-ui/core';

const registry = createTestRegistry();

function options(
  overrides: Partial<Parameters<typeof validateAgentSequence>[2]> = {},
): Parameters<typeof validateAgentSequence>[2] {
  return {
    kind: 'generate',
    surfaceId: 'surface-1',
    catalogId: TEST_CATALOG_ID,
    registry,
    supportedActions: ['submit'],
    ...overrides,
  };
}

const create = {
  version: 'v0.9',
  createSurface: { surfaceId: 'surface-1', catalogId: TEST_CATALOG_ID },
} as A2UIMessage;

const update = {
  version: 'v0.9',
  updateDataModel: { surfaceId: 'surface-1', value: {} },
} as A2UIMessage;

const createWithWrongCatalog = {
  version: 'v0.9',
  createSurface: { surfaceId: 'surface-1', catalogId: 'custom-catalog' },
} as A2UIMessage;

const updateWithUnsupportedComponent = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [{ id: 'input', component: 'TextInput' }],
  },
} as A2UIMessage;

const updateWithRoot = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [{ id: 'root', component: 'Text', text: 'Root' }],
  },
} as A2UIMessage;

const updateWithUnsupportedAction = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [
      {
        id: 'button',
        component: 'Button',
        child: 'buttonLabel',
        action: { event: { name: 'refresh', context: {} } },
      },
      { id: 'buttonLabel', component: 'Text', text: '刷新' },
    ],
  },
} as A2UIMessage;

const updateWithActionOnText = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [
      {
        id: 'label',
        component: 'Text',
        text: '联系',
        action: { event: { name: 'submit', context: {} } },
      },
    ],
  },
} as A2UIMessage;

const updateWithUrlText = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [{ id: 'root', component: 'Text', text: 'see https://example.com/a.png' }],
  },
} as A2UIMessage;

describe('validateAgentSequence（通用 guard，宿主 registry 显式注入）', () => {
  it('生成流必须先 create 再 update', () => {
    assert.equal(
      validateAgentSequence(update, 0, options()),
      '生成流第一条消息必须是 createSurface',
    );
    assert.equal(validateAgentSequence(create, 0, options()), null);
    assert.equal(validateAgentSequence(update, 1, options()), null);
  });

  it('action 响应不能创建或删除 surface', () => {
    assert.equal(validateAgentSequence(update, 0, options({ kind: 'action' })), null);
    assert.equal(
      validateAgentSequence(create, 0, options({ kind: 'action' })),
      'action 响应只能包含 updateComponents 或 updateDataModel',
    );
  });

  it('createSurface.catalogId 必须保持为序列声明的 catalog', () => {
    assert.equal(
      validateAgentSequence(createWithWrongCatalog, 0, options()),
      `createSurface.catalogId 必须保持为 ${TEST_CATALOG_ID}`,
    );
  });

  it('拒绝 registry 未声明的组件', () => {
    assert.equal(
      validateAgentSequence(updateWithUnsupportedComponent, 1, options()),
      '当前 Agent 线不支持组件: TextInput',
    );
  });

  it('拒绝 catalog 未声明的 action 名称', () => {
    assert.equal(
      validateAgentSequence(updateWithUnsupportedAction, 1, options()),
      '当前 Agent 线不支持 action: refresh',
    );
  });

  it('action 挂载组件不再按 Button/TaskButton 名称特判（Catalog v2 能力声明的目标见 SPEC §4）', () => {
    assert.equal(validateAgentSequence(updateWithActionOnText, 1, options()), null);
  });

  it('消息 surfaceId 必须与序列一致', () => {
    const wrongSurface = {
      version: 'v0.9',
      updateDataModel: { surfaceId: 'surface-other', value: {} },
    } as A2UIMessage;
    assert.match(
      validateAgentSequence(wrongSurface, 1, options()) ?? '',
      /消息 surfaceId 必须保持为 surface-1/,
    );
  });
});

describe('validateAgentStreamMessageDetailed（流式语义 + 宿主 policy 注入）', () => {
  it('未注入 policy 时不施加任何业务规则（媒体关键词/URL 文本不再由 SDK 拦截）', () => {
    const state = createAgentStreamState();
    const issue = validateAgentStreamMessageDetailed(
      updateWithUrlText,
      1,
      options({ message: '生成一张带头像的联系人卡片 https://example.com/a.png' }),
      state,
    );
    assert.equal(issue, null);
    const finalIssue = validateAgentStreamFinalDetailed(options({ message: '搜索 表单 视频' }), {
      ...createAgentStreamState(),
      hasRoot: true,
      componentsById: state.componentsById,
    });
    assert.equal(finalIssue, null);
  });

  it('宿主 policy 的 validateComponent 结果标记为 POLICY_REJECTED', () => {
    const issue = validateAgentStreamMessageDetailed(
      updateWithRoot,
      1,
      options({
        policy: {
          name: 'host-policy',
          validateComponent: () => 'host policy rejected',
        },
      }),
      createAgentStreamState(),
    );

    assert.deepEqual(issue, {
      boundaryCode: 'POLICY_REJECTED',
      message: 'host policy rejected',
    });
  });

  it('宿主 policy 的 validateFinal 结果标记为 POLICY_REJECTED', () => {
    const state = createAgentStreamState();
    state.hasRoot = true;
    state.componentsById.set('root', {
      id: 'root',
      component: 'Text',
      text: 'final surface',
    });
    const issue = validateAgentStreamFinalDetailed(
      options({
        policy: {
          name: 'host-policy',
          validateFinal: () => 'workflow rejected',
        },
      }),
      state,
    );

    assert.deepEqual(issue, {
      boundaryCode: 'POLICY_REJECTED',
      message: 'workflow rejected',
    });
  });

  it('流式状态在 updateDataModel 后保留组件表用于诊断', () => {
    const state = createAgentStreamState();
    const dataModelUpdate = {
      version: 'v0.9',
      updateDataModel: { surfaceId: 'surface-1', value: { ok: true } },
    } as A2UIMessage;
    assert.equal(validateAgentStreamMessageDetailed(updateWithRoot, 1, options(), state), null);
    assert.equal(validateAgentStreamMessageDetailed(dataModelUpdate, 2, options(), state), null);
    // applyDataModelUpdate 把 value 对象写入 dataModel。
    assert.deepEqual(state.dataModel, { ok: true });
    assert.ok(state.hasRoot);
  });
});
