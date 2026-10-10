/* MIGRATION: .json DASHBOARDS AND CACHE FILES GET THEIR NOTE (1.1).
 *
 * A vault that has .json dashboards and cache files (every vault that used
 * ReadOut before 1.1, and any dashboard someone made by hand) needs their
 * notes, or a phone on default Obsidian Sync shows nothing. On load, on
 * whichever device holds the .json files, each one with no .md twin gets
 * one. These gates hold it to its promises: it never touches a .json, never
 * writes over a note, never makes a note from something that is not a
 * dashboard or a cache entry, runs the same on a phone, follows the folders
 * a member chose, writes nothing the second time, and never throws. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeFakeAdapter, makeFakeVault, noteJson, unwrap, notices } from './harness.mjs';

const DASH = '07 Databases/Dashboards';
const CACHE = '07 Databases/Dashboard Cache';
const DB = '07 Databases/shop.db';
const lib = loadPlugin().lib;

const SPEC = { id: 'shop', title: 'Shop', database: DB, globalTimeframe: { preset: '90d' }, tiles: [{ title: 'Orders', viz: 'stat', y: 'n', sql: 'SELECT 3 AS n' }] };
const SPEC_JSON = JSON.stringify(SPEC, null, 2) + '\n';
const CACHED = { dashboardId: 'shop', title: 'Shop', computedAt: '2026-10-01T00:00:00.000Z', tiles: [{ title: 'Orders', viz: 'stat', y: ['n'], columns: ['n'], rows: [[3]] }] };
const CATALOG = { database: DB, computedAt: '2026-09-01T10:00:00Z', tables: [{ name: 'orders', columns: [{ name: 'id', type: 'INTEGER' }] }], values: {} };
const BLOCK = { computedAt: '2026-10-01T00:00:00.000Z', result: { columns: ['n'], rows: [[1]] } };
const CATALOG_PATH = lib.catalogPathFor(CACHE, DB, 'json');

async function boot(files = {}, { desktop = true, saved, onLayoutReady } = {}) {
  const fresh = loadPlugin({ desktop });
  const adapter = makeFakeAdapter(files, { [DB]: new Uint8Array([1]) });
  adapter.stat = async (p) => (adapter.files.has(p) ? { size: 1, mtime: Date.now() } : null);
  const vault = makeFakeVault(adapter, fresh.obsidian.TFile);
  const app = { vault, workspace: { onLayoutReady: onLayoutReady || (() => {}), on: () => ({}) } };
  const plugin = fresh.makePlugin(app, saved);
  plugin.app = app;
  await plugin.onload();
  return { plugin, adapter, fresh };
}

const everything = () => ({
  [DASH + '/shop.json']: SPEC_JSON,
  [CACHE + '/dashboards/shop.json']: JSON.stringify(CACHED, null, 2),
  [CATALOG_PATH]: JSON.stringify(CATALOG, null, 2),
  [CACHE + '/notes/abc12345.json']: JSON.stringify(BLOCK),
});

test('a .json dashboard and each kind of .json cache file get a note beside them, holding the same JSON', async () => {
  const files = everything();
  const { plugin, adapter } = await boot(files);
  assert.equal(await plugin.migrateJsonToNotes(), 4);
  const dash = adapter.files.get(DASH + '/shop.md');
  assert.equal(dash.startsWith('---\nreadout: dashboard\n---\n'), true);
  assert.deepEqual(noteJson(dash), SPEC);
  assert.equal(lib.readReadoutNote(dash, 'dashboard').json, SPEC_JSON.trimEnd(), 'the same text, bar the final newline');
  assert.deepEqual(unwrap(noteJson(adapter.files.get(CACHE + '/dashboards/shop.md'))), CACHED);
  assert.deepEqual(unwrap(noteJson(adapter.files.get(CATALOG_PATH.replace(/\.json$/, '.md')))), CATALOG);
  assert.deepEqual(unwrap(noteJson(adapter.files.get(CACHE + '/notes/abc12345.md'))), BLOCK);
  assert.equal(adapter.files.get(CACHE + '/dashboards/shop.md').startsWith('---\nreadout: cache\n---\n'), true);
});

test('the .json files are never rewritten, moved or removed', async () => {
  const files = everything();
  const { plugin, adapter } = await boot(files);
  await plugin.migrateJsonToNotes();
  for (const [path, text] of Object.entries(files)) assert.equal(adapter.files.get(path), text, path);
  assert.deepEqual(adapter.log.filter(([op, p]) => (op !== 'write' && op !== 'mkdir') || (op === 'write' && p.endsWith('.json'))), []);
});

test('a second run writes nothing; the notes are the same after it', async () => {
  const { plugin, adapter } = await boot(everything());
  assert.equal(await plugin.migrateJsonToNotes(), 4);
  const after = new Map(adapter.files);
  adapter.log.length = 0;
  assert.equal(await plugin.migrateJsonToNotes(), 0);
  assert.deepEqual(adapter.log, []);
  assert.deepEqual([...adapter.files.entries()], [...after.entries()]);
});

test('a note with no .json beside it is left alone, and so is a note that already has its .json', async () => {
  const lone = lib.writeReadoutNote('dashboard', JSON.stringify(Object.assign({}, SPEC, { id: 'lone' })));
  const files = { [DASH + '/lone.md']: lone, [DASH + '/shop.md']: lib.writeReadoutNote('dashboard', JSON.stringify(SPEC)), [DASH + '/shop.json']: SPEC_JSON };
  const { plugin, adapter } = await boot(files);
  assert.equal(await plugin.migrateJsonToNotes(), 0);
  assert.equal(adapter.files.get(DASH + '/lone.md'), lone);
  assert.equal(adapter.files.get(DASH + '/shop.md'), files[DASH + '/shop.md']);
  assert.deepEqual(adapter.log.filter(([op]) => op === 'write'), []);
});

test('where both exist the note wins, even when the .json is newer or different: nothing is written over the note', async () => {
  const edited = '---\ntags: [mine]\nreadout: dashboard\n---\n\nMy words.\n\n```json\n' + JSON.stringify(Object.assign({}, SPEC, { title: 'Edited by hand' })) + '\n```\n';
  const { plugin, adapter } = await boot({ [DASH + '/shop.json']: SPEC_JSON, [DASH + '/shop.md']: edited });
  assert.equal(await plugin.migrateJsonToNotes(), 0);
  assert.equal(adapter.files.get(DASH + '/shop.md'), edited, 'a note the member edited in Obsidian is untouched');
  const { specs } = await plugin.loadDashboardSpecs();
  assert.equal(specs[0].title, 'Edited by hand');
});

test('a note of the member\'s own that happens to share a .json\'s name is not written over, and the .json keeps working', async () => {
  const mine = '# shop\n\nMy shopping thoughts.\n';
  const { plugin, adapter } = await boot({ [DASH + '/shop.json']: SPEC_JSON, [DASH + '/shop.md']: mine });
  assert.equal(await plugin.migrateJsonToNotes(), 0);
  assert.equal(adapter.files.get(DASH + '/shop.md'), mine);
  const { specs } = await plugin.loadDashboardSpecs();
  assert.deepEqual(unwrap(specs.map((s) => [s.id, s.path])), [['shop', DASH + '/shop.json']]);
});

test('a .json that is malformed, or valid JSON that is not a dashboard or a cache entry, gets no note and no error', async () => {
  const files = {
    [DASH + '/broken.json']: '{ "id": "broken", ',
    [DASH + '/not-a-dashboard.json']: JSON.stringify({ hello: 'world' }),
    [DASH + '/list.json']: '[1,2,3]',
    [DASH + '/empty.json']: '',
    [DASH + '/bad-id.json']: JSON.stringify({ id: 'Bad Id!', title: 'x', tiles: [] }),
    [CACHE + '/dashboards/broken.json']: '{ nope',
    [CACHE + '/dashboards/wrong.json']: JSON.stringify({ tiles: 'nope' }),
    [CACHE + '/dashboards/null.json']: 'null',
    [CACHE + '/catalogs/' + 'x-0123abcd.json']: JSON.stringify({ tables: 'nope' }),
    [CACHE + '/notes/odd.json']: JSON.stringify({ result: 5 }),
  };
  const { plugin, adapter } = await boot(files);
  assert.equal(await plugin.migrateJsonToNotes(), 0);
  assert.deepEqual([...adapter.files.keys()].filter((p) => p.endsWith('.md')), []);
  const { errors } = await plugin.loadDashboardSpecs();
  assert.equal(errors.length, 5, 'the broken dashboards still say what is wrong, as before');
});

test('only the files directly inside the four folders are looked at; the 0.5.0 stem catalog and the 0.1.x cache are not carried over', async () => {
  const files = {
    [DASH + '/sub/deep.json']: SPEC_JSON,
    [DASH + '/readme.txt']: 'x',
    [CACHE + '/catalogs/shop.json']: JSON.stringify(CATALOG),
    [CACHE + '/shop/shop.json']: JSON.stringify(CACHED),
    [CACHE + '/other/thing.json']: JSON.stringify(CACHED),
    '07 Databases/elsewhere.json': SPEC_JSON,
    'Notes/dash.json': SPEC_JSON,
  };
  const { plugin, adapter } = await boot(files);
  assert.equal(await plugin.migrateJsonToNotes(), 0);
  assert.equal([...adapter.files.keys()].filter((p) => p.endsWith('.md')).length, 0);
});

test('it follows the folders a member chose, however they typed them', async () => {
  const files = {};
  files['Boards/Mine/shop.json'] = SPEC_JSON;
  files['Elsewhere/Phone Cache/dashboards/shop.json'] = JSON.stringify(CACHED);
  files['Elsewhere/Phone Cache/catalogs/' + lib.catalogPathFor('x', DB, 'json').split('/').pop()] = JSON.stringify(CATALOG);
  files['Elsewhere/Phone Cache/notes/k.json'] = JSON.stringify(BLOCK);
  files['07 Databases/Dashboards/ignored.json'] = SPEC_JSON;
  const { plugin, adapter } = await boot(files, { saved: { dashboardFolder: '/Boards\\Mine/', cacheFolder: 'Elsewhere//Phone Cache/' } });
  assert.equal(plugin.settings.dashboardFolder, 'Boards/Mine');
  assert.equal(plugin.settings.cacheFolder, 'Elsewhere/Phone Cache');
  assert.equal(await plugin.migrateJsonToNotes(), 4);
  assert.deepEqual([...adapter.files.keys()].filter((p) => p.endsWith('.md')).sort(), [
    'Boards/Mine/shop.md',
    'Elsewhere/Phone Cache/catalogs/' + lib.catalogPathFor('x', DB, 'md').split('/').pop(),
    'Elsewhere/Phone Cache/dashboards/shop.md',
    'Elsewhere/Phone Cache/notes/k.md',
  ].sort());
});

test('a folder name with spaces, dots and capitals, nested deep, works the same', async () => {
  const dash = 'My Vault.v2/Data Stuff/Boards (new)';
  const cache = 'My Vault.v2/Data Stuff/Cache';
  const { plugin, adapter } = await boot({ [dash + '/Shop Board.json']: JSON.stringify(Object.assign({}, SPEC, { id: 'shop-board' })), [cache + '/dashboards/shop-board.json']: JSON.stringify(CACHED) }, { saved: { dashboardFolder: dash, cacheFolder: cache } });
  assert.equal(await plugin.migrateJsonToNotes(), 2);
  assert.equal(adapter.files.has(dash + '/Shop Board.md'), true);
  assert.equal(adapter.files.has(cache + '/dashboards/shop-board.md'), true);
});

test('a phone migrates too: it holds .json files it was given, and then draws from the notes with no database', async () => {
  const { plugin, adapter } = await boot(everything(), { desktop: false });
  assert.equal(await plugin.migrateJsonToNotes(), 4);
  /* Take the .json files away, as default Sync would never have brought them. */
  for (const path of [...adapter.files.keys()]) if (path.endsWith('.json')) adapter.files.delete(path);
  plugin.query.engineFor = async () => ({ engine: null, reason: 'Too big for this device.' });
  const view = plugin.viewFactories['readout-dashboards']({ app: plugin.app });
  view.app = plugin.app;
  await view.onOpen();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(unwrap(view.specs.map((s) => s.id)), ['shop']);
  const cache = await plugin.readDashboardCache(view.specs[0]);
  assert.deepEqual(unwrap(cache.tiles), CACHED.tiles);
});

