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

import { byClass, byLabel, makeForm } from './form-kit.mjs';

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
