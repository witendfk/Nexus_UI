/** Video：协议 url 已解析后映射为原生受控播放器。 */
import { createElement } from 'react';
import { isSafeMediaUrl } from '@nexus-ui/core';
import type { RenderFn } from '../types';

/** 解析后的 URL 未通过 http(s) 判定时不输出 src，渲染带说明性 aria 标注的占位。 */
const BLOCKED_LABEL = '媒体 URL 不安全，已阻止加载';

export const Video: RenderFn = (vnode) => {
  const rawUrl = vnode.props.url;
  const url = isSafeMediaUrl(rawUrl) ? rawUrl : '';
  return createElement('video', {
    key: vnode.id,
    controls: true,
    preload: 'metadata',
    ...(url ? { src: url } : { 'aria-label': BLOCKED_LABEL }),
    style: { display: 'block', maxWidth: '100%', width: '100%' },
  });
};
