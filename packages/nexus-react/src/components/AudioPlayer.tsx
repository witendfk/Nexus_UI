/** AudioPlayer：协议 url 已解析后映射为原生音频控件。 */
import { createElement } from 'react';
import { isSafeMediaUrl } from '@nexus-ui/core';
import type { RenderFn } from '../types';

/** 解析后的 URL 未通过 http(s) 判定时不输出 src，渲染带说明性 aria 标注的占位。 */
const BLOCKED_LABEL = '媒体 URL 不安全，已阻止加载';

export const AudioPlayer: RenderFn = (vnode) => {
  const rawUrl = vnode.props.url;
  const url = isSafeMediaUrl(rawUrl) ? rawUrl : '';
  const description = typeof vnode.props.description === 'string' ? vnode.props.description : '';
  return createElement(
    'figure',
    { key: vnode.id, style: { margin: 0, width: '100%' } },
    createElement('audio', {
      controls: true,
      preload: 'metadata',
      ...(url ? { src: url } : { 'aria-label': BLOCKED_LABEL }),
      style: { display: 'block', width: '100%' },
    }),
    description ? createElement('figcaption', null, description) : null,
  );
};
