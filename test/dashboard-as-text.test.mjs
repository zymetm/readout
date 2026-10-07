/* A DASHBOARD FILE, OPENED AS TEXT.
 *
 * A dashboard file always went to the dashboards view: the JSON view
 * handed every file that parses as a dashboard to the builder, so its
 * "Edit as text" was out of reach for exactly the files that needed it,
 * and a setting the edit form has no field for could only be changed in
 * another program. "Open as text" is a view-state flag on the JSON view
 * (it rides getState/setState like any Obsidian view option): the file
 * stays in the text editor, a line under it says whether the dashboard
 * still reads, and "Done editing" goes back to the dashboard. Three ways
 * in, all named "Open as text": the dashboards pane's "More options" menu,
 * a button in edit mode, and the file menu of a dashboard file.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeFakeAdapter, notices } from './harness.mjs';

const VIEW_JSON = 'readout-json';
const VIEW_DASHBOARDS = 'readout-dashboards';
const PATH = '07 Databases/Dashboards/shop.json';
const SPEC = { id: 'shop', title: 'Shop', database: '07 Databases/shop.db', tiles: [{ title: 'Orders', sql: 'SELECT 3 AS n', viz: 'stat', y: 'n' }] };

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
function byClass(root, cls) { const out = []; for (const el of walkEl(root)) if (el.classSet && el.classSet.has(cls)) out.push(el); return out; }
function buttons(root) { const out = []; for (const el of walkEl(root)) if (el.tagName === 'BUTTON') out.push(el); return out; }
function textOf(el) { let t = el.textContent || ''; for (const c of el.children || []) t += ' ' + textOf(c); return t; }
async function click(el) { for (const fn of (el.handlers && el.handlers.click) || []) await fn({ preventDefault() {}, stopPropagation() {} }); }
const settle = () => new Promise((r) => setTimeout(r, 20));

function fakeMenu() {
  const items = [];
  return {
    items,
    addItem(fn) {
      const item = { title: '', icon: '', click: null };
      const api = { setTitle(t) { item.title = t; return api; }, setIcon(i) { item.icon = i; return api; }, setSection() { return api; }, onClick(f) { item.click = f; return api; } };
      fn(api);
      items.push(item);
      return this;
    },
  };
}

async function setup() {
  const { makePlugin } = loadPlugin();
  const files = { [PATH]: JSON.stringify(SPEC, null, 2) };
  const adapter = makeFakeAdapter(files);
  const fileMenus = [];
  const modified = [];
  const modifyHandlers = [];
  /* Like Obsidian: every change to a file, by anyone, fires 'modify'. */
  const fire = async (path) => { for (const fn of modifyHandlers) await fn({ path }); };
  const app = {
    vault: {
      adapter,
      getFiles: () => [],
      read: async (f) => adapter.files.get(f.path),
      process: async (f, fn) => {
        const next = fn(adapter.files.get(f.path));
        adapter.files.set(f.path, next);
        modified.push(f.path);
        return next;
      },
      /* Upstream's blind write, kept so the old code can be measured. */
      modify: async (f, text) => { adapter.files.set(f.path, text); modified.push(f.path); },
      on: (name, fn) => { if (name === 'modify') modifyHandlers.push(fn); return {}; },
    },
    workspace: {
      onLayoutReady: () => {},
      on: (name, fn) => { if (name === 'file-menu') fileMenus.push(fn); return {}; },
      getLeaf: () => leaf,
    },
  };
  const plugin = makePlugin(app);
  plugin.app = app;
  await plugin.onload();
  const states = [];
  const leaf = { app, view: null, setViewState: async (s) => { states.push(s); } };
  return { plugin, app, adapter, leaf, states, fileMenus, modified, fire };
}

