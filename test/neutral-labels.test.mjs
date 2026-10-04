/* THE EDIT PANEL'S EXAMPLES SPEAK TO ANY DASHBOARD, NOT A HEALTH ONE.
 *
 * Four strings in the edit panel gave health examples: the second choice
 * of "Good direction" said "Down is good (weight, resting heart rate)",
 * the "Unit" field suggested "kg, steps, kcal …", a divider's "Heading"
 * suggested "Body, Sleep, Activity …" and a combo's "Unit of the right
 * axis" suggested "like kcal or %". The plugin serves any database, so
 * they now give neutral examples. The panel is drawn in every shape
 * (panel-labels.mjs) and the new words must be what it shows; the help
 * file quotes the "Good direction" choice and the right axis example in the
 * panel's own words.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadPlugin } from './harness.mjs';
import { panelLabels } from './panel-labels.mjs';

const { lib } = loadPlugin();
const MAIN = readFileSync(new URL('../main.js', import.meta.url), 'utf8');

const OLD = ['Down is good (weight, resting heart rate)', 'kg, steps, kcal …', 'Body, Sleep, Activity …', 'like kcal or %'];

test('the panel shows neutral examples for "Good direction", "Unit", a divider\'s "Heading" and the right axis unit', async () => {
  const labels = await panelLabels();
  assert.ok(labels.option.has('Down is good (costs, open tasks)'), 'the "Good direction" choice');
  assert.ok(labels.placeholder.has('orders, %, hours …'), 'the "Unit" placeholder');
  assert.ok(labels.placeholder.has('Sales, Costs, Projects …'), 'the divider "Heading" placeholder');
  assert.ok(labels.placeholder.has('like orders or %'), 'the right axis "Unit" placeholder');
  const all = Object.values(labels).flatMap((set) => [...set]);
  for (const old of OLD) assert.ok(!all.includes(old), 'no longer shown: ' + old);
});

test('the old health examples are gone from the plugin and its guides', () => {
  for (const old of OLD) {
    assert.ok(!MAIN.includes(old), 'not in main.js: ' + old);
    for (const guide of lib.GUIDE_FILES) assert.ok(!guide.text.includes(old), 'not in ' + guide.file + ': ' + old);
  }
  assert.ok(lib.DASHBOARD_README.includes('"Down is good (costs, open tasks)"'), 'the help file quotes the new choice');
  assert.ok(lib.DASHBOARD_README.includes('"like orders or %"'), 'the help file quotes the new right axis example');
});
