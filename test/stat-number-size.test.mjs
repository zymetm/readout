/* A STAT WIDGET CAN SIZE ITS OWN NUMBER, OR SHRINK IT TO FIT.
 *
 * A stat tile's number took its size from the plugin, the theme and any
 * snippet, with no way to choose it per tile; a long reading like
 * "140/78" could end in an ellipsis on a small tile. "valueSize" sets the
 * number's size in whole pixels (12 to 120), or "fit": start at the
 * theme's size and get smaller until the number shows whole. These gates
 * pin the rules: without it nothing changes; a size is set on the number
 * itself, so it beats any stylesheet rule; "fit" shrinks only as far as
 * needed, never below 12 px, grows back when there is room, and lets the
 * caption fit after it; the spec refuses it where it means nothing, in
 * plain words; it survives the spec file, a built widget, the desktop
 * cache and the edit form. Every value here is invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeFakeAdapter } from './harness.mjs';

const { lib, obsidian } = loadPlugin();

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byClass = (root, cls) => [...walkEl(root)].filter((e) => e.classSet && e.classSet.has(cls));
const freshEl = () => new obsidian.Modal({}).contentEl;
const parse = (tile) => lib.parseDashboardSpec(JSON.stringify({ id: 'ns', title: 'Sizes', database: '07 Databases/x.db', tiles: [tile] }));
const statTile = (extra) => Object.assign({ title: 'Reading', viz: 'stat', y: 'value', sql: "SELECT '121/79' AS value" }, extra);
const TABLE = { columns: ['value', 'note'], rows: [['121/79', 'as of today']] };
const numberOf = (el) => byClass(el, 'icor-sqlv-stat-value')[0];

function draw(tile, table, extras) {
  const el = freshEl();
  lib.renderTile(el, tile, table || TABLE, extras || {});
  return el;
}

test('THE LIMIT: without "valueSize" the number carries no size of its own', () => {
  const el = draw({ viz: 'stat', y: ['value'] });
  assert.equal(numberOf(el).style['font-size'], undefined, 'the theme and the snippet decide, as before');
});

test('a size in pixels is set on the number itself, so no stylesheet rule can beat it', () => {
  assert.equal(numberOf(draw({ viz: 'stat', y: ['value'], valueSize: 48 })).style['font-size'], '48px');
  assert.equal(numberOf(draw({ viz: 'stat', y: ['value'], valueSize: 12 })).style['font-size'], '12px');
});

test('the spec keeps "valueSize" and names what is wrong, in plain words', () => {
  for (const v of [12, 48, 120, 'fit']) {
    const r = parse(statTile({ valueSize: v }));
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.spec.tiles[0].valueSize, v);
  }
  assert.equal(parse(statTile({})).spec.tiles[0].valueSize, undefined);
  const built = parse({ title: 'Built', viz: 'stat', valueSize: 'fit', source: { table: 't', metric: 'v', agg: 'latest', timeColumn: 'd' } });
  assert.equal(built.ok, true, built.reason);
  assert.equal(built.spec.tiles[0].valueSize, 'fit');
  const bad = [
    [statTile({ valueSize: 11 }), /"valueSize" must be a whole number of pixels from 12 to 120, or "fit"/],
    [statTile({ valueSize: 121 }), /"valueSize" must be a whole number/],
    [statTile({ valueSize: 40.5 }), /"valueSize" must be a whole number/],
    [statTile({ valueSize: '48' }), /"valueSize" must be a whole number/],
    [statTile({ valueSize: 'shrink' }), /"valueSize" must be a whole number/],
    [{ title: 'L', viz: 'line', x: 'd', y: 'v', sql: 'SELECT 1 AS d, 2 AS v', valueSize: 48 }, /"valueSize" only works on a stat widget/],
    [{ title: 'B', viz: 'bar', valueSize: 48, source: { table: 't', metric: 'v', agg: 'sum', timeColumn: 'd' } }, /"valueSize" only works on a stat widget/],
  ];
  for (const [tile, re] of bad) {
    const r = parse(tile);
    assert.equal(r.ok, false, JSON.stringify(tile));
    assert.match(r.reason, re);
    assert.match(r.reason, /^Tile 1: /);
  }
});

test('"valueSize" survives the spec file, and a built widget draws with it', () => {
  for (const v of [48, 'fit']) {
    const json = lib.specToJson(parse(statTile({ valueSize: v })).spec);
    assert.equal(JSON.parse(json).tiles[0].valueSize, v);
    assert.equal(lib.parseDashboardSpec(json).spec.tiles[0].valueSize, v);
  }
  assert.equal('valueSize' in JSON.parse(lib.specToJson(parse(statTile({})).spec)).tiles[0], false, 'unset stays out of the file');
  const built = parse({ title: 'Built', viz: 'stat', valueSize: 64, source: { table: 't', metric: 'v', agg: 'latest', timeColumn: 'd' } }).spec;
  assert.equal(JSON.parse(lib.specToJson(built)).tiles[0].valueSize, 64);
  const prepared = lib.prepareTileForRender(built.tiles[0], { columns: ['value'], rows: [[7]] });
  assert.equal(numberOf(draw(prepared.spec, prepared.table)).style['font-size'], '64px');
});

/* ----------------------------------------------------- shrink to fit -- */

