/* A BULLET CHART: ACTUAL AGAINST TARGET, ON A SCALE SHADED IN BANDS.
 *
 * A stat shows one number with a meter; a goal tracker wants several
 * numbers each against its own target, with what counts as good written
 * once. "viz": "bullet" draws, for each row of the query, a bar for the
 * actual value ("y") and a mark for its target ("target"), on one scale
 * shared by all the bars, shaded behind in bands by the value levels of
 * "ranges". "x" labels each bar; "scaleMin" and "scaleMax" fix the ends of
 * the scale. These gates pin the rules: the scale, the bands and the bar
 * and mark positions are right on numbers worked out by hand; the first
 * range wins where ranges overlap; a bar with no number says "no data"
 * and is never drawn at zero; one scale serves every bar; the spec refuses
 * what makes no sense, in plain words; it survives the spec file; the
 * edit form builds and reads back every setting. Every value here is
 * invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, unwrap } from './harness.mjs';
import { byLabel, makeForm, asFileTile } from './form-kit.mjs';

const { lib, obsidian } = loadPlugin();

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byClass = (root, cls) => [...walkEl(root)].filter((e) => e.classSet && e.classSet.has(cls));
const freshEl = () => new obsidian.Modal({}).contentEl;
const parse = (tile) => lib.parseDashboardSpec(JSON.stringify({ id: 'bl', title: 'Bullets', database: '07 Data/x.db', tiles: [tile] }));
const RANGES = [{ low: 80, level: 'Hot', label: 'busy' }, { low: 40, high: 79, level: 'Mild', label: 'steady' }, { level: 'Cool', label: 'quiet' }];
const LEVELS = [{ id: 'cool', name: 'Cool', color: '#3366cc' }, { id: 'mild', name: 'Mild', color: '#88aa44' }, { id: 'hot', name: 'Hot', color: '#cc5533' }];
const tileOf = (extra) => Object.assign({ title: 'Walks against plan', viz: 'bullet', x: 'who', y: 'walks', target: 'plan', unit: 'walks', ranges: RANGES, sql: 'SELECT 1' }, extra);
const TABLE = { columns: ['who', 'walks', 'plan'], rows: [['Ana', 50, 60], ['Ben', 100, 80], ['Cy', null, 40], ['Di', 25, null]] };

function draw(tile, table, extras) {
  const el = freshEl();
  lib.renderTile(el, parse(tile).spec.tiles[0], table || TABLE, extras || { levels: LEVELS });
  return el;
}
const tracks = (el) => byClass(el, 'icor-sqlv-bullet-track');
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, a + ' is not ' + b);

test('THE LIMIT: no other widget draws a bullet track', () => {
  const el = freshEl();
  lib.renderTile(el, { viz: 'segments', x: 'who', y: ['walks'] }, TABLE, {});
  assert.equal(tracks(el).length, 0);
});

/* ------------------------------------------------------------ the rows -- */

test('the bars are the rows in the query\'s order, up to twelve; what is not a number is not zero', () => {
  const rows = lib.bulletRowsOf(TABLE, { x: 'who', y: ['walks'], target: 'plan' });
  assert.deepEqual(unwrap(rows.map((r) => r.label)), ['Ana', 'Ben', 'Cy', 'Di']);
  const word = (v) => (Number.isNaN(v) ? 'none' : v);
  assert.deepEqual(unwrap(rows.map((r) => [word(r.actual), word(r.target)])), [[50, 60], [100, 80], ['none', 40], [25, 'none']], 'a missing actual or target is NaN, never 0');
  const many = { columns: ['who', 'walks'], rows: Array.from({ length: 30 }, (_, i) => ['p' + i, i]) };
  assert.equal(lib.bulletRowsOf(many, { x: 'who', y: ['walks'] }).length, 12);
  const bare = lib.bulletRowsOf(TABLE, { y: ['walks'] });
  assert.ok(bare.every((r) => r.label === '' && Number.isNaN(r.target)), 'no x, no target: bare bars');
  assert.deepEqual(unwrap(lib.bulletRowsOf(TABLE, { x: 'who', y: ['gone'] })), [], 'a column that is not there');
});

