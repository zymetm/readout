/* The folders the database finder skips: the vault's own config folder is
 * whatever the vault says it is, not the literal ".obsidian". */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, unwrap } from './harness.mjs';

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

test('the plugin walks folders from the root by default, or only the database folder, skipping the vault config folder', async () => {
  const fresh = loadPlugin();
  const file = (path) => ({ path, stat: { size: 1 } });
  const root = { path: '/', children: [
    { path: 'Data', children: [file('Data/a.db'), { path: 'Data/x', children: [file('Data/x/b.sqlite')] }] },
    { path: 'myconfig', children: [{ path: 'myconfig/p', children: [file('myconfig/p/c.db')] }] },
    { path: 'Other', children: [file('Other/d.db')] },
  ] };
  const vault = { adapter: {}, configDir: 'myconfig', getRoot: () => root, getAbstractFileByPath: (p) => (p === 'Data' ? root.children[0] : null) };
  const plugin = fresh.makePlugin({ vault });
  plugin.app = { vault };
  plugin.settings = { dataFolder: 'Data', searchScope: 'folder' };
  assert.deepEqual(unwrap(plugin.vaultDatabases().map((f) => f.path)), ['Data/a.db', 'Data/x/b.sqlite'], 'with the search set to the folder, only that folder is walked');
  plugin.settings = { dataFolder: 'Data' };
  assert.deepEqual(unwrap(plugin.vaultDatabases().map((f) => f.path)), ['Data/a.db', 'Data/x/b.sqlite', 'Other/d.db'], 'by default the whole vault is walked from the root');
  plugin.settings = { dataFolder: 'Missing', searchScope: 'folder' };
  assert.deepEqual(unwrap(plugin.vaultDatabases()), []);
});
