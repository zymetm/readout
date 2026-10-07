/* SPARKLINES IN TABLE ROWS: A TINY TREND IN A CELL.
 *
 * A table shows numbers; a trend per row (each page's visits over two
 * weeks, each habit's last month) needs a chart in the row. "sparklines"
 * on a table widget names the columns whose cells each hold a short series
 * of numbers, written 3,5,4,8 as group_concat writes them, and draws every
 * such cell as a tiny line chart on its own scale with a dot on the last
 * value. These gates pin the rules: the series is read from the ways a
 * query writes one and from nothing else; the line is the right shape on
 * numbers worked out by hand, flat when the series is; a cell that holds
 * no series stays the text it is; only the named columns change; the
 * console's tables are untouched; the spec refuses what makes no sense, in
 * plain words; it survives the spec file; a real query's group_concat
 * reaches the page in order; the edit form builds and reads back the
 * setting. Every value here is invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

import { loadPlugin, makeFakeAdapter, makeFakeVault, unwrap } from './harness.mjs';
import { byLabel, makeForm, asFileTile } from './form-kit.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nodeRequire = createRequire(import.meta.url);
const { lib, obsidian } = loadPlugin();

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byClass = (root, cls) => [...walkEl(root)].filter((e) => e.classSet && e.classSet.has(cls));
const byAttrClass = (root, cls) => [...walkEl(root)].filter((e) => e.getAttribute && e.getAttribute('class') === cls);
const byTag = (root, tag) => [...walkEl(root)].filter((e) => e.tagName === tag.toUpperCase());
const freshEl = () => new obsidian.Modal({}).contentEl;
const parse = (tile) => lib.parseDashboardSpec(JSON.stringify({ id: 'sp', title: 'Sparks', database: '07 Data/x.db', tiles: [tile] }));
const tileOf = (extra) => Object.assign({ title: 'Visits', viz: 'table', sparklines: ['trend'], sql: 'SELECT 1' }, extra);
const TABLE = {
  columns: ['page', 'visits', 'trend', 'also'],
  rows: [['Home', 120, '3,5,4,8', '1,2'], ['About', 14, '7,7,7', '4,3'], ['Blog', 0, '', ''], ['Shop', 9, 'n/a', null], ['Help', 5, '[2, 4, 3]', '5']],
};

function draw(tile, table) {
  const el = freshEl();
  lib.renderTile(el, parse(tile).spec.tiles[0], table || TABLE, {});
  return el;
}
const sparks = (el) => byAttrClass(el, 'icor-sqlv-spark');
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, a + ' is not ' + b);

test('THE LIMIT: a table with no "sparklines" draws none, however its cells read', () => {
  const el = freshEl();
  lib.renderTile(el, { viz: 'table' }, TABLE, {});
  assert.equal(sparks(el).length, 0);
  assert.equal(byTag(el, 'td').find((td) => td.textContent === '3,5,4,8').textContent, '3,5,4,8');
});

/* ----------------------------------------------------------- the series -- */

test('a series is numbers split on commas, spaces, semicolons or bars, in a JSON list or bare', () => {
  assert.deepEqual(unwrap(lib.sparkValuesOf('3,5,4,8')), [3, 5, 4, 8]);
  assert.deepEqual(unwrap(lib.sparkValuesOf('3, 5 ,4;8|9 10')), [3, 5, 4, 8, 9, 10]);
  assert.deepEqual(unwrap(lib.sparkValuesOf('[2, 4.5, -3]')), [2, 4.5, -3]);
  assert.deepEqual(unwrap(lib.sparkValuesOf('1e2,3')), [100, 3]);
  assert.deepEqual(unwrap(lib.sparkValuesOf('3,x,5,null,8')), [3, 5, 8], 'a word that is not a number is left out');
});

test('fewer than two numbers is no series, and only text can be one', () => {
  for (const cell of ['', '  ', '5', 'n/a', 'x,y', '[]', null, undefined, 12, true]) assert.equal(lib.sparkValuesOf(cell), null, String(cell));
});

test('a long series keeps its last 200 numbers', () => {
  const long = Array.from({ length: 500 }, (_, i) => i).join(',');
  const kept = lib.sparkValuesOf(long);
  assert.equal(kept.length, 200);
  assert.deepEqual([kept[0], kept[199]], [300, 499]);
});

/* ---------------------------------------------------------- the picture -- */

test('a named column draws each cell that holds a series as a line, and every other cell stays text', () => {
  const el = draw(tileOf());
  assert.equal(sparks(el).length, 3, 'Home, About and Help; the empty and the n/a cells stay text');
  const cellsOf = (text) => byTag(el, 'td').filter((td) => td.textContent === text);
  assert.equal(cellsOf('n/a').length, 1, 'n/a stays the text it is');
  assert.equal(cellsOf('1,2').length, 1, 'a column that is not named stays text');
  assert.ok(byClass(el, 'icor-sqlv-spark-cell').every((td) => td.textContent === '' && byAttrClass(td, 'icor-sqlv-spark').length === 1), 'a sparkline cell holds only its line');
  assert.equal(byClass(el, 'icor-sqlv-spark-cell').length, 3);
  assert.equal(byClass(el, 'icor-sqlv-num').length, 5, 'the visits stay right-aligned numbers');
});