async function jsonViewAsText(ctx) {
  const view = ctx.plugin.viewFactories[VIEW_JSON](ctx.leaf);
  view.app = ctx.app;
  view.leaf = ctx.leaf;
  const file = { path: PATH, name: 'shop.json', stat: { size: ctx.adapter.files.get(PATH).length } };
  if (view.onOpen) await view.onOpen();
  await view.setState({ file: PATH, asText: true }, {});
  view.file = file;
  await view.onLoadFile(file);
  await settle();
  return view;
}

test('opened as text, a dashboard file stays in the text editor and says it reads', async () => {
  const ctx = await setup();
  const view = await jsonViewAsText(ctx);
  assert.equal(ctx.states.length, 0, 'no hand-off to the dashboards view');
  const area = byClass(view.contentEl, 'icor-sqlv-json-editor')[0];
  assert.ok(area, 'the text editor is open');
  assert.match(area.value, /"id": "shop"/);
  const check = byClass(view.contentEl, 'icor-sqlv-json-check')[0];
  assert.ok(check, 'a check line sits with the editor');
  assert.match(check.textContent, /reads fine: 1 widget/);
  assert.equal(view.getState().asText, true, 'the flag rides the view state');
});

test('the check line names what is wrong as the text changes, and the save goes through the vault', async () => {
  const ctx = await setup();
  const view = await jsonViewAsText(ctx);
  const area = byClass(view.contentEl, 'icor-sqlv-json-editor')[0];
  const check = byClass(view.contentEl, 'icor-sqlv-json-check')[0];
  area.value = JSON.stringify(Object.assign({}, SPEC, { tiles: [{ title: 'Orders', sql: 'SELECT 3 AS n', viz: 'stat', y: 'n', valueSiz: 3, layout: { x: 0, y: 0, w: 99, h: 1 } }] }));
  for (const fn of area.handlers.input || []) fn();
  assert.match(check.textContent, /will not open like this/);
  assert.equal(check.classSet.has('is-error'), true);
  area.value = JSON.stringify(SPEC);
  for (const fn of area.handlers.input || []) fn();
  assert.match(check.textContent, /reads fine/);
  for (const fn of area.handlers.blur || []) await fn();
  assert.deepEqual(ctx.modified, [PATH]);
});

test('"Done editing" goes back to the dashboard when it reads, and stays with the reason when it does not', async () => {
  const ctx = await setup();
  let view = await jsonViewAsText(ctx);
  let done = buttons(view.contentEl).find((b) => b.textContent === 'Done editing');
  await click(done);
  await settle();
  assert.equal(ctx.states.length, 1, 'handed back once');
  assert.equal(ctx.states[0].type, VIEW_DASHBOARDS);

  const broken = await setup();
  view = await jsonViewAsText(broken);
  const area = byClass(view.contentEl, 'icor-sqlv-json-editor')[0];
  area.value = '{"id": "shop", "title": "Shop", "tiles": [ }';
  done = buttons(view.contentEl).find((b) => b.textContent === 'Done editing');
  await click(done);
  await settle();
  assert.equal(broken.states.length, 0, 'a file that does not read stays here');
  assert.match(textOf(view.contentEl), /Not valid JSON/);
});

test('without the flag, a dashboard file still goes straight to the dashboards view', async () => {
  const ctx = await setup();
  const view = ctx.plugin.viewFactories[VIEW_JSON](ctx.leaf);
  view.app = ctx.app;
  view.leaf = ctx.leaf;
  await view.setState({ file: PATH }, {});
  await view.onLoadFile({ path: PATH, name: 'shop.json', stat: { size: 10 } });
  await settle();
  assert.equal(ctx.states.length, 1);
  assert.equal(ctx.states[0].type, VIEW_DASHBOARDS);
  assert.equal(view.getState().asText, undefined);
});

