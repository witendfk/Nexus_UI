import { expect } from 'chai';
import { buildTree } from '../src/render';
import type { Component } from '../src/protocol/types';

const map = (...cs: Component[]): Record<string, Component> =>
  Object.fromEntries(cs.map((c) => [c.id, c]));

describe('buildTree', () => {
  it('简单树：root + 子组件', () => {
    const components = map(
      { id: 'root', component: 'Column', children: ['t1', 't2'] },
      { id: 't1', component: 'Text', text: 'A' },
      { id: 't2', component: 'Text', text: 'B' },
    );
    expect(buildTree(components, 's', {})).to.deep.equal({
      id: 'root',
      type: 'Column',
      surfaceId: 's',
      props: {},
      children: [
        { id: 't1', type: 'Text', surfaceId: 's', props: { text: 'A' }, children: null },
        { id: 't2', type: 'Text', surfaceId: 's', props: { text: 'B' }, children: null },
      ],
    });
  });

  it('子未到达 → 占位', () => {
    const components = map({ id: 'root', component: 'Column', children: ['missing'] });
    expect(buildTree(components, 's', {})?.children).to.deep.equal([
      { id: 'missing', type: '__placeholder__', props: {}, children: null, surfaceId: 's' },
    ]);
  });

  it('{path} 绑定按模型解析', () => {
    const components = map(
      { id: 'root', component: 'Column', children: ['t'] },
      { id: 't', component: 'Text', text: { path: '/who' } },
    );
    expect(buildTree(components, 's', { who: 'Nexus' })?.children?.[0]?.props.text).to.equal(
      'Nexus',
    );
  });

  it('child 单子引用', () => {
    const components = map(
      { id: 'root', component: 'Column', children: ['btn'] },
      { id: 'btn', component: 'Button', child: 'label' },
      { id: 'label', component: 'Text', text: 'OK' },
    );
    expect(buildTree(components, 's', {})?.children?.[0]?.children?.[0]?.props.text).to.equal('OK');
  });

  it('无 root → null', () => {
    expect(buildTree({}, 's', {})).to.equal(null);
  });

  it('环检测 → 占位（不无限递归）', () => {
    const components = map(
      { id: 'root', component: 'Column', children: ['a'] },
      { id: 'a', component: 'Column', children: ['root'] }, // 指回 root，成环
    );
    expect(buildTree(components, 's', {})?.children?.[0]?.children?.[0]?.type).to.equal(
      '__placeholder__',
    );
  });

  it('action 保持原样（不预解析，供点击时 triggerAction 解析）', () => {
    const action = { event: { name: 'ping', context: { who: { path: '/who' } } } };
    const components = map(
      { id: 'root', component: 'Column', children: ['btn'] },
      { id: 'btn', component: 'Button', child: 'lbl', action },
      { id: 'lbl', component: 'Text', text: 'go' },
    );
    expect(buildTree(components, 's', { who: 'X' })?.children?.[0]?.props.action).to.deep.equal(
      action,
    );
  });

  it('Tabs 子项按 tabs 声明顺序构建，title 支持 {path} 绑定', () => {
    const components = map(
      {
        id: 'root',
        component: 'Tabs',
        tabs: [
          { title: { path: '/tabs/0' }, child: 'first' },
          { title: 'Second', child: 'second' },
        ],
      },
      { id: 'first', component: 'Text', text: 'A' },
      { id: 'second', component: 'Text', text: 'B' },
    );
    const root = buildTree(components, 's', { tabs: ['概览', '设置'] });

    expect(root?.children?.map((child) => child.props.text)).to.deep.equal(['A', 'B']);
    expect(root?.props.tabs).to.deep.equal([
      { title: '概览', child: 'first' },
      { title: 'Second', child: 'second' },
    ]);
  });

  it('checks 按当前 dataModel 派生第一条失败信息', () => {
    const components = map(
      { id: 'root', component: 'Column', children: ['email'] },
      {
        id: 'email',
        component: 'TextField',
        label: '邮箱',
        value: { path: '/email' },
        checks: [
          {
            condition: {
              call: 'required',
              args: { value: { path: '/email' } },
              returnType: 'boolean',
            },
            message: '邮箱必填',
          },
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
    );

    expect(buildTree(components, 's', { email: '' })?.children?.[0]?.validation).to.deep.equal({
      valid: false,
      message: '邮箱必填',
    });
    expect(
      buildTree(components, 's', { email: 'a@b.com' })?.children?.[0]?.validation,
    ).to.deep.equal({ valid: true, message: undefined });
  });
});
