/* A SEGMENTS BAR'S PILL SITS ON ITS TITLE ROW.
 *
 * The level pill of a segments bar ("on target", "watch") sat in a footer
 * of its own under the legend, leaving a gap row in the tile. It now sits
 * at the right of the title row, the way a verdict chip heads a card. These
 * gates pin it: the pill is in the title row after the title, never in a
 * footer; with no level there is no title row, just the title; a hint
 * stays before the pill. Every value here is invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadPlugin } from './harness.mjs';

const { lib, obsidian } = loadPlugin();

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byClass = (root, cls) => [...walkEl(root)].filter((e) => e.classSet && e.classSet.has(cls));
const freshEl = () => new obsidian.Modal({}).contentEl;
const parse = (tile) => lib.parseDashboardSpec(JSON.stringify({ id: 'sp', title: 'Split', database: '07 Data/x.db', tiles: [tile] }));
const TABLE = { columns: ['state', 'pct', 'score'], rows: [['Idle', 20, 2], ['Busy', 80, 2]] };
const LEVELS = [{ id: 'good', name: 'Good', color: 'var(--color-green)' }];
const tileWith = (extra) => parse(Object.assign({
  title: 'Time per state', viz: 'segments', x: 'state', y: 'pct', unit: '%', sql: 'SELECT 1',
  rangeColumn: 'score', ranges: [{ low: 2, level: 'Good', label: 'on target' }, { level: 'Good', label: 'other' }],
}, extra)).spec.tiles[0];

function draw(tile) {
  const el = freshEl();
  lib.renderTile(el, tile, TABLE, { levels: LEVELS });
  return el;
}

test('the pill sits at the right of the title row, not in a footer', () => {
  const el = draw(tileWith({}));
  const [bar] = byClass(el, 'icor-sqlv-tile-titlebar');
  assert.ok(bar, 'a title row');
  const kids = bar.children.map((c) => [...c.classSet][0]);
  assert.deepEqual(kids, ['icor-sqlv-tile-title', 'icor-sqlv-level-pill']);
  assert.equal(bar.children[1].textContent, 'on target');
  assert.equal(byClass(el, 'icor-sqlv-stat-foot').length, 0, 'no footer row');
  assert.equal(byClass(el, 'icor-sqlv-level-pill').length, 1, 'one pill only');
});

test('no level, no title row: just the title', () => {
  const el = draw(parse({ title: 'Plain', viz: 'segments', x: 'state', y: 'pct', sql: 'SELECT 1' }).spec.tiles[0]);
  assert.equal(byClass(el, 'icor-sqlv-tile-titlebar').length, 0);
  assert.equal(byClass(el, 'icor-sqlv-tile-title').length, 1);
});

test('a hint stays between the title and the pill', () => {
  const el = draw(tileWith({ hint: '14 days' }));
  const [bar] = byClass(el, 'icor-sqlv-tile-titlebar');
  assert.deepEqual(bar.children.map((c) => [...c.classSet][0]), ['icor-sqlv-tile-title', 'icor-sqlv-tile-hint', 'icor-sqlv-level-pill']);
});

test('the stylesheet keeps the pill whole at the right of the row', () => {
  const css = fs.readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
  assert.match(css, /\.icor-sqlv-tile-titlebar > \.icor-sqlv-level-pill \{[^}]*flex: 0 0 auto;[^}]*margin-left: auto;/);
});
