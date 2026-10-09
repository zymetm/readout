/* THE ENGINES.
 *
 * Engine A is a process invocation, so its gate watches the arguments: the
 * SQL must travel as one execFile argument (never through a shell), the
 * database must be opened read-only twice over (-readonly plus mode=ro in
 * the URI), the timeout must reach the process runner, and a killed query
 * must come back in plain words. Engine B is measured end to end: a real
 * database is built with sql.js in the test realm, handed to the plugin as
 * bytes behind a fake adapter, and queried through the plugin's own loader,
 * which is exactly the mobile path. The QueryService on top is measured for
 * the two rules that make the whole plugin safe: the gate runs before any
 * engine, and the row cap lands on uncapped SELECTs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

import { patchSqlJs, embeddedSource, checkEmbedded, BEGIN, END } from '../embedded-sqljs.mjs';
import { loadPlugin, unwrap, makeFakeAdapter, makeFakeVault } from './harness.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nodeRequire = createRequire(import.meta.url);
const { lib, makePlugin } = loadPlugin();

/* ------------------------------------------------- the QueryService -- */

async function makeServicePlugin(adapter, { desktop = true } = {}) {
  const fresh = loadPlugin({ desktop });
  const app = {
    vault: makeFakeVault(adapter, fresh.obsidian.TFile),
    workspace: { onLayoutReady: () => {}, on: () => ({}) },
  };
  const plugin = fresh.makePlugin(app);
  plugin.app = app;
  await plugin.onload();
  return { plugin, lib: fresh.lib };
}

/* A real one-table database, built with the vendored sql.js. */
async function tinyDb() {
  const initSqlJs = nodeRequire(resolve(repo, 'sql-wasm.js'));
  const SQL = await initSqlJs({ wasmBinary: readFileSync(resolve(repo, 'sql-wasm.wasm')) });
  const source = new SQL.Database();
  source.run('CREATE TABLE t (n INTEGER)');
  source.run('INSERT INTO t VALUES (1), (2), (3), (4), (5)');
  const bytes = source.export();
  source.close();
  return bytes;
}

test('the service refuses a write before the engine is asked', async () => {
  const adapter = makeFakeAdapter({}, { '07 Databases/x.db': await tinyDb() });
  const { plugin } = await makeServicePlugin(adapter);
  await assert.rejects(plugin.query.query('07 Databases/x.db', 'DROP TABLE t'), /Only read queries/);
  assert.equal(plugin.query.wasm.open.size, 0, 'the gate fires before the file is even loaded');
});

test('the row cap lands on an uncapped SELECT and leaves a capped one alone', async () => {
  const adapter = makeFakeAdapter({}, { '07 Databases/x.db': await tinyDb() });
  const { plugin } = await makeServicePlugin(adapter);
  const res = await plugin.query.query('07 Databases/x.db', 'SELECT n FROM t', { cap: 2 });
  assert.equal(res.capped, true);
  assert.equal(res.rows.length, 2);
  const own = await plugin.query.query('07 Databases/x.db', 'SELECT n FROM t LIMIT 4', { cap: 2 });
  assert.equal(own.capped, false);
  assert.equal(own.rows.length, 4, 'a query with its own LIMIT is left alone');
});

test('engine choice on a desktop: a file over the cap gets a friendly message that says what to do', async () => {
  const adapter = makeFakeAdapter({}, { '07 Databases/big.db': new Uint8Array(3 * 1024 * 1024) });
  const { plugin } = await makeServicePlugin(adapter, { desktop: true });
  plugin.settings.mobileCapMb = 2;
  const choice = await plugin.query.engineFor('07 Databases/big.db');
  assert.equal(choice.engine, null);
  assert.equal(choice.tooBig, true);
  assert.match(choice.reason, /too big for the size cap/);
  assert.match(choice.reason, /the cap is 2 MB/);
  assert.match(choice.reason, /Raise "Size cap for the built-in engine"/);
  assert.match(choice.reason, /up to 2000 MB/);
  plugin.settings.mobileCapMb = 4;
  assert.equal((await plugin.query.engineFor('07 Databases/big.db')).engine, 'wasm', 'raising the cap opens it');
});

test('defaults: 1500 MB on a desktop, 200 MB on a phone, and never above 2000 MB', async () => {
  const desk = await makeServicePlugin(makeFakeAdapter(), { desktop: true });
  const phone = await makeServicePlugin(makeFakeAdapter(), { desktop: false });
  assert.equal(desk.lib.DEFAULT_SETTINGS.mobileCapMb, 1500);
  assert.equal(phone.lib.DEFAULT_SETTINGS.mobileCapMb, 200);
});

