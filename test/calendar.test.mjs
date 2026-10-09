/* A YEAR CALENDAR: ONE SQUARE FOR EACH DAY, COLOURED BY VALUE LEVELS.
 *
 * A heatmap places cells by two labels the query names; a year of days
 * wants one date column and the shape of a calendar: a week to a column,
 * the days of the week down the side, the months along the top, the way a
 * contribution graph reads. "viz": "calendar" reads a "date" column and a
 * "value" column, colours each day by the value levels of "ranges", shows
 * the last 53 weeks up to the newest day in the data (or a whole "year"),
 * and starts its weeks on "sunday" or "monday". These gates pin the rules:
 * the grid is the right shape for a known week and year, in either week
 * start; it ends at the data's own end, never today; a day with no row is
 * empty and a day written twice takes the later row; colours, labels,
 * hover text and legend follow the data; the spec refuses what makes no
 * sense, in plain words; it survives the spec file; the edit form builds
 * and reads back every setting. Every value here is invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { loadPlugin, unwrap } from './harness.mjs';
import { byLabel, makeForm, asFileTile } from './form-kit.mjs';

const { lib, obsidian } = loadPlugin();

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byClass = (root, cls) => [...walkEl(root)].filter((e) => e.classSet && e.classSet.has(cls));
const freshEl = () => new obsidian.Modal({}).contentEl;
const parse = (tile) => lib.parseDashboardSpec(JSON.stringify({ id: 'cal', title: 'Calendar', database: '07 Databases/x.db', tiles: [tile] }));
const RANGES = [{ high: 9, level: 'Cool', label: 'quiet' }, { low: 10, high: 19, level: 'Mild', label: 'steady' }, { level: 'Hot', label: 'busy' }];
const LEVELS = [{ id: 'cool', name: 'Cool', color: '#3366cc' }, { id: 'mild', name: 'Mild', color: '#88aa44' }, { id: 'hot', name: 'Hot', color: '#cc5533' }];
const calTile = (extra) => Object.assign({ title: 'Walks per day', viz: 'calendar', date: 'day', value: 'walks', unit: 'walks', ranges: RANGES, sql: 'SELECT 1' }, extra);
/* 2026-01-18 is a Sunday. */
const TABLE = {
  columns: ['day', 'walks'],
  rows: [['2026-01-18', 25], ['2026-01-17', 12], ['2026-01-16', null], ['2026-01-15 07:30:00', 3], ['2026-01-14', 'x'], ['2026-01-13', 4], ['2026-01-13', 15], ['not a day', 9], ['2026-02-30', 9], ['2025-12-25', 30]],
};

function draw(tile, table, extras) {
  const el = freshEl();
  lib.renderTile(el, parse(tile).spec.tiles[0], table || TABLE, extras || { levels: LEVELS });
  return el;
}
const cells = (el) => byClass(el, 'icor-sqlv-calendar-cell');
const cellFor = (el, iso) => cells(el).find((c) => c.getAttribute('title').startsWith(iso + ' '));

test('THE LIMIT: no other widget draws a calendar', () => {
  const el = freshEl();
  lib.renderTile(el, { viz: 'heatmap', row: 'day', column: 'walks', value: 'walks' }, TABLE, {});
  assert.equal(cells(el).length, 0);
});

/* ------------------------------------------------------------ the days -- */

test('a day is written 2026-01-31, with or without a time; anything else is not a day', () => {
  assert.equal(lib.calendarDayOf('2026-01-31'), Date.UTC(2026, 0, 31));
  assert.equal(lib.calendarDayOf(' 2026-01-31 08:15:00 '), Date.UTC(2026, 0, 31));
  assert.equal(lib.calendarDayOf('2026-01-31T08:15:00Z'), Date.UTC(2026, 0, 31));
  for (const bad of ['2026-02-30', '2026-13-01', 'Jan 3', '31/01/2026', '', null, undefined, 20260131, '0999-01-01']) assert.ok(Number.isNaN(lib.calendarDayOf(bad)), String(bad));
  assert.equal(lib.calendarDayOf('2024-02-29'), Date.UTC(2024, 1, 29), 'a leap day');
});

/* ------------------------------------------------------------ the grid -- */

