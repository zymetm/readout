/* A HEATMAP: A GRID OF CELLS COLOURED BY VALUE LEVELS.
 *
 * A dashboard could not show a value across two dimensions at once: day
 * by hour, week by weekday. "viz": "heatmap" places one cell per query
 * row by its "row" and "column" values, colours it by the value levels of
 * its "value", puts a dot on cells a "marker" column marks, brightens the
 * current hour's column when asked, and names every colour in a legend.
 * These gates pin the rules: the grid follows the query's order; a cell
 * takes its level's colour, an empty cell none; the marker, the highlight,
 * the column labels and the hover text are right; the spec refuses what
 * makes no sense, in plain words; it survives the spec file and the
 * desktop cache. Every value here is invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { loadPlugin, makeFakeAdapter, unwrap } from './harness.mjs';

const CSS = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

const { lib, obsidian } = loadPlugin();

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byClass = (root, cls) => [...walkEl(root)].filter((e) => e.classSet && e.classSet.has(cls));
const freshEl = () => new obsidian.Modal({}).contentEl;
const parse = (tile) => lib.parseDashboardSpec(JSON.stringify({ id: 'hm', title: 'Heat', database: '07 Databases/x.db', tiles: [tile] }));
const RANGES = [{ high: 9, level: 'Cool', label: 'cool' }, { low: 10, high: 19, level: 'Mild', label: 'mild' }, { level: 'Hot', label: 'hot' }];
const LEVELS = [{ id: 'cool', name: 'Cool', color: '#3366cc' }, { id: 'mild', name: 'Mild', color: '#88aa44' }, { id: 'hot', name: 'Hot', color: '#cc5533' }];
const heatTile = (extra) => Object.assign({ title: 'Load by slot', viz: 'heatmap', row: 'week', column: 'slot', value: 'load', unit: 'u', ranges: RANGES, sql: 'SELECT 1' }, extra);
const TABLE = {
  columns: ['week', 'slot', 'load', 'flag'],
  rows: [['W2', 0, 5, 1], ['W2', 1, 15, 0], ['W2', 2, 25, 0], ['W1', 0, null, 0], ['W1', 1, 12, 1], ['W1', 2, 30, 0]],
};

function draw(tile, table, extras) {
  const el = freshEl();
  lib.renderTile(el, parse(tile).spec.tiles[0], table || TABLE, extras || { levels: LEVELS });
  return el;
}
const cells = (el) => byClass(el, 'icor-sqlv-heatmap-cell');

test('THE LIMIT: no other widget draws a heatmap', () => {
  const el = freshEl();
  lib.renderTile(el, { viz: 'table' }, TABLE, {});
  assert.equal(cells(el).length, 0);
});

test('the grid follows the query order: rows and columns as they first appear', () => {
  const grid = lib.heatmapGrid(TABLE, { row: 'week', column: 'slot', value: 'load', marker: 'flag' });
  assert.deepEqual(unwrap(grid.rows), ['W2', 'W1']);
  assert.deepEqual(unwrap(grid.cols), ['0', '1', '2']);
  assert.deepEqual(unwrap(grid.cell('W1', '1')), { value: 12, marker: true });
  const el = draw(heatTile());
  assert.equal(cells(el).length, 6);
  assert.deepEqual(byClass(el, 'icor-sqlv-heatmap-row').map((r) => r.textContent), ['W2', 'W1']);
  assert.equal(byClass(el, 'icor-sqlv-heatmap-grid')[0].style['grid-template-columns'], 'max-content repeat(3, minmax(9px, 1fr))');
});

test('each cell takes its level colour; an empty cell takes none and says so', () => {
  const el = draw(heatTile());
  assert.deepEqual(cells(el).map((c) => c.style.background || (c.classSet.has('is-empty') ? 'empty' : 'none')), ['#3366cc', '#88aa44', '#cc5533', 'empty', '#88aa44', '#cc5533']);
  assert.equal(cells(el)[1].getAttribute('title'), 'W2 · 1 · 15 u · mild');
  assert.equal(cells(el)[3].getAttribute('title'), 'W1 · 0 · no data');
  const unknown = draw(heatTile(), TABLE, { levels: [] });
  assert.ok(cells(unknown).every((c) => !c.style.background), 'a level the settings do not know leaves the cell neutral');
});

test('a marker column puts a dot on its cells, in its colour, with its label', () => {
  const el = draw(heatTile({ marker: 'flag', markerColor: '#5af8ff', markerLabel: 'flagged' }));
  const marked = cells(el).filter((c) => c.classSet.has('has-marker'));
  assert.equal(marked.length, 2);
  assert.equal(byClass(marked[0], 'icor-sqlv-heatmap-dot')[0].style.background, '#5af8ff');
  assert.equal(marked[1].getAttribute('title'), 'W1 · 1 · 12 u · mild · flagged');
});

test('the legend names every range, an empty cell and the marker', () => {
  const el = draw(heatTile({ marker: 'flag', markerLabel: 'flagged' }));
  const legend = byClass(el, 'icor-sqlv-heatmap-legend')[0];
  assert.deepEqual(byClass(legend, 'icor-sqlv-legend-name').map((n) => n.textContent), ['cool', 'mild', 'hot', 'no data', 'flagged']);
  assert.equal(byClass(legend, 'icor-sqlv-legend-chip')[0].style.background, '#3366cc');
});

test('"highlight": "hour" brightens the column for the current hour; columnLabelEvery thins the labels', () => {
  const hour = new Date().getHours();
  const rows = [];
  for (let h = 0; h < 24; h++) rows.push(['W1', h, 12, 0]);
  const el = draw(heatTile({ highlight: 'hour', columnLabelEvery: 3 }), { columns: TABLE.columns, rows });
  const current = cells(el).filter((c) => c.classSet.has('is-current'));
  assert.equal(current.length, 1);
  assert.equal(cells(el).indexOf(current[0]), hour);
  const heads = byClass(el, 'icor-sqlv-heatmap-col');
  assert.deepEqual(heads.map((h) => h.textContent).filter(Boolean), ['0', '3', '6', '9', '12', '15', '18', '21']);
  assert.ok(heads[hour].classSet.has('is-current'));
  const plain = draw(heatTile(), { columns: TABLE.columns, rows });
  assert.equal(cells(plain).filter((c) => c.classSet.has('is-current')).length, 0, 'no highlight unless asked');
});

test('the spec keeps a heatmap and names what is wrong, in plain words', () => {
  const ok = parse(heatTile({ marker: 'flag', markerColor: '#5af8ff', markerLabel: 'flagged', highlight: 'hour', columnLabelEvery: 3 }));
  assert.equal(ok.ok, true, ok.reason);
  const t = ok.spec.tiles[0];
  assert.deepEqual([t.row, t.column, t.value, t.marker, t.highlight, t.columnLabelEvery], ['week', 'slot', 'load', 'flag', 'hour', 3]);
  const bad = [
    [heatTile({ value: undefined }), /a heatmap needs "row", "column" and "value"/],
    [heatTile({ marker: '' }), /"marker" must be the name of a column/],
    [heatTile({ markerColor: 'cyan', marker: 'flag' }), /"markerColor" must be a theme colour/],
    [heatTile({ markerLabel: 'x' }), /need a "marker" column/],
    [heatTile({ highlight: 'month' }), /"highlight" must be "hour" \(the column for the current hour\), "day"/],
    [heatTile({ cells: 'round' }), /"cells" must be "square"/],
    [heatTile({ columnLabelEvery: 0 }), /"columnLabelEvery" must be a whole number/],
    [{ title: 'L', viz: 'line', x: 'a', y: 'b', sql: 'SELECT 1', marker: 'm' }, /"marker" only works on a heatmap/],
    [{ title: 'Built', viz: 'heatmap', source: { table: 't', metric: 'v', agg: 'sum', timeColumn: 'd' } }, /use an SQL tile for a heatmap/],
  ];
  for (const [tile, re] of bad) {
    const r = parse(tile);
    assert.equal(r.ok, false, JSON.stringify(tile));
    assert.match(r.reason, re);
    assert.match(r.reason, /^Tile 1: /);
  }
});

test('a heatmap survives the spec file', () => {
  const json = lib.specToJson(parse(heatTile({ marker: 'flag', markerColor: '#5af8ff', highlight: 'hour', columnLabelEvery: 3 })).spec);
  const back = JSON.parse(json).tiles[0];
  assert.deepEqual([back.row, back.column, back.value, back.marker, back.markerColor, back.highlight, back.columnLabelEvery], ['week', 'slot', 'load', 'flag', '#5af8ff', 'hour', 3]);
  assert.equal(back.ranges.length, 3);
  assert.equal(lib.parseDashboardSpec(json).ok, true);
});

/* ---------------------------------------------- the view and the cache -- */

