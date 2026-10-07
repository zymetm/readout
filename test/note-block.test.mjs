/* A WIDGET INSIDE A NOTE: A CODE BLOCK THAT DRAWS ONE, READ-ONLY.
 *
 * A note can hold a code block (the language is the one constant
 * WIDGET_BLOCK_LANG) that draws a single widget: either a named widget of a
 * saved dashboard (so the note follows the dashboard), or one written out
 * as JSON. Both read like the dashboards do: live where the device can open
 * the database, otherwise from the desktop's cache. These gates pin: how a
 * block's text is read and refused, in plain words; that a named widget
 * draws live and from the dashboard's cache on a phone, and never writes
 * that cache; that a written-out widget keeps a small cache of its own on
 * the desktop and reads it on a phone; that every failure is a line in the
 * block, never an exception into the note; and that the block releases its
 * resize observers when the note goes. Every value here is invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeFakeAdapter, unwrap } from './harness.mjs';

const { lib } = loadPlugin();

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byClass = (root, cls) => [...walkEl(root)].filter((e) => e.classSet && e.classSet.has(cls));
const byAttrClass = (root, cls) => [...walkEl(root)].filter((e) => e.getAttribute && e.getAttribute('class') === cls);
const settle = () => new Promise((r) => setTimeout(r, 25));
const textOf = (el) => [...walkEl(el)].map((e) => e.textContent || '').join(' ');

/* ------------------------------------------------------ reading a block -- */

test('the block language is one constant, and a named widget is read from "dashboard:" and "widget:" lines', () => {
  assert.equal(lib.WIDGET_BLOCK_LANG, 'readout');
  assert.deepEqual(unwrap(lib.parseWidgetBlock('dashboard: sales\nwidget: Orders per day\n')), { ok: true, kind: 'ref', dashboard: 'sales', widget: 'Orders per day' });
  assert.deepEqual(unwrap(lib.parseWidgetBlock('  Widget : 3\r\n DASHBOARD: sales  ')), { ok: true, kind: 'ref', dashboard: 'sales', widget: 3 }, 'a number counts from 1; case and spaces do not matter');
  assert.equal(lib.parseWidgetBlock('dashboard: a\nwidget: Rate: resting').widget, 'Rate: resting', 'a title may hold a colon');
});

test('a written-out widget runs through the dashboard parser, so every dashboard rule applies', () => {
  const r = lib.parseWidgetBlock('{ "database": "Databases/shop.db", "title": "Orders", "viz": "bar", "x": "day", "y": "orders", "sql": "SELECT day, orders FROM sales" }');
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.kind, 'inline');
  assert.equal(r.spec.database, 'Databases/shop.db');
  assert.equal(r.spec.tiles[0].viz, 'bar');
  assert.match(r.key, /^[0-9a-f]{8}$/);
  /* The key follows what the block says, not how it is spaced. */
  const spaced = lib.parseWidgetBlock('{\n "sql": "SELECT day, orders FROM sales", "y": "orders", "x": "day", "viz": "bar", "title": "Orders", "database": "Databases/shop.db" }');
  assert.equal(spaced.key, r.key);
  const other = lib.parseWidgetBlock('{ "database": "Databases/shop.db", "title": "Orders", "viz": "bar", "x": "day", "y": "orders", "sql": "SELECT day, returns FROM sales" }');
  assert.notEqual(other.key, r.key);
  /* Read-only: the same gate as a dashboard. */
  const write = lib.parseWidgetBlock('{ "database": "d.db", "viz": "table", "sql": "DELETE FROM sales" }');
  assert.equal(write.ok, false);
  assert.match(write.reason, /^The widget/);
});

