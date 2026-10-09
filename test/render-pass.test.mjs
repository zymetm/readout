/* SMALL RENDER-PASS FIXES.
 *
 * 1. The form's preview debounce uses window.setTimeout / window.clearTimeout
 *    (the Obsidian guideline), never the bare globals.
 * 2. A note with several widget blocks reads the dashboards folder once for
 *    the pass, not once per block; a save of a dashboard starts a fresh read.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeFakeAdapter } from './harness.mjs';

const settle = () => new Promise((r) => setTimeout(r, 20));

test('the form preview debounce schedules on window, not on the bare globals', async () => {
  const calls = [];
  const windowSpy = {
    setTimeout: (fn, ms) => { calls.push(['set', ms]); return 7; },
    clearTimeout: (h) => { calls.push(['clear', h]); },
  };
  const boom = () => { throw new Error('the bare global was used'); };
  const fresh = loadPlugin({ globals: { window: windowSpy, setTimeout: boom, clearTimeout: boom } });
  const adapter = makeFakeAdapter({}, {});
  const app = { vault: { adapter }, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  plugin.app = app;
  await plugin.onload();
  const form = new fresh.PluginClass.modals.WidgetFormModal(plugin, { saveAndRender: async () => {} }, { id: 's', title: 'S', tiles: [], path: 's.json' }, -1);
  form.debounce.bump(() => {});
  form.debounce.bump(() => {});
  form.debounce.stop();
  assert.deepEqual(calls[0], ['set', 400]);
  assert.ok(calls.some((c) => c[0] === 'clear'), 'a pending timer is cleared through window');
});

const DB = '07 Databases/shop.db';
const DASH = '07 Databases/Dashboards/sales.json';
const SALES = { id: 'sales', title: 'Sales', database: DB, tiles: [{ title: 'Note', viz: 'text', text: 'Hello.' }, { title: 'Two', viz: 'text', text: 'Again.' }] };

async function noteWithBlocks() {
  const fresh = loadPlugin();
  const adapter = makeFakeAdapter({ [DASH]: JSON.stringify(SALES) }, { [DB]: new Uint8Array([1]) });
  const app = { vault: { adapter }, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  plugin.app = app;
  await plugin.onload();
  let lists = 0;
  const origList = adapter.list.bind(adapter);
  adapter.list = async (p) => { lists++; return origList(p); };
  const draw = async (source) => {
    const el = new fresh.obsidian.Modal({}).contentEl;
    const kids = [];
    plugin.codeBlocks[fresh.lib.WIDGET_BLOCK_LANG](source, el, { addChild: (c) => kids.push(c) });
    kids[0].onload();
    await settle();
    return el;
  };
  return { plugin, draw, lists: () => lists };
}

test('three blocks in one note read the dashboards folder once', async () => {
  const { draw, lists } = await noteWithBlocks();
  await Promise.all([draw('dashboard: sales\nwidget: 1'), draw('dashboard: sales\nwidget: 2'), draw('dashboard: sales\nwidget: 1')]);
  assert.equal(lists(), 1, 'one listing for the whole pass');
});

test('saving a dashboard makes the next block read afresh', async () => {
  const { plugin, draw, lists } = await noteWithBlocks();
  await draw('dashboard: sales\nwidget: 1');
  assert.equal(lists(), 1);
  await plugin.saveDashboardSpec(Object.assign({}, SALES, { title: 'Sales 2', path: DASH }));
  const before = lists();
  await draw('dashboard: sales\nwidget: 1');
  assert.ok(lists() > before, 'the folder is read again after a save');
});