const DASH = '07 Databases/Dashboards/hm.json';
const CACHE = '07 Databases/Dashboard Cache/dashboards/hm.md';
const SPEC = { id: 'hm', title: 'Heat', database: '07 Databases/x.db', tiles: [heatTile({ marker: 'flag' })] };
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

test('a phone draws the same heatmap from the desktop cache: the cache keeps the grid fields apart from the result rows', async () => {
  const desk = await makeView({ [DASH]: JSON.stringify(SPEC) }, { '07 Databases/x.db': new Uint8Array([1]) });
  desk.plugin.query.engineFor = async () => ({ engine: 'cli', size: 1 });
  desk.plugin.query.query = async () => ({ columns: TABLE.columns, rows: TABLE.rows, ms: 1 });
  await desk.view.onOpen();
  await settle();
  assert.equal(cells(desk.view.contentEl).length, 6);
  const cache = desk.adapter.files.get(CACHE);
  assert.ok(cache, 'the desktop wrote its cache');
  const phone = await makeView({ [DASH]: JSON.stringify(SPEC), [CACHE]: cache }, { '07 Databases/x.db': new Uint8Array([1]) }, { desktop: false });
  phone.plugin.query.engineFor = async () => ({ engine: null, reason: 'Too big for this device.' });
  await phone.view.onOpen();
  await settle();
  assert.equal(cells(phone.view.contentEl).length, 6);
  assert.equal(cells(phone.view.contentEl).filter((c) => c.classSet.has('has-marker')).length, 2);
});

