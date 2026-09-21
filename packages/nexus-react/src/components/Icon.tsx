/**
 * Icon：按 `name` 渲染图标。v0.9 用 Material 图标名；MVP 无图标字体，用 emoji 近似，
 * 未命中名渲染占位方块。后续可换真正的图标方案（renderMap 不动内核）。
 */
import { createElement } from 'react';
import { toDisplayString } from '@nexus-ui/core';
import type { RenderFn } from '../types';

const ICONS: Record<string, string> = {
  star: '⭐',
  phone: '📞',
  mail: '✉️',
  calendarToday: '📅',
  locationOn: '📍',
  refresh: '🔄',
  search: '🔍',
  home: '🏠',
  check: '✅',
  close: '✕',
  favorite: '❤️',
  settings: '⚙️',
};

export const Icon: RenderFn = (vnode) => {
  const name = toDisplayString(vnode.props.name);
  return createElement(
    'span',
    { key: vnode.id, style: { fontSize: 18, lineHeight: 1, display: 'inline-block' } },
    ICONS[name] ?? '▪',
  );
};