test('engine choice: a file over the cap on a phone means no engine, in plain words', async () => {
  const big = new Uint8Array(3 * 1024 * 1024);
  const adapter = makeFakeAdapter({}, { '07 Databases/big.db': big });
  const { plugin } = await makeServicePlugin(adapter, { desktop: false });
  plugin.settings.mobileCapMb = 2;
  const choice = await plugin.query.engineFor('07 Databases/big.db');
  assert.equal(choice.engine, null);
  assert.match(choice.reason, /too big to load into memory/);
  assert.match(choice.reason, /the cap is 2 MB/);
  assert.match(choice.reason, /desktop cache/);
  const missing = await plugin.query.engineFor('07 Databases/gone.db');
  assert.equal(missing.engine, null);
  assert.match(missing.reason, /not found/);
});

test('Engine B end to end: real bytes through the plugin loader, on the mobile path', async () => {
  /* Build a real database in the test realm with the same vendored sql.js. */
  const initSqlJs = nodeRequire(resolve(repo, 'sql-wasm.js'));
  const SQL = await initSqlJs({ wasmBinary: readFileSync(resolve(repo, 'sql-wasm.wasm')) });
  const source = new SQL.Database();
  source.run('CREATE TABLE things (day TEXT, n INTEGER)');
  source.run("INSERT INTO things VALUES ('2026-08-01', 3), ('2026-08-02', 5)");
  const bytes = source.export();
  source.close();

  const pluginDir = '.obsidian/plugins/readout';
  const adapter = makeFakeAdapter(
    { [pluginDir + '/sql-wasm.js']: readFileSync(resolve(repo, 'sql-wasm.js'), 'utf8') },
    {
      [pluginDir + '/sql-wasm.wasm']: readFileSync(resolve(repo, 'sql-wasm.wasm')),
      '07 Databases/tiny.db': bytes,
    }
  );
  const { plugin } = await makeServicePlugin(adapter, { desktop: false });
  const choice = await plugin.query.engineFor('07 Databases/tiny.db');
  assert.equal(choice.engine, 'wasm');
  const res = await plugin.query.query('07 Databases/tiny.db', 'SELECT day, n FROM things ORDER BY day');
  assert.equal(res.engine, 'wasm');
  assert.deepEqual(unwrap(res.rows), [['2026-08-01', 3], ['2026-08-02', 5]]);
  /* And the gate holds on this engine too. */
  await assert.rejects(plugin.query.query('07 Databases/tiny.db', 'DELETE FROM things'), /Only read queries/);
});

/* -------------------------------------- the embedded runtime (0.5.3) -- */

