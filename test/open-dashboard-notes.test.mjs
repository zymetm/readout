/* CLICKING A DASHBOARD NOTE OPENS THE DASHBOARD (1.1.1).
 *
 * Tapping 07 Databases/Dashboards/shop.md used to open the note with its
 * JSON. Now a note whose properties say `readout: dashboard` shows its
 * dashboard in the pane it was opened in. The mechanism is the workspace's
 * 'file-open' event and leaf.setViewState; nothing is patched. These gates
 * hold the edges: nothing else is taken over, there is no loop, the note
 * stays one step away (and stays itself when the member asked for it, tab
 * switches included), and Back shows the note once instead of converting it
 * again. The pane here is a model of Obsidian's: it keeps a history, Back
 * replays an entry, and a replayed note fires 'file-open' again. */

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
  const reads = [];
  const cachedRead = vault.cachedRead;
  vault.cachedRead = async (f) => { reads.push(f.path); return cachedRead(f); };
  const handlers = {};
  const states = [];
  const frontmatter = {};
  const workspace = { iterateAllLeaves: (cb) => cb(leaf), onLayoutReady: () => {}, on: (name, fn) => { handlers[name] = fn; return {}; }, getMostRecentLeaf: () => leaf, getLeaf: () => leaf };
  const app = { vault, workspace, metadataCache: { getFileCache: (f) => (frontmatter[f.path] === undefined ? null : (frontmatter[f.path] === null ? {} : { frontmatter: frontmatter[f.path] })) } };
  const plugin = fresh.makePlugin(app, saved);
  plugin.app = app;
  await plugin.onload();
  plugin.query.cli = { ok: false, reason: 'gate' };
  const tick = () => new Promise((r) => setTimeout(r, 12));

  /* One pane, with a history. */
  const history = [];
  let at = -1;
  const leaf = { view: null };
  const note = (path, state) => ({ getViewType: () => 'markdown', file: new fresh.obsidian.TFile(path), getState: () => state || { mode: 'source', source: false } });
  const layoutChange = async () => { handlers['layout-change'](); await tick(); };
  const fire = async (path) => { await handlers['file-open'](new fresh.obsidian.TFile(path)); await tick(); };
  const show = async (entry) => {
    if (entry.type === 'markdown') { leaf.view = note(entry.path, entry.state); await fire(entry.path); return; }
    const view = plugin.viewFactories['readout-dashboards'](leaf);
    view.app = app;
    leaf.view = view;
    await view.onOpen();
    await view.setState(entry.state || {}, {});
  };
  leaf.setViewState = async (s) => { states.push(unwrap(s)); history.length = at + 1; history.push(unwrap(s)); at++; await show(s); };
  leaf.openFile = async (f) => { history.length = at + 1; history.push({ type: 'markdown', path: f.path }); at++; await show(history[at]); };
  const back = async () => { at--; await show(history[at]); };
  const forward = async () => { at++; await show(history[at]); };
  const open = async (path, state) => { history.length = at + 1; history.push({ type: 'markdown', path, state }); at++; await show(history[at]); return leaf; };
  return { plugin, adapter, fresh, states, handlers, frontmatter, leaf, open, back, forward, fire, layoutChange, show, reads, tick, history: () => history.map((h) => (h.type === 'markdown' ? h.path : h.type + ':' + (h.state && h.state.activeId))) };
}

const TWO = () => ({ [DIR + '/shop.md']: dash(), [DIR + '/other.md']: dash(Object.assign({}, SPEC, { id: 'other', title: 'Other' })) });

test('opening a dashboard note shows its dashboard in the same pane, on the dashboard the note holds', async () => {
  const ctx = await setup(TWO());
  const leaf = await ctx.open(DIR + '/other.md');
  assert.deepEqual(ctx.states, [{ type: 'readout-dashboards', active: true, state: { activeId: 'other' } }]);
  assert.equal(leaf.view.getViewType(), 'readout-dashboards');
  assert.equal(leaf.view.activeId, 'other');
});

