/* A METER UNDER A STAT'S NUMBER.
 *
 * A stat showed a number with no sense of where it sits on its scale.
 * "meter": {"min", "max", "target"} draws a bar under the number, filled
 * to where the number sits between min and max, in the widget's level
 * colour, with a tick at the target. These gates pin the rules: without
 * it nothing changes; with it the fill and the tick sit where they should,
 * clamp at the ends, take the level colour, and read out in words; the
 * spec refuses it where it means nothing, in plain words; it survives the
 * spec file, a built widget, the desktop cache and an edit from the form.
 * Every value here is invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeFakeAdapter, unwrap } from './harness.mjs';

const { lib, obsidian } = loadPlugin();

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byClass = (root, cls) => [...walkEl(root)].filter((e) => e.classSet && e.classSet.has(cls));
const freshEl = () => new obsidian.Modal({}).contentEl;
const parse = (tile) => lib.parseDashboardSpec(JSON.stringify({ id: 'mt', title: 'Meter', database: '07 Data/x.db', tiles: [tile] }));
const statTile = (extra) => Object.assign({ title: 'Spread', viz: 'stat', unit: '%', sql: 'SELECT 32.5 AS value' }, extra);
const TABLE = { columns: ['value'], rows: [[30]] };
const LEVELS = [{ id: 'good', name: 'Good', color: 'var(--color-green)' }];

function draw(tile, table, extras) {
  const el = freshEl();
  lib.renderTile(el, tile, table || TABLE, extras || {});
  return el;
}

test('THE LIMIT: without "meter" a stat draws no meter', () => {
  assert.equal(byClass(draw({ viz: 'stat', y: ['value'] }), 'icor-sqlv-meter').length, 0);
});

test('the fill sits where the number does, the tick at the target, and both read out in words', () => {
  const el = draw({ viz: 'stat', y: ['value'], unit: '%', meter: { min: 0, max: 60, target: 36 } });
  const [track] = byClass(el, 'icor-sqlv-meter');
  assert.equal(byClass(track, 'icor-sqlv-meter-fill')[0].style.width, '50.00%');
  assert.equal(byClass(track, 'icor-sqlv-meter-target')[0].style.left, '60.00%');
  assert.equal(track.getAttribute('role'), 'img');
  assert.equal(track.getAttribute('aria-label'), '30 % on a scale of 0 to 60, target 36');
  const value = byClass(el, 'icor-sqlv-stat-value')[0];
  const wrap = value.parentElement;
  assert.ok(wrap.children.indexOf(track) === wrap.children.indexOf(value) + 1, 'right under the number');
});

test('the fill clamps at both ends; without a target there is no tick', () => {
  assert.equal(lib.meterFill(90, { min: 0, max: 60 }), 100);
  assert.equal(lib.meterFill(-5, { min: 0, max: 60 }), 0);
  assert.equal(lib.meterFill('45', { min: 30, max: 60 }), 50);
  const el = draw({ viz: 'stat', y: ['value'], meter: { min: 0, max: 60 } });
  assert.equal(byClass(el, 'icor-sqlv-meter-target').length, 0);
});

test('the fill takes the level colour; with no level it keeps the theme ink', () => {
  const tile = parse(statTile({ meter: { min: 0, max: 60, target: 36 }, ranges: [{ high: 36, level: 'Good', label: 'steady' }] })).spec.tiles[0];
  const el = draw(tile, TABLE, { levels: LEVELS });
  assert.equal(byClass(el, 'icor-sqlv-meter-fill')[0].style.background, 'var(--color-green)');
  const plain = draw({ viz: 'stat', y: ['value'], meter: { min: 0, max: 60 } });
  assert.equal(byClass(plain, 'icor-sqlv-meter-fill')[0].style.background, undefined);
});

test('the spec keeps the meter and names what is wrong, in plain words', () => {
  const ok = parse(statTile({ meter: { min: 0, max: 60, target: 36 } }));
  assert.equal(ok.ok, true, ok.reason);
  assert.deepEqual(unwrap(ok.spec.tiles[0].meter), { min: 0, max: 60, target: 36 });
  const bad = [
    [statTile({ meter: { min: 60, max: 0 } }), /"meter" must be like \{"min": 0, "max": 60, "target": 36\}, with "min" below "max"/],
    [statTile({ meter: { max: 60 } }), /"meter" must be like/],
    [statTile({ meter: [0, 60] }), /"meter" must be like/],
    [statTile({ meter: { min: 0, max: 60, target: 70 } }), /the "meter" "target" must be a number from "min" to "max"/],
    [{ title: 'L', viz: 'line', x: 'a', y: 'b', sql: 'SELECT 1', meter: { min: 0, max: 1 } }, /"meter" only works on a stat widget/],
  ];
  for (const [tile, re] of bad) {
    const r = parse(tile);
    assert.equal(r.ok, false, JSON.stringify(tile));
    assert.match(r.reason, re);
    assert.match(r.reason, /^Tile 1: /);
  }
});

test('the meter survives the spec file, on an SQL tile and on a built widget, and a built widget draws it', () => {
  const back = JSON.parse(lib.specToJson(parse(statTile({ meter: { min: 0, max: 60, target: 36 } })).spec)).tiles[0];
  assert.deepEqual(back.meter, { min: 0, max: 60, target: 36 });
  assert.equal(JSON.parse(lib.specToJson(parse(statTile({})).spec)).tiles[0].meter, undefined);
  const built = parse({ title: 'Avg', viz: 'stat', meter: { min: 0, max: 10 }, source: { table: 't', metric: 'v', agg: 'avg' } });
  assert.equal(built.ok, true, built.reason);
  assert.deepEqual(JSON.parse(lib.specToJson(built.spec)).tiles[0].meter, { min: 0, max: 10 });
  const prepared = lib.prepareTileForRender(built.spec.tiles[0], { columns: ['value'], rows: [[5]] });
  const el = freshEl();
  lib.renderTile(el, prepared.spec, prepared.table, {});
  assert.equal(byClass(el, 'icor-sqlv-meter-fill')[0].style.width, '50.00%');
  assert.deepEqual(unwrap(lib.keepUneditedKeys({ viz: 'stat' }, { viz: 'stat', meter: { min: 0, max: 1 } }).meter), { min: 0, max: 1 }, 'an edit from the form keeps it');
  assert.equal(lib.keepUneditedKeys({ viz: 'line' }, { viz: 'stat', meter: { min: 0, max: 1 } }).meter, undefined, 'not when the widget changes type');
});

/* ---------------------------------------------- the view and the cache -- */

