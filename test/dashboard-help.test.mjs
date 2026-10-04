/* THE HELP FILE KEEPS UP WITH THE WIDGET SETTINGS, AND THE AI GUIDE SHIPS BESIDE IT.
 *
 * The README.md the plugin writes into the dashboards folder is a widget
 * reference for people: what each widget type shows, what it is good for,
 * and what each of its settings in the edit panel does, in the panel's own
 * words. The dashboard around the widgets, picking data from a table, the
 * time range and the dashboard file are not its subject: the file format
 * lives in AI-WIDGET-GUIDE.md, which the plugin writes beside it for AI
 * assistants asked to build a widget. These gates keep both true and safe:
 *
 * - every widget setting the panel can show is in the help file: the panel
 *   is drawn in each of its shapes with every group open (panel-labels.mjs)
 *   and each label must appear, except the few the help file leaves out on
 *   purpose (OMITTED below); a new setting that is neither fails;
 * - every label the help file quotes is still one the panel shows;
 * - the help file has no file-format reference and points at the AI guide;
 * - both files are refreshed only while they are the plugin's own unedited
 *   text, never once a member has edited them, and never rewritten when
 *   nothing changed;
 * - the repository mirrors are the files the plugin writes, the help file
 *   with each live sample swapped for its light and dark picture;
 * - the AI guide carries the rules, the procedure and every setting.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { loadPlugin, makeFakeAdapter, makeFakeVault } from './harness.mjs';
import { panelLabels } from './panel-labels.mjs';
import { SINK, DB, keysOf } from './guide-sink.mjs';
import { helpMirrorOf, imageOf } from './help-mirror.mjs';

const { lib, PluginClass, obsidian } = loadPlugin();
const vaultOf = (adapter) => makeFakeVault(adapter, obsidian.TFile);
const HELP = lib.DASHBOARD_README;
/* Markdown reads a line break inside a paragraph as a space, so the help
 * file is searched with its lines joined. */
const flat = (text) => String(text).replace(/\s+/g, ' ');
const HELP_FLAT = flat(HELP);
const inHelp = (text) => HELP_FLAT.includes(flat(text));
const AI = lib.AI_WIDGET_GUIDE;
const MAIN = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const README_FILE = lib.GUIDE_FILES.find((g) => g.file === 'README.md');
const AI_FILE = lib.GUIDE_FILES.find((g) => g.file === 'AI-WIDGET-GUIDE.md');

/* ----------------------------------------------------- the help file -- */

/* The panel labels the help file leaves out on purpose: they are not a
 * widget's own settings. Picking data from a table (the built form's
 * fields, their choices and filter conditions), the time frame and its
 * choices, the chart type, the "Advanced" group, the buttons that switch
 * to another kind of widget, an empty column list, and placeholders that
 * only show an example. Anything the panel shows that is neither here nor
 * in the help file fails the gate: a new widget setting must be documented
 * (or, if it is truly not a widget setting, listed here). */
const OMITTED = {
  'data-picking fields': ['Database', 'Date', 'Dimension', 'Group by', 'Filter data', 'Add it up', '+ Add filter'],
  'data-picking choices': ['Add up', 'Count rows', 'Latest value', 'No split', 'The date'],
  'filter conditions': ['contains', 'does not contain', 'greater than', 'at least', 'less than', 'at most', 'is empty'],
  'time frame': ['Time frame', 'Follow the dashboard', 'Last 7 days', 'Last 30 days', 'Last 90 days', 'Last 12 months', 'All time'],
  'chart type': ['Chart type', 'Bar chart'],
  'the Advanced group': ['Advanced'],
  'switching to another kind of widget': ['Edit as SQL', 'Write SQL instead', 'Add text instead', 'Add a section divider instead'],
  'an empty column list': ['Pick a column'],
  'example placeholders': ['SQL widget', 'orders, %, hours …', 'Sales, Costs, Projects …'],
};
const OMITTED_SET = new Set(Object.values(OMITTED).flat());

