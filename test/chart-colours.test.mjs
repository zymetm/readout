/* A CHART CAN HAVE ITS OWN COLOUR, AND ITS POINTER LINE ANOTHER.
 *
 * A one-series line or bar chart drew in the theme's single-series ink,
 * and the line that follows the pointer on a line chart in the theme's
 * marker colour, with no way to choose either per chart. "color" sets the
 * line or the bars; "guideColor" sets the pointer line (line charts only;
 * a bar chart has none). Both take the level-colour rule: a theme
 * variable or a plain hex. These gates pin the rules: without them
 * nothing changes; with them the chart draws in them and the hover dots
 * follow the line; the spec refuses them where they mean nothing, in
 * plain words; they survive the spec file, a built widget, the desktop
 * cache and the edit form. Every value here is invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadPlugin, makeFakeAdapter } from './harness.mjs';

const { lib, obsidian } = loadPlugin();

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byClass = (root, cls) => [...walkEl(root)].filter((e) => e.classSet && e.classSet.has(cls));
const byTag = (root, tag) => [...walkEl(root)].filter((e) => e.tagName === tag.toUpperCase());
const freshEl = () => new obsidian.Modal({}).contentEl;
const parse = (tile) => lib.parseDashboardSpec(JSON.stringify({ id: 'cc', title: 'Colours', database: '07 Databases/x.db', tiles: [tile] }));
const lineTile = (extra) => Object.assign({ title: 'Walks', viz: 'line', x: 'day', y: 'km', sql: 'SELECT 1 AS day, 2 AS km' }, extra);
const TABLE = { columns: ['day', 'km', 'laps'], rows: [['2026-01-01', 3, 1], ['2026-01-02', 5, 2], ['2026-01-03', 4, 3]] };

function draw(tile, table) {
  const el = freshEl();
  lib.renderTile(el, tile, table || TABLE, {});
  return el;
}
const box = (el) => byClass(el, 'icor-sqlv-chart-box')[0];
const linePaths = (el) => byTag(el, 'path').filter((p) => p.getAttribute('fill') === 'none');

test('THE LIMIT: without "color" a one-series chart keeps the theme ink and sets no colour of its own', () => {
  const el = draw({ viz: 'line', x: 'day', y: ['km'] });
  assert.deepEqual(linePaths(el).map((p) => p.getAttribute('stroke')), ['var(--sqlv-series-1)']);
  assert.equal(box(el).style['--sqlv-tile-series'], undefined);
  assert.equal(box(el).style['--sqlv-tile-guide'], undefined);
});

test('"color" draws the line in it; the hover dots follow it; "guideColor" colours the pointer line', () => {
  const el = draw({ viz: 'line', x: 'day', y: ['km'], color: '#df8f48', guideColor: '#cccccc' });
  assert.deepEqual(linePaths(el).map((p) => p.getAttribute('stroke')), ['#df8f48']);
  assert.equal(box(el).style['--sqlv-tile-series'], '#df8f48', 'the hover dots read this');
  assert.equal(box(el).style['--sqlv-tile-guide'], '#cccccc', 'the pointer line reads this');
  const themed = draw({ viz: 'line', x: 'day', y: ['km'], color: 'var(--color-orange)' });
  assert.deepEqual(linePaths(themed).map((p) => p.getAttribute('stroke')), ['var(--color-orange)'], 'a theme colour follows the theme');
});

test('"color" fills the bars of a bar chart', () => {
  const el = draw({ viz: 'bar', x: 'day', y: ['km'], color: '#df8f48' });
  const bars = byTag(el, 'path').filter((p) => p.getAttribute('fill') && p.getAttribute('fill') !== 'none');
  assert.equal(bars.length, 3);
  assert.deepEqual([...new Set(bars.map((b) => b.getAttribute('fill')))], ['#df8f48']);
  const plain = draw({ viz: 'bar', x: 'day', y: ['km'] });
  assert.deepEqual([...new Set(byTag(plain, 'path').map((b) => b.getAttribute('fill')))], ['var(--sqlv-series-1)']);
});

test('a chart with several series keeps the theme series colours, even if "color" reaches the renderer', () => {
  const el = draw({ viz: 'line', x: 'day', y: ['km', 'laps'], color: '#df8f48' });
  assert.deepEqual(linePaths(el).map((p) => p.getAttribute('stroke')), ['var(--sqlv-series-2)', 'var(--sqlv-series-3)']);
  assert.equal(box(el).style['--sqlv-tile-series'], undefined);
  assert.deepEqual([...lib.chartPaletteFor({ color: 'not a colour' }, 1)], ['var(--sqlv-series-1)']);
});

test('the stylesheet reads the chart colours with the theme marker as the fallback', () => {
  const css = fs.readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
  assert.match(css, /\.icor-sqlv-guide \{ stroke: var\(--sqlv-tile-guide, var\(--sqlv-marker\)\);/);
  assert.match(css, /\.icor-sqlv-hover-dot \{ fill: var\(--sqlv-tile-series, var\(--sqlv-marker\)\); \}/);
});

test('the spec keeps both colours and names what is wrong, in plain words', () => {
  const ok = parse(lineTile({ color: ' #DF8F48 ', guideColor: 'var(--color-blue)' }));
  assert.equal(ok.ok, true, ok.reason);
  assert.equal(ok.spec.tiles[0].color, '#DF8F48');
  assert.equal(ok.spec.tiles[0].guideColor, 'var(--color-blue)');
  assert.equal(parse(lineTile({})).spec.tiles[0].color, undefined);
  assert.equal(parse({ title: 'B', viz: 'bar', x: 'day', y: 'km', sql: 'SELECT 1 AS day, 2 AS km', color: '#112233' }).ok, true);
  const bad = [
    [lineTile({ color: 'orange' }), /"color" must be a theme colour like "var\(--color-orange\)" or a hex colour/],
    [lineTile({ color: 'oklch(0.72 0.13 60)' }), /"color" must be a theme colour/],
    [lineTile({ color: '#ccc' }), /"color" must be a theme colour/],
    [lineTile({ guideColor: 'red; display:none' }), /"guideColor" must be a theme colour/],
    [lineTile({ y: ['km', 'laps'], color: '#112233' }), /"color" only works on a chart with one series/],
    [{ title: 'B', viz: 'bar', x: 'day', y: 'km', sql: 'SELECT 1 AS day, 2 AS km', guideColor: '#112233' }, /"guideColor" only works on a line or combo chart/],
    [{ title: 'S', viz: 'stat', y: 'km', sql: 'SELECT 2 AS km', color: '#112233' }, /"color" only works on a line, bar or scatter chart/],
    [{ title: 'Built', viz: 'line', color: '#112233', source: { table: 't', metric: 'v', agg: 'sum', timeColumn: 'd', series: 'kind' } }, /"color" only works on a chart with one series/],
  ];
  for (const [tile, re] of bad) {
    const r = parse(tile);
    assert.equal(r.ok, false, JSON.stringify(tile));
    assert.match(r.reason, re);
    assert.match(r.reason, /^Tile 1: /);
  }
});

test('both colours survive the spec file, on an SQL tile and on a built widget', () => {
  const json = lib.specToJson(parse(lineTile({ color: '#df8f48', guideColor: '#cccccc' })).spec);
  assert.equal(JSON.parse(json).tiles[0].color, '#df8f48');
  assert.equal(JSON.parse(json).tiles[0].guideColor, '#cccccc');
  assert.equal(lib.parseDashboardSpec(json).spec.tiles[0].guideColor, '#cccccc');
  const built = parse({ title: 'Sleep', viz: 'line', color: '#df8f48', guideColor: '#cccccc', source: { table: 'sleep', metric: 'hours', agg: 'avg', timeColumn: 'day' } });
  assert.equal(built.ok, true, built.reason);
  const back = JSON.parse(lib.specToJson(built.spec)).tiles[0];
  assert.equal(back.color, '#df8f48');
  assert.equal(back.guideColor, '#cccccc');
  assert.equal(JSON.stringify(JSON.parse(lib.specToJson(parse(lineTile({})).spec)).tiles[0]).includes('olor'), false, 'unset stays out of the file');
});

test('a built widget draws in its colours', () => {
  const tile = parse({ title: 'Sleep', viz: 'line', color: '#df8f48', guideColor: '#cccccc', source: { table: 'sleep', metric: 'hours', agg: 'avg', timeColumn: 'day' } }).spec.tiles[0];
  const prepared = lib.prepareTileForRender(tile, { columns: ['x', 'value'], rows: [['2026-01-01', 7], ['2026-01-02', 8]] });
  const el = freshEl();
  lib.renderTile(el, prepared.spec, prepared.table, {});
  assert.deepEqual(linePaths(el).map((p) => p.getAttribute('stroke')), ['#df8f48']);
  assert.equal(box(el).style['--sqlv-tile-guide'], '#cccccc');
});

/* ---------------------------------------------- the view and the cache -- */