test('the step: smaller in proportion, at least a pixel, never below 12, unchanged when it fits', () => {
  assert.equal(lib.nextFitSize(36, 150, 150), 36, 'fits: unchanged');
  assert.equal(lib.nextFitSize(36, 150, 151), 36, 'within a pixel counts as fitting');
  assert.equal(lib.nextFitSize(36, 150, 200), 27);
  assert.equal(lib.nextFitSize(36, 150, 153), 35, 'at least one pixel smaller');
  assert.equal(lib.nextFitSize(14, 10, 400), 12, 'never below 12');
  assert.equal(lib.nextFitSize(36, 0, 200), 36, 'no layout yet: unchanged');
});

/* A number line whose width follows its font size, like a browser's. */
function fitRig(chars) {
  const observers = [];
  class FakeResizeObserver {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe() { this.cb([]); }
    disconnect() {}
  }
  const fresh = loadPlugin({ globals: { ResizeObserver: FakeResizeObserver } });
  const stat = new fresh.obsidian.Modal({}).contentEl;
  const line = stat.createDiv({ cls: 'icor-sqlv-stat-value' });
  const theme = { size: 36 };
  stat.win = { getComputedStyle: () => ({ fontSize: theme.size + 'px' }) };
  stat.isConnected = true;
  const px = () => { const own = parseFloat(line.style['font-size']); return Number.isFinite(own) ? own : theme.size; };
  Object.defineProperty(line, 'scrollWidth', { get: () => Math.ceil(chars * px() * 0.6) });
  Object.defineProperty(line, 'clientWidth', { get: () => stat.clientWidth });
  return { fresh, stat, line, observers, theme, px };
}

test('"fit" shrinks the number until it shows whole, grows back when there is room, and stops at 12 px', () => {
  const { fresh, stat, line, observers, px } = fitRig(6);
  let captionFits = 0;
  stat.clientWidth = 100;
  const fit = fresh.lib.fitStatValue(stat, line, undefined, () => { captionFits++; });
  assert.equal(typeof fit, 'function');
  assert.ok(line.scrollWidth <= line.clientWidth + 1, 'whole at 100px: ' + line.scrollWidth);
  assert.ok(px() < 36 && px() >= 25, 'only as small as needed: ' + px());
  assert.equal(captionFits, 1, 'the caption fits after the number');
  stat.clientWidth = 400;
  observers[0].cb([]);
  assert.equal(px(), 36, 'room again: back to the theme size');
  stat.clientWidth = 20;
  observers[0].cb([]);
  assert.equal(px(), 12, 'never below 12 px, even if it still does not fit');
  const before = captionFits;
  observers[0].cb([]);
  assert.equal(captionFits, before, 'a height-only change does not re-fit');
});

test('"fit" starts from the theme or snippet size, whatever it is', () => {
  const { fresh, stat, line, theme, px } = fitRig(6);
  theme.size = 20;
  stat.clientWidth = 400;
  fresh.lib.fitStatValue(stat, line, undefined, null);
  assert.equal(px(), 20);
  assert.equal(line.style['font-size'], undefined, 'no size of its own when the theme size already fits: removed, not set to an empty literal');
});

test('a "fit" stat tile measures itself; a tile with a fixed size or none adds no observer', () => {
  const observers = [];
  class FakeResizeObserver { constructor(cb) { this.cb = cb; } observe() {} disconnect() {} }
  const fresh = loadPlugin({ globals: { ResizeObserver: FakeResizeObserver } });
  const count = (tile) => {
    const list = [];
    fresh.lib.renderTile(new fresh.obsidian.Modal({}).contentEl, tile, { columns: ['value'], rows: [['121/79']] }, { observers: list });
    return list.length;
  };
  assert.equal(count({ viz: 'stat', y: ['value'] }), 0);
  assert.equal(count({ viz: 'stat', y: ['value'], valueSize: 48 }), 0);
  assert.equal(count({ viz: 'stat', y: ['value'], valueSize: 'fit' }), 1, 'and it joins the view\'s observers, so it closes with the view');
  void observers;
});

