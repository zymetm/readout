/* THE EDIT FORM REACHES EVERY WIDGET AND EVERY SETTING.
 *
 * Each widget type and each option family can be created and changed
 * from the edit form, so no widget needs its dashboard file edited by
 * hand. The form's last word on a widget is the dashboard parser itself
 * (checkFormTile): it can never save what the file would refuse. For an
 * SQL widget the column fields list the columns of the query's result
 * once the preview has run, and a widget still being set up runs its
 * query anyway so the lists can fill. Every table, column and value here
 * is invented for the gate.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, unwrap } from './harness.mjs';

const { lib } = loadPlugin();

import { byClass, byLabel, makeForm, asFileTile, walkEl as walk } from './form-kit.mjs';

/* ------------------------------------------------------------ helpers -- */

test('form numbers and number lists: empty is not set, anything else must read as a number', () => {
  assert.deepEqual(unwrap(lib.formNumber('', 'Lowest value')), { ok: true });
  assert.equal(lib.formNumber(' 40 ', 'Lowest value').value, 40);
  assert.match(lib.formNumber('forty', 'Lowest value').reason, /Lowest value must be a number/);
  assert.deepEqual(unwrap(lib.formNumberList('54, 70,180', 'Labels').value), [54, 70, 180]);
  assert.match(lib.formNumberList('54, x', 'Labels').reason, /numbers separated by commas/);
});

test('checkFormTile reads one widget with the dashboard parser and says "This widget" in its reasons', () => {
  const ok = lib.checkFormTile({ title: 'Orders', viz: 'stat', sql: 'SELECT 1 AS n', y: 'n', hint: ' today ' }, '07 Data/shop.db');
  assert.equal(ok.ok, true);
  assert.equal(ok.tile.hint, 'today');
  assert.equal(ok.tile.layout, undefined);
  const bad = lib.checkFormTile({ title: 'Orders', viz: 'heatmap', sql: 'SELECT 1' }, '07 Data/shop.db');
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /^This widget: a heatmap needs "row", "column" and "value"/);
});

test('after the preview runs, the X column is a list of the result\'s columns; a name not in it stays, marked', async () => {
  const { form } = await makeForm({ title: 'Web', viz: 'line', sql: 'SELECT * FROM daily', x: 'when', y: ['web'] });
  form.open();
  assert.equal(byLabel(form.formEl, 'X column').tagName, 'INPUT', 'typed until the columns are known');
  await form.runPreview();
  const select = byLabel(form.formEl, 'X column');
  assert.equal(select.tagName, 'SELECT');
  const options = select.children.map((o) => o.textContent);
  assert.deepEqual(options, ['Pick a column', 'day', 'web', 'shop', 'rate', 'when (not in the result)']);
});

test('a widget still being set up runs its query anyway, so the column lists fill', async () => {
  const { form } = await makeForm(null);
  form.open();
  form.state.mode = 'sql';
  form.state.sqlText = 'SELECT * FROM daily';
  form.state.viz = 'line';
  form.state.y = '';
  form.renderForm();
  await form.runPreview();
  assert.equal(form.previewState, 'error', 'the widget is not complete yet');
  assert.deepEqual(unwrap(form.resultColumns), ['day', 'web', 'shop', 'rate']);
  assert.equal(byLabel(form.formEl, 'X column').tagName, 'SELECT');
});

/* -------------------------------------------------------------- notes -- */

test('hint and footnote: shown, saved, cleared, on SQL and built widgets alike', async () => {
  const { form, spec } = await makeForm({ title: 'Web', viz: 'line', sql: 'SELECT * FROM daily', x: 'day', y: ['web'], hint: 'per day', footnote: 'Web orders only.' });
  form.open();
  assert.equal(byLabel(form.formEl, 'Hint by the title').value, 'per day', 'the group opens by itself when it has values');
  assert.equal(byLabel(form.formEl, 'Footnote under the widget').value, 'Web orders only.');
  form.state.hint = '';
  form.state.footnote = '  Updated nightly. ';
  form.touch();
  await form.runPreview();
  await form.save();
  assert.equal(spec.tiles[0].hint, undefined, 'a cleared hint stays cleared');
  assert.equal(spec.tiles[0].footnote, 'Updated nightly.');

  const built = await makeForm(null);
  built.form.open();
  assert.equal(byLabel(built.form.formEl, 'Hint by the title'), null, 'closed and empty until asked for');
});