test('the line is the series on its own scale, lowest at the bottom and highest at the top, with a dot on the last value', () => {
  const home = sparks(draw(tileOf()))[0];
  const line = byAttrClass(home, 'icor-sqlv-spark-line')[0];
  const at = line.getAttribute('points').split(' ').map((p) => p.split(',').map(Number));
  assert.equal(at.length, 4);
  /* 80 wide, 20 high, 2.5 padding: x from 2.5 to 77.5, y from 17.5 (lowest) to 2.5 (highest). */
  near(at[0][0], 2.5); near(at[3][0], 77.5);
  near(at[0][1], 17.5 - (3 - 3) / 5 * 15); near(at[3][1], 2.5);
  near(at[1][1], 17.5 - (5 - 3) / 5 * 15); near(at[2][1], 17.5 - (4 - 3) / 5 * 15);
  const dot = byAttrClass(home, 'icor-sqlv-spark-end')[0];
  assert.deepEqual([Number(dot.getAttribute('cx')), Number(dot.getAttribute('cy'))], [77.5, 2.5]);
  assert.equal(home.getAttribute('viewBox'), '0 0 80 20');
});

test('a flat series is a flat line through the middle; each line has its own scale', () => {
  const [, about, help] = sparks(draw(tileOf()));
  const ys = (svg) => byAttrClass(svg, 'icor-sqlv-spark-line')[0].getAttribute('points').split(' ').map((p) => Number(p.split(',')[1]));
  assert.deepEqual(ys(about), [10, 10, 10]);
  assert.deepEqual(ys(help), [17.5, 2.5, 10], '2, 4 and 3 spread over the full height whatever the other rows hold');
});

test('a sparkline says what it shows, on hover and to a screen reader', () => {
  const home = sparks(draw(tileOf()))[0];
  const said = 'Trend of 4 values, from 3 to 8, lowest 3, highest 8';
  assert.equal(home.getAttribute('aria-label'), said);
  assert.equal(home.getAttribute('role'), 'img');
  assert.equal(byTag(home, 'title')[0].textContent, said);
});

test('several columns can be named, and a name that is not in the result changes nothing', () => {
  const el = draw(tileOf({ sparklines: ['trend', 'also', 'gone'] }));
  assert.equal(sparks(el).length, 3 + 2, 'three lines in "trend" and two in "also" (1,2 and 4,3; the lone 5 and the empty cells stay text)');
});

test('the console\'s tables draw the text they are: the setting belongs to a widget', () => {
  const el = freshEl();
  lib.renderResultTable(el, TABLE, { maxRows: 50 });
  assert.equal(sparks(el).length, 0);
});

test('each part of the table that is not a sparkline is as it was: headings, empty cells, the row cap', () => {
  const el = draw(tileOf());
  assert.deepEqual(byTag(el, 'th').map((th) => th.textContent), ['page', 'visits', 'trend', 'also']);
  const many = { columns: ['page', 'trend'], rows: Array.from({ length: 80 }, (_, i) => ['p' + i, '1,2,3']) };
  const capped = draw(tileOf(), many);
  assert.equal(sparks(capped).length, 50, 'the widget\'s fifty-row cap');
  assert.match(byClass(capped, 'icor-sqlv-note')[0].textContent, /Showing the first 50 of 80 rows\./);
});

/* ------------------------------------------------------------ the spec -- */

test('the spec keeps the names, trimmed and without repeats, and names what is wrong, in plain words', () => {
  const ok = parse(tileOf({ sparklines: [' trend ', 'also', 'trend'] }));
  assert.equal(ok.ok, true, ok.reason);
  assert.deepEqual(unwrap(ok.spec.tiles[0].sparklines), ['trend', 'also']);
  const bad = [
    [tileOf({ sparklines: [] }), /"sparklines" must be a list of 1 to 8 column names, like \["trend"\]/],
    [tileOf({ sparklines: 'trend' }), /"sparklines" must be a list of 1 to 8 column names/],
    [tileOf({ sparklines: [''] }), /"sparklines" must be a list of 1 to 8 column names/],
    [tileOf({ sparklines: [3] }), /"sparklines" must be a list of 1 to 8 column names/],
    [tileOf({ sparklines: Array.from({ length: 9 }, (_, i) => 'c' + i) }), /"sparklines" must be a list of 1 to 8 column names/],
    [{ title: 'L', viz: 'line', x: 'a', y: 'b', sql: 'SELECT 1', sparklines: ['c'] }, /"sparklines" only works on a table widget/],
    [{ title: 'S', viz: 'stat', sql: 'SELECT 1', sparklines: ['c'] }, /"sparklines" only works on a table widget/],
  ];
  for (const [tile, re] of bad) {
    const r = parse(tile);
    assert.equal(r.ok, false, JSON.stringify(tile));
    assert.match(r.reason, re);
    assert.match(r.reason, /^Tile 1: /);
  }
});

