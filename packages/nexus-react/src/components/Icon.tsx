/**
 * Icon：按 `name` 渲染图标。v0.9 官方 Basic Catalog 把 name 限定为 59 个枚举名
 * （specification/v0_9/json/basic_catalog.json），本表全覆盖并由测试锁定与官方枚举一致；
 * MVP 用 emoji 近似，枚举外名字渲染占位方块。宿主要真图标字体/设计系统图标时
 * 经 renderMap 覆盖本组件，不动内核。
 */
import { createElement } from 'react';
import { toDisplayString } from '@nexus-ui/core';
import type { RenderFn } from '../types';

export const ICON_GLYPHS: Record<string, string> = {
  accountCircle: '👤',
  add: '➕',
  arrowBack: '⬅️',
  arrowForward: '➡️',
  attachFile: '📎',
  calendarToday: '📅',
  call: '☎️',
  camera: '📷',
  check: '✅',
  close: '✕',
  delete: '🗑️',
  download: '⬇️',
  edit: '✏️',
  error: '❗',
  event: '🗓️',
  fastForward: '⏩',
  favorite: '❤️',
  favoriteOff: '💔',
  folder: '📁',
  help: '❓',
  home: '🏠',
  info: 'ℹ️',
  locationOn: '📍',
  lock: '🔒',
  lockOpen: '🔓',
  mail: '✉️',
  menu: '☰',
  moreHoriz: '⋯',
  moreVert: '⋮',
  notifications: '🔔',
  notificationsOff: '🔕',
  pause: '⏸️',
  payment: '💳',
  person: '🧑',
  phone: '📞',
  photo: '🖼️',
  play: '▶️',
  print: '🖨️',
  refresh: '🔄',
  rewind: '⏪',
  search: '🔍',
  send: '📨',
  settings: '⚙️',
  share: '🔗',
  shoppingCart: '🛒',
  skipNext: '⏭️',
  skipPrevious: '⏮️',
  star: '⭐',
  starHalf: '✩',
  starOff: '☆',
  stop: '⏹️',
  upload: '⬆️',
  visibility: '👁️',
  visibilityOff: '🙈',
  volumeDown: '🔉',
  volumeMute: '🔇',
  volumeOff: '🔇',
  volumeUp: '🔊',
  warning: '⚠️',
};

export const Icon: RenderFn = (vnode) => {
  const name = toDisplayString(vnode.props.name);
  return createElement(
    'span',
    { key: vnode.id, style: { fontSize: 18, lineHeight: 1, display: 'inline-block' } },
    ICON_GLYPHS[name] ?? '▪',
  );
};
