import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createAgentStreamState,
  validateAgentStreamFinal,
  validateAgentStreamMessageDetailed,
  validateAgentSequence,
  validateAgentStreamMessage,
} from '../src/agent/agent-guard';
import { BASIC_CATALOG, createWorkbenchFixture } from '../src/agent/mock-agent';
import { WORKBENCH_CATALOG } from '../src/agent/catalog';
import { CatalogRegistry } from '@nexus-ui/core';
import type { A2UIMessage, Component } from '@nexus-ui/core';

const create = {
  version: 'v0.9',
  createSurface: { surfaceId: 'surface-1', catalogId: BASIC_CATALOG },
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
const updateWithList = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [
      { id: 'root', component: 'List', children: ['first'] },
      { id: 'first', component: 'Text', text: 'First' },
    ],
  },
} as A2UIMessage;
const updateWithTabs = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [
      {
        id: 'root',
        component: 'Tabs',
        tabs: [
          { title: 'Overview', child: 'overview' },
          { title: 'Settings', child: 'settings' },
        ],
      },
      { id: 'overview', component: 'Text', text: 'Overview' },
      { id: 'settings', component: 'Text', text: 'Settings' },
    ],
  },
} as A2UIMessage;
const updateWithLegacyImage = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [{ id: 'root', component: 'Image', src: 'https://example.com/a.png', alt: '头像' }],
  },
} as A2UIMessage;
const updateWithImage = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [
      {
        id: 'root',
        component: 'Image',
        url: { path: '/avatar' },
        description: '头像',
        variant: 'avatar',
      },
    ],
  },
} as A2UIMessage;
const updateWithInvalidImageVariant = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [
      {
        id: 'root',
        component: 'Image',
        url: 'https://example.com/a.png',
        description: '头像',
        variant: 'circle',
      },
    ],
  },
} as A2UIMessage;
const updateWithUrlText = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [
      {
        id: 'root',
        component: 'Text',
        text: '韩国艺人 | 头像: https://example.com/avatars/kim-so-hyun.jpg',
      },
    ],
  },
} as A2UIMessage;
const createForStream = {
  version: 'v0.9',
  createSurface: { surfaceId: 'surface-1', catalogId: BASIC_CATALOG },
} as A2UIMessage;
const updateWithDynamicUrlText = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [
      { id: 'root', component: 'Card', child: 'avatarLabel' },
      { id: 'avatarLabel', component: 'Text', text: { path: '/avatarUrl' } },
    ],
  },
} as A2UIMessage;
const updateWithAvatarImage = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [
      { id: 'root', component: 'Card', child: 'avatar' },
      {
        id: 'avatar',
        component: 'Image',
        url: { path: '/avatarUrl' },
        description: '头像',
        variant: 'avatar',
        fit: 'cover',
      },
    ],
  },
} as A2UIMessage;
const updateWithAvatarDataModel = {
  version: 'v0.9',
  updateDataModel: {
    surfaceId: 'surface-1',
    value: { avatarUrl: 'https://example.com/avatar.png' },
  },
} as A2UIMessage;
const updateWithBioDataModel = {
  version: 'v0.9',
  updateDataModel: {
    surfaceId: 'surface-1',
    value: { bio: 'https://example.com/avatar.png' },
  },
} as A2UIMessage;
const updateWithBioText = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [
      { id: 'root', component: 'Card', child: 'bio' },
      { id: 'bio', component: 'Text', text: { path: '/bio' } },
    ],
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
        action: { event: { name: 'refresh', context: {} } },
      },
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
        action: { event: { name: 'call', context: {} } },
      },
    ],
  },
} as A2UIMessage;
const updateWithValidTextField = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [
      {
        id: 'keyword',
        component: 'TextField',
        label: '关键词',
        value: { path: '/keyword' },
        variant: 'shortText',
      },
    ],
  },
} as A2UIMessage;
const updateWithLiteralTextFieldValue = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [
      {
        id: 'keyword',
        component: 'TextField',
        label: '关键词',
        value: 'A2UI',
      },
    ],
  },
} as A2UIMessage;
const updateWithLongTextField = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [
      {
        id: 'bio',
        component: 'TextField',
        label: '简介',
        value: { path: '/bio' },
        variant: 'longText',
      },
    ],
  },
} as A2UIMessage;
const updateWithValidatedTextField = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [
      {
        id: 'code',
        component: 'TextField',
        label: '编号',
        value: { path: '/code' },
        variant: 'obscured',
        validationRegexp: '^[A-Z0-9]{6}$',
      },
    ],
  },
} as A2UIMessage;
const updateWithBrokenValidationRegexp = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [
      {
        id: 'code',
        component: 'TextField',
        label: '编号',
        value: { path: '/code' },
        validationRegexp: '[',
      },
    ],
  },
} as A2UIMessage;
const updateWithSearchForm = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [
      { id: 'root', component: 'Column', children: ['keyword', 'searchButton', 'searchResult'] },
      {
        id: 'keyword',
        component: 'TextField',
        label: '关键词',
        value: { path: '/keyword' },
        variant: 'shortText',
      },
      {
        id: 'searchButton',
        component: 'Button',
        child: 'searchLabel',
        action: {
          event: { name: 'search', context: { keyword: { path: '/keyword' } } },
        },
      },
      { id: 'searchLabel', component: 'Text', text: '搜索' },
      { id: 'searchResult', component: 'Text', text: '等待搜索' },
    ],
  },
} as A2UIMessage;
const updateWithBrokenSearchForm = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: (
      updateWithSearchForm as {
        updateComponents: { components: Component[] };
      }
    ).updateComponents.components.map((component) =>
      component.id === 'searchButton'
        ? {
            ...component,
            action: { event: { name: 'search', context: { keyword: 'not-bound' } } },
          }
        : component,
    ),
  },
} as A2UIMessage;
const updateWithValidCheckBox = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [
      {
        id: 'subscribed',
        component: 'CheckBox',
        label: '接收通知',
        value: { path: '/subscribed' },
      },
    ],
  },
} as A2UIMessage;
const updateWithLiteralCheckBoxValue = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [
      {
        id: 'subscribed',
        component: 'CheckBox',
        label: '接收通知',
        value: false,
      },
    ],
  },
} as A2UIMessage;
const updateWithUnknownCheckBoxField = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [
      {
        id: 'subscribed',
        component: 'CheckBox',
        label: '接收通知',
        value: { path: '/subscribed' },
        checked: true,
      },
    ],
  },
} as A2UIMessage;
const updateWithCheckBoxAction = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [
      {
        id: 'subscribed',
        component: 'CheckBox',
        label: '接收通知',
        value: { path: '/subscribed' },
        action: { event: { name: 'submit', context: {} } },
      },
    ],
  },
} as A2UIMessage;
const updateWithSubmitForm = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: [
      {
        id: 'root',
        component: 'Column',
        children: ['name', 'subscribed', 'submitButton', 'submitResult'],
      },
      {
        id: 'name',
        component: 'TextField',
        label: '姓名',
        value: { path: '/name' },
        variant: 'shortText',
      },
      {
        id: 'subscribed',
        component: 'CheckBox',
        label: '接收通知',
        value: { path: '/subscribed' },
      },
      {
        id: 'submitButton',
        component: 'Button',
        child: 'submitLabel',
        action: {
          event: {
            name: 'submit',
            context: {
              name: { path: '/name' },
              subscribed: { path: '/subscribed' },
            },
          },
        },
      },
      { id: 'submitLabel', component: 'Text', text: '提交' },
      { id: 'submitResult', component: 'Text', text: '等待提交' },
    ],
  },
} as A2UIMessage;
const updateWithBrokenSubmitForm = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: (
      updateWithSubmitForm as {
        updateComponents: { components: Component[] };
      }
    ).updateComponents.components.map((component) =>
      component.id === 'submitButton'
        ? {
            ...component,
            action: {
              event: { name: 'submit', context: { name: { path: '/name' } } },
            },
          }
        : component,
    ),
  },
} as A2UIMessage;
const updateWithUnreachableSubmitForm = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'surface-1',
    components: (
      updateWithSubmitForm as {
        updateComponents: { components: Component[] };
      }
    ).updateComponents.components.map((component) =>
      component.id === 'root' ? { ...component, children: ['name', 'subscribed'] } : component,
    ),
  },
} as A2UIMessage;

