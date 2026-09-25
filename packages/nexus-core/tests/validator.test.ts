import { expect } from 'chai';
import { validateNexusProfileMessage } from '../src/protocol/validator';

const validateA2UIMessage = (value: unknown) => {
  const profileError = validateNexusProfileMessage(value);
  return profileError ? { ok: false as const, error: profileError } : { ok: true as const };
};

const error = (value: unknown): string | undefined => validateA2UIMessage(value).error?.message;

describe('validateNexusProfileMessage', () => {
  it('接受合法 createSurface', () => {
    const result = validateA2UIMessage({
      version: 'v0.9',
      createSurface: { surfaceId: 'demo', catalogId: 'basic' },
    });
    expect(result.ok).to.equal(true);
  });

  it('拒绝多个 payload、未知信封字段和错误版本', () => {
    expect(
      error({
        version: 'v0.9',
        createSurface: { surfaceId: 'd', catalogId: 'basic' },
        deleteSurface: { surfaceId: 'd' },
      }),
    ).to.equal('消息必须且只能包含一个 A2UI payload');
    expect(
      error({
        version: 'v0.9',
        createSurface: { surfaceId: 'd', catalogId: 'basic' },
        extra: 1,
      }),
    ).to.equal('消息信封包含未知字段');
    expect(error({ version: 'v0.8', deleteSurface: { surfaceId: 'd' } })).to.equal(
      'version 必须是 v0.9',
    );
  });

  it('拒绝 payload 缺字段、未知字段和空组件数组', () => {
    expect(error({ version: 'v0.9', createSurface: { surfaceId: 'd' } })).to.equal(
      'createSurface.catalogId 必须是字符串',
    );
    expect(
      error({
        version: 'v0.9',
        updateDataModel: { surfaceId: 'd', path: '/', extra: true },
      }),
    ).to.equal('updateDataModel 包含未知字段');
    expect(
      error({ version: 'v0.9', updateComponents: { surfaceId: 'd', components: [] } }),
    ).to.equal('updateComponents.components 必须是非空数组');
  });

  it('拒绝当前 Agent 线未支持的协议能力', () => {
    expect(
      error({
        version: 'v0.9',
        createSurface: { surfaceId: 'd', catalogId: 'basic', sendDataModel: true },
      }),
    ).to.equal('当前 Agent 线不支持 sendDataModel');
    expect(
      error({
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'd',
          components: [
            { id: 'root', component: 'List', children: { componentId: 'item', path: '/items' } },
          ],
        },
      }),
    ).to.equal('当前 Agent 线只支持静态 children id 数组');
    expect(
      error({
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'd',
          components: [
            { id: 'root', component: 'Button', action: { functionCall: { call: 'openUrl' } } },
          ],
        },
      }),
    ).to.equal('当前 Agent 线不支持 action.functionCall');
    expect(
      error({
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'd',
          components: [
            {
              id: 'root',
              component: 'Text',
              text: { call: 'formatDate', args: { value: '2026-01-01' } },
            },
          ],
        },
      }),
    ).to.equal('当前 Agent 线不支持 FunctionCall');
  });

  it('校验 Tabs 静态标签结构', () => {
    const message = (component: unknown) => ({
      version: 'v0.9',
      updateComponents: { surfaceId: 'd', components: [component] },
    });

    expect(
      validateA2UIMessage(
        message({
          id: 'root',
          component: 'Tabs',
          tabs: [{ title: 'Overview', child: 'overview' }],
        }),
      ).ok,
    ).to.equal(true);
    for (const variant of ['longText', 'number', 'shortText', 'obscured']) {
      expect(
        validateA2UIMessage(
          message({
            id: 'field',
            component: 'TextField',
            label: '字段',
            value: { path: '/field' },
            variant,
            validationRegexp: '^\\d+$',
          }),
        ).ok,
      ).to.equal(true);
    }
    expect(error(message({ id: 'root', component: 'Tabs', tabs: [] }))).to.equal(
      'component.tabs 必须是非空数组',
    );
    expect(
      error(message({ id: 'root', component: 'Tabs', tabs: [{ title: 1, child: 'x' }] })),
    ).to.equal('component.tabs[].title 必须是字符串或 { path } 绑定');
    expect(
      error(
        message({
          id: 'root',
          component: 'Tabs',
          tabs: [{ title: 'Overview', child: 'x', selected: true }],
        }),
      ),
    ).to.equal('component.tabs[] 必须是只包含 title 和 child 的对象');
  });

  it('校验 TextField 官方字段结构', () => {
    const message = (component: unknown) => ({
      version: 'v0.9',
      updateComponents: { surfaceId: 'd', components: [component] },
    });

    expect(
      validateA2UIMessage(
        message({
          id: 'keyword',
          component: 'TextField',
          label: '关键词',
          value: { path: '/keyword' },
          variant: 'shortText',
        }),
      ).ok,
    ).to.equal(true);
    expect(
      error(message({ id: 'keyword', component: 'TextField', value: { path: '/keyword' } })),
    ).to.equal('TextField.label 必须是字符串或 { path } 绑定');
    expect(
      error(message({ id: 'keyword', component: 'TextField', label: '关键词', value: 1 })),
    ).to.equal('TextField.value 必须是字符串或 { path } 绑定');
    expect(
      error(
        message({
          id: 'keyword',
          component: 'TextField',
          label: '关键词',
          value: { path: '/keyword' },
          variant: 'email',
        }),
      ),
    ).to.equal('TextField.variant 只支持 longText/number/shortText/obscured');
    expect(
      error(
        message({
          id: 'keyword',
          component: 'TextField',
          label: '关键词',
          value: { path: '/keyword' },
          validationRegexp: 1,
        }),
      ),
    ).to.equal('TextField.validationRegexp 必须是字符串');
    expect(
      error(
        message({
          id: 'keyword',
          component: 'TextField',
          label: '关键词',
          value: { path: '/keyword' },
          validationRegexp: '[',
        }),
      ),
    ).to.equal('TextField.validationRegexp 必须是合法正则表达式');
    expect(
      error(
        message({
          id: 'keyword',
          component: 'TextField',
          label: '关键词',
          action: { event: { name: 'search' } },
        }),
      ),
    ).to.equal('TextField 不支持挂载 action');
  });

  it('校验 CheckBox 官方字段结构', () => {
    const message = (component: unknown) => ({
      version: 'v0.9',
      updateComponents: { surfaceId: 'd', components: [component] },
    });

    expect(
      validateA2UIMessage(
        message({
          id: 'subscribed',
          component: 'CheckBox',
          label: '接收通知',
          value: { path: '/subscribed' },
        }),
      ).ok,
    ).to.equal(true);
    expect(error(message({ id: 'subscribed', component: 'CheckBox', value: true }))).to.equal(
      'CheckBox.label 必须是字符串或 { path } 绑定',
    );
    expect(
      error(
        message({
          id: 'subscribed',
          component: 'CheckBox',
          label: '接收通知',
          value: 'true',
        }),
      ),
    ).to.equal('CheckBox.value 必须是布尔值或 { path } 绑定');
    expect(
      error(
        message({
          id: 'subscribed',
          component: 'CheckBox',
          label: '接收通知',
          value: { path: '/subscribed' },
          action: { event: { name: 'submit' } },
        }),
      ),
    ).to.equal('CheckBox 不支持挂载 action');
  });

  it('校验 ChoicePicker 官方字段结构', () => {
    const message = (component: unknown) => ({
      version: 'v0.9',
      updateComponents: { surfaceId: 'd', components: [component] },
    });
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
      filterable: false,
    };

    expect(validateA2UIMessage(message(valid)).ok).to.equal(true);
    expect(error(message({ ...valid, value: 'high' }))).to.equal(
      'ChoicePicker.value 必须是字符串数组或 { path } 绑定',
    );
    expect(error(message({ ...valid, options: [] }))).to.equal(
      'ChoicePicker.options 必须是非空数组',
    );
    expect(error(message({ ...valid, options: [{ ...valid.options[0], value: '' }] }))).to.equal(
      'ChoicePicker.options[].value 必须是非空字符串',
    );
    expect(
      error(
        message({
          ...valid,
          options: [
            { label: '高', value: 'high' },
            { label: '高', value: 'high' },
          ],
        }),
      ),
    ).to.equal('ChoicePicker.options[].value 不能重复');
    expect(error(message({ ...valid, variant: 'radio' }))).to.equal(
      'ChoicePicker.variant 只支持 multipleSelection/mutuallyExclusive',
    );
    expect(error(message({ ...valid, action: { event: { name: 'submit' } } }))).to.equal(
      'ChoicePicker 不支持挂载 action',
    );
  });

  it('校验 DateTimeInput 官方字段结构', () => {
    const message = (component: unknown) => ({
      version: 'v0.9',
      updateComponents: { surfaceId: 'd', components: [component] },
    });
    const valid = {
      id: 'reminderAt',
      component: 'DateTimeInput',
      label: '提醒时间',
      value: { path: '/reminderAt' },
      enableDate: true,
      enableTime: true,
      min: '2026-01-01T00:00:00',
    };

    expect(validateA2UIMessage(message(valid)).ok).to.equal(true);
    expect(
      validateA2UIMessage(
        message({ ...valid, value: '', enableDate: false, enableTime: true, min: '09:30:00' }),
      ).ok,
    ).to.equal(true);
    expect(
      validateA2UIMessage(
        message({
          ...valid,
          value: '2026-01-02',
          enableDate: true,
          enableTime: false,
          min: '2026-01-01',
        }),
      ).ok,
    ).to.equal(true);
    expect(error(message({ ...valid, value: 'tomorrow' }))).to.equal(
      'DateTimeInput.value 必须是 ISO 8601 date/time/date-time 字符串',
    );
    expect(error(message({ ...valid, value: 1 }))).to.equal(
      'DateTimeInput.value 必须是 ISO 8601 字符串或 { path } 绑定',
    );
    expect(error(message({ ...valid, enableDate: false, enableTime: false }))).to.equal(
      'DateTimeInput.enableDate/enableTime 至少一个为 true',
    );
    expect(error(message({ ...valid, enableDate: 1 }))).to.equal(
      'DateTimeInput.enableDate 必须是布尔值',
    );
    expect(error(message({ ...valid, min: 'next-day' }))).to.equal(
      'DateTimeInput.min 必须是 ISO 8601 date/time/date-time 字符串',
    );
    expect(error(message({ ...valid, action: { event: { name: 'submit' } } }))).to.equal(
      'DateTimeInput 不支持挂载 action',
    );
    expect(error(message({ ...valid, checks: [] }))).to.equal(
      '当前 Agent 线不支持 DateTimeInput.checks',
    );
  });

  it('校验 Video 与 AudioPlayer 官方字段结构', () => {
    const message = (component: unknown) => ({
      version: 'v0.9',
      updateComponents: { surfaceId: 'd', components: [component] },
    });
    const video = { id: 'trailer', component: 'Video', url: { path: '/trailerUrl' } };
    const audio = {
      id: 'episode',
      component: 'AudioPlayer',
      url: 'https://example.com/episode.mp3',
      description: { path: '/episodeTitle' },
    };

    expect(validateA2UIMessage(message(video)).ok).to.equal(true);
    expect(validateA2UIMessage(message(audio)).ok).to.equal(true);
    expect(error(message({ ...video, src: 'https://example.com/a.mp4' }))).to.equal(
      'Video 只支持 id/component/url',
    );
    expect(error(message({ ...video, url: 1 }))).to.equal('Video.url 必须是字符串或 { path } 绑定');
    expect(error(message({ ...audio, controls: true }))).to.equal(
      'AudioPlayer 只支持 id/component/url/description',
    );
    expect(error(message({ ...audio, description: 1 }))).to.equal(
      'AudioPlayer.description 必须是字符串或 { path } 绑定',
    );
  });

  it('校验 Slider 官方字段结构', () => {
    const message = (component: unknown) => ({
      version: 'v0.9',
      updateComponents: { surfaceId: 'd', components: [component] },
    });
    const valid = {
      id: 'threshold',
      component: 'Slider',
      label: '阈值',
      min: 0,
      max: 1,
      value: { path: '/threshold' },
    };

    expect(validateA2UIMessage(message(valid)).ok).to.equal(true);
    expect(validateA2UIMessage(message({ ...valid, min: undefined })).ok).to.equal(true);
    expect(validateA2UIMessage(message({ ...valid, value: 0.5 })).ok).to.equal(true);
    expect(error(message({ ...valid, max: undefined }))).to.equal('Slider.max 必须是有限数字');
    expect(error(message({ ...valid, min: '0' }))).to.equal('Slider.min 必须是有限数字');
    expect(error(message({ ...valid, value: '0.5' }))).to.equal(
      'Slider.value 必须是有限数字或 { path } 绑定',
    );
    expect(error(message({ ...valid, min: 1, max: 1 }))).to.equal('Slider.min 必须小于 max');
    expect(error(message({ ...valid, value: 1.2 }))).to.equal('Slider.value 不能大于 max');
    expect(error(message({ ...valid, action: { event: { name: 'submit' } } }))).to.equal(
      'Slider 不支持挂载 action',
    );
    expect(
      validateA2UIMessage(
        message({
          ...valid,
          checks: [
            {
              condition: {
                call: 'numeric',
                args: { value: { path: '/threshold' }, min: 0 },
                returnType: 'boolean',
              },
              message: '阈值不能小于 0',
            },
          ],
        }),
      ).ok,
    ).to.equal(true);
  });

  it('校验官方 CheckRule 与最小函数子集', () => {
    const message = (component: unknown) => ({
      version: 'v0.9',
      updateComponents: { surfaceId: 'd', components: [component] },
    });
    const valid = {
      id: 'email',
      component: 'TextField',
      label: '邮箱',
      value: { path: '/email' },
      checks: [
        {
          condition: {
            call: 'email',
            args: { value: { path: '/email' } },
            returnType: 'boolean',
          },
          message: '请输入合法邮箱',
        },
      ],
    };

    expect(validateA2UIMessage(message(valid)).ok).to.equal(true);
    expect(
      validateA2UIMessage(
        message({
          id: 'submit',
          component: 'Button',
          checks: [
            {
              condition: {
                call: 'required',
                args: { value: { path: '/email' } },
                returnType: 'boolean',
              },
              message: '邮箱必填',
            },
          ],
        }),
      ).ok,
    ).to.equal(true);
    expect(
      error(
        message({
          ...valid,
          checks: [
            {
              call: 'required',
              args: { value: { path: '/email' } },
              message: '邮箱必填',
            },
          ],
        }),
      ),
    ).to.equal('checks[] 必须是只包含 condition 和 message 的对象');
    expect(
      error(
        message({
          ...valid,
          checks: [
            {
              condition: {
                call: 'and',
                args: { values: [] },
                returnType: 'boolean',
              },
              message: '组合条件',
            },
          ],
        }),
      ),
    ).to.equal('checks.condition.call 只支持 required/regex/length/numeric/email');
    expect(
      error(
        message({
          ...valid,
          checks: [
            {
              condition: {
                call: 'regex',
                args: { value: { path: '/email' }, pattern: '[' },
                returnType: 'boolean',
              },
              message: '邮箱格式错误',
            },
          ],
        }),
      ),
    ).to.equal('checks.condition.args.pattern 必须是合法正则表达式');
    expect(
      error(
        message({
          ...valid,
          checks: [
            {
              condition: {
                call: 'length',
                args: { value: { path: '/email' }, min: -1 },
                returnType: 'boolean',
              },
              message: '长度错误',
            },
          ],
        }),
      ),
    ).to.equal('checks.condition.args.min 必须是非负整数');
    expect(
      error(
        message({
          ...valid,
          checks: [
            {
              condition: {
                call: 'numeric',
                args: { value: { path: '/email' }, max: Number.POSITIVE_INFINITY },
                returnType: 'boolean',
              },
              message: '数值错误',
            },
          ],
        }),
      ),
    ).to.equal('checks.condition.args.max 必须是有限数字');
    expect(
      error(
        message({
          id: 'subscribed',
          component: 'CheckBox',
          label: '订阅',
          value: { path: '/subscribed' },
          checks: [],
        }),
      ),
    ).to.equal('当前 Agent 线不支持 CheckBox.checks');
  });
});
