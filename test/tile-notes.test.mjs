/* A HINT AT THE RIGHT OF A TITLE, AND A FOOTNOTE UNDER A WIDGET.
 *
 * A widget had a title and nothing else to say how to read it. "hint"
 * puts a short, quiet note at the right of the title row ("median by
 * time of day"); "footnote" puts a sentence under the widget. These gates
 * pin the rules: without them nothing changes; the hint joins the title
 * row (beside a change chip when there is one) and the footnote closes
 * the widget, both as plain text with the whole text on hover; they work
 * on every widget but a section divider, on SQL tiles and built widgets;
 * the spec refuses them where they mean nothing, in plain words; they
 * survive the spec file and the desktop cache. Every value here is
 * invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeFakeAdapter } from './harness.mjs';

const { lib, obsidian } = loadPlugin();

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byClass = (root, cls) => [...walkEl(root)].filter((e) => e.classSet && e.classSet.has(cls));
const freshEl = () => new obsidian.Modal({}).contentEl;
const parse = (tile) => lib.parseDashboardSpec(JSON.stringify({ id: 'nt', title: 'Notes', database: '07 Databases/x.db', tiles: [tile] }));
const TABLE = { columns: ['day', 'km'], rows: [['2026-01-01', 3], ['2026-01-02', 5]] };

function draw(tile, table) {
  const el = freshEl();
  lib.renderTile(el, tile, table || TABLE, {});
  return el;
}

test('THE LIMIT: without them a widget has its title and its body only', () => {
  const el = draw({ title: 'Walks', viz: 'line', x: 'day', y: ['km'] });
  assert.equal(byClass(el, 'icor-sqlv-tile-hint').length, 0);
  assert.equal(byClass(el, 'icor-sqlv-tile-footnote').length, 0);
  assert.equal(byClass(el, 'icor-sqlv-tile-titlebar').length, 0, 'the plain title row is untouched');
});

test('the hint joins the title row at its right; the footnote closes the widget', () => {
  const el = draw({ title: 'Walks', viz: 'line', x: 'day', y: ['km'], hint: 'km per day', footnote: 'One dot per walk.' });
  const [bar] = byClass(el, 'icor-sqlv-tile-titlebar');
  assert.ok(bar, 'a title row');
  assert.equal(el.children[0], bar, 'the title row stays first');
  assert.deepEqual(bar.children.map((c) => [...c.classSet][0]), ['icor-sqlv-tile-title', 'icor-sqlv-tile-hint']);
  assert.equal(bar.children[1].textContent, 'km per day');
  assert.equal(bar.children[1].getAttribute('title'), 'km per day');
  const last = el.children[el.children.length - 1];
  assert.ok(last.classSet.has('icor-sqlv-tile-footnote'));
  assert.equal(last.textContent, 'One dot per walk.');
  assert.equal(byClass(el, 'icor-sqlv-tile-title').length, 1, 'the title is moved, never copied');
});

test('beside a change chip the hint joins the same row; a stat and a table take them too', () => {
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push(['2026-01-' + String(i + 1).padStart(2, '0'), 10 + i]);
  const el = draw({ title: 'Walks', viz: 'line', x: 'day', y: ['km'], headerDelta: true, hint: 'per day' }, { columns: ['day', 'km'], rows });
  const bars = byClass(el, 'icor-sqlv-tile-titlebar');
  assert.equal(bars.length, 1);
  assert.deepEqual(bars[0].children.map((c) => [...c.classSet][0]), ['icor-sqlv-tile-title', 'icor-sqlv-head-delta', 'icor-sqlv-tile-hint']);
  const stat = draw({ title: 'Total', viz: 'stat', y: ['km'], hint: 'all time', footnote: 'From every walk.' }, { columns: ['km'], rows: [[8]] });
  assert.equal(byClass(stat, 'icor-sqlv-tile-hint')[0].textContent, 'all time');
  assert.equal(byClass(stat, 'icor-sqlv-tile-footnote')[0].textContent, 'From every walk.');
  const untitled = draw({ viz: 'table', hint: 'raw rows' });
  assert.equal(untitled.children[0].classSet.has('icor-sqlv-tile-titlebar'), true, 'a hint without a title still gets its row');
});

test('the spec keeps them and names what is wrong, in plain words', () => {
  const ok = parse({ title: 'W', viz: 'line', x: 'day', y: 'km', sql: 'SELECT 1', hint: ' km per day ', footnote: ' One dot per walk. ' });
  assert.equal(ok.ok, true, ok.reason);
  assert.equal(ok.spec.tiles[0].hint, 'km per day');
  assert.equal(ok.spec.tiles[0].footnote, 'One dot per walk.');
  const bad = [
    [{ title: 'W', viz: 'line', x: 'day', y: 'km', sql: 'SELECT 1', hint: 'x'.repeat(61) }, /"hint" must be text, 60 characters at most/],
    [{ title: 'W', viz: 'line', x: 'day', y: 'km', sql: 'SELECT 1', footnote: '' }, /"footnote" must be text, 300 characters at most/],
    [{ title: 'W', viz: 'line', x: 'day', y: 'km', sql: 'SELECT 1', hint: 3 }, /"hint" must be text/],
  ];
  for (const [tile, re] of bad) {
    const r = parse(tile);
    assert.equal(r.ok, false, JSON.stringify(tile));
    assert.match(r.reason, re);
    assert.match(r.reason, /^Tile 1: /);
  }
  assert.deepEqual(lib.checkTileNotes({ viz: 'divider', hint: 'x' }, 'Tile 1').ok, false, 'a divider has no hint');
});

test('they survive the spec file, on an SQL tile and on a built widget, and a built widget draws them', () => {
  const back = JSON.parse(lib.specToJson(parse({ title: 'W', viz: 'line', x: 'day', y: 'km', sql: 'SELECT 1', hint: 'h', footnote: 'f' }).spec)).tiles[0];
  assert.equal(back.hint, 'h');
  assert.equal(back.footnote, 'f');
  const built = parse({ title: 'Sleep', viz: 'bar', hint: 'hours', footnote: 'Dated to the wake morning.', source: { table: 'sleep', metric: 'hours', agg: 'avg', timeColumn: 'day' } });
  assert.equal(built.ok, true, built.reason);
  const bback = JSON.parse(lib.specToJson(built.spec)).tiles[0];
  assert.equal(bback.hint, 'hours');
  const prepared = lib.prepareTileForRender(built.spec.tiles[0], { columns: ['x', 'value'], rows: [['2026-01-01', 7]] });
  const el = freshEl();
  lib.renderTile(el, prepared.spec, prepared.table, {});
  assert.equal(byClass(el, 'icor-sqlv-tile-hint')[0].textContent, 'hours');
  assert.equal(byClass(el, 'icor-sqlv-tile-footnote')[0].textContent, 'Dated to the wake morning.');
});

/* ---------------------------------------------- the view and the cache -- */