/* ----------------------------------------------------------- the scale -- */

test('the scale runs from zero to the largest actual, target or range end, on a round number', () => {
  const rows = lib.bulletRowsOf(TABLE, { x: 'who', y: ['walks'], target: 'plan' });
  assert.deepEqual(unwrap(lib.bulletScaleOf(rows, { ranges: [] })), { min: 0, max: 100 }, 'the largest is 100');
  assert.deepEqual(unwrap(lib.bulletScaleOf(rows, { ranges: [{ low: 130, level: 'Hot' }] })), { min: 0, max: 150 }, 'a range end counts');
  assert.deepEqual(unwrap(lib.bulletScaleOf([{ actual: 7.2, target: 8 }], {})), { min: 0, max: 8 });
  assert.deepEqual(unwrap(lib.bulletScaleOf([{ actual: 7.2, target: 8.5 }], {})), { min: 0, max: 10 });
  assert.deepEqual(unwrap(lib.bulletScaleOf([{ actual: -30, target: 20 }], {})), { min: -30, max: 20 }, 'below zero: from the lowest');
});

test('the tile\'s own ends win, and a scale can never be empty', () => {
  const rows = [{ actual: 40, target: 60 }];
  assert.deepEqual(unwrap(lib.bulletScaleOf(rows, { scaleMin: 10, scaleMax: 70 })), { min: 10, max: 70 });
  assert.deepEqual(unwrap(lib.bulletScaleOf(rows, { scaleMax: 200 })), { min: 0, max: 200 });
  assert.deepEqual(unwrap(lib.bulletScaleOf([{ actual: NaN, target: NaN }], {})), { min: 0, max: 1 }, 'nothing to measure');
  const flat = lib.bulletScaleOf([{ actual: 5, target: 5 }], { scaleMin: 5 });
  assert.ok(flat.max > flat.min);
});

test('the bands cut the scale at every range edge, and the first range that holds a piece colours it', () => {
  const bands = lib.bulletBands({ ranges: RANGES }, 0, 100);
  assert.deepEqual(unwrap(bands.map((b) => [b.from, b.to, b.range && b.range.label])), [[0, 40, 'quiet'], [40, 80, 'steady'], [80, 100, 'busy']], 'ranges written 79 and 80: the one-unit piece between them joins the band before it');
  const gap = lib.bulletBands({ ranges: [{ high: 20, level: 'Alert', label: 'low' }, { low: 60, level: 'Good', label: 'high' }] }, 0, 100);
  assert.deepEqual(unwrap(gap.map((b) => [b.from, b.to, b.range && b.range.label])), [[0, 20, 'low'], [20, 60, null], [60, 100, 'high']], 'a real gap stays plain');
  const first = lib.bulletBands({ ranges: [{ low: 1, high: 50, level: 'Alert', label: 'x' }, { low: 51, level: 'Good', label: 'y' }] }, 0, 100);
  assert.deepEqual(unwrap(first.map((b) => [b.from, b.to])), [[0, 51], [51, 100]], 'the unit before the first range joins the band after it, the unit between two joins the one before');
  const overlap = lib.bulletBands({ ranges: [{ low: 0, high: 60, level: 'Good', label: 'first' }, { low: 40, high: 100, level: 'Watch', label: 'second' }] }, 0, 100);
  assert.deepEqual(unwrap(overlap.map((b) => [b.from, b.to, b.range && b.range.label])), [[0, 40, 'first'], [40, 60, 'first'], [60, 100, 'second']], 'the first range wins where they overlap');
  const none = lib.bulletBands({}, 0, 100);
  assert.deepEqual(unwrap(none.map((b) => [b.from, b.to, b.range])), [[0, 100, null]], 'no ranges: one plain piece');
  const fixed = lib.bulletBands({ ranges: RANGES }, 50, 90);
  assert.deepEqual(unwrap(fixed.map((b) => [b.from, b.to])), [[50, 79], [79, 80], [80, 90]], 'edges outside the scale are not cuts; a piece over a fiftieth of the scale stays');
});

