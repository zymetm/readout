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
 * in: the dashboards pane's "More options" menu, an "As text" button in
 * edit mode, and the file menu of a dashboard file.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeFakeAdapter } from './harness.mjs';

const VIEW_JSON = 'icor-sqlite-viewer-json';
const VIEW_DASHBOARDS = 'icor-sqlite-viewer-dashboards';
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
  const app = {
    vault: {
      adapter,
      getFiles: () => [],
      read: async (f) => adapter.files.get(f.path),
      modify: async (f, text) => { adapter.files.set(f.path, text); modified.push(f.path); },
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
  return { plugin, app, adapter, leaf, states, fileMenus, modified };
}

async function jsonViewAsText(ctx) {
  const view = ctx.plugin.viewFactories[VIEW_JSON](ctx.leaf);
  view.app = ctx.app;
  view.leaf = ctx.leaf;
  const file = { path: PATH, name: 'shop.json', stat: { size: ctx.adapter.files.get(PATH).length } };
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
  const item = menu.items.find((i) => i.title === 'Open dashboard file as text');
  assert.ok(item, 'the pane menu offers it');
  await item.click();
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.states.pop())), { type: VIEW_JSON, state: { file: PATH, asText: true }, active: true });

  assert.equal(buttons(view.contentEl).some((b) => /As text/.test(textOf(b))), false, 'not shown outside edit mode');
  view.editMode = true;
  view.render();
  await settle();
  const asText = buttons(view.contentEl).find((b) => /As text/.test(textOf(b)));
  assert.ok(asText, 'edit mode shows the button');
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
