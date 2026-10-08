/* THE DASHBOARDS VIEW.
 *
 * The 0.1.0 live bug: a dashboards view that opened before the starter
 * files existed stayed empty forever (the ribbon only revealed the stale
 * leaf), and a failure inside the un-awaited render chain died silently.
 * These gates pin the 0.1.1 rules: an empty folder seeds itself and
 * renders, a failing query becomes visible error text inside its tile, a
 * failure of the whole render chain becomes visible error text in the
 * view, and reload() re-reads the folder every time it is called.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeFakeAdapter, makeFakeVault, notices, FIXTURE_DASHBOARD_FILES } from './harness.mjs';

const VIEW_DASHBOARDS = 'readout-dashboards';

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
function collectByClass(root, cls) { const out = []; for (const el of walkEl(root)) if (el.classSet && el.classSet.has(cls)) out.push(el); return out; }
function textOf(el) { let t = el.textContent || ''; for (const c of el.children || []) t += ' ' + textOf(c); return t; }

async function makeView(adapter, { desktop = true } = {}) {
  const { makePlugin } = loadPlugin({ desktop });
  const app = { vault: { adapter, getFiles: () => [] }, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = makePlugin(app);
  await plugin.onload();
  const view = plugin.viewFactories[VIEW_DASHBOARDS]({ app });
  view.app = app;
  return { plugin, view };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

test('a view opened against an empty folder says so, offers a first dashboard and writes nothing', async () => {
  const adapter = makeFakeAdapter({}, { '07 Databases/engagement.db': new Uint8Array([1]) });
  const { plugin, view } = await makeView(adapter);
  plugin.query.cli = { ok: false, reason: 'gate' };
  await view.onOpen();
  await settle();
  assert.equal(view.specs.length, 0, 'the plugin ships no dashboards of its own');
  assert.match(textOf(view.contentEl), /No dashboards yet\./);
  assert.match(textOf(view.contentEl), /Create your first dashboard/);
  assert.deepEqual(adapter.log.filter(([op]) => op === 'write' || op === 'mkdir'), [], 'opening the view creates nothing');
});

test('a dashboard that is in the folder is found and shown', async () => {
  const adapter = makeFakeAdapter(FIXTURE_DASHBOARD_FILES, { '07 Databases/engagement.db': new Uint8Array([1]) });
  const { plugin, view } = await makeView(adapter);
  plugin.query.cli = { ok: false, reason: 'gate' };
  await view.onOpen();
  await settle();
  assert.equal(view.specs.length, 1);
  assert.equal(view.activeId, view.specs[0].id);
});

test('a failing tile query renders its error text inside the tile, never an empty tile', async () => {
  const adapter = makeFakeAdapter(FIXTURE_DASHBOARD_FILES, { '07 Databases/engagement.db': new Uint8Array([1]) });
  const { plugin, view } = await makeView(adapter);
  plugin.query.engineFor = async () => ({ engine: 'cli', size: 1 });
  plugin.query.query = async () => { throw new Error('no such table: nope'); };
  await view.onOpen();
  await settle();
  const tiles = collectByClass(view.contentEl, 'icor-sqlv-tile');
  assert.ok(tiles.length > 0, 'tiles must exist');
  const errors = collectByClass(view.contentEl, 'icor-sqlv-error');
  assert.ok(errors.length > 0, 'the errors must be visible');
  assert.match(errors.map(textOf).join(' '), /no such table: nope/);
  const status = textOf(view.contentEl);
  assert.match(status, /widgets failed/, 'the status line must say that widgets failed');
});

test('a failure of the whole render chain lands in the view as text, never as a blank pane', async () => {
  const adapter = makeFakeAdapter(FIXTURE_DASHBOARD_FILES, { '07 Databases/engagement.db': new Uint8Array([1]) });
  const { plugin, view } = await makeView(adapter);
  plugin.query.engineFor = async () => { throw new Error('the engine exploded'); };
  plugin.readDashboardCache = async () => { throw new Error('the engine exploded'); };
  await view.onOpen();
  await settle();
  const errors = collectByClass(view.contentEl, 'icor-sqlv-error');
  assert.ok(errors.length > 0, 'the failure must be visible');
  const text = errors.map(textOf).join(' ');
  assert.match(text, /could not be drawn/);
  assert.match(text, /the engine exploded/);
});

test('reload() re-reads the folder, so a dashboard added after the first open appears', async () => {
  const adapter = makeFakeAdapter(FIXTURE_DASHBOARD_FILES, { '07 Databases/engagement.db': new Uint8Array([1]) });
  const { plugin, view } = await makeView(adapter);
  plugin.query.cli = { ok: false, reason: 'gate' };
  await view.onOpen();
  await settle();
  const before = view.specs.length;
  await adapter.write('07 Databases/Dashboards/extra.json', JSON.stringify({
    id: 'extra', title: 'Extra', database: '07 Databases/x.db',
    tiles: [{ sql: 'SELECT 1 AS one', viz: 'stat', y: 'one' }],
  }));
  await view.reload();
  await settle();
  assert.equal(view.specs.length, before + 1, 'the new dashboard must be discovered on reload');
});

test('the toolbar wraps and its dropdown shrinks, so a phone never clips Refresh or scrolls sideways', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const rule = (sel) => { const at = css.indexOf(sel + ' {'); return at < 0 ? '' : css.slice(at, css.indexOf('}', at)); };
  assert.match(rule('.icor-sqlv-dash-bar'), /flex-wrap:\s*wrap/, 'the bar wraps');
  assert.match(rule('.icor-sqlv-dash-bar select.dropdown'), /min-width:\s*0/, 'the dropdown can shrink below its text');
  assert.match(rule('.icor-sqlv-dash-bar button'), /flex:\s*0 0 auto/, 'a button keeps its own size and moves to the next line instead of being cut');
});

test('the empty screen offers "Create Guide Files for Your AI Team": it writes both guides, says where, and offers to open the AI guide', async () => {
  const adapter = makeFakeAdapter({}, { '07 Databases/engagement.db': new Uint8Array([1]) });
  const { makePlugin, obsidian } = loadPlugin({ desktop: true });
  const opened = [];
  const app = {
    vault: { ...makeFakeVault(adapter, obsidian.TFile) },
    workspace: { onLayoutReady: () => {}, on: () => ({}), getLeaf: () => ({ openFile: async (f) => { opened.push(f.path); } }) },
  };
  const plugin = makePlugin(app);
  await plugin.onload();
  const view = plugin.viewFactories[VIEW_DASHBOARDS]({ app });
  view.app = app;
  plugin.query.cli = { ok: false, reason: 'gate' };
  await view.onOpen();
  await settle();
  const folder = plugin.settings.dashboardFolder;
  const button = (el, text) => [...walkEl(el)].find((e) => e.tagName === 'BUTTON' && e.textContent === text);
  assert.ok(button(view.contentEl, 'Create your first dashboard'), 'the first button stays');
  const guides = button(view.contentEl, 'Create Guide Files for Your AI Team');
  assert.ok(guides, 'the guide button shows on the empty screen');
  assert.equal(adapter.files.has(folder + '/README.md'), false, 'nothing is written before the button is pressed');
  const before = notices.length;
  for (const fn of guides.handlers.click) await fn();
  assert.ok(adapter.files.has(folder + '/README.md'), 'the help file is written');
  assert.ok(adapter.files.has(folder + '/AI-WIDGET-GUIDE.md'), 'the AI guide is written');
  assert.match(notices.slice(before).join(' '), new RegExp('Guide files in ' + folder));
  assert.match(textOf(view.contentEl), new RegExp('The guide files are in ' + folder));
  const open = button(view.contentEl, 'Open the AI guide');
  assert.ok(open, 'the screen offers to open the AI guide');
  for (const fn of open.handlers.click) await fn();
  assert.deepEqual(opened, [folder + '/AI-WIDGET-GUIDE.md']);
  /* Pressed again, the guides already exist: it behaves like the command and still answers. */
  const again = notices.length;
  for (const fn of guides.handlers.click) await fn();
  assert.match(notices.slice(again).join(' '), /already up to date/);
});