test('it runs when the workspace is ready on the desktop, once, with one line saying what it did; a phone writes nothing at start', async () => {
  const desk = await boot(everything(), { desktop: true, onLayoutReady: (fn) => fn() });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(desk.adapter.files.has(DASH + '/shop.md'), true);
  assert.equal(desk.adapter.files.has(CACHE + '/dashboards/shop.md'), true);
  assert.deepEqual(notices.filter((n) => /^ReadOut wrote/.test(n)), ['ReadOut wrote 4 notes beside your old .json dashboards and cache so your phone gets them. The .json files are unchanged. Once every device runs ReadOut 1.1, run "Remove old .json dashboards and cache files".']);

  /* Nothing left to write: no notice. */
  notices.length = 0;
  const again = await boot(Object.fromEntries(desk.adapter.files), { desktop: true, onLayoutReady: (fn) => fn() });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(notices.filter((n) => /^ReadOut wrote/.test(n)), []);
  assert.equal(again.adapter.log.filter(([op]) => op === 'write').length, 0);

  notices.length = 0;
  const phone = await boot(everything(), { desktop: false, onLayoutReady: (fn) => fn() });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(phone.adapter.log.filter(([op]) => op === 'write'), [], 'a phone writes no note at start');
  assert.deepEqual(notices.filter((n) => /^ReadOut wrote/.test(n)), []);
});

