/* Every label the widget edit panel can show, gathered by drawing the panel
 * in each of its shapes with every option group open, every field that
 * depends on another one switched on, and every picker of the built form
 * opened. Shared by the help-file gate. Every name here is invented. */

import { makeForm, walkEl, RESULTS } from './form-kit.mjs';

const LEVELS = [
  { id: 'good', name: 'Good', color: 'var(--color-green)' },
  { id: 'watch', name: 'Watch', color: 'var(--color-orange)' },
  { id: 'alert', name: 'Alert', color: 'var(--color-red)' },
];

const SCHEMA = { live: true, tables: [{ name: 'sales', columns: [{ name: 'day', type: 'TEXT' }, { name: 'channel', type: 'TEXT' }, { name: 'orders', type: 'INT' }] }] };

/* Column and table names of the invented data: the panel lists them, the
 * guide has no reason to. */
export const DATA_NAMES = new Set([
  ...Object.values(RESULTS).flatMap((r) => r.columns),
  ...SCHEMA.tables.flatMap((t) => [t.name].concat(t.columns.map((c) => c.name))),
  'shop.db',
]);

const tick = () => new Promise((r) => setTimeout(r, 0));

/* The words a member reads on one drawn form, sorted by kind. */
function harvest(root, out) {
  for (const el of walkEl(root)) {
    const cls = el.classSet || new Set();
    const attrs = el.attrs || {};
    if (cls.has('icor-sqlv-field-label')) {
      if (el.tagName === 'SPAN') out.field.add(el.textContent);
      else if (el.children && el.children[0]) out.field.add(el.children[0].textContent);
    }
    if (cls.has('icor-sqlv-advanced-toggle')) out.group.add(el.textContent.replace(/^[▾▸]\s*/, ''));
    if (cls.has('icor-sqlv-wizard-toggle')) for (const c of el.children) if (c.tagName === 'LABEL') out.check.add(c.textContent);
    if (cls.has('icor-sqlv-form-row-check')) for (const c of el.children) if (c.tagName === 'SPAN') out.check.add(c.textContent);
    if (cls.has('icor-sqlv-form-row') || cls.has('icor-sqlv-range-row')) {
      for (const c of el.children) {
        const aria = c.attrs && c.attrs['aria-label'];
        if (aria && c.tagName !== 'BUTTON' && /^[A-Z][a-z]+( [a-z]+)* \d+: /.test(aria)) out.row.add(aria.replace(/^[^:]+: /, ''));
      }
    }
    /* A built widget's name field suggests a name made from the data. */
    const suggested = attrs['aria-label'] === 'Widget name' && attrs.placeholder !== 'SQL widget';
    if (el.tagName === 'INPUT' && attrs.placeholder && !suggested) out.placeholder.add(attrs.placeholder);
    if (el.tagName === 'TEXTAREA' && attrs.placeholder) out.placeholder.add(attrs.placeholder);
    if (el.tagName === 'SELECT') for (const o of el.children) out.option.add(o.textContent);
    if (el.tagName === 'BUTTON' && el.textContent && !cls.has('icor-sqlv-advanced-toggle') && !cls.has('icor-sqlv-picker')) out.button.add(el.textContent);
    if (cls.has('icor-sqlv-wizard-row-label')) out.picker.add(el.textContent);
    if (cls.has('icor-sqlv-level-override-mark')) out.field.add(el.textContent);
  }
}

function openEverything(form, extra) {
  const s = form.state;
  for (const key of ['meter', 'axis', 'axis2', 'marks', 'band', 'notes', 'heat']) s.groups[key] = true;
  s.advancedOpen = true;
  Object.assign(s, extra || {});
}

/* The tiles, one per shape of the panel. Each is opened as an edit (so
 * "Keep as is" shows), except the last, a new widget. */
