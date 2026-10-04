/* A SHADED BAND BETWEEN TWO COLUMNS ON A LINE CHART.
 *
 * A line chart could draw lines only; a range around a line (a low and a
 * high per row: the middle half of the values, a min-to-max envelope) had
 * no shape. "band": {"low", "high"} fills the space between two columns,
 * row by row, in the first line's colour, under the lines. These gates pin
 * the rules: without it nothing changes; with it the band's polygon
 * follows the two columns, breaks at a gap, sits under the line, counts
 * toward the axis, and shows in the hover readout; the spec refuses it
 * where it means nothing, in plain words; it survives the spec file, the
 * desktop cache and an edit from the form. Every value here is invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeFakeAdapter, unwrap } from './harness.mjs';

const { lib, obsidian } = loadPlugin();

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byTag = (root, tag) => [...walkEl(root)].filter((e) => e.tagName === tag.toUpperCase());
const byAttrClass = (root, cls) => [...walkEl(root)].filter((e) => e.getAttribute && e.getAttribute('class') === cls);
const freshEl = () => new obsidian.Modal({}).contentEl;
const parse = (tile) => lib.parseDashboardSpec(JSON.stringify({ id: 'bd', title: 'Band', database: '07 Data/x.db', tiles: [tile] }));
const lineTile = (extra) => Object.assign({ title: 'Spread', viz: 'line', x: 't', y: 'mid', sql: 'SELECT 1 AS t, 2 AS mid, 1 AS lo, 3 AS hi' }, extra);
const TABLE = { columns: ['t', 'lo', 'mid', 'hi'], rows: [['a', 10, 20, 30], ['b', 12, 22, 40], ['c', null, 25, 35], ['d', 14, 24, 34], ['e', 15, 26, 36]] };

function draw(tile, table) {
  const el = freshEl();
  lib.renderTile(el, tile, table || TABLE, {});
  return el;
}
const bands = (el) => byAttrClass(el, 'icor-sqlv-band');

test('THE LIMIT: without "band" a line chart draws its lines only', () => {
  const el = draw({ viz: 'line', x: 't', y: ['mid'] });
  assert.equal(bands(el).length, 0);
});

test('the band fills between the two columns in the line colour, breaks at a gap, and sits under the line', () => {
  const el = draw({ viz: 'line', x: 't', y: ['mid'], color: '#df8f48', band: { low: 'lo', high: 'hi', opacity: 0.18 } });
  const areas = bands(el);
  assert.equal(areas.length, 2, 'row c has no low value, so the band breaks in two');
  for (const a of areas) {
    assert.equal(a.getAttribute('fill'), '#df8f48');
    assert.equal(a.getAttribute('fill-opacity'), '0.18');
  }
  const svg = byTag(el, 'svg')[0];
  const line = svg.children.find((k) => k.tagName === 'PATH' && k.getAttribute('fill') === 'none');
  assert.ok(svg.children.indexOf(areas[1]) < svg.children.indexOf(line), 'the line draws over the band');
  const plain = draw({ viz: 'line', x: 't', y: ['mid'], band: { low: 'lo', high: 'hi' } });
  assert.equal(bands(plain)[0].getAttribute('fill-opacity'), '0.2', 'a default opacity');
  assert.equal(bands(plain)[0].getAttribute('fill'), 'var(--sqlv-series-1)', 'the theme ink when the line has no colour of its own');
});

test('the polygon runs along the high edge, then back along the low edge', () => {
  const xOf = (i) => i * 10;
  const yOf = (v) => 100 - v;
  const paths = lib.bandPaths([[0, 1, 5], [0, 2, 6], [0, null, 7], [0, 3, 9]], 1, 2, xOf, yOf);
  assert.deepEqual(unwrap(paths), ['M 0.0 95.0 L 10.0 94.0 L 10.0 98.0 L 0.0 99.0 Z', 'M 30.0 91.0 L 30.0 97.0 Z']);
  assert.ok(Number.isNaN(lib.cellNumber(null)) && Number.isNaN(lib.cellNumber('')), 'an empty cell is a gap, never a zero');
});

test('the band counts toward the axis, so a fixed top can grow to fit it', () => {
  const el = draw({ viz: 'line', x: 't', y: ['mid'], yMin: 0, yMax: 30, yMaxLimit: 60, band: { low: 'lo', high: 'hi' } });
  const ticks = byTag(el, 'text').filter((t) => t.getAttribute('class') === 'icor-sqlv-tick' && t.getAttribute('text-anchor') === 'end').map((t) => Number(t.textContent));
  assert.equal(Math.max(...ticks), 40, 'the band top (40) raised the axis from 30');
});

test('the hover readout shows the band as a range', () => {
  const el = draw({ viz: 'line', x: 't', y: ['mid'], unit: 'u', band: { low: 'lo', high: 'hi' } });
  const svg = byTag(el, 'svg')[0];
  svg.getBoundingClientRect = () => ({ left: 0, width: 640 });
  const hover = svg.children[svg.children.length - 1];
  hover.handlers.mousemove[0]({ clientX: 0 });
  const readout = byAttrClass(el, 'icor-sqlv-readout')[0];
  assert.equal(readout.textContent, 'a  ·  mid 20 u  ·  lo–hi 10–30 u');
});

test('the spec keeps the band and names what is wrong, in plain words', () => {
  const ok = parse(lineTile({ band: { low: ' lo ', high: 'hi', opacity: 0.18 } }));
  assert.equal(ok.ok, true, ok.reason);
  assert.deepEqual(unwrap(ok.spec.tiles[0].band), { low: 'lo', high: 'hi', opacity: 0.18 });
  assert.equal('band' in parse(lineTile({})).spec.tiles[0], false, 'no band, no key');
  const bad = [
    [lineTile({ band: { low: 'lo' } }), /"band" must name two different columns/],
    [lineTile({ band: { low: 'lo', high: 'lo' } }), /"band" must name two different columns/],
    [lineTile({ band: 'lo-hi' }), /"band" must name two different columns/],
    [lineTile({ band: { low: 'lo', high: 'hi', opacity: 0 } }), /the "band" "opacity" must be a number above 0/],
    [lineTile({ y: ['mid', 'hi'], band: { low: 'lo', high: 'hi' } }), /cannot also be a "y" line/],
    [{ title: 'B', viz: 'bar', x: 't', y: 'mid', sql: 'SELECT 1 AS t, 2 AS mid', band: { low: 'a', high: 'b' } }, /"band" only works on a line chart/],
    [{ title: 'Built', viz: 'line', band: { low: 'a', high: 'b' }, source: { table: 't', metric: 'v', agg: 'sum', timeColumn: 'd' } }, /"band" only works on an SQL line chart/],
  ];
  for (const [tile, re] of bad) {
    const r = parse(tile);
    assert.equal(r.ok, false, JSON.stringify(tile));
    assert.match(r.reason, re);
    assert.match(r.reason, /^Tile 1: /);
  }
});

test('the band survives the spec file and an edit from the form', () => {
  const json = lib.specToJson(parse(lineTile({ band: { low: 'lo', high: 'hi', opacity: 0.18 } })).spec);
  assert.deepEqual(JSON.parse(json).tiles[0].band, { low: 'lo', high: 'hi', opacity: 0.18 });
  assert.deepEqual(unwrap(lib.parseDashboardSpec(json).spec.tiles[0].band), { low: 'lo', high: 'hi', opacity: 0.18 });
  assert.equal(JSON.parse(lib.specToJson(parse(lineTile({})).spec)).tiles[0].band, undefined);
  assert.deepEqual(unwrap(lib.keepUneditedKeys({ viz: 'line' }, { viz: 'line', band: { low: 'a', high: 'b' } }).band), { low: 'a', high: 'b' });
});

/* ---------------------------------------------- the view and the cache -- */