/* ---------------------------------------------------------- the picture -- */

test('each bar has a track, a bar as long as its actual share of the scale and a mark at its target', () => {
  const el = draw(tileOf());
  assert.equal(tracks(el).length, 4);
  const widths = byClass(el, 'icor-sqlv-bullet-actual').map((a) => a.style.width);
  assert.deepEqual(widths, ['50.000%', '100.000%', '25.000%'], 'the row with no actual draws no bar');
  const marks = byClass(el, 'icor-sqlv-bullet-target').map((a) => a.style.left);
  assert.deepEqual(marks, ['60.000%', '80.000%', '40.000%'], 'the row with no target draws no mark');
});

test('one scale serves every bar: the same number is the same length in every row', () => {
  const el = draw(tileOf(), { columns: ['who', 'walks', 'plan'], rows: [['Ana', 50, 80], ['Ben', 50, 40]] });
  const widths = byClass(el, 'icor-sqlv-bullet-actual').map((a) => a.style.width);
  assert.equal(widths[0], widths[1]);
});

test('a value past the scale stops at its end; it is never drawn outside the track', () => {
  const el = draw(tileOf({ scaleMax: 60 }));
  assert.deepEqual(byClass(el, 'icor-sqlv-bullet-actual').map((a) => a.style.width), ['83.333%', '100.000%', '41.667%']);
  assert.deepEqual(byClass(el, 'icor-sqlv-bullet-target').map((a) => a.style.left), ['100.000%', '100.000%', '66.667%']);
});

test('the bands behind a track are the ranges, in their level colours', () => {
  const el = draw(tileOf());
  const bands = byClass(tracks(el)[0], 'icor-sqlv-bullet-band');
  assert.deepEqual(bands.map((b) => [b.style.left, b.style.width, b.style.background]), [
    ['0.000%', '40.000%', '#3366cc'],
    ['40.000%', '40.000%', '#88aa44'],
    ['80.000%', '20.000%', '#cc5533'],
  ]);
  const unknown = byClass(tracks(draw(tileOf(), TABLE, { levels: [] }))[0], 'icor-sqlv-bullet-band');
  assert.ok(unknown.length && unknown.every((b) => b.classSet.has('is-neutral') && !b.style.background), 'a level the settings do not know is plain');
  assert.equal(byClass(tracks(draw(tileOf({ ranges: undefined })))[0], 'icor-sqlv-bullet-band').length, 0, 'no ranges, no bands');
});

test('a bar says its numbers in words, on the track and for a screen reader, with its level and its unit', () => {
  const el = draw(tileOf());
  const first = tracks(el)[0];
  assert.equal(first.getAttribute('title'), 'Ana: 50 walks of 60 walks · steady');
  assert.equal(first.getAttribute('aria-label'), 'Ana: 50 walks of 60 walks · steady');
  assert.equal(first.getAttribute('role'), 'img');
  assert.deepEqual(byClass(el, 'icor-sqlv-bullet-value').map((v) => v.textContent), ['50 / 60 walks', '100 / 80 walks', 'no data', '25 walks']);
  assert.equal(tracks(el)[2].getAttribute('title'), 'Cy: no data');
  assert.deepEqual(byClass(el, 'icor-sqlv-bullet-label').map((l) => l.textContent), ['Ana', 'Ben', 'Cy', 'Di']);
  assert.equal(byClass(draw(tileOf({ unit: '%' })), 'icor-sqlv-bullet-value')[0].textContent, '50 / 60%');
});

