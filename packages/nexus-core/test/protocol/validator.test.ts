/**
 * S1 证伪测试：协议/Profile 准入边界的保留段与媒体 URL 契约。
 *
 * 覆盖四组准入口径：
 *   1. action.event.context 的自有保留段键（__proto__/constructor/prototype）被拒；
 *   2. 组件 props 层（非结构键）的自有保留段键被拒；
 *   3. component.id 与四处 surfaceId 三段全拒（旧口径只拦 __proto__）；
 *   4. Image/Video/AudioPlayer 字面量 url 必须 http(s)（{ path } 绑定放行，
 *      由渲染层运行时守卫）。
 */
import { expect } from 'chai';
import { validateA2UIMessage } from '../../src/protocol/validator';
import type { ParseResult } from '../../src/protocol/types';

/** 经 JSON.parse 构造携带自有 __proto__ 键的消息（字面量写不成自有键）。 */
function parseMessage(json: string): unknown {
  return JSON.parse(json);
}

function errorOf(result: ParseResult): string {
  return result.ok ? '' : (result.error?.message ?? '');
}

const updateComponents = (componentJson: string): unknown =>
  parseMessage(
    `{"version":"v0.9","updateComponents":{"surfaceId":"s1","components":[${componentJson}]}}`,
  );

describe('validator 准入 · action.event.context 保留段键', () => {
  it('自有 __proto__ / constructor / prototype 键被拒（值本身合法）', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const message = updateComponents(
        `{"id":"t1","component":"Text","text":"hi","action":{"event":{"name":"go","context":{"${key}":1}}}}`,
      );
      const result = validateA2UIMessage(message);
      expect(result.ok, `context 键 ${key} 应被拒`).to.equal(false);
      expect(errorOf(result), `context 键 ${key}`).to.include('保留段');
    }
  });

  it('正常 context 键不受影响', () => {
    const message = updateComponents(
      '{"id":"t1","component":"Text","text":"hi","action":{"event":{"name":"go","context":{"itemId":7}}}}',
    );
    expect(validateA2UIMessage(message).ok).to.equal(true);
  });
});

describe('validator 准入 · 组件 props 保留段键', () => {
  it('Text 自有 __proto__ / constructor 键被拒', () => {
    for (const key of ['__proto__', 'constructor']) {
      const message = updateComponents(`{"id":"t1","component":"Text","text":"hi","${key}":1}`);
      const result = validateA2UIMessage(message);
      expect(result.ok, `props 键 ${key} 应被拒`).to.equal(false);
      expect(errorOf(result), `props 键 ${key}`).to.include('保留段');
    }
  });
});

describe('validator 准入 · component.id / surfaceId 三段全拒', () => {
  it('component.id 为 constructor / prototype 被拒（__proto__ 为既有对照）', () => {
    for (const [id, shouldPass] of [
      ['__proto__', false],
      ['constructor', false],
      ['prototype', false],
      ['title-1', true],
    ] as const) {
      const result = validateA2UIMessage(
        updateComponents(`{"id":"${id}","component":"Text","text":"hi"}`),
      );
      expect(result.ok, `component.id=${id}`).to.equal(shouldPass);
      if (!shouldPass) {
        expect(errorOf(result), `component.id=${id}`).to.include('component.id 不得为保留字');
      }
    }
  });

  it('四处 payload 的 surfaceId 为 constructor / prototype 全部被拒', () => {
    const cases: Array<[string, string]> = [
      ['createSurface', '{"surfaceId":"SID","catalogId":"c1"}'],
      [
        'updateComponents',
        '{"surfaceId":"SID","components":[{"id":"t1","component":"Text","text":"hi"}]}',
      ],
      ['updateDataModel', '{"surfaceId":"SID","path":"/a","value":1}'],
      ['deleteSurface', '{"surfaceId":"SID"}'],
    ];
    for (const [key, payloadTemplate] of cases) {
      for (const surfaceId of ['__proto__', 'constructor', 'prototype']) {
        const payload = payloadTemplate.replace('"SID"', `"${surfaceId}"`);
        const result = validateA2UIMessage(parseMessage(`{"version":"v0.9","${key}":${payload}}`));
        expect(result.ok, `${key}.surfaceId=${surfaceId}`).to.equal(false);
        expect(errorOf(result), `${key}.surfaceId=${surfaceId}`).to.include('不得为保留字');
      }
    }
    for (const [key, payloadTemplate] of cases) {
      const payload = payloadTemplate.replace('"SID"', '"s1"');
      const result = validateA2UIMessage(parseMessage(`{"version":"v0.9","${key}":${payload}}`));
      expect(result.ok, `${key}.surfaceId=s1`).to.equal(true);
    }
  });
});

describe('validator 准入 · 媒体组件 URL scheme', () => {
  const mediaMessage = (component: string, urlJson: string): unknown =>
    updateComponents(`{"id":"m1","component":"${component}","url":${urlJson}}`);

  const UNSAFE_URLS = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://example.com/a.mp4',
    'file:///etc/passwd',
    '//example.com/a.mp4',
    'not a url',
  ];

  for (const component of ['Image', 'Video', 'AudioPlayer']) {
    it(`${component} 字面量非 http(s) url 被拒`, () => {
      for (const url of UNSAFE_URLS) {
        const result = validateA2UIMessage(mediaMessage(component, JSON.stringify(url)));
        expect(result.ok, `${component} url=${url}`).to.equal(false);
        expect(errorOf(result), `${component} url=${url}`).to.include('http/https');
      }
    });

    it(`${component} 合法 http/https 与 { path } 绑定放行`, () => {
      for (const urlJson of [
        JSON.stringify('https://example.com/a.mp4'),
        JSON.stringify('http://example.com/a.mp4'),
        '{"path":"/mediaUrl"}',
      ]) {
        const result = validateA2UIMessage(mediaMessage(component, urlJson));
        expect(result.ok, `${component} url=${urlJson}`).to.equal(true);
      }
    });
  }

  it('AudioPlayer 补充字段校验不受影响', () => {
    const result = validateA2UIMessage(
      updateComponents(
        '{"id":"a1","component":"AudioPlayer","url":"https://example.com/a.mp3","description":"eps"}',
      ),
    );
    expect(result.ok).to.equal(true);
  });
});
