/* A SCATTER CHART: TWO NUMBERS AGAINST EACH OTHER, ONE POINT PER ROW.
 *
 * A dashboard could chart a number over time or across groups, but not
 * one measure against another: spend against orders, sleep against mood.
 * "viz": "scatter" puts a point per query row at a number in "x" and a
 * number in "y", can colour the points by a column ("colorBy") and draw
 * the least-squares line through them ("trend"). The y axis, the guide
 * lines and the zones work as on a line chart; "xMin" and "xMax" fix the
 * ends of the number scale along the bottom. These gates pin the rules:
 * the line fit is right on known numbers; rows without two numbers are
 * left out, never drawn at zero; the colours, legend and tooltips follow
 * the data; the spec refuses what makes no sense, in plain words; it
 * survives the spec file; the edit form builds and reads back every
 * setting. Every value here is invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, unwrap } from './harness.mjs';
import { byLabel, makeForm, asFileTile } from './form-kit.mjs';

const { lib, obsidian } = loadPlugin();

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byClass = (root, cls) => [...walkEl(root)].filter((e) => e.classSet && e.classSet.has(cls));
/* The chart is SVG, which carries its class as an attribute. */
const byAttrClass = (root, cls) => [...walkEl(root)].filter((e) => e.getAttribute && e.getAttribute('class') === cls);
const freshEl = () => new obsidian.Modal({}).contentEl;
const parse = (tile) => lib.parseDashboardSpec(JSON.stringify({ id: 'sc', title: 'Scatter', database: '07 Data/x.db', tiles: [tile] }));
const tileOf = (extra) => Object.assign({ title: 'Orders against spend', viz: 'scatter', x: 'spend', y: 'orders', unit: 'orders', sql: 'SELECT 1' }, extra);
const TABLE = {
  columns: ['spend', 'orders', 'channel'],
  rows: [[10, 12, 'Web'], [20, 25, 'Web'], [30, 31, 'Shop'], [40, null, 'Web'], ['', 50, 'Shop'], [50, 61, 'Web'], [60, 70, null]],
};

function draw(tile, table) {
  const el = freshEl();
  lib.renderTile(el, parse(tile).spec.tiles[0], table || TABLE, {});
  return el;
}
const points = (el) => byAttrClass(el, 'icor-sqlv-point');
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, a + ' is not ' + b);

test('THE LIMIT: no other chart draws a point or a trend line', () => {
  const el = freshEl();
  lib.renderTile(el, { viz: 'line', x: 'spend', y: ['orders'] }, TABLE, {});
  assert.equal(points(el).length, 0);
  assert.equal(byAttrClass(el, 'icor-sqlv-trend').length, 0);
});

/* ------------------------------------------------------ the least squares -- */

test('the line fit is right on numbers worked out by hand', () => {
  const exact = lib.leastSquares([{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }]);
  near(exact.slope, 2); near(exact.intercept, 0); near(exact.r2, 1);
  /* x 1..4, y 2 4 5 8: slope 9.5 / 5, r squared 9.5 squared over (5 x 18.75). */
  const loose = lib.leastSquares([{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 5 }, { x: 4, y: 8 }]);
  near(loose.slope, 1.9); near(loose.intercept, 0); near(loose.r2, 90.25 / 93.75);
  const falling = lib.leastSquares([{ x: 0, y: 10 }, { x: 5, y: 5 }, { x: 10, y: 0 }]);
  near(falling.slope, -1); near(falling.intercept, 10);
  const flat = lib.leastSquares([{ x: 1, y: 7 }, { x: 2, y: 7 }, { x: 9, y: 7 }]);
  near(flat.slope, 0); near(flat.intercept, 7); near(flat.r2, 1);
});

test('no line stands for fewer than two points or when every x is the same', () => {
  assert.equal(lib.leastSquares([]), null);
  assert.equal(lib.leastSquares([{ x: 1, y: 1 }]), null);
  assert.equal(lib.leastSquares([{ x: 3, y: 1 }, { x: 3, y: 9 }]), null);
});