const DASH = '07 Databases/Dashboards/bd.json';
const CACHE = '07 Databases/Dashboard Cache/dashboards/bd.json';
const SPEC = { id: 'bd', title: 'Band', database: '07 Databases/x.db', tiles: [lineTile({ band: { low: 'lo', high: 'hi' } })] };
const settle = () => new Promise((r) => setTimeout(r, 20));

async function makeView(files, binaries, { desktop = true } = {}) {
  const fresh = loadPlugin({ desktop });
  const adapter = makeFakeAdapter(files, binaries);
  const app = { vault: { adapter, getFiles: () => [] }, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  await plugin.onload();
  const view = plugin.viewFactories['icor-sqlite-viewer-dashboards']({ app });
  view.app = app;
  return { plugin, view, adapter };
}

test('a phone draws the same band from the desktop cache', async () => {
  const desk = await makeView({ [DASH]: JSON.stringify(SPEC) }, { '07 Databases/x.db': new Uint8Array([1]) });
  desk.plugin.query.engineFor = async () => ({ engine: 'cli', size: 1 });
  desk.plugin.query.query = async () => ({ columns: TABLE.columns, rows: TABLE.rows, ms: 1 });
  await desk.view.onOpen();
  await settle();
  assert.equal(bands(desk.view.contentEl).length, 2);
  const cache = desk.adapter.files.get(CACHE);
  assert.ok(cache, 'the desktop wrote its cache');
  const phone = await makeView({ [DASH]: JSON.stringify(SPEC), [CACHE]: cache }, { '07 Databases/x.db': new Uint8Array([1]) }, { desktop: false });
  phone.plugin.query.engineFor = async () => ({ engine: null, reason: 'Too big for this device.' });
  await phone.view.onOpen();
  await settle();
  assert.equal(bands(phone.view.contentEl).length, 2);
});