test('no loop: once the pane shows the dashboard, the same event does nothing more', async () => {
  const ctx = await setup({ [DIR + '/shop.md']: dash() });
  await ctx.open(DIR + '/shop.md');
  await ctx.fire(DIR + '/shop.md');
  await ctx.fire(DIR + '/shop.md');
  assert.equal(ctx.states.length, 1);
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
  await ctx.open(DIR + '/shop.json');
  assert.deepEqual(ctx.states, []);
});

test('the property cache decides when it has an answer: no read for a note it says is not a dashboard; the note\'s own text when it has nothing yet', async () => {
  const ctx = await setup({ [DIR + '/plain.md']: '# plain\n', [DIR + '/bare.md']: '# no properties\n', [DIR + '/shop.md']: dash(), [DIR + '/fresh.md']: dash(Object.assign({}, SPEC, { id: 'fresh' })) });
  ctx.frontmatter[DIR + '/plain.md'] = { tags: ['x'] };
  ctx.frontmatter[DIR + '/bare.md'] = null; /* a cache with no frontmatter at all */
  ctx.frontmatter[DIR + '/shop.md'] = { readout: 'dashboard' };
  await ctx.open(DIR + '/plain.md');
  await ctx.open(DIR + '/bare.md');
  assert.deepEqual(ctx.reads, [], 'nothing was read');
  assert.deepEqual(ctx.states, []);
  await ctx.open(DIR + '/shop.md'); /* cache says dashboard: the text is read (cachedRead) for its id */
  await ctx.open(DIR + '/fresh.md'); /* cache not ready: the text decides */
  assert.deepEqual(ctx.reads, [DIR + '/shop.md', DIR + '/fresh.md']);
  assert.deepEqual(ctx.states.map((s) => s.state.activeId), ['shop', 'fresh']);
});

test('the setting turns it off, and is on by default', async () => {
  const ctx = await setup({ [DIR + '/shop.md']: dash() }, { openDashboardNotes: false });
  await ctx.open(DIR + '/shop.md');
  assert.deepEqual(ctx.states, []);
  const on = await setup({ [DIR + '/shop.md']: dash() });
  assert.equal(on.plugin.settings.openDashboardNotes, true);
});

test('a note in source mode, or in a pane that is not showing it, is not taken over; reading mode is', async () => {
  const ctx = await setup({ [DIR + '/shop.md']: dash() });
  await ctx.open(DIR + '/shop.md', { mode: 'source', source: true });
  assert.deepEqual(ctx.states, [], 'source mode is a choice to see the note');
  ctx.leaf.view = { getViewType: () => 'markdown', file: new ctx.fresh.obsidian.TFile(DIR + '/elsewhere.md'), getState: () => ({}) };
  await ctx.fire(DIR + '/shop.md');
  assert.deepEqual(ctx.states, [], 'the pane shows another file');
  await ctx.open(DIR + '/shop.md', { mode: 'preview' });
  assert.equal(ctx.states.length, 1, 'reading mode is the default on a phone');
});

test('"Open as note" and "Open as text" keep the note a note for as long as the pane shows it, tab switches included', async () => {
  const ctx = await setup(TWO());
  await ctx.plugin.openNoteRaw(DIR + '/shop.md');
  assert.deepEqual(ctx.states, []);
  /* file-open fires again whenever the member comes back to the tab, and the
   * old timed rule would have lapsed by now. */
  const realNow = Date.now;
  Date.now = () => realNow() + 10 * 60 * 1000;
  try {
    for (let i = 0; i < 3; i++) await ctx.fire(DIR + '/shop.md');
  } finally { Date.now = realNow; }
  assert.deepEqual(ctx.states, [], 'still the note, ten minutes later');
  assert.equal(ctx.leaf.view.getViewType(), 'markdown');

  /* The pane goes to another note: the request is over. Opening the first
   * again is an ordinary open, so it is a dashboard. */
  await ctx.open(DIR + '/README.md');
  await ctx.open(DIR + '/shop.md');
  assert.equal(ctx.states.length, 1);
  assert.equal(ctx.leaf.view.getViewType(), 'readout-dashboards');

  const text = await setup(TWO());
  await text.plugin.openDashboardAsText(DIR + '/other.md', text.leaf);
  await text.fire(DIR + '/other.md');
  await text.fire(DIR + '/other.md');
  assert.deepEqual(text.states, [], 'Open as text, then a tab switch');
});

