/* WHERE THE DATABASES LIVE BY DEFAULT.
 *
 * A vault that carries the ICOR for Life scaffold (its
 * `.icor-for-life/manifest.json`) gets the Databases room, "07 Databases".
 * Every other vault gets a plain "Databases" folder. The detection only
 * seeds a fresh install: whatever is saved always wins, and loading never
 * writes a file or creates a folder in the vault. Measured pure (the
 * detection and the two sets) and through the plugin (the wiring).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, unwrap, makeFakeAdapter, makeFakeVault } from './harness.mjs';

const { lib } = loadPlugin();

const SCAFFOLD = JSON.stringify({ schema: 2, name: 'ICOR for Life Scaffold', version: '2.2.1', implements: 'icor-concepts/1' });
const MANIFEST = '.icor-for-life/manifest.json';

async function boot(files, saved) {
  const fresh = loadPlugin();
  const adapter = makeFakeAdapter(files || {});
  const app = { vault: makeFakeVault(adapter, fresh.obsidian.TFile), workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app, saved);
  plugin.app = app;
  await plugin.onload();
  return { plugin, adapter, fresh };
}

const trio = (s) => [s.dataFolder, s.dashboardFolder, s.cacheFolder];

test('the plain defaults and the ICOR defaults are the two sets, and a new install leaves .json alone', () => {
  assert.deepEqual(unwrap(lib.PLAIN_FOLDERS), { dataFolder: 'Databases', dashboardFolder: 'Databases/Dashboards', cacheFolder: 'Databases/Dashboard Cache' });
  assert.deepEqual(unwrap(lib.ICOR_FOLDERS), { dataFolder: '07 Databases', dashboardFolder: '07 Databases/Dashboards', cacheFolder: '07 Databases/Dashboard Cache' });
  assert.deepEqual(unwrap(lib.folderDefaultsFor(true)), unwrap(lib.ICOR_FOLDERS));
  assert.deepEqual(unwrap(lib.folderDefaultsFor(false)), unwrap(lib.PLAIN_FOLDERS));
  assert.equal(lib.DEFAULT_SETTINGS.openJsonFiles, false);
  assert.deepEqual(trio(lib.DEFAULT_SETTINGS), ['Databases', 'Databases/Dashboards', 'Databases/Dashboard Cache']);
});

test('detection: only the scaffold manifest counts, and nothing it meets ever throws', async () => {
  const adapterWith = (text) => makeFakeAdapter(text === undefined ? {} : { [MANIFEST]: text });
  assert.equal(await lib.detectIcorScaffold(adapterWith(SCAFFOLD)), true);
  assert.equal(await lib.detectIcorScaffold(adapterWith()), false, 'no file');
  assert.equal(await lib.detectIcorScaffold(adapterWith('{ not json')), false, 'malformed');
  assert.equal(await lib.detectIcorScaffold(adapterWith(JSON.stringify({ name: 'Something else', implements: 'icor-concepts/1' }))), false, 'another name');
  assert.equal(await lib.detectIcorScaffold(adapterWith(JSON.stringify({ name: 'ICOR for Life Scaffold', implements: 5 }))), false, 'no implements');
  assert.equal(await lib.detectIcorScaffold(adapterWith('null')), false);
  assert.equal(await lib.detectIcorScaffold(null), false);
  assert.equal(await lib.detectIcorScaffold({ exists: async () => { throw new Error('boom'); }, read: async () => '' }), false);
});

test('a fresh install in an ICOR for Life vault lands on the Databases room', async () => {
  const { plugin } = await boot({ [MANIFEST]: SCAFFOLD }, null);
  assert.deepEqual(trio(plugin.settings), ['07 Databases', '07 Databases/Dashboards', '07 Databases/Dashboard Cache']);
  assert.equal(plugin.settings.openJsonFiles, false);
});

test('a fresh install in any other vault lands on a plain Databases folder', async () => {
  const { plugin } = await boot({ 'notes/a.md': 'hello' }, null);
  assert.deepEqual(trio(plugin.settings), ['Databases', 'Databases/Dashboards', 'Databases/Dashboard Cache']);
  assert.equal(plugin.settings.openJsonFiles, false);
});

test('a vault that happens to hold a folder called 07 Data is not adopted: there is no legacy rule any more', async () => {
  const { plugin } = await boot({ '07 Data/x.db': new Uint8Array([1]).toString() }, null);
  assert.equal(plugin.settings.dataFolder, 'Databases');
});

test('the fresh choice is saved, so it never flips while its plain folder is in use', async () => {
  const first = await boot({}, null);
  assert.ok(first.plugin.saved, 'saved on first load');
  assert.deepEqual(trio(first.plugin.saved), ['Databases', 'Databases/Dashboards', 'Databases/Dashboard Cache']);
  /* The same install, later, in a vault that now carries the scaffold, with
   * its plain folder holding something. */
  const second = await boot({ [MANIFEST]: SCAFFOLD, 'Databases/mine.db': 'x' }, first.plugin.saved);
  assert.equal(second.plugin.settings.dataFolder, 'Databases', 'saved settings win');
});

