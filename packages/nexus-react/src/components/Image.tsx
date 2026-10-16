/** Image：url（{path} 绑定已解析）+ fit（cover/contain）+ variant（avatar 圆形头像）。 */
import { createElement } from 'react';
import { isSafeMediaUrl, toDisplayString } from '@nexus-ui/core';
import type { RenderFn } from '../types';

/** 解析后的 URL 未通过 http(s) 判定时不输出 src，渲染带说明性 alt 的占位。 */
const BLOCKED_ALT = '媒体 URL 不安全，已阻止加载';

export const Image: RenderFn = (vnode) => {
  const rawUrl = vnode.props.url;
  const url = isSafeMediaUrl(rawUrl) ? rawUrl : '';
  const fit = vnode.props.fit === 'contain' ? 'contain' : 'cover';
  const isAvatar = vnode.props.variant === 'avatar';
  const description = toDisplayString(vnode.props.description);
  return createElement('img', {
    key: vnode.id,
    ...(url ? { src: url } : {}),
    alt: url ? description : description ? `${description}：${BLOCKED_ALT}` : BLOCKED_ALT,
    referrerPolicy: 'no-referrer',
    style: isAvatar
      ? { width: 96, height: 96, borderRadius: '50%', objectFit: fit, border: '1px solid #eee' }
      : { maxWidth: '100%', objectFit: fit, borderRadius: 4, display: 'block' },
  });
};