test('a hint that is too long is refused in the parser\'s words', async () => {
  const { form } = await makeForm({ title: 'Web', viz: 'stat', sql: 'SELECT n FROM one', y: ['n'] });
  form.open();
  form.state.hint = 'x'.repeat(61);
  const built = form.buildTile();
  assert.equal(built.ok, false);
  assert.match(built.reason, /This widget: "hint" must be text, 60 characters at most/);
});

/* -------------------------------------------------------------- meter -- */

test('the meter: three fields on a stat, saved as the file writes it, cleared by emptying them', async () => {
  const { form, spec, lib: l } = await makeForm({ title: 'Fulfilled', viz: 'stat', sql: 'SELECT n FROM one', y: ['n'], meter: { min: 0, max: 100, target: 95 } });
  form.open();
  assert.equal(byLabel(form.formEl, 'Lowest value').value, '0');
  assert.equal(byLabel(form.formEl, 'Target').value, '95');
  form.state.meterMax = '50';
  form.state.meterTarget = '';
  form.touch();
  await form.runPreview();
  assert.equal(form.previewState, 'ok', form.previewError);
  await form.save();
  assert.deepEqual(unwrap(asFileTile(l, spec.tiles[0]).meter), { min: 0, max: 50 });

  const again = await makeForm(spec.tiles[0]);
  again.form.open();
  again.form.state.meterMin = '';
  again.form.state.meterMax = '';
  again.form.touch();
  await again.form.runPreview();
  await again.form.save();
  assert.equal(again.spec.tiles[0].meter, undefined);
});

test('a half-filled meter says what is missing; a target outside the scale is refused by the parser', async () => {
  const { form } = await makeForm({ title: 'Fulfilled', viz: 'stat', sql: 'SELECT n FROM one', y: ['n'] });
  form.open();
  form.state.meterMax = '10';
  assert.match(form.buildTile().reason, /Meter: give the lowest and the highest value/);
  form.state.meterMin = '0';
  form.state.meterTarget = '20';
  assert.match(form.buildTile().reason, /"meter" "target" must be a number from "min" to "max"/);
  form.state.viz = 'line';
  form.state.x = 'day';
  form.state.y = 'n';
  assert.equal(form.buildTile().ok, true, 'a line chart leaves the meter out instead of refusing');
});

/* --------------------------------------------------------------- axis -- */

test('the axis: range, growing top, labels, suffix, compact and label spacing, from the form to the file', async () => {
  const { form, spec, lib: l } = await makeForm(null);
  form.open();
  Object.assign(form.state, { mode: 'sql', sqlText: 'SELECT * FROM daily', viz: 'bar', x: 'day', y: 'web' });
  form.renderForm();
  await form.runPreview();
  assert.equal(byLabel(form.formEl, 'Lowest value'), null, 'the group stays closed on a new widget');
  form.state.groups.axis = true;
  form.renderForm();
  assert.ok(byLabel(form.formEl, 'Lowest value'), 'opened, its fields show');
  Object.assign(form.state, { yMin: '0', yMax: '8000', yMaxLimit: '12000', yTicks: '0, 4000, 8000', yTickSuffix: ' u', yTickCompact: true, xLabelEvery: '7' });
  form.touch();
  await form.runPreview();
  assert.equal(form.previewState, 'ok', form.previewError);
  await form.save();
  const t = asFileTile(l, spec.tiles[0]);
  assert.deepEqual(unwrap({ yMin: t.yMin, yMax: t.yMax, yMaxLimit: t.yMaxLimit, yTicks: t.yTicks, yTickSuffix: t.yTickSuffix, yTickCompact: t.yTickCompact, xLabelEvery: t.xLabelEvery }),
    { yMin: 0, yMax: 8000, yMaxLimit: 12000, yTicks: [0, 4000, 8000], yTickSuffix: 'u', yTickCompact: true, xLabelEvery: 7 });
});

