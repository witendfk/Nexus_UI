import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyEnvSource, loadProjectEnv } from '../src/config/env';

describe('applyEnvSource', () => {
  it('parses comments, quotes, and export declarations', () => {
    const target: Record<string, string | undefined> = {
      KEEP: 'runtime',
    };
    const keys = applyEnvSource(
      [
        '# comment',
        'OPENAI_API_KEY=secret',
        'export OPENAI_BASE_URL="https://example.test/v1"',
        "OPENAI_MODEL='gpt-4o-mini' # quoted comment",
        'KEEP=file-value',
      ].join('\n'),
      target,
    );

    assert.deepEqual(keys.sort(), ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL']);
    assert.deepEqual(target, {
      KEEP: 'runtime',
      OPENAI_API_KEY: 'secret',
      OPENAI_BASE_URL: 'https://example.test/v1',
      OPENAI_MODEL: 'gpt-4o-mini',
    });
  });

  it('rejects malformed declarations', () => {
    assert.throws(() => applyEnvSource('OPENAI_API_KEY', {}), /格式非法/);
  });
});

describe('loadProjectEnv', () => {
  it('测试环境不加载仓库本地 .env', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    delete process.env.NEXUS_ENV_TEST_KEY;

    try {
      assert.deepEqual(loadProjectEnv(), []);
      assert.equal(process.env.NEXUS_ENV_TEST_KEY, undefined);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
