/* A ROLL-UP IN A CHART'S TITLE ROW.
 *
 * A line or bar chart could show only its change over the period at the
 * right of its title row ("headerDelta"). "chartCaption" puts a roll-up
 * in that same right corner, computed at render time from the rows it
 * plots: "range" is the lowest to the highest value, "change" is the
 * same change "headerDelta" shows (and honours "headerDeltaAverageDays").
 * With "headerDelta" as well, the change comes first: "a · b". One
 * line, never wrapped, on the title's row: the title is cut with an
 * ellipsis first, the roll-up stays whole, full text on hover. Nothing is added under the
 * chart. These gates pin the text, the refusals, the file, the phone
 * cache and the edit screen. Every value here is invented.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeFakeAdapter } from './harness.mjs';

const { lib, obsidian } = loadPlugin();

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byClass = (root, cls) => [...walkEl(root)].filter((e) => e.classSet && e.classSet.has(cls));
const parse = (tile) => lib.parseDashboardSpec(JSON.stringify({ id: 'd', title: 'D', database: '07 Databases/x.db', tiles: [tile] }));

const TABLE = { columns: ['day', 'weight'], rows: [
  ['2026-03-01', 101.26], ['2026-03-02', null], ['2026-03-03', 98.5], ['2026-03-04', 'n/a'], ['2026-03-05', 99], ['2026-03-06', 97.04],
] };
const LINE = { title: 'Weight', viz: 'line', x: 'day', y: ['weight'], unit: 'lb' };

function draw(tile, table) {
  const el = new obsidian.Modal({}).contentEl;
  lib.renderTile(el, tile, table || TABLE, {});
  return el;
}

/* ------------------------------------------------------------ the text -- */

test('THE LIMIT: without the option a chart tile is a title and a chart, nothing else', () => {
  const el = draw(LINE);
  assert.deepEqual(el.children.map((c) => [...c.classSet][0]), ['icor-sqlv-tile-title', 'icor-sqlv-tile-body']);
});

test('"range": the lowest to the highest plotted value, one decimal (whole numbers stay whole), the unit once', () => {
  const r = lib.chartRangeOf(TABLE, LINE);
  assert.equal(r.text, '97.0\u2013101.3 lb');
  assert.equal(r.hover, 'Lowest 97.0 lb (2026-03-06), highest 101.3 lb (2026-03-01)');
  assert.equal(lib.chartRangeOf({ columns: ['day', 'steps'], rows: [['a', 1200], ['b', 15034]] }, { x: 'day', y: ['steps'] }).text, '1,200\u201315,034');
  assert.equal(lib.chartRangeOf({ columns: ['day', 'weight'], rows: [['a', null]] }, LINE), null, 'nothing to show');
  assert.equal(lib.chartRangeOf(TABLE, Object.assign({}, LINE, { y: ['nope'] })), null);
});

test('"change": the same text and hover as the title-row change', () => {
  const tile = Object.assign({}, LINE, { chartCaption: 'change' });
  const c = lib.chartCaptionOf(TABLE, tile);
  const d = lib.headerDeltaOf(TABLE, tile);
  assert.equal(c.text, '\u2198 \u22124.2 lb');
  assert.equal(c.text, d.text);
  assert.equal(c.hover, d.hover);
});

/* ------------------------------------------------------------ the tile -- */

test('the roll-up sits at the right of the title row, and nothing is added under the chart', () => {
  const el = draw(Object.assign({}, LINE, { chartCaption: 'range' }));
  assert.deepEqual(el.children.map((c) => [...c.classSet][0]), ['icor-sqlv-tile-titlebar', 'icor-sqlv-tile-body'], 'the chart keeps all the height below the title row');
  const [bar] = el.children;
  assert.ok(bar.classSet.has('has-rollup'));
  assert.deepEqual(bar.children.map((c) => [...c.classSet][0]), ['icor-sqlv-tile-title', 'icor-sqlv-head-rollup']);
  const chip = bar.children[1];
  assert.equal(chip.textContent, '97.0\u2013101.3 lb');
  assert.match(chip.getAttribute('title'), /^Lowest 97.0 lb/, 'the full text on hover');
  assert.equal(byClass(el, 'icor-sqlv-head-delta').length, 0);
});

