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

test('a chart drawn before it has a size is scaled into its area, never taller', () => {
  const block = css.slice(css.indexOf('.icor-sqlv-chart-host > .icor-sqlv-chart:not(.is-measured)'));
  assert.match(block.slice(0, block.indexOf('}')), /position:\s*absolute[^}]*width:\s*100%[^}]*height:\s*100%/);
});

test('a chart drawn off screen is drawn again once it has a size, with no observer needed', async () => {
  const { loadPlugin } = await import('./harness.mjs');
  const frames = [];
  const win = { requestAnimationFrame: (cb) => { frames.push(cb); return frames.length; } };
  const { lib, obsidian } = loadPlugin();
  const walk = function* (el) { yield el; for (const c of el.children || []) yield* walk(c); };
  const tileEl = new obsidian.Modal({}).contentEl;
  tileEl.win = win;
  const rows = Array.from({ length: 12 }, (_, i) => ['d' + i, 10 + i, 5 + (i % 3)]);
  lib.renderTile(tileEl, { title: 'T', viz: 'line', x: 'd', y: ['a', 'b'] }, { columns: ['d', 'a', 'b'], rows }, {});
  const host = [...walk(tileEl)].find((e) => e.classSet && e.classSet.has('icor-sqlv-chart-host'));
  const box = [...walk(tileEl)].find((e) => e.classSet && e.classSet.has('icor-sqlv-chart-box'));
  assert.ok(frames.length > 0, 'a retry is queued while the chart has no size');
  box.isConnected = true;
  box.clientHeight = 200;
  host.clientWidth = 600;
  host.clientHeight = 169;
  frames.shift()();
  assert.equal(host.children[0].getAttribute('height'), '169', 'the retry measured and redrew it');
});

test('a chart whose area settles to a smaller size a moment after it was drawn is drawn again to fit', async () => {
  const { loadPlugin } = await import('./harness.mjs');
  const frames = [];
  const win = { requestAnimationFrame: (cb) => { frames.push(cb); return frames.length; } };
  const { lib, obsidian } = loadPlugin();
  const walk = function* (el) { yield el; for (const c of el.children || []) yield* walk(c); };
  const tileEl = new obsidian.Modal({}).contentEl;
  tileEl.win = win;
  const rows = Array.from({ length: 12 }, (_, i) => ['d' + i, 10 + i]);
  const proto = Object.getPrototypeOf(tileEl);
  const box0 = [];
  const orig = proto.createDiv;
  proto.createDiv = function (o) {
    const el = orig.call(this, o);
    if (o && o.cls === 'icor-sqlv-chart-box') { el.isConnected = true; el.clientHeight = 425; }
    if (o && o.cls === 'icor-sqlv-chart-host') { el.clientWidth = 792; el.clientHeight = 425; box0.push(el); }
    return el;
  };
  try {
    lib.renderTile(tileEl, { title: 'T', viz: 'line', x: 'd', y: ['a'] }, { columns: ['d', 'a'], rows }, {});
  } finally { proto.createDiv = orig; }
  const host = [...walk(tileEl)].find((e) => e.classSet && e.classSet.has('icor-sqlv-chart-host'));
  assert.equal(host.children[0].getAttribute('height'), '425', 'first drawn at the size it had');
  host.clientWidth = 606;
  host.clientHeight = 169;
  frames.shift()();
  assert.equal(host.children[0].getAttribute('height'), '169', 'the next frame saw the settled size');
});

test('a chart scrolled into view is measured again, long after it was drawn', async () => {
  const { loadPlugin } = await import('./harness.mjs');
  const seers = [];
  const win = {
    requestAnimationFrame: () => 0,
    IntersectionObserver: class { constructor(cb) { this.cb = cb; seers.push(this); } observe(el) { this.el = el; } },
  };
  const { lib, obsidian } = loadPlugin();
  const walk = function* (el) { yield el; for (const c of el.children || []) yield* walk(c); };
  const tileEl = new obsidian.Modal({}).contentEl;
  tileEl.win = win;
  const rows = Array.from({ length: 12 }, (_, i) => ['d' + i, 10 + i]);
  lib.renderTile(tileEl, { title: 'T', viz: 'line', x: 'd', y: ['a'] }, { columns: ['d', 'a'], rows }, {});
  const host = [...walk(tileEl)].find((e) => e.classSet && e.classSet.has('icor-sqlv-chart-host'));
  const box = [...walk(tileEl)].find((e) => e.classSet && e.classSet.has('icor-sqlv-chart-box'));
  assert.equal(seers.length, 1, 'one visibility observer on the chart box');
  box.isConnected = true;
  box.clientHeight = 200;
  host.clientWidth = 606;
  host.clientHeight = 169;
  seers[0].cb([]);
  assert.equal(host.children[0].getAttribute('height'), '169');
});
