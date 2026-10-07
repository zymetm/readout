/* NARROW AND NOTE FIT.
 *
 * A pane of 400px or a widget block in a note once squeezed the main
 * content (bars, grid, plot) to nothing while notes and legends took the
 * space. These gates pin the fix in the stylesheet and the row tracks: a
 * full row grows, the chart content keeps a floor, a block sizes to its
 * content, and the pie legend never clips on the left.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = fs.readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const js = fs.readFileSync(fileURLToPath(new URL('../main.js', import.meta.url)), 'utf8');

function rule(selector) {
  let at = -1;
  for (let from = 0; ; ) {
    at = css.indexOf(selector + ' {', from);
    if (at < 0) break;
    const before = css[at - 1];
    if (at === 0 || before === String.fromCharCode(10) || before === '}') break;
    from = at + 1;
  }
  assert.ok(at >= 0, selector + ' has a rule');
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
}

test('a full grid row grows to hold its tile; a divider row stays thin', () => {
  assert.match(js, /gridAutoRows = growingRow\(gs\.cellH\)/);
  assert.match(js, /px === DIVIDER_ROW_PX \? px \+ 'px' : growingRow\(px\)/);
});

test('chart content keeps a floor', () => {
  assert.match(rule('.icor-sqlv-chart-host'), /min-height:\s*80px/);
  assert.match(rule('.icor-sqlv-heatmap-scroll'), /min-height:\s*96px/);
  assert.match(rule('.icor-sqlv-calendar-scroll'), /min-height:\s*96px/);
  assert.match(rule('.icor-sqlv-bullet-rows'), /min-height:\s*28px/);
  assert.match(rule('.icor-sqlv-pie-svg'), /min-height:\s*96px/);
});

test('a note block sizes to its content, with no fixed height', () => {
  const tile = rule('.icor-sqlv-block > .icor-sqlv-tile');
  assert.match(tile, /height:\s*auto/);
  assert.match(tile, /min-height:\s*\d+px/);
  assert.doesNotMatch(css, /\.icor-sqlv-block\.is-(chart|short)\s*\{[^}]*\bheight:/);
  assert.match(rule('.icor-sqlv-block .icor-sqlv-chart-host'), /flex:\s*none/);
  assert.match(rule('.icor-sqlv-block .icor-sqlv-calendar-scroll,\n.icor-sqlv-block .icor-sqlv-bullet-rows') || '', /./);
});

test('the pie legend is stretched, not centred, so no row is cut on the left', () => {
  const narrow = css.slice(css.indexOf('@media (max-width: 600px)', css.indexOf('.icor-sqlv-pie {')));
  assert.match(narrow, /\.icor-sqlv-pie-legend\s*\{[^}]*align-self:\s*stretch[^}]*overflow:\s*visible/);
  assert.match(rule('.icor-sqlv-pie-legend .icor-sqlv-legend-item'), /max-width:\s*100%/);
  assert.match(rule('.icor-sqlv-pie-legend .icor-sqlv-legend-name'), /flex:\s*0 1 auto/);
  assert.match(rule('.icor-sqlv-pie-legend .icor-sqlv-segments-value'), /flex:\s*0 0 auto/);
});

test('muted words in a note or sample lean toward the full ink', () => {
  assert.match(css, /\.icor-sqlv-sample,\s*\.icor-sqlv-block\s*\{\s*--sqlv-fg-faint:\s*color-mix\(/);
});
