import { expect } from 'chai';
import { CatalogRegistry } from '../src/catalog';
import { A2UIRuntime } from '../src/runtime';
import type { VNode } from '../src/protocol/types';

const last = <T>(arr: T[]): T | undefined => arr[arr.length - 1];

describe('A2UIRuntime', () => {
  it('push 流式：createSurface + updateComponents → onRender 出 VNode 树', () => {
    let rendered: VNode | null | undefined;
    const rt = new A2UIRuntime({ onRender: (root) => (rendered = root) });
    rt.push('{"version":"v0.9","createSurface":{"surfaceId":"demo","catalogId":"basic"}}\n');
    rt.push('{"version":"v0.9","updateComponents":{"surfaceId":"demo","components":[');
    rt.push(
      '{"id":"root","component":"Column","children":["t"]},{"id":"t","component":"Text","text":"hi"}]',
    );
    rt.push('}}\n');
    expect(rendered?.type).to.equal('Column');
    expect(rendered?.children?.[0]?.props.text).to.equal('hi');
  });

  it('子乱序到达：root 先到 → 占位；子到 → 填充', () => {
    const trees: (VNode | null)[] = [];
    const rt = new A2UIRuntime({ onRender: (root) => trees.push(root) });
    rt.push('{"version":"v0.9","createSurface":{"surfaceId":"d","catalogId":"basic"}}\n');
    rt.push(
      '{"version":"v0.9","updateComponents":{"surfaceId":"d","components":[{"id":"root","component":"Column","children":["t"]}]}}\n',
    );
    expect(last(trees)?.children?.[0]?.type).to.equal('__placeholder__');
    rt.push(
      '{"version":"v0.9","updateComponents":{"surfaceId":"d","components":[{"id":"t","component":"Text","text":"late"}]}}\n',
    );
    expect(last(trees)?.children?.[0]?.props.text).to.equal('late');
  });

  it('updateDataModel → 绑定 {path} 的组件刷新', () => {
    const trees: (VNode | null)[] = [];
    const rt = new A2UIRuntime({ onRender: (root) => trees.push(root) });
    rt.push('{"version":"v0.9","createSurface":{"surfaceId":"d","catalogId":"basic"}}\n');
    rt.push(
      '{"version":"v0.9","updateComponents":{"surfaceId":"d","components":[{"id":"root","component":"Column","children":["t"]},{"id":"t","component":"Text","text":{"path":"/who"}}]}}\n',
    );
    expect(last(trees)?.children?.[0]?.props.text).to.equal(undefined); // 数据未到
    rt.push(
      '{"version":"v0.9","updateDataModel":{"surfaceId":"d","path":"/who","value":"Nexus"}}\n',
    );
    expect(last(trees)?.children?.[0]?.props.text).to.equal('Nexus');
  });

  it('triggerAction → onAction（context 经 core 解析）', () => {
    const events: unknown[] = [];
    const rt = new A2UIRuntime({ onAction: (e) => events.push(e) });
    rt.push('{"version":"v0.9","createSurface":{"surfaceId":"d","catalogId":"basic"}}\n');
    rt.push(
      '{"version":"v0.9","updateComponents":{"surfaceId":"d","components":[{"id":"root","component":"Column","children":["btn"]},{"id":"btn","component":"Button","child":"lbl","action":{"event":{"name":"ping","context":{"who":{"path":"/who"}}}}},{"id":"lbl","component":"Text","text":"go"}]}}\n',
    );
    rt.push(
      '{"version":"v0.9","updateDataModel":{"surfaceId":"d","path":"/who","value":"Nexus"}}\n',
    );
    rt.triggerAction('btn', 'd');
    expect(events).to.have.length(1);
    expect(events[0]).to.deep.equal({
      name: 'ping',
      surfaceId: 'd',
      sourceComponentId: 'btn',
      context: { who: 'Nexus' },
    });
  });

  it('catalogRegistry 校验显式声明的 action 边界', () => {
    const registry = new CatalogRegistry([
      { catalogId: 'approval', components: ['Button', 'Text'], actions: ['approve'] },
      { catalogId: 'display-only', components: ['Button', 'Text'], actions: [] },
      { catalogId: 'legacy', components: ['Button', 'Text'] },
    ]);
    const errors: string[] = [];
    const runtime = new A2UIRuntime({
      catalogRegistry: registry,
      onError: (error) => errors.push(error.message),
    });

    runtime.dispatch({
      version: 'v0.9',
      createSurface: { surfaceId: 'approval', catalogId: 'approval' },
    });
    runtime.dispatch({
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'approval',
        components: [
          {
            component: 'Button',
            id: 'submit',
            child: 'label',
            action: { event: { name: 'reject' } },
          },
          { component: 'Text', id: 'label', text: 'Reject' },
        ],
      },
    });
    runtime.dispatch({
      version: 'v0.9',
      createSurface: { surfaceId: 'display', catalogId: 'display-only' },
    });
    runtime.dispatch({
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'display',
        components: [
          {
            component: 'Button',
            id: 'confirm',
            child: 'label',
            action: { event: { name: 'approve' } },
          },
          { component: 'Text', id: 'label', text: 'Confirm' },
        ],
      },
    });
    runtime.dispatch({
      version: 'v0.9',
      createSurface: { surfaceId: 'legacy', catalogId: 'legacy' },
    });
    runtime.dispatch({
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'legacy',
        components: [
          {
            component: 'Button',
            id: 'confirm',
            child: 'label',
            action: { event: { name: 'legacy-call' } },
          },
          { component: 'Text', id: 'label', text: 'Confirm' },
        ],
      },
    });

    expect(errors).to.have.length(2);
    expect(errors[0]).to.equal('Catalog approval 不支持 action: reject');
    expect(errors[1]).to.equal('Catalog display-only 不支持 action: approve');
    expect(runtime.store.getState().errors[0]?.diagnostics).to.deep.equal([
      {
        path: 'components.submit.action.event.name',
        message: 'Catalog approval 不支持 action: reject',
      },
    ]);
    expect(runtime.store.getState().componentsBySurface.approval?.submit).to.equal(undefined);
    expect(runtime.store.getState().componentsBySurface.display?.confirm).to.equal(undefined);
    expect(runtime.store.getState().componentsBySurface.legacy?.confirm).to.exist;
  });

  it('setInputValue → 写回 TextField.value 绑定并触发 Button action 取最新值', () => {
    const events: unknown[] = [];
    const rt = new A2UIRuntime({ onAction: (e) => events.push(e) });
    rt.push('{"version":"v0.9","createSurface":{"surfaceId":"d","catalogId":"basic"}}\n');
    rt.push(
      '{"version":"v0.9","updateComponents":{"surfaceId":"d","components":[{"id":"root","component":"Column","children":["input","btn"]},{"id":"input","component":"TextField","label":"关键词","value":{"path":"/keyword"},"variant":"shortText"},{"id":"btn","component":"Button","child":"lbl","action":{"event":{"name":"search","context":{"keyword":{"path":"/keyword"}}}}},{"id":"lbl","component":"Text","text":"搜索"}]}}\n',
    );

    expect(rt.setInputValue('input', 'd', 'A2UI Runtime')).to.equal(true);
    expect(rt.store.getState().dataModelBySurface['d']).to.deep.equal({
      keyword: 'A2UI Runtime',
    });

    rt.triggerAction('btn', 'd');
    expect(events).to.have.length(1);
    expect(events[0]).to.deep.equal({
      name: 'search',
      surfaceId: 'd',
      sourceComponentId: 'btn',
      context: { keyword: 'A2UI Runtime' },
    });
  });

  it('setInputValue → 写回 CheckBox.value 布尔绑定并触发 submit 取最新值', () => {
    const events: unknown[] = [];
    const rt = new A2UIRuntime({ onAction: (e) => events.push(e) });
    rt.push('{"version":"v0.9","createSurface":{"surfaceId":"d","catalogId":"basic"}}\n');
    rt.push(
      '{"version":"v0.9","updateComponents":{"surfaceId":"d","components":[{"id":"root","component":"Column","children":["name","subscribed","submit"]},{"id":"name","component":"TextField","label":"姓名","value":{"path":"/name"}},{"id":"subscribed","component":"CheckBox","label":"接收通知","value":{"path":"/subscribed"}},{"id":"submit","component":"Button","child":"label","action":{"event":{"name":"submit","context":{"name":{"path":"/name"},"subscribed":{"path":"/subscribed"}}}}},{"id":"label","component":"Text","text":"提交"}]}}\n',
    );
    rt.push(
      '{"version":"v0.9","updateDataModel":{"surfaceId":"d","value":{"name":"","subscribed":false}}}\n',
    );

    expect(rt.setInputValue('name', 'd', 'A2UI Runtime')).to.equal(true);
    expect(rt.setInputValue('subscribed', 'd', true)).to.equal(true);
    expect(rt.setInputValue('subscribed', 'd', 'true')).to.equal(false);
    expect(rt.store.getState().dataModelBySurface['d']).to.deep.equal({
      name: 'A2UI Runtime',
      subscribed: true,
    });

    rt.triggerAction('submit', 'd');
    expect(events).to.have.length(1);
    expect(events[0]).to.deep.equal({
      name: 'submit',
      surfaceId: 'd',
      sourceComponentId: 'submit',
      context: { name: 'A2UI Runtime', subscribed: true },
    });
  });

  it('setInputValue → 写回 ChoicePicker.value 字符串数组绑定并触发 submit 取最新值', () => {
    const events: unknown[] = [];
    const rt = new A2UIRuntime({ onAction: (event) => events.push(event) });
    rt.push('{"version":"v0.9","createSurface":{"surfaceId":"d","catalogId":"basic"}}\n');
    rt.push(
      '{"version":"v0.9","updateComponents":{"surfaceId":"d","components":[{"id":"root","component":"Column","children":["priority","submit"]},{"id":"priority","component":"ChoicePicker","label":"优先级","variant":"mutuallyExclusive","options":[{"label":"高","value":"high"},{"label":"普通","value":"normal"}],"value":{"path":"/priority"},"displayStyle":"chips"},{"id":"submit","component":"Button","child":"label","action":{"event":{"name":"submit","context":{"priority":{"path":"/priority"}}}}},{"id":"label","component":"Text","text":"提交"}]}}\n',
    );
    rt.push(
      '{"version":"v0.9","updateDataModel":{"surfaceId":"d","value":{"priority":["normal"]}}}\n',
    );

    expect(rt.setInputValue('priority', 'd', ['high'])).to.equal(true);
    expect(rt.setInputValue('priority', 'd', 'high')).to.equal(false);
    expect(rt.store.getState().dataModelBySurface['d']).to.deep.equal({ priority: ['high'] });

    rt.triggerAction('submit', 'd');
    expect(events).to.have.length(1);
    expect(events[0]).to.deep.equal({
      name: 'submit',
      surfaceId: 'd',
      sourceComponentId: 'submit',
      context: { priority: ['high'] },
    });
  });

  it('setInputValue → 写回 DateTimeInput.value 字符串绑定并触发 submit 取最新值', () => {
    const events: unknown[] = [];
    const rt = new A2UIRuntime({ onAction: (event) => events.push(event) });
    rt.push('{"version":"v0.9","createSurface":{"surfaceId":"d","catalogId":"basic"}}\n');
    rt.push(
      '{"version":"v0.9","updateComponents":{"surfaceId":"d","components":[{"id":"root","component":"Column","children":["reminderAt","submit"]},{"id":"reminderAt","component":"DateTimeInput","label":"提醒时间","value":{"path":"/reminderAt"},"enableDate":true,"enableTime":true},{"id":"submit","component":"Button","child":"label","action":{"event":{"name":"submit","context":{"reminderAt":{"path":"/reminderAt"}}}}},{"id":"label","component":"Text","text":"提交"}]}}\n',
    );
    rt.push('{"version":"v0.9","updateDataModel":{"surfaceId":"d","value":{"reminderAt":""}}}\n');

    expect(rt.setInputValue('reminderAt', 'd', '2026-09-20T10:00:00')).to.equal(true);
    expect(rt.setInputValue('reminderAt', 'd', 10 as unknown as string)).to.equal(false);
    expect(rt.store.getState().dataModelBySurface['d']).to.deep.equal({
      reminderAt: '2026-09-20T10:00:00',
    });

    rt.triggerAction('submit', 'd');
    expect(events).to.have.length(1);
    expect(events[0]).to.deep.equal({
      name: 'submit',
      surfaceId: 'd',
      sourceComponentId: 'submit',
      context: { reminderAt: '2026-09-20T10:00:00' },
    });
  });

  it('setInputValue → 写回 Slider.value 数字绑定并触发 submit 取最新值', () => {
    const events: unknown[] = [];
    const rt = new A2UIRuntime({ onAction: (event) => events.push(event) });
    rt.push('{"version":"v0.9","createSurface":{"surfaceId":"slider","catalogId":"basic"}}\n');
    rt.push(
      '{"version":"v0.9","updateComponents":{"surfaceId":"slider","components":[{"id":"root","component":"Column","children":["threshold","submit"]},{"id":"threshold","component":"Slider","label":"阈值","min":0,"max":1,"value":{"path":"/threshold"}},{"id":"submit","component":"Button","child":"label","action":{"event":{"name":"submit","context":{"threshold":{"path":"/threshold"}}}}},{"id":"label","component":"Text","text":"提交"}]}}\n',
    );
    rt.push(
      '{"version":"v0.9","updateDataModel":{"surfaceId":"slider","value":{"threshold":0.2}}}\n',
    );

    expect(rt.setInputValue('threshold', 'slider', 0.7)).to.equal(true);
    expect(rt.setInputValue('threshold', 'slider', '0.7')).to.equal(false);
    expect(rt.store.getState().dataModelBySurface.slider).to.deep.equal({ threshold: 0.7 });

    rt.triggerAction('submit', 'slider');
    expect(events).to.have.length(1);
    expect(events[0]).to.deep.equal({
      name: 'submit',
      surfaceId: 'slider',
      sourceComponentId: 'submit',
      context: { threshold: 0.7 },
    });
  });

  it('畸形 JSON → onError，不中断后续合法消息', () => {
    const errors: string[] = [];
    const rt = new A2UIRuntime({ onError: (e) => errors.push(e.message) });
    rt.push('not json\n');
    rt.push('{"version":"v0.9","createSurface":{"surfaceId":"d","catalogId":"basic"}}\n');
    rt.push(
      '{"version":"v0.9","updateComponents":{"surfaceId":"d","components":[{"id":"root","component":"Column"}]}}\n',
    );
    expect(errors).to.deep.equal(['JSON 解析失败']);
    expect(rt.store.getState().componentsBySurface['d']?.['root']).to.exist;
  });

  it('非法消息结构（缺 version）→ onError', () => {
    let errored = false;
    const rt = new A2UIRuntime({ onError: () => (errored = true) });
    rt.push('{"updateComponents":{"surfaceId":"d","components":[]}}\n');
    expect(errored).to.equal(true);
  });

  it('update before create → 记录错误且不写入组件', () => {
    const errors: string[] = [];
    const rt = new A2UIRuntime({ onError: (e) => errors.push(e.message) });
    rt.push(
      '{"version":"v0.9","updateComponents":{"surfaceId":"d","components":[{"id":"root","component":"Column"}]}}\n',
    );
    expect(errors).to.deep.equal(['Surface 尚未创建: d']);
    expect(rt.store.getState().componentsBySurface['d']).to.equal(undefined);
  });

  it('重复 createSurface → 拒绝且不清空已有状态', () => {
    const rt = new A2UIRuntime();
    rt.push('{"version":"v0.9","createSurface":{"surfaceId":"d","catalogId":"basic-1"}}\n');
    rt.push(
      '{"version":"v0.9","updateComponents":{"surfaceId":"d","components":[{"id":"root","component":"Column"}]}}\n',
    );
    rt.push('{"version":"v0.9","createSurface":{"surfaceId":"d","catalogId":"basic-2"}}\n');
    expect(rt.store.getState().surfaces['d']?.catalogId).to.equal('basic-1');
    expect(rt.store.getState().componentsBySurface['d']?.['root']).to.exist;
    expect(rt.store.getState().errors.map((e) => e.message)).to.deep.equal(['Surface 已存在: d']);
  });

  it('dispatch 与 push 使用相同结构校验', () => {
    const errors: string[] = [];
    const rt = new A2UIRuntime({ onError: (e) => errors.push(e.message) });
    rt.dispatch({
      version: 'v0.9',
      createSurface: { surfaceId: 'd', catalogId: 'basic' },
      updateComponents: { surfaceId: 'd', components: [] },
    } as unknown as Parameters<A2UIRuntime['dispatch']>[0]);
    expect(errors).to.deep.equal(['消息必须且只能包含一个 A2UI payload']);
    expect(rt.store.getState().surfaces['d']).to.equal(undefined);
  });

  it('catalogRegistry 校验 catalog、组件边界与 props schema', () => {
    const registry = new CatalogRegistry([
      {
        catalogId: 'task',
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
    const errors: string[] = [];
    let rendered: VNode | undefined;
    const runtime = new A2UIRuntime({
      catalogRegistry: registry,
      onRender: (root) => (rendered = root ?? undefined),
      onError: (error) => errors.push(error.message),
    });

    runtime.push(
      '{"version":"v0.9","createSurface":{"surfaceId":"task-1","catalogId":"unknown"}}\n',
    );
    runtime.push('{"version":"v0.9","createSurface":{"surfaceId":"task-1","catalogId":"task"}}\n');
    runtime.push(
      '{"version":"v0.9","updateComponents":{"surfaceId":"task-1","components":[{"id":"root","component":"Text","text":"泄漏"}]}}\n',
    );
    runtime.push(
      '{"version":"v0.9","updateComponents":{"surfaceId":"task-1","components":[{"id":"root","component":"TaskSummary","title":"字面量"}]}}\n',
    );
    runtime.push(
      '{"version":"v0.9","updateComponents":{"surfaceId":"task-1","components":[{"id":"root","component":"TaskSummary","title":{"path":"/title"},"extra":true}]}}\n',
    );
    runtime.push(
      '{"version":"v0.9","updateComponents":{"surfaceId":"task-1","components":[{"id":"root","component":"TaskSummary","title":{"path":"/title"}}]}}\n',
    );

    expect(errors).to.deep.equal([
      'Agent catalog 未注册: unknown',
      'Catalog task 不支持组件: Text',
      'TaskSummary.title 必须是 { path } 绑定',
      'TaskSummary.extra 不是允许的字段',
    ]);
    expect(rendered?.type).to.equal('TaskSummary');
    expect(runtime.store.getState().componentsBySurface['task-1']?.root?.component).to.equal(
      'TaskSummary',
    );
  });

  it('updateDataModel 会反查已存在动态绑定的 resolved value', () => {
    const registry = new CatalogRegistry([
      {
        catalogId: 'task',
        components: ['TaskSummary'],
        componentSchemas: {
          TaskSummary: {
            type: 'object',
            properties: { amount: { type: 'number', dynamic: 'allowed' } },
          },
        },
      },
    ]);
    const errors: string[] = [];
    const diagnosticErrors: unknown[] = [];
    let rendered: VNode | undefined;
    const runtime = new A2UIRuntime({
      catalogRegistry: registry,
      onRender: (root) => (rendered = root ?? undefined),
      onError: (error) => {
        errors.push(error.message);
        diagnosticErrors.push(error.diagnostics);
      },
    });

    runtime.push('{"version":"v0.9","createSurface":{"surfaceId":"task-1","catalogId":"task"}}\n');
    runtime.push(
      '{"version":"v0.9","updateComponents":{"surfaceId":"task-1","components":[{"id":"root","component":"TaskSummary","amount":{"path":"/amount"}}]}}\n',
    );
    runtime.push(
      '{"version":"v0.9","updateDataModel":{"surfaceId":"task-1","path":"/amount","value":"12"}}\n',
    );

    expect(errors).to.deep.equal(['TaskSummary.amount 必须是 number']);
    expect(diagnosticErrors).to.deep.equal([
      [
        {
          path: 'TaskSummary.amount',
          message: 'TaskSummary.amount 必须是 number',
          dataPath: '/amount',
        },
      ],
    ]);
    expect(runtime.store.getState().errors[0]?.diagnostics).to.deep.equal([
      {
        path: 'TaskSummary.amount',
        message: 'TaskSummary.amount 必须是 number',
        dataPath: '/amount',
      },
    ]);
    expect(runtime.store.getState().dataModelBySurface['task-1']).to.equal(undefined);

    runtime.push(
      '{"version":"v0.9","updateDataModel":{"surfaceId":"task-1","path":"/amount","value":12}}\n',
    );
    expect(errors).to.have.length(1);
    expect(rendered?.props.amount).to.equal(12);
    expect(runtime.store.getState().dataModelBySurface['task-1']).to.deep.equal({ amount: 12 });
  });

  it('updateComponents 会使用当前 dataModel 校验动态绑定', () => {
    const registry = new CatalogRegistry([
      {
        catalogId: 'task',
        components: ['TaskSummary'],
        componentSchemas: {
          TaskSummary: {
            type: 'object',
            properties: { amount: { type: 'number', dynamic: 'allowed' } },
          },
        },
      },
    ]);
    const errors: string[] = [];
    const runtime = new A2UIRuntime({
      catalogRegistry: registry,
      onError: (error) => errors.push(error.message),
    });

    runtime.push('{"version":"v0.9","createSurface":{"surfaceId":"task-1","catalogId":"task"}}\n');
    runtime.push(
      '{"version":"v0.9","updateDataModel":{"surfaceId":"task-1","path":"/amount","value":"12"}}\n',
    );
    runtime.push(
      '{"version":"v0.9","updateComponents":{"surfaceId":"task-1","components":[{"id":"root","component":"TaskSummary","amount":{"path":"/amount"}}]}}\n',
    );

    expect(errors).to.deep.equal(['TaskSummary.amount 必须是 number']);
    expect(runtime.store.getState().componentsBySurface['task-1']?.root).to.equal(undefined);
    expect(runtime.store.getState().dataModelBySurface['task-1']).to.deep.equal({ amount: '12' });
  });

  it('Button.checks 失败时阻断 action，校验通过后携带最新值放行', () => {
    const events: unknown[] = [];
    const rt = new A2UIRuntime({ onAction: (event) => events.push(event) });
    rt.push('{"version":"v0.9","createSurface":{"surfaceId":"checks","catalogId":"basic"}}\n');
    rt.push(
      '{"version":"v0.9","updateComponents":{"surfaceId":"checks","components":[{"id":"root","component":"Column","children":["email","submit"]},{"id":"email","component":"TextField","label":"邮箱","value":{"path":"/email"}},{"id":"submit","component":"Button","child":"label","checks":[{"condition":{"call":"email","args":{"value":{"path":"/email"}},"returnType":"boolean"},"message":"请输入合法邮箱"}],"action":{"event":{"name":"submit","context":{"email":{"path":"/email"}}}}},{"id":"label","component":"Text","text":"提交"}]}}\n',
    );
    rt.push(
      '{"version":"v0.9","updateDataModel":{"surfaceId":"checks","value":{"email":"invalid"}}}\n',
    );

    rt.triggerAction('submit', 'checks');
    expect(events).to.have.length(0);

    expect(rt.setInputValue('email', 'checks', 'nexus@example.com')).to.equal(true);
    rt.triggerAction('submit', 'checks');
    expect(events).to.deep.equal([
      {
        name: 'submit',
        surfaceId: 'checks',
        sourceComponentId: 'submit',
        context: { email: 'nexus@example.com' },
      },
    ]);
  });

  it('onRender 抛错时不中断后续数据更新', () => {
    const errors: string[] = [];
    const rt = new A2UIRuntime({
      onRender: () => {
        throw new Error('render failed');
      },
      onError: (e) => errors.push(e.message),
    });
    rt.push('{"version":"v0.9","createSurface":{"surfaceId":"d","catalogId":"basic"}}\n');
    rt.push(
      '{"version":"v0.9","updateComponents":{"surfaceId":"d","components":[{"id":"root","component":"Column","children":["t"]},{"id":"t","component":"Text","text":{"path":"/name"}}]}}\n',
    );
    rt.push(
      '{"version":"v0.9","updateDataModel":{"surfaceId":"d","path":"/name","value":"Alice"}}\n',
    );
    expect(errors).to.have.length(2);
    expect(rt.store.getState().dataModelBySurface['d']).to.deep.equal({ name: 'Alice' });
  });

  it('deleteSurface → onRender(null)', () => {
    const events: { root: VNode | null }[] = [];
    const rt = new A2UIRuntime({ onRender: (root) => events.push({ root }) });
    rt.push('{"version":"v0.9","createSurface":{"surfaceId":"d","catalogId":"basic"}}\n');
    rt.push(
      '{"version":"v0.9","updateComponents":{"surfaceId":"d","components":[{"id":"root","component":"Column"}]}}\n',
    );
    rt.push('{"version":"v0.9","deleteSurface":{"surfaceId":"d"}}\n');
    expect(last(events)?.root).to.equal(null);
  });
});
