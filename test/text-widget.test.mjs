/* A TEXT WIDGET: WORDS ON THE DASHBOARD.
 *
 * A dashboard could hold charts, numbers, tables and section dividers, but
 * no plain words: a note on how to read a chart, a disclaimer, a line
 * saying how fresh the data is. "viz": "text" shows either "text" written
 * in the tile, or the first column of its "sql" query's first row, so a
 * sentence can carry live numbers. "line": true makes it one quiet line in
 * a thin row, like a section divider. These gates pin the rules: the words
 * show as plain paragraphs, never markup; a written text runs no query on
 * any device and keeps its cache slot; a text line is thin; the edit form
 * is not offered for a type it cannot build; the spec refuses what makes
 * no sense, in plain words; it survives the spec file and the desktop
 * cache. Every value here is invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeFakeAdapter, unwrap } from './harness.mjs';

const { lib, obsidian } = loadPlugin();

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byClass = (root, cls) => [...walkEl(root)].filter((e) => e.classSet && e.classSet.has(cls));
const byTag = (root, tag) => [...walkEl(root)].filter((e) => e.tagName === tag.toUpperCase());
const freshEl = () => new obsidian.Modal({}).contentEl;
const parse = (tiles, extra) => lib.parseDashboardSpec(JSON.stringify(Object.assign({ id: 'tx', title: 'Words', database: '07 Data/x.db', tiles: Array.isArray(tiles) ? tiles : [tiles] }, extra)));

test('THE LIMIT: no other widget shows free words', () => {
  assert.equal(parse({ viz: 'stat', text: 'hello', sql: 'SELECT 1' }).ok, true, 'a stat ignores the field, as before');
  const el = freshEl();
  lib.renderTile(el, { viz: 'stat', y: ['v'] }, { columns: ['v'], rows: [[1]] }, {});
  assert.equal(byClass(el, 'icor-sqlv-text').length, 0);
});

test('written text shows as plain paragraphs and line breaks, never as markup', () => {
  const el = freshEl();
  lib.renderTile(el, { viz: 'text', title: 'Read me', text: 'First line\nsecond line\n\n<b>Not bold</b> **not bold**' }, { columns: [], rows: [] }, {});
  assert.deepEqual(byClass(el, 'icor-sqlv-tile-title').map((t) => t.textContent), ['Read me']);
  const paras = byTag(el, 'p');
  assert.equal(paras.length, 2);
  assert.deepEqual(byTag(paras[0], 'span').map((s) => s.textContent), ['First line', 'second line']);
  assert.equal(byTag(paras[0], 'br').length, 1);
  assert.deepEqual(byTag(paras[1], 'span').map((s) => s.textContent), ['<b>Not bold</b> **not bold**'], 'shown as typed');
  assert.equal(byTag(el, 'b').length, 0);
});

test('an SQL text shows the first column of the first row; a text line is one thin line', () => {
  assert.equal(lib.textOf({ sql: 'x' }, { columns: ['t', 'n'], rows: [['Fresh 7 min ago', 1], ['ignored', 2]] }), 'Fresh 7 min ago');
  assert.equal(lib.textOf({ sql: 'x' }, { columns: ['t'], rows: [] }), '');
  const el = freshEl();
  lib.renderTile(el, { viz: 'text', sql: 'x', line: true, title: 'not shown' }, { columns: ['t'], rows: [['A  long\nline']] }, {});
  const [line] = byClass(el, 'icor-sqlv-text-line');
  assert.equal(line.textContent, 'A long line');
  assert.equal(line.getAttribute('title'), 'A  long\nline');
  assert.equal(byClass(el, 'icor-sqlv-tile-title').length, 0, 'a line has no title row');
  const empty = freshEl();
  lib.renderTile(empty, { viz: 'text', sql: 'x' }, { columns: ['t'], rows: [] }, {});
  assert.equal(byClass(empty, 'icor-sqlv-empty')[0].textContent, 'No text to show.');
});

test('a text line sits in a thin row; written text has nothing to query', () => {
  assert.equal(lib.isThinTile({ viz: 'text', line: true }), true);
  assert.equal(lib.isThinTile({ viz: 'text' }), false);
  assert.equal(lib.isThinTile({ viz: 'divider' }), true);
  assert.equal(lib.drawsNoData({ viz: 'text', text: 'x' }), true);
  assert.equal(lib.drawsNoData({ viz: 'text', sql: 'SELECT 1' }), false);
  assert.deepEqual(unwrap(lib.defaultSpanFor({ viz: 'text', line: true })), { w: 6, h: 1 });
  assert.deepEqual(unwrap(lib.defaultSpanFor({ viz: 'text' })), { w: 2, h: 1 });
});

test('the spec keeps a text widget and names what is wrong, in plain words', () => {
  const ok = parse([{ viz: 'text', text: 'Hello', title: 'Note' }, { viz: 'text', sql: 'SELECT 1', line: true, layout: { x: 0, y: 1, w: 6, h: 1 } }]);
  assert.equal(ok.ok, true, ok.reason);
  assert.deepEqual(unwrap(ok.spec.tiles[0]), { title: 'Note', viz: 'text', text: 'Hello' });
  assert.equal(ok.spec.tiles[1].line, true);
  const bad = [
    [{ viz: 'text' }, /needs either "text" .* or "sql"/],
    [{ viz: 'text', text: 'a', sql: 'SELECT 1' }, /not both/],
    [{ viz: 'text', text: '   ' }, /"text" must be text, up to 2000 characters/],
    [{ viz: 'text', text: 'x'.repeat(2001) }, /up to 2000 characters/],
    [{ viz: 'text', sql: 'DELETE FROM t' }, /Tile 1: /],
    [{ viz: 'text', text: 'a', line: 'yes' }, /"line" must be true or false/],
    [{ viz: 'text', text: 'a', line: true, layout: { x: 0, y: 0, w: 6, h: 2 } }, /a text line is one thin row/],
    [{ viz: 'text', text: 'a', source: { table: 't' } }, /it takes no "source"/],
  ];
  for (const [tile, re] of bad) {
    const r = parse(tile);
    assert.equal(r.ok, false, JSON.stringify(tile));
    assert.match(r.reason, re);
  }
  const noDb = lib.parseDashboardSpec(JSON.stringify({ id: 'a', title: 'A', tiles: [{ viz: 'text', sql: 'SELECT 1' }] }));
  assert.match(noDb.reason, /needs a top-level "database"/);
  assert.equal(lib.parseDashboardSpec(JSON.stringify({ id: 'a', title: 'A', tiles: [{ viz: 'text', text: 'no database needed' }] })).ok, true);
});

test('a text widget survives the spec file', () => {
  const json = lib.specToJson(parse([{ viz: 'text', text: 'Hello\n\nthere', title: 'Note' }, { viz: 'text', sql: 'SELECT 1', line: true }]).spec);
  const back = JSON.parse(json).tiles;
  assert.deepEqual(back[0], { title: 'Note', viz: 'text', text: 'Hello\n\nthere' });
  assert.deepEqual(back[1], { viz: 'text', sql: 'SELECT 1', line: true });
  assert.equal(lib.parseDashboardSpec(json).ok, true);
});

/* ---------------------------------------------- the view and the cache -- */