test('the sparklines survive the spec file', () => {
  const json = lib.specToJson(parse(tileOf({ sparklines: ['trend', 'also'], hint: 'per day' })).spec);
  const back = JSON.parse(json).tiles[0];
  assert.deepEqual([back.viz, back.sparklines, back.hint], ['table', ['trend', 'also'], 'per day']);
  assert.equal(lib.parseDashboardSpec(json).ok, true);
  assert.equal(JSON.parse(lib.specToJson(parse({ title: 'T', viz: 'table', sql: 'SELECT 1' }).spec)).tiles[0].sparklines, undefined, 'no setting, no key');
});

/* ----------------------------------------------------- a real database -- */

test('a real query\'s group_concat reaches the page in the order its subquery gave', async () => {
  const initSqlJs = nodeRequire(resolve(repo, 'sql-wasm.js'));
  const SQL = await initSqlJs({ wasmBinary: readFileSync(resolve(repo, 'sql-wasm.wasm')) });
  const source = new SQL.Database();
  source.run('CREATE TABLE sales (channel TEXT, day TEXT, orders INTEGER)');
  source.run("INSERT INTO sales VALUES ('Web','2026-01-03',9),('Web','2026-01-01',3),('Web','2026-01-02',5),('Shop','2026-01-02',2),('Shop','2026-01-01',2),('Shop','2026-01-03',2)");
  const bytes = source.export();
  source.close();
  const pluginDir = '.obsidian/plugins/icor-for-life-sqlite-viewer';
  const adapter = makeFakeAdapter(
    { [pluginDir + '/sql-wasm.js']: readFileSync(resolve(repo, 'sql-wasm.js'), 'utf8') },
    { [pluginDir + '/sql-wasm.wasm']: readFileSync(resolve(repo, 'sql-wasm.wasm')), '07 Data/shop.db': bytes },
  );
  const fresh = loadPlugin({ desktop: false });
  const app = { vault: makeFakeVault(adapter, fresh.obsidian.TFile), workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  plugin.app = app;
  await plugin.onload();
  const sql = 'SELECT channel, SUM(orders) AS orders, group_concat(orders) AS trend FROM (SELECT channel, day, orders FROM sales ORDER BY day) GROUP BY channel ORDER BY channel';
  const res = await plugin.query.query('07 Data/shop.db', sql, { cap: 5000 });
  assert.deepEqual(unwrap(res.rows), [['Shop', 6, '2,2,2'], ['Web', 17, '3,5,9']]);
  const el = new fresh.obsidian.Modal({}).contentEl;
  fresh.lib.renderTile(el, fresh.lib.parseDashboardSpec(JSON.stringify({ id: 'sp', title: 'S', database: '07 Data/shop.db', tiles: [{ title: 'Orders', viz: 'table', sql, sparklines: ['trend'] }] })).spec.tiles[0], { columns: res.columns, rows: res.rows }, {});
  const lines = byAttrClass(el, 'icor-sqlv-spark');
  assert.equal(lines.length, 2);
  const web = byAttrClass(lines[1], 'icor-sqlv-spark-line')[0].getAttribute('points').split(' ').map((p) => Number(p.split(',')[1]));
  assert.ok(web[0] > web[1] && web[1] > web[2], 'Web rose from 3 to 9: the line climbs the page');
});

/* ------------------------------------------------------------ the form -- */

test('the table form offers the sparkline columns, builds them, reads them back and keeps them on a save', async () => {
  const { form, spec, lib: l } = await makeForm({ title: 'Visits', viz: 'table', sql: 'SELECT * FROM daily', sparklines: ['rate', 'web'] });
  form.open();
  assert.equal(form.state.sparklines, 'rate, web');
  assert.equal(byLabel(form.formEl, 'Sparkline columns (comma-separated)').value, 'rate, web');
  await form.runPreview();
  assert.equal(form.previewState, 'ok', form.previewError);
  assert.equal(form.dropNote.textContent, '', 'nothing is left out');
  form.state.sparklines = ' web ,, rate , web';
  form.touch();
  await form.runPreview();
  await form.save();
  assert.deepEqual(unwrap(asFileTile(l, spec.tiles[0]).sparklines), ['web', 'rate']);
  form.state.sparklines = '';
  form.touch();
  await form.runPreview();
  await form.save();
  assert.equal(asFileTile(l, spec.tiles[0]).sparklines, undefined, 'a cleared field clears the setting');
});

test('the field is a table\'s only: no other widget type offers it', async () => {
  for (const viz of ['line', 'stat']) {
    const { form } = await makeForm({ title: 'W', viz, sql: 'SELECT * FROM daily', x: 'day', y: ['web'] });
    form.open();
    assert.equal(byLabel(form.formEl, 'Sparkline columns (comma-separated)'), null, viz);
  }
  const { form } = await makeForm({ title: 'W', viz: 'table', sql: 'SELECT * FROM daily' });
  form.open();
  assert.ok(byLabel(form.formEl, 'Sparkline columns (comma-separated)'));
});