test('axis fields read back into the form, refuse what the file would refuse, and leave with the chart type', async () => {
  const { form } = await makeForm({ title: 'Web', viz: 'line', sql: 'SELECT * FROM daily', x: 'day', y: ['web'], yMin: 40, yTicks: [54, 70], yTickCompact: true });
  form.open();
  assert.equal(byLabel(form.formEl, 'Labels at').value, '54, 70', 'the group opens with the widget\'s values');
  assert.equal(byLabel(form.formEl, 'Write thousands as k (8k)').checked, true);
  form.state.yMax = '30';
  assert.match(form.buildTile().reason, /"yMin" \(40\) must be below "yMax" \(30\)/);
  form.state.yMax = 'lots';
  assert.match(form.buildTile().reason, /Axis: highest value must be a number/);
  form.state.yMax = '';
  form.state.viz = 'stat';
  const asStat = form.buildTile();
  assert.equal(asStat.ok, true, asStat.reason);
  assert.equal(asStat.tile.yMin, undefined, 'a stat has no axis');
});

/* ---------------------------------------------- guide lines and zones -- */

test('guide lines and zones: rows in the form, the file shape on save, blank rows skipped', async () => {
  const { form, spec, lib: l } = await makeForm({ title: 'Revenue', viz: 'bar', sql: 'SELECT * FROM daily', x: 'day', y: ['web'],
    refLines: [{ y: 1000, label: 'break-even', dash: '4 3' }], zones: [{ from: 20, to: 30, color: 'var(--color-green)' }] });
  form.open();
  assert.equal(byLabel(form.formEl, 'Guide line 1: value').value, '1000', 'the group opens with the rows');
  assert.equal(byLabel(form.formEl, 'Guide line 1: axis'), null, 'only a combo chart has sides');
  form.state.refLines.push({ y: '', label: '', color: '', dash: '', axis: '' });
  form.state.refLines[0].color = '#c9c4b8';
  form.state.zones[0].opacity = '0.1';
  form.state.zones.push({ from: '0', to: '5', color: '#2a7fff', opacity: '', axis: '' });
  form.touch();
  await form.runPreview();
  assert.equal(form.previewState, 'ok', form.previewError);
  await form.save();
  const t = asFileTile(l, spec.tiles[0]);
  assert.deepEqual(unwrap(t.refLines), [{ y: 1000, color: '#c9c4b8', dash: '4 3', label: 'break-even' }]);
  assert.deepEqual(unwrap(t.zones), [{ from: 20, to: 30, color: 'var(--color-green)', opacity: 0.1 }, { from: 0, to: 5, color: '#2a7fff' }]);
});

test('a guide line without a value, or a zone without a colour, says so; removing every row removes them', async () => {
  const { form, spec } = await makeForm({ title: 'Revenue', viz: 'line', sql: 'SELECT * FROM daily', x: 'day', y: ['web'], refLines: [{ y: 5 }] });
  form.open();
  form.state.refLines[0].y = '';
  form.state.refLines[0].label = 'goal';
  assert.match(form.buildTile().reason, /Guide line 1 needs a value/);
  form.state.refLines.splice(0, 1);
  form.state.zones.push({ from: '1', to: '2', color: '', opacity: '', axis: '' });
  assert.match(form.buildTile().reason, /Zone 1 needs a colour/);
  form.state.zones.splice(0, 1);
  form.touch();
  await form.runPreview();
  await form.save();
  assert.equal(spec.tiles[0].refLines, undefined);
});

/* --------------------------------------------------------------- band -- */