test('the dashboards pane menu and the edit-mode button open the dashboard file as text, in the same leaf', async () => {
  const ctx = await setup();
  const view = ctx.plugin.viewFactories[VIEW_DASHBOARDS](ctx.leaf);
  view.app = ctx.app;
  view.leaf = ctx.leaf;
  ctx.plugin.query.cli = { ok: false, reason: 'gate' };
  await view.onOpen();
  await settle();
  const menu = fakeMenu();
  view.onPaneMenu(menu, 'more-options');
  const item = menu.items.find((i) => i.title === 'Open as text');
  assert.ok(item, 'the pane menu offers it');
  await item.click();
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.states.pop())), { type: VIEW_JSON, state: { file: PATH, asText: true }, active: true });

  assert.equal(buttons(view.contentEl).some((b) => /Open as text/.test(textOf(b))), false, 'not shown outside edit mode');
  view.editMode = true;
  view.render();
  await settle();
  const asText = buttons(view.contentEl).find((b) => /Open as text/.test(textOf(b)));
  assert.ok(asText, 'edit mode shows the button');
  assert.equal(asText.getAttribute('aria-label'), null, 'its visible name is its only name');
  await click(asText);
  assert.equal(ctx.states.pop().state.asText, true);
});

test('the file menu offers "Open as text" on a dashboard file, and nowhere else', async () => {
  const ctx = await setup();
  const offered = (path) => {
    const menu = fakeMenu();
    for (const fn of ctx.fileMenus) fn(menu, { path });
    return menu.items.find((i) => i.title === 'Open as text');
  };
  const item = offered(PATH);
  assert.ok(item, 'a dashboard file gets it');
  await item.click();
  assert.equal(ctx.states.pop().state.file, PATH);
  assert.equal(offered('notes/data.json'), undefined, 'a JSON elsewhere does not');
  assert.equal(offered('07 Databases/Dashboards/README.md'), undefined, 'a note in the folder does not');
});

/* --------------------------------------- a file that changed on disk -- */

const RENAMED = JSON.stringify(Object.assign({}, SPEC, { title: 'Shop, renamed as text' }), null, 2);

async function dashboardsView(ctx) {
  const view = ctx.plugin.viewFactories[VIEW_DASHBOARDS](ctx.leaf);
  view.app = ctx.app;
  view.leaf = ctx.leaf;
  ctx.plugin.query.cli = { ok: false, reason: 'gate' };
  await view.onOpen();
  await settle();
  return view;
}

test('the dashboards view shows a change made as text in another pane, and ignores the echo of its own save', async () => {
  const ctx = await setup();
  const view = await dashboardsView(ctx);
  assert.equal(view.specs[0].title, 'Shop');
  ctx.adapter.files.set(PATH, RENAMED);
  await ctx.fire(PATH);
  await settle();
  assert.equal(view.specs[0].title, 'Shop, renamed as text', 'reloaded from the file');

  let reloads = 0;
  const reload = view.reload.bind(view);
  view.reload = async () => { reloads++; return reload(); };
  view.specs[0].title = 'Shop, from the form';
  await view.saveAndRender(view.specs[0]);
  await ctx.fire(PATH);
  await settle();
  assert.equal(reloads, 0, 'its own save is not a change from elsewhere');
  assert.equal(JSON.parse(ctx.adapter.files.get(PATH)).title, 'Shop, from the form');
});

test('a save from the dashboards view never overwrites a change made on disk since it loaded', async () => {
  const ctx = await setup();
  const view = await dashboardsView(ctx);
  /* The form still holds the spec it opened with; the text edit lands. */
  const held = view.specs[0];
  ctx.adapter.files.set(PATH, RENAMED);
  held.title = 'Shop, from a stale form';
  notices.length = 0;
  await view.saveAndRender(held);
  await settle();
  assert.equal(ctx.adapter.files.get(PATH), RENAMED, 'the text edit survives');
  assert.ok(notices.some((n) => /changed on disk/.test(n)), 'and the member is told why nothing was saved');
  assert.equal(view.specs[0].title, 'Shop, renamed as text', 'the view now shows the file as it is');
});