test('with headerDelta too: one line in the corner, the change first, both hovers', () => {
  const el = draw(Object.assign({}, LINE, { headerDelta: true, chartCaption: 'range' }));
  const chip = byClass(el, 'icor-sqlv-head-rollup')[0];
  assert.equal(chip.textContent, '\u2198 \u22124.2 lb \u00b7 97.0\u2013101.3 lb');
  assert.match(chip.getAttribute('title'), /^From .*\nLowest 97.0 lb/);
  assert.equal(byClass(el, 'icor-sqlv-head-delta').length, 0, 'one corner text, not two');
  const same = draw(Object.assign({}, LINE, { headerDelta: true, chartCaption: 'change' }));
  assert.equal(byClass(same, 'icor-sqlv-head-rollup')[0].textContent, '\u2198 \u22124.2 lb', 'the same change is never shown twice');
});

test('headerDelta alone is unchanged', () => {
  const el = draw(Object.assign({}, LINE, { headerDelta: true }));
  assert.equal(byClass(el, 'icor-sqlv-head-delta')[0].textContent, '\u2198 \u22124.2 lb');
  assert.equal(byClass(el, 'icor-sqlv-head-rollup').length, 0);
});

test('the roll-up stays whole on one line at the right, the title gives way first (it wraps to two lines)', () => {
  const css = fs.readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
  const rule = /\.icor-sqlv-head-rollup \{([^}]*)\}/.exec(css);
  assert.ok(rule);
  for (const want of [/flex: 0 0 auto/, /margin-left: auto/, /white-space: nowrap/, /max-width: 100%/, /text-overflow: ellipsis/]) assert.match(rule[1], want);
  const row = /\.icor-sqlv-tile-titlebar \{([^}]*)\}/.exec(css);
  assert.match(row[1], /display: flex/, 'title and roll-up share one row');
  assert.doesNotMatch(row[1], /flex-wrap: wrap/);
  const title = /\.icor-sqlv-tile-titlebar > \.icor-sqlv-tile-title \{([^}]*)\}/.exec(css);
  for (const want of [/min-width: 0/, /-webkit-line-clamp: 2/, /overflow: hidden/]) assert.match(title[1], want);
  assert.equal(/has-rollup >/.test(css), false, 'no rule gives the title priority over the roll-up');
  assert.equal(/\.icor-sqlv-chart-caption/.test(css), false, 'no line under the chart');
});

test('the title-row rules are top-level in styles.css, never swallowed by an unclosed rule', () => {
  const css = fs.readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const stack = [];
  const nested = [];
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') {
      const selector = css.slice(Math.max(css.lastIndexOf('}', i), css.lastIndexOf(';', i)) + 1, i).trim();
      if (stack.length && !stack.some((s) => s.startsWith('@'))) nested.push(selector);
      stack.push(selector);
    } else if (css[i] === '}') stack.pop();
  }
  assert.deepEqual(nested, [], 'a rule inside another rule is ignored by the app as written');
  assert.equal(stack.length, 0, 'every rule is closed');
});

test('nothing to show, no roll-up, never an error', () => {
  const el = draw(Object.assign({}, LINE, { chartCaption: 'change' }), { columns: ['day', 'weight'], rows: [['2026-03-01', 1]] });
  assert.equal(byClass(el, 'icor-sqlv-head-rollup').length, 0);
  assert.equal(byClass(el, 'icor-sqlv-error').length, 0);
});

/* ------------------------------------------------------------ the spec -- */

test('the spec accepts it on one-series charts, SQL or built, and keeps it through the file', () => {
  const sql = parse({ title: 'W', viz: 'line', sql: 'SELECT 1', x: 'day', y: 'weight', chartCaption: 'change', headerDeltaAverageDays: 7 });
  assert.equal(sql.ok, true, sql.reason);
  assert.equal(sql.spec.tiles[0].chartCaption, 'change');
  assert.equal(sql.spec.tiles[0].headerDeltaAverageDays, 7, 'N works for the caption without the title-row change');
  assert.equal(sql.spec.tiles[0].headerDelta, undefined);
  const json = JSON.parse(lib.specToJson(sql.spec)).tiles[0];
  assert.equal(json.chartCaption, 'change');
  assert.equal(json.headerDeltaAverageDays, 7);
  const built = parse({ title: 'S', viz: 'bar', chartCaption: 'range', source: { table: 't', metric: 'v', agg: 'sum', timeColumn: 'day' } });
  assert.equal(built.ok, true, built.reason);
  const prepared = lib.prepareTileForRender(built.spec.tiles[0], { columns: ['x', 'value'], rows: [['a', 1], ['b', 3]] });
  assert.equal(prepared.spec.chartCaption, 'range', 'a built chart carries it to the renderer');
  assert.equal(lib.parseDashboardSpec(lib.specToJson(built.spec)).spec.tiles[0].chartCaption, 'range');
});

