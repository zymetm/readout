/* A COMBO CHART: BARS AND LINES IN ONE CHART, ON TWO AXES.
 *
 * A dashboard could draw bars or lines, never both, and never two scales
 * at once: counts per day next to an average, grams next to calories.
 * "viz": "combo" draws each column in "series" as a bar or a line, on the
 * left or the right axis, in its own colour, dash and opacity; "stack"
 * stacks the bars. These gates pin the rules: bars and lines draw from the
 * same rows and line up on the same x; each axis holds its own series;
 * gaps break a line unless it asks to connect; zones and lines can follow
 * either axis; the hover reads every series; the spec refuses what makes
 * no sense, in plain words; it survives the spec file, the desktop cache
 * and an edit from the form. Every value here is invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeFakeAdapter, unwrap } from './harness.mjs';

const { lib, obsidian } = loadPlugin();

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byTag = (root, tag) => [...walkEl(root)].filter((e) => e.tagName === tag.toUpperCase());
const byAttrClass = (root, cls) => [...walkEl(root)].filter((e) => e.getAttribute && e.getAttribute('class') === cls);
const byClass = (root, cls) => [...walkEl(root)].filter((e) => e.classSet && e.classSet.has(cls));
const freshEl = () => new obsidian.Modal({}).contentEl;
const parse = (tile) => lib.parseDashboardSpec(JSON.stringify({ id: 'cb', title: 'Combo', database: '07 Data/x.db', tiles: [tile] }));
const comboTile = (extra) => Object.assign({
  title: 'Walks and moods', viz: 'combo', x: 'day', sql: 'SELECT 1 AS day, 2 AS walks, 3 AS mood',
  series: [{ column: 'walks', kind: 'bar', color: '#df8f48', opacity: 0.5, label: 'Walks' }, { column: 'mood', kind: 'line', axis: 'right', dash: '3 3', label: 'Mood' }],
}, extra);
const TABLE = { columns: ['day', 'walks', 'mood', 'naps'], rows: [['01', 4000, 120, 1], ['02', 8000, null, 2], ['03', null, 140, 0], ['04', 6000, 130, 3]] };

function draw(tile, table) {
  const el = freshEl();
  lib.renderTile(el, parse(tile).spec.tiles[0], table || TABLE, {});
  return el;
}
const bars = (el) => byAttrClass(el, 'icor-sqlv-combo-bar');
const lines = (el) => byAttrClass(el, 'icor-sqlv-combo-line');
const ticks = (el, anchor) => byTag(el, 'text').filter((t) => t.getAttribute('class') === 'icor-sqlv-tick' && t.getAttribute('text-anchor') === anchor).map((t) => t.textContent);

test('THE LIMIT: a line or bar chart still draws one kind, and nothing is a combo unless asked', () => {
  const el = freshEl();
  lib.renderTile(el, { viz: 'bar', x: 'day', y: ['walks'] }, TABLE, {});
  assert.equal(bars(el).length, 0);
  assert.equal(parse({ title: 'B', viz: 'bar', x: 'day', y: 'walks', sql: 'SELECT 1', series: [{ column: 'walks' }] }).ok, false, 'series is a combo field only');
});

test('bars and lines draw from the same rows, in their colours, dash and opacity, lines over bars', () => {
  const el = draw(comboTile());
  const b = bars(el);
  assert.equal(b.length, 3, 'three rows with walks; the empty one draws no bar');
  assert.ok(b.every((x) => x.getAttribute('fill') === '#df8f48' && x.getAttribute('fill-opacity') === '0.5'));
  const [l] = lines(el);
  assert.equal(l.getAttribute('stroke-dasharray'), '3 3');
  assert.equal(l.getAttribute('stroke'), 'var(--sqlv-series-3)', 'no colour: the theme series colour for its place');
  const svg = byTag(el, 'svg')[0];
  assert.ok(svg.children.indexOf(l) > svg.children.indexOf(b[b.length - 1]), 'the line draws over the bars');
  assert.match(byTag(b[0], 'title')[0].textContent, /^01 · Walks 4,000$/);
});

test('a gap breaks a line; "connect" joins it across', () => {
  const broken = lines(draw(comboTile()))[0].getAttribute('d');
  assert.equal((broken.match(/M /g) || []).length, 2, 'row 02 has no mood: two pieces');
  const joined = lines(draw(comboTile({ series: [{ column: 'walks', kind: 'bar' }, { column: 'mood', kind: 'line', axis: 'right', connect: true }] })))[0].getAttribute('d');
  assert.equal((joined.match(/M /g) || []).length, 1, 'one piece');
});

test('each axis holds its own series, with its own fixed range and labels', () => {
  const el = draw(comboTile({ y2Min: 40, y2Max: 220, y2Ticks: [40, 130, 220] }));
  assert.deepEqual(ticks(el, 'start'), ['40', '130', '220'], 'the right axis, labelled on the right');
  const left = ticks(el, 'end').map((t) => Number(t.replace(/,/g, '')));
  assert.equal(Math.min(...left), 0, 'bars stand on zero');
  assert.ok(Math.max(...left) >= 8000, 'the left axis holds the tallest bar');
});

test('bars and lines line up on the same x, bars side by side or stacked', () => {
  const el = draw(comboTile({ series: [{ column: 'walks', kind: 'bar' }, { column: 'naps', kind: 'bar' }, { column: 'mood', kind: 'line', axis: 'right' }] }));
  assert.equal(bars(el).length, 3 + 3, 'side by side: one bar per value above zero');
  const stacked = draw(comboTile({ stack: true, series: [{ column: 'walks', kind: 'bar' }, { column: 'naps', kind: 'bar' }, { column: 'mood', kind: 'line', axis: 'right' }] }));
  const rects = bars(stacked);
  assert.ok(rects.every((r) => r.tagName === 'RECT'), 'stacked segments');
  const x0 = rects.filter((r) => r.getAttribute('x') === rects[0].getAttribute('x'));
  assert.equal(x0.length, 2, 'two segments share the first column');
});

test('zones and reference lines follow the axis they name', () => {
  const el = draw(comboTile({ y2Min: 0, y2Max: 200, refLines: [{ y: 100, axis: 'right' }, { y: 5000 }], zones: [{ from: 50, to: 100, color: '#51af6f', axis: 'right' }] }));
  const refs = byAttrClass(el, 'icor-sqlv-refline');
  assert.equal(refs.length, 2);
  const zone = byAttrClass(el, 'icor-sqlv-zone')[0];
  const y100 = Number(refs[1].getAttribute('y1')); /* left lines draw first */
  assert.equal(Number(zone.getAttribute('y')), y100, 'the zone top and the right-axis line at 100 meet');
});