test('a block that makes no sense says why, in plain words', () => {
  const bad = [
    ['', /The block is empty/],
    ['   \n ', /The block is empty/],
    ['dashboard: sales', /needs a "widget:" line/],
    ['widget: 2', /needs a "dashboard:" line/],
    ['dashboard: a\nwidget: b\ncolour: red', /knows "dashboard" and "widget", not "colour"/],
    ['dashboard sales', /Each line of a block is "name: value"/],
    ['{ "viz": ', /not valid JSON/],
    ['{ "id": "x", "title": "x", "tiles": [] }', /one widget, not a whole dashboard/],
    ['{ "viz": "bar", "x": "a", "y": "b", "sql": "SELECT 1" }', /the block needs a "database"/],
    ['{ "database": "d.db", "viz": "radar", "sql": "SELECT 1" }', /^The widget needs a "viz"/],
  ];
  for (const [text, re] of bad) {
    const r = lib.parseWidgetBlock(text);
    assert.equal(r.ok, false, JSON.stringify(text));
    assert.match(r.reason, re, JSON.stringify(text));
  }
});

test('a widget is found by its number from 1 or by its title, dividers counted', () => {
  const spec = { tiles: [{ title: 'Sales', viz: 'divider' }, { title: 'Orders per day', viz: 'bar' }, { title: 'Rate', viz: 'line' }] };
  assert.equal(lib.widgetIndexIn(spec, 2), 1);
  assert.equal(lib.widgetIndexIn(spec, 1), 0);
  assert.equal(lib.widgetIndexIn(spec, 0), -1);
  assert.equal(lib.widgetIndexIn(spec, 4), -1);
  assert.equal(lib.widgetIndexIn(spec, ' orders PER day '), 1);
  assert.equal(lib.widgetIndexIn(spec, 'nothing'), -1);
  assert.deepEqual(['divider', 'text', 'stat', 'bar', 'table', 'pie'].map((viz) => lib.blockSizeFor({ viz })), ['thin', 'short', 'short', 'chart', 'chart', 'chart']);
  assert.equal(lib.blockSizeFor({ viz: 'text', line: true }), 'thin');
  assert.equal(lib.blockCachePath('Databases/Dashboard Cache', 'abc12345'), 'Databases/Dashboard Cache/notes/abc12345.json');
});

/* ------------------------------------------------------- in a vault -- */

const DASH_PATH = '07 Databases/Dashboards/sales.json';
const CACHE_PATH = '07 Databases/Dashboard Cache/dashboards/sales.json';
const DB = '07 Databases/shop.db';
const SALES = {
  id: 'sales', title: 'Sales', database: DB,
  tiles: [
    { title: 'Sales', viz: 'divider' },
    { title: 'Orders by channel', viz: 'pie', x: 'channel', y: ['orders'], unit: 'orders', sql: 'SELECT channel, orders FROM sales', doughnut: true },
    { title: 'Note', viz: 'text', text: 'Invented numbers.' },
  ],
};
const ROWS = { columns: ['channel', 'orders'], rows: [['Web', 60], ['Shop', 40]] };
const INLINE = JSON.stringify({ database: DB, title: 'Orders per channel', viz: 'bar', x: 'channel', y: 'orders', sql: 'SELECT channel, orders FROM sales' });

