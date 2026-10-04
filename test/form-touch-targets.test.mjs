/* THE EDIT PANEL ON A PHONE: TOUCH TARGETS.
 *
 * The edit panel's list rows add and remove with "+ Add ..." buttons, and
 * its option groups open with small text toggles. On a touch screen both
 * stayed desktop-sized: the plugin's coarse-pointer block made the tile
 * actions, wizard rows and bar buttons large, but not these. This gate
 * reads that block from styles.css and requires a 44px target for the add
 * buttons and the group toggles (the remove buttons are tile actions,
 * already 36px there).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = fs.readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function coarseBlock() {
  const start = css.indexOf('@media (pointer: coarse)');
  assert.ok(start >= 0, 'the coarse-pointer block exists');
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error('unclosed coarse-pointer block');
}

function ruleFor(block, selector) {
  for (const m of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map((s) => s.trim());
    if (selectors.includes(selector)) return m[2];
  }
  return null;
}

test('on a touch screen the panel\'s add buttons and option-group toggles are 44px targets', () => {
  const block = coarseBlock();
  for (const selector of ['button.icor-sqlv-add-filter', 'button.icor-sqlv-advanced-toggle']) {
    const rule = ruleFor(block, selector);
    assert.ok(rule, selector + ' has a coarse-pointer rule');
    assert.match(rule, /min-height:\s*44px/, selector + ' is at least 44px tall');
  }
  assert.match(ruleFor(block, 'button.icor-sqlv-advanced-toggle'), /display:\s*inline-flex/, 'the toggle is unset to inline, so it needs a box for its height to count');
  assert.match(ruleFor(block, '.icor-sqlv-tile-action'), /height:\s*36px/, 'the remove buttons, tile actions, stay large');
});
