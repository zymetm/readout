/* A TEXT WIDGET TAKES A HINT AND A FOOTNOTE TOO.
 *
 * The text widget and the hint and footnote were built apart; together a
 * text widget's footnote must be read, drawn and kept on save like any
 * other widget's. Every value here is invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin } from './harness.mjs';

const { lib, obsidian } = loadPlugin();

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byClass = (root, cls) => [...walkEl(root)].filter((e) => e.classSet && e.classSet.has(cls));

test('a text widget keeps its hint and footnote through the spec, the drawing and a save', () => {
  const r = lib.parseDashboardSpec(JSON.stringify({ id: 'n', title: 'N', database: '07 Data/x.db', tiles: [{ title: 'About', viz: 'text', sql: 'SELECT 1', hint: 'live', footnote: 'More on the other page.' }] }));
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.spec.tiles[0].footnote, 'More on the other page.');
  const el = new obsidian.Modal({}).contentEl;
  lib.renderTile(el, r.spec.tiles[0], { columns: ['t'], rows: [['Hello']] }, {});
  assert.equal(byClass(el, 'icor-sqlv-tile-footnote')[0].textContent, 'More on the other page.');
  assert.equal(byClass(el, 'icor-sqlv-tile-hint')[0].textContent, 'live');
  const back = JSON.parse(lib.specToJson(r.spec)).tiles[0];
  assert.equal(back.footnote, 'More on the other page.');
  assert.equal(back.hint, 'live');
  const bad = lib.parseDashboardSpec(JSON.stringify({ id: 'n', title: 'N', tiles: [{ viz: 'text', text: 'a', footnote: '' }] }));
  assert.match(bad.reason, /"footnote" must be text/);
});

test('editing a widget in the form keeps its hint and footnote', () => {
  const kept = lib.keepUneditedKeys({ viz: 'line', title: 'New' }, { viz: 'line', hint: 'h', footnote: 'f' });
  assert.equal(kept.hint, 'h');
  assert.equal(kept.footnote, 'f');
});
