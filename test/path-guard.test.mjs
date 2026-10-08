/* THE PATH GUARD.
 *
 * A database path comes from a console, a dashboard file or a note block, so
 * it is untrusted text. Every query and every engine choice passes one guard
 * that turns the path into a vault file or refuses it: no `..`, no absolute
 * path or drive letter, nothing in a dot folder (the config folder included),
 * and it must be a real file the vault knows. The sqlite3 program is handed
 * an absolute path made by joining the vault base path, so without this a
 * `../` path would leave the vault.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeFakeAdapter, makeFakeVault } from './harness.mjs';

async function tinyDb() {
  const initSqlJs = (await import('node:module')).createRequire(import.meta.url)('../sql-wasm.js');
  const SQL = await initSqlJs({ wasmBinary: (await import('node:fs')).readFileSync(new URL('../sql-wasm.wasm', import.meta.url)) });
  const source = new SQL.Database();
  source.run('CREATE TABLE t (n INTEGER)');
  source.run('INSERT INTO t VALUES (1)');
  const bytes = source.export();
  source.close();
  return bytes;
}

const REAL = await tinyDb();

/* `files` maps a path to its bytes. */
async function service(files, { configDir } = {}) {
  const bin = Object.assign({}, files);
  const fresh = loadPlugin({ desktop: true });
  const adapter = makeFakeAdapter({}, bin);
  const vault = makeFakeVault(adapter, fresh.obsidian.TFile);
  if (configDir) vault.configDir = configDir;
  const app = { vault, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  plugin.app = app;
  await plugin.onload();
  return { plugin };
}

const GOOD = '07 Databases/x.db';
const BAD = [
  '../outside.db',
  '07 Databases/../../outside.db',
  '07 Databases/..',
  '..\\outside.db',
  '07 Databases\\..\\..\\outside.db',
  '/etc/passwd',
  '\\\\server\\share\\x.db',
  'C:/Users/me/x.db',
  'c:\\Users\\me\\x.db',
  'C:x.db',
  '.obsidian/plugins/x/data.db',
  '.hidden/x.db',
  '07 Databases/.cache/x.db',
  '',
  '07 Databases/nope.db',
  'file:07 Databases/x.db?mode=rwc',
  'file:///07 Databases/x.db?mode=rwc',
  'FILE:07 Databases/x.db',
  '07 Databases/x.db?mode=rwc',
  '07 Databases',
];

test('a plain vault path passes the guard and reaches the engine', async () => {
  const { plugin } = await service({ [GOOD]: REAL });
  const choice = await plugin.query.engineFor(GOOD);
  assert.equal(choice.engine, 'wasm');
  await plugin.query.query(GOOD, 'SELECT 1');
  assert.equal(plugin.query.wasm.open.size, 1, 'the file was opened');
});

test('every escaping, absolute, hidden or unknown path is refused, by engineFor and by query, and no file is opened', async () => {
  const files = { [GOOD]: REAL, '.hidden/x.db': REAL, '07 Databases/.cache/x.db': REAL, '.obsidian/plugins/x/data.db': REAL };
  const { plugin } = await service(files);
  for (const p of BAD) {
    const choice = await plugin.query.engineFor(p);
    assert.equal(choice.engine, null, JSON.stringify(p) + ' must get no engine');
    assert.ok(choice.reason && choice.reason.length > 10, 'a plain reason for ' + JSON.stringify(p));
    await assert.rejects(plugin.query.query(p, 'SELECT 1'), /./, JSON.stringify(p) + ' must be refused by query');
  }
  assert.equal(plugin.query.wasm.open.size, 0, 'no file was opened for a refused path');
});

test('a path that is not a string is refused', async () => {
  const { plugin } = await service({ [GOOD]: REAL });
  for (const p of [null, undefined, 5, {}, ['07 Databases/x.db']]) {
    assert.equal((await plugin.query.engineFor(p)).engine, null);
  }
});

test('a custom config folder name is refused like .obsidian', async () => {
  const { plugin } = await service({ 'myconfig/plugins/x.db': REAL, [GOOD]: REAL }, { configDir: 'myconfig' });
  assert.equal((await plugin.query.engineFor('myconfig/plugins/x.db')).engine, null);
  assert.equal((await plugin.query.engineFor('MyConfig/plugins/x.db')).engine, null);
  assert.equal((await plugin.query.engineFor(GOOD)).engine, 'wasm');
});

test('a folder is not a file: the vault must know a TFile at the path', async () => {
  const { plugin } = await service({ [GOOD]: REAL });
  /* The adapter knows the path, but the vault says it is a folder. */
  plugin.app.vault.getAbstractFileByPath = () => ({ path: GOOD, children: [] });
  assert.equal((await plugin.query.engineFor(GOOD)).engine, null);
});
