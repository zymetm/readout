/* Shared by the edit-form gates: a form on an invented shop database. */

import { loadPlugin, makeFakeAdapter } from './harness.mjs';

export function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
export function byClass(root, cls) { const out = []; for (const el of walkEl(root)) if (el.classSet && el.classSet.has(cls)) out.push(el); return out; }
export function byLabel(root, label) { for (const el of walkEl(root)) if (el.attrs && el.attrs['aria-label'] === label) return el; return null; }

/* An invented shop: what each query returns, picked by a word in it. */
export const RESULTS = {
  daily: { columns: ['day', 'web', 'shop', 'rate'], rows: [['2026-01-01', 4, 2, 5.5], ['2026-01-02', 6, 1, 7.25]] },
  parts: { columns: ['status', 'n', 'verdict'], rows: [['Done', 6, 2], ['Open', 3, 2], ['Late', 1, 2]] },
  grid: { columns: ['day', 'hr', 'minutes', 'meeting'], rows: [['Mon', '09', 30, 1], ['Mon', '10', 50, 0], ['Tue', '09', 10, 0]] },
  words: { columns: ['line'], rows: [['Data through Jan 2']] },
  one: { columns: ['n', 'basis'], rows: [[42, 'of 50']] },
  goals: { columns: ['who', 'walks', 'plan'], rows: [['Ana', 50, 60], ['Ben', 100, 80]] },
  plot: { columns: ['spend', 'orders', 'channel'], rows: [[10, 12, 'Web'], [20, 25, 'Shop'], [30, 31, 'Web']] },
};

export async function makeForm(tile, { levels } = {}) {
  const fresh = loadPlugin();
  const adapter = makeFakeAdapter({}, { '07 Data/shop.db': new Uint8Array([1]) });
  const app = { vault: { adapter, getFiles: () => [] }, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  plugin.app = app;
  await plugin.onload();
  if (levels) plugin.settings.levels = levels;
  plugin.query.engineFor = async () => ({ engine: 'cli', size: 1 });
  plugin.query.query = async (db, sql) => {
    const key = Object.keys(RESULTS).find((k) => sql.includes(k)) || 'one';
    return Object.assign({ ms: 1 }, RESULTS[key]);
  };
  const spec = { id: 'shop', title: 'Shop', database: '07 Data/shop.db', globalTimeframe: { preset: '90d' }, tiles: tile ? [tile] : [], path: 'shop.json' };
  const view = { saveAndRender: async (s) => { view.saved = s; } };
  const form = new fresh.PluginClass.modals.WidgetFormModal(plugin, view, spec, tile ? 0 : -1);
  return { form, spec, view, plugin, lib: fresh.lib };
}

/* What the dashboard file would hold for a tile: the save path's own
 * serializer, read back. */
export function asFileTile(lib, tile) {
  const json = JSON.parse(lib.specToJson({ id: 'x', title: 'X', database: '07 Data/shop.db', tiles: [tile] }));
  const t = json.tiles[0];
  delete t.layout;
  return t;
}

