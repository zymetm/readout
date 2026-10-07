/* THE HELP FILE SHOWS EACH WIDGET, DRAWN BY THE PLUGIN ITSELF.
 *
 * Each widget section of the help file carries a small code block,
 * ```sqlite-viewer-sample with the widget type in it, under a one-line
 * caption. The plugin registers a code block processor for that language
 * and draws a sample widget there with the real renderer and fixed,
 * invented rows: no image file, no query, no network. These gates keep it
 * so: every block names a sample and has its caption; every widget type
 * has one; every sample is a valid widget and draws without an error, in
 * the plugin's token scope, at a fixed height set in styles.css; an
 * unknown word draws a short line instead of failing; and the block's
 * resize observers are released when the block goes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadPlugin, makeFakeAdapter, makeFakeVault } from './harness.mjs';

const CSS = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function* walkEl(el) { yield el; for (const c of el.children || []) yield* walkEl(c); }
const byClass = (root, cls) => [...walkEl(root)].filter((e) => e.classSet && e.classSet.has(cls));

/* A ResizeObserver that records what it watches and whether it was released. */
function observerClass(made) {
  return class FakeResizeObserver {
    constructor(cb) { this.cb = cb; this.gone = false; made.push(this); }
    observe(el) { this.el = el; }
    disconnect() { this.gone = true; }
  };
}

const { lib, obsidian } = loadPlugin();
const HELP = lib.DASHBOARD_README;
const BLOCK_RE = /(^|\n)([^\n]*)\n\n```sqlite-viewer-sample\n([^\n`]*)\n```/g;
const blocks = [...HELP.matchAll(BLOCK_RE)].map((m) => ({ caption: m[2], word: m[3] }));

test('every widget type has a sample block in the help file, each under a caption', () => {
  assert.equal(lib.SAMPLE_BLOCK_LANG, 'sqlite-viewer-sample');
  assert.equal((HELP.match(/```sqlite-viewer-sample/g) || []).length, blocks.length, 'every block has the expected shape');
  assert.deepEqual(blocks.map((b) => b.word).sort(), [...lib.VIZ_KINDS].sort(), 'one sample per widget type');
  for (const { caption, word } of blocks) {
    assert.match(caption, /^\*Sample: [^*]+\.\*$/, word + ': a one-line caption says what the sample is');
    assert.ok(Object.prototype.hasOwnProperty.call(lib.WIDGET_SAMPLES, word), word + ' is a sample');
  }
  assert.doesNotMatch(HELP, /image slot/, 'no slot left');
});

test('every sample is a widget the plugin would accept in a dashboard file', () => {
  /* A sample brings its rows instead of a query; in a file it would be SQL. */
  const tiles = Object.values(lib.WIDGET_SAMPLES).map((s) => (s.spec.viz === 'divider' || s.spec.viz === 'text' ? s.spec : Object.assign({ sql: 'SELECT 1' }, s.spec)));
  const parsed = lib.parseDashboardSpec(JSON.stringify({ id: 'samples', title: 'Samples', database: '07 Databases/shop.db', tiles }));
  assert.equal(parsed.ok, true, parsed.reason);
});