const DASH = '07 Databases/Dashboards/cc.json';
const CACHE = '07 Databases/Dashboard Cache/dashboards/cc.json';
const SPEC = { id: 'cc', title: 'Colours', database: '07 Databases/x.db', tiles: [lineTile({ color: '#df8f48', guideColor: '#cccccc' })] };
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

test('a phone draws the same colours from the desktop cache', async () => {
  const desk = await makeView({ [DASH]: JSON.stringify(SPEC) }, { '07 Databases/x.db': new Uint8Array([1]) });
  desk.plugin.query.engineFor = async () => ({ engine: 'cli', size: 1 });
  desk.plugin.query.query = async () => ({ columns: TABLE.columns, rows: TABLE.rows, ms: 1 });
  await desk.view.onOpen();
  await settle();
  assert.deepEqual(linePaths(desk.view.contentEl).map((p) => p.getAttribute('stroke')), ['#df8f48']);
  const cache = desk.adapter.files.get(CACHE);
  assert.ok(cache, 'the desktop wrote its cache');
  const phone = await makeView({ [DASH]: JSON.stringify(SPEC), [CACHE]: cache }, { '07 Databases/x.db': new Uint8Array([1]) }, { desktop: false });
  phone.plugin.query.engineFor = async () => ({ engine: null, reason: 'Too big for this device.' });
  await phone.view.onOpen();
  await settle();
  assert.deepEqual(linePaths(phone.view.contentEl).map((p) => p.getAttribute('stroke')), ['#df8f48']);
  assert.equal(box(phone.view.contentEl).style['--sqlv-tile-guide'], '#cccccc');
});

