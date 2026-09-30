import { expect } from 'chai';
import { buildTree } from '../src/render';
import type { Component, VNode } from '../src/protocol/types';

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
  it('共享子树 memoize：DAG 菱形链线性构建，两个父引用拿到同一 VNode 实例', () => {
    // depth=24 的菱形链，无防设时展开成本 2^24
    const components: Record<string, Component> = {
      root: { id: 'root', component: 'Column', children: ['d0a', 'd0b'] },
    };
    const depth = 24;
    const id = (level: number, branch: 'a' | 'b') =>
      level === depth ? 'leaf' : `d${level}${branch}`;
    for (let level = 0; level < depth; level++) {
      for (const branch of ['a', 'b'] as const) {
        const nextLevel = level + 1;
        const children =
          nextLevel === depth
            ? ['leaf']
            : [id(nextLevel, 'a'), id(nextLevel, 'b')];
        components[id(level, branch)] = { id: id(level, branch), component: 'Column', children };
      }
    }
    components['leaf'] = { id: 'leaf', component: 'Text', text: 'end' };

    const root = buildTree(components, 's', undefined);
    expect(root).to.not.equal(null);

    // 线性：不同路径到达的共享节点必须是同一实例
    const firstA = root!.children![0]!;
    const firstB = root!.children![1]!;
    expect(firstA).to.not.equal(firstB);
    expect(firstA.children![0]!).to.equal(firstB.children![0]!);

    // 全树真实节点数 = 2*depth + 1（线性，不是 2^depth）
    const seen = new Set<VNode>();
    const walk = (node: VNode): void => {
      if (seen.has(node)) return;
      seen.add(node);
      node.children?.forEach(walk);
    };
    walk(root!);
    expect(seen.size).to.equal(depth * 2 + 2);
  });

  it('超过 maxNodes 后以占位呈现并恰好上报一次 onLimit', () => {
    const components = map(
      { id: 'root', component: 'Column', children: ['a', 'b', 'c', 'd'] },
      { id: 'a', component: 'Text', text: '1' },
      { id: 'b', component: 'Text', text: '2' },
      { id: 'c', component: 'Text', text: '3' },
      { id: 'd', component: 'Text', text: '4' },
    );
    const limits: number[] = [];
    const root = buildTree(components, 's', undefined, {
      maxNodes: 3,
      onLimit: (info) => limits.push(info.limit),
    });
    expect(limits).to.deep.equal([3]);
    expect(root!.id).to.equal('root');
    expect(root!.children![0]!.props.text).to.equal('1');
    expect(root!.children![3]!.type).to.equal('__placeholder__');
  });

  it('L0-03：占位节点计入 maxNodes 预算——大量缺失引用不能绕过预算', () => {
    const missing = Array.from({ length: 50 }, (_, i) => `ghost-${i}`);
    const components = map(
      { id: 'root', component: 'Column', children: [...missing, 'real'] },
      { id: 'real', component: 'Text', text: 'I am real' },
    );
    const limits: Array<{ limit: number; reason: string }> = [];
    const root = buildTree(components, 's', undefined, {
      maxNodes: 5,
      onLimit: (info) => limits.push(info),
    });
    expect(limits).to.deep.equal([{ limit: 5, reason: 'nodes' }]);
    // root + 4 个占位耗尽预算；其余 46 个 ghost 与真实组件全部占位降级（共 51 个占位）
    const placeholders = root!.children!.filter((c) => c.type === '__placeholder__');
    expect(placeholders).to.have.lengthOf(51);
    expect(root!.children![50]!.id).to.equal('real');
    expect(root!.children![50]!.type).to.equal('__placeholder__');
  });

  it('L0-03：重复引用（同 id 多父/同父重复）不能绕过预算', () => {
    const components = map(
      {
        id: 'root',
        component: 'Column',
        children: ['hub', 'hub', 'hub', 'hub', 'hub', 'hub', 'hub', 'hub'],
      },
      { id: 'hub', component: 'Text', text: 'hub' },
    );
    const root = buildTree(components, 's', undefined, { maxNodes: 2 });
    // hub 唯一构建一次（built=2），8 个引用全部复用同一 VNode 实例
    expect(root!.children!.every((c) => c.props.text === 'hub')).to.equal(true);
    const first = root!.children![0]!;
    expect(root!.children!.every((c) => c === first)).to.equal(true);
  });

  it('L0-06：5 万深链迭代构建不爆栈；默认深度上限外以占位呈现', () => {
    const depth = 50_000;
    const components: Record<string, Component> = {};
    for (let i = 0; i < depth; i++) {
      components[`n${i}`] = { id: `n${i}`, component: 'Column', child: i === depth - 1 ? undefined : `n${i + 1}` };
    }
    components['root'] = components['n0'];
    // 默认 maxDepth=1000：构建完成（不溢出），深层全部占位
    const limits: Array<{ limit: number; reason: string }> = [];
    let root: VNode | null = null;
    expect(() => {
      root = buildTree(components, 's', undefined, { onLimit: (info) => limits.push(info) });
    }).to.not.throw();
    expect(limits).to.deep.equal([{ limit: 1000, reason: 'depth' }]);
    // 沿第一层链走 1000 层后应为占位
    let node = root!;
    for (let i = 0; i < 999; i++) node = node.children![0]!;
    expect(node.children![0]!.type).to.equal('__placeholder__');
  });

  it('L0-06：深链带环（尾部指回祖先）正常完成，环处占位', () => {
    const depth = 3000;
    const components: Record<string, Component> = {};
    for (let i = 0; i < depth; i++) {
      components[`c${i}`] = { id: `c${i}`, component: 'Column', child: `c${i + 1}` };
    }
    components[`c${depth}`] = { id: `c${depth}`, component: 'Column', child: 'c0' }; // 成环
    components['root'] = components['c0'];
    const root = buildTree(components, 's', undefined, { maxDepth: 10_000 });
    // 走到链尾，环回 c0 以占位呈现（c0 已在祖先路径上）
    let node: VNode = root!;
    for (let i = 0; i < depth; i++) node = node.children![0]!;
    expect(node.children![0]!.type).to.equal('__placeholder__');
  });

  it('L0-06：触发深度上限后，合法更新可正常重建（恢复稳定）', () => {
    const deep: Record<string, Component> = {};
    for (let i = 0; i < 5000; i++) {
      deep[`d${i}`] = { id: `d${i}`, component: 'Column', child: `d${i + 1}` };
    }
    deep['root'] = deep['d0'];
    const firstLimits: Array<{ reason: string }> = [];
    buildTree(deep, 's', undefined, { onLimit: (info) => firstLimits.push(info) });
    expect(firstLimits).to.deep.equal([{ limit: 1000, reason: 'depth' }]);

    // 合法浅树重建：预算/上限不残留
    const shallow = map(
      { id: 'root', component: 'Column', children: ['t'] },
      { id: 't', component: 'Text', text: 'fresh' },
    );
    const limits: Array<{ reason: string }> = [];
    const root = buildTree(shallow, 's', undefined, { onLimit: (info) => limits.push(info) });
    expect(limits).to.deep.equal([]);
    expect(root!.children![0]!.props.text).to.equal('fresh');
  });

  it('maxDepth 内的深层链正常完整构建', () => {
    const depth = 500;
    const components: Record<string, Component> = {};
    for (let i = 0; i < depth; i++) {
      components[`m${i}`] = { id: `m${i}`, component: 'Column', child: `m${i + 1}` };
    }
    components[`m${depth}`] = { id: `m${depth}`, component: 'Text', text: 'bottom' };
    components['root'] = components['m0'];
    const root = buildTree(components, 's', undefined);
    let node: VNode = root!;
    for (let i = 0; i < depth; i++) node = node.children![0]!;
    expect(node.props.text).to.equal('bottom');
  });

});
