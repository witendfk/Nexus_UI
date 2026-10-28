import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

describe('SDK dist file inventory', () => {
  for (const name of ['nexus-core', 'nexus-react', 'nexus-server']) {
    it(`${name} contains only outputs from the current source tree`, () => {
      const pkg = fileURLToPath(new URL(`../../${name}/`, import.meta.url));
      const src = join(pkg, 'src');
      const dist = join(pkg, 'dist');
      const expected = filesUnder(src)
        .filter((path) => /\.tsx?$/.test(path))
        .flatMap((path) => {
          const stem = relative(src, path).replace(/\.tsx?$/, '');
          return ['.js', '.js.map', '.d.ts', '.d.ts.map'].map((ext) => `${stem}${ext}`);
        })
        .sort();
      assert.deepEqual(
        filesUnder(dist)
          .map((path) => relative(dist, path))
          .sort(),
        expected,
        'Build SDK packages first; obsolete or missing outputs must fail artifact validation',
      );
    });
    it(`${name} loads its exported ESM root in plain Node without opening a listener`, () => {
      const pkg = fileURLToPath(new URL(`../../${name}/`, import.meta.url));
      const result = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import assert from 'node:assert/strict';
           import net from 'node:net';
           net.Server.prototype.listen = () => { throw new Error('SDK import started a listener'); };
           const api = await import('@nexus-ui/${name.slice(6)}');
           assert.ok(Object.keys(api).length > 0);`,
        ],
        { cwd: pkg, env: { ...process.env, NODE_OPTIONS: '' }, timeout: 10_000 },
      );
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr.toString());
    });
  }

  it('runs generation, action and rejection through published package roots in plain Node', () => {
    const fixture = fileURLToPath(new URL('./runtime/fixtures/public-entry.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [fixture], {
      env: { ...process.env, NODE_OPTIONS: '' },
      timeout: 10_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr.toString());
  });
});