test('without labels the bars fill the width; the legend names every range and the target mark', () => {
  const bare = draw(tileOf({ x: undefined }));
  assert.equal(byClass(bare, 'icor-sqlv-bullet-label').length, 0);
  assert.ok(byClass(bare, 'icor-sqlv-bullet-rows')[0].classSet.has('is-unlabelled'));
  const legend = byClass(draw(tileOf()), 'icor-sqlv-bullet-legend')[0];
  assert.deepEqual(byClass(legend, 'icor-sqlv-legend-name').map((n) => n.textContent), ['busy', 'steady', 'quiet', 'target']);
  const noTarget = byClass(draw(tileOf({ target: undefined })), 'icor-sqlv-bullet-legend')[0];
  assert.deepEqual(byClass(noTarget, 'icor-sqlv-legend-name').map((n) => n.textContent), ['busy', 'steady', 'quiet']);
});

test('nothing to draw says so', () => {
  const el = draw(tileOf(), { columns: ['who', 'walks'], rows: [] });
  assert.equal(byClass(el, 'icor-sqlv-empty')[0].textContent, 'No rows to draw.');
  assert.equal(tracks(el).length, 0);
});

/* ------------------------------------------------------------ the spec -- */

test('the spec keeps a bullet chart and names what is wrong, in plain words', () => {
  const ok = parse(tileOf({ scaleMin: 0, scaleMax: 120, levelColors: { Hot: '#ff0000' } }));
  assert.equal(ok.ok, true, ok.reason);
  const t = ok.spec.tiles[0];
  assert.deepEqual([t.x, t.y[0], t.target, t.scaleMin, t.scaleMax, t.ranges.length, t.levelColors.Hot], ['who', 'walks', 'plan', 0, 120, 3, '#ff0000']);
  assert.equal(parse(tileOf({ x: undefined, target: undefined, ranges: undefined })).ok, true, 'a bare bullet needs only y');
  const bad = [
    [tileOf({ y: undefined }), /a bullet chart needs one "y" column/],
    [tileOf({ y: ['a', 'b'] }), /a bullet chart needs one "y" column/],
    [tileOf({ x: 7 }), /"x" must be the name of the column that labels each bar/],
    [tileOf({ target: '' }), /"target" must be the name of the column/],
    [tileOf({ target: 'walks' }), /"target" must be a different column from "y"/],
    [tileOf({ scaleMin: 'a' }), /"scaleMin" must be a number/],
    [tileOf({ scaleMax: null }), /"scaleMax" must be a number/],
    [tileOf({ scaleMin: 10, scaleMax: 10 }), /"scaleMin" \(10\) must be below "scaleMax" \(10\)/],
    [tileOf({ headerDelta: true }), /"headerDelta" only works on a line or bar chart/],
    [{ title: 'L', viz: 'line', x: 'a', y: 'b', sql: 'SELECT 1', target: 'c' }, /"target" only works on a bullet chart/],
    [{ title: 'L', viz: 'bar', x: 'a', y: 'b', sql: 'SELECT 1', scaleMax: 5 }, /"scaleMax" only works on a bullet chart/],
    [{ title: 'Built', viz: 'bullet', source: { table: 't', metric: 'v', agg: 'sum', timeColumn: 'd' } }, /use an SQL tile for a bullet chart/],
  ];
  for (const [tile, re] of bad) {
    const r = parse(tile);
    assert.equal(r.ok, false, JSON.stringify(tile));
    assert.match(r.reason, re);
    assert.match(r.reason, /^Tile 1: /);
  }
});

test('a bullet chart survives the spec file', () => {
  const json = lib.specToJson(parse(tileOf({ scaleMin: 0, scaleMax: 120, levelColors: { Hot: '#ff0000' } })).spec);
  const back = JSON.parse(json).tiles[0];
  assert.deepEqual([back.viz, back.x, back.y, back.target, back.scaleMin, back.scaleMax], ['bullet', 'who', 'walks', 'plan', 0, 120]);
  assert.equal(back.ranges.length, 3);
  assert.equal(lib.parseDashboardSpec(json).ok, true);
  assert.equal(lib.defaultSpanFor({ viz: 'bullet' }).w, 3);
});

/* ------------------------------------------------------------ the form -- */

