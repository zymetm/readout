/* CLICKING A DASHBOARD NOTE OPENS THE DASHBOARD (1.1.1).
 *
 * Tapping 07 Databases/Dashboards/shop.md used to open the note with its
 * JSON. Now a note whose properties say `readout: dashboard` shows its
 * dashboard in the pane it was opened in. The mechanism is the workspace's
 * 'file-open' event and leaf.setViewState; nothing is patched. These gates
 * hold the edges: nothing else is taken over, there is no loop, and the
 * note stays one step away. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeFakeAdapter, makeFakeVault, unwrap } from './harness.mjs';

const DIR = '07 Databases/Dashboards';
const lib = loadPlugin().lib;
const SPEC = { id: 'shop', title: 'Shop', database: '07 Databases/shop.db', globalTimeframe: { preset: '90d' }, tiles: [{ title: 'Orders', viz: 'stat', y: 'n', sql: 'SELECT 3 AS n' }] };
const dash = (spec = SPEC) => lib.writeReadoutNote('dashboard', JSON.stringify(spec, null, 2));

async function setup(files, saved) {
  const fresh = loadPlugin();
  const adapter = makeFakeAdapter(files);
  const vault = makeFakeVault(adapter, fresh.obsidian.TFile);
  const handlers = {};
  const states = [];
  const reloads = [];
  const frontmatter = {};
  /* A pane showing a note: what Obsidian's workspace hands back. */
  const pane = (path, state) => {
    const leaf = { view: null, setViewState: async (s) => { states.push(unwrap(s)); leaf.view = { getViewType: () => s.type, reload: async () => { reloads.push(leaf.view.activeId); } }; } };
    leaf.view = { getViewType: () => 'markdown', file: new fresh.obsidian.TFile(path), getState: () => state || { mode: 'source', source: false } };
    return leaf;
  };
  const workspace = { onLayoutReady: () => {}, on: (name, fn) => { handlers[name] = fn; return {}; }, getMostRecentLeaf: () => workspace.leaf, getLeaf: () => workspace.leaf };
  const app = { vault, workspace, metadataCache: { getFileCache: (f) => ({ frontmatter: frontmatter[f.path] }) } };
  const plugin = fresh.makePlugin(app, saved);
  plugin.app = app;
  await plugin.onload();
  const open = async (path, state) => {
    workspace.leaf = pane(path, state);
    await handlers['file-open'](new fresh.obsidian.TFile(path));
    await new Promise((r) => setTimeout(r, 10));
    return workspace.leaf;
  };
  return { plugin, adapter, fresh, states, reloads, handlers, frontmatter, workspace, open, pane };
}

test('opening a dashboard note shows its dashboard in the same pane, on the dashboard the note holds', async () => {
  const ctx = await setup({ [DIR + '/shop.md']: dash(), [DIR + '/other.md']: dash(Object.assign({}, SPEC, { id: 'other', title: 'Other' })) });
  const leaf = await ctx.open(DIR + '/other.md');
  assert.deepEqual(ctx.states, [{ type: 'readout-dashboards', active: true }]);
  assert.equal(leaf.view.activeId, 'other');
  assert.deepEqual(ctx.reloads, ['other']);
});

test('no loop: once the pane shows the dashboard, the same event does nothing more', async () => {
  const ctx = await setup({ [DIR + '/shop.md']: dash() });
  const leaf = await ctx.open(DIR + '/shop.md');
  await ctx.handlers['file-open'](new ctx.fresh.obsidian.TFile(DIR + '/shop.md'));
  await ctx.handlers['file-open'](new ctx.fresh.obsidian.TFile(DIR + '/shop.md'));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(ctx.states.length, 1);
  assert.equal(leaf.view.getViewType(), 'readout-dashboards');
});

