/* A TABLE IN A NARROW TILE (A PHONE).
 *
 * Headings once broke in the middle of a word, were cut off by a column
 * that was too narrow, and numbers were clipped. These gates pin the rules
 * in the stylesheet: a heading wraps at its spaces only, is never cut,
 * sits on one baseline; a number is never cut; text cells that are cut
 * carry their whole text on hover. Every value here is invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadPlugin } from './harness.mjs';

const css = fs.readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const { lib, obsidian } = loadPlugin();
function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }

const narrow = css.slice(css.indexOf('@container (max-width: 400px)'));
const block = (sel) => { const at = narrow.indexOf(sel + ' {'); assert.ok(at >= 0, sel); return narrow.slice(at, narrow.indexOf('}', at)); };

test('a narrow heading wraps at its spaces, is never cut or broken in a word, and shares one baseline', () => {
  const th = block('.icor-sqlv-tile .icor-sqlv-table thead th');
  assert.match(th, /white-space:\s*normal/);
  assert.match(th, /overflow:\s*visible/);
  assert.match(th, /max-width:\s*none/);
  assert.match(th, /overflow-wrap:\s*normal/);
  assert.match(th, /word-break:\s*normal/);
  assert.match(th, /vertical-align:\s*bottom/);
  assert.doesNotMatch(th, /overflow-wrap:\s*(anywhere|break-word)/);
});

test('a narrow table shares the tile width, tighter, and a number is never cut', () => {
  assert.match(block('.icor-sqlv-tile .icor-sqlv-table'), /width:\s*100%/);
  assert.match(block('.icor-sqlv-tile .icor-sqlv-table td.icor-sqlv-num'), /max-width:\s*none/);
  assert.match(block('.icor-sqlv-tile .icor-sqlv-table td.icor-sqlv-num'), /text-overflow:\s*clip/);
});

test('headings are marked English so a browser that can hyphenate does; a long text cell carries its whole text on hover', () => {
  const el = new obsidian.Modal({}).contentEl;
  lib.renderResultTable(el, { columns: ['Product', 'Units'], rows: [['Banana bread slice', 12], ['Tea', 3]] }, {});
  const all = [...walkEl(el)];
  const ths = all.filter((e) => e.tagName === 'TH' || e.tag === 'th');
  assert.ok(ths.length === 2 && ths.every((t) => t.getAttribute('lang') === 'en'));
  const tds = all.filter((e) => e.tagName === 'TD' || e.tag === 'td');
  assert.equal(tds[0].getAttribute('title'), 'Banana bread slice');
  assert.equal(tds[2].getAttribute('title'), null, 'a short word needs none');
});