const TARGET = {
  title: 'Walks against plan', viz: 'bullet', unit: 'walks', hint: 'this week',
  ranges: [{ low: 80, level: 'Good', label: 'busy' }, { low: 40, high: 79, level: 'Watch' }, { level: 'Alert', label: 'quiet' }],
  levelColors: { Watch: '#a08040' },
  sql: 'SELECT who, walks, plan FROM goals', x: 'who', y: 'walks', target: 'plan', scaleMin: 0, scaleMax: 120,
};

test('a bullet chart built from a blank widget in the form matches the hand-written one field for field', async () => {
  const { form, spec, lib: l } = await makeForm(null);
  form.open();
  Object.assign(form.state, { mode: 'sql', sqlText: TARGET.sql, viz: 'bullet', x: '', y: 'walks', title: 'Walks against plan', unit: 'walks', sizeKey: 'wide' });
  form.renderForm();
  await form.runPreview();
  for (const label of ['Label column', 'Actual value column', 'Target column']) assert.equal(byLabel(form.formEl, label).tagName, 'SELECT', label + ' is a picker');
  assert.equal(byLabel(form.formEl, 'Row labels column'), null, 'no heatmap fields on a bullet chart');
  Object.assign(form.state, { x: 'who', y: 'walks', bulletTarget: 'plan', scaleMin: '0', scaleMax: '120', hint: 'this week' });
  form.state.ranges = [{ low: '80', high: '', level: 'Good', label: 'busy' }, { low: '40', high: '79', level: 'Watch', label: '' }, { low: '', high: '', level: 'Alert', label: 'quiet' }];
  form.state.levelColors = { Watch: '#a08040' };
  form.touch();
  await form.runPreview();
  assert.equal(form.previewState, 'ok', form.previewError);
  assert.ok(byClass(form.previewEl, 'icor-sqlv-bullet-track').length, 'the preview draws the bars');
  await form.save();
  const want = l.parseDashboardSpec(JSON.stringify({ id: 'x', title: 'X', database: '07 Data/shop.db', tiles: [TARGET] })).spec.tiles[0];
  assert.deepEqual(unwrap(asFileTile(l, spec.tiles[0])), unwrap(asFileTile(l, want)));
});

test('a bullet chart reads back into the form, and a save keeps every setting', async () => {
  const parsed = lib.parseDashboardSpec(JSON.stringify({ id: 'x', title: 'X', database: '07 Data/shop.db', tiles: [TARGET] })).spec.tiles[0];
  const { form, spec, lib: l } = await makeForm(parsed);
  form.open();
  assert.deepEqual([form.state.x, form.state.bulletTarget, form.state.scaleMin, form.state.scaleMax], ['who', 'plan', '0', '120']);
  assert.equal(lib.FORM_VIZ.has('bullet'), true);
  await form.runPreview();
  assert.equal(form.previewState, 'ok', form.previewError);
  assert.equal(form.dropNote.textContent, '', 'nothing is left out');
  await form.save();
  assert.deepEqual(unwrap(asFileTile(l, spec.tiles[0])), unwrap(asFileTile(l, parsed)));
});

test('changing a new widget to a bullet chart clears the placeholder label column; the form refuses bad input in plain words', async () => {
  const { form } = await makeForm(null);
  form.open();
  form.state.mode = 'sql';
  form.state.sqlText = 'SELECT * FROM goals';
  form.renderForm();
  assert.equal(form.state.x, 'x', 'the placeholder every new widget starts with');
  const select = byLabel(form.formEl, 'Chart type');
  select.value = 'bullet';
  for (const fn of select.handlers.change || []) fn({});
  assert.equal(form.state.viz, 'bullet');
  assert.equal(form.state.x, '', 'no label column until one is picked');
  Object.assign(form.state, { y: 'a, b' });
  assert.match(form.buildTile().reason, /A bullet chart needs one actual value column\./);
  Object.assign(form.state, { y: 'walks', scaleMax: 'big' });
  assert.match(form.buildTile().reason, /Scale: the highest value must be a number/);
});
