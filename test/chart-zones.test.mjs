/* SHADED ZONES AND REFERENCE LINES ON A CHART.
 *
 * A line or bar chart had no way to mark a target band or a goal. "zones"
 * shade horizontal bands behind the data; "refLines" draw horizontal lines
 * over the grid, dashed if asked, with an optional short label. These gates
 * pin the rules: without them nothing is drawn; with them the bands and
 * lines sit at the right heights, in the right order, in their colours;
 * an automatic axis keeps them in view; the spec refuses them where they
 * mean nothing, in plain words; they survive the spec file, a built
 * widget, the desktop cache and an edit from the form. Every value here is
 * invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadPlugin, makeFakeAdapter, unwrap } from './harness.mjs';

const { lib, obsidian } = loadPlugin();

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byTag = (root, tag) => [...walkEl(root)].filter((e) => e.tagName === tag.toUpperCase());
const byAttrClass = (root, cls) => [...walkEl(root)].filter((e) => e.getAttribute && e.getAttribute('class') === cls);
const freshEl = () => new obsidian.Modal({}).contentEl;
const parse = (tile) => lib.parseDashboardSpec(JSON.stringify({ id: 'zn', title: 'Zones', database: '07 Data/x.db', tiles: [tile] }));
const lineTile = (extra) => Object.assign({ title: 'Temps', viz: 'line', x: 'day', y: 'v', sql: 'SELECT 1 AS day, 2 AS v' }, extra);
const TABLE = { columns: ['day', 'v'], rows: [['a', 20], ['b', 35], ['c', 30]] };

function draw(tile, table) {
  const el = freshEl();
  lib.renderTile(el, tile, table || TABLE, {});
  return el;
}
const zones = (el) => byAttrClass(el, 'icor-sqlv-zone');
const lines = (el) => byAttrClass(el, 'icor-sqlv-refline');
const svgOf = (el) => byTag(el, 'svg')[0];

test('THE LIMIT: without the fields a chart draws no zone and no reference line', () => {
  const el = draw({ viz: 'line', x: 'day', y: ['v'] });
  assert.equal(zones(el).length, 0);
  assert.equal(lines(el).length, 0);
});

test('a zone is shaded between its two values, behind everything, in its colour and opacity', () => {
  const el = draw({ viz: 'line', x: 'day', y: ['v'], yMin: 0, yMax: 40, zones: [{ from: 10, to: 30, color: '#51af6f', opacity: 0.07 }] });
  const [z] = zones(el);
  assert.ok(z, 'the zone is drawn');
  assert.equal(z.getAttribute('fill'), '#51af6f');
  assert.equal(z.getAttribute('fill-opacity'), '0.07');
  const L = lib.chartLayout(640, 260, 0, 40, true, { yMin: 0, yMax: 40 });
  assert.equal(Number(z.getAttribute('y')), Number(L.yOf(30).toFixed(1)));
  assert.equal(Number(z.getAttribute('height')), Number((L.yOf(10) - L.yOf(30)).toFixed(1)));
  assert.equal(svgOf(el).children.indexOf(z), 0, 'first in the drawing, so behind the grid and the data');
  const plain = draw({ viz: 'line', x: 'day', y: ['v'], zones: [{ from: 10, to: 30, color: 'var(--color-green)' }] });
  assert.equal(zones(plain)[0].getAttribute('fill-opacity'), '0.15', 'a default opacity when none is given');
});

test('a reference line sits at its value, dashed and coloured as asked, with its label; under the data', () => {
  const el = draw({ viz: 'line', x: 'day', y: ['v'], yMin: 0, yMax: 40, refLines: [{ y: 25, color: '#c9c4b8', dash: '4 3', label: 'goal' }, { y: 5 }] });
  const [a, b] = lines(el);
  const L = lib.chartLayout(640, 260, 0, 40, true, { yMin: 0, yMax: 40 });
  assert.equal(Number(a.getAttribute('y1')), Number(L.yOf(25).toFixed(1)));
  assert.equal(a.getAttribute('stroke'), '#c9c4b8');
  assert.equal(a.getAttribute('stroke-dasharray'), '4 3');
  assert.equal(b.getAttribute('stroke'), null, 'no colour: the stylesheet gives the theme ink');
  assert.equal(b.getAttribute('stroke-dasharray'), null, 'no dash: a solid line');
  assert.deepEqual(byAttrClass(el, 'icor-sqlv-refline-label').map((t) => t.textContent), ['goal']);
  const kids = svgOf(el).children;
  const dataLine = kids.find((k) => k.tagName === 'PATH' && k.getAttribute('fill') === 'none');
  assert.ok(kids.indexOf(a) < kids.indexOf(dataLine), 'the data draws over the line');
});

test('an automatic axis keeps a zone and a line in view; a fixed axis does not stretch for them', () => {
  const el = draw({ viz: 'bar', x: 'day', y: ['v'], refLines: [{ y: 50 }] });
  assert.equal(lines(el).length, 1, 'a goal above every bar is still drawn');
  assert.deepEqual(unwrap(lib.chartMarkValues({ zones: [{ from: 70, to: 180 }], refLines: [{ y: 50 }] })), [70, 180, 50]);
  const fixed = draw({ viz: 'line', x: 'day', y: ['v'], yMin: 0, yMax: 40, refLines: [{ y: 50 }] });
  assert.equal(lines(fixed).length, 0, 'past a fixed end the line is left out, never drawn outside the plot');
});

test('the stylesheet gives an uncoloured reference line the theme ink and never overrides a chosen one', () => {
  const css = fs.readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
  assert.match(css, /\.icor-sqlv-refline:not\(\[stroke\]\) \{ stroke: var\(--sqlv-fg-dim\); \}/);
  assert.doesNotMatch(css, /\.icor-sqlv-refline \{[^}]*stroke:/);
});

test('the spec keeps the fields and names what is wrong, in plain words', () => {
  const ok = parse(lineTile({ zones: [{ from: 70, to: 180, color: ' #51AF6F ', opacity: 0.5 }], refLines: [{ y: 50, dash: '4 3', label: ' goal ', color: 'var(--color-blue)' }] }));
  assert.equal(ok.ok, true, ok.reason);
  assert.deepEqual(unwrap(ok.spec.tiles[0].zones), [{ from: 70, to: 180, color: '#51AF6F', opacity: 0.5 }]);
  assert.deepEqual(unwrap(ok.spec.tiles[0].refLines), [{ y: 50, color: 'var(--color-blue)', dash: '4 3', label: 'goal' }]);
  const bad = [
    [lineTile({ zones: [] }), /"zones" must be a list of 1 to 8 entries/],
    [lineTile({ zones: [{ from: 180, to: 70, color: '#51af6f' }] }), /zone 1 must be like \{"from": 20/],
    [lineTile({ zones: [{ from: 70, to: 180 }] }), /zone 1: "color" must be a theme colour/],
    [lineTile({ zones: [{ from: 70, to: 180, color: 'green' }] }), /zone 1: "color" must be a theme colour/],
    [lineTile({ zones: [{ from: 70, to: 180, color: '#51af6f', opacity: 2 }] }), /"opacity" must be a number above 0 and at most 1/],
    [lineTile({ refLines: [{ y: '50' }] }), /reference line 1 must be like \{"y": 50\}/],
    [lineTile({ refLines: [{ y: 50, dash: 'dotted' }] }), /"dash" must be a dash pattern like "4 3"/],
    [lineTile({ refLines: [{ y: 50, color: 'red; x' }] }), /reference line 1: "color" must be a theme colour/],
    [lineTile({ refLines: [{ y: 50, label: 'x'.repeat(30) }] }), /"label" must be short text/],
    [{ title: 'S', viz: 'stat', y: 'v', sql: 'SELECT 2 AS v', refLines: [{ y: 1 }] }, /"refLines" only work on a line or bar chart/],
  ];
  for (const [tile, re] of bad) {
    const r = parse(tile);
    assert.equal(r.ok, false, JSON.stringify(tile));
    assert.match(r.reason, re);
    assert.match(r.reason, /^Tile 1/);
  }
});

test('the fields survive the spec file, on an SQL tile and on a built widget, and a built widget draws them', () => {
  const fields = { zones: [{ from: 70, to: 180, color: '#51af6f', opacity: 0.07 }], refLines: [{ y: 50, dash: '4 3' }] };
  const back = JSON.parse(lib.specToJson(parse(lineTile(fields)).spec)).tiles[0];
  assert.deepEqual(back.zones, fields.zones);
  assert.deepEqual(back.refLines, fields.refLines);
  assert.equal(JSON.stringify(JSON.parse(lib.specToJson(parse(lineTile({})).spec)).tiles[0]).includes('zones'), false, 'unset stays out of the file');
  const built = parse(Object.assign({ title: 'Sleep', viz: 'bar', source: { table: 'sleep', metric: 'hours', agg: 'avg', timeColumn: 'day' } }, fields));
  assert.equal(built.ok, true, built.reason);
  assert.deepEqual(JSON.parse(lib.specToJson(built.spec)).tiles[0].zones, fields.zones);
  const prepared = lib.prepareTileForRender(built.spec.tiles[0], { columns: ['x', 'value'], rows: [['2026-01-01', 70], ['2026-01-02', 80]] });
  const el = freshEl();
  lib.renderTile(el, prepared.spec, prepared.table, {});
  assert.equal(zones(el).length, 1);
  assert.equal(lines(el).length, 1);
});

/* ---------------------------------------------- the view and the cache -- */

