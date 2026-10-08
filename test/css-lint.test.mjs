/* The Obsidian community scan lints styles.css against Obsidian 1.6.5 and
 * warned about five constructs. This keeps them out: no !important, no
 * `all:` reset, no :has(), no multi-column properties (column-gap included)
 * and no display: contents. Comments are ignored. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(resolve(repo, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

for (const [name, re] of [
  ['!important', /!\s*important/i],
  ['the all property', /(^|[;{\s])all\s*:/m],
  [':has()', /:has\(/],
  ['display: contents', /display\s*:\s*contents/],
  ['column-gap, column-count, column-width or columns', /(^|[;{\s])(column-gap|column-count|column-width|columns)\s*:/m],
]) {
  test('styles.css has no ' + name, () => {
    assert.doesNotMatch(css, re);
  });
}
