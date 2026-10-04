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
import { SINK, DB, keysOf } from './guide-sink.mjs';

const { lib } = loadPlugin();
const GUIDE = lib.DASHBOARD_README;
const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

const named = (key) => GUIDE.includes('`' + key + '`') || GUIDE.includes('"' + key + '"');

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