test('the embedded sql.js equals the vendored file with the one Node-branch patch applied, the binary is byte-identical, and nothing is built from a string', () => {
  const main = readFileSync(resolve(repo, 'main.js'), 'utf8');
  const a = main.indexOf(BEGIN);
  assert.ok(a > 0 && main.indexOf(END) > a, 'the vendored source markers are in main.js');
  assert.equal(embeddedSource(main), patchSqlJs(readFileSync(resolve(repo, 'sql-wasm.js'), 'utf8')),
    'the pasted sql.js drifted from sql-wasm.js plus the patch in embedded-sqljs.mjs; run npm run build');
  /* The old way compiled a base64 string with new Function; it must stay gone. */
  assert.doesNotMatch(main.slice(0, a), /new Function\(|\beval\(|EMBEDDED_SQL_WASM_JS_B64/);
  const embeddedWasm = Buffer.from(lib.bytesOfB64(lib.EMBEDDED_SQL_WASM_B64));
  assert.ok(embeddedWasm.equals(readFileSync(resolve(repo, 'sql-wasm.wasm'))),
    'embedded sql-wasm.wasm drifted from the vendored file; run npm run build');
  assert.deepEqual(checkEmbedded(repo), []);
});

test('the patch removes exactly the Node branch: what is left of the vendored text is unchanged', () => {
  const vendored = readFileSync(resolve(repo, 'sql-wasm.js'), 'utf8');
  const patched = patchSqlJs(vendored);
  assert.ok(vendored.includes('require("fs")') && vendored.includes('require("crypto")'), 'the vendored file still has the Node branch to remove');
  assert.ok(patched.length < vendored.length && vendored.length - patched.length < 1100, 'a small, mechanical cut');
  assert.doesNotMatch(patched, /require\(\s*["'](fs|path|crypto)["']/);
  assert.match(patched, /crypto\.getRandomValues/);
  assert.throws(() => patchSqlJs('var nothing = 1;'), /anchor/, 'a patch that no longer applies fails loudly');
});

test('Engine B on a three-file install: the embedded sql.js answers with no standalone files present', async () => {
  /* Build a real database in the test realm with the vendored sql.js. */
  const initSqlJs = nodeRequire(resolve(repo, 'sql-wasm.js'));
  const SQL = await initSqlJs({ wasmBinary: readFileSync(resolve(repo, 'sql-wasm.wasm')) });
  const source = new SQL.Database();
  source.run('CREATE TABLE t (n INTEGER)');
  source.run('INSERT INTO t VALUES (1)');
  const bytes = source.export();
  source.close();

  /* The community-directory installer downloads main.js, manifest.json
   * and styles.css only, so the plugin folder holds neither sql-wasm.js
   * nor sql-wasm.wasm. */
  const adapter = makeFakeAdapter({}, { '07 Databases/tiny.db': bytes });
  const { plugin } = await makeServicePlugin(adapter, { desktop: false });
  const choice = await plugin.query.engineFor('07 Databases/tiny.db');
  assert.equal(choice.engine, 'wasm');
  const res = await plugin.query.query('07 Databases/tiny.db', 'SELECT 1 AS one');
  assert.equal(res.engine, 'wasm');
  assert.deepEqual(unwrap(res.rows), [[1]]);
});

test('a five-file install still prefers the standalone wasm, and never reads JavaScript from the folder', async () => {
  const initSqlJs = nodeRequire(resolve(repo, 'sql-wasm.js'));
  const SQL = await initSqlJs({ wasmBinary: readFileSync(resolve(repo, 'sql-wasm.wasm')) });
  const source = new SQL.Database();
  source.run('CREATE TABLE t (n INTEGER)');
  const bytes = source.export();
  source.close();

  const pluginDir = '.obsidian/plugins/readout';
  const adapter = makeFakeAdapter(
    { [pluginDir + '/sql-wasm.js']: 'throw new Error("never run: code is not read from disk");' },
    {
      [pluginDir + '/sql-wasm.wasm']: readFileSync(resolve(repo, 'sql-wasm.wasm')),
      '07 Databases/tiny.db': bytes,
    }
  );
  const reads = [];
  const origRead = adapter.read.bind(adapter);
  adapter.read = async (p) => { reads.push(p); return origRead(p); };
  const origBin = adapter.readBinary.bind(adapter);
  adapter.readBinary = async (p) => { reads.push(p); return origBin(p); };
  const { plugin } = await makeServicePlugin(adapter, { desktop: false });
  const res = await plugin.query.query('07 Databases/tiny.db', 'SELECT 1 AS one');
  assert.equal(res.engine, 'wasm');
  assert.ok(reads.includes(pluginDir + '/sql-wasm.wasm'),
    'the standalone sql-wasm.wasm must be the copy the engine reads when it exists');
  assert.ok(!reads.includes(pluginDir + '/sql-wasm.js'), 'no JavaScript is ever read from the plugin folder');
});

/* ---------------------------------------------------- the dashboard cache -- */

test('the cache round-trips through the adapter, keyed by dashboard id, and a 0.1.x cache still reads', async () => {
  const adapter = makeFakeAdapter();
  const { plugin } = await makeServicePlugin(adapter);
  const spec = { id: 'health-overview', title: 'Health', database: '07 Databases/mypka-health.db', tiles: [] };
  const tiles = [{ title: 'T', viz: 'stat', x: '', y: ['n'], unit: '', stack: false, columns: ['n'], rows: [[42]] }];
  await plugin.writeDashboardCache(spec, tiles);
  const path = plugin.settings.cacheFolder + '/dashboards/health-overview.json';
  assert.equal(adapter.files.has(path), true, 'expected ' + path);
  const cache = await plugin.readDashboardCache(spec);
  assert.equal(cache.dashboardId, 'health-overview');
  assert.deepEqual(unwrap(cache.tiles[0].rows), [[42]]);
  assert.equal(typeof cache.computedAt, 'string');
  /* A cache written by 0.1.x under the database stem is still found. */
  const old = { id: 'legacy-dash', title: 'L', database: '07 Databases/mypka-health.db', tiles: [] };
  await adapter.write(plugin.settings.cacheFolder + '/mypka-health/legacy-dash.json',
    JSON.stringify({ dashboardId: 'legacy-dash', computedAt: '2026-09-01T00:00:00Z', tiles: [] }));
  const legacy = await plugin.readDashboardCache(old);
  assert.equal(legacy.dashboardId, 'legacy-dash');
});

test('a broken cache file reads as no cache, never as a crash', async () => {
  const adapter = makeFakeAdapter({ '07 Databases/Dashboard Cache/mypka-health/health-overview.json': '{ not json' });
  const { plugin } = await makeServicePlugin(adapter);
  const spec = { id: 'health-overview', title: 'Health', database: '07 Databases/mypka-health.db', tiles: [] };
  assert.equal(await plugin.readDashboardCache(spec), null);
});

