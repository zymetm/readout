/* READOUT'S OWN CODE USES NO NODE MODULE.
 *
 * The Obsidian community scan flags child_process (shell execution) and fs
 * (direct file system access). ReadOut reads files only through Obsidian's
 * vault adapter and runs only its built-in sql.js engine. These gates keep it
 * that way: the source (outside the vendored sql.js) names no Node module, and
 * a whole session (start, a query, a big-file refusal) asks `require` for
 * nothing but 'obsidian', with `process` as Obsidian's window has it.
 *
 * The vendored sql.js used to hold the text require("fs") in its Node branch
 * (dead code in Obsidian). Since 1.0.5 that branch is cut from the pasted copy
 * (see embedded-sqljs.mjs), so the whole of main.js, vendored part included,
 * names no Node module. The session test below also uses a require that
 * refuses everything.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

import { loadPlugin, makeFakeAdapter, makeFakeVault } from './harness.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nodeRequire = createRequire(import.meta.url);
const src = readFileSync(resolve(repo, 'main.js'), 'utf8');
const own = src.slice(0, src.indexOf('/* BEGIN vendored sql-wasm.js */'));

test('ReadOut\'s own code (everything before the vendored sql.js) names no Node module and starts no program', () => {
  const code = own.split('\n').filter((l) => !/^\s*(\*|\/\*)/.test(l)).join('\n');
  assert.doesNotMatch(code, /require\(\s*['"](child_process|fs|path|os|crypto|electron|http|https|net)['"]/);
  assert.doesNotMatch(code, /\bexecFile\b|\bspawn\(|\bexecSync\b|\bchild_process\b|\breadFileSync\b|\bopenSync\b/);
  assert.equal(code.match(/\brequire\(/g).length, 1, "the one require is require('obsidian')");
});

async function session(binaries) {
  const asked = [];
  const rendererProcess = { type: 'renderer', versions: { ...process.versions }, argv: [], env: {}, platform: process.platform };
  const fresh = loadPlugin({ desktop: true, globals: { requireHook: (name) => { asked.push(name); throw new Error('the test refuses require(' + name + ')'); }, process: rendererProcess } });
  const adapter = makeFakeAdapter({}, binaries);
  const app = { vault: makeFakeVault(adapter, fresh.obsidian.TFile), workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  plugin.app = app;
  await plugin.onload();
  return { plugin, asked };
}

test('a session on a desktop asks require for no Node module: start, a query, and a too-big file', async () => {
  const initSqlJs = nodeRequire(resolve(repo, 'sql-wasm.js'));
  const SQL = await initSqlJs({ wasmBinary: readFileSync(resolve(repo, 'sql-wasm.wasm')) });
  const source = new SQL.Database();
  source.run('CREATE TABLE t (n INTEGER)');
  source.run('INSERT INTO t VALUES (1), (2)');
  const bytes = source.export();
  source.close();
  const { plugin, asked } = await session({ '07 Databases/tiny.db': bytes, '07 Databases/big.db': new Uint8Array(3 * 1024 * 1024) });
  const res = await plugin.query.query('07 Databases/tiny.db', 'SELECT n FROM t ORDER BY n');
  assert.deepEqual(JSON.parse(JSON.stringify(res.rows)), [[1], [2]]);
  plugin.settings.mobileCapMb = 2;
  const big = await plugin.query.engineFor('07 Databases/big.db');
  assert.equal(big.engine, null);
  assert.match(big.reason, /too big/);
  assert.deepEqual(asked, [], 'nothing but obsidian was ever required');
});

test('all of main.js, the pasted sql.js included, names no Node module and makes no file-system or process call', () => {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(src, /require\(\s*["'](fs|path|crypto|child_process|os|electron|http|https|net)["']\s*\)/);
  assert.doesNotMatch(src, /child_process/);
  assert.doesNotMatch(code, /\bfs\.\w+\(/);
  assert.doesNotMatch(code, /\bprocess\.(argv|exitCode|stdin|exit)\b/);
});