/* A synced phone: Obsidian Sync skips dot folders, so the manifest is not
 * there, but the Databases room is. */
const PHONE = { '07 Databases/Dashboards/health.json': '{}', '07 Databases/README.md': 'room' };

test('a fresh install on a synced phone finds the Databases room without the manifest', async () => {
  const { plugin } = await boot(PHONE, null);
  assert.deepEqual(trio(plugin.settings), ['07 Databases', '07 Databases/Dashboards', '07 Databases/Dashboard Cache']);
});

test('a phone that saved the plain folders before 1.0.10 moves to the Databases room', async () => {
  const { plugin } = await boot(PHONE, { dataFolder: 'Databases', dashboardFolder: 'Databases/Dashboards', cacheFolder: 'Databases/Dashboard Cache', weekStart: 'monday' });
  assert.deepEqual(trio(plugin.settings), ['07 Databases', '07 Databases/Dashboards', '07 Databases/Dashboard Cache']);
  assert.deepEqual(trio(plugin.saved), ['07 Databases', '07 Databases/Dashboards', '07 Databases/Dashboard Cache'], 'and saves it');
  assert.equal(plugin.settings.weekStart, 'monday', 'other settings are kept');
});

test('the move never happens when a plain Databases folder exists, or the folders were chosen by hand', async () => {
  const plain = { dataFolder: 'Databases', dashboardFolder: 'Databases/Dashboards', cacheFolder: 'Databases/Dashboard Cache' };
  const used = await boot(Object.assign({ 'Databases/mine.db': 'x' }, PHONE), plain);
  assert.equal(used.plugin.settings.dataFolder, 'Databases');
  const mine = await boot(PHONE, { dataFolder: 'Databases', dashboardFolder: 'Boards', cacheFolder: 'Databases/Dashboard Cache' });
  assert.equal(mine.plugin.settings.dashboardFolder, 'Boards');
  const notIcor = await boot({ 'notes/a.md': 'x' }, plain);
  assert.equal(notIcor.plugin.settings.dataFolder, 'Databases');
});

test('a vault with both a plain Databases folder and a 07 Databases folder, and no manifest, stays plain', async () => {
  const { plugin } = await boot(Object.assign({ 'Databases/x.db': 'x' }, PHONE), null);
  assert.equal(plugin.settings.dataFolder, 'Databases');
});

test('saved settings win over detection, in both directions', async () => {
  const plainInIcor = await boot({ [MANIFEST]: SCAFFOLD }, { dataFolder: 'Data', dashboardFolder: 'Data/Boards', cacheFolder: 'Data/Cache' });
  assert.deepEqual(trio(plainInIcor.plugin.settings), ['Data', 'Data/Boards', 'Data/Cache']);
  const icorInPlain = await boot({}, { dataFolder: '07 Databases', dashboardFolder: '07 Databases/Dashboards', cacheFolder: '07 Databases/Dashboard Cache', openJsonFiles: true });
  assert.deepEqual(trio(icorInPlain.plugin.settings), ['07 Databases', '07 Databases/Dashboards', '07 Databases/Dashboard Cache']);
  assert.equal(icorInPlain.plugin.settings.openJsonFiles, true, 'a saved "on" stays on');
});

test('a saved file that lacks a folder key takes the vault\'s default for that key only', async () => {
  const { plugin } = await boot({ [MANIFEST]: SCAFFOLD }, { dashboardFolder: 'Mine/Boards', openJsonFiles: false });
  assert.equal(plugin.settings.dashboardFolder, 'Mine/Boards');
  assert.equal(plugin.settings.dataFolder, '07 Databases');
  assert.equal(plugin.settings.cacheFolder, '07 Databases/Dashboard Cache');
});

test('loading creates no folder and writes no file in the vault, whatever the vault is', async () => {
  for (const files of [{}, { [MANIFEST]: SCAFFOLD }]) {
    const { adapter } = await boot(files, null);
    assert.deepEqual(adapter.log, [], 'nothing written, nothing created');
  }
});