test('each hover dot takes the colour of its line through a custom property, never a style attribute', () => {
  const el = draw(comboTile({ series: [{ column: 'walks', kind: 'bar' }, { column: 'mood', kind: 'line', color: '#336699' }, { column: 'naps', kind: 'line' }] }));
  const dots = byAttrClass(el, 'icor-sqlv-hover-dot');
  assert.equal(dots.length, 2, 'one per line');
  assert.deepEqual(dots.map((d) => d.style['--sqlv-tile-series']), lines(el).map((l) => l.getAttribute('stroke')), 'the colour of its own line');
  assert.equal(dots[0].style['--sqlv-tile-series'], '#336699');
  assert.ok(dots.every((d) => d.getAttribute('style') === null), 'no inline style attribute');
});

test('the hover reads every series with its axis unit, and the legend names them', () => {
  const el = draw(comboTile({ unit: 'steps', y2Unit: 'mg' }));
  const svg = byTag(el, 'svg')[0];
  svg.getBoundingClientRect = () => ({ left: 0, width: 640 });
  svg.children[svg.children.length - 1].handlers.mousemove[0]({ clientX: 639 });
  assert.equal(byAttrClass(el, 'icor-sqlv-readout')[0].textContent, '04  ·  Walks 6,000 steps  ·  Mood 130 mg');
  assert.deepEqual(byClass(el, 'icor-sqlv-legend-name').map((n) => n.textContent), ['Walks', 'Mood']);
});