const DASH = '07 Databases/Dashboards/nt.json';
const CACHE = '07 Databases/Dashboard Cache/dashboards/nt.json';
const SPEC = { id: 'nt', title: 'Notes', database: '07 Databases/x.db', tiles: [{ title: 'W', viz: 'line', x: 'day', y: 'km', sql: 'SELECT 1', hint: 'km per day', footnote: 'One dot per walk.' }] };
const settle = () => new Promise((r) => setTimeout(r, 20));

async function makeView(files, binaries, { desktop = true } = {}) {
  const fresh = loadPlugin({ desktop });
  const adapter = makeFakeAdapter(files, binaries);
  const app = { vault: { adapter, getFiles: () => [] }, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  await plugin.onload();
  const view = plugin.viewFactories['readout-dashboards']({ app });
  view.app = app;
  return { plugin, view, adapter };
}

test('a phone shows the same hint and footnote from the desktop cache', async () => {
  const desk = await makeView({ [DASH]: JSON.stringify(SPEC) }, { '07 Databases/x.db': new Uint8Array([1]) });
  desk.plugin.query.engineFor = async () => ({ engine: 'cli', size: 1 });
  desk.plugin.query.query = async () => ({ columns: TABLE.columns, rows: TABLE.rows, ms: 1 });
  await desk.view.onOpen();
  await settle();
  const cache = desk.adapter.files.get(CACHE);
  assert.ok(cache, 'the desktop wrote its cache');
  const phone = await makeView({ [DASH]: JSON.stringify(SPEC), [CACHE]: cache }, { '07 Databases/x.db': new Uint8Array([1]) }, { desktop: false });
  phone.plugin.query.engineFor = async () => ({ engine: null, reason: 'Too big for this device.' });
  await phone.view.onOpen();
  await settle();
  assert.equal(byClass(phone.view.contentEl, 'icor-sqlv-tile-hint')[0].textContent, 'km per day');
  assert.equal(byClass(phone.view.contentEl, 'icor-sqlv-tile-footnote')[0].textContent, 'One dot per walk.');
});
