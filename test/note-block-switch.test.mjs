/* THE NOTE-BLOCK SWITCH. A setting, on by default, turns the drawing of
 * widgets written in notes off; a block then shows its own text as plain
 * code. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeFakeAdapter } from './harness.mjs';

async function boot({ saved = null, throwFor = [] } = {}) {
  const fresh = loadPlugin({ desktop: true });
  const adapter = makeFakeAdapter({}, {});
  const vault = { adapter, getFiles: () => [], configDir: '.obsidian' };
  const app = { vault, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app, saved);
  plugin.app = app;
  const original = plugin.registerMarkdownCodeBlockProcessor.bind(plugin);
  plugin.registerMarkdownCodeBlockProcessor = (lang, handler) => {
    if (throwFor.includes(lang)) throw new Error('Code block processor for ' + lang + ' already exists');
    return original(lang, handler);
  };
  await plugin.onload();
  return { plugin, fresh };
}

test('the note-block setting defaults on, and off shows the block as plain code', async () => {
  const { plugin, fresh } = await boot();
  assert.equal(plugin.settings.drawNoteBlocks, true);
  const draws = [];
  const run = (source) => {
    const el = new fresh.obsidian.Modal({}).contentEl;
    plugin.codeBlocks[fresh.lib.WIDGET_BLOCK_LANG](source, el, { addChild: (c) => draws.push(c) });
    return el;
  };
  run('dashboard: x\nwidget: 1');
  assert.equal(draws.length, 1, 'on: the block draws');
  plugin.settings.drawNoteBlocks = false;
  const el = run('dashboard: x\nwidget: 1');
  assert.equal(draws.length, 1, 'off: no widget child is made');
  const texts = [...el.walk()].map((n) => n.textContent);
  assert.ok(texts.includes('dashboard: x\nwidget: 1'), 'off: the block text stays visible as code');
  assert.ok([...el.walk()].some((n) => n.tagName === 'PRE'), 'off: shown in a code box');
});

test('a saved setting of false is kept', async () => {
  const { plugin } = await boot({ saved: { drawNoteBlocks: false } });
  assert.equal(plugin.settings.drawNoteBlocks, false);
});
