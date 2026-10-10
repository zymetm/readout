/* THE PHONE CACHE IS NOTES (1.1).
 *
 * The desktop keeps what a phone needs (the last answers of each dashboard,
 * the schema of each database, the result of each widget written in a note)
 * in the cache folder. Default Obsidian Sync carries .md files and leaves
 * .json behind, so every one of those is now a ReadOut note (readout:
 * cache). These gates hold that to its promises: the desktop writes nothing
 * but notes, the phone draws from them with the database missing, and what
 * earlier versions wrote as .json is still read, the note winning where both
 * exist. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeFakeAdapter, makeFakeVault, noteJson, cacheNote, unwrap } from './harness.mjs';

const CACHE = '07 Databases/Dashboard Cache';
const DAY = 24 * 60 * 60 * 1000;
const DB = '07 Databases/shop.db';
const lib = loadPlugin().lib;

async function boot(files = {}, { desktop = true, ages = {}, saved } = {}) {
  const fresh = loadPlugin({ desktop });
  const adapter = makeFakeAdapter(files, { [DB]: new Uint8Array([1]) });
  adapter.stat = async (p) => (adapter.files.has(p) ? { size: 1, mtime: ages[p] === undefined ? Date.now() : Date.now() - ages[p] } : null);
  const vault = makeFakeVault(adapter, fresh.obsidian.TFile);
  const app = { vault, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app, saved);
  plugin.app = app;
  await plugin.onload();
  return { plugin, adapter, fresh };
}

const SPEC = { id: 'shop', title: 'Shop', database: DB, tiles: [{ title: 'Orders', viz: 'stat', y: 'n', sql: 'SELECT 3 AS n' }] };
const TILES = [{ title: 'Orders', viz: 'stat', x: '', y: ['n'], unit: '', stack: false, columns: ['n'], rows: [[3]] }];
const CACHED = { dashboardId: 'shop', title: 'Shop', computedAt: '2026-10-01T00:00:00.000Z', tiles: TILES };

test('the desktop writes the dashboard cache as a cache note, and reads it back', async () => {
  const { plugin, adapter } = await boot();
  await plugin.writeDashboardCache(SPEC, TILES);
  const path = CACHE + '/dashboards/shop.md';
  assert.equal(adapter.files.has(path), true);
  assert.equal(adapter.files.has(CACHE + '/dashboards/shop.json'), false, 'no .json');
  assert.equal(adapter.files.get(path).startsWith('---\nreadout: cache\n---\n'), true);
  assert.deepEqual(unwrap(noteJson(adapter.files.get(path)).tiles), TILES);
  const back = await plugin.readDashboardCache(SPEC);
  assert.deepEqual(unwrap(back.tiles), TILES);
});

test('everything the plugin writes for a phone is a .md file: a dashboard, its cache, a catalog, a widget in a note', async () => {
  const { plugin, adapter } = await boot();
  await plugin.createDashboard();
  await plugin.writeDashboardCache(SPEC, TILES);
  plugin.query.engineFor = async () => ({ engine: 'cli', size: 1 });
  plugin.query.query = async (db, sql) => (/sqlite_master/.test(sql)
    ? { columns: ['name'], rows: [['orders']], ms: 1 }
    : { columns: ['cid', 'name', 'type'], rows: [[0, 'id', 'INTEGER']], ms: 1 });
  await plugin.writeCatalog(DB);
  plugin.keepBlockResult('abc12345', { columns: ['n'], rows: [[1]] });
  await new Promise((r) => setTimeout(r, 20));
  const written = [...new Set(adapter.log.filter(([op]) => op === 'write').map(([, p]) => p))];
  assert.equal(written.length >= 4, true, 'all four kinds were written: ' + written.join(', '));
  assert.deepEqual(written.filter((p) => !p.endsWith('.md')), [], 'nothing but notes, which is what default Sync carries');
});

test('a phone with no .json anywhere and no database draws a dashboard from the notes, "Computed on desktop"', async () => {
  const dashboard = lib.writeReadoutNote('dashboard', JSON.stringify(SPEC, null, 2));
  const { plugin, fresh } = await boot({
    '07 Databases/Dashboards/shop.md': dashboard,
    [CACHE + '/dashboards/shop.md']: cacheNote(CACHED),
  }, { desktop: false });
  plugin.query.engineFor = async () => ({ engine: null, reason: 'Too big for this device.' });
  const view = plugin.viewFactories['readout-dashboards']({ app: plugin.app });
  view.app = plugin.app;
  await view.onOpen();
  await new Promise((r) => setTimeout(r, 20));
  const text = [];
  const walk = (el) => { text.push(el.textContent || ''); for (const c of el.children || []) walk(c); };
  walk(view.contentEl);
  const all = text.join(' ');
  assert.equal(view.specs.length, 1);
  assert.match(all, /Computed on desktop/);
  assert.match(all, /Orders/);
  assert.doesNotMatch(all, /could not|No cached result/i);
  assert.ok(fresh);
});

test('the cache falls back to what earlier versions wrote; the note wins where both exist; a broken note falls back', async () => {
  const older = Object.assign({}, CACHED, { computedAt: '2026-09-01T00:00:00.000Z', title: 'Old' });
  const json = CACHE + '/dashboards/shop.json';
  const md = CACHE + '/dashboards/shop.md';
  const a = await boot({ [json]: JSON.stringify(older) });
  assert.equal((await a.plugin.readDashboardCache(SPEC)).title, 'Old', 'json only');
  const b = await boot({ [json]: JSON.stringify(older), [md]: cacheNote(CACHED) });
  assert.equal((await b.plugin.readDashboardCache(SPEC)).title, 'Shop', 'both: the note');
  const c = await boot({ [json]: JSON.stringify(older), [md]: '---\nreadout: cache\n---\n\nthe block is gone\n' });
  assert.equal((await c.plugin.readDashboardCache(SPEC)).title, 'Old', 'a note that cannot be read');
  const d = await boot({ [md]: '---\nreadout: cache\n---\n\n```json\n{ nope\n```\n', [json]: '{ nope' });
  assert.equal(await d.plugin.readDashboardCache(SPEC), null, 'nothing readable reads as no cache, not as a crash');
  const e = await boot({});
  assert.equal(await e.plugin.readDashboardCache(SPEC), null);
  const f = await boot({ [md]: cacheNote({ dashboardId: 'shop', tiles: 'wrong' }) });
  assert.equal(await f.plugin.readDashboardCache(SPEC), null, 'a note of the wrong shape');
});

test('the 0.1.x cache under the database stem is still the last resort', async () => {
  const { plugin } = await boot({ [CACHE + '/shop/shop.json']: JSON.stringify(Object.assign({}, CACHED, { title: 'Very old' })) });
  assert.equal((await plugin.readDashboardCache(SPEC)).title, 'Very old');
});

test('the catalog is a cache note; the picker reads it, then the .json of earlier versions, then the 0.5.0 stem file', async () => {
  const catalog = (title) => ({ database: DB, computedAt: '2026-09-01T10:00:00Z', tables: [{ name: title, columns: [{ name: 'id', type: 'INTEGER' }] }], values: {} });
  const key = lib.catalogPathFor(CACHE, DB, 'md');
  const keyJson = lib.catalogPathFor(CACHE, DB, 'json');
  const stem = CACHE + '/catalogs/shop.json';
  const names = async (files) => (await (await boot(files, { desktop: false })).plugin.readCatalog(DB)).tables[0].name;
  assert.equal(await names({ [key]: cacheNote(catalog('from_note')), [keyJson]: JSON.stringify(catalog('from_json')), [stem]: JSON.stringify(catalog('from_stem')) }), 'from_note');
  assert.equal(await names({ [keyJson]: JSON.stringify(catalog('from_json')), [stem]: JSON.stringify(catalog('from_stem')) }), 'from_json');
  assert.equal(await names({ [stem]: JSON.stringify(catalog('from_stem')) }), 'from_stem');
  const other = Object.assign(catalog('elsewhere'), { database: 'Other/shop.db' });
  assert.equal(await (await boot({ [key]: cacheNote(other) }, { desktop: false })).plugin.readCatalog(DB), null, 'a catalog that names another database is not trusted');
});

test('a widget written in a note keeps its result as a cache note, reads the .json of earlier versions, and the note wins', async () => {
  const result = (n) => ({ computedAt: '2026-10-01T00:00:00.000Z', result: { columns: ['n'], rows: [[n]] } });
  const md = lib.blockCachePath(CACHE, 'k1');
  const json = lib.blockCachePath(CACHE, 'k1', 'json');
  assert.equal(md.endsWith('/notes/k1.md'), true);
  const a = await boot({ [json]: JSON.stringify(result(1)) });
  assert.equal((await a.plugin.readBlockCache('k1')).result.rows[0][0], 1);
  const b = await boot({ [json]: JSON.stringify(result(1)), [md]: cacheNote(result(2)) });
  assert.equal((await b.plugin.readBlockCache('k1')).result.rows[0][0], 2);
  assert.equal(await (await boot({})).plugin.readBlockCache('k1'), null);
});

test('pruning removes old cache notes and old .json files, never a note of the member\'s own or the dashboard cache', async () => {
  const files = {
    [CACHE + '/notes/old.md']: cacheNote({}),
    [CACHE + '/notes/old.json']: '{}',
    [CACHE + '/notes/recent.md']: cacheNote({}),
    [CACHE + '/notes/mine.md']: '# my own note about this\n',
    [CACHE + '/notes/mine-with-properties.md']: '---\ntags: [x]\n---\nhello\n',
    [CACHE + '/dashboards/stale.md']: cacheNote({}),
  };
  const ages = {
    [CACHE + '/notes/old.md']: 61 * DAY,
    [CACHE + '/notes/old.json']: 61 * DAY,
    [CACHE + '/notes/recent.md']: 2 * DAY,
    [CACHE + '/notes/mine.md']: 400 * DAY,
    [CACHE + '/notes/mine-with-properties.md']: 400 * DAY,
    [CACHE + '/dashboards/stale.md']: 400 * DAY,
  };
  const { plugin, adapter } = await boot(files, { ages });
  assert.equal(await plugin.pruneBlockCache(), 2);
  assert.deepEqual([...adapter.files.keys()].sort(), [
    CACHE + '/dashboards/stale.md',
    CACHE + '/notes/mine-with-properties.md',
    CACHE + '/notes/mine.md',
    CACHE + '/notes/recent.md',
  ]);
});

test('a cache write never replaces a note that is not ReadOut\'s, and the dashboards view says so in its status line', async () => {
  const mine = '# shop\n\nMy own note, named like a cache entry.\n';
  const path = CACHE + '/dashboards/shop.md';
  const { plugin, adapter } = await boot({ [path]: mine, '07 Databases/Dashboards/shop.md': lib.writeReadoutNote('dashboard', JSON.stringify(SPEC)) });
  await assert.rejects(() => plugin.writeDashboardCache(SPEC, TILES), /shop\.md is not a ReadOut note/);
  assert.equal(adapter.files.get(path), mine, 'not written over');
  /* In the view: a live, healthy desktop run tries to freeze its cache. */
  plugin.query.engineFor = async () => ({ engine: 'cli', size: 1 });
  plugin.query.query = async () => ({ columns: ['n'], rows: [[3]], ms: 1 });
  const view = plugin.viewFactories['readout-dashboards']({ app: plugin.app });
  view.app = plugin.app;
  await view.onOpen();
  await new Promise((r) => setTimeout(r, 30));
  const text = [];
  const walk = (el) => { text.push(el.textContent || ''); for (const c of el.children || []) walk(c); };
  walk(view.contentEl);
  assert.match(text.join(' '), /The cache could not be written: shop\.md is not a ReadOut note/);
  assert.equal(adapter.files.get(path), mine);
  /* A ReadOut cache note, and a path with nothing there, are written as before. */
  adapter.files.set(path, cacheNote(CACHED));
  await plugin.writeDashboardCache(SPEC, TILES);
  assert.equal(noteJson(adapter.files.get(path)).dashboardId, 'shop');
});

