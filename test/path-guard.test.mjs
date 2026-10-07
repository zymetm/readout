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

async function service(files, { configDir } = {}) {
  const fresh = loadPlugin({ desktop: true });
  const adapter = makeFakeAdapter({}, files);
  adapter.getBasePath = () => '/vault';
  const vault = makeFakeVault(adapter, fresh.obsidian.TFile);
  if (configDir) vault.configDir = configDir;
  const app = { vault, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  plugin.app = app;
  await plugin.onload();
  const calls = [];
  plugin.query.deps = {
    childProcess: { execFile(bin, args, o, cb) { calls.push(args); setImmediate(() => cb(null, '[]', '')); } },
    pathx: (await import('node:path')).default,
  };
  plugin.query.cli = { ok: true, version: '3.51.0' };
  return { plugin, calls };
}

const GOOD = '07 Data/x.db';
const BAD = [
  '../outside.db',
  '07 Data/../../outside.db',
  '07 Data/..',
  '..\\outside.db',
  '07 Data\\..\\..\\outside.db',
  '/etc/passwd',
  '\\\\server\\share\\x.db',
  'C:/Users/me/x.db',
  'c:\\Users\\me\\x.db',
  'C:x.db',
  '.obsidian/plugins/x/data.db',
  '.hidden/x.db',
  '07 Data/.cache/x.db',
  '',
  '07 Data/nope.db',
  '07 Data',
];

test('a plain vault path passes the guard and reaches the engine', async () => {
  const { plugin, calls } = await service({ [GOOD]: new Uint8Array([1]) });
  const choice = await plugin.query.engineFor(GOOD);
  assert.equal(choice.engine, 'cli');
  await plugin.query.query(GOOD, 'SELECT 1');
  assert.equal(calls.length, 1);
});

test('every escaping, absolute, hidden or unknown path is refused, by engineFor and by query, and no process starts', async () => {
  const files = { [GOOD]: new Uint8Array([1]), '.hidden/x.db': new Uint8Array([1]), '07 Data/.cache/x.db': new Uint8Array([1]), '.obsidian/plugins/x/data.db': new Uint8Array([1]) };
  const { plugin, calls } = await service(files);
  for (const p of BAD) {
    const choice = await plugin.query.engineFor(p);
    assert.equal(choice.engine, null, JSON.stringify(p) + ' must get no engine');
    assert.ok(choice.reason && choice.reason.length > 10, 'a plain reason for ' + JSON.stringify(p));
    await assert.rejects(plugin.query.query(p, 'SELECT 1'), /./, JSON.stringify(p) + ' must be refused by query');
  }
  assert.equal(calls.length, 0, 'no sqlite3 process for a refused path');
});

test('a path that is not a string is refused', async () => {
  const { plugin } = await service({ [GOOD]: new Uint8Array([1]) });
  for (const p of [null, undefined, 5, {}, ['07 Data/x.db']]) {
    assert.equal((await plugin.query.engineFor(p)).engine, null);
  }
});

test('a custom config folder name is refused like .obsidian', async () => {
  const { plugin } = await service({ 'myconfig/plugins/x.db': new Uint8Array([1]), [GOOD]: new Uint8Array([1]) }, { configDir: 'myconfig' });
  assert.equal((await plugin.query.engineFor('myconfig/plugins/x.db')).engine, null);
  assert.equal((await plugin.query.engineFor('MyConfig/plugins/x.db')).engine, null);
  assert.equal((await plugin.query.engineFor(GOOD)).engine, 'cli');
});

test('a folder is not a file: the vault must know a TFile at the path', async () => {
  const { plugin } = await service({ [GOOD]: new Uint8Array([1]) });
  /* The adapter knows the path, but the vault says it is a folder. */
  plugin.app.vault.getAbstractFileByPath = () => ({ path: GOOD, children: [] });
  assert.equal((await plugin.query.engineFor(GOOD)).engine, null);
});