/* ---------------------------------------------------------- the edit form -- */

async function openForm(tile) {
  const fresh = loadPlugin();
  const adapter = makeFakeAdapter({}, { '07 Databases/x.db': new Uint8Array([1]) });
  const app = { vault: { adapter }, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  plugin.app = app;
  await plugin.onload();
  plugin.query.engineFor = async () => ({ engine: 'cli', size: 1 });
  plugin.query.query = async () => ({ columns: TABLE.columns, rows: TABLE.rows, ms: 1 });
  const spec = { id: 'd', title: 'D', database: '07 Databases/x.db', globalTimeframe: { preset: '90d' }, tiles: [tile], path: 'd.json' };
  const form = new fresh.PluginClass.modals.WidgetFormModal(plugin, { saveAndRender: async () => {} }, spec, 0);
  form.open();
  return { form, spec };
}
const field = (form, tag, label) => [...walkEl(form.formEl)].find((e) => e.tagName === tag && e.getAttribute('aria-label') === label);
const selected = (select) => select.children.find((o) => o.selected);

test('the edit screen offers the line colour and the scrub line colour, with a picker for a custom one, and saves them', async () => {
  const { form, spec } = await openForm(parse(lineTile({ color: '#df8f48' })).spec.tiles[0]);
  const lineSel = field(form, 'SELECT', 'Colour of the line');
  const guideSel = field(form, 'SELECT', 'Colour of the line that follows the pointer');
  assert.ok(lineSel && guideSel, 'both fields are on the form');
  assert.equal(selected(lineSel).value, 'custom');
  assert.equal(selected(guideSel).value, '', 'unset reads Theme default');
  assert.deepEqual(lineSel.children.map((o) => o.textContent).slice(0, 2), ['Theme default', 'Green (theme)']);
  const picker = field(form, 'INPUT', 'Custom colour of the line');
  assert.equal(picker.value, '#df8f48');
  picker.value = '#123456';
  picker.handlers.input[0]();
  guideSel.value = 'custom';
  guideSel.handlers.change[0]();
  const guidePicker = field(form, 'INPUT', 'Custom colour of the line that follows the pointer');
  guidePicker.value = '#cccccc';
  guidePicker.handlers.input[0]();
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(form.previewState, 'ok');
  assert.deepEqual(linePaths(form.previewEl).map((p) => p.getAttribute('stroke')), ['#123456'], 'the preview shows it');
  await form.save();
  assert.equal(spec.tiles[0].color, '#123456');
  assert.equal(spec.tiles[0].guideColor, '#cccccc');
});

test('the edit screen: a theme colour, back to the theme default, a colour from your CSS kept, bars without a scrub line', async () => {
  const { form } = await openForm(parse(lineTile({ color: 'var(--my-gold)' })).spec.tiles[0]);
  const lineSel = field(form, 'SELECT', 'Colour of the line');
  assert.equal(selected(lineSel).textContent, 'From your CSS: var(--my-gold)');
  assert.equal(form.buildTile().tile.color, 'var(--my-gold)', 'kept, never overwritten');
  lineSel.value = 'var(--color-orange)';
  lineSel.handlers.change[0]();
  assert.equal(form.buildTile().tile.color, 'var(--color-orange)');
  field(form, 'SELECT', 'Colour of the line').value = '';
  field(form, 'SELECT', 'Colour of the line').handlers.change[0]();
  assert.equal(form.buildTile().tile.color, undefined, 'Theme default leaves the file without a colour');
  form.state.viz = 'bar';
  form.state.guideColor = '#cccccc';
  form.renderForm();
  assert.ok(field(form, 'SELECT', 'Colour of the bars'));
  assert.equal(field(form, 'SELECT', 'Colour of the line that follows the pointer'), undefined, 'a bar chart has no scrub line');
  assert.equal(form.buildTile().tile.guideColor, undefined, 'and does not save one');
  form.state.viz = 'stat';
  form.renderForm();
  assert.equal(field(form, 'SELECT', 'Colour of the bars'), undefined, 'a stat has no chart colour');
  form.state.viz = 'line';
  form.state.y = 'km, laps';
  form.state.color = '#112233';
  form.renderForm();
  assert.equal(field(form, 'SELECT', 'Colour of the line'), undefined, 'several series: no single colour');
  assert.equal(form.buildTile().tile.color, undefined);
});