/* ---------------------------------------------- cells and day highlight -- */

test('"highlight": "day" and "weekday" light up the row or column named for today, in local time', () => {
  const now = new Date(2026, 0, 7, 10, 30); // a Wednesday
  const grid = { rows: ['2026-01-06', '2026-01-07', 'Wed'], cols: ['Mon', 'wednesday', '10', '2026-01-07'] };
  assert.deepEqual(unwrap(lib.heatmapHighlight(grid, 'day', now)), { row: 1, col: 3 });
  assert.deepEqual(unwrap(lib.heatmapHighlight(grid, 'weekday', now)), { row: 2, col: 1 });
  assert.deepEqual(unwrap(lib.heatmapHighlight(grid, 'hour', now)), { row: -1, col: 2 });
  assert.deepEqual(unwrap(lib.heatmapHighlight(grid, undefined, now)), { row: -1, col: -1 });
});

test('a lit row brightens its label and every cell in it', () => {
  const today = new Date();
  const iso = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  const rows = [['2000-01-01', 1, 12, 0], [iso, 1, 12, 0], [iso, 2, 30, 0]];
  const el = draw(heatTile({ highlight: 'day' }), { columns: TABLE.columns, rows });
  const heads = byClass(el, 'icor-sqlv-heatmap-row');
  assert.deepEqual(heads.map((h) => h.classSet.has('is-current')), [false, true]);
  assert.equal(cells(el).filter((c) => c.classSet.has('is-current')).length, 2, 'both cells of today\'s row');
});

test('"cells": "square" and "fill" mark the heatmap; fill shares the tile\'s height between the rows', () => {
  const sq = draw(heatTile({ cells: 'square' }), TABLE);
  assert.ok(byClass(sq, 'icor-sqlv-heatmap')[0].classSet.has('is-square'));
  const fill = draw(heatTile({ cells: 'fill' }), TABLE);
  assert.ok(byClass(fill, 'icor-sqlv-heatmap')[0].classSet.has('is-fill'));
  const grid = byClass(fill, 'icor-sqlv-heatmap-grid')[0];
  assert.match(grid.style['grid-template-rows'], /^14px repeat\(\d+, minmax\(13px, 1fr\)\)$/);
  const plain = draw(heatTile(), TABLE);
  assert.equal(byClass(plain, 'icor-sqlv-heatmap')[0].classSet.has('is-fill'), false);
  const back = JSON.parse(lib.specToJson(parse(heatTile({ cells: 'fill', highlight: 'weekday' })).spec)).tiles[0];
  assert.deepEqual([back.cells, back.highlight], ['fill', 'weekday']);
  assert.ok(/\.icor-sqlv-heatmap\.is-square \.icor-sqlv-heatmap-cell \{[^}]*aspect-ratio: 1 \/ 1/.test(CSS), 'square cells in the stylesheet');
});
