/* Shared by the guide gates: one widget of each type with every setting
 * set, on an invented shop database. */

export const DB = '07 Databases/shop.db';

/* One widget of each type with every setting set. */
export const SINK = [
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
  { title: 'Scatter', viz: 'scatter', sql: 'SELECT 1', x: 'spend', y: ['orders'], colorBy: 'channel', trend: true, xMin: 0, xMax: 100, yMin: 0, yMax: 10, yMaxLimit: 20, yTicks: [0, 5, 10], yTickSuffix: 'u', yTickCompact: true,
    zones: [{ from: 1, to: 2, color: '#228833' }], refLines: [{ y: 5, label: 'goal' }] },
  { title: 'Segments', viz: 'segments', sql: 'SELECT 1', x: 'status', y: ['n'], segmentColors: { Done: '#228833' }, ranges: [{ level: 'Good' }], rangeColumn: 'v', levelColors: { Good: '#2a7fff' } },
  { title: 'Heatmap', viz: 'heatmap', sql: 'SELECT 1', row: 'day', column: 'hr', value: 'm', ranges: [{ level: 'Good' }], levelColors: { Good: '#2a7fff' },
    marker: 'k', markerColor: '#33bbee', markerLabel: 'k', highlight: 'weekday', columnLabelEvery: 3, cells: 'fill' },
  { title: 'Calendar', viz: 'calendar', sql: 'SELECT 1', date: 'day', value: 'm', ranges: [{ level: 'Good' }], levelColors: { Good: '#2a7fff' }, weekStart: 'monday', year: 2026 },
  { title: 'Text', viz: 'text', text: 'Words.', hint: 'h', footnote: 'f' },
  { viz: 'text', line: true, sql: 'SELECT 1', layout: { x: 0, y: 4, w: 6, h: 1 } },
];

/* Every key a value holds, at any depth (colour maps are names, not keys). */
export function keysOf(value, out) {
  if (Array.isArray(value)) { for (const v of value) keysOf(v, out); return out; }
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { out.add(k); if (!['segmentColors', 'levelColors'].includes(k)) keysOf(v, out); }
  return out;
}