test('the text editor never overwrites a file that changed on disk under it', async () => {
  const ctx = await setup();
  const view = await jsonViewAsText(ctx);
  const area = byClass(view.contentEl, 'icor-sqlv-json-editor')[0];
  area.value = JSON.stringify(Object.assign({}, SPEC, { title: 'Typed here' }));
  const fromDashboard = JSON.stringify(Object.assign({}, SPEC, { title: 'Saved by the dashboards view' }));
  ctx.adapter.files.set(PATH, fromDashboard);
  notices.length = 0;
  for (const fn of area.handlers.keydown || []) await fn({ metaKey: true, key: 's', preventDefault() {} });
  await settle();
  assert.equal(ctx.adapter.files.get(PATH), fromDashboard, 'the newer file is kept');
  assert.ok(notices.some((n) => /changed on disk/.test(n)), 'and the member is told');
  const done = buttons(view.contentEl).find((b) => b.textContent === 'Done editing');
  await click(done);
  await settle();
  assert.equal(ctx.states.length, 0, 'a refused save stays in the editor, with the typed text');
  assert.ok(byClass(view.contentEl, 'icor-sqlv-json-editor')[0], 'the editor is still open');
});

test('the text editor picks up a change on disk when nothing is typed, and leaves half-typed text unsaved on blur', async () => {
  const ctx = await setup();
  const view = await jsonViewAsText(ctx);
  ctx.adapter.files.set(PATH, RENAMED);
  await ctx.fire(PATH);
  await settle();
  const area = byClass(view.contentEl, 'icor-sqlv-json-editor')[0];
  assert.match(area.value, /renamed as text/, 'the editor shows the new text');

  area.value = '{"id": "shop", "title": "Sh';
  for (const fn of area.handlers.blur || []) await fn();
  assert.deepEqual(ctx.modified, [], 'a dashboard that does not read is not written on blur');
  assert.equal(ctx.adapter.files.get(PATH), RENAMED);
});

test('the hand-off to the dashboards view uses window.setTimeout, as the Obsidian guidelines ask', async () => {
  /* Obsidian's guideline (prefer-window-timers): a bare setTimeout is the
   * main window's. Here the sandbox has no global one, only window's. */
  const { makePlugin } = loadPlugin({ globals: { setTimeout: undefined, clearTimeout: undefined } });
  const adapter = makeFakeAdapter({ [PATH]: JSON.stringify(SPEC) });
  const app = { vault: { adapter, getFiles: () => [], read: async (f) => adapter.files.get(f.path) }, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = makePlugin(app);
  plugin.app = app;
  await plugin.onload();
  const states = [];
  const leaf = { app, view: null, setViewState: async (s) => { states.push(s); } };
  const view = plugin.viewFactories[VIEW_JSON](leaf);
  view.app = app;
  view.leaf = leaf;
  await view.setState({ file: PATH }, {});
  await view.onLoadFile({ path: PATH, name: 'shop.json', stat: { size: 10 } });
  await settle();
  assert.equal(states.length, 1, 'handed over');
  assert.equal(states[0].type, VIEW_DASHBOARDS);
});

test('clicking "Done editing" right after typing saves once and goes back, with no false "changed on disk"', async () => {
  /* A click on Done first blurs the editor (a save starts), then clicks (a
   * second save). The second must wait for the first, not race it. */
  const ctx = await setup();
  const view = await jsonViewAsText(ctx);
  const area = byClass(view.contentEl, 'icor-sqlv-json-editor')[0];
  area.value = RENAMED;
  notices.length = 0;
  const done = buttons(view.contentEl).find((b) => b.textContent === 'Done editing');
  for (const fn of area.handlers.blur || []) fn();
  for (const fn of done.handlers.click || []) fn({ preventDefault() {}, stopPropagation() {} });
  await settle();
  await settle();
  assert.equal(ctx.adapter.files.get(PATH), RENAMED, 'the typed text is saved');
  assert.equal(ctx.modified.length, 1, 'written once');
  assert.equal(notices.some((n) => /changed on disk/.test(n)), false, 'no false conflict');
  assert.equal(ctx.states.length, 1, 'handed back to the dashboard');
});
