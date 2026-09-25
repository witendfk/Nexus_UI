import type { Component } from '@nexus-ui/core';
import { getByPath } from '@nexus-ui/core';
import { getDataBindingPath } from './component-policy';

export type MediaComponent = 'Image' | 'Video' | 'AudioPlayer';
export type RequiredMediaPolicy = Record<MediaComponent, boolean>;

const URL_PATTERN = /https?:\/\//i;

export function getRequiredMediaPolicy(message: string | undefined): RequiredMediaPolicy {
  if (typeof message !== 'string') {
    return { Image: false, Video: false, AudioPlayer: false };
  }

  const hasUrl = URL_PATTERN.test(message);
  return {
    Image:
      /(头像|图片|照片|avatar|image|photo|picture)/i.test(message) ||
      /https?:\/\/\S+\.(?:png|jpe?g|gif|webp|svg)(?:[?#]|$)/i.test(message),
    Video:
      (hasUrl && /(视频|video|trailer)/i.test(message)) ||
      /https?:\/\/\S+\.(?:mp4|webm|mov|m4v|ogv)(?:[?#]|$)/i.test(message),
    AudioPlayer:
      (hasUrl && /(音频|音乐|播客|audio|music|podcast)/i.test(message)) ||
      /https?:\/\/\S+\.(?:mp3|wav|ogg|m4a|aac|flac)(?:[?#]|$)/i.test(message),
  };
}

function unsupportedTextMediaMessage(): string {
  return 'Basic Catalog Text 不能承载 URL；媒体 URL 必须使用 Image/Video/AudioPlayer.url';
}

export function validateLiteralMediaPolicy(component: Component): string | null {
  if (component.component !== 'Text' || typeof component.text !== 'string') return null;
  return URL_PATTERN.test(component.text) ? unsupportedTextMediaMessage() : null;
}

export function validateDynamicMediaPolicy(
  component: Component,
  dataModel?: unknown,
): string | null {
  if (component.component !== 'Text') return null;
  const path = getDataBindingPath(component.text);
  if (path === null) return null;
  if (/(avatar|image|photo|picture|icon|logo|url|link|website)/i.test(path)) {
    return 'Basic Catalog Text 不能绑定 URL 类字段；媒体 URL 必须使用 Image/Video/AudioPlayer.url';
  }
  const value = getByPath(dataModel, path);
  if (typeof value === 'string' && URL_PATTERN.test(value)) {
    return unsupportedTextMediaMessage();
  }
  return null;
}
