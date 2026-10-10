/* A CHART CAN SET ITS OWN Y RANGE AND X-LABEL SPACING.
 *
 * A line or bar chart always took a snug automatic y axis and as many x
 * labels as fit, with no way to pin either. "yMin" and "yMax" fix the ends;
 * "yMaxLimit" lets the top start at "yMax" and grow to fit the data, never
 * past the limit; "yTicks" names the y labels; "xLabelEvery" labels every
 * Nth x value. These gates pin the rules: without them nothing changes;
 * with them the axis is drawn as asked; the spec refuses them where they
 * mean nothing, in plain words; they survive the spec file, a built
 * widget, the desktop cache and an edit from the form. Every value here is
 * invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeFakeAdapter, unwrap } from './harness.mjs';

const { lib, obsidian } = loadPlugin();

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byTag = (root, tag) => [...walkEl(root)].filter((e) => e.tagName === tag.toUpperCase());
const freshEl = () => new obsidian.Modal({}).contentEl;
const parse = (tile) => lib.parseDashboardSpec(JSON.stringify({ id: 'ax', title: 'Axis', database: '07 Databases/x.db', tiles: [tile] }));
const lineTile = (extra) => Object.assign({ title: 'Temps', viz: 'line', x: 'slot', y: 'mid', sql: 'SELECT 1 AS slot, 2 AS mid' }, extra);

/* 48 slots, values between 90 and `top`. */
function slots(top) {
  const rows = [];
  for (let i = 0; i < 48; i++) rows.push(['s' + String(i).padStart(2, '0'), i === 30 ? top : 90 + (i % 7) * 10]);
  return { columns: ['slot', 'mid'], rows };
}
function draw(tile, table) {
  const el = freshEl();
  lib.renderTile(el, tile, table, {});
  return el;
}
const ticksOf = (el) => byTag(el, 'text').filter((t) => t.getAttribute('class') === 'icor-sqlv-tick');
const yTicks = (el) => ticksOf(el).filter((t) => t.getAttribute('text-anchor') === 'end').map((t) => t.textContent);
const xTicks = (el) => ticksOf(el).filter((t) => t.getAttribute('text-anchor') === 'middle').map((t) => t.textContent);

test('THE LIMIT: without the fields the y axis stays snug and automatic', () => {
  const el = draw({ viz: 'line', x: 'slot', y: ['mid'] }, slots(150));
  const ticks = yTicks(el).map(Number);
  assert.ok(ticks[0] >= 80, 'a snug axis does not start at 40: ' + ticks);
  assert.deepEqual(unwrap(lib.chartScaleFor(undefined, 90, 150, 5)), unwrap(lib.niceScale(90, 150, 5)), 'no axis fields: the same scale as before');
});

test('yMin, yMax and yTicks draw exactly the labels asked for', () => {
  const el = draw({ viz: 'line', x: 'slot', y: ['mid'], yMin: 40, yMax: 200, yMaxLimit: 240, yTicks: [54, 70, 130, 180, 200] }, slots(150));
  assert.deepEqual(yTicks(el), ['54', '70', '130', '180', '200']);
});

test('with yMaxLimit the top grows to fit the data, gains its own label, and stops at the limit', () => {
  const axis = { yMin: 40, yMax: 200, yMaxLimit: 240, yTicks: [54, 70, 130, 180, 200] };
  const grown = lib.chartScaleFor(axis, 90, 213, 5);
  assert.equal(grown.max, 220, 'rounded up to two figures');
  assert.deepEqual(unwrap(grown.ticks), [54, 70, 130, 180, 200, 220]);
  assert.equal(lib.chartScaleFor(axis, 90, 400, 5).max, 240, 'never past the limit');
  assert.equal(lib.chartScaleFor(axis, 90, 150, 5).max, 200, 'never below yMax');
  assert.equal(lib.chartScaleFor({ yMax: 200 }, 90, 400, 5).max, 200, 'without a limit the top stays fixed');
  const el = draw(Object.assign({ viz: 'line', x: 'slot', y: ['mid'] }, axis), slots(213));
  assert.deepEqual(yTicks(el), ['54', '70', '130', '180', '200', '220']);
  assert.equal(lib.ceilToTwoFigures(1.34), 1.4);
  assert.equal(lib.ceilToTwoFigures(220), 220);
});