test('it never throws: a folder that cannot be listed, a file that cannot be read or written, a missing folder', async () => {
  const none = await boot({});
  assert.equal(await none.plugin.migrateJsonToNotes(), 0, 'no folders at all');

  const a = await boot(everything());
  a.adapter.list = async () => { throw new Error('cannot list'); };
  assert.equal(await a.plugin.migrateJsonToNotes(), 0);

  const b = await boot(everything());
  b.adapter.read = async () => { throw new Error('cannot read'); };
  assert.equal(await b.plugin.migrateJsonToNotes(), 0);

  const c = await boot(everything());
  const write = c.adapter.write.bind(c.adapter);
  let n = 0;
  c.adapter.write = async (p, t) => { if (++n === 2) throw new Error('disk full'); return write(p, t); };
  assert.equal(await c.plugin.migrateJsonToNotes(), 3, 'one failed write skips that file only');
  assert.equal(await c.plugin.migrateJsonToNotes(), 1, 'and the next run finishes it');

  const d = await boot(everything());
  d.adapter.exists = async () => { throw new Error('cannot stat'); };
  assert.equal(await d.plugin.migrateJsonToNotes(), 0);
});

test('a note that arrives through Sync while a file is being read is not written over', async () => {
  const { plugin, adapter } = await boot({ [DASH + '/shop.json']: SPEC_JSON });
  const read = adapter.read.bind(adapter);
  const arrived = lib.writeReadoutNote('dashboard', JSON.stringify(Object.assign({}, SPEC, { title: 'From Sync' })));
  adapter.read = async (p) => { const t = await read(p); adapter.files.set(DASH + '/shop.md', arrived); return t; };
  assert.equal(await plugin.migrateJsonToNotes(), 0);
  assert.equal(adapter.files.get(DASH + '/shop.md'), arrived);
});

