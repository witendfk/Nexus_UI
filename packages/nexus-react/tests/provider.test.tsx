import { afterEach, describe, expect, it } from 'vitest';
import { createElement, useEffect } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CatalogRegistry } from '@nexus-ui/core';
import { A2UIProvider, useA2UI } from '../src';
import type { A2UIError, ActionEvent } from '@nexus-ui/core';
import type { RenderMap } from '../src';

// vitest globals:false → testing-library 自动 cleanup 不触发，手动清，避免 DOM 跨用例累积。
afterEach(cleanup);

/** 测试替身：挂载后把给定 JSONL 行喂进 runtime。 */
function Harness({ lines }: { lines: string[] }) {
  const runtime = useA2UI();
  useEffect(() => {
    for (const line of lines) runtime.push(line + '\n');
    runtime.end();
  }, [runtime, lines]);
  return null;
}

const FIXTURE = [
  '{"version":"v0.9","createSurface":{"surfaceId":"d","catalogId":"basic"}}',
  '{"version":"v0.9","updateComponents":{"surfaceId":"d","components":[{"id":"root","component":"Column","children":["title","btn"]},{"id":"title","component":"Text","text":"你好","variant":"h1"},{"id":"btn","component":"Button","child":"lbl","action":{"event":{"name":"ping","context":{"who":{"path":"/who"}}}}},{"id":"lbl","component":"Text","text":"点我"}]}}',
  '{"version":"v0.9","updateDataModel":{"surfaceId":"d","path":"/who","value":"Nexus"}}',
];

const SEARCH_FORM = [
  '{"version":"v0.9","createSurface":{"surfaceId":"search","catalogId":"basic"}}',
  '{"version":"v0.9","updateComponents":{"surfaceId":"search","components":[{"id":"root","component":"Column","children":["keyword","searchButton"]},{"id":"keyword","component":"TextField","label":"关键词","value":{"path":"/keyword"},"variant":"shortText"},{"id":"searchButton","component":"Button","child":"searchLabel","action":{"event":{"name":"search","context":{"keyword":{"path":"/keyword"}}}}},{"id":"searchLabel","component":"Text","text":"搜索"}]}}',
];

const SUBMIT_FORM = [
  '{"version":"v0.9","createSurface":{"surfaceId":"subscribe","catalogId":"basic"}}',
  '{"version":"v0.9","updateComponents":{"surfaceId":"subscribe","components":[{"id":"root","component":"Column","children":["name","subscribed","submitButton","submitResult"]},{"id":"name","component":"TextField","label":"姓名","value":{"path":"/name"},"variant":"shortText"},{"id":"subscribed","component":"CheckBox","label":"接收通知","value":{"path":"/subscribed"}},{"id":"submitButton","component":"Button","child":"submitLabel","action":{"event":{"name":"submit","context":{"name":{"path":"/name"},"subscribed":{"path":"/subscribed"}}}}},{"id":"submitLabel","component":"Text","text":"提交"},{"id":"submitResult","component":"Text","text":"等待提交"}]}}',
  '{"version":"v0.9","updateDataModel":{"surfaceId":"subscribe","value":{"name":"","subscribed":false}}}',
];

const CHOICE_FORM = [
  '{"version":"v0.9","createSurface":{"surfaceId":"choice","catalogId":"basic"}}',
  '{"version":"v0.9","updateComponents":{"surfaceId":"choice","components":[{"id":"root","component":"Column","children":["priority","submitButton"]},{"id":"priority","component":"ChoicePicker","label":"优先级","variant":"mutuallyExclusive","options":[{"label":"高","value":"high"},{"label":"普通","value":"normal"},{"label":"低","value":"low"}],"value":{"path":"/priority"},"displayStyle":"chips"},{"id":"submitButton","component":"Button","child":"submitLabel","action":{"event":{"name":"submit","context":{"priority":{"path":"/priority"}}}}},{"id":"submitLabel","component":"Text","text":"提交"}]}}',
  '{"version":"v0.9","updateDataModel":{"surfaceId":"choice","value":{"priority":["normal"]}}}',
];

const DATE_TIME_FORM = [
  '{"version":"v0.9","createSurface":{"surfaceId":"date-time","catalogId":"basic"}}',
  '{"version":"v0.9","updateComponents":{"surfaceId":"date-time","components":[{"id":"root","component":"Column","children":["reminderAt","submitButton"]},{"id":"reminderAt","component":"DateTimeInput","label":"提醒时间","value":{"path":"/reminderAt"},"enableDate":true,"enableTime":true,"min":"2026-01-01T00:00:00"},{"id":"submitButton","component":"Button","child":"submitLabel","action":{"event":{"name":"submit","context":{"reminderAt":{"path":"/reminderAt"}}}}},{"id":"submitLabel","component":"Text","text":"提交"}]}}',
  '{"version":"v0.9","updateDataModel":{"surfaceId":"date-time","value":{"reminderAt":"2026-09-20T10:00:00"}}}',
];

