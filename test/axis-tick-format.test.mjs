/* AXIS LABELS CAN CARRY THEIR UNIT.
 *
 * A chart's y labels were bare numbers: a sleep chart read 12, 8, 4 and
 * a step chart 8,000, 6,000, where the reader wants 12h and 8k. Two
 * opt-in fields per axis fix that: "yTickSuffix" puts short text after
 * every left label ("h", "%"), "yTickCompact" writes thousands as "k"
 * (8,000 as 8k); a combo chart's right axis takes "y2TickSuffix" and
 * "y2TickCompact". Absent, the labels are as before. These gates pin it:
 * the labels read as asked on a line, bar and combo chart; the left margin
 * is sized for the written labels; the spec refuses what makes no sense;
 * the fields survive the file and an edit from the form. Every value here
 * is invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin } from './harness.mjs';

const { lib, obsidian } = loadPlugin();

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byTag = (root, tag) => [...walkEl(root)].filter((e) => e.tagName === tag.toUpperCase());
const freshEl = () => new obsidian.Modal({}).contentEl;
const parse = (tile) => lib.parseDashboardSpec(JSON.stringify({ id: 'tf', title: 'Ticks', database: '07 Data/x.db', tiles: [tile] }));
const ticks = (el, anchor) => byTag(el, 'text').filter((t) => t.getAttribute('class') === 'icor-sqlv-tick' && t.getAttribute('text-anchor') === anchor).map((t) => t.textContent);
const TABLE = { columns: ['day', 'hours', 'steps', 'cv'], rows: [['01', 7, 4000, 30], ['02', 8.5, 8000, 25], ['03', 6, 6000, 40]] };

function draw(tile) {
  const parsed = parse(Object.assign({ title: 'T', sql: 'SELECT 1', x: 'day' }, tile));
  assert.ok(parsed.ok, parsed.reason);
  const el = freshEl();
  lib.renderTile(el, parsed.spec.tiles[0], TABLE, {});
  return el;
}

test('THE LIMIT: without the fields the labels are bare numbers, as before', () => {
  assert.deepEqual(ticks(draw({ viz: 'bar', y: 'hours', yMin: 0, yMax: 12, yTicks: [0, 4, 8, 12] }), 'end'), ['0', '4', '8', '12']);
});

test('a suffix follows every left label; compact writes thousands as k', () => {
  assert.deepEqual(ticks(draw({ viz: 'bar', y: 'hours', yMin: 0, yMax: 12, yTicks: [0, 4, 8, 12], yTickSuffix: 'h' }), 'end'), ['0h', '4h', '8h', '12h']);
  assert.deepEqual(ticks(draw({ viz: 'line', y: 'steps', yMin: 0, yMax: 8000, yTicks: [0, 1500, 8000], yTickCompact: true }), 'end'), ['0', '1.5k', '8k']);
});

test('a combo chart labels each axis its own way', () => {
  const el = draw({
    viz: 'combo', yMin: 0, yMax: 12, yTicks: [0, 4, 8, 12], yTickSuffix: 'h', y2Min: 0, y2Max: 60, y2Ticks: [0, 30, 60], y2TickSuffix: '%',
    series: [{ column: 'hours', kind: 'bar' }, { column: 'cv', kind: 'line', axis: 'right' }],
  });
  assert.deepEqual(ticks(el, 'end'), ['0h', '4h', '8h', '12h']);
  assert.deepEqual(ticks(el, 'start'), ['0%', '30%', '60%']);
  const steps = draw({
    viz: 'combo', yMin: 0, yMax: 8000, yTicks: [0, 4000, 8000], yTickCompact: true, y2Min: 0, y2Max: 2000, y2Ticks: [0, 2000], y2TickCompact: true,
    series: [{ column: 'steps', kind: 'bar' }, { column: 'cv', kind: 'line', axis: 'right' }],
  });
  assert.deepEqual(ticks(steps, 'end'), ['0', '4k', '8k']);
  assert.deepEqual(ticks(steps, 'start'), ['0', '2k']);
});

test('the left margin is sized for the labels as written', () => {
  const bare = lib.chartLayout(640, 260, 0, 8000, true, { yMin: 0, yMax: 8000, yTicks: [0, 8000] });
  const compact = lib.chartLayout(640, 260, 0, 8000, true, { yMin: 0, yMax: 8000, yTicks: [0, 8000], yTickCompact: true });
  assert.ok(compact.left < bare.left, '"8k" needs less room than "8,000"');
});

test('the spec names what is wrong, in plain words', () => {
  for (const [extra, re] of [
    [{ viz: 'bar', y: 'hours', yTickSuffix: 7 }, /"yTickSuffix" must be short text/],
    [{ viz: 'bar', y: 'hours', yTickSuffix: 'hours!!' }, /"yTickSuffix" must be short text/],
    [{ viz: 'bar', y: 'hours', yTickCompact: 'yes' }, /"yTickCompact" must be true or false/],
    [{ viz: 'combo', series: [{ column: 'hours', kind: 'bar' }], y2TickSuffix: 3 }, /"y2TickSuffix" must be short text/],
    [{ viz: 'table', yTickSuffix: 'h' }, /only works on a line, bar, combo or scatter chart/],
  ]) {
    const r = parse(Object.assign({ title: 'T', sql: 'SELECT 1', x: 'day' }, extra));
    assert.equal(r.ok, false, JSON.stringify(extra));
    assert.match(r.reason, re);
  }
});

test('the fields survive the spec file and an edit from the form', () => {
  const tile = {
    title: 'T', sql: 'SELECT 1', x: 'day', viz: 'combo', yTickSuffix: 'h', yTickCompact: true, y2TickSuffix: '%', y2TickCompact: true,
    series: [{ column: 'hours', kind: 'bar' }, { column: 'cv', kind: 'line', axis: 'right' }],
  };
  const back = JSON.parse(lib.specToJson(parse(tile).spec)).tiles[0];
  assert.equal(back.yTickSuffix, 'h');
  assert.equal(back.yTickCompact, true);
  assert.equal(back.y2TickSuffix, '%');
  assert.equal(back.y2TickCompact, true);
  const bar = parse({ title: 'B', sql: 'SELECT 1', x: 'day', y: 'hours', viz: 'bar', yTickSuffix: 'h' }).spec.tiles[0];
  const kept = lib.keepUneditedKeys({ title: 'B', viz: 'bar', sql: 'SELECT 1' }, bar);
  assert.equal(kept.yTickSuffix, undefined, 'the form has its own axis fields now (form-every-widget), so nothing is kept behind its back');
  assert.equal(JSON.stringify(JSON.parse(lib.specToJson(parse({ title: 'B', sql: 'SELECT 1', x: 'day', y: 'hours', viz: 'bar' }).spec)).tiles[0]).includes('Tick'), false, 'unset stays out of the file');
});
