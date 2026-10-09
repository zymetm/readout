/* THE FORM SAYS WHAT A SAVE WOULD LEAVE OUT.
 *
 * Saving from the edit form rebuilds the widget from the form's fields.
 * When the chart type changes, settings the new type cannot carry are
 * left out (a line chart has no value levels), and until now that
 * happened without a word. The form now lists them beside the preview,
 * by their names in the dashboard file, before the save; the save itself
 * is unchanged. The widget's frame (type, query, columns, name, unit,
 * place) is the form's own and never listed. Every value here is
 * invented for the gate.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, unwrap, makeFakeAdapter } from './harness.mjs';

const { lib } = loadPlugin();

const RANGES = [{ high: 10, level: 'Good' }, { level: 'Alert' }];

async function makeForm(tile) {
  const fresh = loadPlugin();
  const adapter = makeFakeAdapter({}, { '07 Databases/shop.db': new Uint8Array([1]) });
  const app = { vault: { adapter }, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  plugin.app = app;
  await plugin.onload();
  plugin.query.engineFor = async () => ({ engine: 'cli', size: 1 });
  plugin.query.query = async () => ({ columns: ['day', 'value'], rows: [['2026-01-01', 4], ['2026-01-02', 6]], ms: 1 });
  const spec = { id: 'shop', title: 'Shop', database: '07 Databases/shop.db', globalTimeframe: { preset: '90d' }, tiles: [tile], path: 'shop.json' };
  const view = { saveAndRender: async (s) => { view.saved = s; } };
  const form = new fresh.PluginClass.modals.WidgetFormModal(plugin, view, spec, 0);
  return { form, spec };
}

test('droppedSettings lists the settings the saved widget no longer carries, never its frame', () => {
  const existing = { title: 'Orders', viz: 'stat', sql: 'SELECT 1', y: ['n'], unit: '', layout: { x: 0, y: 0, w: 1, h: 1 }, ranges: RANGES, levelColors: { Good: '#2a7fff' } };
  assert.deepEqual(unwrap(lib.droppedSettings(existing, { title: 'Orders', viz: 'line', sql: 'SELECT 1', x: 'day', y: ['n'] })), ['ranges', 'levelColors']);
  assert.deepEqual(unwrap(lib.droppedSettings(existing, Object.assign({}, existing))), []);
  assert.deepEqual(unwrap(lib.droppedSettings(null, existing)), [], 'a new widget drops nothing');
});

test('changing a stat with value levels to a line chart says the levels are left out, before the save', async () => {
  const parsed = lib.parseDashboardSpec(JSON.stringify({ id: 'shop', title: 'Shop', database: '07 Databases/shop.db', tiles: [{ title: 'Orders', viz: 'stat', sql: 'SELECT day, value FROM t', y: 'value', ranges: RANGES }] }));
  assert.equal(parsed.ok, true, parsed.reason);
  const { form, spec } = await makeForm(parsed.spec.tiles[0]);
  form.open();
  await form.runPreview();
  assert.equal(form.dropNote.textContent, '', 'nothing is left out while the type stays');

  form.state.viz = 'line';
  form.state.x = 'day';
  form.state.y = 'value';
  form.touch();
  await form.runPreview();
  assert.match(form.dropNote.textContent, /line chart leaves out what this widget had: ranges/);
  assert.match(form.dropNote.textContent, /Change the type back/);

  form.state.viz = 'stat';
  form.touch();
  await form.runPreview();
  assert.equal(form.dropNote.textContent, '', 'back to a stat, nothing is left out');

  form.state.viz = 'line';
  form.touch();
  await form.runPreview();
  await form.save();
  assert.equal(spec.tiles[0].viz, 'line');
  assert.equal(spec.tiles[0].ranges, undefined, 'the save itself is unchanged');
});