test('after migration the dashboards view lists each dashboard once, from its note', async () => {
  const { plugin } = await boot(everything());
  await plugin.migrateJsonToNotes();
  const { specs, errors } = await plugin.loadDashboardSpecs();
  assert.deepEqual(unwrap(specs.map((s) => [s.id, s.path])), [['shop', DASH + '/shop.md']]);
  assert.deepEqual(unwrap(errors), []);
  assert.deepEqual(unwrap((await plugin.readDashboardCache(specs[0])).tiles), CACHED.tiles);
});

/* ------------------------------------------- removing the old .json -- */

async function withTrash(files, opts) {
  const ctx = await boot(files, opts);
  const trashed = [];
  const vault = ctx.plugin.app.vault;
  vault.trash = async (file, system) => { trashed.push([file.path, system]); ctx.adapter.files.delete(file.path); };
  return Object.assign(ctx, { trashed });
}

test('"Remove old .json dashboards and cache files" moves a .json to the trash once its note is there, and never hard-deletes', async () => {
  const { plugin, adapter, trashed } = await withTrash(everything());
  assert.equal(await plugin.removeOldJsonFiles(), 0, 'no note yet: nothing goes');
  await plugin.migrateJsonToNotes();
  adapter.log.length = 0;
  assert.equal(await plugin.removeOldJsonFiles(), 4);
  assert.deepEqual(trashed.map(([p]) => p).sort(), Object.keys(everything()).sort());
  assert.deepEqual(trashed.map(([, system]) => system), [true, true, true, true], 'the system trash first');
  assert.deepEqual(adapter.log.filter(([op]) => op === 'remove'), [], 'no hard delete');
  assert.equal([...adapter.files.keys()].every((p) => p.endsWith('.md') || p === DB), true);
  const { specs } = await plugin.loadDashboardSpecs();
  assert.deepEqual(unwrap(specs.map((s) => s.id)), ['shop'], 'the dashboard is still there');
});