test('a value past a fixed end is drawn at that end, inside the plot', () => {
  const L = lib.chartLayout(640, 260, 10, 500, true, { yMin: 40, yMax: 200 });
  assert.equal(L.yOf(500), L.top);
  assert.equal(L.yOf(10), L.top + L.plotH);
  assert.equal(L.scale.min, 40);
  assert.equal(L.scale.max, 200);
});

test('xLabelEvery labels every Nth value, and still thins when they would not fit', () => {
  const el = draw({ viz: 'line', x: 'slot', y: ['mid'], xLabelEvery: 8 }, slots(150));
  assert.deepEqual(xTicks(el), ['s00', 's08', 's16', 's24', 's32', 's40']);
  const L = lib.chartLayout(200, 260, 0, 10, true, { xLabelEvery: 8 });
  const plan = lib.xLabelPlan(L, slots(150).rows.map((r) => r[0]), (i) => L.left + (i / 47) * L.plotW);
  assert.ok(plan.length >= 1 && plan.every((p) => p.i % 8 === 0), 'only multiples of 8 on a narrow chart: ' + plan.map((p) => p.i));
});

test('a bar chart takes the same fields', () => {
  const table = { columns: ['day', 'hours'], rows: [['a', 6], ['b', 7.5], ['c', 9]] };
  const el = draw({ viz: 'bar', x: 'day', y: ['hours'], yMin: 0, yMax: 12, yTicks: [0, 4, 8, 12] }, table);
  assert.deepEqual(yTicks(el), ['0', '4', '8', '12']);
});

test('the spec keeps the fields and names what is wrong, in plain words', () => {
  const ok = parse(lineTile({ yMin: 40, yMax: 200, yMaxLimit: 240, yTicks: [54, 70, 180], xLabelEvery: 8 }));
  assert.equal(ok.ok, true, ok.reason);
  assert.deepEqual(unwrap(lib.chartScaleFor(ok.spec.tiles[0], 0, 100, 5).ticks), [54, 70, 180]);
  assert.equal(ok.spec.tiles[0].xLabelEvery, 8);
  assert.equal(parse(lineTile({})).spec.tiles[0].yMin, undefined);
  const bad = [
    [lineTile({ yMin: '40' }), /"yMin" must be a number/],
    [lineTile({ yMin: 50, yMax: 50 }), /"yMin" \(50\) must be below "yMax" \(50\)/],
    [lineTile({ yMaxLimit: 240 }), /"yMaxLimit" needs "yMax"/],
    [lineTile({ yMax: 200, yMaxLimit: 150 }), /"yMaxLimit" \(150\) must be above "yMax"/],
    [lineTile({ yTicks: [70, 54] }), /"yTicks" must be a list of 1 to 12 numbers from low to high/],
    [lineTile({ yTicks: [] }), /"yTicks" must be a list/],
    [lineTile({ xLabelEvery: 0 }), /"xLabelEvery" must be a whole number from 1/],
    [lineTile({ xLabelEvery: 2.5 }), /"xLabelEvery" must be a whole number/],
    [{ title: 'S', viz: 'stat', y: 'v', sql: 'SELECT 2 AS v', yMin: 0 }, /"yMin" only works on a line, bar, combo or scatter chart/],
    [{ title: 'T', viz: 'table', sql: 'SELECT 2 AS v', xLabelEvery: 2 }, /"xLabelEvery" only works on a line, bar or combo chart/],
  ];
  for (const [tile, re] of bad) {
    const r = parse(tile);
    assert.equal(r.ok, false, JSON.stringify(tile));
    assert.match(r.reason, re);
    assert.match(r.reason, /^Tile 1: /);
  }
});

test('the fields survive the spec file, on an SQL tile and on a built widget, and a built widget draws them', () => {
  const fields = { yMin: 0, yMax: 12, yMaxLimit: 16, yTicks: [0, 4, 8, 12], xLabelEvery: 2 };
  const back = JSON.parse(lib.specToJson(parse(lineTile(fields)).spec)).tiles[0];
  for (const [k, v] of Object.entries(fields)) assert.deepEqual(back[k], v, k);
  assert.equal(JSON.stringify(JSON.parse(lib.specToJson(parse(lineTile({})).spec)).tiles[0]).includes('yM'), false, 'unset stays out of the file');
  const built = parse(Object.assign({ title: 'Sleep', viz: 'bar', source: { table: 'sleep', metric: 'hours', agg: 'avg', timeColumn: 'day' } }, fields));
  assert.equal(built.ok, true, built.reason);
  const bback = JSON.parse(lib.specToJson(built.spec)).tiles[0];
  for (const [k, v] of Object.entries(fields)) assert.deepEqual(bback[k], v, 'built ' + k);
  const prepared = lib.prepareTileForRender(built.spec.tiles[0], { columns: ['x', 'value'], rows: [['2026-01-01', 7], ['2026-01-02', 8]] });
  const el = freshEl();
  lib.renderTile(el, prepared.spec, prepared.table, {});
  assert.deepEqual(yTicks(el), ['0', '4', '8', '12']);
});