const DASH = '07 Databases/Dashboards/zn.json';
const CACHE = '07 Databases/Dashboard Cache/dashboards/zn.json';
const SPEC = { id: 'zn', title: 'Zones', database: '07 Databases/x.db', tiles: [lineTile({ zones: [{ from: 25, to: 32, color: '#51af6f' }], refLines: [{ y: 28, dash: '4 3' }] })] };
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

test('a phone draws the same zones and lines from the desktop cache', async () => {
  const desk = await makeView({ [DASH]: JSON.stringify(SPEC) }, { '07 Databases/x.db': new Uint8Array([1]) });
  desk.plugin.query.engineFor = async () => ({ engine: 'cli', size: 1 });
  desk.plugin.query.query = async () => ({ columns: TABLE.columns, rows: TABLE.rows, ms: 1 });
  await desk.view.onOpen();
  await settle();
  assert.equal(zones(desk.view.contentEl).length, 1);
  const cache = desk.adapter.files.get(CACHE);
  assert.ok(cache, 'the desktop wrote its cache');
  const phone = await makeView({ [DASH]: JSON.stringify(SPEC), [CACHE]: cache }, { '07 Databases/x.db': new Uint8Array([1]) }, { desktop: false });
  phone.plugin.query.engineFor = async () => ({ engine: null, reason: 'Too big for this device.' });
  await phone.view.onOpen();
  await settle();
  assert.equal(zones(phone.view.contentEl).length, 1);
  assert.equal(lines(phone.view.contentEl)[0].getAttribute('stroke-dasharray'), '4 3');
});

test('editing the widget in the form keeps its zones and lines', () => {
  const tile = parse(lineTile({ zones: [{ from: 1, to: 2, color: '#112233' }], refLines: [{ y: 3 }] })).spec.tiles[0];
  const kept = lib.keepUneditedKeys({ viz: 'line', title: 'New' }, tile);
  assert.deepEqual(unwrap(kept.zones), [{ from: 1, to: 2, color: '#112233' }]);
  assert.deepEqual(unwrap(kept.refLines), [{ y: 3 }]);
});
