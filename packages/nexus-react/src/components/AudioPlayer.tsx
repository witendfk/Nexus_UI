/** AudioPlayer：协议 url 已解析后映射为原生音频控件。 */
import { createElement } from 'react';
import type { RenderFn } from '../types';

export const AudioPlayer: RenderFn = (vnode) => {
  const url = typeof vnode.props.url === 'string' ? vnode.props.url : '';
  const description = typeof vnode.props.description === 'string' ? vnode.props.description : '';
  return createElement(
    'figure',
    { key: vnode.id, style: { margin: 0, width: '100%' } },
    createElement('audio', {
      controls: true,
      preload: 'metadata',
      src: url,
      style: { display: 'block', width: '100%' },
    }),
    description ? createElement('figcaption', null, description) : null,
  );
};