test('the spec refuses it elsewhere in plain words', () => {
  assert.match(parse({ viz: 'line', sql: 'SELECT 1', x: 'd', y: 'a', chartCaption: 'minmax' }).reason, /^Tile 1: "chartCaption" must be "range" \(lowest to highest\) or "change"/);
  assert.match(parse({ viz: 'stat', sql: 'SELECT 1', chartCaption: 'range' }).reason, /"chartCaption" only works on a line or bar chart with one series/);
  assert.match(parse({ viz: 'line', sql: 'SELECT 1', x: 'd', y: ['a', 'b'], chartCaption: 'range' }).reason, /one series/);
  assert.match(parse({ viz: 'line', sql: 'SELECT 1', x: 'd', y: 'a', chartCaption: 'range', headerDeltaAverageDays: 7 }).reason,
    /"headerDeltaAverageDays" needs "headerDelta": true or "chartCaption": "change"/);
});

/* ------------------------------------------------------- phone and form -- */

test('a phone shows the roll-up from the cached rows', async () => {
  const tile = { title: 'Weight', viz: 'line', sql: 'SELECT day, weight FROM t', x: 'day', y: 'weight', unit: 'lb', chartCaption: 'range' };
  const spec = { id: 'cc', title: 'CC', database: '07 Databases/x.db', tiles: [tile] };
  const cache = { dashboardId: 'cc', title: 'CC', computedAt: new Date().toISOString(), tiles: [Object.assign({}, tile, { y: ['weight'], columns: TABLE.columns, rows: TABLE.rows, ghost: null })] };
  const fresh = loadPlugin({ desktop: false });
  const adapter = makeFakeAdapter({
    '07 Databases/Dashboards/cc.json': JSON.stringify(spec),
    '07 Databases/Dashboard Cache/dashboards/cc.json': JSON.stringify(cache),
  }, { '07 Databases/x.db': new Uint8Array([1]) });
  const app = { vault: { adapter, getFiles: () => [] }, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  await plugin.onload();
  plugin.query.engineFor = async () => ({ engine: null, reason: 'Too big.' });
  const view = plugin.viewFactories['readout-dashboards']({ app });
  view.app = app;
  await view.onOpen();
  await new Promise((r) => setTimeout(r, 20));
  const cap = byClass(view.contentEl, 'icor-sqlv-head-rollup')[0];
  assert.ok(cap, 'drawn from the cache');
  assert.equal(cap.textContent, '97.0\u2013101.3 lb');
});

const byLabel = (root, label) => [...walkEl(root)].find((e) => e.getAttribute && e.getAttribute('aria-label') === label);

test('the edit screen offers the roll-up, shows N for "change", and saves it', async () => {
  const fresh = loadPlugin();
  const adapter = makeFakeAdapter({}, { '07 Databases/x.db': new Uint8Array([1]) });
  const app = { vault: { adapter, getFiles: () => [] }, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  plugin.app = app;
  await plugin.onload();
  plugin.query.engineFor = async () => ({ engine: 'cli', size: 1 });
  plugin.query.query = async () => ({ columns: ['day', 'v'], rows: [['2026-01-01', 1], ['2026-01-02', 2]], ms: 1 });
  const spec = { id: 'd', title: 'D', database: '07 Databases/x.db', globalTimeframe: { preset: '90d' }, tiles: [{ title: 'W', viz: 'line', sql: 'SELECT day, v FROM t', x: 'day', y: ['v'], unit: 'lb' }], path: 'd.json' };
  const form = new fresh.PluginClass.modals.WidgetFormModal(plugin, { saveAndRender: async () => {} }, spec, 0);
  form.open();
  const select = byLabel(form.formEl, 'Roll-up at the right of the title');
  assert.ok(select, 'the SQL form offers it for a one-series chart');
  assert.equal(byLabel(form.formEl, 'Average the ends over N days'), undefined);
  select.value = 'change';
  select.handlers.change[0]();
  const n = byLabel(form.formEl, 'Average the ends over N days');
  assert.ok(n, 'N shows for the change caption');
  n.value = '7';
  n.handlers.input[0]();
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(form.previewState, 'ok');
  assert.equal(byClass(form.previewEl, 'icor-sqlv-head-rollup').length, 1, 'the preview draws it');
  await form.save();
  assert.equal(spec.tiles[0].chartCaption, 'change');
  assert.equal(spec.tiles[0].headerDeltaAverageDays, 7);
  assert.equal(spec.tiles[0].headerDelta, undefined);
  assert.equal(lib.parseDashboardSpec(lib.specToJson(spec)).ok, true);
  form.state.chartCaption = 'range';
  const built = form.buildTile();
  assert.equal(built.tile.chartCaption, 'range');
  assert.equal(built.tile.headerDeltaAverageDays, undefined, 'N only rides with a change');
});