const DASH = '07 Databases/Dashboards/tx.json';
const CACHE = '07 Databases/Dashboard Cache/dashboards/tx.json';
const SPEC = {
  id: 'tx', title: 'Words', database: '07 Databases/x.db',
  tiles: [
    { viz: 'text', text: 'Read this first.', layout: { x: 0, y: 0, w: 2, h: 1 } },
    { viz: 'text', sql: 'SELECT 1', line: true, layout: { x: 0, y: 1, w: 6, h: 1 } },
    { title: 'N', viz: 'stat', sql: 'SELECT 3 AS v', y: 'v', layout: { x: 0, y: 2, w: 1, h: 1 } },
  ],
};
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

test('written text runs no query; the SQL line does; a phone shows both from the cache', async () => {
  const desk = await makeView({ [DASH]: JSON.stringify(SPEC) }, { '07 Databases/x.db': new Uint8Array([1]) });
  desk.plugin.query.engineFor = async () => ({ engine: 'cli', size: 1 });
  let queries = 0;
  desk.plugin.query.query = async (db, sql) => { if (!/sqlite_master|PRAGMA/.test(sql)) queries++; return sql === 'SELECT 1' ? { columns: ['t'], rows: [['Data through Jan 2']], ms: 1 } : { columns: ['v'], rows: [[3]], ms: 1 }; };
  await desk.view.onOpen();
  await settle();
  assert.equal(queries, 2, 'the written text asked for nothing');
  assert.deepEqual(byClass(desk.view.contentEl, 'icor-sqlv-text-line').map((l) => l.textContent), ['Data through Jan 2']);
  const tiles = byClass(desk.view.contentEl, 'icor-sqlv-tile');
  assert.ok(tiles[1].classSet.has('is-line') && tiles[1].classSet.has('is-text'));
  assert.equal(byClass(desk.view.contentEl, 'icor-sqlv-dash-status')[0].textContent.startsWith('2 queries'), true, 'only the two data widgets count');
  const cache = desk.adapter.files.get(CACHE);
  assert.ok(cache, 'the desktop wrote its cache');
  const phone = await makeView({ [DASH]: JSON.stringify(SPEC), [CACHE]: cache }, { '07 Databases/x.db': new Uint8Array([1]) }, { desktop: false });
  phone.plugin.query.engineFor = async () => ({ engine: null, reason: 'Too big for this device.' });
  await phone.view.onOpen();
  await settle();
  assert.deepEqual(byTag(phone.view.contentEl, 'span').filter((s) => s.textContent === 'Read this first.').length, 1, 'written text needs no cache');
  assert.deepEqual(byClass(phone.view.contentEl, 'icor-sqlv-text-line').map((l) => l.textContent), ['Data through Jan 2']);
});

test('in edit mode a text widget can be moved and removed, but the form is not offered for it', async () => {
  const desk = await makeView({ [DASH]: JSON.stringify(SPEC) }, { '07 Databases/x.db': new Uint8Array([1]) });
  desk.plugin.query.engineFor = async () => ({ engine: 'cli', size: 1 });
  desk.plugin.query.query = async () => ({ columns: ['v'], rows: [[3]], ms: 1 });
  desk.view.editMode = true;
  await desk.view.onOpen();
  await settle();
  const tiles = byClass(desk.view.contentEl, 'icor-sqlv-tile');
  const labels = (t) => byClass(t, 'icor-sqlv-tile-action').map((b) => b.getAttribute('aria-label'));
  assert.deepEqual(labels(tiles[0]), ['Remove this widget']);
  assert.deepEqual(labels(tiles[2]), ['Edit this widget', 'Remove this widget']);
  assert.equal(lib.FORM_VIZ.has('text'), false);
});
