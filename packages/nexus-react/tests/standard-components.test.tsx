import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { VNode } from '@nexus-ui/core';
import { Button } from '../src/components/Button';
import { Icon, ICON_GLYPHS } from '../src/components/Icon';
import { Slider } from '../src/components/Slider';
import { Text } from '../src/components/Text';
import { TextField } from '../src/components/TextField';

/** 标准组件渲染保真度（对应 docs/SPEC.md §2 的 17 组件边界）：
 *  Icon 映射表与官方 v0.9 basic_catalog 的 name 枚举双向锁定；Text 消费官方 7 档
 *  variant；Button 消费官方 3 档 variant。RenderFn 均为纯函数，可直接调用产出元素。 */

afterEach(cleanup);

const noopCtx = { triggerAction: () => {}, setInputValue: () => false };

function vnodeOf(props: Record<string, unknown>, id = 'c1'): VNode {
  return { id, surfaceId: 's-1', component: 'Test', props } as unknown as VNode;
}

const basicCatalog = JSON.parse(
  // vitest 在包目录运行（jsdom 环境下 import.meta.url 不可靠，用 cwd 相对路径）
  readFileSync(resolve(process.cwd(), '../../specification/v0_9/json/basic_catalog.json'), 'utf8'),
) as unknown;

/** Icon 的 props 定义嵌在 allOf 分支里；深度查找带 oneOf 枚举的 `name` 键。 */
function findIconNameEnum(node: unknown): string[] {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findIconNameEnum(item);
      if (found.length > 0) return found;
    }
  } else if (node !== null && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const name = obj.name;
    if (
      name !== null &&
      typeof name === 'object' &&
      Array.isArray((name as { oneOf?: unknown }).oneOf)
    ) {
      const enums = (name as { oneOf: Array<{ enum?: string[] }> }).oneOf.flatMap(
        (branch) => branch.enum ?? [],
      );
      if (enums.length > 0) return enums;
    }
    for (const value of Object.values(obj)) {
      const found = findIconNameEnum(value);
      if (found.length > 0) return found;
    }
  }
  return [];
}

const officialIconNames: string[] = findIconNameEnum(basicCatalog);

describe('Icon 与官方 v0.9 name 枚举双向锁定', () => {
  it('官方枚举共 59 名，且每个名字都有对应图形（缺名即回归）', () => {
    expect(officialIconNames.length).toBeGreaterThan(50);
    const missing = officialIconNames.filter((name) => !(name in ICON_GLYPHS));
    expect(missing).toEqual([]);
  });

  it('映射表没有官方枚举之外的自创名（防漂移）', () => {
    const extra = Object.keys(ICON_GLYPHS).filter((name) => !officialIconNames.includes(name));
    expect(extra).toEqual([]);
  });
});

describe('标准组件渲染保真度', () => {
  it('Icon：官方名渲染对应图形，枚举外名字渲染占位方块', () => {
    render(Icon(vnodeOf({ name: 'warning' }), [], noopCtx));
    expect(screen.getByText('⚠️')).to.exist;
    cleanup();

    render(Icon(vnodeOf({ name: 'notARealIcon' }, 'c2'), [], noopCtx));
    expect(screen.getByText('▪')).to.exist;
  });

  it('Text：官方 7 档 variant 全部渲染为语义化标签', () => {
    const cases = [
      ['h1', 'h1'],
      ['h2', 'h2'],
      ['h3', 'h3'],
      ['h4', 'h4'],
      ['h5', 'h5'],
      ['caption', 'span'],
      ['body', 'p'],
      [undefined, 'p'],
    ] as const;
    for (const [variant, tag] of cases) {
      const { container } = render(
        Text(vnodeOf({ text: `t-${String(variant)}`, variant }), [], noopCtx),
      );
      expect(container.querySelector(tag), `variant=${String(variant)}`).not.toBeNull();
      cleanup();
    }
  });

  it('Button：三档 variant 样式可区分；点击触发 action；disabled 不触发', () => {
    const triggerAction = vi.fn();
    const ctx = { triggerAction, setInputValue: noopCtx.setInputValue };

    const { container: primaryContainer } = render(
      Button(vnodeOf({ variant: 'primary' }), [], ctx),
    );
    const primary = primaryContainer.querySelector('button');
    expect(primary?.getAttribute('type')).toBe('button');
    expect(primary?.style.background).toBe('rgb(37, 99, 235)');
    expect(primary?.style.color).toBe('rgb(255, 255, 255)');
    fireEvent.click(primary!);
    expect(triggerAction).toHaveBeenCalledTimes(1);
    cleanup();

    const { container: borderlessContainer } = render(
      Button(vnodeOf({ variant: 'borderless' }, 'c2'), [], ctx),
    );
    const borderless = borderlessContainer.querySelector('button')!;
    expect(borderless.style.background).toBe('none');
    expect(borderless.style.color).toBe('rgb(37, 99, 235)');
    cleanup();

    const { container: defaultContainer } = render(Button(vnodeOf({}, 'c3'), [], ctx));
    expect(defaultContainer.querySelector('button')?.style.background).toBe('rgb(243, 244, 246)');
    cleanup();

    const { container: disabledContainer } = render(
      Button(vnodeOf({ disabled: true }, 'c4'), [], ctx),
    );
    const disabled = disabledContainer.querySelector('button')!;
    expect(disabled.disabled).toBe(true);
    fireEvent.click(disabled);
    expect(triggerAction).toHaveBeenCalledTimes(1);
  });
});

describe('标准输入控件上报绑定属性（S2.3 声明驱动写回）', () => {
  it('TextField 与 Slider 只上报组件、绑定属性与用户值，属性名由控件固定为 value', () => {
    const setInputValue = vi.fn(() => true);
    const ctx = { triggerAction: () => {}, setInputValue };

    render(TextField(vnodeOf({ label: '关键词', value: '' }, 't1'), [], ctx));
    fireEvent.change(screen.getByLabelText('关键词'), { target: { value: '新值' } });
    expect(setInputValue).toHaveBeenCalledWith('t1', 's-1', 'value', '新值');

    setInputValue.mockClear();
    render(Slider(vnodeOf({ label: '阈值', min: 0, max: 1, value: 0.25 }, 's1'), [], ctx));
    fireEvent.change(screen.getByRole('slider', { name: '阈值' }), { target: { value: '0.75' } });
    expect(setInputValue).toHaveBeenCalledWith('s1', 's-1', 'value', 0.75);
  });
});
