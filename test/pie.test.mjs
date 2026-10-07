/* A PIE OR DOUGHNUT CHART: HOW A WHOLE DIVIDES, AS A CIRCLE.
 *
 * "viz": "pie" takes the same rows as a segments bar (a name column and a
 * size column, one row a part) and draws them by hand as slices of a
 * circle, from twelve o'clock, clockwise, with a legend. "doughnut": true
 * cuts a hole and writes the total in it. It reuses the segments bar's part
 * colours and value levels. These gates pin the rules: the angles follow
 * the shares; a whole circle and an empty one are drawn properly; colours
 * come per part or from the theme; a level marks the tile; the spec refuses
 * what makes no sense, in plain words; it survives the spec file, the edit
 * form and the desktop cache. Every value here is invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeFakeAdapter, unwrap } from './harness.mjs';
import { byLabel, makeForm, asFileTile } from './form-kit.mjs';

const { lib, obsidian } = loadPlugin();

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byClass = (root, cls) => [...walkEl(root)].filter((e) => e.classSet && e.classSet.has(cls));
const byAttrClass = (root, cls) => [...walkEl(root)].filter((e) => e.getAttribute && e.getAttribute('class') === cls);
const freshEl = () => new obsidian.Modal({}).contentEl;
const parse = (tile) => lib.parseDashboardSpec(JSON.stringify({ id: 'pc', title: 'Pies', database: '07 Databases/x.db', tiles: [tile] }));
const pieTile = (extra) => Object.assign({ title: 'Orders by channel', viz: 'pie', x: 'channel', y: 'orders', unit: 'orders', sql: 'SELECT 1 AS channel, 2 AS orders' }, extra);
const TABLE = { columns: ['channel', 'orders', 'score'], rows: [['Web', 50, 2], ['Shop', 25, 2], ['Phone', 0, 2], ['Email', 25, 2]] };
const LEVELS = [{ id: 'good', name: 'Good', color: 'var(--color-green)' }, { id: 'watch', name: 'Watch', color: 'var(--color-orange)' }];

function draw(tile, table, extras) {
  const el = freshEl();
  lib.renderTile(el, tile, table || TABLE, extras || {});
  return el;
}
const slices = (el) => byAttrClass(el, 'icor-sqlv-pie-slice');

test('THE LIMIT: no other widget draws a pie', () => {
  assert.equal(slices(draw({ viz: 'bar', x: 'channel', y: ['orders'] })).length, 0);
  assert.equal(slices(draw({ viz: 'segments', x: 'channel', y: ['orders'] })).length, 0);
});

/* ---------------------------------------------------------- geometry -- */

test('the angles follow the shares: from twelve oclock, clockwise, in the order of the rows', () => {
  const pie = lib.pieOf(TABLE, { x: 'channel', y: ['orders'] });
  assert.equal(pie.total, 100);
  assert.deepEqual(unwrap(pie.slices.map((s) => s.name)), ['Web', 'Shop', 'Email'], 'a part of zero has no slice');
  const turns = pie.slices.map((s) => [s.a0 / (2 * Math.PI), s.a1 / (2 * Math.PI)]);
  assert.deepEqual(unwrap(turns.map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000])), [[0, 0.5], [0.5, 0.75], [0.75, 1]]);
  /* The first slice starts straight up from the centre and ends straight down. */
  assert.match(pie.slices[0].d, /^M 50 50 L 50\.00 4\.00 A 46 46 0 0 1 50\.00 96\.00 Z$/);
  assert.equal(pie.parts.length, 4, 'the legend keeps the zero part');
});

test('a slice over half the circle takes the large arc', () => {
  const d = lib.piePath(50, 50, 46, 0, 0, Math.PI * 1.5);
  assert.match(d, / A 46 46 0 1 1 /);
});

test('one part at 100% is a whole circle, not an arc from a point to itself; with a hole it is a ring', () => {
  const one = lib.pieOf({ columns: ['a', 'b'], rows: [['Only', 7]] }, { x: 'a', y: ['b'] });
  assert.equal(one.slices.length, 1);
  assert.equal(one.slices[0].d.match(/M /g).length, 1, 'one circle');
  assert.doesNotMatch(one.slices[0].d, / L /, 'no wedge lines');
  const ring = lib.pieOf({ columns: ['a', 'b'], rows: [['Only', 7]] }, { x: 'a', y: ['b'], doughnut: true });
  assert.equal(ring.slices[0].d.match(/M /g).length, 2, 'an outer and an inner circle');
});

test('a doughnut slice is a ring segment between two radii', () => {
  const d = lib.piePath(50, 50, 46, 27, 0, Math.PI / 2);
  assert.match(d, /^M 50\.00 4\.00 A 46 46 0 0 1 96\.00 50\.00 L 77\.00 50\.00 A 27 27 0 0 0 50\.00 23\.00 Z$/);
});