const SLIDER_FORM = [
  '{"version":"v0.9","createSurface":{"surfaceId":"slider","catalogId":"basic"}}',
  '{"version":"v0.9","updateComponents":{"surfaceId":"slider","components":[{"id":"root","component":"Column","children":["threshold","submitButton"]},{"id":"threshold","component":"Slider","label":"阈值","min":0,"max":1,"value":{"path":"/threshold"}},{"id":"submitButton","component":"Button","child":"submitLabel","action":{"event":{"name":"submit","context":{"threshold":{"path":"/threshold"}}}}},{"id":"submitLabel","component":"Text","text":"提交"}]}}',
  '{"version":"v0.9","updateDataModel":{"surfaceId":"slider","value":{"threshold":0.25}}}',
];

const CHECK_FORM = [
  '{"version":"v0.9","createSurface":{"surfaceId":"checks","catalogId":"basic"}}',
  JSON.stringify({
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'checks',
      components: [
        { id: 'root', component: 'Column', children: ['email', 'submitButton'] },
        {
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
        },
        {
          id: 'submitButton',
          component: 'Button',
          child: 'submitLabel',
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
          action: {
            event: { name: 'submit', context: { email: { path: '/email' } } },
          },
        },
        { id: 'submitLabel', component: 'Text', text: '提交' },
      ],
    },
  }),
  '{"version":"v0.9","updateDataModel":{"surfaceId":"checks","value":{"email":"invalid"}}}',
];

function textFieldForm(surfaceId: string, props: Record<string, unknown>): string[] {
  return [
    `{"version":"v0.9","createSurface":{"surfaceId":"${surfaceId}","catalogId":"basic"}}`,
    JSON.stringify({
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Column', children: ['field'] },
          {
            id: 'field',
            component: 'TextField',
            label: '字段',
            value: { path: '/field' },
            ...props,
          },
        ],
      },
    }),
  ];
}

const BAIDU_AVATAR_URL =
  'https://bkimg.cdn.bcebos.com/smart/b3fb43166d224f4a20a4341ea7bf87529822720e7b2f-bkimg-process,v_1,rw_189,rh_283,maxl_567?x-bce-process=image/format,f_auto';

const CARD = [
  '{"version":"v0.9","createSurface":{"surfaceId":"c","catalogId":"basic"}}',
  '{"version":"v0.9","updateComponents":{"surfaceId":"c","components":[{"id":"root","component":"Card","child":"col"},{"id":"col","component":"Column","children":["avatar","title","divider"],"align":"center"},{"id":"avatar","component":"Image","url":{"path":"/img"},"description":{"path":"/alt"},"variant":"avatar","fit":"cover"},{"id":"title","component":"Text","text":{"path":"/t"},"variant":"h2"},{"id":"divider","component":"Divider"}]}}',
  `{"version":"v0.9","updateDataModel":{"surfaceId":"c","value":{"img":"${BAIDU_AVATAR_URL}","alt":"联系人头像","t":"Hi"}}}`,
];

const LIST = [
  '{"version":"v0.9","createSurface":{"surfaceId":"list","catalogId":"basic"}}',
  '{"version":"v0.9","updateComponents":{"surfaceId":"list","components":[{"id":"root","component":"List","children":["first","second"],"direction":"vertical"},{"id":"first","component":"Text","text":{"path":"/items/0"}},{"id":"second","component":"Text","text":{"path":"/items/1"}}]}}',
  '{"version":"v0.9","updateDataModel":{"surfaceId":"list","value":{"items":["协议校验","渐进渲染"]}}}',
];

const TABS = [
  '{"version":"v0.9","createSurface":{"surfaceId":"tabs","catalogId":"basic"}}',
  '{"version":"v0.9","updateComponents":{"surfaceId":"tabs","components":[{"id":"root","component":"Tabs","tabs":[{"title":{"path":"/tabs/0"},"child":"overview"},{"title":{"path":"/tabs/1"},"child":"settings"}]},{"id":"overview","component":"Text","text":"概览内容"},{"id":"settings","component":"Text","text":"设置内容"}]}}',
  '{"version":"v0.9","updateDataModel":{"surfaceId":"tabs","value":{"tabs":["概览","设置"]}}}',
];

