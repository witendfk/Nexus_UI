/** Image：url（{path} 绑定已解析）+ fit（cover/contain）+ variant（avatar 圆形头像）。 */
import { createElement } from 'react';
import { toDisplayString } from '@nexus-ui/core';
import type { RenderFn } from '../types';

export const Image: RenderFn = (vnode) => {
  const url = toDisplayString(vnode.props.url);
  const fit = vnode.props.fit === 'contain' ? 'contain' : 'cover';
  const isAvatar = vnode.props.variant === 'avatar';
  const description = toDisplayString(vnode.props.description);
  return createElement('img', {
    key: vnode.id,
    src: url,
    alt: description,
    referrerPolicy: 'no-referrer',
    style: isAvatar
      ? { width: 96, height: 96, borderRadius: '50%', objectFit: fit, border: '1px solid #eee' }
      : { maxWidth: '100%', objectFit: fit, borderRadius: 4, display: 'block' },
  });
};