test('every widget setting the edit panel can show is in the help file, apart from the deliberate omissions', async () => {
  const labels = await panelLabels();
  const floors = { field: 60, group: 9, button: 12, check: 6, row: 15, option: 85, placeholder: 30, picker: 4 };
  const shown = new Set();
  for (const [kind, set] of Object.entries(labels)) {
    assert.ok(set.size >= floors[kind], kind + ': the walk reached the panel (' + set.size + ')');
    for (const label of set) shown.add(label);
    const missing = [...set].filter((label) => !OMITTED_SET.has(label) && !inHelp(label));
    assert.deepEqual(missing, [], kind + ' not in the help file: ' + missing.join(' | '));
  }
  /* The omissions name only what the panel still shows, so the list
   * cannot hide a label that is gone. */
  const stale = [...OMITTED_SET].filter((label) => !shown.has(label));
  assert.deepEqual(stale, [], 'omitted but no longer in the panel: ' + stale.join(' | '));
});

test('a new widget setting that the help file does not document fails the gate', async () => {
  /* Negative control: a panel with one more labelled field than today. */
  const labels = await panelLabels();
  labels.field.add('Wobble the bars');
  const missing = [...labels.field].filter((label) => !OMITTED_SET.has(label) && !inHelp(label));
  assert.deepEqual([...missing], ['Wobble the bars']);
});