test('the request belongs to its own pane: another pane opening the same note still gets the dashboard', async () => {
  const ctx = await setup(TWO());
  await ctx.plugin.openNoteRaw(DIR + '/shop.md');
  const second = { view: null };
  ctx.leaf.view = { getViewType: () => 'markdown', file: new ctx.fresh.obsidian.TFile(DIR + '/shop.md'), getState: () => ({}) };
  const saved = ctx.leaf;
  ctx.plugin.app.workspace.getMostRecentLeaf = () => second;
  second.view = { getViewType: () => 'markdown', file: new ctx.fresh.obsidian.TFile(DIR + '/shop.md'), getState: () => ({}) };
  second.setViewState = async (s) => { ctx.states.push(unwrap(s)); };
  await ctx.fire(DIR + '/shop.md');
  assert.equal(ctx.states.length, 1);
  assert.ok(saved);
});

test('Back from a dashboard shows the note once, a second Back goes further, Forward returns to the dashboard: no trap', async () => {
  const ctx = await setup(Object.assign(TWO(), { [DIR + '/README.md']: '# Help\n' }));
  await ctx.open(DIR + '/README.md');
  await ctx.open(DIR + '/shop.md');
  assert.deepEqual(ctx.history(), [DIR + '/README.md', DIR + '/shop.md', 'readout-dashboards:shop']);
  assert.equal(ctx.leaf.view.getViewType(), 'readout-dashboards');

  await ctx.back(); /* the note's own history entry: shown as the note */
  assert.equal(ctx.leaf.view.getViewType(), 'markdown');
  assert.equal(ctx.leaf.view.file.path, DIR + '/shop.md');
  assert.equal(ctx.states.length, 1, 'not converted again');
  await ctx.fire(DIR + '/shop.md'); /* the member switches tabs and returns */
  assert.equal(ctx.leaf.view.getViewType(), 'markdown');

  await ctx.back(); /* a second Back goes further */
  assert.equal(ctx.leaf.view.file.path, DIR + '/README.md');
  await ctx.forward(); /* the note's entry again: an ordinary open of a dashboard note, so the dashboard */
  assert.equal(ctx.leaf.view.getViewType(), 'readout-dashboards');
  assert.equal(ctx.leaf.view.activeId, 'shop');
  await ctx.back(); /* and Back still shows the note, once */
  assert.equal(ctx.leaf.view.getViewType(), 'markdown');
  await ctx.back();
  assert.equal(ctx.leaf.view.file.path, DIR + '/README.md');
});

test('Back past two dashboards in a row: the older note is converted once more (what is remembered covers one Back step), then Back shows it; never a trap', async () => {
  const ctx = await setup(TWO());
  await ctx.open(DIR + '/shop.md');
  await ctx.open(DIR + '/other.md');
  assert.equal(ctx.states.length, 2);
  await ctx.back(); /* other.md as a note: the immediate step */
  assert.equal(ctx.leaf.view.getViewType(), 'markdown');
  await ctx.back(); /* the shop dashboard */
  assert.equal(ctx.leaf.view.getViewType(), 'readout-dashboards');
  await ctx.back(); /* shop.md replayed: forgotten by now, so converted once more */
  assert.equal(ctx.leaf.view.getViewType(), 'readout-dashboards');
  assert.equal(ctx.states.length, 3);
  await ctx.back(); /* and now Back shows the note */
  assert.equal(ctx.leaf.view.getViewType(), 'markdown');
  assert.equal(ctx.leaf.view.file.path, DIR + '/shop.md');
  assert.equal(ctx.states.length, 3);
});

