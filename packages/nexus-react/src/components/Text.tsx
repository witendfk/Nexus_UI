/** Text：text（{path} 绑定已在 tree-builder 解析）+ variant（官方 7 档全消费，默认 body→p）。 */
import { createElement } from 'react';
import { toDisplayString } from '@nexus-ui/core';
import type { RenderFn } from '../types';

export const Text: RenderFn = (vnode) => {
  const text = toDisplayString(vnode.props.text);
  switch (vnode.props.variant) {
    case 'h1':
      return createElement('h1', { key: vnode.id }, text);
    case 'h2':
      return createElement('h2', { key: vnode.id }, text);
    case 'h3':
      return createElement('h3', { key: vnode.id }, text);
    case 'h4':
      return createElement('h4', { key: vnode.id }, text);
    case 'h5':
      return createElement('h5', { key: vnode.id }, text);
    case 'caption':
      return createElement(
        'span',
        { key: vnode.id, style: { fontSize: 12, color: '#888', lineHeight: 1.6 } },
        text,
      );
    default:
      return createElement('p', { key: vnode.id, style: { margin: 0 } }, text);
  }
};