test('every label the help file quotes is still one the panel shows', async () => {
  const labels = await panelLabels();
  const shown = new Set(Object.values(labels).flatMap((set) => [...set]));
  const quoted = [...new Set([...HELP.matchAll(/"([^"\n]+)"/g)].map((m) => m[1]))];
  assert.ok(quoted.length > 100, 'the help file quotes the panel (' + quoted.length + ')');
  /* A few quoted words are the panel's but not drawn by the walk: the
   * size choices on a new widget, a level name. MAIN catches those. */
  const gone = quoted.filter((q) => !shown.has(q) && !MAIN.includes(q));
  assert.deepEqual(gone, [], 'quoted but not in the panel: ' + gone.join(' | '));
});

test('the help file is the widget reference: no file format, and a pointer to the AI guide', () => {
  assert.equal(HELP.indexOf('```json'), -1, 'no JSON in the help file');
  assert.equal(HELP.indexOf('<!-- field reference -->'), -1, 'the field reference lives in the AI guide');
  assert.doesNotMatch(HELP, /"viz"|"tiles"|globalTimeframe/, 'no file keys');
  assert.match(HELP, /`AI-WIDGET-GUIDE\.md`/, 'the help file points at the AI guide');
  assert.match(HELP, /pencil/, 'it says where the settings are');
});

test('every widget type has its own section, and the shared settings theirs', () => {
  for (const heading of ['## Line chart and bar chart', '## Bars and lines (combo)', '## One big number', '## Table', '## Part-to-whole bar (segments)', '## Heatmap', '## Text', '## Section divider', '## Settings shared by several widgets']) {
    assert.ok(HELP.includes('\n' + heading + '\n'), heading);
  }
  for (const family of ['### Colours and scrub line', '### Number size', '### Value levels', '### Change and roll-up', '### Meter under the number', '### Axis', '### Guide lines and zones', '### Band', '### Hint and footnote']) {
    assert.ok(HELP.includes('\n' + family + '\n'), family);
  }
});

/* ------------------------------------------------- the refresh rule -- */

const PATH = '07 Databases/Dashboards/README.md';

test('a guide is written when missing, left alone when current, refreshed when the plugin\'s text changed', async () => {
  const text = lib.guideTextFor(README_FILE, '07 Databases');
  assert.match(text, /fingerprint [0-9a-f]{8}\)\. If you edit this file, the plugin stops updating it\. -->\n$/);
  assert.equal(lib.guideIsPluginOwn(text, [], '07 Databases'), true, 'a fresh copy is the plugin\'s own');
  const aiText = lib.guideTextFor(AI_FILE, '07 Databases');
  assert.equal(lib.guideIsPluginOwn(aiText, [], '07 Databases'), true);

  const adapter = makeFakeAdapter();
  assert.equal(await lib.refreshGuideFile(vaultOf(adapter), PATH, text, [], '07 Databases'), 'written');
  assert.equal(await lib.refreshGuideFile(vaultOf(adapter), PATH, text, [], '07 Databases'), 'current');
  assert.equal(adapter.log.filter(([op]) => op === 'write').length, 1, 'nothing rewritten when nothing changed');

  const older = lib.guideTextFor({ text: HELP.replace('# Dashboard widgets', '# Widgets') }, '07 Databases');
  adapter.files.set(PATH, older);
  assert.equal(await lib.refreshGuideFile(vaultOf(adapter), PATH, text, [], '07 Databases'), 'refreshed');
  assert.equal(adapter.files.get(PATH), text);

  adapter.files.set(PATH, text.replace(/\n/g, '\r\n'));
  assert.equal(await lib.refreshGuideFile(vaultOf(adapter), PATH, text, [], '07 Databases'), 'current', 'line endings changed by a sync tool are not an edit');
});

test('each guide\'s revision is pinned to its text: change the text, raise the revision', () => {
  /* Two devices on the same revision leave each other's copy alone, so
   * the same revision must mean the same text. When this fails, raise the
   * guide's revision in GUIDE_FILES and pin the new hash here. */
  const pinned = { 'README.md': [3, '1e371e6c'], 'AI-WIDGET-GUIDE.md': [3, '54e082ad'] };
  for (const guide of lib.GUIDE_FILES) {
    assert.deepEqual([guide.revision, lib.guideHash(guide.text)], pinned[guide.file], guide.file);
  }
  assert.match(lib.guideTextFor(README_FILE, '07 Databases'), /\(revision 3, fingerprint [0-9a-f]{8}\)\. If you edit this file, the plugin stops updating it\. -->\n$/);
});

test('a guide is refreshed only forward, so two devices sharing a vault never rewrite each other\'s copy', async () => {
  const mine = lib.guideTextFor(README_FILE, '07 Databases');
  /* A device on a newer plugin wrote the next revision: this one leaves it. */
  const newer = lib.guideTextFor({ text: HELP + '\nNewer.\n', revision: README_FILE.revision + 1 }, '07 Databases');
  let adapter = makeFakeAdapter({ [PATH]: newer });
  assert.equal(await lib.refreshGuideFile(vaultOf(adapter), PATH, mine, README_FILE.legacy, '07 Databases'), 'newer');
  assert.equal(adapter.files.get(PATH), newer, 'never replaced by an older revision');

  /* Same revision, another data folder setting: the other device's copy stays. */
  const other = lib.guideTextFor(README_FILE, 'Data');
  adapter = makeFakeAdapter({ [PATH]: other });
  assert.equal(await lib.refreshGuideFile(vaultOf(adapter), PATH, mine, README_FILE.legacy, '07 Databases'), 'current');
  assert.equal(adapter.files.get(PATH), other);

  /* Two devices taking turns at loading, each with its own folder: one write in all. */
  adapter = makeFakeAdapter();
  for (let i = 0; i < 4; i++) {
    const folder = i % 2 ? 'Data' : '07 Databases';
    await lib.refreshGuideFile(vaultOf(adapter), PATH, lib.guideTextFor(README_FILE, folder), README_FILE.legacy, folder);
  }
  assert.equal(adapter.log.filter(([op]) => op === 'write').length, 1, 'written once, then left alone by both');

  /* A copy from before revisions (the fingerprint line alone) is revision 0. */
  const body = mine.replace(/<!-- Written by[^\n]*\n$/, '');
  const unrevised = body + '<!-- Written by the SQLite Viewer plugin (fingerprint ' + lib.guideHash(body.replace('# Dashboard widgets', '# Widgets')) + '). If you edit this file, the plugin stops updating it. -->\n';
  const oldOwn = unrevised.replace('# Dashboard widgets', '# Widgets');
  assert.equal(lib.guideRevision(oldOwn), 0);
  assert.equal(lib.guideIsPluginOwn(oldOwn, [], '07 Databases'), true, 'still recognised as the plugin\'s own');
  adapter = makeFakeAdapter({ [PATH]: oldOwn });
  assert.equal(await lib.refreshGuideFile(vaultOf(adapter), PATH, mine, README_FILE.legacy, '07 Databases'), 'refreshed');
  assert.equal(adapter.files.get(PATH), mine);
});

test('the data folder is written into a guide exactly as it is named, "$" included', () => {
  const text = lib.guideTextFor({ text: 'Files live in 07 Databases/Dashboards.\n' }, "Data $& $' and $`");
  assert.ok(text.startsWith("Files live in Data $& $' and $`/Dashboards.\n"), text.split('\n')[0]);
  assert.equal(lib.guideIsPluginOwn(text, [], "Data $& $' and $`"), true);
});

test('an edited guide is never overwritten, wherever the edit is', async () => {
  const text = lib.guideTextFor(README_FILE, '07 Databases');
  const newer = lib.guideTextFor({ text: HELP + '\nMore.\n' }, '07 Databases');
  const edits = {
    'a line added': text.replace('## Table', 'My own note.\n\n## Table'),
    'a word changed': text.replace('Revenue per day', 'Takings per day'),
    'the fingerprint line removed': text.replace(/<!-- Written by[^\n]*\n$/, ''),
    'the fingerprint changed': text.replace(/fingerprint [0-9a-f]{8}/, 'fingerprint 00000000'),
    'a property added': text.replace('status: active\n', 'status: active\nmine: yes\n'),
  };
  for (const [what, edited] of Object.entries(edits)) {
    const adapter = makeFakeAdapter({ [PATH]: edited });
    assert.equal(await lib.refreshGuideFile(vaultOf(adapter), PATH, newer, README_FILE.legacy, '07 Databases'), 'kept', what);
    assert.equal(adapter.files.get(PATH), edited, what + ': untouched');
  }
});

test('a copy from before the fingerprint is refreshed only when it is an old plugin text, word for word', async () => {
  const text = lib.guideTextFor(README_FILE, '07 Databases');
  /* The text the previous version wrote: this help file before the panel
   * rewrite, recognised by its whole-text hash. */
  const legacyHash = README_FILE.legacy[README_FILE.legacy.length - 1];
  const fake = 'An old plugin text.\n';
  assert.equal(lib.guideIsPluginOwn(fake, [lib.guideHash(fake)], '07 Databases'), true);
  assert.equal(lib.guideIsPluginOwn(fake + 'x', [lib.guideHash(fake)], '07 Databases'), false);
  assert.equal(lib.guideIsPluginOwn('Mine.\n', README_FILE.legacy, '07 Databases'), false);
  assert.match(legacyHash, /^[0-9a-f]{8}$/);
  /* Written for another data folder, the old text is still recognised. */
  const other = 'Files live in 07 Databases/Dashboards.\n';
  const asWritten = other.replace(/07 Databases/g, 'Data');
  assert.equal(lib.guideIsPluginOwn(asWritten, [lib.guideHash(other)], 'Data'), true);
  const adapter = makeFakeAdapter({ [PATH]: fake });
  assert.equal(await lib.refreshGuideFile(vaultOf(adapter), PATH, text, [lib.guideHash(fake)], '07 Databases'), 'refreshed');
});

test('the guides are written through the Vault API, never behind its back through the adapter', async () => {
  const adapter = makeFakeAdapter({}, { '07 Data/engagement.db': new Uint8Array([1]) });
  const fresh = loadPlugin();
  const vault = makeFakeVault(adapter, fresh.obsidian.TFile);
  const through = [];
  /* The vault's own writes go straight to the files; a note written
   * through the adapter is refused. */
  vault.create = async (p, text) => { through.push(['create', p]); adapter.files.set(p, text); return new fresh.obsidian.TFile(p); };
  vault.process = async (f, fn) => { through.push(['process', f.path]); const next = fn(adapter.files.get(f.path)); adapter.files.set(f.path, next); return next; };
  const write = adapter.write;
  adapter.write = async (p, text) => { if (/\.md$/.test(p)) throw new Error('a note written through the adapter: ' + p); return write(p, text); };
  const app = { vault, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  plugin.app = app;
  await plugin.onload();
  await plugin.ensureStarterFiles();
  const folder = plugin.settings.dashboardFolder;
  assert.deepEqual(through.map(([op, p]) => op + ' ' + p).sort(), ['create ' + folder + '/AI-WIDGET-GUIDE.md', 'create ' + folder + '/README.md']);
  /* An old plugin copy is refreshed through Vault.process. */
  adapter.files.set(folder + '/README.md', fresh.lib.guideTextFor({ text: 'Old.\n' }, plugin.settings.dataFolder));
  await plugin.ensureStarterFiles();
  assert.deepEqual(through.slice(2).map(([op, p]) => op + ' ' + p), ['process ' + folder + '/README.md']);
  assert.equal(adapter.files.get(folder + '/README.md'), fresh.lib.guideTextFor(fresh.lib.GUIDE_FILES[0], plugin.settings.dataFolder));
});

test('a guide edit that lands between the read and the write is never overwritten', async () => {
  const mine = lib.guideTextFor(README_FILE, '07 Databases');
  const old = lib.guideTextFor({ text: 'Old.\n' }, '07 Databases');
  const adapter = makeFakeAdapter({ [PATH]: old });
  const vault = vaultOf(adapter);
  const process = vault.process;
  /* The member saves an edit just as the refresh starts. */
  vault.process = async (f, fn) => { adapter.files.set(PATH, 'My own words.\n'); return process(f, fn); };
  assert.equal(await lib.refreshGuideFile(vault, PATH, mine, [], '07 Databases'), 'kept');
  assert.equal(adapter.files.get(PATH), 'My own words.\n');
});

test('a guide on disk that the vault does not index is left alone, and a failed guide never stops the starters', async () => {
  const adapter = makeFakeAdapter({ [PATH]: 'Something.\n' });
  const vault = vaultOf(adapter);
  vault.getAbstractFileByPath = () => null;
  assert.equal(await lib.refreshGuideFile(vault, PATH, lib.guideTextFor(README_FILE, '07 Databases'), [], '07 Databases'), 'kept');
  assert.equal(adapter.files.get(PATH), 'Something.\n');

  const disk = makeFakeAdapter({}, { '07 Data/engagement.db': new Uint8Array([1]) });
  const fresh = loadPlugin();
  const broken = makeFakeVault(disk, fresh.obsidian.TFile);
  broken.create = async () => { throw new Error('no room'); };
  const app = { vault: broken, workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const plugin = fresh.makePlugin(app);
  plugin.app = app;
  await plugin.onload();
  await plugin.ensureStarterFiles();
  assert.ok(disk.files.has(plugin.settings.dashboardFolder + '/engagement-overview.json'), 'the starter is still seeded');
});

test('the plugin writes both guides on load, then leaves them alone', async () => {
  const adapter = makeFakeAdapter();
  const fresh = loadPlugin();
  const app = { vault: makeFakeVault(adapter, fresh.obsidian.TFile), workspace: { onLayoutReady: () => {}, on: () => ({}) } };
  const { makePlugin } = fresh;
  const plugin = makePlugin(app);
  plugin.app = app;
  await plugin.onload();
  await plugin.ensureStarterFiles();
  const folder = plugin.settings.dashboardFolder;
  const writes = () => adapter.log.filter(([op, p]) => op === 'write' && /\.md$/.test(p)).map(([, p]) => p);
  assert.deepEqual(writes().sort(), [folder + '/AI-WIDGET-GUIDE.md', folder + '/README.md']);
  assert.equal(adapter.files.get(folder + '/README.md'), lib.guideTextFor(README_FILE, plugin.settings.dataFolder));
  await plugin.ensureStarterFiles();
  assert.equal(writes().length, 2, 'a second load writes nothing');
  void PluginClass;
});

test('the old help files recognised are the four texts released versions wrote', () => {
  /* Only texts that shipped count: a text that never left a local build
   * would make a member's copy that happens to match it look unedited. */
  assert.deepEqual([...README_FILE.legacy], ['ac2ce38f', '110587e1', '187f3e85', '9b05f8bf'], 'the four upstream texts, nothing local');
  assert.equal(AI_FILE.legacy.length, 0, 'the AI guide is new: every copy carries a fingerprint');
});

/* -------------------------------------------------------- the mirrors -- */

test('the repository mirrors are the files the plugin writes', () => {
  const help = readFileSync(new URL('../DASHBOARD-HELP.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const ai = readFileSync(new URL('../AI-WIDGET-GUIDE.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(help, helpMirrorOf(lib.guideTextFor(README_FILE, '07 Databases')), 'DASHBOARD-HELP.md is the help file with pictures for samples');
  assert.equal(ai, lib.guideTextFor(AI_FILE, '07 Databases'));
});

test('the guides are read inside a vault: a repository they name is the plugin\'s on GitHub', () => {
  /* A member's vault has no repository, so "the repository README" points
   * nowhere there. Any paragraph that names a repository also says GitHub. */
  const REPO = /\brepo(s|sitory|sitories)?\b/i;
  for (const guide of lib.GUIDE_FILES) {
    for (const para of guide.text.split(/\n\s*\n/).map(flat)) {
      if (REPO.test(para)) assert.match(para, /GitHub/, guide.file + ': ' + para.slice(0, 120));
    }
  }
  assert.ok(flat(AI).includes("The plugin's README on GitHub carries the same reference."), 'section 8 points at the README on GitHub');
});

test('the GitHub help file shows a light and a dark picture for every sample, and every picture is in the repository', () => {
  const help = readFileSync(new URL('../DASHBOARD-HELP.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.doesNotMatch(help, /```sqlite-viewer-sample/, 'no bare sample block on GitHub');
  const pictures = [...help.matchAll(/<picture>\n {2}<source media="\(prefers-color-scheme: dark\)" srcset="([^"]+)">\n {2}<img alt="[^"]+" src="([^"]+)" width="600">\n<\/picture>/g)];
  assert.equal(pictures.length, [...lib.VIZ_KINDS].length, 'one picture per widget type');
  for (const [, dark, light] of pictures) {
    for (const file of [dark, light]) assert.ok(existsSync(new URL('../' + file, import.meta.url)), 'in the repository: ' + file);
  }
  for (const word of lib.VIZ_KINDS) assert.ok(help.includes(imageOf(word, 'light')) && help.includes(imageOf(word, 'dark')), word);
  /* The swap itself: a sample block becomes a picture; anything else stays. */
  const one = helpMirrorOf('A\n\n```sqlite-viewer-sample\nbar\n```\n\n```sqlite-viewer-sample\npie\n```\n');
  assert.ok(one.startsWith('A\n\n<picture>\n') && one.includes('srcset="docs/images/widget-bar-dark.png"') && one.includes('src="docs/images/widget-bar-light.png"'));
  assert.ok(one.endsWith('```sqlite-viewer-sample\npie\n```\n'), 'an unknown word is left as it is');
});

/* ------------------------------------------------------- the AI guide -- */

test('the AI guide carries the rules and the procedure', () => {
  for (const rule of [/`dashboardFolder`/, /Read-only/, /One database per dashboard/, /No ATTACH/, /plugin's engine/, /5,000 rows/, /Query timeout \(seconds\)/,
    /newest data row/, /SELECT MAX\(day\) FROM sales/, /Never leave test widgets/, /"Open as text"/, /The dashboard reads fine: N widgets\./, /`Good`, `Watch` and `Alert`/, /pencil/]) {
    assert.match(AI, rule);
  }
  const steps = ['Read the schema, read-only', 'Write the query and test it', 'Write the widget', 'Validate', 'Open the dashboard and look', 'Open it in the edit panel', 'Clean up'];
  let at = 0;
  for (const step of steps) { const i = AI.indexOf(step, at); assert.ok(i > at, 'in order: ' + step); at = i; }
  assert.doesNotMatch(AI, /myPKA|ICOR for Life vault|Larry/, 'generic: no team or vault of its own');
});

test('the AI guide names every widget type and every setting the plugin writes', () => {
  for (const viz of lib.VIZ_KINDS) assert.ok(AI.includes('`' + viz + '`'), viz);
  const spec = { id: 'sink', title: 'Sink', database: DB, globalTimeframe: { preset: '90d' }, tiles: SINK };
  const parsed = lib.parseDashboardSpec(JSON.stringify(spec));
  assert.equal(parsed.ok, true, parsed.reason);
  const keys = keysOf(JSON.parse(lib.specToJson(parsed.spec)), new Set());
  const missing = [...keys].filter((k) => !new RegExp('\\b' + k + '\\b').test(AI));
  assert.deepEqual(missing, [], 'named in the AI guide: ' + missing.join(', '));
});

test('the AI guide says what each type\'s query must return', () => {
  const shapes = AI.slice(AI.indexOf('## 5. What each query must return'), AI.indexOf('## 6.'));
  for (const viz of ['line', 'stat', 'table', 'combo', 'segments', 'heatmap', 'text']) assert.ok(shapes.includes('`' + viz + '`'), viz);
});
