/* The scope setting, the 1.0.6 migration, and the gentle note for a database
 * opened from outside the databases folder: once per file, off with a
 * setting, never from a dashboard, and a move only on a click, never over a
 * file. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, notices, noticeObjects, unwrap, makeFakeAdapter, makeFakeVault } from './harness.mjs';

async function session(binaries, data, files = {}) {
  const fresh = loadPlugin({ desktop: true });
  const adapter = makeFakeAdapter(files, binaries);
  const vault = makeFakeVault(adapter, fresh.obsidian.TFile);
  vault.create = async (p, text) => { await adapter.write(p, text); return new fresh.obsidian.TFile(p); };
  vault.rename = async (f, to) => { await adapter.rename(f.path, to); f.path = to; };
  const app = { vault, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  plugin.app = app;
  if (data) plugin.saved = data;
  await plugin.onload();
  return { plugin, adapter, fresh };
}
const buttonOf = (n) => n.noticeEl.children.find((c) => c.tagName === 'BUTTON');

test('1.0.6 saved the vault root as the databases folder: it is restored, and the whole vault is searched', async () => {
  const { plugin } = await session({ 'mypka.db': new Uint8Array(2) }, { dataFolder: '/', weekStart: 'monday' });
  assert.equal(plugin.settings.dataFolder, 'Databases');
  assert.equal(plugin.settings.searchScope, 'vault');
  assert.equal(plugin.settings.weekStart, 'monday');
  assert.deepEqual(unwrap(plugin.vaultDatabases().map((d) => d.path)), ['mypka.db'], 'a database at the vault root is listed');
  assert.equal(plugin.saved.dataFolder, 'Databases', 'saved');
});

test('a fresh install and an ordinary folder setting search the whole vault', async () => {
  const a = await session({ 'x/y.db': new Uint8Array(1) }, null);
  assert.equal(a.plugin.settings.searchScope, 'vault');
  assert.deepEqual(unwrap(a.plugin.vaultDatabases().map((d) => d.path)), ['x/y.db']);
  const b = await session({ 'x/y.db': new Uint8Array(1) }, { dataFolder: 'Data' });
  assert.equal(b.plugin.settings.dataFolder, 'Data');
  assert.equal(b.plugin.settings.searchScope, 'vault');
});

test('the scope setting never overwrites the databases folder', async () => {
  const { plugin } = await session({}, { dataFolder: 'Data', searchScope: 'folder' });
  assert.equal(plugin.settings.dataFolder, 'Data');
  assert.equal(plugin.settings.searchScope, 'folder');
});

test('the note shows once per file for a database outside the folder, and is remembered by path', async () => {
  const { plugin } = await session({ 'elsewhere/a.db': new Uint8Array(1), 'Databases/b.db': new Uint8Array(1) }, { dataFolder: 'Databases' });
  noticeObjects.length = 0;
  assert.equal(plugin.noteIfOutsideFolder('Databases/b.db'), false, 'inside the folder: no note');
  assert.equal(plugin.noteIfOutsideFolder('elsewhere/a.db'), true);
  assert.match(noticeObjects.at(-1).msg, /isn't in your databases folder/);
  assert.match(noticeObjects.at(-1).msg, /may break any app that writes to it/);
  assert.equal(plugin.settings.outsideNoteSeen['elsewhere/a.db'], true);
  assert.equal(plugin.saved.outsideNoteSeen['elsewhere/a.db'], true, 'the dismissal is saved');
  assert.equal(plugin.noteIfOutsideFolder('elsewhere/a.db'), false, 'not twice');
});

test('the note can be turned off in settings', async () => {
  const { plugin } = await session({}, { dataFolder: 'Databases', noteOutsideFolder: false });
  assert.equal(plugin.noteIfOutsideFolder('elsewhere/a.db'), false);
  assert.deepEqual(unwrap(plugin.settings.outsideNoteSeen), {});
});

test('opening a database in the browser fires the note; a dashboard query does not', async () => {
  const { plugin } = await session({ 'elsewhere/a.db': new Uint8Array(1) }, { dataFolder: 'Databases' });
  plugin.query.engineFor = async () => ({ engine: 'cli', size: 1 });
  plugin.query.query = async () => ({ columns: ['name', 'type'], rows: [], ms: 1 });
  noticeObjects.length = 0;
  await plugin.query.engineFor('elsewhere/a.db');
  await plugin.query.query('elsewhere/a.db', 'SELECT 1');
  assert.equal(noticeObjects.length, 0, 'reading a database for a dashboard shows nothing');
  assert.equal(plugin.settings.outsideNoteSeen['elsewhere/a.db'], undefined);
  const view = plugin.viewFactories['readout-browser']({ app: plugin.app });
  view.app = plugin.app;
  await view.setDatabase('elsewhere/a.db');
  assert.equal(noticeObjects.length, 1, 'a direct open shows it');
  await view.setDatabase('elsewhere/a.db');
  assert.equal(noticeObjects.length, 1, 'and only once');
});

test('Move works only on a click, through the vault, and never over a file', async () => {
  const { plugin, adapter } = await session({ 'elsewhere/a.db': new Uint8Array(1), 'elsewhere/a.db-wal': new Uint8Array(1), 'elsewhere/c.db': new Uint8Array(1), 'Databases/c.db': new Uint8Array(1) }, { dataFolder: 'Databases' });
  noticeObjects.length = 0;
  let movedTo = null;
  plugin.noteIfOutsideFolder('elsewhere/a.db', (to) => { movedTo = to; });
  assert.ok(adapter.binaries.has('elsewhere/a.db'), 'nothing moved yet');
  const btn = buttonOf(noticeObjects.at(-1));
  assert.equal(btn.textContent, 'Move to Databases');
  await btn.handlers.click[0]({});
  assert.ok(adapter.binaries.has('Databases/a.db'));
  assert.ok(adapter.binaries.has('Databases/a.db-wal'), 'the sidecar travels');
  assert.ok(!adapter.binaries.has('elsewhere/a.db'));
  assert.equal(movedTo, 'Databases/a.db');
  const r = await plugin.moveIntoDataFolder('elsewhere/c.db');
  assert.equal(r.ok, false);
  assert.match(r.reason, /already exists/);
  assert.ok(adapter.binaries.has('elsewhere/c.db') && adapter.binaries.has('Databases/c.db'), 'nothing overwritten');
});
