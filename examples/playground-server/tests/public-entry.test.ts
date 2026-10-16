import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * 参考程序只允许通过公开包入口消费 SDK（AGENTS.md 依赖方向单一）。
 * 该证伪测试扫描 src/ 的静态 import/export，断言不存在 @nexus-ui/core、
 * @nexus-ui/server 的深路径或源码路径引用。
 */
async function listTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listTsFiles(full)));
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

describe('playground-server 只消费公开 SDK 入口', () => {
  it('src/ 不含 @nexus-ui/* 深路径或源码相对越界 import', async () => {
    const srcDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');
    const files = await listTsFiles(srcDir);
    assert.ok(files.length > 0, 'src/ 必须存在被检查的源码');

    const violations: string[] = [];
    const deepImport = /@nexus-ui\/(core|server|react)\//;
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const match of source.matchAll(/(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/g)) {
        const specifier = match[1] ?? '';
        if (deepImport.test(specifier)) {
          violations.push(`${file}: ${specifier}`);
        }
      }
    }

    assert.deepEqual(violations, []);
  });
});