test('the band: two column pickers and an opacity on an SQL line chart, saved as the file writes it', async () => {
  const { form, spec, lib: l } = await makeForm({ title: 'Orders', viz: 'line', sql: 'SELECT * FROM daily', x: 'day', y: ['web'] });
  form.open();
  await form.runPreview();
  form.state.groups.band = true;
  form.renderForm();
  const low = byLabel(form.formEl, 'Low edge column');
  assert.equal(low.tagName, 'SELECT', 'picked from the result');
  form.state.bandLow = 'shop';
  form.state.bandHigh = 'rate';
  form.state.bandOpacity = '0.3';
  form.touch();
  await form.runPreview();
  assert.equal(form.previewState, 'ok', form.previewError);
  await form.save();
  assert.deepEqual(unwrap(asFileTile(l, spec.tiles[0]).band), { low: 'shop', high: 'rate', opacity: 0.3 });
});

test('a band with one edge says so, a band column that is also a line is refused, and a bar chart has none', async () => {
  const { form } = await makeForm({ title: 'Orders', viz: 'line', sql: 'SELECT * FROM daily', x: 'day', y: ['web'] });
  form.open();
  form.state.bandLow = 'shop';
  assert.match(form.buildTile().reason, /Band: pick both columns/);
  form.state.bandHigh = 'web';
  assert.match(form.buildTile().reason, /cannot also be a "y" line/);
  form.state.groups.band = true;
  form.state.viz = 'bar';
  form.renderForm();
  assert.equal(byLabel(form.formEl, 'Low edge column'), null);
  assert.equal(form.buildTile().tile.band, undefined);
});

/* --------------------------------------------------------------- text -- */

test('a new text widget from the form: written words, a card with a title, hint and footnote', async () => {
  const { form, spec, lib: l } = await makeForm(null);
  form.open();
  const addText = [...form.formEl.children].find((b) => b.textContent === 'Add text instead');
  assert.ok(addText, 'offered on a new widget');
  for (const fn of addText.handlers.click) fn();
  assert.equal(form.state.mode, 'text');
  assert.ok(byLabel(form.formEl, 'Text of the widget'));
  Object.assign(form.state, { textBody: 'Every number here is invented.\n\nSecond paragraph.', title: 'About', hint: 'read me', sizeKey: 'medium' });
  form.touch();
  await form.runPreview();
  assert.equal(form.previewState, 'ok', form.previewError);
  assert.ok(byClass(form.previewEl, 'is-text').length, 'the preview draws the words');
  await form.save();
  assert.deepEqual(unwrap(asFileTile(l, spec.tiles[0])), { title: 'About', viz: 'text', hint: 'read me', text: 'Every number here is invented.\n\nSecond paragraph.' });
});

test('a text line from a query: one thin row, full width, no title; it reads back into the form', async () => {
  const { form, spec, lib: l } = await makeForm(null);
  form.open();
  form.toText();
  Object.assign(form.state, { textFrom: 'sql', sqlText: "SELECT 'Data through ' || day FROM words", textLine: true, title: 'ignored' });
  form.renderForm();
  assert.equal(byLabel(form.formEl, 'Title'), null, 'a line has no title');
  form.touch();
  await form.runPreview();
  assert.equal(form.previewState, 'ok', form.previewError);
  await form.save();
  const t = asFileTile(l, spec.tiles[0]);
  assert.deepEqual(unwrap(t), { viz: 'text', sql: "SELECT 'Data through ' || day FROM words", line: true });
  assert.deepEqual(unwrap(spec.tiles[0].layout), { x: 0, y: 0, w: 6, h: 1 });

  const again = await makeForm(spec.tiles[0]);
  again.form.open();
  assert.equal(again.form.state.mode, 'text');
  assert.equal(again.form.state.textFrom, 'sql');
  assert.equal(again.form.state.textLine, true);
  assert.equal(byLabel(again.form.formEl, 'SQL query').value, "SELECT 'Data through ' || day FROM words");
});

test('the SQL form offers Text in its chart types; empty words say so', async () => {
  const { form } = await makeForm({ title: 'Web', viz: 'line', sql: 'SELECT * FROM daily', x: 'day', y: ['web'] });
  form.open();
  const type = byLabel(form.formEl, 'Chart type');
  assert.ok(type.children.some((o) => o.value === 'text'));
  form.toText();
  assert.equal(form.state.textFrom, 'sql', 'the query comes along');
  form.state.textFrom = 'text';
  assert.match(form.buildTile().reason, /Write the text first/);
});

