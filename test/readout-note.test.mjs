/* THE FORMAT: a dashboard or a cache entry is a Markdown note.
 *
 * Default Obsidian Sync carries notes (.md), images, audio, video and PDF,
 * and leaves every other file type behind, so ReadOut saves its dashboards
 * and its phone cache as notes: frontmatter `readout: dashboard|cache`, a
 * line of explanation, and the JSON in a fenced block. These gates hold the
 * format to its promises: the JSON comes back exactly, a member's edits
 * around it do not matter, and a note that is not ReadOut's is never
 * mistaken for one. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin } from './harness.mjs';

const { lib } = loadPlugin();

const SPEC = {
  id: 'sleep', title: 'Sleep', database: '07 Databases/health.db', globalTimeframe: { preset: '90d' },
  tiles: [{ title: 'Hours', viz: 'line', x: 'day', y: ['hours'], sql: 'SELECT day, hours FROM sleep' }],
};
const SPEC_TEXT = JSON.stringify(SPEC, null, 2) + '\n';
const TICKS = '`'.repeat(3);

test('a note holds the JSON exactly: the text that goes in is the text that comes out', () => {
  const texts = [
    SPEC_TEXT,
    JSON.stringify(SPEC),
    '{}',
    '',
    '\n\n  {"a": 1}  \n\n',
    JSON.stringify({ note: 'café — 日本語 🚀', sql: "SELECT 'a'||'b'" }, null, 2),
  ];
  for (const text of texts) {
    const note = lib.writeReadoutNote('dashboard', text);
    const back = lib.readReadoutNote(note, 'dashboard');
    assert.equal(back.ok, true);
    assert.equal(back.json, text);
  }
});

test('JSON with backticks in it cannot end the block early: the fence outgrows every run', () => {
  const evil = JSON.stringify({ title: 'a ' + TICKS + ' b', sql: 'SELECT 1', more: '````\n' + TICKS + 'json\n{}\n' + TICKS }, null, 2);
  const note = lib.writeReadoutNote('cache', evil);
  assert.match(note, /\n`{5,}json\n/, 'a fence longer than the longest run inside');
  const back = lib.readReadoutNote(note, 'cache');
  assert.equal(back.ok, true);
  assert.equal(back.json, evil);
  assert.deepEqual(JSON.parse(back.json), JSON.parse(evil));
});

test('what a person sees: properties, one line of explanation, then the JSON as code', () => {
  const note = lib.writeReadoutNote('dashboard', '{"id":"x"}');
  assert.equal(note.startsWith('---\nreadout: dashboard\n---\n\nA ReadOut dashboard. '), true);
  assert.equal(note.endsWith('\n\n' + TICKS + 'json\n{"id":"x"}\n' + TICKS + '\n'), true);
  const cache = lib.writeReadoutNote('cache', '{}');
  assert.equal(cache.startsWith('---\nreadout: cache\n---\n\n'), true);
});

test('a note that is not ReadOut\'s is not read as one: no frontmatter, no property, another kind', () => {
  const json = TICKS + 'json\n{"id":"x"}\n' + TICKS + '\n';
  assert.equal(lib.readReadoutNote(json, 'dashboard').marked, false, 'a plain note with a json block');
  assert.equal(lib.readReadoutNote('# README\n\nhello\n', 'dashboard').marked, false);
  assert.equal(lib.readReadoutNote('---\ntags: [a]\n---\n' + json, 'dashboard').marked, false, 'frontmatter without the property');
  assert.equal(lib.readReadoutNote('---\nreadout: cache\n---\n' + json, 'dashboard').marked, false, 'the other kind');
  assert.equal(lib.readReadoutNote('---\nreadoutx: dashboard\n---\n' + json, 'dashboard').marked, false);
  assert.equal(lib.readReadoutNote('', 'dashboard').marked, false);
  assert.equal(lib.readReadoutNote(undefined, 'dashboard').marked, false);
});

test('a ReadOut note that cannot be read says why, in words', () => {
  const none = lib.readReadoutNote('---\nreadout: dashboard\n---\n\nJust words.\n', 'dashboard');
  assert.deepEqual([none.marked, none.ok], [true, false]);
  assert.match(none.reason, /no json block/);
  const open = lib.readReadoutNote('---\nreadout: dashboard\n---\n\n' + TICKS + 'json\n{"id":"x"}\n', 'dashboard');
  assert.deepEqual([open.marked, open.ok], [true, false]);
  assert.match(open.reason, /not closed/);
});

test('a note a person opened and saved in Obsidian still reads', () => {
  const body = SPEC_TEXT.trimEnd();
  const fenced = (open, close, extra) => '---\n' + (extra || '') + 'readout: dashboard\n---\n\n' + open + '\n' + body + '\n' + close + '\n';
  const variants = {
    'words added above and below': '---\nreadout: dashboard\n---\n\nMy sleep board. Thursday: add REM.\n\n' + TICKS + 'json\n' + body + '\n' + TICKS + '\n\nSee also [[Health]].\n',
    'other properties added, property reordered': fenced(TICKS + 'json', TICKS, 'tags: [health]\naliases: ["Sleep board"]\n'),
    'quoted value': '---\nreadout: "dashboard"\n---\n' + TICKS + 'json\n' + body + '\n' + TICKS,
    'no blank lines, no final newline': '---\nreadout: dashboard\n---\n' + TICKS + 'json\n' + body + '\n' + TICKS,
    'Windows line endings': fenced(TICKS + 'json', TICKS).replace(/\n/g, '\r\n'),
    'a byte order mark': '﻿' + fenced(TICKS + 'json', TICKS),
    'a longer fence': fenced('````json', '````'),
    'a tilde fence': fenced('~~~json', '~~~'),
    'trailing spaces on the fence lines': fenced(TICKS + 'json  ', TICKS + '  '),
    'frontmatter closed with trailing spaces': '---\nreadout: dashboard\n---  \n\n' + TICKS + 'json\n' + body + '\n' + TICKS + '\n',
  };
  for (const [what, text] of Object.entries(variants)) {
    const back = lib.readReadoutNote(text, 'dashboard');
    assert.equal(back.ok, true, what);
    assert.deepEqual(JSON.parse(back.json), SPEC, what);
    assert.equal(back.json, body, what);
  }
});

test('a save from the builder replaces only the JSON and keeps what a person wrote around it', () => {
  const note = '---\ntags: [health]\nreadout: dashboard\n---\n\nMy sleep board.\n\n' + TICKS + 'json\n' + JSON.stringify(SPEC) + '\n' + TICKS + '\n\nSee also [[Health]].\n';
  const next = JSON.stringify({ ...SPEC, title: 'Sleep, renamed' }, null, 2);
  const out = lib.rewriteReadoutNote(note, 'dashboard', next);
  assert.equal(out.startsWith('---\ntags: [health]\nreadout: dashboard\n---\n\nMy sleep board.\n\n' + TICKS + 'json\n'), true);
  assert.equal(out.endsWith('\n' + TICKS + '\n\nSee also [[Health]].\n'), true);
  assert.equal(lib.readReadoutNote(out, 'dashboard').json, next);
});

test('a save over a note that cannot be read, or over nothing, writes it afresh; JSON that needs a longer fence gets one', () => {
  const next = JSON.stringify(SPEC);
  assert.equal(lib.rewriteReadoutNote('garbage', 'dashboard', next), lib.writeReadoutNote('dashboard', next));
  assert.equal(lib.rewriteReadoutNote(undefined, 'dashboard', next), lib.writeReadoutNote('dashboard', next));
  const withTicks = JSON.stringify({ ...SPEC, title: 'a ' + TICKS + ' b' });
  const old = lib.writeReadoutNote('dashboard', next);
  const out = lib.rewriteReadoutNote(old, 'dashboard', withTicks);
  assert.equal(lib.readReadoutNote(out, 'dashboard').json, withTicks);
});

test('the notes live where the .json files lived, with .md; the old paths stay nameable', () => {
  assert.equal(lib.dashCachePath('Cache', 'sleep', 'md'), 'Cache/dashboards/sleep.md');
  assert.equal(lib.dashCachePath('Cache', 'sleep', 'json'), 'Cache/dashboards/sleep.json');
  assert.match(lib.catalogPathFor('Cache', 'DB/health.db', 'md'), /^Cache\/catalogs\/health-[0-9a-f]{8}\.md$/);
  assert.match(lib.catalogPathFor('Cache', 'DB/health.db', 'json'), /^Cache\/catalogs\/health-[0-9a-f]{8}\.json$/);
  assert.equal(lib.blockCachePath('Cache', 'abc', 'md'), 'Cache/notes/abc.md');
  assert.equal(lib.blockCachePath('Cache', 'abc', 'json'), 'Cache/notes/abc.json');
  assert.equal(lib.noteTwinOf('A/B/sleep.json'), 'A/B/sleep.md');
  assert.equal(lib.noteTwinOf('A/B/sleep.JSON'), 'A/B/sleep.md');
});

test('a save that needs a longer fence, or over a tilde fence, swaps the fence lines and keeps the words around the block', () => {
  const prose = (open, close) => '---\ntags: [x]\nreadout: dashboard\n---\n\nMy words above.\n\n' + open + '\n{"a":1}\n' + close + '\n\nMy words below.\n';
  const withTicks = JSON.stringify({ title: 'a ' + TICKS + ' b' });
  for (const [open, close] of [[TICKS + 'json', TICKS], ['~~~json', '~~~']]) {
    const out = lib.rewriteReadoutNote(prose(open, close), 'dashboard', withTicks);
    assert.equal(out.startsWith('---\ntags: [x]\nreadout: dashboard\n---\n\nMy words above.\n\n````json\n'), true, open);
    assert.equal(out.endsWith('\n````\n\nMy words below.\n'), true, open);
    assert.equal(lib.readReadoutNote(out, 'dashboard').json, withTicks, open);
  }
  const plain = lib.rewriteReadoutNote(prose('~~~json', '~~~'), 'dashboard', '{"b":2}');
  assert.equal(plain.includes('\n```json\n{"b":2}\n```\n\nMy words below.'), true, 'a tilde fence becomes a backtick fence of the usual length');
});
