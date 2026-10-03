/* A SEGMENTS BAR: HOW A WHOLE DIVIDES.
 *
 * A dashboard had no way to show how 100% splits: time spent per state, a
 * budget per category. "viz": "segments" draws one horizontal bar split
 * into the query's rows, each as wide as its share of the total, with the
 * share written inside when there is room and a legend under it. Like a
 * stat, "ranges" with a "rangeColumn" mark the widget with a level and a
 * pill. These gates pin the rules: the widths and labels follow the
 * shares; colours come per part or from the theme; a level marks the tile;
 * the spec refuses what makes no sense, in plain words; it survives the
 * spec file and the desktop cache. Every value here is invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeFakeAdapter, unwrap } from './harness.mjs';

const { lib, obsidian } = loadPlugin();

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byClass = (root, cls) => [...walkEl(root)].filter((e) => e.classSet && e.classSet.has(cls));
const freshEl = () => new obsidian.Modal({}).contentEl;
const parse = (tile) => lib.parseDashboardSpec(JSON.stringify({ id: 'sg', title: 'Split', database: '07 Data/x.db', tiles: [tile] }));
const segTile = (extra) => Object.assign({ title: 'Time per state', viz: 'segments', x: 'state', y: 'pct', unit: '%', sql: 'SELECT 1 AS state, 2 AS pct' }, extra);
const TABLE = { columns: ['state', 'pct', 'score'], rows: [['Asleep', 0, 2], ['Idle', 4.5, 2], ['Busy', 80.3, 2], ['Away', 12.2, 2], ['Off', 3, 2]] };
const LEVELS = [{ id: 'good', name: 'Good', color: 'var(--color-green)' }, { id: 'watch', name: 'Watch', color: 'var(--color-orange)' }];

function draw(tile, table, extras) {
  const el = freshEl();
  lib.renderTile(el, tile, table || TABLE, extras || {});
  return el;
}

test('THE LIMIT: no other widget draws a segments bar', () => {
  const el = draw({ viz: 'bar', x: 'state', y: ['pct'] });
  assert.equal(byClass(el, 'icor-sqlv-segment').length, 0);
});

test('each part is as wide as its share, coloured as asked, with its share inside when there is room', () => {
  const el = draw({ viz: 'segments', x: 'state', y: ['pct'], unit: '%', segmentColors: { Busy: '#51af6f', Away: '#e3ad4b' } });
  const segs = byClass(el, 'icor-sqlv-segment');
  assert.equal(segs.length, 4, 'a part of zero takes no room');
  const total = 4.5 + 80.3 + 12.2 + 3;
  assert.deepEqual(segs.map((s) => s.style.width), [4.5, 80.3, 12.2, 3].map((v) => ((v / total) * 100).toFixed(3) + '%'));
  assert.equal(segs[1].style.background, '#51af6f');
  assert.equal(segs[2].style.background, '#e3ad4b');
  assert.match(segs[0].style.background, /^var\(--sqlv-series-/, 'no colour: the theme series colours');
  assert.deepEqual(segs.map((s) => (byClass(s, 'icor-sqlv-segment-label')[0] || {}).textContent), [undefined, '80%', '12%', undefined], 'shares under 8% stay unlabelled');
  assert.equal(segs[1].getAttribute('title'), 'Busy: 80.3%');
});

test('the legend lists every part with its value, zero included', () => {
  const el = draw({ viz: 'segments', x: 'state', y: ['pct'], unit: '%' });
  const names = byClass(el, 'icor-sqlv-legend-name').map((n) => n.textContent);
  const values = byClass(el, 'icor-sqlv-segments-value').map((n) => n.textContent);
  assert.deepEqual(names, ['Asleep', 'Idle', 'Busy', 'Away', 'Off']);
  assert.deepEqual(values, ['0%', '4.5%', '80.3%', '12.2%', '3%']);
  const bar = byClass(el, 'icor-sqlv-segments-bar')[0];
  assert.equal(bar.getAttribute('role'), 'img');
  assert.equal(bar.getAttribute('aria-label'), 'Asleep: 0%. Idle: 4.5%. Busy: 80.3%. Away: 12.2%. Off: 3%');
});

test('ranges judge the rangeColumn: the tile takes the level, the pill its label', () => {
  const tile = parse(segTile({ rangeColumn: 'score', ranges: [{ low: 2, level: 'Good', label: 'on target' }, { level: 'Watch', label: 'watch' }] })).spec.tiles[0];
  const el = draw(tile, TABLE, { levels: LEVELS, levelLooks: { stat: 'tint' } });
  assert.ok(el.classSet.has('is-level') && el.classSet.has('is-level-tint'), 'the stat look marks it');
  assert.equal(el.style['--sqlv-level-color'], 'var(--color-green)');
  assert.deepEqual(byClass(el, 'icor-sqlv-level-pill').map((p) => p.textContent), ['on target']);
  const watch = draw(tile, { columns: TABLE.columns, rows: TABLE.rows.map((r) => [r[0], r[1], 1]) }, { levels: LEVELS });
  assert.deepEqual(byClass(watch, 'icor-sqlv-level-pill').map((p) => p.textContent), ['watch']);
});

test('nothing to split draws a plain empty note', () => {
  const el = draw({ viz: 'segments', x: 'state', y: ['pct'] }, { columns: ['state', 'pct'], rows: [['a', 0]] });
  assert.equal(byClass(el, 'icor-sqlv-empty').length, 1);
  assert.deepEqual(unwrap(lib.segmentsOf({ columns: ['a', 'b'], rows: [['x', 1], ['y', 3]] }, { x: 'a', y: ['b'] }).map((p) => p.share)), [25, 75]);
});

test('the spec keeps a segments bar and names what is wrong, in plain words', () => {
  const ok = parse(segTile({ segmentColors: { Busy: ' #51af6f ' }, rangeColumn: 'score', ranges: [{ low: 2, level: 'Good' }] }));
  assert.equal(ok.ok, true, ok.reason);
  assert.deepEqual(unwrap(ok.spec.tiles[0].segmentColors), { Busy: '#51af6f' });
  const bad = [
    [segTile({ x: undefined }), /needs an "x" column for a segments bar/],
    [segTile({ y: ['a', 'b'] }), /needs one "y" column for a segments bar/],
    [segTile({ segmentColors: ['#51af6f'] }), /"segmentColors" must be an object/],
    [segTile({ segmentColors: { Busy: 'green' } }), /the colour for "Busy" in "segmentColors" must be a theme colour/],
    [segTile({ ranges: [{ low: 2, level: 'Good' }] }), /its "ranges" need a "rangeColumn" to judge/],
    [{ title: 'B', viz: 'bar', x: 'a', y: 'b', sql: 'SELECT 1', segmentColors: { a: '#112233' } }, /"segmentColors" only work on a segments bar/],
    [{ title: 'Built', viz: 'segments', source: { table: 't', metric: 'v', agg: 'sum', timeColumn: 'd' } }, /built widget/],
  ];
  for (const [tile, re] of bad) {
    const r = parse(tile);
    assert.equal(r.ok, false, JSON.stringify(tile));
    assert.match(r.reason, re);
    assert.match(r.reason, /^Tile 1/);
  }
  assert.deepEqual(unwrap(lib.defaultSpanFor({ viz: 'segments' })), { w: 3, h: 1 });
});

test('a segments bar survives the spec file', () => {
  const json = lib.specToJson(parse(segTile({ segmentColors: { Busy: '#51af6f' }, rangeColumn: 'score', ranges: [{ low: 2, level: 'Good', label: 'ok' }] })).spec);
  const back = JSON.parse(json).tiles[0];
  assert.equal(back.viz, 'segments');
  assert.deepEqual(back.segmentColors, { Busy: '#51af6f' });
  assert.equal(back.rangeColumn, 'score');
  assert.equal(lib.parseDashboardSpec(json).ok, true);
});

/* ---------------------------------------------- the view and the cache -- */