const SHAPES = [
  { tile: { title: 'Web', viz: 'line', sql: 'SELECT * FROM daily', x: 'day', y: ['web'], refLines: [{ y: 1 }], zones: [{ from: 0, to: 1, color: 'var(--color-green)' }], band: { low: 'web', high: 'shop' } },
    state: { headerDelta: true, chartCaption: 'change' } },
  { tile: { title: 'One bar', viz: 'bar', sql: 'SELECT * FROM daily', x: 'day', y: ['web'] } },
  { tile: { title: 'Two', viz: 'bar', sql: 'SELECT * FROM daily', x: 'day', y: ['web', 'shop'] } },
  { tile: { title: 'Plot', viz: 'scatter', sql: 'SELECT * FROM plot', x: 'spend', y: ['orders'], colorBy: 'channel', trend: true, xMin: 0, xMax: 100, refLines: [{ y: 1 }], zones: [{ from: 0, to: 1, color: 'var(--color-green)' }] } },
  { tile: { title: 'One colour', viz: 'scatter', sql: 'SELECT * FROM plot', x: 'spend', y: ['orders'] } },
  { tile: { title: 'Combo', viz: 'combo', sql: 'SELECT * FROM daily', x: 'day', series: [{ column: 'web', kind: 'bar' }, { column: 'shop', kind: 'bar' }, { column: 'rate', kind: 'line', axis: 'right' }], refLines: [{ y: 1 }], zones: [{ from: 0, to: 1, color: 'var(--color-green)' }] } },
  { tile: { title: 'Count', viz: 'stat', sql: 'SELECT * FROM one', y: ['n'], ranges: [{ high: 10, level: 'Good' }, { level: 'Alert' }], levelColors: { Good: '#2a7fff' }, meter: { min: 0, max: 50 } },
    state: { valueSizeCustom: true, valueSize: '40' }, levels: true },
  { tile: { title: 'Rows', viz: 'table', sql: 'SELECT * FROM one' } },
  { tile: { title: 'Tasks', viz: 'segments', sql: 'SELECT * FROM parts', x: 'status', y: ['n'], ranges: [{ high: 1, level: 'Good' }, { level: 'Alert' }], rangeColumn: 'verdict', segmentColors: { Done: 'var(--color-green)' } }, levels: true },
  { tile: { title: 'Grid', viz: 'heatmap', sql: 'SELECT * FROM grid', row: 'day', column: 'hr', value: 'minutes', marker: 'meeting', ranges: [{ high: 20, level: 'Good' }] }, levels: true },
  { tile: { title: 'Days', viz: 'calendar', sql: 'SELECT * FROM grid', date: 'day', value: 'minutes', weekStart: 'monday', year: 2025, ranges: [{ high: 20, level: 'Good' }] }, levels: true },
  { tile: { title: 'Note', viz: 'text', text: 'Words.' } },
  { tile: { viz: 'text', line: true, sql: 'SELECT * FROM words' } },
  { tile: { title: 'Part', viz: 'divider' } },
  { tile: { title: 'Orders', viz: 'line', source: { table: 'sales', metric: 'orders', agg: 'sum', filters: [{ column: 'channel', op: 'eq', value: 'Web' }], timeColumn: 'day', timeframe: 'global' }, compare: 'previous' }, built: true },
  { tile: { title: 'By channel', viz: 'bar', source: { table: 'sales', metric: 'orders', agg: 'sum', series: 'channel', filters: [{ column: 'channel', op: 'ne', value: 'x' }, { column: 'day', op: 'not_empty' }], timeColumn: 'day', timeframe: 'global' } }, built: true },
  { tile: { title: 'Total', viz: 'stat', source: { table: 'sales', metric: 'orders', agg: 'sum', filters: [], timeColumn: 'day', timeframe: 'global' } }, built: true, levels: true, pickers: true },
  { tile: null, built: true },
];

const PICKERS = ['database', 'table', 'metric', 'timeColumn', 'series', 'groupBy'];

export async function panelLabels() {
  const out = { field: new Set(), group: new Set(), button: new Set(), check: new Set(), row: new Set(), option: new Set(), placeholder: new Set(), picker: new Set() };
  for (const shape of SHAPES) {
    const { form, plugin } = await makeForm(shape.tile, { levels: shape.levels ? LEVELS : undefined });
    if (shape.built) {
      plugin.schemaFor = async () => SCHEMA;
      plugin.vaultDatabases = () => [{ path: '07 Data/shop.db', size: 1 }];
    }
    form.open();
    if (shape.tile === null) { form.state.database = '07 Data/shop.db'; form.state.table = 'sales'; }
    if (shape.built) await form.loadSchemaForEdit();
    else await form.runPreview();
    openEverything(form, shape.state);
    form.renderForm();
    harvest(form.formEl, out);
    if (shape.pickers) {
      for (const key of PICKERS) {
        form.openPicker = key;
        form.renderForm();
        await tick();
        harvest(form.formEl, out);
      }
      form.openPicker = '';
    }
  }
  for (const set of Object.values(out)) {
    for (const v of [...set]) if (DATA_NAMES.has(v) || / \(not in the result\)$/.test(v) || /^By /.test(v) || !v.trim()) set.delete(v);
  }
  return out;
}