const CUSTOM_CATALOG = [
  '{"version":"v0.9","createSurface":{"surfaceId":"task","catalogId":"task-catalog"}}',
  '{"version":"v0.9","updateComponents":{"surfaceId":"task","components":[{"id":"root","component":"TaskSummary","title":"自定义 Catalog 已接入","children":["button"]},{"id":"button","component":"TaskButton","label":"完成任务","action":{"event":{"name":"complete","context":{"taskId":{"path":"/taskId"}}}}}]}}',
  '{"version":"v0.9","updateDataModel":{"surfaceId":"task","value":{"taskId":"task-001"}}}',
];

describe('A2UIProvider', () => {
  it('流式渲染：组件出现在 DOM', () => {
    render(createElement(A2UIProvider, {}, createElement(Harness, { lines: FIXTURE })));
    expect(screen.getByText('你好')).to.exist;
    expect(screen.getByText('点我')).to.exist;
  });

  it('Text variant=h1 渲染为 <h1>', () => {
    render(createElement(A2UIProvider, {}, createElement(Harness, { lines: FIXTURE })));
    expect((screen.getByText('你好') as HTMLElement).tagName).to.equal('H1');
  });

  it('seam 冒烟：点 Button → onAction 收到 core 解析后的 ActionEvent', () => {
    const events: ActionEvent[] = [];
    render(
      createElement(
        A2UIProvider,
        { onAction: (e) => events.push(e) },
        createElement(Harness, { lines: FIXTURE }),
      ),
    );
    fireEvent.click(screen.getByRole('button'));
    expect(events).to.have.length(1);
    expect(events[0]).to.deep.equal({
      name: 'ping',
      surfaceId: 'd',
      sourceComponentId: 'btn',
      context: { who: 'Nexus' },
    });
  });

  it('TextField 输入写回 dataModel，Button action 携带最新输入值', () => {
    const events: ActionEvent[] = [];
    render(
      createElement(
        A2UIProvider,
        { onAction: (event) => events.push(event) },
        createElement(Harness, { lines: SEARCH_FORM }),
      ),
    );

    const input = screen.getByLabelText('关键词') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'A2UI Runtime' } });
    expect((screen.getByLabelText('关键词') as HTMLInputElement).value).to.equal('A2UI Runtime');

    fireEvent.click(screen.getByRole('button'));
    expect(events).to.have.length(1);
    expect(events[0]).to.deep.equal({
      name: 'search',
      surfaceId: 'search',
      sourceComponentId: 'searchButton',
      context: { keyword: 'A2UI Runtime' },
    });
  });

  it('CheckBox 写回布尔 dataModel，submit action 同时携带文本与布尔最新值', () => {
    const events: ActionEvent[] = [];
    render(
      createElement(
        A2UIProvider,
        { onAction: (event) => events.push(event) },
        createElement(Harness, { lines: SUBMIT_FORM }),
      ),
    );

    const input = screen.getByLabelText('姓名') as HTMLInputElement;
    const checkBox = screen.getByLabelText('接收通知') as HTMLInputElement;
    expect(checkBox.checked).to.equal(false);

    fireEvent.change(input, { target: { value: 'A2UI Runtime' } });
    fireEvent.click(checkBox);
    expect(checkBox.checked).to.equal(true);

    fireEvent.click(screen.getByRole('button'));
    expect(events).to.have.length(1);
    expect(events[0]).to.deep.equal({
      name: 'submit',
      surfaceId: 'subscribe',
      sourceComponentId: 'submitButton',
      context: { name: 'A2UI Runtime', subscribed: true },
    });
  });

  it('ChoicePicker 写回字符串数组 dataModel，submit action 携带最新选择', () => {
    const events: ActionEvent[] = [];
    render(
      createElement(
        A2UIProvider,
        { onAction: (event) => events.push(event) },
        createElement(Harness, { lines: CHOICE_FORM }),
      ),
    );

    const normal = screen.getByRole('button', { name: '普通' });
    const high = screen.getByRole('button', { name: '高' });
    expect(normal.getAttribute('aria-pressed')).to.equal('true');
    expect(high.getAttribute('aria-pressed')).to.equal('false');

    fireEvent.click(high);
    expect(normal.getAttribute('aria-pressed')).to.equal('false');
    expect(high.getAttribute('aria-pressed')).to.equal('true');

    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    expect(events).to.have.length(1);
    expect(events[0]).to.deep.equal({
      name: 'submit',
      surfaceId: 'choice',
      sourceComponentId: 'submitButton',
      context: { priority: ['high'] },
    });
  });

  it('DateTimeInput 写回 ISO 字符串 dataModel，submit action 携带最新时间', () => {
    const events: ActionEvent[] = [];
    render(
      createElement(
        A2UIProvider,
        { onAction: (event) => events.push(event) },
        createElement(Harness, { lines: DATE_TIME_FORM }),
      ),
    );

    const input = screen.getByLabelText('提醒时间') as HTMLInputElement;
    expect(input.type).to.equal('datetime-local');
    expect(input.value).to.equal('2026-09-20T10:00');
    expect(input.getAttribute('min')).to.equal('2026-01-01T00:00');

    fireEvent.change(input, { target: { value: '2026-09-21T11:00' } });
    expect(input.value).to.equal('2026-09-21T11:00');

    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    expect(events).to.have.length(1);
    expect(events[0]).to.deep.equal({
      name: 'submit',
      surfaceId: 'date-time',
      sourceComponentId: 'submitButton',
      context: { reminderAt: '2026-09-21T11:00:00' },
    });
  });

  it('Slider 写回数字 dataModel，submit action 携带最新数值', () => {
    const events: ActionEvent[] = [];
    render(
      createElement(
        A2UIProvider,
        { onAction: (event) => events.push(event) },
        createElement(Harness, { lines: SLIDER_FORM }),
      ),
    );

    const input = screen.getByRole('slider', { name: '阈值' }) as HTMLInputElement;
    expect(input.type).to.equal('range');
    expect(input.min).to.equal('0');
    expect(input.max).to.equal('1');
    expect(input.value).to.equal('0.25');
    expect(input.step).to.equal('any');
    expect(screen.getByText('0.25')).to.exist;

    fireEvent.change(input, { target: { value: '0.75' } });
    expect(input.value).to.equal('0.75');
    expect(screen.getByText('0.75')).to.exist;

    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    expect(events).to.have.length(1);
    expect(events[0]).to.deep.equal({
      name: 'submit',
      surfaceId: 'slider',
      sourceComponentId: 'submitButton',
      context: { threshold: 0.75 },
    });
  });

  it('checks 展示协议错误文案并阻断 Button action，输入合法后恢复', () => {
    const events: ActionEvent[] = [];
    render(
      createElement(
        A2UIProvider,
        { onAction: (event) => events.push(event) },
        createElement(Harness, { lines: CHECK_FORM }),
      ),
    );

    const input = screen.getByLabelText('邮箱') as HTMLInputElement;
    const button = screen.getByRole('button', { name: '提交' }) as HTMLButtonElement;
    expect(screen.getByText('请输入合法邮箱')).to.exist;
    expect(input.getAttribute('aria-invalid')).to.equal('true');
    expect(input.getAttribute('aria-describedby')).to.equal('email-error');
    expect(button.disabled).to.equal(true);

    fireEvent.click(button);
    expect(events).to.have.length(0);

    fireEvent.change(input, { target: { value: 'nexus@example.com' } });
    expect(screen.queryByText('请输入合法邮箱')).to.equal(null);
    expect(input.getAttribute('aria-invalid')).to.equal('false');
    expect(input.getAttribute('aria-describedby')).to.equal(null);
    expect(button.disabled).to.equal(false);

    fireEvent.click(button);
    expect(events).to.deep.equal([
      {
        name: 'submit',
        surfaceId: 'checks',
        sourceComponentId: 'submitButton',
        context: { email: 'nexus@example.com' },
      },
    ]);
  });

  it('TextField 渲染官方 longText / number / obscured 变体', () => {
    const cases = [
      { props: { variant: 'longText' }, tag: 'TEXTAREA' },
      { props: { variant: 'number' }, tag: 'INPUT', type: 'number' },
      { props: { variant: 'obscured' }, tag: 'INPUT', type: 'password' },
    ];

    for (const [index, item] of cases.entries()) {
      cleanup();
      render(
        createElement(
          A2UIProvider,
          {},
          createElement(Harness, { lines: textFieldForm(`v${index}`, item.props) }),
        ),
      );
      const control = screen.getByLabelText('字段') as HTMLElement;
      expect(control.tagName).to.equal(item.tag);
      if ('type' in item) expect((control as HTMLInputElement).type).to.equal(item.type);
    }
  });

  it('TextField validationRegexp 在失焦后显示格式错误并在修正后清除', () => {
    render(
      createElement(
        A2UIProvider,
        {},
        createElement(Harness, {
          lines: textFieldForm('validation', { validationRegexp: '^[A-Z0-9]{6}$' }),
        }),
      ),
    );
    const input = screen.getByLabelText('字段') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);
    expect(screen.getByText('格式不符合要求')).to.exist;
    expect(input.getAttribute('aria-invalid')).to.equal('true');

    fireEvent.change(input, { target: { value: 'ABC123' } });
    expect(screen.queryByText('格式不符合要求')).to.equal(null);
    expect(input.getAttribute('aria-invalid')).to.equal('false');
  });

  it('Card/Image/Divider 组件渲染（含 {path} 绑定）', () => {
    const { container } = render(
      createElement(A2UIProvider, {}, createElement(Harness, { lines: CARD })),
    );
    expect(screen.getByText('Hi')).to.exist; // title 经 {path:/t} 解析
    expect(container.querySelector('img')).to.exist; // Image
    expect(container.querySelector('img')?.getAttribute('alt')).to.equal('联系人头像');
    expect(container.querySelector('img')?.getAttribute('referrerPolicy')).to.equal('no-referrer');
    expect(container.querySelector('img')?.getAttribute('src')).to.equal(BAIDU_AVATAR_URL);
    expect(container.querySelector('hr')).to.exist; // Divider
  });

  it('List 渲染静态 children 并支持 {path} 数据绑定', () => {
    const { container } = render(
      createElement(A2UIProvider, {}, createElement(Harness, { lines: LIST })),
    );

    expect(container.querySelector('ul')).to.exist;
    expect(container.querySelectorAll('ul > li')).to.have.length(2);
    expect(screen.getByText('协议校验')).to.exist;
    expect(screen.getByText('渐进渲染')).to.exist;
  });

  it('Tabs 渲染静态 tabs，并支持本地切换激活项', () => {
    render(createElement(A2UIProvider, {}, createElement(Harness, { lines: TABS })));

    const tabs = screen.getAllByRole('tab');
    expect(tabs).to.have.length(2);
    expect(tabs.map((tab) => tab.textContent)).to.deep.equal(['概览', '设置']);
    expect(screen.getByRole('tabpanel').textContent).to.equal('概览内容');

    fireEvent.click(tabs[1]);
    expect(screen.getByRole('tabpanel').textContent).to.equal('设置内容');
  });

  it('按 surface catalogId 选择自定义 renderMap 并回流 action', () => {
    const events: ActionEvent[] = [];
    const customRenderMap: RenderMap = {
      TaskSummary: (vnode, children) =>
        createElement(
          'section',
          { 'data-testid': 'task-catalog' },
          String(vnode.props.title),
          ...children,
        ),
      TaskButton: (vnode, _children, ctx) =>
        createElement(
          'button',
          { onClick: () => ctx.triggerAction(vnode.id, vnode.surfaceId) },
          String(vnode.props.label),
        ),
    };

    render(
      createElement(
        A2UIProvider,
        {
          catalogRenderMaps: { 'task-catalog': customRenderMap },
          onAction: (event) => events.push(event),
        },
        createElement(Harness, { lines: CUSTOM_CATALOG }),
      ),
    );

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('task-catalog').textContent).to.contain('自定义 Catalog 已接入');
    expect(screen.getByTestId('task-catalog').textContent).to.contain('完成任务');
    expect(events[0]).to.deep.equal({
      name: 'complete',
      surfaceId: 'task',
      sourceComponentId: 'button',
      context: { taskId: 'task-001' },
    });
  });

  it('catalogRegistry 会阻止不符合契约的自定义组件进入渲染树', () => {
    const errors: A2UIError[] = [];
    const registry = new CatalogRegistry([
      {
        catalogId: 'task-catalog',
        components: ['TaskSummary'],
        componentSchemas: {
          TaskSummary: {
            type: 'object',
            additionalProperties: false,
            required: ['title'],
            properties: { title: { type: 'string', dynamic: 'required' } },
          },
        },
      },
    ]);

    render(
      createElement(
        A2UIProvider,
        {
          catalogRegistry: registry,
          onError: (error) => errors.push(error),
          catalogRenderMaps: {
            'task-catalog': {
              TaskSummary: (vnode) =>
                createElement('section', { 'data-testid': 'invalid' }, String(vnode.props.title)),
            },
          },
        },
        createElement(Harness, {
          lines: [
            CUSTOM_CATALOG[0],
            '{"version":"v0.9","updateComponents":{"surfaceId":"task","components":[{"id":"root","component":"TaskSummary","title":"字面量","children":["button"]}]}}',
          ],
        }),
      ),
    );

    expect(screen.queryByTestId('invalid')).to.equal(null);
    expect(errors[0]?.diagnostics).to.deep.equal([
      {
        path: 'TaskSummary.title',
        message: 'TaskSummary.title 必须是 { path } 绑定',
      },
    ]);
  });
});