/* ----------------------------------------------------------- segments -- */

const SEG_TARGET = {
  title: 'Tasks', viz: 'segments', unit: '%', footnote: 'Done counts closed tasks only.',
  ranges: [{ low: 2, level: 'Good', label: 'on track' }, { level: 'Alert', label: 'behind' }],
  rangeColumn: 'verdict', levelColors: { Good: '#2a7fff' },
  segmentColors: { Done: 'var(--color-green)', Late: '#d08080' },
  sql: 'SELECT status, n, verdict FROM parts', x: 'status', y: ['n'],
};

test('a segments bar built from a blank widget in the form matches the hand-written one field for field', async () => {
  const { form, spec, lib: l } = await makeForm(null);
  form.open();
  const sqlBtn = [...form.formEl.children].find((b) => b.textContent === 'Write SQL instead');
  for (const fn of sqlBtn.handlers.click) fn();
  Object.assign(form.state, { sqlText: SEG_TARGET.sql, viz: 'segments', title: 'Tasks', unit: '%', sizeKey: 'medium' });
  form.renderForm();
  await form.runPreview();
  assert.equal(byLabel(form.formEl, 'Part name column').tagName, 'SELECT', 'the columns come from the preview');
  form.state.x = 'status';
  form.state.y = 'n';
  form.renderForm();
  await form.runPreview();
  const fill = [...walk(form.formEl)].find((b) => b.textContent === '+ A row for each part in the preview');
  for (const fn of fill.handlers.click) fn();
  assert.deepEqual(unwrap(form.state.segmentColors.map((r) => r.name)), ['Done', 'Open', 'Late']);
  form.state.segmentColors[0].color = 'var(--color-green)';
  form.state.segmentColors[2].color = '#d08080';
  form.state.ranges = [{ low: '2', high: '', level: 'Good', label: 'on track' }, { low: '', high: '', level: 'Alert', label: 'behind' }];
  form.state.levelColors = { Good: '#2a7fff' };
  form.state.rangeColumn = 'verdict';
  form.state.footnote = 'Done counts closed tasks only.';
  form.touch();
  await form.runPreview();
  assert.equal(form.previewState, 'ok', form.previewError);
  assert.ok(byClass(form.previewEl, 'icor-sqlv-level-pill').length, 'the preview draws the pill');
  await form.save();
  assert.deepEqual(unwrap(asFileTile(l, spec.tiles[0])), unwrap(asFileTile(l, l.parseDashboardSpec(JSON.stringify({ id: 'x', title: 'X', database: '07 Data/shop.db', tiles: [SEG_TARGET] })).spec.tiles[0])));
});

test('a segments bar with ranges but no judged column says so; it reads back into the form with its pencil', async () => {
  const parsed = lib.parseDashboardSpec(JSON.stringify({ id: 'x', title: 'X', database: '07 Data/shop.db', tiles: [SEG_TARGET] })).spec.tiles[0];
  const { form } = await makeForm(parsed);
  form.open();
  assert.equal(form.state.mode, 'sql');
  assert.equal(form.state.segmentColors.length, 2);
  assert.equal(form.state.ranges.length, 2);
  form.state.rangeColumn = '';
  assert.match(form.buildTile().reason, /need a "rangeColumn" to judge/);
  assert.equal(lib.FORM_VIZ.has('segments'), true);
});

/* ------------------------------------------------------------ heatmap -- */

const HEAT_TARGET = {
  title: 'Minutes by hour', viz: 'heatmap', unit: 'min', hint: 'busiest hours',
  ranges: [{ high: 20, level: 'Good', label: 'light' }, { low: 21, high: 45, level: 'Watch' }, { level: 'Alert', label: 'heavy' }],
  levelColors: { Watch: '#a08040' },
  sql: 'SELECT day, hr, minutes, meeting FROM grid', row: 'day', column: 'hr', value: 'minutes',
  marker: 'meeting', markerColor: '#5af8ff', markerLabel: 'meeting booked', highlight: 'hour', columnLabelEvery: 3,
};