test('weeks start on Sunday by default: 53 columns ending in the newest day\'s week', () => {
  const cal = lib.calendarOf(TABLE, { date: 'day', value: 'walks' });
  assert.equal(cal.weeks, 53);
  assert.equal(cal.startDay, 0);
  assert.equal(cal.cells.length, 52 * 7 + 1, 'the last column holds one day: Sunday the 18th');
  assert.deepEqual(unwrap([cal.cells[0].iso, cal.cells[0].col, cal.cells[0].row]), ['2025-01-19', 0, 0]);
  const last = cal.cells[cal.cells.length - 1];
  assert.deepEqual(unwrap([last.iso, last.col, last.row, last.weekday]), ['2026-01-18', 52, 0, 0]);
  const sat = cal.cells.find((c) => c.iso === '2026-01-17');
  assert.deepEqual(unwrap([sat.col, sat.row, sat.weekday]), [51, 6, 6]);
});

test('"weekStart": "monday" starts each column on a Monday', () => {
  const cal = lib.calendarOf(TABLE, { date: 'day', value: 'walks', weekStart: 'monday' });
  assert.equal(cal.startDay, 1);
  assert.equal(cal.cells.length, 52 * 7 + 7, 'Sunday the 18th ends the week of Monday the 12th');
  assert.deepEqual(unwrap([cal.cells[0].iso, cal.cells[0].col, cal.cells[0].row, cal.cells[0].weekday]), ['2025-01-13', 0, 0, 1]);
  const last = cal.cells[cal.cells.length - 1];
  assert.deepEqual(unwrap([last.iso, last.col, last.row]), ['2026-01-18', 52, 6]);
});

test('the view ends at the data\'s own newest day, never at today', () => {
  const old = { columns: ['day', 'walks'], rows: [['2020-03-10', 5], ['2019-11-02', 8]] };
  const cal = lib.calendarOf(old, { date: 'day', value: 'walks' });
  assert.equal(cal.cells[cal.cells.length - 1].iso.slice(0, 7), '2020-03');
  assert.equal(cal.cells.find((c) => c.iso === '2020-03-10').value, 5);
  assert.equal(cal.cells.find((c) => c.iso === '2019-11-02').value, 8, 'older days inside the 53 weeks keep their rows');
});

test('"year" shows that whole calendar year, leap days and partial first and last weeks included', () => {
  const cal = lib.calendarOf(TABLE, { date: 'day', value: 'walks', year: 2024 });
  assert.equal(cal.cells.length, 366);
  assert.deepEqual(unwrap([cal.cells[0].iso, cal.cells[0].col, cal.cells[0].row]), ['2024-01-01', 0, 1], 'Monday, the second row, after a Sunday that belongs to 2023');
  const last = cal.cells[cal.cells.length - 1];
  assert.deepEqual(unwrap([last.iso, last.col, last.row]), ['2024-12-31', 52, 2]);
  assert.equal(cal.weeks, 53);
  assert.ok(cal.cells.some((c) => c.iso === '2024-02-29'));
  assert.ok(cal.cells.every((c) => c.value === undefined), 'no row in 2024: every day empty, still a calendar');
});

test('a day written twice takes the later row; an unreadable row is skipped, not drawn at zero', () => {
  const cal = lib.calendarOf(TABLE, { date: 'day', value: 'walks' });
  const at = (iso) => cal.cells.find((c) => c.iso === iso).value;
  assert.equal(at('2026-01-13'), 15);
  assert.equal(at('2026-01-15'), 3, 'a time after the day is ignored');
  assert.equal(at('2026-01-16'), null);
  assert.equal(at('2026-01-12'), undefined, 'no row: undefined');
  assert.equal(lib.calendarOf({ columns: ['day', 'walks'], rows: [['junk', 1]] }, { date: 'day', value: 'walks' }), null, 'no day to anchor on');
  assert.equal(lib.calendarOf({ columns: ['a', 'b'], rows: [['2026-01-01', 1]] }, { date: 'day', value: 'walks' }), null, 'a column that is not there');
});