test('cache notes are written compact: the JSON is one line', async () => {
  const { plugin, adapter } = await boot();
  await plugin.writeDashboardCache(SPEC, TILES);
  plugin.query.engineFor = async () => ({ engine: 'cli', size: 1 });
  plugin.query.query = async (db, sql) => (/sqlite_master/.test(sql)
    ? { columns: ['name'], rows: [['orders']], ms: 1 }
    : { columns: ['cid', 'name', 'type'], rows: [[0, 'id', 'INTEGER']], ms: 1 });
  await plugin.writeCatalog(DB);
  for (const path of [...adapter.files.keys()].filter((p) => p.endsWith('.md'))) {
    const text = adapter.files.get(path);
    const body = text.split('```json\n')[1].split('\n```')[0];
    assert.equal(body.includes('\n'), false, path + ' is one line');
    assert.equal(/\n {2}"/.test(text), false, path + ' is not indented');
  }
  assert.equal(adapter.files.size, 2);
});

test('a cache note over about 4 MB adds a plain line to the desktop status; a smaller one does not; nothing is cut', async () => {
  const MB = 1024 * 1024;
  const statusFor = async (bytes) => {
    const { plugin, adapter } = await boot({ '07 Databases/Dashboards/shop.md': lib.writeReadoutNote('dashboard', JSON.stringify(SPEC)) });
    plugin.query.engineFor = async () => ({ engine: 'cli', size: 1 });
    plugin.query.query = async () => ({ columns: ['n'], rows: [['x'.repeat(bytes)]], ms: 1 });
    const view = plugin.viewFactories['readout-dashboards']({ app: plugin.app });
    view.app = plugin.app;
    await view.onOpen();
    await new Promise((r) => setTimeout(r, 60));
    const text = [];
    const walk = (el) => { text.push(el.textContent || ''); for (const c of el.children || []) walk(c); };
    walk(view.contentEl);
    return { all: text.join(' '), adapter };
  };
  const big = await statusFor(5 * MB);
  assert.match(big.all, /This dashboard's cache is 5\.\d MB; Obsidian Sync Standard carries files up to 5 MB, so your phone may not get it\. Fewer rows in big tables will fix it\./);
  assert.equal(noteJson(big.adapter.files.get(CACHE + '/dashboards/shop.md')).tiles[0].rows[0][0].length, 5 * MB, 'written whole');
  const small = await statusFor(1000);
  assert.doesNotMatch(small.all, /Obsidian Sync Standard/);
});

test('when a note and a .json both read, the one computed last is used; a tie goes to the note', async () => {
  const at = (iso, title) => Object.assign({}, CACHED, { computedAt: iso, title });
  const md = CACHE + '/dashboards/shop.md';
  const json = CACHE + '/dashboards/shop.json';
  /* A desktop still on 1.0.x keeps writing the .json, newer than the note. */
  const a = await boot({ [md]: cacheNote(at('2026-10-01T00:00:00.000Z', 'Note')), [json]: JSON.stringify(at('2026-10-05T00:00:00.000Z', 'Newer json')) });
  assert.equal((await a.plugin.readDashboardCache(SPEC)).title, 'Newer json');
  const b = await boot({ [md]: cacheNote(at('2026-10-05T00:00:00.000Z', 'Newer note')), [json]: JSON.stringify(at('2026-10-01T00:00:00.000Z', 'Json')) });
  assert.equal((await b.plugin.readDashboardCache(SPEC)).title, 'Newer note');
  const c = await boot({ [md]: cacheNote(at('2026-10-01T00:00:00.000Z', 'Note')), [json]: JSON.stringify(at('2026-10-01T00:00:00.000Z', 'Json')) });
  assert.equal((await c.plugin.readDashboardCache(SPEC)).title, 'Note');

  const block = (iso, n) => ({ computedAt: iso, result: { columns: ['n'], rows: [[n]] } });
  const d = await boot({ [lib.blockCachePath(CACHE, 'k')]: cacheNote(block('2026-10-01T00:00:00.000Z', 1)), [lib.blockCachePath(CACHE, 'k', 'json')]: JSON.stringify(block('2026-10-05T00:00:00.000Z', 2)) });
  assert.equal((await d.plugin.readBlockCache('k')).result.rows[0][0], 2);

  const cat = (iso, name) => ({ database: DB, computedAt: iso, tables: [{ name, columns: [] }], values: {} });
  const e = await boot({ [lib.catalogPathFor(CACHE, DB, 'md')]: cacheNote(cat('2026-10-01T00:00:00.000Z', 'from_note')), [lib.catalogPathFor(CACHE, DB, 'json')]: JSON.stringify(cat('2026-10-05T00:00:00.000Z', 'from_json')) }, { desktop: false });
  assert.equal((await e.plugin.readCatalog(DB)).tables[0].name, 'from_json');
});
