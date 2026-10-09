/* THE CHANGE BADGE HAS ITS OWN LINE.
 *
 * The comparison badge ("▲ +6.3%") used to sit beside a short number and
 * drop under a long one, so tiles of one dashboard disagreed. It is now
 * always its own line directly under the number, unit still beside the
 * number. Every value here is invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadPlugin } from './harness.mjs';

const css = fs.readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const { lib, obsidian } = loadPlugin();
const kinds = (e) => e.children.map((c) => [...c.classSet][0]);
function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }

function stat(value) {
  const el = new obsidian.Modal({}).contentEl;
  lib.renderTile(el, { title: 'T', viz: 'stat', unit: 'USD', source: { table: 't', metric: 'm', agg: 'sum', timeColumn: 'd' } },
    { columns: ['v'], rows: [[value]] }, { ghost: { rows: [[value / 2]] }, compare: 'previous' });
  return [...walkEl(el)].find((e) => e.classSet && e.classSet.has('icor-sqlv-stat'));
}

for (const [name, v] of [['a short number', 7], ['a long number', 1234567.89]]) {
  test('the change badge is its own line right under ' + name + ', the unit stays beside the number', () => {
    const s = stat(v);
    assert.deepEqual(kinds(s).slice(0, 2), ['icor-sqlv-stat-value', 'icor-sqlv-stat-change']);
    const line = s.children[0];
    assert.equal(line.children.length, 2);
    assert.ok(line.children[1].classSet.has('icor-sqlv-stat-unit'), 'only the number and its unit');
    assert.ok(![...walkEl(line)].some((e) => e.classSet && e.classSet.has('icor-sqlv-delta')), 'not inside the number line');
    const pill = s.children[1].children[0];
    assert.ok(pill.classSet.has('icor-sqlv-delta'));
    assert.match(pill.children[0].textContent, /^▲ \+100%$/);
  });
}

test('the badge line is a flex row at the left with no margin pushing it aside', () => {
  const at = css.indexOf('.icor-sqlv-stat-change {');
  assert.ok(at >= 0);
  assert.match(css.slice(at, css.indexOf('}', at)), /display:\s*flex/);
  const d = css.indexOf('.icor-sqlv-stat-change > .icor-sqlv-delta {');
  assert.match(css.slice(d, css.indexOf('}', d)), /margin-left:\s*0/);
});
