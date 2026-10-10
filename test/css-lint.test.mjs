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

/* The scan's lint also warns "Unexpected duplicate <property>": a property
 * written twice in one rule, which is what a spelled-out reset followed by the
 * real value does. Each property appears once per rule, with its final value. */
import { duplicateProperties } from './css-rules.mjs';

test('no rule in styles.css sets the same property twice', () => {
  const dups = duplicateProperties(readFileSync(resolve(repo, 'styles.css'), 'utf8'));
  assert.deepEqual(dups.map((d) => `line ${d.line}: ${d.property} in ${d.selector}`), []);
});

test('the duplicate-property check does catch a repeat (and ignores comments, nested rules and url data)', () => {
  assert.equal(duplicateProperties('a { color: red; color: blue; }').length, 1);
  assert.equal(duplicateProperties('a { color: red; /* color: blue; */ }').length, 0);
  assert.equal(duplicateProperties('a { color: red; } @media (x) { a { color: blue; } }').length, 0);
  assert.equal(duplicateProperties('a { background: url("data:image/svg+xml;utf8,<svg/>"); color: red; }').length, 0);
  assert.equal(duplicateProperties('@container (max-width: 1px) { a { height: 1px; } .b { height: 2px; } }').length, 0);
});

/* The 1.0.8 scan failed on "Unexpected }": one closing brace too many after a
 * container block, which also made the browser drop the rule after it. Every
 * brace closes one that was opened, and every opened brace is closed. */
test('every brace in styles.css is balanced', () => {
  let depth = 0;
  css.split('\n').forEach((text, i) => {
    for (const ch of text.replace(/"[^"]*"|'[^']*'/g, '')) {
      if (ch === '{') depth++;
      if (ch === '}') { depth--; assert.ok(depth >= 0, 'unexpected } on line ' + (i + 1) + ' (comments removed)'); }
    }
  });
  assert.equal(depth, 0);
});