test('only a .json whose note is ReadOut\'s, of the right kind, and holds the same id is removed', async () => {
  const other = lib.writeReadoutNote('dashboard', JSON.stringify(Object.assign({}, SPEC, { id: 'different' })));
  const files = {
    [DASH + '/same.json']: JSON.stringify(Object.assign({}, SPEC, { id: 'same' })), [DASH + '/same.md']: lib.writeReadoutNote('dashboard', JSON.stringify(Object.assign({}, SPEC, { id: 'same' }))),
    [DASH + '/lone.json']: JSON.stringify(Object.assign({}, SPEC, { id: 'lone' })),
    [DASH + '/mine.json']: JSON.stringify(Object.assign({}, SPEC, { id: 'mine' })), [DASH + '/mine.md']: '# my own note\n',
    [DASH + '/moved.json']: JSON.stringify(Object.assign({}, SPEC, { id: 'moved' })), [DASH + '/moved.md']: other,
    [DASH + '/broken.json']: JSON.stringify(Object.assign({}, SPEC, { id: 'broken' })), [DASH + '/broken.md']: lib.writeReadoutNote('dashboard', '{ nope'),
    [DASH + '/wrongkind.json']: JSON.stringify(Object.assign({}, SPEC, { id: 'wrongkind' })), [DASH + '/wrongkind.md']: lib.writeReadoutNote('cache', JSON.stringify(Object.assign({}, SPEC, { id: 'wrongkind' }))),
    [DASH + '/noid.json']: JSON.stringify({ title: 'x', tiles: [] }), [DASH + '/noid.md']: lib.writeReadoutNote('dashboard', JSON.stringify({ title: 'x', tiles: [] })),
    [CACHE + '/dashboards/c.json']: JSON.stringify({ dashboardId: 'c', computedAt: 'x', tiles: [] }), [CACHE + '/dashboards/c.md']: lib.writeReadoutNote('cache', JSON.stringify({ dashboardId: 'other', computedAt: 'x', tiles: [] })),
    [CACHE + '/catalogs/shop.json']: JSON.stringify(CATALOG), [CACHE + '/catalogs/shop.md']: lib.writeReadoutNote('cache', JSON.stringify(CATALOG)),
  };
  const { plugin, trashed, adapter } = await withTrash(files);
  assert.equal(await plugin.removeOldJsonFiles(), 1);
  assert.deepEqual(trashed.map(([p]) => p), [DASH + '/same.json']);
  assert.equal(adapter.files.has(DASH + '/lone.json'), true);
  assert.equal(adapter.files.has(CACHE + '/catalogs/shop.json'), true, 'the 0.5.0 stem catalog is never part of it');
});

test('a .json Obsidian does not index, or a vault with no trash, is left; the command says what it did', async () => {
  const files = everything();
  const a = await withTrash(files);
  await a.plugin.migrateJsonToNotes();
  a.plugin.app.vault.getAbstractFileByPath = () => null;
  assert.equal(await a.plugin.removeOldJsonFiles(), 0);
  const b = await boot(files);
  await b.plugin.migrateJsonToNotes();
  assert.equal(await b.plugin.removeOldJsonFiles(), 0, 'no trash in the vault API: nothing is deleted another way');
  assert.equal(b.adapter.files.has(DASH + '/shop.json'), true);

  const c = await withTrash(files);
  await c.plugin.migrateJsonToNotes();
  const command = c.plugin.commands.find((x) => x.id === 'remove-old-json');
  assert.equal(command.name, 'Remove old .json dashboards and cache files');
  notices.length = 0;
  await c.plugin.removeOldJsonWithNotice();
  assert.deepEqual(notices, ['Moved 4 old .json files to the trash. Their notes are what ReadOut uses.']);
  notices.length = 0;
  await c.plugin.removeOldJsonWithNotice();
  assert.match(notices[0], /nothing was moved/);
});

test('nothing is removed by itself: starting the plugin, with notes and .json side by side, trashes nothing', async () => {
  const ctx = await withTrash(everything(), { desktop: true, onLayoutReady: (fn) => fn() });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(ctx.trashed, []);
  assert.equal(ctx.adapter.files.has(DASH + '/shop.json'), true);
});