test('other notes, cache notes, notes that do not read as a dashboard, and non-notes are left alone', async () => {
  const ctx = await setup({
    [DIR + '/README.md']: '# Help\n',
    [DIR + '/mine.md']: '---\ntags: [x]\n---\nhello\n',
    '07 Databases/Dashboard Cache/dashboards/shop.md': lib.writeReadoutNote('cache', '{}'),
    [DIR + '/broken.md']: lib.writeReadoutNote('dashboard', '{ "id": "broken" '),
    [DIR + '/no-tiles.md']: lib.writeReadoutNote('dashboard', JSON.stringify({ id: 'x', title: 'X' })),
  });
  for (const path of [DIR + '/README.md', DIR + '/mine.md', '07 Databases/Dashboard Cache/dashboards/shop.md', DIR + '/broken.md', DIR + '/no-tiles.md']) await ctx.open(path);
  assert.deepEqual(ctx.states, []);
  ctx.workspace.leaf = ctx.pane(DIR + '/shop.json');
  await ctx.handlers['file-open'](new ctx.fresh.obsidian.TFile(DIR + '/shop.json'));
  assert.deepEqual(ctx.states, []);
});

test('the setting turns it off', async () => {
  const ctx = await setup({ [DIR + '/shop.md']: dash() }, { openDashboardNotes: false });
  await ctx.open(DIR + '/shop.md');
  assert.deepEqual(ctx.states, []);
  const on = await setup({ [DIR + '/shop.md']: dash() });
  assert.equal(on.plugin.settings.openDashboardNotes, true, 'on by default');
});

test('a note in source mode, or in a pane that is not showing it, is not taken over', async () => {
  const ctx = await setup({ [DIR + '/shop.md']: dash() });
  await ctx.open(DIR + '/shop.md', { mode: 'source', source: true });
  assert.deepEqual(ctx.states, [], 'source mode is a choice to see the note');
  ctx.workspace.leaf = ctx.pane(DIR + '/elsewhere.md');
  await ctx.handlers['file-open'](new ctx.fresh.obsidian.TFile(DIR + '/shop.md'));
  assert.deepEqual(ctx.states, [], 'the active pane shows another file');
  await ctx.open(DIR + '/shop.md', { mode: 'preview' });
  assert.equal(ctx.states.length, 1, 'reading mode is not a choice, it is the default on a phone');
});

test('"Open as text" and "Open as note" show the note itself, once; the next open is a dashboard again', async () => {
  const ctx = await setup({ [DIR + '/shop.md']: dash() });
  const opened = [];
  const leaf = { openFile: async (f) => { opened.push(f.path); ctx.workspace.leaf = ctx.pane(f.path); await ctx.handlers['file-open'](f); } };
  await ctx.plugin.openDashboardAsText(DIR + '/shop.md', leaf);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(opened, [DIR + '/shop.md']);
  assert.deepEqual(ctx.states, [], 'not converted back');

  ctx.workspace.getLeaf = () => leaf;
  await ctx.plugin.openNoteRaw(DIR + '/shop.md');
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(ctx.states, []);

  ctx.plugin.rawOpen = null;
  await ctx.open(DIR + '/shop.md');
  assert.equal(ctx.states.length, 1);
});

test('the file menu of a dashboard note offers the dashboard and the note', async () => {
  const menus = [];
  const ctx = await setup({ [DIR + '/shop.md']: dash() });
  const real = ctx.workspace.on;
  ctx.frontmatter[DIR + '/shop.md'] = { readout: 'dashboard' };
  ctx.workspace.on = (name, fn) => { if (name === 'file-menu') menus.push(fn); return {}; };
  await ctx.plugin.onload();
  const titles = [];
  const menu = { addItem(fn) { const it = {}; const api = { setTitle(t) { it.title = t; return api; }, setIcon() { return api; }, setSection() { return api; }, onClick() { return api; } }; fn(api); titles.push(it.title); return this; } };
  for (const fn of menus) fn(menu, new ctx.fresh.obsidian.TFile(DIR + '/shop.md'));
  assert.equal(titles.includes('Open as dashboard'), true);
  assert.equal(titles.includes('Open as note'), true);
  assert.ok(real);
});