test('every sample draws with the real renderer, no error, in the plugin\'s token scope', () => {
  const expect = {
    line: 'icor-sqlv-chart-box', bar: 'icor-sqlv-chart-box', combo: 'icor-sqlv-chart-box', scatter: 'icor-sqlv-chart-box', bullet: 'icor-sqlv-bullet-track',
    stat: 'icor-sqlv-meter', table: 'icor-sqlv-table', segments: 'icor-sqlv-segments-bar', pie: 'icor-sqlv-pie',
    heatmap: 'icor-sqlv-heatmap-cell', calendar: 'icor-sqlv-calendar-cell', text: 'icor-sqlv-text-para', divider: 'icor-sqlv-divider-heading',
  };
  for (const word of lib.VIZ_KINDS) {
    const el = new obsidian.Modal({}).contentEl;
    assert.equal(lib.renderWidgetSample(el, word, []), true, word);
    const box = byClass(el, 'icor-sqlv-sample')[0];
    assert.ok(box, word + ': the sample box');
    assert.equal(box.getAttribute('data-ink-plugin'), 'icor-for-life-sqlite-viewer', word + ': the colour tokens reach it');
    assert.ok(byClass(box, 'icor-sqlv-tile').length === 1, word + ': one tile');
    assert.ok(byClass(box, expect[word]).length > 0, word + ': draws ' + expect[word]);
    assert.equal(byClass(el, 'icor-sqlv-error').length, 0, word + ': no error');
    assert.equal(Object.keys(box.style).filter((k) => typeof box.style[k] !== 'function').length, 0, word + ': no inline style on the box');
  }
  /* Levels come from the defaults, not the member's settings. */
  const stat = new obsidian.Modal({}).contentEl;
  lib.renderWidgetSample(stat, 'stat', []);
  assert.ok(byClass(stat, 'icor-sqlv-level-pill').some((p) => p.textContent === 'on track'), 'the stat sample shows its level');
  const heat = new obsidian.Modal({}).contentEl;
  lib.renderWidgetSample(heat, 'heatmap', []);
  assert.ok(byClass(heat, 'icor-sqlv-heatmap-cell').length >= 45, 'the heatmap sample has its cells');
  /* The 0.7 samples show what is new about their widget. */
  const attrClass = (root, cls) => [...walkEl(root)].filter((e) => e.getAttribute && e.getAttribute('class') === cls);
  const draw = (word) => { const el = new obsidian.Modal({}).contentEl; lib.renderWidgetSample(el, word, []); return el; };
  const scatter = draw('scatter');
  assert.equal(attrClass(scatter, 'icor-sqlv-point').length, 26, 'the scatter sample has its points');
  assert.equal(attrClass(scatter, 'icor-sqlv-trend').length, 1, 'and its trend line');
  assert.equal(byClass(draw('calendar'), 'icor-sqlv-calendar-cell').length, 365, 'the calendar sample is a year of days');
  assert.equal(byClass(draw('bullet'), 'icor-sqlv-bullet-target').length, 3, 'the bullet sample has its targets');
  assert.equal(attrClass(draw('table'), 'icor-sqlv-spark').length, 5, 'the table sample has its sparklines');
});

test('a block with an unknown word, or none, shows a short line instead of failing', () => {
  for (const word of ['doughnut', '', '  ', 'toString', 'constructor']) {
    const el = new obsidian.Modal({}).contentEl;
    assert.equal(lib.renderWidgetSample(el, word, []), false, JSON.stringify(word));
    const line = byClass(el, 'icor-sqlv-sample-missing')[0];
    assert.ok(line && line.textContent === 'No sample for this widget type.', JSON.stringify(word));
  }
  /* The word is trimmed, as a code block hands it over with its newline. */
  assert.equal(lib.renderWidgetSample(new obsidian.Modal({}).contentEl, 'line\n', []), true);
});

test('the plugin registers the block, and a block releases its resize observers when it goes', async () => {
  const made = [];
  const fresh = loadPlugin({ globals: { ResizeObserver: observerClass(made) } });
  const adapter = makeFakeAdapter();
  const app = { vault: makeFakeVault(adapter, fresh.obsidian.TFile), workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  plugin.app = app;
  await plugin.onload();
  const handler = plugin.codeBlocks && plugin.codeBlocks['sqlite-viewer-sample'];
  assert.equal(typeof handler, 'function', 'the code block processor is registered');
  const children = [];
  for (const word of ['line', 'combo', 'heatmap', 'stat']) {
    const el = new fresh.obsidian.Modal({}).contentEl;
    handler(word + '\n', el, { addChild: (child) => children.push(child) });
  }
  assert.equal(children.length, 4, 'each block is a child of its note');
  assert.ok(children.every((c) => c instanceof fresh.obsidian.MarkdownRenderChild), 'a MarkdownRenderChild');
  for (const child of children) child.onload();
  assert.ok(made.length >= 3, 'the charts watch their size (' + made.length + ')');
  assert.ok(made.every((o) => !o.gone));
  for (const child of children) child.onunload();
  assert.ok(made.every((o) => o.gone), 'every observer released when the blocks go');
});

test('the sample box has a fixed height from styles.css, shorter for a number, a text and a divider', () => {
  const rule = (sel) => {
    const m = CSS.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
    return m ? m[1] : '';
  };
  for (const size of ['chart', 'short', 'thin']) assert.match(rule('.icor-sqlv-sample.is-' + size), /(^|;|\s)height:\s*\d+px/, size);
  assert.match(rule('.icor-sqlv-sample > .icor-sqlv-tile'), /height:\s*100%/, 'the tile fills the box');
  for (const sample of Object.values(lib.WIDGET_SAMPLES)) assert.ok(['chart', 'short', 'thin'].includes(sample.size));
});
