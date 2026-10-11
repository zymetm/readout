/* THE EXAMPLE DASHBOARD (1.2).
 *
 * "Add example dashboard" builds an invented coffee-shop database with the
 * built-in sql.js engine and writes it, with a dashboard note for it, into the
 * member's folders. These gates hold: the data is the same for the same end
 * date and ends on that day; it has the nine tables with sane row counts; the
 * dashboard reads and carries no date, so it cannot go stale; and nothing that
 * already exists is written over.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

import { loadPlugin, makeFakeAdapter, makeFakeVault, notices, noteJson, unwrap } from './harness.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nodeRequire = createRequire(import.meta.url);
const lib = loadPlugin().lib;
const SQL = await nodeRequire(resolve(repo, 'sql-wasm.js'))({ wasmBinary: readFileSync(resolve(repo, 'sql-wasm.wasm')) });

const open = (bytes) => new SQL.Database(bytes);
const one = (db, sql) => db.exec(sql)[0].values[0];
const END = '2027-03-15';
const demo = (end) => lib.buildCoffeeDemo(SQL, end);

test('the same end date gives the same data; another end date gives other data', () => {
  const a = open(demo(END));
  const b = open(demo(END));
  for (const t of ['daily_store', 'weather', 'hourly_orders', 'product_daily', 'ratings', 'loyalty_daily']) {
    assert.deepEqual(a.exec('SELECT * FROM ' + t)[0].values, b.exec('SELECT * FROM ' + t)[0].values, t);
  }
  const c = open(demo('2027-03-16'));
  assert.notDeepEqual(c.exec('SELECT revenue FROM daily_store')[0].values.slice(0, 50), a.exec('SELECT revenue FROM daily_store')[0].values.slice(0, 50));
  for (const d of [a, b, c]) d.close();
});

test('nine tables, a view, sane row counts, three invented stores', () => {
  const db = open(demo(END));
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")[0].values.map((r) => r[0]);
  assert.deepEqual(tables, ['daily_store', 'hourly_orders', 'loyalty_daily', 'product_daily', 'products', 'ratings', 'stores', 'targets', 'weather']);
  assert.equal(one(db, "SELECT COUNT(*) FROM sqlite_master WHERE type = 'view' AND name = 'v_daily'")[0], 1);
  const days = 465;
  const n = (t) => one(db, 'SELECT COUNT(*) FROM ' + t)[0];
  assert.equal(n('stores'), 3);
  assert.equal(n('products'), 14);
  assert.equal(n('targets'), 11);
  assert.equal(n('weather'), days);
  assert.equal(n('daily_store'), days * 3);
  assert.equal(n('ratings'), days * 3);
  assert.equal(n('hourly_orders'), days * 3 * 11);
  assert.equal(n('product_daily'), days * 14);
  assert.equal(n('loyalty_daily'), days - 215, 'the loyalty scheme starts 249 days before the end');
  const [avgOrders, avgRevenue] = one(db, 'SELECT AVG(orders), AVG(revenue) FROM v_daily');
  assert.ok(avgOrders > 300 && avgOrders < 900, 'orders a day ' + avgOrders);
  assert.ok(avgRevenue > 1500 && avgRevenue < 6000, 'revenue a day ' + avgRevenue);
  const [rating] = one(db, 'SELECT AVG(avg_rating) FROM ratings');
  assert.ok(rating > 4 && rating < 5, 'rating ' + rating);
  assert.ok(one(db, 'SELECT MAX(total_members) FROM loyalty_daily')[0] > 1000);
  assert.equal(one(db, 'SELECT COUNT(*) FROM daily_store WHERE orders < 0 OR revenue < 0')[0], 0);
  db.close();
});

test('the window ends on the given day and runs the same length wherever it ends', () => {
  for (const end of [END, '2024-02-29', '2026-10-08']) {
    const db = open(demo(end));
    const [first, last, days] = one(db, 'SELECT MIN(day), MAX(day), COUNT(DISTINCT day) FROM daily_store');
    assert.equal(last, end);
    assert.equal(days, 465);
    assert.equal(Date.parse(last) - Date.parse(first), 464 * 86400000);
    for (const t of ['weather', 'ratings', 'hourly_orders', 'product_daily', 'loyalty_daily']) {
      assert.equal(one(db, 'SELECT MAX(day) FROM ' + t)[0], end, t);
    }
    db.close();
  }
});

test('the dated events move with the end date: promo days and the loyalty launch', () => {
  const at = (end, back) => new Date(Date.parse(end) - back * 86400000).toISOString().slice(0, 10);
  const db = open(demo(END));
  assert.equal(one(db, 'SELECT MIN(day) FROM loyalty_daily')[0], at(END, 249));
  assert.equal(one(db, 'SELECT MIN(day) FROM daily_store WHERE loyalty_orders > 0')[0] >= at(END, 249), true);
  const promo = at(END, 5);
  const day = one(db, "SELECT SUM(orders) FROM daily_store WHERE day = '" + promo + "'")[0];
  const around = one(db, "SELECT AVG(o) FROM (SELECT SUM(orders) AS o FROM daily_store WHERE day BETWEEN '" + at(END, 12) + "' AND '" + at(END, 8) + "' GROUP BY day)")[0];
  assert.ok(day > around, 'a promo day sells more than the days before it');
  db.close();
});

test('the dashboard reads, is wired to the given database, and holds no date', () => {
  const spec = lib.coffeeDashboardSpec('coffee-shop', 'Coffee Shop', 'Databases/coffee-shop-demo.db');
  const text = JSON.stringify(spec);
  assert.doesNotMatch(text, /\b(19|20)\d\d-\d\d-\d\d\b/, 'no fixed date anywhere');
  assert.doesNotMatch(text, /"from": ?"\d{4}/, 'no fixed range');
  const parsed = lib.parseDashboardSpec(text);
  assert.equal(parsed.ok, true, parsed.reason);
  assert.equal(parsed.spec.database, 'Databases/coffee-shop-demo.db');
  assert.equal(parsed.spec.tiles.length, 15);
  const frames = parsed.spec.tiles.filter((t) => t.source && t.source.timeframe).map((t) => unwrap(t.source.timeframe));
  assert.ok(frames.length >= 2);
  for (const f of frames) assert.ok(f.preset, 'a relative timeframe');
  assert.equal(spec.id, 'coffee-shop');
});

test('every tile of the dashboard draws data from the generated database', async () => {
  const bytes = demo(END);
  const db = open(bytes);
  const spec = lib.coffeeDashboardSpec('coffee-shop', 'Coffee Shop', 'x.db');
  const gone = [];
  for (const tile of spec.tiles) {
    if (tile.viz === 'divider' || tile.viz === 'text') continue;
    const sqlText = lib.tileSql(tile, spec);
    if (!sqlText) continue;
    const res = db.exec(sqlText);
    if (!res.length || !res[0].values.length) gone.push(tile.title);
  }
  db.close();
  assert.deepEqual(gone, [], 'tiles with no rows');
});

async function setup(files = {}, binaries = {}, saved = null) {
  const fresh = loadPlugin();
  const adapter = makeFakeAdapter(files, binaries);
  const vault = makeFakeVault(adapter, fresh.obsidian.TFile);
  const opened = [];
  const app = { vault, workspace: { onLayoutReady: () => {}, on: () => ({}), getLeavesOfType: () => [] }, metadataCache: { getFileCache: () => null } };
  const plugin = fresh.makePlugin(app, saved);
  plugin.app = app;
  await plugin.onload();
  return { plugin, adapter, opened, fresh };
}

test('the command is there, and nothing is written at load', async () => {
  const { plugin, adapter } = await setup();
  assert.ok(plugin.commands.some((c) => c.id === 'add-example-dashboard' && c.name === 'Add example dashboard'));
  assert.deepEqual([...adapter.files.keys(), ...adapter.binaries.keys()], []);
});

test('it writes the database to the databases folder and the dashboard note to the dashboards folder', async () => {
  const { plugin, adapter } = await setup();
  const spec = await plugin.addExampleDashboard(new Date(2027, 2, 15));
  assert.equal(spec.id, 'coffee-shop');
  const db = 'Databases/coffee-shop-demo.db';
  const note = 'Databases/Dashboards/coffee-shop.md';
  assert.ok(adapter.binaries.has(db));
  assert.ok(adapter.files.has(note));
  const written = noteJson(adapter.files.get(note));
  assert.equal(written.database, db);
  assert.equal(written.id, 'coffee-shop');
  const made = open(new Uint8Array(adapter.binaries.get(db)));
  assert.equal(one(made, 'SELECT MAX(day) FROM daily_store')[0], '2027-03-15');
  made.close();
  assert.ok(notices.some((n) => n.includes('Added the example dashboard')));
});

test('an ICOR vault gets it in the 07 Databases room', async () => {
  const { plugin, adapter } = await setup({}, {}, { dataFolder: '07 Databases', dashboardFolder: '07 Databases/Dashboards', cacheFolder: '07 Databases/Dashboard Cache' });
  const spec = await plugin.addExampleDashboard();
  assert.ok(spec);
  assert.ok(adapter.binaries.has('07 Databases/coffee-shop-demo.db'));
  assert.ok(adapter.files.has('07 Databases/Dashboards/coffee-shop.md'));
});

test('what is already there is never written over: the new files take the next number', async () => {
  const mine = new Uint8Array([1, 2, 3, 4]);
  const note = 'my own note\n';
  const { plugin, adapter } = await setup({ 'Databases/Dashboards/coffee-shop.md': note }, { 'Databases/coffee-shop-demo.db': mine });
  const spec = await plugin.addExampleDashboard();
  assert.equal(spec.id, 'coffee-shop-2');
  assert.equal(spec.title, 'Coffee Shop 2');
  assert.deepEqual([...adapter.binaries.get('Databases/coffee-shop-demo.db')], [1, 2, 3, 4]);
  assert.equal(adapter.files.get('Databases/Dashboards/coffee-shop.md'), note);
  assert.ok(adapter.binaries.has('Databases/coffee-shop-demo-2.db'));
  assert.equal(noteJson(adapter.files.get('Databases/Dashboards/coffee-shop-2.md')).database, 'Databases/coffee-shop-demo-2.db');
});

test('running it twice gives two separate examples and leaves the first as it was', async () => {
  const { plugin, adapter } = await setup();
  await plugin.addExampleDashboard();
  const first = adapter.files.get('Databases/Dashboards/coffee-shop.md');
  const firstDb = adapter.binaries.get('Databases/coffee-shop-demo.db');
  const second = await plugin.addExampleDashboard();
  assert.equal(second.id, 'coffee-shop-2');
  assert.equal(adapter.files.get('Databases/Dashboards/coffee-shop.md'), first);
  assert.equal(adapter.binaries.get('Databases/coffee-shop-demo.db'), firstDb);
});

test('a database alone, or a .json dashboard alone, also moves the number on', async () => {
  const a = await setup({}, { 'Databases/coffee-shop-demo.db': new Uint8Array([9]) });
  assert.equal((await a.plugin.addExampleDashboard()).id, 'coffee-shop-2');
  const b = await setup({ 'Databases/Dashboards/coffee-shop.json': '{}' });
  assert.equal((await b.plugin.addExampleDashboard()).id, 'coffee-shop-2');
});

test('the empty dashboards screen offers the button beside the guide files button, and it adds the example', async () => {
  const { plugin, adapter } = await setup();
  const view = plugin.viewFactories['readout-dashboards']({ app: plugin.app });
  view.app = plugin.app;
  await view.onOpen();
  const buttons = () => [...view.contentEl.walk()].filter((e) => e.tagName === 'BUTTON');
  const labels = buttons().map((e) => e.textContent);
  assert.ok(labels.includes('Add example dashboard'), labels.join(' | '));
  assert.ok(labels.includes('Create Guide Files for Your AI Team'));
  assert.equal(labels.indexOf('Add example dashboard') + 1, labels.indexOf('Create Guide Files for Your AI Team'));
  const click = buttons().find((e) => e.textContent === 'Add example dashboard');
  await click.handlers.click[0]();
  assert.ok(adapter.files.has('Databases/Dashboards/coffee-shop.md'));
  assert.equal(view.activeId, 'coffee-shop');
  assert.equal(view.specs.length, 1);
});

test('the database goes in through the vault, so the file list has it when the dashboard opens', async () => {
  const { plugin, adapter } = await setup();
  const made = [];
  const real = plugin.app.vault.createBinary;
  plugin.app.vault.createBinary = async (p, d) => { made.push(p); return real(p, d); };
  await plugin.addExampleDashboard();
  assert.deepEqual(made, ['Databases/coffee-shop-demo.db']);
  assert.ok(adapter.binaries.has('Databases/coffee-shop-demo.db'));
});

test('two runs at once make one example, not two on the same name', async () => {
  const { plugin, adapter } = await setup();
  const [a, b] = await Promise.all([plugin.addExampleDashboard(), plugin.addExampleDashboard()]);
  assert.equal([a, b].filter(Boolean).length, 1);
  assert.deepEqual([...adapter.binaries.keys()], ['Databases/coffee-shop-demo.db']);
  assert.ok(await plugin.addExampleDashboard(), 'free again afterwards');
});

test('a failure after the database is written removes the database', async () => {
  const { plugin, adapter } = await setup();
  plugin.saveDashboardSpec = async () => false;
  const spec = await plugin.addExampleDashboard();
  assert.equal(spec, null);
  assert.deepEqual([...adapter.binaries.keys()], []);
  assert.ok(notices.some((n) => n.includes('Could not add the example dashboard')));
});