async function makeNote(files, { desktop = true, engine = true, globals } = {}) {
  const fresh = loadPlugin({ desktop, globals });
  const adapter = makeFakeAdapter(files, { [DB]: new Uint8Array([1]) });
  const app = { vault: { adapter, getFiles: () => [] }, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  plugin.app = app;
  await plugin.onload();
  const queries = [];
  plugin.query.engineFor = async () => (engine ? { engine: 'cli', size: 1 } : { engine: null, reason: 'Too big for this device.' });
  plugin.query.query = async (db, sql) => { queries.push(sql); return Object.assign({ ms: 1 }, ROWS); };
  const block = async (source) => {
    const el = new fresh.obsidian.Modal({}).contentEl;
    const children = [];
    plugin.codeBlocks[fresh.lib.WIDGET_BLOCK_LANG](source, el, { addChild: (c) => children.push(c) });
    assert.equal(children.length, 1, 'the block is a child of its note');
    assert.ok(children[0] instanceof fresh.obsidian.MarkdownRenderChild);
    children[0].onload();
    await settle();
    return { el, child: children[0] };
  };
  return { plugin, adapter, queries, block, fresh };
}

test('the plugin registers the block next to the help samples', async () => {
  const { plugin } = await makeNote({});
  assert.equal(typeof plugin.codeBlocks['readout'], 'function');
  assert.equal(typeof plugin.codeBlocks['readout-sample'], 'function', 'the help file samples stay');
});

test('a named widget draws live on the desktop, read-only, and never writes the dashboard cache', async () => {
  const { adapter, queries, block } = await makeNote({ [DASH_PATH]: JSON.stringify(SALES) });
  const { el } = await block('dashboard: sales\nwidget: Orders by channel');
  assert.deepEqual(queries, ['SELECT channel, orders FROM sales']);
  assert.equal(byAttrClass(el, 'icor-sqlv-pie-slice').length, 2, 'the pie of the dashboard');
  assert.equal(byAttrClass(el, 'icor-sqlv-pie-total').length, 1, 'with the settings of the dashboard (a doughnut)');
  const box = byClass(el, 'icor-sqlv-block')[0];
  assert.ok(box.classSet.has('is-chart'));
  assert.equal(box.getAttribute('data-ink-plugin'), 'icor-for-life-sqlite-viewer', 'the colour tokens reach it');
  assert.equal(byClass(el, 'icor-sqlv-tile-actions').length, 0, 'no edit or remove buttons: read-only');
  assert.deepEqual(adapter.log.filter(([op]) => op === 'write'), [], 'a named widget writes nothing');
});

test('a named widget is found by its number, and a text widget needs no database at all', async () => {
  const { queries, block } = await makeNote({ [DASH_PATH]: JSON.stringify(SALES) }, { engine: false });
  const num = await block('dashboard: sales\nwidget: 3');
  assert.match(textOf(num.el), /Invented numbers\./);
  assert.deepEqual(queries, []);
  assert.ok(byClass(num.el, 'icor-sqlv-block')[0].classSet.has('is-short'));
});

test('a phone draws a named widget from the dashboard cache, at the widget\'s own place in it', async () => {
  const cache = { dashboardId: 'sales', title: 'Sales', computedAt: new Date(Date.now() - 3600 * 1000).toISOString(), tiles: [Object.assign({}, SALES.tiles[0]), Object.assign({}, SALES.tiles[1], ROWS), Object.assign({}, SALES.tiles[2])] };
  const { queries, block } = await makeNote({ [DASH_PATH]: JSON.stringify(SALES), [CACHE_PATH]: JSON.stringify(cache) }, { desktop: false, engine: false });
  const { el } = await block('dashboard: sales\nwidget: Orders by channel');
  assert.deepEqual(queries, [], 'no query on the phone');
  assert.equal(byAttrClass(el, 'icor-sqlv-pie-slice').length, 2, 'the cached rows, found past the divider that holds slot 0');
  assert.match(textOf(el), /Computed on desktop, /);
});

test('a phone with no cache yet says what to do, in the block', async () => {
  const named = await makeNote({ [DASH_PATH]: JSON.stringify(SALES) }, { desktop: false, engine: false });
  const a = await named.block('dashboard: sales\nwidget: Orders by channel');
  assert.match(textOf(a.el), /Too big for this device\. No cached result yet\. Open this dashboard once on the desktop and sync\./);
  const inline = await makeNote({}, { desktop: false, engine: false });
  const b = await inline.block(INLINE);
  assert.match(textOf(b.el), /No cached result yet\. Open this note once on the desktop and sync\./);
});

test('a written-out widget draws, keeps one small cache of its own on the desktop, and a phone reads it', async () => {
  const desk = await makeNote({});
  const { el } = await desk.block(INLINE);
  assert.equal(byClass(el, 'icor-sqlv-block').length, 1);
  assert.ok(byClass(el, 'icor-sqlv-chart-box').length >= 1, 'the bar chart');
  const key = lib.parseWidgetBlock(INLINE).key;
  const path = '07 Databases/Dashboard Cache/notes/' + key + '.json';
  assert.ok(desk.adapter.files.has(path), 'filed by the block\'s key');
  const written = JSON.parse(desk.adapter.files.get(path));
  assert.deepEqual(written.result.rows, ROWS.rows);
  assert.equal(desk.adapter.log.filter(([op, p]) => op === 'write' && p === path).length, 1);
  /* Drawn again in the same session: not written again. */
  await desk.block(INLINE);
  assert.equal(desk.adapter.log.filter(([op, p]) => op === 'write' && p === path).length, 1, 'once per session per block');
  assert.ok(![...desk.adapter.files.keys()].some((p) => p.includes('/dashboards/')), 'never the dashboard cache');

  const phone = await makeNote({ [path]: desk.adapter.files.get(path) }, { desktop: false, engine: false });
  const p = await phone.block(INLINE);
  assert.deepEqual(phone.queries, []);
  assert.ok(byClass(p.el, 'icor-sqlv-chart-box').length >= 1, 'the phone draws the same chart from the file');
  assert.match(textOf(p.el), /Computed on desktop, /);
  assert.deepEqual(phone.adapter.log.filter(([op]) => op === 'write'), [], 'a phone writes nothing');
});

test('every failure is a line in the block, never an exception into the note', async () => {
  const { block, plugin } = await makeNote({ [DASH_PATH]: JSON.stringify(SALES) });
  assert.match(textOf((await block('dashboard: nope\nwidget: 1')).el), /There is no dashboard "nope"\./);
  assert.match(textOf((await block('dashboard: sales\nwidget: Nothing here')).el), /has no widget titled "Nothing here"/);
  assert.match(textOf((await block('dashboard: sales\nwidget: 9')).el), /has no widget number 9/);
  assert.match(textOf((await block('')).el), /The block is empty/);
  plugin.query.query = async () => { throw new Error('no such table: sales'); };
  assert.match(textOf((await block('dashboard: sales\nwidget: 2')).el), /no such table: sales/);
  plugin.query.engineFor = async () => { throw new Error('the engine exploded'); };
  assert.match(textOf((await block('dashboard: sales\nwidget: 2')).el), /This widget could not be drawn: the engine exploded\./);
});

test('a block releases its resize observers when the note goes, ', async () => {
  const made = [];
  class FakeRO { constructor(cb) { this.cb = cb; this.gone = false; made.push(this); } observe() {} disconnect() { this.gone = true; } }
  const { block } = await makeNote({ [DASH_PATH]: JSON.stringify(SALES) }, { globals: { ResizeObserver: FakeRO } });
  /* A line chart measures its box; the calendar watches its scroll box. */
  const { child } = await block('{ "database": "' + DB + '", "viz": "line", "x": "channel", "y": "orders", "sql": "SELECT channel, orders FROM sales" }');
  assert.ok(made.length >= 1, 'the chart watches its size');
  assert.ok(made.every((o) => !o.gone));
  child.onunload();
  assert.ok(made.every((o) => o.gone), 'released when the block goes');
});

/* ------------------------------------------------------------- the docs -- */

test('the help file and the AI guide document the block, and show it as text, never as a live block', () => {
  for (const [name, text] of [['help file', lib.DASHBOARD_README], ['AI guide', lib.AI_WIDGET_GUIDE]]) {
    assert.match(text, /dashboard: [a-z-]+\n/, name + ' shows the named form');
    assert.ok(text.includes('`' + lib.WIDGET_BLOCK_LANG + '`'), name + ' names the language word');
    /* An example is indented, so the plugin does not draw it as a block of its own. */
    const fenced = text.split('\n').filter((l) => l.startsWith('```' + lib.WIDGET_BLOCK_LANG) && !l.startsWith('```' + lib.WIDGET_BLOCK_LANG + '-sample'));
    assert.deepEqual(fenced, [], name + ': no unindented live block');
  }
  assert.match(lib.AI_WIDGET_GUIDE, /## 9\. A widget inside a note/);
});