const DASH = '07 Databases/Dashboards/mt.json';
const CACHE = '07 Databases/Dashboard Cache/dashboards/mt.json';
const SPEC = { id: 'mt', title: 'Meter', database: '07 Databases/x.db', tiles: [statTile({ meter: { min: 0, max: 60, target: 36 } })] };
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

test('a phone draws the same meter from the desktop cache', async () => {
  const desk = await makeView({ [DASH]: JSON.stringify(SPEC) }, { '07 Databases/x.db': new Uint8Array([1]) });
  desk.plugin.query.engineFor = async () => ({ engine: 'cli', size: 1 });
  desk.plugin.query.query = async () => ({ columns: TABLE.columns, rows: TABLE.rows, ms: 1 });
  await desk.view.onOpen();
  await settle();
  assert.equal(byClass(desk.view.contentEl, 'icor-sqlv-meter').length, 1);
  const cache = desk.adapter.files.get(CACHE);
  assert.ok(cache, 'the desktop wrote its cache');
  const phone = await makeView({ [DASH]: JSON.stringify(SPEC), [CACHE]: cache }, { '07 Databases/x.db': new Uint8Array([1]) }, { desktop: false });
  phone.plugin.query.engineFor = async () => ({ engine: null, reason: 'Too big for this device.' });
  await phone.view.onOpen();
  await settle();
  assert.equal(byClass(phone.view.contentEl, 'icor-sqlv-meter-fill')[0].style.width, '50.00%');
});
