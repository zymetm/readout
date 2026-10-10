/* DASHBOARDS ARE NOTES (1.1).
 *
 * A dashboard is saved as a Markdown note (see readout-note.test.mjs for the
 * format) so default Obsidian Sync carries it to a phone. These gates hold
 * the dashboard side of that: notes are found, saved and edited; a .json
 * dashboard (what every earlier version wrote, or a person made by hand)
 * still opens, and is saved as its note without the .json being touched;
 * where both exist the note wins; a README or a member's own note in the
 * folder is never taken for a dashboard or written over. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPlugin, makeFakeAdapter, makeFakeVault, notices, unwrap } from './harness.mjs';

const DIR = '07 Databases/Dashboards';
const SPEC = { id: 'shop', title: 'Shop', database: '07 Databases/shop.db', globalTimeframe: { preset: '90d' }, tiles: [{ title: 'Orders', sql: 'SELECT 3 AS n', viz: 'stat', y: 'n' }] };
const asJson = (spec) => JSON.stringify(spec, null, 2) + '\n';
const TICKS = '`'.repeat(3);
const lib = loadPlugin().lib;

async function setup(files = {}, saved = {}) {
  const fresh = loadPlugin();
  const adapter = makeFakeAdapter(files);
  const vault = makeFakeVault(adapter, fresh.obsidian.TFile);
  const opened = [];
  const fileMenus = [];
  const frontmatter = {};
  const app = {
    vault,
    workspace: { onLayoutReady: () => {}, on: (name, fn) => { if (name === 'file-menu') fileMenus.push(fn); return {}; }, getLeavesOfType: () => [] },
    metadataCache: { getFileCache: (f) => ({ frontmatter: frontmatter[f.path] }) },
  };
  const plugin = fresh.makePlugin(app, saved);
  plugin.app = app;
  await plugin.onload();
  const leaf = { openFile: async (f) => { opened.push(f.path); }, setViewState: async (s) => { opened.push(s); } };
  return { fresh, plugin, adapter, vault, leaf, opened, fileMenus, frontmatter };
}

const note = (lib, spec, prose) => {
  const text = lib.writeReadoutNote('dashboard', JSON.stringify(spec, null, 2));
  return prose ? text + prose : text;
};

test('a dashboard note is found; its JSON is the dashboard', async () => {
  const { plugin } = await setup();
  await plugin.app.vault.adapter.write(DIR + '/shop.md', note(lib, SPEC));
  const { specs, errors } = await plugin.loadDashboardSpecs();
  assert.deepEqual(unwrap([specs.map((s) => s.id), errors]), [['shop'], []]);
  assert.equal(specs[0].path, DIR + '/shop.md');
});

test('a README, the guides and a member\'s own note in the folder are not dashboards, and not errors', async () => {
  const { plugin, adapter } = await setup({
    [DIR + '/README.md']: '# Help\n\n' + TICKS + 'json\n{"id":"readme"}\n' + TICKS + '\n',
    [DIR + '/AI-WIDGET-GUIDE.md']: '# Guide\n',
    [DIR + '/my-notes.md']: '---\ntags: [x]\n---\n\n' + TICKS + 'json\n{"id":"mine","title":"Mine","tiles":[]}\n' + TICKS + '\n',
    [DIR + '/cache-like.md']: lib.writeReadoutNote('cache', '{"id":"cache-like","title":"C","tiles":[]}'),
  });
  const { specs, errors } = await plugin.loadDashboardSpecs();
  assert.deepEqual([specs.length, errors.length], [0, 0]);
  assert.equal(adapter.files.size, 4, 'nothing was written');
});

test('a .json dashboard still opens (the fallback), and shows as it always did', async () => {
  const { plugin } = await setup({ [DIR + '/shop.json']: asJson(SPEC) });
  const { specs, errors } = await plugin.loadDashboardSpecs();
  assert.deepEqual(unwrap([specs.map((s) => s.id), errors]), [['shop'], []]);
  assert.equal(specs[0].path, DIR + '/shop.json');
});

test('where a note and a .json share a name, the note wins and the .json is ignored', async () => {
  const { plugin } = await setup({
    [DIR + '/shop.json']: asJson(Object.assign({}, SPEC, { title: 'Old, from the json' })),
    [DIR + '/shop.md']: note(lib, Object.assign({}, SPEC, { title: 'New, from the note' })),
  });
  const { specs } = await plugin.loadDashboardSpecs();
  assert.deepEqual(unwrap(specs.map((s) => [s.id, s.title, s.path])), [['shop', 'New, from the note', DIR + '/shop.md']]);
});

test('a dashboard note that cannot be read is an error naming the file, and it hides its .json twin', async () => {
  const { plugin } = await setup({
    [DIR + '/a.md']: '---\nreadout: dashboard\n---\n\nI deleted the block by accident.\n',
    [DIR + '/b.md']: lib.writeReadoutNote('dashboard', '{ not json'),
    [DIR + '/c.md']: lib.writeReadoutNote('dashboard', JSON.stringify({ id: 'c', title: 'C' })),
    [DIR + '/c.json']: asJson(Object.assign({}, SPEC, { id: 'c' })),
    [DIR + '/d.json']: '{ not json',
  });
  const { specs, errors } = await plugin.loadDashboardSpecs();
  assert.equal(specs.length, 0);
  assert.deepEqual(unwrap(errors.map((e) => e.path)), [DIR + '/a.md', DIR + '/b.md', DIR + '/c.md', DIR + '/d.json']);
  assert.match(errors[0].reason, /no json block/);
  assert.match(errors[1].reason, /not valid JSON/);
  assert.match(errors[2].reason, /"tiles"/);
});

test('a note the member edited in Obsidian still loads: words around the block, an added property', async () => {
  const text = '---\ntags: [health]\nreadout: dashboard\n---\n\nMy board.\n\n' + TICKS + 'json\n' + JSON.stringify(SPEC, null, 2) + '\n' + TICKS + '\n\nSee [[Health]].\n';
  const { plugin } = await setup({ [DIR + '/shop.md']: text });
  const { specs } = await plugin.loadDashboardSpecs();
  assert.deepEqual(unwrap(specs.map((s) => s.id)), ['shop']);
});

test('a new dashboard is a note named after its id, with the properties and the block', async () => {
  const { plugin, adapter } = await setup();
  const spec = await plugin.createDashboard();
  assert.equal(spec.id, 'dashboard-1');
  assert.deepEqual([...adapter.files.keys()], [DIR + '/dashboard-1.md']);
  const text = adapter.files.get(DIR + '/dashboard-1.md');
  assert.equal(text.startsWith('---\nreadout: dashboard\n---\n'), true);
  const back = lib.readReadoutNote(text, 'dashboard');
  assert.equal(lib.parseDashboardSpec(back.json).ok, true);
  assert.equal(spec.path, DIR + '/dashboard-1.md');
});

test('a new dashboard never takes the name of a file that is there: a .json, or a note of the member\'s', async () => {
  const { plugin, adapter } = await setup({
    [DIR + '/dashboard-1.md']: 'my own note\n',
    [DIR + '/dashboard-2.json']: '{ broken',
  });
  const spec = await plugin.createDashboard();
  assert.equal(spec.id, 'dashboard-3');
  assert.equal(adapter.files.get(DIR + '/dashboard-1.md'), 'my own note\n');
});

test('a save from the builder rewrites only the block of the note and keeps the member\'s words', async () => {
  const text = '---\ntags: [health]\nreadout: dashboard\n---\n\nMy board.\n\n' + TICKS + 'json\n' + JSON.stringify(SPEC, null, 2) + '\n' + TICKS + '\n\nSee [[Health]].\n';
  const { plugin, adapter } = await setup({ [DIR + '/shop.md']: text });
  const { specs } = await plugin.loadDashboardSpecs();
  specs[0].title = 'Shop, renamed';
  assert.equal(await plugin.saveDashboardSpec(specs[0]), true);
  const saved = adapter.files.get(DIR + '/shop.md');
  assert.equal(saved.startsWith('---\ntags: [health]\nreadout: dashboard\n---\n\nMy board.\n\n'), true);
  assert.equal(saved.endsWith('\nSee [[Health]].\n'), true);
  assert.equal(JSON.parse(lib.readReadoutNote(saved, 'dashboard').json).title, 'Shop, renamed');
  assert.equal(plugin.dashboardTextIsLoaded(specs[0], saved), true, 'the echo of its own save is recognised');
});

test('a dashboard read from a .json is saved as its note, and the .json is left exactly as it was', async () => {
  const json = asJson(SPEC);
  const { plugin, adapter } = await setup({ [DIR + '/shop.json']: json });
  const { specs } = await plugin.loadDashboardSpecs();
  specs[0].title = 'Shop, edited';
  assert.equal(await plugin.saveDashboardSpec(specs[0]), true);
  assert.equal(adapter.files.get(DIR + '/shop.json'), json, 'the .json is not rewritten');
  assert.equal(JSON.parse(lib.readReadoutNote(adapter.files.get(DIR + '/shop.md'), 'dashboard').json).title, 'Shop, edited');
  assert.equal(specs[0].path, DIR + '/shop.md');
  const again = await plugin.loadDashboardSpecs();
  assert.deepEqual(unwrap(again.specs.map((s) => [s.title, s.path])), [['Shop, edited', DIR + '/shop.md']]);
});

test('a dashboard read from a .json whose name is taken by a note of the member\'s keeps saving to its .json', async () => {
  const { plugin, adapter } = await setup({ [DIR + '/shop.json']: asJson(SPEC), [DIR + '/shop.md']: 'my own words\n' });
  const { specs } = await plugin.loadDashboardSpecs();
  specs[0].title = 'Shop, edited';
  assert.equal(await plugin.saveDashboardSpec(specs[0]), true);
  assert.equal(adapter.files.get(DIR + '/shop.md'), 'my own words\n', 'never written over');
  assert.equal(JSON.parse(adapter.files.get(DIR + '/shop.json')).title, 'Shop, edited');
});

test('a save never overwrites a note that changed on disk since the dashboard was loaded, and a note that arrived beside the .json wins', async () => {
  const a = await setup({ [DIR + '/shop.md']: null });
  a.adapter.files.set(DIR + '/shop.md', note(lib, SPEC));
  const { specs } = await a.plugin.loadDashboardSpecs();
  const elsewhere = note(lib, Object.assign({}, SPEC, { title: 'Edited in Obsidian' }));
  a.adapter.files.set(DIR + '/shop.md', elsewhere);
  specs[0].title = 'From a stale form';
  notices.length = 0;
  assert.equal(await a.plugin.saveDashboardSpec(specs[0]), false);
  assert.equal(a.adapter.files.get(DIR + '/shop.md'), elsewhere);
  assert.ok(notices.some((n) => /changed on disk/.test(n)));

  const b = await setup({ [DIR + '/shop.json']: asJson(SPEC) });
  const loaded = await b.plugin.loadDashboardSpecs();
  const arrived = note(lib, Object.assign({}, SPEC, { title: 'Arrived through Sync' }));
  b.adapter.files.set(DIR + '/shop.md', arrived);
  loaded.specs[0].title = 'From a stale form';
  assert.equal(await b.plugin.saveDashboardSpec(loaded.specs[0]), false);
  assert.equal(b.adapter.files.get(DIR + '/shop.md'), arrived);
});

test('"Open as text" opens the dashboard note in Obsidian\'s own editor; a .json with a note beside it opens that note', async () => {
  const { plugin, leaf, opened } = await setup({
    [DIR + '/shop.md']: null,
    [DIR + '/old.json']: asJson(Object.assign({}, SPEC, { id: 'old' })),
    [DIR + '/old.md']: null,
    [DIR + '/lone.json']: asJson(Object.assign({}, SPEC, { id: 'lone' })),
  });
  plugin.app.vault.adapter.files.set(DIR + '/shop.md', note(lib, SPEC));
  plugin.app.vault.adapter.files.set(DIR + '/old.md', note(lib, Object.assign({}, SPEC, { id: 'old' })));
  await plugin.openDashboardAsText(DIR + '/shop.md', leaf);
  await plugin.openDashboardAsText(DIR + '/old.json', leaf);
  await plugin.openDashboardAsText(DIR + '/lone.json', leaf);
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), [
    DIR + '/shop.md',
    DIR + '/old.md',
    { type: 'readout-json', state: { file: DIR + '/lone.json', asText: true }, active: true },
  ]);
});

test('the file menu offers "Open as dashboard" on a dashboard note (by its properties) and not on other notes', async () => {
  const { plugin, fileMenus, frontmatter, fresh, adapter } = await setup();
  await adapter.write(DIR + '/shop.md', note(lib, SPEC));
  frontmatter[DIR + '/shop.md'] = { readout: 'dashboard' };
  frontmatter[DIR + '/cache.md'] = { readout: 'cache' };
  const opened = [];
  plugin.openDashboards = async (id) => { opened.push(id); };
  const offer = (path) => {
    const items = [];
    const menu = { addItem(fn) { const it = {}; const api = { setTitle(t) { it.title = t; return api; }, setIcon() { return api; }, setSection() { return api; }, onClick(f) { it.click = f; return api; } }; fn(api); items.push(it); return this; } };
    const file = new fresh.obsidian.TFile(path);
    for (const fn of fileMenus) fn(menu, file);
    return items.find((i) => i.title === 'Open as dashboard');
  };
  const item = offer(DIR + '/shop.md');
  assert.ok(item);
  await item.click();
  assert.deepEqual(opened, ['shop']);
  assert.equal(offer(DIR + '/README.md'), undefined);
  assert.equal(offer(DIR + '/cache.md'), undefined);
  assert.equal(offer('Elsewhere/shop.md'), undefined);
});

test('a level renamed in the settings is renamed inside the dashboard notes, keeping the words around the block', async () => {
  const spec = { id: 'lv', title: 'LV', database: '07 Databases/x.db', tiles: [{ title: 'T', viz: 'stat', y: 'n', sql: 'SELECT 1 AS n', ranges: [{ low: 1, level: 'Watch' }, { level: 'Alert' }] }] };
  const prose = '\nMy words.\n';
  const { plugin, adapter } = await setup({ [DIR + '/lv.md']: lib.writeReadoutNote('dashboard', JSON.stringify(spec, null, 2)) + prose });
  const r = await plugin.renameLevel('watch', 'Caution');
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.widgets, 1);
  const text = adapter.files.get(DIR + '/lv.md');
  assert.equal(JSON.parse(lib.readReadoutNote(text, 'dashboard').json).tiles[0].ranges[0].level, 'Caution');
  assert.equal(text.endsWith(prose), true);
});

test('folders typed by hand with a trailing slash, a backslash or doubled slashes work as the clean folder', async () => {
  const { plugin, adapter } = await setup({}, { dashboardFolder: 'My Stuff//Dash\\boards/', cacheFolder: ' Cache Here/ ' });
  assert.equal(plugin.settings.dashboardFolder, 'My Stuff/Dash/boards');
  assert.equal(plugin.settings.cacheFolder, 'Cache Here');
  await plugin.createDashboard();
  assert.deepEqual([...adapter.files.keys()], ['My Stuff/Dash/boards/dashboard-1.md']);
  assert.equal(lib.readReadoutNote(adapter.files.get('My Stuff/Dash/boards/dashboard-1.md'), 'dashboard').ok, true);
});

test('"Check this note as a dashboard" says whether the open note reads, in plain words', async () => {
  const { plugin, adapter, fresh } = await setup({
    [DIR + '/good.md']: note(lib, SPEC),
    [DIR + '/no-tiles.md']: lib.writeReadoutNote('dashboard', JSON.stringify({ id: 'x', title: 'X' })),
    [DIR + '/no-block.md']: '---\nreadout: dashboard\n---\n\nwords\n',
    [DIR + '/plain.md']: '# not ours\n',
  });
  const command = plugin.commands.find((c) => c.id === 'check-dashboard-note');
  assert.ok(command, 'the command is registered');
  const say = async (path) => {
    plugin.app.workspace.getActiveFile = () => (path ? new fresh.obsidian.TFile(path) : null);
    notices.length = 0;
    const available = command.checkCallback(true);
    if (available) { command.checkCallback(false); await new Promise((r) => setTimeout(r, 10)); }
    return { available, said: notices.slice() };
  };
  assert.deepEqual(await say(null), { available: false, said: [] });
  assert.equal((await say(DIR + '/image.png')).available, false, 'only notes');
  assert.deepEqual(unwrap((await say(DIR + '/good.md')).said), ['The dashboard reads fine: 1 widget.']);
  assert.match((await say(DIR + '/no-tiles.md')).said[0], /^The dashboard will not open like this: .*"tiles"/);
  assert.match((await say(DIR + '/no-block.md')).said[0], /^The dashboard will not open like this: .*no json block/);
  assert.match((await say(DIR + '/plain.md')).said[0], /not a ReadOut dashboard/);
  assert.ok(adapter);
});

test('"Open as text" on a note Obsidian has not listed yet says so, and never hands a note to the JSON view', async () => {
  const { plugin, leaf, opened } = await setup({});
  plugin.app.vault.getAbstractFileByPath = () => null;
  notices.length = 0;
  await plugin.openDashboardAsText(DIR + '/new.md', leaf);
  assert.deepEqual(opened, []);
  assert.equal(notices.some((n) => /has not listed new.md yet/.test(n)), true);
});
