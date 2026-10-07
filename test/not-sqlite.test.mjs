/* A FILE THAT IS NOT SQLITE SAYS SO, IN PLAIN WORDS.
 *
 * The plugin opens every .db, .sqlite and .sqlite3 file, and some of them
 * are not databases: a Windows thumbnail cache (Thumbs.db), a text file
 * renamed by hand. Before any engine is asked, the first 16 bytes are read;
 * a SQLite file starts with "SQLite format 3" and a zero byte. When they do
 * not, the member reads "This file isn't a SQLite database", never an
 * engine's "file is not a database". These gates pin the rules: the check
 * itself is pure; the desktop engine reads 16 bytes by file handle, once
 * per version of the file, and never runs the query on a file that fails;
 * the built-in engine checks the bytes it has loaded; a real database, an
 * empty file and a database from a long-lived session still open; the
 * browser, the schema picker and a dashboard tile all show the sentence.
 * Every byte and name here is invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

import { loadPlugin, makeFakeAdapter, makeFakeVault, unwrap } from './harness.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nodeRequire = createRequire(import.meta.url);
const { lib } = loadPlugin();

const bytesOf = (text) => Uint8Array.from(Buffer.from(text, 'latin1'));
/* The first bytes of a Windows thumbnail cache (an OLE compound file), then filler. */
const THUMBS = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(600).fill(0)]);
const TEXT = bytesOf('Shopping list\n- eggs\n- tea\n- a file that was renamed to .db by mistake\n');
const HEADER = bytesOf('SQLite format 3\u0000');
const SENTENCE = /This file isn't a SQLite database\./;

test('THE LIMIT: the check is the 16 bytes, nothing else', () => {
  assert.equal(lib.hasSqliteHeader(HEADER), true);
  assert.equal(lib.hasSqliteHeader(Uint8Array.from([...HEADER, 4, 0, 1, 1, 0, 64])), true, 'what follows the header is not judged');
  assert.equal(lib.hasSqliteHeader(THUMBS), false, 'a thumbnail cache');
  assert.equal(lib.hasSqliteHeader(TEXT), false, 'a renamed text file');
  assert.equal(lib.hasSqliteHeader(bytesOf('SQLite format 3')), false, 'the zero byte is part of the header');
  assert.equal(lib.hasSqliteHeader(bytesOf('SQLite format 4\u0000')), false);
  assert.equal(lib.hasSqliteHeader(Uint8Array.from([1])), false, 'shorter than 16 bytes');
  assert.equal(lib.hasSqliteHeader(new Uint8Array(0)), false);
  assert.equal(lib.hasSqliteHeader(null), false);
});

