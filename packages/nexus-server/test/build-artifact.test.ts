import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
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
  }
});
