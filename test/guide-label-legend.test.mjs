/* A REFERENCE LINE'S LABEL LIVES IN THE LEGEND, NOT ON THE BARS.
 *
 * A labelled reference line ("refLines": [{"y": 50, "label": "goal"}])
 * wrote its label at the right end of the line, inside the plot. On a bar
 * or combo chart the bars drew over it, so the words sat half hidden. The
 * label now joins the legend under the chart, with a short dashed chip in
 * the line's colour, and the plot carries only the line. These gates pin
 * it: no label text in the drawing; one legend entry per labelled line;
 * a one-series chart gets a legend for its guide alone; an unlabelled line
 * adds nothing. Every value here is invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadPlugin } from './harness.mjs';

const { lib, obsidian } = loadPlugin();

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byTag = (root, tag) => [...walkEl(root)].filter((e) => e.tagName === tag.toUpperCase());
const byAttrClass = (root, cls) => [...walkEl(root)].filter((e) => e.getAttribute && e.getAttribute('class') === cls);
const byClass = (root, cls) => [...walkEl(root)].filter((e) => e.classSet && e.classSet.has(cls));
const freshEl = () => new obsidian.Modal({}).contentEl;
const parse = (tile) => lib.parseDashboardSpec(JSON.stringify({ id: 'gl', title: 'Guides', database: '07 Databases/x.db', tiles: [tile] }));
const TABLE = { columns: ['day', 'a', 'b', 'kcal'], rows: [['01', 20, 10, 1500], ['02', 35, 5, 1800], ['03', 30, 25, 1200]] };

function draw(tile) {
  const el = freshEl();
  const parsed = parse(Object.assign({ title: 'T', sql: 'SELECT 1' }, tile));
  assert.ok(parsed.ok, parsed.reason);
  lib.renderTile(el, parsed.spec.tiles[0], TABLE, {});
  return el;
}
const legendNames = (el) => byClass(el, 'icor-sqlv-legend-name').map((n) => n.textContent);
const guideChips = (el) => byClass(el, 'icor-sqlv-legend-chip').filter((c) => c.classSet.has('is-guide'));
const svgText = (el) => byTag(el, 'text').map((t) => t.textContent);

const combo = {
  viz: 'combo', x: 'day', stack: true,
  series: [{ column: 'a', kind: 'bar', label: 'Lunch' }, { column: 'b', kind: 'bar', label: 'Dinner' }, { column: 'kcal', kind: 'line', axis: 'right', label: 'Calories' }],
  refLines: [{ y: 40, color: '#c9c4b8', dash: '4 3', label: '~40g/day center' }],
};

test('on a combo chart the guide label is in the legend, never written over the bars', () => {
  const el = draw(combo);
  assert.equal(byAttrClass(el, 'icor-sqlv-refline').length, 1, 'the line itself is still drawn');
  assert.ok(!svgText(el).includes('~40g/day center'), 'no label text inside the drawing');
  assert.deepEqual(legendNames(el), ['Lunch', 'Dinner', 'Calories', '~40g/day center']);
  const [chip] = guideChips(el);
  assert.ok(chip, 'the guide gets a dashed chip');
  assert.equal(chip.style['border-top-color'], '#c9c4b8', 'in the line colour');
});

test('a bar chart and a line chart do the same', () => {
  for (const viz of ['bar', 'line']) {
    const el = draw({ viz, x: 'day', y: ['a', 'b'], refLines: [{ y: 30, label: 'goal' }] });
    assert.ok(!svgText(el).includes('goal'), viz + ': no label text inside the drawing');
    assert.deepEqual(legendNames(el).slice(-1), ['goal'], viz + ': the label closes the legend');
    assert.equal(guideChips(el).length, 1);
    assert.equal(guideChips(el)[0].style['border-top-color'], undefined, viz + ': no colour, the stylesheet ink');
  }
});

test('a one-series chart gets a legend for its guide alone; no label, no legend', () => {
  const one = draw({ viz: 'bar', x: 'day', y: 'a', refLines: [{ y: 30, label: 'goal' }] });
  assert.deepEqual(legendNames(one), ['goal']);
  const plain = draw({ viz: 'bar', x: 'day', y: 'a', refLines: [{ y: 30 }] });
  assert.equal(byClass(plain, 'icor-sqlv-legend').length, 0, 'an unlabelled line adds nothing');
});

test('the stylesheet draws the guide chip as a short dashed line', () => {
  const css = fs.readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
  assert.match(css, /\.icor-sqlv-legend-chip\.is-guide \{[^}]*border-top: 1px dashed/);
});
