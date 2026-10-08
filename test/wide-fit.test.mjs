/* WIDGETS THAT FIT THEIR TILE, WIDE AND NARROW (1.0.3).
 *
 * A real 13-widget dashboard showed labels cut to a letter or two beside
 * empty space, columns pushed off a tile and titles cut mid-word. These
 * gates pin the fixes in the stylesheet and in what the plugin draws, one
 * section per fix.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadPlugin } from './harness.mjs';

const raw = fs.readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
const { lib, obsidian } = loadPlugin();

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byClass = (root, cls) => [...walkEl(root)].filter((e) => e.classSet && e.classSet.has(cls));
const freshEl = () => new obsidian.Modal({}).contentEl;

/* The body of the first rule whose selector is exactly `selector`. */
function rule(selector) {
  const at = css.split('\n').findIndex((l) => l.startsWith(selector + ' {'));
  assert.ok(at >= 0, selector + ' has a rule');
  const from = css.split('\n').slice(at).join('\n');
  return from.slice(from.indexOf('{') + 1, from.indexOf('}'));
}

/* ------------------------------------------------ 1. the pie legend -- */

test('the ring leaves the legend room: it never takes more than 45% of the width', () => {
  assert.match(rule('.icor-sqlv-pie-svg'), /max-width:\s*45%/);
});

test('a legend name keeps its own width beside its numbers and gives way only when it must', () => {
  assert.match(rule('.icor-sqlv-pie-legend .icor-sqlv-legend-name'), /flex:\s*0 1 auto/);
  assert.match(rule('.icor-sqlv-pie-legend .icor-sqlv-legend-item'), /max-width:\s*100%/);
});

test('a tile too narrow for an 8 character name stacks the legend under the ring', () => {
  assert.match(rule('.icor-sqlv-tile-body:has(> .icor-sqlv-pie)'), /container-type:\s*inline-size/);
  const m = /@container \(max-width:\s*(\d+)px\)\s*\{([\s\S]*?\n\})/.exec(css);
  assert.ok(m, 'a container rule for the pie');
  assert.ok(Number(m[1]) >= 300, 'it stacks while a name would still fall under 8 characters');
  assert.match(m[2], /\.icor-sqlv-pie\s*\{[^}]*flex-direction:\s*column/);
  assert.match(m[2], /\.icor-sqlv-pie-legend\s*\{[^}]*align-self:\s*stretch/);
});

test('every legend name carries its full text as a tooltip', () => {
  const el = freshEl();
  const table = { columns: ['status', 'n'], rows: [['Never played, not even once', 121], ['Played', 9]] };
  lib.renderTile(el, { viz: 'pie', x: 'status', y: 'n' }, table, {});
  const names = byClass(el, 'icor-sqlv-legend-name');
  assert.equal(names.length, 2);
  assert.equal(names[0].getAttribute('title'), 'Never played, not even once');
  assert.equal(names[1].getAttribute('title'), 'Played');
});

/* -------------------------------- 2. bullet labels and x axis labels -- */

test('a bullet label column is as wide as the longest label, up to 45% of the tile', () => {
  assert.match(rule('.icor-sqlv-bullet-rows'), /grid-template-columns:\s*fit-content\(45%\)/);
});

test('a long bullet label wraps to two lines before it is cut', () => {
  const body = rule('.icor-sqlv-bullet-label');
  assert.match(body, /white-space:\s*normal/);
  assert.match(body, /-webkit-line-clamp:\s*2/);
});

test('an x axis label is never sliced: it is drawn whole or not at all', () => {
  const labels = ['before 2015', '2015', '2016', '2017'];
  const L = lib.chartLayout(600, 260, 0, 30, true);
  const plan = lib.xLabelPlan(L, labels, (i) => L.left + (i / 3) * L.plotW);
  assert.ok(plan.length >= 1);
  assert.equal(plan[0].text, 'before 2015');
  const longOnes = ['A rather long category name', 'Another long category name', 'Third long category name'];
  const narrow = lib.chartLayout(300, 200, 0, 30, true);
  for (const p of lib.xLabelPlan(narrow, longOnes, (i) => narrow.left + (i / 2) * narrow.plotW)) {
    assert.ok(longOnes.includes(p.text), 'drawn whole: ' + p.text);
  }
});