test('a heatmap built from a blank widget in the form matches the hand-written one field for field', async () => {
  const { form, spec, lib: l } = await makeForm(null);
  form.open();
  Object.assign(form.state, { mode: 'sql', sqlText: HEAT_TARGET.sql, viz: 'heatmap', title: 'Minutes by hour', unit: 'min', sizeKey: 'wide' });
  form.renderForm();
  await form.runPreview();
  assert.equal(form.previewState, 'error', 'not complete without its columns');
  for (const label of ['Row column', 'Column column', 'Value column']) assert.equal(byLabel(form.formEl, label).tagName, 'SELECT', label + ' is a picker');
  Object.assign(form.state, { heatRow: 'day', heatColumn: 'hr', heatValue: 'minutes' });
  form.state.groups.heat = true;
  form.renderForm();
  assert.equal(byLabel(form.formEl, 'Dot column').tagName, 'SELECT');
  Object.assign(form.state, { heatMarker: 'meeting', heatMarkerColor: '#5af8ff', heatMarkerLabel: 'meeting booked', heatHighlight: 'hour', heatColumnLabelEvery: '3', hint: 'busiest hours' });
  form.state.ranges = [{ low: '', high: '20', level: 'Good', label: 'light' }, { low: '21', high: '45', level: 'Watch', label: '' }, { low: '', high: '', level: 'Alert', label: 'heavy' }];
  form.state.levelColors = { Watch: '#a08040' };
  form.touch();
  await form.runPreview();
  assert.equal(form.previewState, 'ok', form.previewError);
  assert.ok(byClass(form.previewEl, 'icor-sqlv-heatmap-cell').length, 'the preview draws the grid');
  await form.save();
  const want = l.parseDashboardSpec(JSON.stringify({ id: 'x', title: 'X', database: '07 Data/shop.db', tiles: [HEAT_TARGET] })).spec.tiles[0];
  assert.deepEqual(unwrap(asFileTile(l, spec.tiles[0])), unwrap(asFileTile(l, want)));
});

test('a heatmap reads back into the form; a dot colour without a dot column cannot be left behind', async () => {
  const parsed = lib.parseDashboardSpec(JSON.stringify({ id: 'x', title: 'X', database: '07 Data/shop.db', tiles: [HEAT_TARGET] })).spec.tiles[0];
  const { form } = await makeForm(parsed);
  form.open();
  assert.equal(form.state.heatRow, 'day');
  assert.equal(form.state.heatColumnLabelEvery, '3');
  assert.equal(byLabel(form.formEl, 'Dot label in the legend').value, 'meeting booked', 'the group opens with its values');
  form.state.heatMarker = '';
  assert.match(form.buildTile().reason, /"markerColor" and "markerLabel" need a "marker" column/);
  assert.equal(lib.FORM_VIZ.has('heatmap'), true);
});

/* -------------------------------------------------------------- combo -- */

const COMBO_TARGET = {
  title: 'Orders and returns', viz: 'combo', unit: 'orders', stack: true,
  hint: 'by channel', footnote: 'Bars: orders by channel. Dashed line: return rate (right axis).',
  guideColor: '#cccccc', yMin: 0, yTickCompact: true,
  refLines: [{ y: 5, color: '#c9c4b8', dash: '4 3', label: 'daily goal' }],
  sql: 'SELECT day, web, shop, rate FROM daily', x: 'day',
  series: [
    { column: 'web', kind: 'bar', color: '#e7bc82', label: 'Web' },
    { column: 'shop', kind: 'bar', color: '#b26d3a', label: 'Shop', opacity: 0.5 },
    { column: 'rate', kind: 'line', axis: 'right', color: '#75ef9c', dash: '5 3', connect: true, label: 'Return rate (%)' },
  ],
  y2Min: 0, y2Max: 20, y2TickSuffix: '%', y2Unit: '%',
};

