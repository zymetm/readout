/* THE DASHBOARD GUIDE KEEPS UP WITH THE PLUGIN.
 *
 * The plugin writes a README.md into the dashboards folder; it listed four
 * widget types and none of the settings added since. The guide now
 * documents every type and every setting, with examples on an invented
 * shop database, and the repository README carries the same reference.
 * These gates keep it true: every widget type is named; every setting the
 * plugin writes back to a file appears in it (a widget of each type with
 * every setting set, sent through the save path's serializer); every
 * example in it reads as a valid widget; and the repository README's
 * reference is the same text.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadPlugin } from './harness.mjs';

const { lib } = loadPlugin();
const GUIDE = lib.DASHBOARD_README;
const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const DB = '07 Databases/shop.db';

const named = (key) => GUIDE.includes('`' + key + '`') || GUIDE.includes('"' + key + '"');

/* One widget of each type with every setting set. */
const SINK = [
  { title: 'Line', viz: 'line', unit: 'u', hint: 'h', footnote: 'f', sql: 'SELECT 1', x: 'day', y: ['avg'], color: '#2a7fff', guideColor: '#aaaaaa',
    headerDelta: true, headerDeltaAverageDays: 3, chartCaption: 'range', yMin: 0, yMax: 10, yMaxLimit: 20, yTicks: [0, 5, 10], xLabelEvery: 2, yTickSuffix: 'u', yTickCompact: true,
    zones: [{ from: 1, to: 2, color: '#228833', opacity: 0.2 }], refLines: [{ y: 5, color: '#bbbbbb', dash: '4 3', label: 'goal' }], band: { low: 'lo', high: 'hi', opacity: 0.2 }, layout: { x: 0, y: 0, w: 2, h: 2 } },
  { title: 'Bar', viz: 'bar', stack: true, sql: 'SELECT 1', x: 'day', y: ['a', 'b'] },
  { title: 'Built', viz: 'bar', compare: 'previous', favorable: 'down', source: { table: 'sales', metric: 'orders', agg: 'sum', filters: [{ column: 'channel', op: 'eq', value: 'Web' }], timeColumn: 'day', timeframe: 'global', database: DB } },
  { title: 'Split', viz: 'line', source: { table: 'sales', metric: 'orders', agg: 'avg', series: 'channel', groupBy: 'day' } },
  { title: 'Stat', viz: 'stat', sql: 'SELECT 1', y: ['v'], valueSize: 'fit', meter: { min: 0, max: 10, target: 5 }, captions: ['c'],
    ranges: [{ low: 0, high: 5, level: 'Good', label: 'ok' }, { level: 'Alert' }], levelColors: { Good: '#2a7fff' }, rangeColumn: 'r' },
  { title: 'Table', viz: 'table', sql: 'SELECT 1' },
  { title: 'Divider', viz: 'divider' },
  { title: 'Combo', viz: 'combo', sql: 'SELECT 1', x: 'day', stack: true,
    series: [{ column: 'a', kind: 'bar', axis: 'left', color: '#2a7fff', opacity: 0.5, label: 'A' }, { column: 'b', kind: 'line', axis: 'right', dash: '4 3', connect: true }],
    y2Min: 0, y2Max: 10, y2MaxLimit: 20, y2Ticks: [0, 10], y2TickSuffix: '%', y2TickCompact: true, y2Unit: '%',
    refLines: [{ y: 1, axis: 'right' }], zones: [{ from: 0, to: 1, color: '#228833', axis: 'right' }] },
  { title: 'Segments', viz: 'segments', sql: 'SELECT 1', x: 'status', y: ['n'], segmentColors: { Done: '#228833' }, ranges: [{ level: 'Good' }], rangeColumn: 'v', levelColors: { Good: '#2a7fff' } },
  { title: 'Heatmap', viz: 'heatmap', sql: 'SELECT 1', row: 'day', column: 'hr', value: 'm', ranges: [{ level: 'Good' }], levelColors: { Good: '#2a7fff' },
    marker: 'k', markerColor: '#33bbee', markerLabel: 'k', highlight: 'weekday', columnLabelEvery: 3, cells: 'fill' },
  { title: 'Text', viz: 'text', text: 'Words.', hint: 'h', footnote: 'f' },
  { viz: 'text', line: true, sql: 'SELECT 1', layout: { x: 0, y: 4, w: 6, h: 1 } },
];

function keysOf(value, out) {
  if (Array.isArray(value)) { for (const v of value) keysOf(v, out); return out; }
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { out.add(k); if (!['segmentColors', 'levelColors'].includes(k)) keysOf(v, out); }
  return out;
}

test('the guide names every widget type', () => {
  for (const viz of lib.VIZ_KINDS) assert.ok(GUIDE.includes('`' + viz + '`') || GUIDE.includes('"viz": "' + viz + '"'), viz);
});

test('every setting the plugin writes back to a dashboard file appears in the guide', () => {
  const spec = { id: 'sink', title: 'Sink', database: DB, globalTimeframe: { preset: '90d' }, tiles: SINK };
  const parsed = lib.parseDashboardSpec(JSON.stringify(spec));
  assert.equal(parsed.ok, true, parsed.reason);
  const written = JSON.parse(lib.specToJson(parsed.spec));
  const keys = keysOf(written, new Set());
  const missing = [...keys].filter((k) => !named(k));
  assert.deepEqual(missing, [], 'documented: ' + missing.join(', '));
  assert.ok(keys.size > 70, 'the sink reaches the settings (' + keys.size + ')');
});

test('every example in the guide reads as a valid widget or dashboard', () => {
  const blocks = [...GUIDE.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 8);
  let tiles = 0;
  for (const block of blocks) {
    const objects = block.split(/\n(?=\{)/).map((b) => b.trim()).filter(Boolean);
    for (const text of objects) {
      const raw = JSON.parse(text);
      const spec = raw.tiles ? raw : { id: 'ex', title: 'Example', database: DB, tiles: [raw] };
      const parsed = lib.parseDashboardSpec(JSON.stringify(spec));
      assert.equal(parsed.ok, true, (parsed.reason || '') + ' in ' + text.slice(0, 60));
      tiles += spec.tiles.length;
    }
  }
  assert.ok(tiles >= 9);
});

test('the guide says the text widget is plain text and where the levels live', () => {
  assert.match(GUIDE, /Plain text, not Markdown/);
  assert.match(GUIDE, /levels themselves[^.]*live in the plugin settings/);
  assert.match(GUIDE, /shared with someone else needs its levels in their settings too/);
});

test('the repository README carries the same field reference', () => {
  const block = (text) => {
    const a = text.indexOf('<!-- field reference -->');
    const b = text.indexOf('<!-- /field reference -->');
    assert.ok(a >= 0 && b > a, 'the reference is marked');
    return text.slice(a, b).replace(/^#+ /gm, '# ');
  };
  assert.equal(block(README), block(GUIDE));
});
