import { describe, expect, it } from 'vitest';
import { createElement, isValidElement } from 'react';
import type { ReactElement } from 'react';
import type { VNode } from '@nexus-ui/core';
import { standardRenderMap } from '@nexus-ui/react';
import { workbenchRenderMap } from '../src/catalog/workbench';

function vnode(type: string, props: Record<string, unknown>): VNode {
  return {
    id: `${type}-1`,
    type,
    props,
    children: null,
    surfaceId: 'surface-workbench',
  };
}

describe('workbench render map', () => {
  it('复用标准协议控件并扩展 CustomerSummary', () => {
    expect(workbenchRenderMap.Text).toEqual(standardRenderMap.Text);
    expect(workbenchRenderMap.TextField).toEqual(standardRenderMap.TextField);
    expect(workbenchRenderMap.CheckBox).toEqual(standardRenderMap.CheckBox);
    expect(workbenchRenderMap.ChoicePicker).toEqual(standardRenderMap.ChoicePicker);
    expect(workbenchRenderMap.CustomerSummary).toBeDefined();
  });

  it('CustomerSummary 渲染企业宿主摘要容器', () => {
    const node = vnode('CustomerSummary', {
      customerName: '华云科技',
      company: 'Nexus Enterprise Buyer',
      owner: 'Linda',
      status: '待跟进',
      recentNote: '希望补齐任务自动化能力',
    });
    const element = workbenchRenderMap.CustomerSummary?.(node, [], {
      triggerAction: () => undefined,
      setInputValue: () => false,
    }) as ReactElement;

    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe('section');
  });

  it('Workbench Button 支持 submit 后禁用', () => {
    const node = vnode('Button', { disabled: true });
    const element = workbenchRenderMap.Button?.(node, [createElement('span', null, '任务已创建')], {
      triggerAction: () => undefined,
      setInputValue: () => false,
    }) as ReactElement;

    expect(isValidElement(element)).toBe(true);
    expect(element.props.disabled).toBe(true);
  });
});
