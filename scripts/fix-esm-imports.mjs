import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';

const root = process.argv[2];
if (!root) {
  console.error('Usage: node fix-esm-imports.mjs <dist-dir>');
  process.exit(1);
}

const importPattern = /(from\s+|import\s+)['"](\.\.?\/[^'"]+)['"]/g;

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
      const content = readFileSync(fullPath, 'utf-8');
      const fixed = content.replace(importPattern, (match, prefix, path) => {
        if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.json')) return match;
        const abs = resolve(dirname(fullPath), path);
        if (existsSync(abs) && statSync(abs).isDirectory()) {
          return `${prefix}'${path}/index.js'`;
        }
        return `${prefix}'${path}.js'`;
      });
      if (fixed !== content) writeFileSync(fullPath, fixed);
    }
  }
}

walk(root);