/* ---------------------------------------------- the view and the cache -- */

const DASH = '07 Databases/Dashboards/ax.json';
const CACHE = '07 Databases/Dashboard Cache/dashboards/ax.md';
const SPEC = { id: 'ax', title: 'Axis', database: '07 Databases/x.db', tiles: [lineTile({ yMin: 40, yMax: 200, yTicks: [54, 70, 130, 180, 200], xLabelEvery: 8 })] };
const settle = () => new Promise((r) => setTimeout(r, 20));

async function makeView(files, binaries, { desktop = true } = {}) {
  const fresh = loadPlugin({ desktop });
  const adapter = makeFakeAdapter(files, binaries);
  const app = { vault: { adapter }, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  await plugin.onload();
  const view = plugin.viewFactories['readout-dashboards']({ app });
  view.app = app;
  return { plugin, view, adapter };
}

test('a phone draws the same axis from the desktop cache', async () => {
  const table = slots(150);
  const desk = await makeView({ [DASH]: JSON.stringify(SPEC) }, { '07 Databases/x.db': new Uint8Array([1]) });
  desk.plugin.query.engineFor = async () => ({ engine: 'cli', size: 1 });
  desk.plugin.query.query = async () => ({ columns: table.columns, rows: table.rows, ms: 1 });
  await desk.view.onOpen();
  await settle();
  assert.deepEqual(yTicks(desk.view.contentEl), ['54', '70', '130', '180', '200']);
  const cache = desk.adapter.files.get(CACHE);
  assert.ok(cache, 'the desktop wrote its cache');
  const phone = await makeView({ [DASH]: JSON.stringify(SPEC), [CACHE]: cache }, { '07 Databases/x.db': new Uint8Array([1]) }, { desktop: false });
  phone.plugin.query.engineFor = async () => ({ engine: null, reason: 'Too big for this device.' });
  await phone.view.onOpen();
  await settle();
  assert.deepEqual(yTicks(phone.view.contentEl), ['54', '70', '130', '180', '200']);
  assert.deepEqual(xTicks(phone.view.contentEl), ['s00', 's08', 's16', 's24', 's32', 's40']);
});

/* ---------------------------------------------------------- the edit form -- */

test('editing the widget in the form keeps the fields the form has no field for', async () => {
  const fresh = loadPlugin();
  const adapter = makeFakeAdapter({}, { '07 Databases/x.db': new Uint8Array([1]) });
  const app = { vault: { adapter }, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  plugin.app = app;
  await plugin.onload();
  plugin.query.engineFor = async () => ({ engine: 'cli', size: 1 });
  const table = slots(150);
  plugin.query.query = async () => ({ columns: table.columns, rows: table.rows, ms: 1 });
  const tile = parse(lineTile({ yMin: 40, yMax: 200, xLabelEvery: 8 })).spec.tiles[0];
  const spec = { id: 'd', title: 'D', database: '07 Databases/x.db', globalTimeframe: { preset: '90d' }, tiles: [tile], path: 'd.json' };
  const form = new fresh.PluginClass.modals.WidgetFormModal(plugin, { saveAndRender: async () => {} }, spec, 0);
  form.open();
  form.state.title = 'Renamed';
  form.touch();
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(form.previewState, 'ok');
  await form.save();
  assert.equal(spec.tiles[0].title, 'Renamed');
  assert.equal(spec.tiles[0].yMin, 40);
  assert.equal(spec.tiles[0].yMax, 200);
  assert.equal(spec.tiles[0].xLabelEvery, 8);
  /* Turned into another type, they go: a stat has no axis. */
  assert.equal(lib.keepUneditedKeys({ viz: 'stat' }, { viz: 'line', yMin: 40 }).yMin, undefined);
});