describe('validateAgentSequence', () => {
  it('生成流必须先 create 再 update', () => {
    assert.equal(
      validateAgentSequence(update, 0, { kind: 'generate', surfaceId: 'surface-1' }),
      '生成流第一条消息必须是 createSurface',
    );
    assert.equal(
      validateAgentSequence(create, 0, { kind: 'generate', surfaceId: 'surface-1' }),
      null,
    );
    assert.equal(
      validateAgentSequence(update, 1, { kind: 'generate', surfaceId: 'surface-1' }),
      null,
    );
  });

  it('action 响应不能创建或删除 surface', () => {
    assert.equal(
      validateAgentSequence(update, 0, { kind: 'action', surfaceId: 'surface-1' }),
      null,
    );
    assert.equal(
      validateAgentSequence(create, 0, { kind: 'action', surfaceId: 'surface-1' }),
      'action 响应只能包含 updateComponents 或 updateDataModel',
    );
  });

  it('限制 catalog 与第一版标准组件子集', () => {
    assert.equal(
      validateAgentSequence(createWithWrongCatalog, 0, {
        kind: 'generate',
        surfaceId: 'surface-1',
      }),
      'createSurface.catalogId 必须保持为 https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
    );
    assert.equal(
      validateAgentSequence(updateWithUnsupportedComponent, 1, {
        kind: 'generate',
        surfaceId: 'surface-1',
      }),
      '当前 Agent 线不支持组件: TextInput',
    );
  });

  it('限制当前 Agent 线支持的 action 名称', () => {
    assert.equal(
      validateAgentSequence(updateWithUnsupportedAction, 1, {
        kind: 'generate',
        surfaceId: 'surface-1',
      }),
      '当前 Agent 线不支持 action: refresh',
    );
  });

  it('Basic Catalog TextField 必须使用双向绑定 value', () => {
    assert.equal(
      validateAgentSequence(updateWithValidTextField, 1, {
        kind: 'generate',
        surfaceId: 'surface-1',
      }),
      null,
    );
    assert.equal(
      validateAgentSequence(updateWithLiteralTextFieldValue, 1, {
        kind: 'generate',
        surfaceId: 'surface-1',
      }),
      'Basic Catalog TextField.value 必须是 { path } 绑定',
    );
  });

  it('Basic Catalog TextField 支持官方输入变体与 validationRegexp', () => {
    assert.equal(
      validateAgentSequence(updateWithLongTextField, 1, {
        kind: 'generate',
        surfaceId: 'surface-1',
      }),
      null,
    );
    assert.equal(
      validateAgentSequence(updateWithValidatedTextField, 1, {
        kind: 'generate',
        surfaceId: 'surface-1',
      }),
      null,
    );
    assert.equal(
      validateAgentSequence(updateWithBrokenValidationRegexp, 1, {
        kind: 'generate',
        surfaceId: 'surface-1',
      }),
      'TextField.validationRegexp 必须是合法正则表达式',
    );
  });

  it('Basic Catalog CheckBox 必须使用双向绑定 value 且不能挂 action', () => {
    const options = { kind: 'generate' as const, surfaceId: 'surface-1' };
    assert.equal(validateAgentSequence(updateWithValidCheckBox, 1, options), null);
    assert.equal(
      validateAgentSequence(updateWithLiteralCheckBoxValue, 1, options),
      'Basic Catalog CheckBox.value 必须是 { path } 绑定',
    );
    assert.equal(
      validateAgentSequence(updateWithUnknownCheckBoxField, 1, options),
      'Basic Catalog CheckBox 只支持 id/component/label/value',
    );
    assert.equal(
      validateAgentSequence(updateWithCheckBoxAction, 1, options),
      'CheckBox 不支持挂载 action',
    );
  });

  it('Basic Catalog ChoicePicker 必须使用合法选项和双向绑定 value', () => {
    const message = (component: unknown) =>
      ({
        version: 'v0.9',
        updateComponents: { surfaceId: 'surface-1', components: [component] },
      }) as A2UIMessage;
    const options = { kind: 'generate' as const, surfaceId: 'surface-1' };
    const valid = {
      id: 'priority',
      component: 'ChoicePicker',
      label: '优先级',
      variant: 'mutuallyExclusive',
      options: [
        { label: '高', value: 'high' },
        { label: '普通', value: 'normal' },
      ],
      value: { path: '/priority' },
      displayStyle: 'chips',
    };

    assert.equal(validateAgentSequence(message(valid), 1, options), null);
    assert.equal(
      validateAgentSequence(message({ ...valid, value: ['normal'] }), 1, options),
      'ChoicePicker.value 必须是 { path } 绑定',
    );
    assert.equal(
      validateAgentSequence(message({ ...valid, checks: [] }), 1, options),
      'ChoicePicker 只支持 id/component/label/variant/options/value/displayStyle/filterable',
    );
    assert.equal(
      validateAgentSequence(
        message({ ...valid, action: { event: { name: 'submit' } } }),
        1,
        options,
      ),
      'ChoicePicker 不支持挂载 action',
    );
  });

  it('Basic Catalog Slider 必须使用数字范围和双向绑定 value', () => {
    const message = (component: unknown) =>
      ({
        version: 'v0.9',
        updateComponents: { surfaceId: 'surface-1', components: [component] },
      }) as A2UIMessage;
    const options = { kind: 'generate' as const, surfaceId: 'surface-1' };
    const valid = {
      id: 'threshold',
      component: 'Slider',
      label: '阈值',
      min: 0,
      max: 1,
      value: { path: '/threshold' },
    };

    assert.equal(validateAgentSequence(message(valid), 1, options), null);
    assert.equal(
      validateAgentSequence(message({ ...valid, value: 0.5 }), 1, options),
      'Slider.value 必须是 { path } 绑定',
    );
    assert.equal(
      validateAgentSequence(message({ ...valid, min: { path: '/min' } }), 1, options),
      'Slider.min 必须是有限数字',
    );
    assert.equal(
      validateAgentSequence(message({ ...valid, max: undefined }), 1, options),
      'Slider.max 必须是有限数字',
    );
    assert.equal(
      validateAgentSequence(message({ ...valid, min: 1 }), 1, options),
      'Slider.min 必须小于 max',
    );
    assert.equal(
      validateAgentSequence(message({ ...valid, checks: [] }), 1, options),
      '当前 Agent 线不支持 Slider.checks',
    );
    assert.equal(
      validateAgentSequence(
        message({ ...valid, action: { event: { name: 'submit' } } }),
        1,
        options,
      ),
      'Slider 不支持挂载 action',
    );
  });

  it('Basic Catalog DateTimeInput 必须使用 ISO 时间和双向绑定 value', () => {
    const message = (component: unknown) =>
      ({
        version: 'v0.9',
        updateComponents: { surfaceId: 'surface-1', components: [component] },
      }) as A2UIMessage;
    const options = { kind: 'generate' as const, surfaceId: 'surface-1' };
    const valid = {
      id: 'reminderAt',
      component: 'DateTimeInput',
      label: '提醒时间',
      value: { path: '/reminderAt' },
      enableDate: true,
      enableTime: true,
      min: '2026-01-01T00:00',
      max: { path: '/maxReminderAt' },
    };

    assert.equal(validateAgentSequence(message(valid), 1, options), null);
    assert.equal(
      validateAgentSequence(message({ ...valid, value: '2026-09-20T10:00:00' }), 1, options),
      'DateTimeInput.value 必须是 { path } 绑定',
    );
    assert.equal(
      validateAgentSequence(
        message({ ...valid, enableDate: false, enableTime: false }),
        1,
        options,
      ),
      'DateTimeInput.enableDate/enableTime 至少一个为 true',
    );
    assert.equal(
      validateAgentSequence(message({ ...valid, min: 'tomorrow' }), 1, options),
      'DateTimeInput.min 必须是 ISO 8601 date/time/date-time 字符串',
    );
    assert.equal(
      validateAgentSequence(
        message({ ...valid, action: { event: { name: 'submit' } } }),
        1,
        options,
      ),
      'DateTimeInput 不支持挂载 action',
    );
    assert.equal(
      validateAgentSequence(message({ ...valid, checks: [] }), 1, options),
      'DateTimeInput 只支持 id/component/label/value/enableDate/enableTime/min/max',
    );
  });

  it('Basic Catalog action 只能挂载在 Button 组件上', () => {
    assert.equal(
      validateAgentSequence(updateWithActionOnText, 1, {
        kind: 'generate',
        surfaceId: 'surface-1',
      }),
      '当前 Agent 线 action 只能挂载在 Button 组件上',
    );
  });

  it('Basic Catalog 支持静态 children 的 List 组件', () => {
    assert.equal(
      validateAgentSequence(updateWithList, 1, {
        kind: 'generate',
        surfaceId: 'surface-1',
      }),
      null,
    );
  });

  it('Basic Catalog 支持静态 tabs 的 Tabs 组件', () => {
    assert.equal(
      validateAgentSequence(updateWithTabs, 1, {
        kind: 'generate',
        surfaceId: 'surface-1',
      }),
      null,
    );
  });

  it('Basic Catalog Image 必须使用协议字段 url / description', () => {
    assert.equal(
      validateAgentSequence(updateWithLegacyImage, 1, {
        kind: 'generate',
        surfaceId: 'surface-1',
      }),
      'Basic Catalog Image 不支持 src/alt，请使用 url/description',
    );
    assert.equal(
      validateAgentSequence(updateWithImage, 1, {
        kind: 'generate',
        surfaceId: 'surface-1',
      }),
      null,
    );
  });

  it('Basic Catalog Image 只允许 avatar 变体和合法 fit', () => {
    assert.equal(
      validateAgentSequence(updateWithInvalidImageVariant, 1, {
        kind: 'generate',
        surfaceId: 'surface-1',
      }),
      'Basic Catalog Image.variant 只支持 avatar',
    );
  });

  it('Basic Catalog Text 不能把图片 URL 渲染成文字', () => {
    assert.equal(
      validateAgentSequence(updateWithUrlText, 1, {
        kind: 'generate',
        surfaceId: 'surface-1',
      }),
      'Basic Catalog Text 不能承载 URL；图片 URL 必须使用 Image.url',
    );
  });

  it('Basic Catalog Text 不能通过 dataModel 绑定渲染 URL', () => {
    const state = createAgentStreamState();
    const options = {
      kind: 'generate' as const,
      surfaceId: 'surface-1',
      message: '生成头像 https://example.com/avatar.png',
    };

    assert.equal(
      validateAgentStreamMessage(updateWithDynamicUrlText, 1, options, state),
      'Basic Catalog Text 不能绑定 URL 类字段；图片 URL 必须使用 Image.url',
    );

    const noImageUrlOptions = { ...options, message: '生成联系人卡片' };
    assert.equal(
      validateAgentStreamMessage(updateWithDynamicUrlText, 1, noImageUrlOptions, state),
      'Basic Catalog Text 不能绑定 URL 类字段；图片 URL 必须使用 Image.url',
    );

    const missingImageState = createAgentStreamState();
    assert.equal(
      validateAgentStreamMessage(updateWithBioText, 1, options, missingImageState),
      '包含图片 URL 的生成流必须包含 Basic Catalog Image 组件',
    );
  });

  it('URL dataModel 只能绑定到 Image，不能后到绑定到 Text', () => {
    const state = createAgentStreamState();
    const options = { kind: 'generate' as const, surfaceId: 'surface-1' };

    assert.equal(validateAgentStreamMessage(createForStream, 0, options, state), null);
    assert.equal(validateAgentStreamMessage(updateWithAvatarImage, 1, options, state), null);
    assert.equal(validateAgentStreamMessage(updateWithAvatarDataModel, 2, options, state), null);

    const textState = createAgentStreamState();
    assert.equal(validateAgentStreamMessage(createForStream, 0, options, textState), null);
    assert.equal(validateAgentStreamMessage(updateWithBioDataModel, 1, options, textState), null);
    assert.equal(
      validateAgentStreamMessage(updateWithBioText, 2, options, textState),
      'Basic Catalog Text 不能承载 URL；图片 URL 必须使用 Image.url',
    );
  });

  it('搜索请求必须形成 TextField -> search action -> searchResult 的闭环', () => {
    const state = createAgentStreamState();
    const options = {
      kind: 'generate' as const,
      surfaceId: 'surface-1',
      message: '生成一个搜索卡片，包含关键词输入框',
    };

    assert.equal(validateAgentStreamMessage(createForStream, 0, options, state), null);
    assert.equal(validateAgentStreamMessage(updateWithSearchForm, 1, options, state), null);
    assert.equal(validateAgentStreamFinal(options, state), null);

    const brokenState = createAgentStreamState();
    assert.equal(validateAgentStreamMessage(createForStream, 0, options, brokenState), null);
    assert.equal(
      validateAgentStreamMessage(updateWithBrokenSearchForm, 1, options, brokenState),
      null,
    );
    assert.equal(
      validateAgentStreamFinal(options, brokenState),
      'search action 的 keyword.context 必须绑定 TextField.value 的同一个 path',
    );
  });

  it('表单请求必须形成 TextField + CheckBox + submit + submitResult 的闭环', () => {
    const state = createAgentStreamState();
    const options = {
      kind: 'generate' as const,
      surfaceId: 'surface-1',
      message: '生成一个订阅表单卡片',
    };

    assert.equal(validateAgentStreamMessage(createForStream, 0, options, state), null);
    assert.equal(validateAgentStreamMessage(updateWithSubmitForm, 1, options, state), null);
    assert.equal(validateAgentStreamFinal(options, state), null);

    const brokenState = createAgentStreamState();
    assert.equal(validateAgentStreamMessage(createForStream, 0, options, brokenState), null);
    assert.equal(
      validateAgentStreamMessage(updateWithBrokenSubmitForm, 1, options, brokenState),
      null,
    );
    assert.equal(
      validateAgentStreamFinal(options, brokenState),
      'submit action 的 context 必须绑定 CheckBox.value 的同一个 path',
    );

    const unreachableState = createAgentStreamState();
    assert.equal(validateAgentStreamMessage(createForStream, 0, options, unreachableState), null);
    assert.equal(
      validateAgentStreamMessage(updateWithUnreachableSubmitForm, 1, options, unreachableState),
      null,
    );
    assert.equal(
      validateAgentStreamFinal(options, unreachableState),
      '表单 UI 的 TextField/CheckBox/submit/submitResult 必须挂在 root 渲染树内',
    );
  });

  it('通过注册表支持自定义 catalog 组件边界', () => {
    const customCatalogId = 'https://example.com/catalogs/task/v1';
    const registry = new CatalogRegistry([
      {
        catalogId: customCatalogId,
        components: ['TaskSummary', 'TaskButton'],
        componentSchemas: {
          TaskSummary: {
            type: 'object',
            additionalProperties: false,
            required: ['title'],
            properties: { title: { type: 'string', dynamic: 'required' } },
          },
          TaskButton: {
            type: 'object',
            additionalProperties: false,
            required: ['label'],
            properties: { label: { type: 'string', dynamic: 'allowed' } },
          },
        },
      },
    ]);
    const create = {
      version: 'v0.9',
      createSurface: { surfaceId: 'surface-1', catalogId: customCatalogId },
    } as A2UIMessage;
    const update = {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'surface-1',
        components: [{ id: 'root', component: 'TaskSummary', title: { path: '/title' } }],
      },
    } as A2UIMessage;
    const invalidProps = {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'surface-1',
        components: [{ id: 'root', component: 'TaskSummary', title: '字面量标题' }],
      },
    } as A2UIMessage;
    const updateWithBasicComponent = {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'surface-1',
        components: [{ id: 'root', component: 'Text' }],
      },
    } as A2UIMessage;

    const options = {
      kind: 'generate',
      surfaceId: 'surface-1',
      catalogId: customCatalogId,
      registry,
    } as const;

    assert.equal(validateAgentSequence(create, 0, options), null);
    assert.equal(validateAgentSequence(update, 1, options), null);
    assert.equal(
      validateAgentSequence(updateWithBasicComponent, 1, options),
      '当前 Agent 线不支持组件: Text',
    );
    assert.equal(
      validateAgentSequence(invalidProps, 1, options),
      'TaskSummary.title 必须是 { path } 绑定',
    );
  });

  it('自定义 catalog 动态绑定会跨消息校验 resolved value', () => {
    const customCatalogId = 'https://example.com/catalogs/task/v2';
    const registry = new CatalogRegistry([
      {
        catalogId: customCatalogId,
        components: ['TaskSummary'],
        componentSchemas: {
          TaskSummary: {
            type: 'object',
            properties: { amount: { type: 'number', dynamic: 'allowed' } },
          },
        },
      },
    ]);
    const options = {
      kind: 'generate' as const,
      surfaceId: 'surface-1',
      catalogId: customCatalogId,
      registry,
    };
    const create = {
      version: 'v0.9',
      createSurface: { surfaceId: 'surface-1', catalogId: customCatalogId },
    } as A2UIMessage;
    const updateComponent = {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'surface-1',
        components: [{ id: 'root', component: 'TaskSummary', amount: { path: '/amount' } }],
      },
    } as A2UIMessage;
    const updateWrongData = {
      version: 'v0.9',
      updateDataModel: { surfaceId: 'surface-1', value: { amount: '12' } },
    } as A2UIMessage;

    const componentFirstState = createAgentStreamState();
    assert.equal(validateAgentStreamMessage(create, 0, options, componentFirstState), null);
    assert.equal(
      validateAgentStreamMessage(updateComponent, 1, options, componentFirstState),
      null,
    );
    assert.equal(
      validateAgentStreamMessage(updateWrongData, 2, options, componentFirstState),
      'TaskSummary.amount 必须是 number',
    );
    assert.equal(componentFirstState.dataModel, undefined);

    const dataFirstState = createAgentStreamState();
    assert.equal(validateAgentStreamMessage(create, 0, options, dataFirstState), null);
    assert.equal(validateAgentStreamMessage(updateWrongData, 1, options, dataFirstState), null);
    assert.deepEqual(dataFirstState.dataModel, { amount: '12' });
    assert.equal(
      validateAgentStreamMessage(updateComponent, 2, options, dataFirstState),
      'TaskSummary.amount 必须是 number',
    );
    assert.equal(dataFirstState.componentsById.size, 0);

    const detailedState = createAgentStreamState();
    assert.equal(validateAgentStreamMessage(create, 0, options, detailedState), null);
    assert.equal(validateAgentStreamMessage(updateWrongData, 1, options, detailedState), null);
    assert.deepEqual(
      validateAgentStreamMessageDetailed(updateComponent, 2, options, detailedState),
      {
        message: 'TaskSummary.amount 必须是 number',
        diagnostics: [
          {
            path: 'TaskSummary.amount',
            message: 'TaskSummary.amount 必须是 number',
            dataPath: '/amount',
          },
        ],
      },
    );
  });

  it('Workbench 流必须形成客户摘要、输入、时间选择和 submit 的业务闭环', () => {
    const options = {
      kind: 'generate' as const,
      surfaceId: 'surface-workbench',
      catalogId: WORKBENCH_CATALOG,
      message: '帮我给华云科技创建一条客户跟进任务',
    };
    const state = createAgentStreamState();
    createWorkbenchFixture('surface-workbench').forEach((message, index) => {
      assert.equal(validateAgentStreamMessage(message as A2UIMessage, index, options, state), null);
    });
    assert.equal(validateAgentStreamFinal(options, state), null);

    const invalidCustomer = {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'surface-workbench',
        components: [
          {
            id: 'customer',
            component: 'CustomerSummary',
            customerName: '华云科技',
            company: { path: '/customer/company' },
            owner: { path: '/customer/owner' },
            status: { path: '/status' },
            recentNote: { path: '/customer/recentNote' },
          },
        ],
      },
    } as A2UIMessage;
    assert.equal(
      validateAgentSequence(invalidCustomer, 1, options),
      'CustomerSummary.customerName 必须是 { path } 绑定',
    );

    const unsupportedComponent = {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'surface-workbench',
        components: [{ id: 'root', component: 'TaskSummary' }],
      },
    } as A2UIMessage;
    assert.equal(
      validateAgentSequence(unsupportedComponent, 1, options),
      '当前 Agent 线不支持组件: TaskSummary',
    );

    const withoutReminderAt = createWorkbenchFixture('surface-workbench').map((candidate) => {
      const message = candidate as A2UIMessage;
      if (!('updateComponents' in message)) return message;
      return {
        ...message,
        updateComponents: {
          ...message.updateComponents,
          components: message.updateComponents.components.filter(
            (component) => component.id !== 'reminderAt',
          ),
        },
      };
    });
    const missingReminderAtState = createAgentStreamState();
    withoutReminderAt.forEach((message, index) => {
      assert.equal(
        validateAgentStreamMessage(message as A2UIMessage, index, options, missingReminderAtState),
        null,
      );
    });
    assert.equal(
      validateAgentStreamFinal(options, missingReminderAtState),
      'Workbench UI 的 reminderAt 必须是同时启用日期和时间的 DateTimeInput',
    );

    const withDateOnly = createWorkbenchFixture('surface-workbench').map((candidate) => {
      const message = candidate as A2UIMessage;
      if (!('updateComponents' in message)) return message;
      return {
        ...message,
        updateComponents: {
          ...message.updateComponents,
          components: message.updateComponents.components.map((component) =>
            component.id === 'reminderAt' ? { ...component, enableTime: false } : component,
          ),
        },
      };
    });
    const dateOnlyState = createAgentStreamState();
    withDateOnly.forEach((message, index) => {
      assert.equal(
        validateAgentStreamMessage(message as A2UIMessage, index, options, dateOnlyState),
        null,
      );
    });
    assert.equal(
      validateAgentStreamFinal(options, dateOnlyState),
      'Workbench UI 的 reminderAt 必须是同时启用日期和时间的 DateTimeInput',
    );

    const withWrongReminderPath = createWorkbenchFixture('surface-workbench').map((candidate) => {
      const message = candidate as A2UIMessage;
      if (!('updateComponents' in message)) return message;
      return {
        ...message,
        updateComponents: {
          ...message.updateComponents,
          components: message.updateComponents.components.map((component) =>
            component.id === 'reminderAt'
              ? { ...component, value: { path: '/reminder-time' } }
              : component,
          ),
        },
      };
    });
    const wrongPathState = createAgentStreamState();
    withWrongReminderPath.forEach((message, index) => {
      assert.equal(
        validateAgentStreamMessage(message as A2UIMessage, index, options, wrongPathState),
        null,
      );
    });
    assert.equal(
      validateAgentStreamFinal(options, wrongPathState),
      'Workbench UI 的 reminderAt 必须是同时启用日期和时间的 DateTimeInput',
    );

    const withoutPriority = createWorkbenchFixture('surface-workbench').map((candidate) => {
      const message = candidate as A2UIMessage;
      if (!('updateComponents' in message)) return message;
      return {
        ...message,
        updateComponents: {
          ...message.updateComponents,
          components: message.updateComponents.components.filter(
            (component) => component.id !== 'priority',
          ),
        },
      };
    });
    const missingPriorityState = createAgentStreamState();
    withoutPriority.forEach((message, index) => {
      assert.equal(
        validateAgentStreamMessage(message as A2UIMessage, index, options, missingPriorityState),
        null,
      );
    });
    assert.equal(
      validateAgentStreamFinal(options, missingPriorityState),
      'Workbench UI 的 priority 必须是绑定 /priority 的单选 ChoicePicker',
    );

    const withoutCustomerContext = createWorkbenchFixture('surface-workbench').map((candidate) => {
      const message = candidate as A2UIMessage;
      if (!('updateComponents' in message)) return message;
      return {
        ...message,
        updateComponents: {
          ...message.updateComponents,
          components: message.updateComponents.components.map((component) =>
            component.id === 'submitButton'
              ? {
                  ...component,
                  action: {
                    event: {
                      ...component.action?.event,
                      context: {
                        taskTitle: { path: '/taskTitle' },
                        reminderAt: { path: '/reminderAt' },
                      },
                    },
                  },
                }
              : component,
          ),
        },
      };
    });
    const missingContextState = createAgentStreamState();
    withoutCustomerContext.forEach((message, index) => {
      assert.equal(
        validateAgentStreamMessage(message as A2UIMessage, index, options, missingContextState),
        null,
      );
    });
    assert.equal(
      validateAgentStreamFinal(options, missingContextState),
      'Workbench submit context 必须绑定 /taskTitle、/reminderAt、/priority 和 /customer/customerId',
    );
  });
});