/* --------------------------------------------------------------- the points -- */

test('a row with no number in x or y is left out, never drawn at zero', () => {
  const data = lib.scatterOf(TABLE, { x: 'spend', y: ['orders'] });
  assert.deepEqual(unwrap(data.points.map((p) => [p.x, p.y])), [[10, 12], [20, 25], [30, 31], [50, 61], [60, 70]]);
  assert.deepEqual(unwrap(data.groups), []);
  const el = draw(tileOf());
  assert.equal(points(el).length, 5);
});

test('points sit where their numbers say: right for more x, up for more y', () => {
  const el = draw(tileOf());
  const at = points(el).map((p) => [Number(p.getAttribute('cx')), Number(p.getAttribute('cy'))]);
  for (let i = 1; i < at.length; i++) {
    assert.ok(at[i][0] > at[i - 1][0], 'x grows to the right');
    assert.ok(at[i][1] < at[i - 1][1], 'y grows upward (the pixel row falls)');
  }
});

test('every point says its numbers on hover, with its unit and its colour group', () => {
  const plain = points(draw(tileOf()))[1];
  assert.equal(plain.children[0].textContent, 'spend 20 · orders 25 orders');
  const coloured = points(draw(tileOf({ colorBy: 'channel' })))[2];
  assert.equal(coloured.children[0].textContent, 'spend 30 · orders 31 orders · Shop');
});

test('a row with nothing to draw says so; a table without the columns draws nothing', () => {
  const none = draw(tileOf(), { columns: ['spend', 'orders'], rows: [['', null], [null, 3]] });
  assert.equal(byClass(none, 'icor-sqlv-empty')[0].textContent, 'No numeric x and y values to draw.');
  const empty = draw(tileOf(), { columns: ['spend', 'orders'], rows: [] });
  assert.equal(byClass(empty, 'icor-sqlv-empty')[0].textContent, 'No rows to draw.');
  const wrong = draw(tileOf(), { columns: ['a', 'b'], rows: [[1, 2]] });
  assert.equal(byClass(wrong, 'icor-sqlv-empty')[0].textContent, 'No rows to draw.');
});

/* ------------------------------------------------------------- the colours -- */

test('"colorBy" gives each value its own colour, the commonest first, and names them in a legend', () => {
  const data = lib.scatterOf(TABLE, { x: 'spend', y: ['orders'], colorBy: 'channel' });
  assert.deepEqual(unwrap(data.groups), ['Web', 'Shop', 'no value'], 'Web has three points, the others one each; Shop comes first of the tie');
  assert.deepEqual(unwrap(data.points.map((p) => p.group)), [0, 0, 1, 0, 2]);
  const el = draw(tileOf({ colorBy: 'channel' }));
  assert.deepEqual(points(el).map((p) => p.getAttribute('fill')), ['var(--sqlv-series-2)', 'var(--sqlv-series-2)', 'var(--sqlv-series-3)', 'var(--sqlv-series-2)', 'var(--sqlv-series-4)']);
  assert.deepEqual(byClass(el, 'icor-sqlv-legend-name').map((n) => n.textContent), ['Web', 'Shop', 'no value']);
});

test('past five values the rest fold into Other, in the faint colour', () => {
  const rows = [];
  'ABCDEFG'.split('').forEach((name, i) => { for (let k = 0; k <= 6 - i; k++) rows.push([k + i, k * 2, name]); });
  const data = lib.scatterOf({ columns: ['spend', 'orders', 'channel'], rows }, { x: 'spend', y: ['orders'], colorBy: 'channel' });
  assert.deepEqual(unwrap(data.groups), ['A', 'B', 'C', 'D', 'Other']);
  assert.equal(data.points.filter((p) => p.group === 4).length, 3 + 2 + 1, 'E, F and G together');
  const el = draw(tileOf({ colorBy: 'channel' }), { columns: ['spend', 'orders', 'channel'], rows });
  assert.equal(points(el).filter((p) => p.getAttribute('fill') === 'var(--sqlv-fg-faint)').length, 6);
});