test('the spec keeps a combo and names what is wrong, in plain words', () => {
  const ok = parse(comboTile({ stack: true, y2Min: 40, y2Max: 220, y2Unit: 'mg', guideColor: '#cccccc' }));
  assert.equal(ok.ok, true, ok.reason);
  const t = ok.spec.tiles[0];
  assert.deepEqual(unwrap(t.y), ['walks', 'mood']);
  assert.deepEqual(unwrap(t.series[1]), { column: 'mood', kind: 'line', axis: 'right', dash: '3 3', label: 'Mood' });
  const bad = [
    [comboTile({ series: [] }), /a combo chart needs "series"/],
    [comboTile({ series: [{ kind: 'bar' }] }), /series 1 needs a "column"/],
    [comboTile({ series: [{ column: 'a' }, { column: 'a' }] }), /series 2: the column "a" is already a series/],
    [comboTile({ series: [{ column: 'a', kind: 'area' }] }), /"kind" must be "line" or "bar"/],
    [comboTile({ series: [{ column: 'a', axis: 'top' }] }), /"axis" must be "left" or "right"/],
    [comboTile({ series: [{ column: 'a', color: 'gold' }] }), /"color" must be a theme colour/],
    [comboTile({ series: [{ column: 'a', kind: 'bar', dash: '3 3' }] }), /only a line has one/],
    [comboTile({ series: [{ column: 'a', kind: 'bar', connect: true }] }), /only a line has it/],
    [comboTile({ series: [{ column: 'a', opacity: 3 }] }), /"opacity" must be a number above 0/],
    [comboTile({ y2Min: 10, y2Max: 5 }), /"y2Min" \(10\) must be below "y2Max" \(5\)/],
    [comboTile({ y2Unit: 3 }), /"y2Unit" must be text/],
    [comboTile({ stack: true, series: [{ column: 'a', kind: 'bar' }, { column: 'b', kind: 'bar', axis: 'right' }] }), /every bar series must be on the same axis/],
    [comboTile({ y: 'walks' }), /lists its columns in "series", not "y"/],
    [comboTile({ x: undefined }), /needs an "x" column for a combo chart/],
    [comboTile({ color: '#112233' }), /"color" only works on a line or bar chart/],
    [{ title: 'L', viz: 'line', x: 'd', y: 'v', sql: 'SELECT 1', y2Max: 3 }, /"y2Max" only works on a combo chart/],
    [{ title: 'L', viz: 'line', x: 'd', y: 'v', sql: 'SELECT 1', refLines: [{ y: 1, axis: 'right' }] }, /"axis" only works on a combo chart/],
    [{ title: 'Built', viz: 'combo', source: { table: 't', metric: 'v', agg: 'sum', timeColumn: 'd' } }, /a combo chart is an SQL widget/],
  ];
  for (const [tile, re] of bad) {
    const r = parse(tile);
    assert.equal(r.ok, false, JSON.stringify(tile));
    assert.match(r.reason, re);
    assert.match(r.reason, /^Tile 1/);
  }
});

test('a combo survives the spec file with its series and right axis, and no "y"', () => {
  const json = lib.specToJson(parse(comboTile({ stack: true, y2Min: 40, y2Max: 220, y2Ticks: [40, 220], y2Unit: 'mg' })).spec);
  const back = JSON.parse(json).tiles[0];
  assert.equal(back.y, undefined);
  assert.deepEqual(back.series, comboTile().series.map((x) => (x.axis === 'left' ? Object.assign({}, x, { axis: undefined }) : x)));
  assert.equal(back.y2Max, 220);
  assert.deepEqual(back.y2Ticks, [40, 220]);
  assert.equal(back.y2Unit, 'mg');
  assert.equal(lib.parseDashboardSpec(json).ok, true);
  const kept = lib.keepUneditedKeys({ viz: 'combo' }, parse(comboTile({ y2Max: 9 })).spec.tiles[0]);
  assert.equal(kept.series.length, 2, 'an edit from the form keeps the series');
  assert.equal(kept.y2Max, 9);
});

/* ---------------------------------------------- the view and the cache -- */

const DASH = '07 Databases/Dashboards/cb.json';
const CACHE = '07 Databases/Dashboard Cache/dashboards/cb.json';
const SPEC = { id: 'cb', title: 'Combo', database: '07 Databases/x.db', tiles: [comboTile()] };
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

test('a phone draws the same combo from the desktop cache', async () => {
  const desk = await makeView({ [DASH]: JSON.stringify(SPEC) }, { '07 Databases/x.db': new Uint8Array([1]) });
  desk.plugin.query.engineFor = async () => ({ engine: 'cli', size: 1 });
  desk.plugin.query.query = async () => ({ columns: TABLE.columns, rows: TABLE.rows, ms: 1 });
  await desk.view.onOpen();
  await settle();
  assert.equal(bars(desk.view.contentEl).length, 3);
  const cache = desk.adapter.files.get(CACHE);
  assert.ok(cache, 'the desktop wrote its cache');
  const phone = await makeView({ [DASH]: JSON.stringify(SPEC), [CACHE]: cache }, { '07 Databases/x.db': new Uint8Array([1]) }, { desktop: false });
  phone.plugin.query.engineFor = async () => ({ engine: null, reason: 'Too big for this device.' });
  await phone.view.onOpen();
  await settle();
  assert.equal(bars(phone.view.contentEl).length, 3);
  assert.equal(lines(phone.view.contentEl).length, 1);
});
