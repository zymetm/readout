/* Two things ReadOut no longer does, measured on the whole shipped main.js:
 * it never lists every file in the vault, and it never touches the clipboard.
 * Databases are found by walking the database folder's children; a result is
 * saved as a CSV file in the vault instead of copied. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { loadPlugin, notices, unwrap, makeFakeAdapter, makeFakeVault } from './harness.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(resolve(repo, 'main.js'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('no vault listing call and no clipboard call anywhere in main.js', () => {
  assert.doesNotMatch(code, /\.getFiles\s*\(|\.getMarkdownFiles\s*\(|\.getAllLoadedFiles\s*\(|\.recurseChildren\s*\(/);
  assert.doesNotMatch(code, /clipboard/i);
  assert.doesNotMatch(code, /execCommand\s*\(\s*['"]copy/);
});

async function session(files, binaries, data) {
  const fresh = loadPlugin({ desktop: true });
  const adapter = makeFakeAdapter(files, binaries);
  const vault = makeFakeVault(adapter, fresh.obsidian.TFile);
  vault.create = async (p, text) => { await adapter.write(p, text); const f = new fresh.obsidian.TFile(p); return f; };
  const app = { vault, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  plugin.app = app;
  if (data) plugin.saved = data;
  await plugin.onload();
  return { plugin, adapter, fresh };
}

test('databases are listed from the database folder only; the vault root is a choice', async () => {
  const bin = { '07 Databases/a.db': new Uint8Array(3), '07 Databases/sub/b.sqlite': new Uint8Array(2), 'Elsewhere/c.db': new Uint8Array(1), 'mypka.db': new Uint8Array(4) };
  const { plugin } = await session({}, bin);
  plugin.settings.dataFolder = '07 Databases';
  assert.deepEqual(unwrap(plugin.vaultDatabases().map((d) => d.path)), ['07 Databases/a.db', '07 Databases/sub/b.sqlite']);
  plugin.settings.dataFolder = '/';
  assert.deepEqual(unwrap(plugin.vaultDatabases().map((d) => d.path)), ['07 Databases/a.db', '07 Databases/sub/b.sqlite', 'Elsewhere/c.db', 'mypka.db']);
});

test('a database outside the folder still opens when a dashboard names it', async () => {
  const { plugin } = await session({}, { 'Elsewhere/c.db': new Uint8Array(1) });
  plugin.settings.dataFolder = '07 Databases';
  assert.deepEqual(unwrap(plugin.vaultDatabases()), []);
  const choice = await plugin.query.engineFor('Elsewhere/c.db');
  assert.ok(choice.engine, 'the engine is chosen by path, not by the listing');
});

test('Save as CSV writes into <database folder>/Exports with a name no file has, and never uses the clipboard', async () => {
  const { plugin, adapter, fresh } = await session({}, {});
  plugin.settings.dataFolder = '07 Databases';
  const res = { columns: ['a', 'b'], rows: [[1, 'x'], [2, 'y,z']] };
  const p1 = await plugin.saveCsv('07 Databases/shop.db', res);
  assert.match(p1, /^07 Databases\/Exports\/shop \d{4}-\d{2}-\d{2} \d{6}\.csv$/);
  assert.equal(adapter.files.get(p1), 'a,b\r\n1,x\r\n2,"y,z"\r\n');
  const p2 = await plugin.saveCsv('07 Databases/shop.db', res);
  assert.equal(adapter.files.size, 2, p2);
  assert.ok(notices.some((n) => /Saved 2 rows to 07 Databases\/Exports/.test(n)));
  plugin.settings.dataFolder = '/';
  assert.match(await plugin.saveCsv('mypka.db', res), /^Exports\/mypka /);
});

test('csvExportName adds a counter when the name is taken', () => {
  const { lib } = loadPlugin();
  const d = new Date(2026, 9, 9, 8, 7, 6);
  assert.equal(lib.csvExportName('a/shop.db', d), 'shop 2026-10-09 080706.csv');
  assert.equal(lib.csvExportName('a/shop.db', d, new Set(['shop 2026-10-09 080706.csv'])), 'shop 2026-10-09 080706 (2).csv');
});