test('without "colorBy" the points are one colour: the theme ink, or the tile\'s own', () => {
  assert.ok(points(draw(tileOf())).every((p) => p.getAttribute('fill') === 'var(--sqlv-series-1)'));
  assert.ok(points(draw(tileOf({ color: '#ee7733' }))).every((p) => p.getAttribute('fill') === '#ee7733'));
  assert.equal(byClass(draw(tileOf()), 'icor-sqlv-legend').length, 0, 'one colour needs no legend');
});

/* --------------------------------------------------------------- the trend -- */

test('"trend" draws one dashed line across the data\'s x range, named in the legend and on hover', () => {
  assert.equal(byAttrClass(draw(tileOf()), 'icor-sqlv-trend').length, 0, 'no trend unless asked');
  const el = draw(tileOf({ trend: true }));
  const line = byAttrClass(el, 'icor-sqlv-trend')[0];
  assert.ok(line, 'the trend line');
  assert.ok(Number(line.getAttribute('x2')) > Number(line.getAttribute('x1')));
  assert.ok(Number(line.getAttribute('y2')) < Number(line.getAttribute('y1')), 'these points rise');
  assert.match(line.getAttribute('clip-path'), /^url\(#icor-sqlv-scatter-clip-\d+\)$/, 'cut at the plot edge, never bent to it');
  assert.match(line.children[0].textContent, /^Trend: orders changes by 1\.\d+ for each 1 of spend \(r² 1, 5 points\)$|^Trend: orders changes by 1\.\d+ for each 1 of spend \(r² 0\.\d+, 5 points\)$/);
  assert.deepEqual(byClass(el, 'icor-sqlv-legend-name').map((n) => n.textContent), ['Trend']);
  assert.ok(byClass(el, 'icor-sqlv-legend-chip').some((c) => c.classSet.has('is-guide')));
});

test('a trend with every x the same is not drawn', () => {
  const el = draw(tileOf({ trend: true }), { columns: ['spend', 'orders'], rows: [[5, 1], [5, 9]] });
  assert.equal(byAttrClass(el, 'icor-sqlv-trend').length, 0);
  assert.equal(points(el).length, 2);
});

/* --------------------------------------------------------- the scales and marks -- */

test('the x scale is the data on a round scale, or the tile\'s own ends, with the labels inside', () => {
  const auto = lib.scatterXScale(12, 87, {}, 500);
  assert.deepEqual([auto.min, auto.max], [0, 100]);
  assert.deepEqual(unwrap(auto.ticks), [0, 20, 40, 60, 80, 100]);
  const fixed = lib.scatterXScale(12, 87, { xMin: 10, xMax: 90 }, 500);
  assert.deepEqual([fixed.min, fixed.max], [10, 90]);
  assert.ok(fixed.ticks.every((v) => v >= 10 && v <= 90), 'no label outside the ends');
  const half = lib.scatterXScale(12, 87, { xMin: 10 }, 500);
  assert.deepEqual([half.min, half.max], [10, 100]);
  const same = lib.scatterXScale(5, 5, {}, 500);
  assert.ok(same.max > same.min, 'one x value still has a scale');
});

test('x labels are drawn along the bottom; the y axis, guide lines and zones work as on a line chart', () => {
  const el = draw(tileOf({ yMin: 0, yMax: 100, yTickSuffix: '!', refLines: [{ y: 50, label: 'goal', dash: '4 3' }], zones: [{ from: 60, to: 80, color: '#228833' }] }));
  const ticks = byAttrClass(el, 'icor-sqlv-tick').map((t) => t.textContent);
  assert.ok(ticks.includes('0!') && ticks.includes('100!'), 'the y labels follow the axis fields: ' + ticks.join(' '));
  assert.ok(ticks.includes('20') && ticks.includes('60'), 'the x labels are plain numbers');
  assert.equal(byAttrClass(el, 'icor-sqlv-refline').length, 1);
  assert.equal(byAttrClass(el, 'icor-sqlv-zone').length, 1);
  assert.deepEqual(byClass(el, 'icor-sqlv-legend-name').map((n) => n.textContent), ['goal'], 'a labelled guide line is named in the legend');
});

/* ------------------------------------------------------------------ the spec -- */

test('the spec keeps a scatter chart and names what is wrong, in plain words', () => {
  const ok = parse(tileOf({ colorBy: 'channel', trend: true, xMin: 0, xMax: 100, yMin: 0, color: undefined, refLines: [{ y: 5 }] }));
  assert.equal(ok.ok, true, ok.reason);
  const t = ok.spec.tiles[0];
  assert.deepEqual([t.x, t.y[0], t.colorBy, t.trend, t.xMin, t.xMax, t.yMin], ['spend', 'orders', 'channel', true, 0, 100, 0]);
  assert.equal(parse(tileOf({ trend: false })).spec.tiles[0].trend, undefined, '"trend": false is the same as none');
  const bad = [
    [tileOf({ x: undefined }), /a scatter chart needs an "x" column/],
    [tileOf({ y: ['a', 'b'] }), /a scatter chart needs one "y" column/],
    [tileOf({ y: undefined }), /a scatter chart needs one "y" column/],
    [tileOf({ colorBy: '' }), /"colorBy" must be the name of a column/],
    [tileOf({ colorBy: 'spend' }), /"colorBy" must be a different column from "x" and "y"/],
    [tileOf({ trend: 'yes' }), /"trend" must be true or false/],
    [tileOf({ xMin: 'a' }), /"xMin" must be a number/],
    [tileOf({ xMin: 5, xMax: 5 }), /"xMin" \(5\) must be below "xMax" \(5\)/],
    [tileOf({ xLabelEvery: 2 }), /"xLabelEvery" only works on a line, bar or combo chart/],
    [tileOf({ colorBy: 'channel', color: '#112233' }), /"color" only works on a chart with one series/],
    [tileOf({ headerDelta: true }), /"headerDelta" only works on a line or bar chart/],
    [tileOf({ band: { low: 'a', high: 'b' } }), /"band" only works on a line chart/],
    [{ title: 'L', viz: 'line', x: 'a', y: 'b', sql: 'SELECT 1', trend: true }, /"trend" only works on a scatter chart/],
    [{ title: 'L', viz: 'bar', x: 'a', y: 'b', sql: 'SELECT 1', colorBy: 'c' }, /"colorBy" only works on a scatter chart/],
    [{ title: 'L', viz: 'line', x: 'a', y: 'b', sql: 'SELECT 1', xMin: 1 }, /"xMin" only works on a scatter chart/],
    [{ title: 'Built', viz: 'scatter', source: { table: 't', metric: 'v', agg: 'sum', timeColumn: 'd' } }, /use an SQL tile for a scatter chart/],
  ];
  for (const [tile, re] of bad) {
    const r = parse(tile);
    assert.equal(r.ok, false, JSON.stringify(tile));
    assert.match(r.reason, re);
    assert.match(r.reason, /^Tile 1: /);
  }
});

test('a scatter chart survives the spec file', () => {
  const json = lib.specToJson(parse(tileOf({ colorBy: 'channel', trend: true, xMin: 0, xMax: 100, yMax: 200, zones: [{ from: 1, to: 2, color: '#228833' }] })).spec);
  const back = JSON.parse(json).tiles[0];
  assert.deepEqual([back.viz, back.x, back.y, back.colorBy, back.trend, back.xMin, back.xMax, back.yMax], ['scatter', 'spend', 'orders', 'channel', true, 0, 100, 200]);
  assert.equal(back.zones.length, 1);
  assert.equal(lib.parseDashboardSpec(json).ok, true);
});

/* ---------------------------------------------------------------- the form -- */

const TARGET = {
  title: 'Orders against spend', viz: 'scatter', unit: 'orders', hint: 'per day',
  sql: 'SELECT spend, orders, channel FROM plot', x: 'spend', y: 'orders', colorBy: 'channel', trend: true,
  xMin: 0, xMax: 100, yMin: 0, refLines: [{ y: 50, label: 'goal' }],
};

test('a scatter chart built from a blank widget in the form matches the hand-written one field for field', async () => {
  const { form, spec, lib: l } = await makeForm(null);
  form.open();
  Object.assign(form.state, { mode: 'sql', sqlText: TARGET.sql, viz: 'scatter', title: 'Orders against spend', unit: 'orders', sizeKey: 'wide' });
  form.renderForm();
  await form.runPreview();
  for (const label of ['X column', 'Y column', 'Colour the points by column']) assert.equal(byLabel(form.formEl, label).tagName, 'SELECT', label + ' is a picker');
  Object.assign(form.state, { x: 'spend', y: 'orders', scatterColorBy: 'channel', scatterTrend: true, xMin: '0', xMax: '100', yMin: '0', hint: 'per day' });
  form.state.refLines = [{ y: '50', label: 'goal', color: '', dash: '', axis: '' }];
  form.state.groups.axis = true;
  form.renderForm();
  assert.ok(byLabel(form.formEl, 'Draw a trend line through the points').checked);
  assert.ok(byLabel(form.formEl, 'Lowest x value'), 'the axis group has the x ends');
  assert.equal(byLabel(form.formEl, 'Label every Nth value along the bottom'), null, 'a number scale has no label spacing');
  form.touch();
  await form.runPreview();
  assert.equal(form.previewState, 'ok', form.previewError);
  assert.ok(byAttrClass(form.previewEl, 'icor-sqlv-point').length, 'the preview draws the points');
  await form.save();
  const want = l.parseDashboardSpec(JSON.stringify({ id: 'x', title: 'X', database: '07 Data/shop.db', tiles: [TARGET] })).spec.tiles[0];
  assert.deepEqual(unwrap(asFileTile(l, spec.tiles[0])), unwrap(asFileTile(l, want)));
});

test('a scatter chart reads back into the form, and a save keeps every setting', async () => {
  const parsed = lib.parseDashboardSpec(JSON.stringify({ id: 'x', title: 'X', database: '07 Data/shop.db', tiles: [TARGET] })).spec.tiles[0];
  const { form, spec, lib: l } = await makeForm(parsed);
  form.open();
  assert.deepEqual([form.state.scatterColorBy, form.state.scatterTrend, form.state.xMin, form.state.xMax], ['channel', true, '0', '100']);
  assert.equal(byLabel(form.formEl, 'Highest x value').value, '100', 'the axis group opens with its values');
  assert.equal(lib.FORM_VIZ.has('scatter'), true);
  await form.runPreview();
  assert.equal(form.previewState, 'ok', form.previewError);
  assert.equal(form.dropNote.textContent, '', 'nothing is left out');
  await form.save();
  assert.deepEqual(unwrap(asFileTile(l, spec.tiles[0])), unwrap(asFileTile(l, parsed)));
});

test('the form refuses a scatter chart without its two columns, in plain words', async () => {
  const { form } = await makeForm(null);
  form.open();
  Object.assign(form.state, { mode: 'sql', sqlText: 'SELECT 1 AS spend', viz: 'scatter', x: 'spend', y: 'a, b' });
  assert.match(form.buildTile().reason, /A scatter chart needs the x column and one y column\./);
  form.state.y = 'orders';
  form.state.x = '';
  assert.match(form.buildTile().reason, /A scatter chart needs the x column and one y column\./);
  Object.assign(form.state, { x: 'spend', xMin: 'low' });
  assert.match(form.buildTile().reason, /Axis: the lowest x value must be a number/);
});

test('the point colour field shows for one colour, and goes when the points are coloured by a column', async () => {
  const { form } = await makeForm({ title: 'S', viz: 'scatter', sql: 'SELECT * FROM plot', x: 'spend', y: ['orders'] });
  form.open();
  assert.ok(byLabel(form.formEl, 'Colour of the points'), 'one colour: the field');
  form.state.scatterColorBy = 'channel';
  form.renderForm();
  assert.equal(byLabel(form.formEl, 'Colour of the points'), null, 'coloured by a column: no single colour');
});