test('month names sit where a month starts, at least three columns apart', () => {
  const cal = lib.calendarOf(TABLE, { date: 'day', value: 'walks' });
  assert.deepEqual(unwrap(cal.months[0]), { col: 1, name: 'Feb' }, 'January 2025 has one column of room in view, so it goes unnamed');
  assert.equal(cal.months[cal.months.length - 1].name, 'Jan');
  assert.deepEqual(unwrap(cal.months.map((m) => m.name)), ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan']);
  for (let i = 1; i < cal.months.length; i++) assert.ok(cal.months[i].col - cal.months[i - 1].col >= 3);
  const year = lib.calendarOf(TABLE, { date: 'day', value: 'walks', year: 2024 });
  assert.deepEqual(unwrap(year.months[0]), { col: 0, name: 'Jan' }, 'a year starts with January');
  assert.equal(year.months.length, 12);
});

/* ---------------------------------------------------------- the picture -- */

test('each day is a square placed by its week and its weekday, coloured by its level', () => {
  const el = draw(calTile());
  assert.equal(cells(el).length, 52 * 7 + 1);
  assert.equal(byClass(el, 'icor-sqlv-calendar-grid')[0].style['grid-template-columns'], 'max-content repeat(53, minmax(0, 1fr))');
  const day = cellFor(el, '2026-01-17');
  assert.deepEqual([day.style['--sqlv-col'], day.style['--sqlv-row']], ['53', '8'], 'column 2 + 51, row 2 + 6');
  assert.equal(day.style.background, '#88aa44');
  assert.equal(cellFor(el, '2026-01-18').style.background, '#cc5533');
  assert.equal(cellFor(el, '2026-01-13').style.background, '#88aa44', 'the later row of that day');
  assert.equal(cellFor(el, '2026-01-14').style.background, undefined, 'a value that is not a number lands on no level');
  assert.equal(cellFor(el, '2026-01-15').style.background, '#3366cc');
});

test('a day with no row, or no value, is an empty square that says so; hover reads the day, its number and its level', () => {
  const el = draw(calTile());
  assert.ok(cellFor(el, '2026-01-12').classSet.has('is-empty'));
  assert.ok(cellFor(el, '2026-01-16').classSet.has('is-empty'));
  assert.equal(cellFor(el, '2026-01-12').getAttribute('title'), '2026-01-12 · Monday · no data');
  assert.equal(cellFor(el, '2026-01-17').getAttribute('title'), '2026-01-17 · Saturday · 12 walks · steady');
  const unknown = draw(calTile(), TABLE, { levels: [] });
  assert.ok(cells(unknown).every((c) => !c.style.background), 'a level the settings do not know leaves the day neutral');
  const plain = draw(calTile({ ranges: undefined }));
  assert.ok(cells(plain).filter((c) => !c.classSet.has('is-empty')).every((c) => !c.style.background), 'without ranges every day with data is the neutral fill');
});

test('month names run along the top and Mon, Wed and Fri down the side, on the rows they belong to', () => {
  const el = draw(calTile());
  const months = byClass(el, 'icor-sqlv-calendar-month');
  assert.equal(months[0].textContent, 'Feb');
  assert.equal(months[0].style['--sqlv-col'], '3', 'the column is a custom property; the span and row 1 are in styles.css');
  assert.equal(months[0].style['grid-row'], undefined, 'no inline grid-row on a month label');
  const days = byClass(el, 'icor-sqlv-calendar-day');
  assert.deepEqual(days.map((d) => [d.textContent, d.style['--sqlv-row']]), [['Mon', '3'], ['Wed', '5'], ['Fri', '7']]);
  const monday = byClass(draw(calTile({ weekStart: 'monday' })), 'icor-sqlv-calendar-day');
  assert.deepEqual(monday.map((d) => [d.textContent, d.style['--sqlv-row']]), [['Mon', '2'], ['Wed', '4'], ['Fri', '6']]);
});

test('the legend names every range and an empty day', () => {
  const el = draw(calTile());
  const legend = byClass(el, 'icor-sqlv-calendar-legend')[0];
  assert.deepEqual(byClass(legend, 'icor-sqlv-legend-name').map((n) => n.textContent), ['quiet', 'steady', 'busy', 'no data']);
  assert.equal(byClass(legend, 'icor-sqlv-legend-chip')[0].style.background, '#3366cc');
});

test('a grid is labelled for a screen reader; with nothing to draw it says so', () => {
  const grid = byClass(draw(calTile()), 'icor-sqlv-calendar-grid')[0];
  assert.equal(grid.getAttribute('role'), 'img');
  assert.equal(grid.getAttribute('aria-label'), 'Calendar, 365 days from 2025-01-19 to 2026-01-18. Hover a day for its value.');
  const empty = draw(calTile(), { columns: ['day', 'walks'], rows: [['junk', 1]] });
  assert.equal(byClass(empty, 'icor-sqlv-empty')[0].textContent, 'No rows to draw.');
  assert.equal(cells(empty).length, 0);
});

/* ------------------------------------------------------------ the spec -- */

test('the spec keeps a calendar and names what is wrong, in plain words', () => {
  const ok = parse(calTile({ weekStart: 'monday', year: 2025, levelColors: { Hot: '#ff0000' } }));
  assert.equal(ok.ok, true, ok.reason);
  const t = ok.spec.tiles[0];
  assert.deepEqual([t.date, t.value, t.weekStart, t.year, t.ranges.length, t.levelColors.Hot], ['day', 'walks', 'monday', 2025, 3, '#ff0000']);
  const bad = [
    [calTile({ date: undefined }), /a calendar needs "date" and "value"/],
    [calTile({ value: undefined }), /a calendar needs "date" and "value"/],
    [calTile({ date: ' ' }), /a calendar needs "date" and "value"/],
    [calTile({ weekStart: 'friday' }), /"weekStart" must be "sunday" or "monday"/],
    [calTile({ year: 26 }), /"year" must be a four-digit year like 2026/],
    [calTile({ year: '2026' }), /"year" must be a four-digit year like 2026/],
    [calTile({ row: 'a' }), /"row" only works on a heatmap/],
    [{ title: 'L', viz: 'line', x: 'a', y: 'b', sql: 'SELECT 1', weekStart: 'monday' }, /"weekStart" only works on a calendar/],
    [{ title: 'L', viz: 'heatmap', row: 'a', column: 'b', value: 'c', sql: 'SELECT 1', year: 2026 }, /"year" only works on a calendar/],
    [{ title: 'L', viz: 'line', x: 'a', y: 'b', sql: 'SELECT 1', date: 'd' }, /"date" only works on a calendar/],
    [{ title: 'L', viz: 'line', x: 'a', y: 'b', sql: 'SELECT 1', value: 'c' }, /"value" only works on a heatmap/],
    [{ title: 'L', viz: 'line', x: 'a', y: 'b', sql: 'SELECT 1', ranges: RANGES }, /"ranges" only work on a stat widget \(One big number\), a segments bar, a pie chart, a heatmap, a calendar or a bullet chart/],
    [{ title: 'Built', viz: 'calendar', source: { table: 't', metric: 'v', agg: 'sum', timeColumn: 'd' } }, /use an SQL tile for a calendar/],
  ];
  for (const [tile, re] of bad) {
    const r = parse(tile);
    assert.equal(r.ok, false, JSON.stringify(tile));
    assert.match(r.reason, re);
    assert.match(r.reason, /^Tile 1: /);
  }
});

test('a calendar survives the spec file', () => {
  const json = lib.specToJson(parse(calTile({ weekStart: 'monday', year: 2025, levelColors: { Hot: '#ff0000' } })).spec);
  const back = JSON.parse(json).tiles[0];
  assert.deepEqual([back.viz, back.date, back.value, back.weekStart, back.year, back.x, back.y], ['calendar', 'day', 'walks', 'monday', 2025, undefined, undefined]);
  assert.equal(back.ranges.length, 3);
  assert.equal(lib.parseDashboardSpec(json).ok, true);
  assert.equal(lib.defaultSpanFor({ viz: 'calendar' }).w, 4);
});

/* ------------------------------------------------------------ the form -- */

const TARGET = {
  title: 'Walks per day', viz: 'calendar', unit: 'walks', hint: 'since the new job',
  ranges: [{ high: 9, level: 'Good', label: 'quiet' }, { low: 10, high: 19, level: 'Watch' }, { level: 'Alert', label: 'busy' }],
  levelColors: { Watch: '#a08040' },
  sql: 'SELECT day, hr, minutes FROM grid', date: 'day', value: 'minutes', weekStart: 'monday', year: 2025,
};

test('a calendar built from a blank widget in the form matches the hand-written one field for field', async () => {
  const { form, spec, lib: l } = await makeForm(null);
  form.open();
  Object.assign(form.state, { mode: 'sql', sqlText: TARGET.sql, viz: 'calendar', title: 'Walks per day', unit: 'walks', sizeKey: 'wide' });
  form.renderForm();
  await form.runPreview();
  assert.equal(form.previewState, 'error', 'not complete without its columns');
  for (const label of ['Date column', 'Day value column']) assert.equal(byLabel(form.formEl, label).tagName, 'SELECT', label + ' is a picker');
  assert.deepEqual(unwrap(byLabel(form.formEl, 'Week starts on').children.map((o) => o.value)), ['', 'sunday', 'monday']);
  assert.equal(byLabel(form.formEl, 'Year').getAttribute('placeholder'), 'empty: the last 53 weeks up to the newest day');
  assert.equal(byLabel(form.formEl, 'Row labels column'), null, 'no heatmap fields on a calendar');
  Object.assign(form.state, { calDate: 'day', calValue: 'minutes', calWeekStart: 'monday', calYear: '2025', hint: 'since the new job' });
  form.state.ranges = [{ low: '', high: '9', level: 'Good', label: 'quiet' }, { low: '10', high: '19', level: 'Watch', label: '' }, { low: '', high: '', level: 'Alert', label: 'busy' }];
  form.state.levelColors = { Watch: '#a08040' };
  form.touch();
  await form.runPreview();
  assert.equal(form.previewState, 'ok', form.previewError);
  assert.ok(byClass(form.previewEl, 'icor-sqlv-calendar-cell').length, 'the preview draws the days');
  await form.save();
  const want = l.parseDashboardSpec(JSON.stringify({ id: 'x', title: 'X', database: '07 Databases/shop.db', tiles: [TARGET] })).spec.tiles[0];
  assert.deepEqual(unwrap(asFileTile(l, spec.tiles[0])), unwrap(asFileTile(l, want)));
});

test('a calendar reads back into the form; the year must be a whole number', async () => {
  const parsed = lib.parseDashboardSpec(JSON.stringify({ id: 'x', title: 'X', database: '07 Databases/shop.db', tiles: [TARGET] })).spec.tiles[0];
  const { form, spec, lib: l } = await makeForm(parsed);
  form.open();
  assert.deepEqual([form.state.calDate, form.state.calValue, form.state.calWeekStart, form.state.calYear], ['day', 'minutes', 'monday', '2025']);
  assert.equal(lib.FORM_VIZ.has('calendar'), true);
  await form.runPreview();
  assert.equal(form.previewState, 'ok', form.previewError);
  assert.equal(form.dropNote.textContent, '', 'nothing is left out');
  await form.save();
  assert.deepEqual(unwrap(asFileTile(l, spec.tiles[0])), unwrap(asFileTile(l, parsed)));
  form.state.calYear = '20x5';
  assert.match(form.buildTile().reason, /Year must be a whole number like 2026/);
  form.state.calYear = '';
  form.state.calDate = '';
  assert.match(form.buildTile().reason, /a calendar needs "date" and "value"/);
});

test('"value" is named for what it is: a heatmap or a calendar setting, never "only a heatmap"', () => {
  const r = parse({ title: 'L', viz: 'line', x: 'a', y: 'b', sql: 'SELECT 1', value: 'c' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /"value" only works on a heatmap or a calendar\./);
  /* The other heatmap keys are still heatmap-only, and a calendar may use "value". */
  assert.match(parse(calTile({ row: 'a' })).reason, /"row" only works on a heatmap\./);
  assert.equal(parse(calTile()).ok, true);
});

/* ------------------------------------------- opens at the newest week -- */

/* ------------------------------------------------ a narrow tile (phone) -- */

test('how many weeks fit: a square of 6px and a gap each, after the weekday names; unmeasured shows all', () => {
  assert.equal(lib.calendarWeeksFit(0), Infinity);
  assert.equal(lib.calendarWeeksFit(undefined), Infinity);
  assert.equal(lib.calendarWeeksFit(340), 39);
  assert.equal(lib.calendarWeeksFit(450), 53);
  assert.equal(lib.calendarWeeksFit(20), 8, 'never fewer than eight weeks');
});

test('too narrow for every week: the newest weeks only, month names on the weeks that are left', () => {
  const full = lib.calendarOf(TABLE, { date: 'day', value: 'walks' });
  const cal = lib.calendarOf(TABLE, { date: 'day', value: 'walks' }, undefined, 39);
  assert.equal(cal.weeks, 39);
  assert.equal(cal.cells[cal.cells.length - 1].iso, '2026-01-18', 'the newest day is kept');
  assert.equal(cal.cells[0].row, 0, 'starts on a whole week');
  assert.equal(cal.cells[0].col, 0);
  assert.equal(cal.cells.length, 38 * 7 + 1);
  assert.ok(cal.cells.every((c) => c.col >= 0 && c.col < 39));
  assert.ok(cal.months.length && cal.months.every((m) => m.col < 39));
  const firstMonth = CAL_MONTH_OF(cal.cells[0]);
  assert.ok(cal.months.every((m) => cal.cells.some((c) => c.col === m.col && CAL_MONTH_OF(c) === m.name)), 'every label sits on a week that is shown');
  assert.equal(cal.months[0].name, 'May', 'the partial first month (' + firstMonth + ', under three weeks) gives way to the next');
  assert.ok(full.months.some((m) => m.name === 'Feb'), 'the full year labels months that the narrow one has dropped');
  assert.equal(lib.calendarOf(TABLE, { date: 'day', value: 'walks' }, undefined, 99).weeks, 53, 'more room than weeks changes nothing');
});
const CAL_MONTH_OF = (c) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][c.month];

test('on a phone-width tile the calendar draws fewer weeks and does not scroll sideways', () => {
  const made = [];
  class FakeRO {
    constructor(cb) { this.cb = cb; this.watched = []; this.gone = false; made.push(this); }
    observe(el) { this.watched.push(el); }
    disconnect() { this.gone = true; }
  }
  const fresh = loadPlugin({ globals: { ResizeObserver: FakeRO } });
  const el = new fresh.obsidian.Modal({}).contentEl;
  const observers = [];
  fresh.lib.renderTile(el, { viz: 'calendar', date: 'day', value: 'walks' }, TABLE, { observers });
  const scroll = byClass(el, 'icor-sqlv-calendar-scroll')[0];
  const grid = byClass(el, 'icor-sqlv-calendar-grid')[0];
  scroll.isConnected = true;
  assert.equal(observers.length, 1, 'the owner can release it');
  assert.ok(made[0].watched.includes(scroll));
  assert.equal(cells(el).length, 52 * 7 + 1, 'unmeasured: every week');
  scroll.clientWidth = 340;
  made[0].cb();
  assert.equal(grid.style['grid-template-columns'], 'max-content repeat(39, minmax(0, 1fr))');
  assert.equal(cells(el).length, 38 * 7 + 1);
  assert.equal(cellFor(el, '2026-01-18').style['--sqlv-col'], '40', 'the newest day is still in the last column');
  assert.equal(grid.getAttribute('aria-label').startsWith('Calendar, 267 days from '), true);
  scroll.clientWidth = 340;
  made[0].cb();
  assert.equal(cells(el).length, 38 * 7 + 1, 'same width, not drawn again');
  scroll.clientWidth = 700;
  made[0].cb();
  assert.equal(cells(el).length, 52 * 7 + 1, 'wide again: every week back');
  scroll.isConnected = false;
  made[0].cb();
  assert.equal(made[0].gone, true);
});

test('the calendar box never scrolls sideways', () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const scrollRule = css.slice(css.indexOf('.icor-sqlv-calendar-scroll {'));
  assert.match(scrollRule.slice(0, scrollRule.indexOf('}')), /overflow-x:\s*hidden/);
  const gridRule = css.slice(css.indexOf('.icor-sqlv-calendar-grid {'));
  assert.doesNotMatch(gridRule.slice(0, gridRule.indexOf('}')), /min-width/, 'no floor that forces a sideways scroll');
});

test('the static placement lives in styles.css, not in inline styles', () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'styles.css'), 'utf8');
  assert.ok(css.includes("grid-row: 1; grid-column: var(--sqlv-col) / span 3;"), "month label placement");
  assert.ok(css.includes(".icor-sqlv-calendar-day { grid-row: var(--sqlv-row); grid-column: 1;"), "weekday label placement");
  assert.ok(css.includes(".icor-sqlv-tile.is-dragging.is-moving {") && css.includes("translate(var(--sqlv-drag-x"), "drag offset");
  const main = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'main.js'), 'utf8');
  assert.ok(!main.includes("style.transform"), "no inline transform in main.js");
});
