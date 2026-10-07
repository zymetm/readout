/* The folders the database finder skips: the vault's own config folder is
 * whatever the vault says it is, not the literal ".obsidian". */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin } from './harness.mjs';

const { lib } = loadPlugin();

test('the config folder the vault names is skipped, and .git and .trash always', () => {
  const files = [
    { path: 'Data/a.db', size: 1 },
    { path: 'myconfig/plugins/x/cache.db', size: 1 },
    { path: '.obsidian/plugins/y/cache.db', size: 1 },
    { path: '.git/z.db', size: 1 },
    { path: '.trash/w.db', size: 1 },
  ];
  assert.deepEqual(lib.findDatabases(files, 'myconfig').map((f) => f.path), ['.obsidian/plugins/y/cache.db', 'Data/a.db'].sort((a, b) => a.localeCompare(b)));
  assert.deepEqual(lib.findDatabases(files, '.obsidian').map((f) => f.path), ['Data/a.db', 'myconfig/plugins/x/cache.db']);
  assert.deepEqual(lib.findDatabases(files).map((f) => f.path), ['Data/a.db', 'myconfig/plugins/x/cache.db'], 'no config folder given: the usual name');
});

test('a plugin passes the vault configDir to the finder', async () => {
  const fresh = loadPlugin();
  const app = { vault: { adapter: {}, configDir: 'myconfig', getFiles: () => [{ path: 'myconfig/p/c.db', stat: { size: 1 } }, { path: 'Data/a.db', stat: { size: 1 } }] }, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  plugin.app = app;
  assert.deepEqual(plugin.vaultDatabases().map((f) => f.path), ['Data/a.db']);
});