test('a pane that moved on to another note and is later given the dashboard note again shows the dashboard', async () => {
  const ctx = await setup(Object.assign(TWO(), { [DIR + '/README.md']: '# Help' }));
  await ctx.open(DIR + '/shop.md');
  assert.equal(ctx.states.length, 1);
  await ctx.open(DIR + '/README.md'); /* the same pane browses on */
  await ctx.open(DIR + '/other.md'); /* a different dashboard: converted */
  await ctx.open(DIR + '/README.md');
  await ctx.open(DIR + '/shop.md'); /* tapped again, much later */
  assert.equal(ctx.leaf.view.getViewType(), 'readout-dashboards');
  assert.equal(ctx.leaf.view.activeId, 'shop');
  assert.equal(ctx.states.length, 3);
  assert.deepEqual(ctx.states.map((s) => s.state.activeId), ['shop', 'other', 'shop']);
});

test('a pane object that Obsidian reuses (emptied, or showing a view that is not a note) forgets what it was told', async () => {
  for (const type of ['empty', 'graph']) {
    const ctx = await setup(TWO());
    await ctx.open(DIR + '/shop.md');
    assert.equal(ctx.states.length, 1);
    /* The pane is emptied or goes to another kind of view, with no file-open. */
    ctx.leaf.view = { getViewType: () => type };
    await ctx.layoutChange();
    await ctx.open(DIR + '/shop.md');
    assert.equal(ctx.leaf.view.getViewType(), 'readout-dashboards', type);
    assert.equal(ctx.states.length, 2, type);
  }
  /* A requested note is forgotten the same way when the pane moves on to a view that is not a note. */
  const ctx = await setup(TWO());
  await ctx.plugin.openNoteRaw(DIR + '/shop.md');
  ctx.leaf.view = { getViewType: () => 'graph' };
  await ctx.layoutChange();
  await ctx.open(DIR + '/shop.md');
  assert.equal(ctx.leaf.view.getViewType(), 'readout-dashboards');
});

test('a layout change while the pane replays the note for Back keeps what Back needs', async () => {
  const ctx = await setup(TWO());
  await ctx.open(DIR + '/shop.md');
  ctx.leaf.view = { getViewType: () => 'markdown', file: new ctx.fresh.obsidian.TFile(DIR + '/shop.md'), getState: () => ({}) };
  await ctx.layoutChange(); /* the note is back on screen, its file-open not yet handled */
  await ctx.fire(DIR + '/shop.md');
  assert.equal(ctx.leaf.view.getViewType(), 'markdown', 'shown once as the note');
  assert.equal(ctx.states.length, 1);
});

test('the file menu of a dashboard note offers the dashboard and the note', async () => {
  const menus = [];
  const ctx = await setup({ [DIR + '/shop.md']: dash() });
  ctx.frontmatter[DIR + '/shop.md'] = { readout: 'dashboard' };
  const real = ctx.plugin.app.workspace.on;
  ctx.plugin.app.workspace.on = (name, fn) => { if (name === 'file-menu') menus.push(fn); return {}; };
  await ctx.plugin.onload();
  ctx.plugin.app.workspace.on = real;
  const titles = [];
  const menu = { addItem(fn) { const it = {}; const api = { setTitle(t) { it.title = t; return api; }, setIcon() { return api; }, setSection() { return api; }, onClick() { return api; } }; fn(api); titles.push(it.title); return this; } };
  for (const fn of menus) fn(menu, new ctx.fresh.obsidian.TFile(DIR + '/shop.md'));
  assert.equal(titles.includes('Open as dashboard'), true);
  assert.equal(titles.includes('Open as note'), true);
});
