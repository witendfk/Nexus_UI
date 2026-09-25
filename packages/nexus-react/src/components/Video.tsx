/** Video：协议 url 已解析后映射为原生受控播放器。 */
import { createElement } from 'react';
import type { RenderFn } from '../types';

export const Video: RenderFn = (vnode) => {
  const url = typeof vnode.props.url === 'string' ? vnode.props.url : '';
  return createElement('video', {
    key: vnode.id,
    controls: true,
    preload: 'metadata',
    src: url,
    style: { display: 'block', maxWidth: '100%', width: '100%' },
  });
};