test('the sentence is plain: it names the problem and a likely cause, and quotes no engine', () => {
  assert.match(lib.NOT_SQLITE_TEXT, /^This file isn't a SQLite database\./);
  assert.match(lib.NOT_SQLITE_TEXT, /thumbnail cache/);
  assert.doesNotMatch(lib.NOT_SQLITE_TEXT, /file is not a database|SQLITE_NOTADB|\(26\)/i);
});

/* ---------------------------------------------- the desktop engine -- */

async function makePluginWith(adapter, { desktop = true } = {}) {
  const fresh = loadPlugin({ desktop });
  const app = { vault: makeFakeVault(adapter, fresh.obsidian.TFile), workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  plugin.app = app;
  await plugin.onload();
  return { plugin, fresh };
}

/* A desktop with a sqlite3 that records its calls, and a file system whose
 * files are the vault's own bytes. `reads` counts the 16-byte header reads. */
function desktopOf(adapter) {
  const calls = [];
  const reads = [];
  adapter.getBasePath = () => '/vault';
  const deps = {
    calls,
    reads,
    childProcess: { execFile(bin, args, options, cb) { calls.push(args); setImmediate(() => cb(null, '[{"n":1}]', '')); } },
    pathx: nodeRequire('path').posix,
    fsx: {
      openSync(path) { reads.push(path); return path; },
      readSync(fd, buf, offset, length, position) {
        const file = adapter.binaries.get(fd.replace('/vault/', ''));
        const slice = file.subarray(position, position + length);
        buf.set(slice, offset);
        return slice.length;
      },
      closeSync() {},
    },
  };
  return deps;
}

test('the desktop engine reads 16 bytes by file handle and stops a file that is not SQLite before running the query', async () => {
  const adapter = makeFakeAdapter({}, { '07 Databases/Thumbs.db': THUMBS, '07 Databases/list.db': TEXT, '07 Databases/tiny.db': Uint8Array.from([...HEADER, ...new Array(100).fill(0)]) });
  const { plugin } = await makePluginWith(adapter);
  const deps = desktopOf(adapter);
  plugin.query.deps = deps;
  plugin.query.cli = { ok: true, version: 'gate' };
  for (const name of ['Thumbs', 'list']) {
    await assert.rejects(plugin.query.query('07 Databases/' + name + '.db', 'SELECT 1'), (e) => SENTENCE.test(e.message) && e.notSqlite === true, name);
  }
  assert.equal(deps.calls.length, 0, 'sqlite3 was never started for a file that is not SQLite');
  const res = await plugin.query.query('07 Databases/tiny.db', 'SELECT 1 AS n');
  assert.deepEqual(res.rows, [[1]]);
  assert.equal(deps.calls.length, 1);
});

test('the header is read once per version of a file, and again when the file changes', async () => {
  const adapter = makeFakeAdapter({}, { '07 Databases/tiny.db': Uint8Array.from([...HEADER, ...new Array(100).fill(0)]) });
  const { plugin } = await makePluginWith(adapter);
  const deps = desktopOf(adapter);
  plugin.query.deps = deps;
  plugin.query.cli = { ok: true, version: 'gate' };
  await plugin.query.query('07 Databases/tiny.db', 'SELECT 1 AS n');
  await plugin.query.query('07 Databases/tiny.db', 'SELECT 2 AS n');
  await plugin.query.query('07 Databases/tiny.db', 'SELECT 3 AS n');
  assert.equal(deps.reads.length, 1, 'three queries, one header read');
  /* The file is replaced by a text file: a new size and time, a new check. */
  adapter.binaries.set('07 Databases/tiny.db', TEXT);
  await assert.rejects(plugin.query.query('07 Databases/tiny.db', 'SELECT 4 AS n'), SENTENCE);
  assert.equal(deps.reads.length, 2);
});

test('an empty file and an unreadable header are left to the engine, which reads an empty file as an empty database', async () => {
  const adapter = makeFakeAdapter({}, { '07 Databases/empty.db': new Uint8Array(0), '07 Databases/locked.db': Uint8Array.from([...HEADER, 0]) });
  const { plugin } = await makePluginWith(adapter);
  const deps = desktopOf(adapter);
  deps.fsx.openSync = (path) => { if (/locked/.test(path)) throw new Error('EBUSY'); return path; };
  plugin.query.deps = deps;
  plugin.query.cli = { ok: true, version: 'gate' };
  assert.deepEqual((await plugin.query.query('07 Databases/empty.db', 'SELECT 1 AS n')).rows, [[1]]);
  assert.deepEqual((await plugin.query.query('07 Databases/locked.db', 'SELECT 1 AS n')).rows, [[1]], 'a file that cannot be opened for the header is not called a non-database');
  assert.equal(deps.calls.length, 2);
});

/* ------------------------------------------- the built-in engine -- */

async function realDatabase() {
  const initSqlJs = nodeRequire(resolve(repo, 'sql-wasm.js'));
  const SQL = await initSqlJs({ wasmBinary: readFileSync(resolve(repo, 'sql-wasm.wasm')) });
  const source = new SQL.Database();
  source.run('CREATE TABLE things (day TEXT, n INTEGER)');
  source.run("INSERT INTO things VALUES ('2026-08-01', 3), ('2026-08-02', 5)");
  const bytes = source.export();
  source.close();
  return bytes;
}

async function mobileOf(binaries) {
  const pluginDir = '.obsidian/plugins/readout';
  const adapter = makeFakeAdapter(
    { [pluginDir + '/sql-wasm.js']: readFileSync(resolve(repo, 'sql-wasm.js'), 'utf8') },
    Object.assign({ [pluginDir + '/sql-wasm.wasm']: readFileSync(resolve(repo, 'sql-wasm.wasm')) }, binaries),
  );
  const { plugin } = await makePluginWith(adapter, { desktop: false });
  return { plugin, adapter };
}

test('the built-in engine checks the bytes it has loaded: a thumbnail cache and a text file get the sentence, a real database opens', async () => {
  const { plugin } = await mobileOf({ '07 Databases/Thumbs.db': THUMBS, '07 Databases/list.sqlite': TEXT, '07 Databases/tiny.db': await realDatabase() });
  assert.equal(plugin.query.deps, null, 'no Node handles off the desktop');
  for (const name of ['Thumbs.db', 'list.sqlite']) {
    await assert.rejects(plugin.query.query('07 Databases/' + name, 'SELECT 1'), (e) => SENTENCE.test(e.message) && e.notSqlite === true, name);
  }
  assert.equal(plugin.query.wasm.open.size, 0, 'a file that is not SQLite is never kept open');
  const res = await plugin.query.query('07 Databases/tiny.db', 'SELECT day, n FROM things ORDER BY day');
  assert.deepEqual(unwrap(res.rows), [['2026-08-01', 3], ['2026-08-02', 5]]);
});

test('on the built-in engine a file of fewer than 16 bytes is not SQLite, and an empty one is an empty database', async () => {
  const { plugin } = await mobileOf({ '07 Databases/one.db': Uint8Array.from([1]), '07 Databases/empty.db': new Uint8Array(0) });
  await assert.rejects(plugin.query.query('07 Databases/one.db', 'SELECT 1'), SENTENCE);
  const res = await plugin.query.query('07 Databases/empty.db', "SELECT count(*) AS n FROM sqlite_master");
  assert.deepEqual(unwrap(res.rows), [[0]]);
});

/* ------------------------------------- where a member reads it -- */

test('the database browser shows the sentence in place of the tables', async () => {
  const { plugin } = await mobileOf({ '07 Databases/Thumbs.db': THUMBS });
  const view = plugin.viewFactories['readout-browser']({ app: plugin.app });
  view.app = plugin.app;
  await view.setDatabase('07 Databases/Thumbs.db');
  const text = [];
  (function walk(el) { if (el.classSet && el.classSet.has('icor-sqlv-error')) text.push(el.textContent); for (const c of el.children || []) walk(c); })(view.contentEl);
  assert.equal(text.length, 1);
  assert.match(text[0], SENTENCE);
});

test('the schema picker and a dashboard widget read the same sentence', async () => {
  const { plugin } = await mobileOf({ '07 Databases/Thumbs.db': THUMBS });
  await assert.rejects(plugin.schemaFor('07 Databases/Thumbs.db'), SENTENCE);
  await assert.rejects(plugin.query.query('07 Databases/Thumbs.db', 'SELECT 1', { cap: 5000 }), SENTENCE);
});
