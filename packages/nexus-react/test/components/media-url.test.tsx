/**
 * S1 证伪测试：React 媒体组件的运行层 URL 守卫。
 *
 * 准入层无法判定 `{ path }` 绑定解析后的真值；Image/Video/AudioPlayer 用
 * core 的 isSafeMediaUrl 守卫解析后的 url：非 http(s) 一律不输出 src，
 * 渲染带说明性 alt/aria 的占位（第二道防线）。
 * 修复前：解析后的 url 直通 `src`，`javascript:` 等可进入 DOM。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { VNode } from '@nexus-ui/core';
import { AudioPlayer } from '../../src/components/AudioPlayer';
import { Image } from '../../src/components/Image';
import { Video } from '../../src/components/Video';

afterEach(cleanup);

const noopCtx = { triggerAction: () => {}, setInputValue: () => false };

function vnodeOf(props: Record<string, unknown>, id = 'm1'): VNode {
  return { id, surfaceId: 's-1', component: 'Image', props } as unknown as VNode;
}

/** 覆盖大小写变体、协议相对与畸形输入——均不得进入 src。 */
const UNSAFE_URLS = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'ftp://example.com/a.mp4',
  '//example.com/a.mp4',
  'not a url',
];

describe('媒体组件 · 运行层 URL 守卫', () => {
  it('Image：非法 url 不输出 src，渲染说明性 alt 占位', () => {
    for (const url of UNSAFE_URLS) {
      const { container } = render(Image(vnodeOf({ url, description: '头像' }), [], noopCtx));
      const img = container.querySelector('img');
      expect(img, url).not.toBeNull();
      expect(img?.getAttribute('src'), url).toBeNull();
      expect(img?.getAttribute('alt'), url).toContain('已阻止');
    }
  });

  it('Image：http/https url 正常输出 src', () => {
    for (const url of ['https://example.com/a.png', 'http://example.com/a.png']) {
      const { container } = render(Image(vnodeOf({ url }), [], noopCtx));
      expect(container.querySelector('img')?.getAttribute('src'), url).toBe(url);
    }
  });

  it('Video：非法 url 不输出 src，带说明性 aria 标注', () => {
    for (const url of UNSAFE_URLS) {
      const { container } = render(Video(vnodeOf({ url }), [], noopCtx));
      const video = container.querySelector('video');
      expect(video, url).not.toBeNull();
      expect(video?.getAttribute('src'), url).toBeNull();
      expect(video?.getAttribute('aria-label'), url).toContain('已阻止');
    }
  });

  it('Video：合法 url 正常输出 src', () => {
    const { container } = render(Video(vnodeOf({ url: 'https://example.com/a.mp4' }), [], noopCtx));
    expect(container.querySelector('video')?.getAttribute('src')).toBe('https://example.com/a.mp4');
  });

  it('AudioPlayer：非法 url 不输出 src，带说明性 aria 标注', () => {
    for (const url of UNSAFE_URLS) {
      const { container } = render(AudioPlayer(vnodeOf({ url }), [], noopCtx));
      const audio = container.querySelector('audio');
      expect(audio, url).not.toBeNull();
      expect(audio?.getAttribute('src'), url).toBeNull();
      expect(audio?.getAttribute('aria-label'), url).toContain('已阻止');
    }
  });

  it('AudioPlayer：合法 url 正常输出 src，description 照常渲染', () => {
    const { container } = render(
      AudioPlayer(
        vnodeOf({ url: 'https://example.com/a.mp3', description: '第一集' }),
        [],
        noopCtx,
      ),
    );
    expect(container.querySelector('audio')?.getAttribute('src')).toBe('https://example.com/a.mp3');
    expect(container.querySelector('figcaption')?.textContent).toBe('第一集');
  });
});