test('nothing to split draws a plain empty note', () => {
  for (const rows of [[], [['a', 0], ['b', 0]], [['a', -3]], [['a', 'x']]]) {
    const el = draw({ viz: 'pie', x: 'a', y: ['b'] }, { columns: ['a', 'b'], rows });
    assert.equal(byClass(el, 'icor-sqlv-empty').length, 1, JSON.stringify(rows));
    assert.equal(slices(el).length, 0);
  }
});

/* ------------------------------------------------------------ drawing -- */

test('each slice is coloured as asked or from the theme, and says what it is on hover', () => {
  const el = draw({ viz: 'pie', x: 'channel', y: ['orders'], unit: 'orders', segmentColors: { Shop: '#51af6f' } });
  const s = slices(el);
  assert.equal(s.length, 3);
  assert.equal(s[1].style.fill, '#51af6f');
  assert.match(s[0].style.fill, /^var\(--sqlv-series-/, 'no colour: the theme series colours');
  assert.equal(s[0].children[0].textContent, 'Web: 50 orders (50%)');
  const svg = byAttrClass(el, 'icor-sqlv-pie-svg')[0];
  assert.equal(svg.getAttribute('role'), 'img');
  assert.equal(svg.getAttribute('aria-label'), 'Web: 50 orders (50%). Shop: 25 orders (25%). Phone: 0 orders (0%). Email: 25 orders (25%)');
  assert.equal(svg.getAttribute('viewBox'), '0 0 100 100', 'a square the stylesheet scales: no measuring');
});

test('the legend lists every part with its value and share, zero included', () => {
  const el = draw({ viz: 'pie', x: 'channel', y: ['orders'], unit: 'orders' });
  assert.deepEqual(byClass(el, 'icor-sqlv-legend-name').map((n) => n.textContent), ['Web', 'Shop', 'Phone', 'Email']);
  assert.deepEqual(byClass(el, 'icor-sqlv-segments-value').map((n) => n.textContent), ['50 orders · 50%', '25 orders · 25%', '0 orders · 0%', '25 orders · 25%']);
});

test('a doughnut writes the total in its hole; a pie does not', () => {
  const ring = draw({ viz: 'pie', x: 'channel', y: ['orders'], doughnut: true });
  assert.equal(byAttrClass(ring, 'icor-sqlv-pie-total').map((t) => t.textContent).join(), '100');
  assert.equal(byAttrClass(draw({ viz: 'pie', x: 'channel', y: ['orders'] }), 'icor-sqlv-pie-total').length, 0);
});

test('ranges judge the rangeColumn: the tile takes the level and the pill its label, as on a segments bar', () => {
  const tile = parse(pieTile({ rangeColumn: 'score', ranges: [{ low: 2, level: 'Good', label: 'on target' }, { level: 'Watch', label: 'watch' }] })).spec.tiles[0];
  const el = draw(tile, TABLE, { levels: LEVELS, levelLooks: { stat: 'tint' } });
  assert.ok(el.classSet.has('is-level') && el.classSet.has('is-level-tint'));
  assert.equal(el.style['--sqlv-level-color'], 'var(--color-green)');
  assert.deepEqual(byClass(el, 'icor-sqlv-level-pill').map((p) => p.textContent), ['on target']);
  const own = draw(tile, TABLE, { levels: LEVELS, levelLooks: { stat: 'tint', segments: 'outline' } });
  assert.ok(own.classSet.has('is-level-outline'), 'the segments look setting covers a pie too');
});

/* --------------------------------------------------------------- spec -- */

test('the spec keeps a pie and names what is wrong, in plain words', () => {
  const ok = parse(pieTile({ doughnut: true, segmentColors: { Web: ' #51af6f ' }, rangeColumn: 'score', ranges: [{ low: 2, level: 'Good' }] }));
  assert.equal(ok.ok, true, ok.reason);
  assert.equal(ok.spec.tiles[0].doughnut, true);
  assert.deepEqual(unwrap(ok.spec.tiles[0].segmentColors), { Web: '#51af6f' });
  const bad = [
    [pieTile({ x: undefined }), /needs an "x" column for a pie chart/],
    [pieTile({ y: ['a', 'b'] }), /needs one "y" column for a pie chart/],
    [pieTile({ doughnut: 'yes' }), /"doughnut" must be true or false/],
    [pieTile({ ranges: [{ low: 2, level: 'Good' }] }), /a pie chart has no single value, so its "ranges" need a "rangeColumn"/],
    [pieTile({ segmentColors: { Web: 'green' } }), /the colour for "Web" in "segmentColors" must be a theme colour/],
    [{ title: 'B', viz: 'bar', x: 'a', y: 'b', sql: 'SELECT 1', doughnut: true }, /"doughnut" only works on a pie chart/],
    [{ title: 'Built', viz: 'pie', source: { table: 't', metric: 'v', agg: 'sum', timeColumn: 'd' } }, /use an SQL tile for a pie chart/],
  ];
  for (const [tile, re] of bad) {
    const r = parse(tile);
    assert.equal(r.ok, false, JSON.stringify(tile));
    assert.match(r.reason, re);
    assert.match(r.reason, /^Tile 1/);
  }
  assert.deepEqual(unwrap(lib.defaultSpanFor({ viz: 'pie' })), { w: 2, h: 2 });
});

test('a pie survives the spec file; a plain pie writes no doughnut key', () => {
  const json = lib.specToJson(parse(pieTile({ doughnut: true, segmentColors: { Web: '#51af6f' }, rangeColumn: 'score', ranges: [{ low: 2, level: 'Good', label: 'ok' }] })).spec);
  const back = JSON.parse(json).tiles[0];
  assert.deepEqual([back.viz, back.doughnut, back.rangeColumn], ['pie', true, 'score']);
  assert.deepEqual(back.segmentColors, { Web: '#51af6f' });
  assert.equal(lib.parseDashboardSpec(json).ok, true);
  assert.equal('doughnut' in JSON.parse(lib.specToJson(parse(pieTile()).spec)).tiles[0], false);
});

/* ---------------------------------------------------------- the form -- */

const TARGET = { title: 'Parts', viz: 'pie', x: 'status', y: 'n', doughnut: true, sql: 'SELECT status, n, verdict FROM parts', segmentColors: { Done: '#228833' } };

test('the edit form builds a pie field for field, and reads one back', async () => {
  const { form, spec, lib: l } = await makeForm(null);
  form.open();
  Object.assign(form.state, { mode: 'sql', sqlText: TARGET.sql, viz: 'pie', title: 'Parts', sizeKey: 'wide' });
  form.renderForm();
  await form.runPreview();
  assert.ok(lib.FORM_VIZ.has('pie'));
  assert.equal(byLabel(form.formEl, 'Part name column').tagName, 'SELECT');
  assert.equal(byLabel(form.formEl, 'Part size column').tagName, 'SELECT');
  assert.ok(byLabel(form.formEl, 'Cut a hole in the middle (a doughnut)'), 'the doughnut switch');
  assert.ok(byLabel(form.formEl, 'Judge the ranges on column'));
  Object.assign(form.state, { x: 'status', y: 'n', pieDoughnut: true, segmentColors: [{ name: 'Done', color: '#228833' }] });
  form.touch();
  await form.runPreview();
  assert.equal(form.previewState, 'ok', form.previewError);
  assert.ok(slices(form.previewEl).length > 0, 'the preview draws the pie');
  await form.save();
  const want = l.parseDashboardSpec(JSON.stringify({ id: 'x', title: 'X', database: '07 Databases/shop.db', tiles: [TARGET] })).spec.tiles[0];
  assert.deepEqual(unwrap(asFileTile(l, spec.tiles[0])), unwrap(asFileTile(l, want)));

  const parsed = lib.parseDashboardSpec(JSON.stringify({ id: 'x', title: 'X', database: '07 Databases/shop.db', tiles: [TARGET] })).spec.tiles[0];
  const again = await makeForm(parsed);
  again.form.open();
  assert.equal(again.form.state.pieDoughnut, true, 'read back');
  assert.equal(again.form.dropNote.textContent, '', 'nothing is left out');
});

/* ------------------------------------------------ the view and the cache -- */

const DASH = '07 Databases/Dashboards/pc.json';
const CACHE = '07 Databases/Dashboard Cache/dashboards/pc.json';
const SPEC = { id: 'pc', title: 'Pies', database: '07 Databases/x.db', tiles: [pieTile({ doughnut: true, segmentColors: { Shop: '#51af6f' } })] };
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

test('a phone draws the same pie from the desktop cache', async () => {
  const desk = await makeView({ [DASH]: JSON.stringify(SPEC) }, { '07 Databases/x.db': new Uint8Array([1]) });
  desk.plugin.query.engineFor = async () => ({ engine: 'cli', size: 1 });
  desk.plugin.query.query = async () => ({ columns: TABLE.columns, rows: TABLE.rows, ms: 1 });
  await desk.view.onOpen();
  await settle();
  assert.equal(slices(desk.view.contentEl).length, 3);
  const cache = desk.adapter.files.get(CACHE);
  assert.ok(cache, 'the desktop wrote its cache');
  const phone = await makeView({ [DASH]: JSON.stringify(SPEC), [CACHE]: cache }, { '07 Databases/x.db': new Uint8Array([1]) }, { desktop: false });
  phone.plugin.query.engineFor = async () => ({ engine: null, reason: 'Too big for this device.' });
  await phone.view.onOpen();
  await settle();
  const s = slices(phone.view.contentEl);
  assert.equal(s.length, 3);
  assert.equal(s[1].style.fill, '#51af6f');
  assert.equal(byAttrClass(phone.view.contentEl, 'icor-sqlv-pie-total').length, 1);
});