const DASH = '07 Databases/Dashboards/sg.json';
const CACHE = '07 Databases/Dashboard Cache/dashboards/sg.json';
const SPEC = { id: 'sg', title: 'Split', database: '07 Databases/x.db', tiles: [segTile({ segmentColors: { Busy: '#51af6f' } })] };
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

test('a phone draws the same segments bar from the desktop cache', async () => {
  const desk = await makeView({ [DASH]: JSON.stringify(SPEC) }, { '07 Databases/x.db': new Uint8Array([1]) });
  desk.plugin.query.engineFor = async () => ({ engine: 'cli', size: 1 });
  desk.plugin.query.query = async () => ({ columns: TABLE.columns, rows: TABLE.rows, ms: 1 });
  await desk.view.onOpen();
  await settle();
  assert.equal(byClass(desk.view.contentEl, 'icor-sqlv-segment').length, 4);
  const cache = desk.adapter.files.get(CACHE);
  assert.ok(cache, 'the desktop wrote its cache');
  const phone = await makeView({ [DASH]: JSON.stringify(SPEC), [CACHE]: cache }, { '07 Databases/x.db': new Uint8Array([1]) }, { desktop: false });
  phone.plugin.query.engineFor = async () => ({ engine: null, reason: 'Too big for this device.' });
  await phone.view.onOpen();
  await settle();
  const segs = byClass(phone.view.contentEl, 'icor-sqlv-segment');
  assert.equal(segs.length, 4);
  assert.equal(segs[1].style.background, '#51af6f');
});
