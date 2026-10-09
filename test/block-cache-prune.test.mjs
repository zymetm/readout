/* PRUNING THE NOTE-BLOCK CACHE.
 *
 * A widget written out in a note keeps its desktop result in
 * <cache>/notes/<key>.json, filed by a key of the block text. Edit a block
 * and the old key is never read again, so the folder only grows. The desktop
 * removes files nobody has used for a long time. A block that is still
 * shown is rewritten once per session, so an old file is an unused one.
 * Nothing outside <cache>/notes/ is ever touched, and only .json files.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeFakeAdapter } from './harness.mjs';

const DAY = 24 * 60 * 60 * 1000;

async function boot(files, ages, { desktop = true } = {}) {
  const fresh = loadPlugin({ desktop });
  const adapter = makeFakeAdapter(files, {});
  adapter.stat = async (p) => (adapter.files.has(p) ? { size: 1, mtime: ages[p] === undefined ? Date.now() : Date.now() - ages[p] } : null);
  const app = { vault: { adapter, configDir: '.obsidian' }, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  plugin.app = app;
  await plugin.onload();
  return { plugin, adapter };
}

const FOLDER = '07 Databases/Dashboard Cache';

test('files in the note cache that nobody has used for 60 days are removed, newer ones stay', async () => {
  const files = {
    [FOLDER + '/notes/old.json']: '{}',
    [FOLDER + '/notes/recent.json']: '{}',
    [FOLDER + '/notes/borderline.json']: '{}',
    [FOLDER + '/notes/readme.txt']: 'not a cache file',
    [FOLDER + '/dashboards/stale-dashboard.json']: '{}',
  };
  const ages = {
    [FOLDER + '/notes/old.json']: 61 * DAY,
    [FOLDER + '/notes/recent.json']: 3 * DAY,
    [FOLDER + '/notes/borderline.json']: 59 * DAY,
    [FOLDER + '/notes/readme.txt']: 400 * DAY,
    [FOLDER + '/dashboards/stale-dashboard.json']: 400 * DAY,
  };
  const { plugin, adapter } = await boot(files, ages);
  const removed = await plugin.pruneBlockCache();
  assert.equal(removed, 1);
  assert.equal(adapter.files.has(FOLDER + '/notes/old.json'), false);
  assert.equal(adapter.files.has(FOLDER + '/notes/recent.json'), true);
  assert.equal(adapter.files.has(FOLDER + '/notes/borderline.json'), true);
  assert.equal(adapter.files.has(FOLDER + '/notes/readme.txt'), true, 'only .json files');
  assert.equal(adapter.files.has(FOLDER + '/dashboards/stale-dashboard.json'), true, 'never the dashboard cache');
});

test('a missing notes folder, or a file that cannot be removed, is not an error', async () => {
  const { plugin, adapter } = await boot({}, {});
  assert.equal(await plugin.pruneBlockCache(), 0);
  adapter.files.set(FOLDER + '/notes/old.json', '{}');
  adapter.remove = async () => { throw new Error('locked'); };
  adapter.stat = async () => ({ size: 1, mtime: 1 });
  assert.equal(await plugin.pruneBlockCache(), 0);
});

test('the desktop prunes when the workspace is ready; a phone never writes or removes', async () => {
  const fresh = loadPlugin({ desktop: false });
  const adapter = makeFakeAdapter({ [FOLDER + '/notes/old.json']: '{}' }, {});
  adapter.stat = async () => ({ size: 1, mtime: 1 });
  const app = { vault: { adapter, configDir: '.obsidian' }, workspace: { onLayoutReady: (fn) => fn(), on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  plugin.app = app;
  await plugin.onload();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(adapter.files.has(FOLDER + '/notes/old.json'), true, 'the phone leaves the cache alone');

  const fresh2 = loadPlugin({ desktop: true });
  const adapter2 = makeFakeAdapter({ [FOLDER + '/notes/old.json']: '{}' }, {});
  adapter2.stat = async () => ({ size: 1, mtime: 1 });
  const app2 = { vault: { adapter: adapter2, configDir: '.obsidian' }, workspace: { onLayoutReady: (fn) => fn(), on: () => ({}) } };
  const plugin2 = fresh2.makePlugin(app2);
  plugin2.app = app2;
  await plugin2.onload();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(adapter2.files.has(FOLDER + '/notes/old.json'), false, 'the desktop prunes at start');
});