/* ---------------------------------------------- the view and the cache -- */

const DASH = '07 Databases/Dashboards/ns.json';
const CACHE = '07 Databases/Dashboard Cache/dashboards/ns.md';
const SPEC = { id: 'ns', title: 'Sizes', database: '07 Databases/x.db', tiles: [statTile({ valueSize: 48 })] };
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

test('a phone shows the same number size from the desktop cache', async () => {
  const desk = await makeView({ [DASH]: JSON.stringify(SPEC) }, { '07 Databases/x.db': new Uint8Array([1]) });
  desk.plugin.query.engineFor = async () => ({ engine: 'cli', size: 1 });
  desk.plugin.query.query = async () => ({ columns: TABLE.columns, rows: TABLE.rows, ms: 1 });
  await desk.view.onOpen();
  await settle();
  assert.equal(numberOf(desk.view.contentEl).style['font-size'], '48px');
  const cache = desk.adapter.files.get(CACHE);
  assert.ok(cache, 'the desktop wrote its cache');
  const phone = await makeView({ [DASH]: JSON.stringify(SPEC), [CACHE]: cache }, { '07 Databases/x.db': new Uint8Array([1]) }, { desktop: false });
  phone.plugin.query.engineFor = async () => ({ engine: null, reason: 'Too big for this device.' });
  await phone.view.onOpen();
  await settle();
  assert.equal(numberOf(phone.view.contentEl).style['font-size'], '48px');
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
const choose = (form, value) => { const sel = field(form, 'SELECT', 'Size of the number'); sel.value = value; sel.handlers.change[0](); };

test('the edit screen offers the number size: theme default, four sizes, shrink to fit, custom; and saves it', async () => {
  const { form, spec } = await openForm(parse(statTile({})).spec.tiles[0]);
  const sel = field(form, 'SELECT', 'Size of the number');
  assert.ok(sel, 'the field is on the form');
  assert.deepEqual(sel.children.map((o) => o.textContent),
    ['Theme default', 'Small (24 px)', 'Medium (34 px)', 'Large (48 px)', 'Extra large (64 px)', 'Shrink to fit', 'Custom']);
  assert.equal(selected(sel).value, '');
  choose(form, 'fit');
  assert.equal(form.buildTile().tile.valueSize, 'fit');
  choose(form, '48');
  assert.equal(form.buildTile().tile.valueSize, 48);
  choose(form, 'custom');
  const input = field(form, 'INPUT', 'Number size in pixels');
  assert.ok(input, 'Custom opens a number box');
  assert.equal(input.value, '48', 'it starts from the size chosen before');
  input.value = '52';
  input.handlers.input[0]();
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(form.previewState, 'ok');
  assert.equal(numberOf(form.previewEl).style['font-size'], '52px', 'the preview shows it');
  await form.save();
  assert.equal(spec.tiles[0].valueSize, 52);
});

test('the edit screen: a custom size reopens as Custom, a wrong one is named, Theme default clears it', async () => {
  const { form } = await openForm(parse(statTile({ valueSize: 40 })).spec.tiles[0]);
  assert.equal(selected(field(form, 'SELECT', 'Size of the number')).value, 'custom');
  const input = field(form, 'INPUT', 'Number size in pixels');
  assert.equal(input.value, '40');
  for (const bad of ['', '8', 'big', '40.5']) {
    input.value = bad;
    input.handlers.input[0]();
    assert.equal(form.buildTile().ok, false, 'refused: ' + JSON.stringify(bad));
    assert.match(form.buildTile().reason, /whole number of pixels from 12 to 120/);
  }
  choose(form, '');
  assert.equal(form.buildTile().tile.valueSize, undefined);
  const preset = await openForm(parse(statTile({ valueSize: 64 })).spec.tiles[0]);
  assert.equal(selected(field(preset.form, 'SELECT', 'Size of the number')).value, '64');
  form.state.viz = 'line';
  form.state.x = 'd';
  form.renderForm();
  assert.equal(field(form, 'SELECT', 'Size of the number'), undefined, 'a chart has no number size');
});

test('the edit screen keeps the number size on a built stat widget', async () => {
  const tile = parse({ title: 'Built', viz: 'stat', valueSize: 'fit', source: { table: 't', metric: 'v', agg: 'latest', timeColumn: 'd' } }).spec.tiles[0];
  const { form } = await openForm(tile);
  assert.equal(form.state.valueSize, 'fit');
  assert.equal(form.buildTile().tile.valueSize, 'fit');
  form.state.valueSize = '24';
  assert.equal(form.buildTile().tile.valueSize, 24);
});
