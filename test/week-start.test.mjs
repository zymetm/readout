/* ONE "WEEK STARTS ON" SETTING FOR EVERY CALENDAR.
 *
 * A calendar widget could already say "weekStart": "monday" for itself.
 * The plugin now has a "Week starts on" setting (Sunday or Monday) that
 * every calendar follows unless it names its own: the widget wins, the
 * setting is the default, and Sunday stays the default of the setting so
 * nothing moves for anyone who never opens it. These gates pin the rule
 * in the pure grid, in the drawn calendar, in the settings and on the
 * edit form. Every value here is invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeFakeAdapter, unwrap } from './harness.mjs';
import { makeForm, byLabel, asFileTile } from './form-kit.mjs';

const { lib, obsidian } = loadPlugin();

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byClass = (root, cls) => [...walkEl(root)].filter((e) => e.classSet && e.classSet.has(cls));
/* 2026-01-18 is a Sunday. */
const TABLE = { columns: ['day', 'walks'], rows: [['2026-01-18', 25], ['2026-01-17', 12], ['2026-01-13', 4]] };
const TILE = { viz: 'calendar', date: 'day', value: 'walks' };
const startOf = (tile, def) => lib.calendarOf(TABLE, Object.assign({}, TILE, tile), def).startDay;

test('the setting is the default, the widget\'s own weekStart wins, and nothing set means Sunday', () => {
  assert.equal(startOf({}), 0, 'no setting, no widget value: Sunday, as before');
  assert.equal(startOf({}, 'sunday'), 0);
  assert.equal(startOf({}, 'monday'), 1, 'the setting reaches a calendar that names nothing');
  assert.equal(startOf({ weekStart: 'sunday' }, 'monday'), 0, 'a widget that says Sunday keeps Sunday');
  assert.equal(startOf({ weekStart: 'monday' }, 'sunday'), 1, 'a widget that says Monday keeps Monday');
  assert.equal(lib.DEFAULT_SETTINGS.weekStart, 'sunday');
});

test('a drawn calendar follows the setting: the weekday names move down with the first row', () => {
  const rowOfMon = (extras, tile) => {
    const el = new obsidian.Modal({}).contentEl;
    lib.renderTile(el, Object.assign({}, TILE, tile), TABLE, extras);
    const mon = byClass(el, 'icor-sqlv-calendar-day').find((d) => d.textContent === 'Mon');
    return mon.style['grid-row'];
  };
  assert.equal(rowOfMon({}), '3', 'Sunday first: Monday is the second row (grid row 3 under the month labels)');
  assert.equal(rowOfMon({ weekStart: 'monday' }), '2', 'Monday first: Monday is the top row');
  assert.equal(rowOfMon({ weekStart: 'monday' }, { weekStart: 'sunday' }), '3', 'the widget overrides the setting');
});

test('the plugin keeps the setting, offers it to every render and repairs a bad value', async () => {
  const make = async (saved) => {
    const fresh = loadPlugin();
    const adapter = makeFakeAdapter();
    const app = { vault: { adapter, getFiles: () => [] }, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
    const plugin = fresh.makePlugin(app, saved);
    plugin.app = app;
    await plugin.onload();
    return plugin;
  };
  assert.equal((await make(null)).settings.weekStart, 'sunday', 'a vault that never set it');
  const monday = await make({ weekStart: 'monday' });
  assert.equal(monday.settings.weekStart, 'monday');
  assert.equal(monday.levelExtras().weekStart, 'monday', 'every tile render gets it with the levels');
  assert.equal((await make({ weekStart: 'friday' })).settings.weekStart, 'sunday', 'a value that is not a day of the choice falls back');
  assert.equal((await make({ pageSize: 20 })).settings.weekStart, 'sunday', 'settings saved before the setting existed');
});

test('the edit form leaves "Week starts on" to the setting unless the widget picks a day', async () => {
  const tile = lib.parseDashboardSpec(JSON.stringify({ id: 'x', title: 'X', database: '07 Data/shop.db', tiles: [Object.assign({ title: 'Walks', sql: 'SELECT daily' }, TILE)] })).spec.tiles[0];
  const { form, spec, lib: l } = await makeForm(tile);
  form.open();
  assert.equal(form.state.calWeekStart, '', 'a widget with no weekStart reads back as "the plugin setting"');
  const select = byLabel(form.formEl, 'Week starts on');
  assert.ok(select, 'the field is there');
  const options = [...walkEl(select)].filter((e) => e.tagName === 'OPTION').map((o) => o.textContent);
  assert.deepEqual(options, ['The plugin setting (default)', 'Sunday', 'Monday']);
  await form.runPreview();
  await form.save();
  assert.equal(asFileTile(l, spec.tiles[0]).weekStart, undefined, 'saved without a weekStart, so the setting rules');
  form.state.calWeekStart = 'sunday';
  const built = form.buildTile();
  assert.equal(built.tile.weekStart, 'sunday', 'a picked Sunday is kept as the widget\'s own');
  void unwrap;
});
