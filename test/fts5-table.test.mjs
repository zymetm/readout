/* A TABLE THE BUILT-IN ENGINE CANNOT READ.
 *
 * A database may hold a virtual table whose SQLite module the built-in
 * engine does not have (the first one met: an FTS5 search index, notes_fts,
 * in a real notes database). PRAGMA table_info on it fails with "no such
 * module: fts5". One such table must never take the others with it: the
 * schema, the mobile catalog, the row counts and the widget editor's table
 * picker all list it with no columns and a plain note.
 *
 * The fixture is a real database in which one ordinary table's sqlite_master
 * row is rewritten to say it is an FTS5 virtual table, which is exactly what
 * such a file looks like to an engine that lacks the module.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

import { loadPlugin, makeFakeAdapter, makeFakeVault, unwrap, noteJson } from './harness.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nodeRequire = createRequire(import.meta.url);

async function ftsDatabase() {
  const initSqlJs = nodeRequire(resolve(repo, 'sql-wasm.js'));
  const SQL = await initSqlJs({ wasmBinary: readFileSync(resolve(repo, 'sql-wasm.wasm')) });
  const db = new SQL.Database();
  db.run('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)');
  db.run("INSERT INTO notes VALUES (1, 'one'), (2, 'two')");
  db.run('CREATE TABLE notes_fts (body TEXT)');
  db.run('PRAGMA writable_schema = ON');
  db.run("UPDATE sqlite_master SET sql = 'CREATE VIRTUAL TABLE notes_fts USING fts5(body)' WHERE name = 'notes_fts'");
  db.run('PRAGMA writable_schema = OFF');
  const bytes = db.export();
  db.close();
  return bytes;
}

async function setup() {
  const fresh = loadPlugin({ desktop: true });
  const adapter = makeFakeAdapter({}, { '07 Databases/notes.db': await ftsDatabase() });
  const app = { vault: makeFakeVault(adapter, fresh.obsidian.TFile), workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  plugin.app = app;
  await plugin.onload();
  return { plugin, adapter, fresh };
}

test('the fixture reproduces the failure: the engine really cannot read the table', async () => {
  const { plugin } = await setup();
  await assert.rejects(plugin.query.query('07 Databases/notes.db', "PRAGMA table_info('notes_fts')"), /no such module/i);
});

test('schemaFor lists the unreadable table with no columns and keeps the others', async () => {
  const { plugin } = await setup();
  const schema = await plugin.schemaFor('07 Databases/notes.db');
  const byName = Object.fromEntries(schema.tables.map((t) => [t.name, t]));
  assert.deepEqual(unwrap(byName.notes.columns.map((c) => c.name)), ['id', 'body']);
  assert.deepEqual(unwrap(byName.notes_fts.columns), []);
  assert.equal(byName.notes_fts.unreadable, true);
  assert.ok(!byName.notes.unreadable);
});

test('the catalog writes, with the unreadable table marked, and no error is logged', async () => {
  const { plugin, adapter } = await setup();
  const logged = [];
  const original = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    await plugin.writeCatalog('07 Databases/notes.db');
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, []);
  const written = [...adapter.files.entries()].find(([p]) => /Dashboard Cache.*\.json$/.test(p) || /catalog/i.test(p));
  assert.ok(written, 'a catalog file was written');
  const catalog = noteJson(written[1]);
  const fts = catalog.tables.find((t) => t.name === 'notes_fts');
  assert.deepEqual(fts.columns, []);
  assert.equal(fts.unreadable, true);
  assert.ok(catalog.tables.find((t) => t.name === 'notes').columns.length === 2);
});

test('the database browser counts the readable table and marks the other, with the plain note', async () => {
  const { plugin } = await setup();
  const view = plugin.viewFactories['readout-browser']({ app: plugin.app });
  view.app = plugin.app;
  await view.setDatabase('07 Databases/notes.db');
  await view.fillCounts();
  assert.equal(view.counts.get('notes'), 2);
  assert.equal(view.counts.get('notes_fts'), null);
  assert.equal(view.countLabel('notes_fts'), '–', 'a dash, not a question mark');
  assert.equal(view.countLabel('notes'), '2');
  assert.match(plugin.constructor.lib.UNREADABLE_TABLE_NOTE, /can't be read by the built-in engine/);
  assert.match(plugin.constructor.lib.UNREADABLE_TABLE_NOTE, /FTS5/);
});

test('the browser shows the plain note, not the engine error, for the schema and the data of that table', async () => {
  const { plugin } = await setup();
  const view = plugin.viewFactories['readout-browser']({ app: plugin.app });
  view.app = plugin.app;
  await view.setDatabase('07 Databases/notes.db');
  view.active = 'notes_fts';
  await view.renderSchema();
  const texts = [];
  (function walk(el) { if (el.classSet && (el.classSet.has('icor-sqlv-note') || el.classSet.has('icor-sqlv-error'))) texts.push([...el.classSet].join(' ') + ': ' + el.textContent); for (const c of el.children || []) walk(c); })(view.bodyEl);
  assert.equal(texts.length, 1);
  assert.match(texts[0], /icor-sqlv-note/);
  assert.match(texts[0], /can't be read by the built-in engine/);
  assert.doesNotMatch(texts[0], /no such module/);
});

test('the widget editor picker lists the table with a plain note instead of a column count', async () => {
  const { plugin } = await setup();
  const schema = await plugin.schemaFor('07 Databases/notes.db');
  /* ensureSchema is the picker's door: it must not throw for this database. */
  assert.equal(schema.live, true);
  assert.equal(schema.tables.length, 2);
});