test('a combo chart built from a blank widget in the form matches the hand-written one field for field', async () => {
  const { form, spec, lib: l } = await makeForm(null);
  form.open();
  Object.assign(form.state, { mode: 'sql', sqlText: COMBO_TARGET.sql, viz: 'combo', title: 'Orders and returns', unit: 'orders', x: '', y: '', sizeKey: 'wide' });
  form.renderForm();
  await form.runPreview();
  assert.match(form.previewError, /needs an "x" column for a combo chart|needs a column|needs "series"/);
  form.state.x = 'day';
  const add = () => { const b = [...walk(form.formEl)].find((e) => e.textContent === '+ Add series'); for (const fn of b.handlers.click) fn(); };
  add(); add(); add();
  assert.equal(byLabel(form.formEl, 'Series 1: column').tagName, 'SELECT', 'series columns come from the result');
  assert.equal(byLabel(form.formEl, 'Series 1: dash'), null, 'a bar has no dash');
  Object.assign(form.state.comboSeries[0], { column: 'web', kind: 'bar', color: '#e7bc82', label: 'Web' });
  Object.assign(form.state.comboSeries[1], { column: 'shop', kind: 'bar', color: '#b26d3a', label: 'Shop', opacity: '0.5' });
  Object.assign(form.state.comboSeries[2], { column: 'rate', kind: 'line', axis: 'right', color: '#75ef9c', dash: '5 3', connect: true, label: 'Return rate (%)' });
  form.renderForm();
  assert.ok(byLabel(form.formEl, 'Stack the bars on top of each other'), 'two bars offer stacking');
  Object.assign(form.state, { stack: true, guideColor: '#cccccc', yMin: '0', yTickCompact: true, y2Min: '0', y2Max: '20', y2TickSuffix: '%', y2Unit: '%',
    hint: 'by channel', footnote: 'Bars: orders by channel. Dashed line: return rate (right axis).' });
  form.state.refLines = [{ y: '5', label: 'daily goal', color: '#c9c4b8', dash: '4 3', axis: '' }];
  form.touch();
  await form.runPreview();
  assert.equal(form.previewState, 'ok', form.previewError);
  await form.save();
  const want = l.parseDashboardSpec(JSON.stringify({ id: 'x', title: 'X', database: '07 Data/shop.db', tiles: [COMBO_TARGET] })).spec.tiles[0];
  assert.deepEqual(unwrap(asFileTile(l, spec.tiles[0])), unwrap(asFileTile(l, want)));
});

test('a combo reads back into the form with its series and right axis; stacked bars on two sides are refused', async () => {
  const parsed = lib.parseDashboardSpec(JSON.stringify({ id: 'x', title: 'X', database: '07 Data/shop.db', tiles: [COMBO_TARGET] })).spec.tiles[0];
  const { form } = await makeForm(parsed);
  form.open();
  assert.equal(form.state.comboSeries.length, 3);
  assert.equal(form.state.comboSeries[2].connect, true);
  assert.equal(byLabel(form.formEl, 'Right axis: Highest value').value, '20', 'the right axis group opens with its values');
  assert.equal(byLabel(form.formEl, 'Colour of the line that follows the pointer').children.find((o) => o.selected).value, 'custom');
  form.state.comboSeries[1].axis = 'right';
  assert.match(form.buildTile().reason, /every bar series must be on the same axis/);
  assert.equal(lib.FORM_VIZ.has('combo'), true);
  assert.deepEqual(unwrap(lib.keepUneditedKeys({ viz: 'line' }, { viz: 'line', yMin: 1, zones: [], band: {}, hint: 'h', meter: {} })), { viz: 'line' }, 'every setting has a field now, so none is kept behind the form');
});

test('an SQL bar chart with two or more y columns offers stacking, and saves it', async () => {
  const { form, spec } = await makeForm({ title: 'Orders', viz: 'bar', sql: 'SELECT * FROM daily', x: 'day', y: ['web'] });
  form.open();
  assert.equal(byLabel(form.formEl, 'Stack the bars on top of each other'), null);
  form.state.y = 'web, shop';
  form.renderForm();
  assert.ok(byLabel(form.formEl, 'Stack the bars on top of each other'));
  form.state.stack = true;
  form.touch();
  await form.runPreview();
  await form.save();
  assert.equal(spec.tiles[0].stack, true);
});
