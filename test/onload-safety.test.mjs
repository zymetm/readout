/* ONLOAD SAFETY.
 *
 * Two plugins asking for the same code-block word make Obsidian throw from
 * registerMarkdownCodeBlockProcessor. That must never abort onload, which
 * would leave the views, commands and settings unregistered.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeFakeAdapter } from './harness.mjs';

async function boot({ saved = null, throwFor = [] } = {}) {
  const fresh = loadPlugin({ desktop: true });
  const adapter = makeFakeAdapter({}, {});
  const vault = { adapter, configDir: '.obsidian' };
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

test('a clash on a code-block word does not abort onload', async () => {
  for (const clash of [['readout'], ['readout-sample'], ['readout', 'readout-sample']]) {
    const { plugin } = await boot({ throwFor: clash });
    assert.ok(plugin.viewFactories && plugin.viewFactories['icor-sqlv-browser'] !== undefined || Object.keys(plugin.viewFactories || {}).length >= 3,
      'the views are registered after a clash on ' + clash.join(' and '));
    assert.ok((plugin.commands || []).length > 0, 'the commands are registered after a clash');
  }
});

