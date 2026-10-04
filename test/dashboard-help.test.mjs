/* THE HELP FILE KEEPS UP WITH THE EDIT PANEL, AND THE AI GUIDE SHIPS BESIDE IT.
 *
 * The README.md the plugin writes into the dashboards folder is a help file
 * for people: it explains every setting, list and field of the edit panel,
 * per widget type, in the panel's own words, with the file reference last.
 * Beside it the plugin writes AI-WIDGET-GUIDE.md, for AI assistants asked
 * to build a widget. These gates keep both true and safe:
 *
 * - every label the panel can show is in the help file: the panel is drawn
 *   in each of its shapes with every group open (panel-labels.mjs), and
 *   each field label, group, button, tick box, row field, list choice,
 *   placeholder and picker choice must appear;
 * - the panel's own messages quoted in the help file are still the panel's;
 * - the walkthrough comes first and the JSON last;
 * - both files are refreshed only while they are the plugin's own unedited
 *   text, never once a member has edited them, and never rewritten when
 *   nothing changed;
 * - the repository mirrors are the files the plugin writes;
 * - the AI guide carries the rules, the procedure and every setting.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadPlugin, makeFakeAdapter, makeFakeVault } from './harness.mjs';
import { panelLabels } from './panel-labels.mjs';
import { SINK, DB, keysOf } from './guide-sink.mjs';

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

test('every label the edit panel can show is in the help file', async () => {
  const labels = await panelLabels();
  const floors = { field: 60, group: 9, button: 12, check: 6, row: 15, option: 85, placeholder: 30, picker: 4 };
  for (const [kind, set] of Object.entries(labels)) {
    assert.ok(set.size >= floors[kind], kind + ': the walk reached the panel (' + set.size + ')');
    const missing = [...set].filter((label) => !inHelp(label));
    assert.deepEqual(missing, [], kind + ' not in the help file: ' + missing.join(' | '));
  }
});

test('the panel messages the help file quotes are still the panel\'s own', () => {
  const quoted = [
    'leaves out what this widget had: ',
    'Change the type back to keep them.',
    'The preview ran. Save is open.',
    'The preview runs after each change; a widget saves only after its preview worked.',
    'Running the preview …',
    'The query ran but returned no rows. Check the filters and the period.',
    ' (not in settings)',
    ' (not in the result)',
    'Edit as SQL?',
    'The dashboard reads fine: ',
    'The dashboard will not open like this: ',
    'All filter rows must match (AND).',
    'No levels are set up yet. Add them in the plugin settings first.',
    'Changed for this widget',
    'Remove this widget?',
    'Open as text',
    'Done editing',
    'Create your first dashboard',
    'This widget is written in SQL. It runs read-only: one statement, starting with SELECT, WITH, PRAGMA or EXPLAIN.',
  ];
  for (const text of quoted) {
    assert.ok(MAIN.includes(text.trim()), 'the plugin still says: ' + text);
    assert.ok(inHelp(text.trim()), 'the help file quotes: ' + text);
  }
  for (const word of ['New widget', 'Edit widget', 'Add widget', 'Save widget', 'Cancel', 'Preview', 'Open as text', 'Edit this widget', 'New dashboard', 'Refresh', 'Range', 'Custom range', 'Apply', 'Add a level', 'Back to Good, Watch, Alert']) {
    assert.ok(MAIN.includes("'" + word + "'") || MAIN.includes("'" + word + ' '), 'the plugin has: ' + word);
    assert.ok(inHelp('"' + word), 'the help file names: ' + word);
  }
});

test('the help file starts with the walkthrough and keeps the JSON for the appendix', () => {
  const walk = HELP.indexOf('## Make your first widget');
  const appendix = HELP.indexOf('## Appendix: the dashboard file');
  const firstJson = HELP.indexOf('```json');
  assert.ok(walk > 0 && walk < HELP.indexOf('## A widget made with the panel\'s fields'), 'the walkthrough comes first');
  assert.match(HELP.slice(walk, walk + 2000), /pencil/, 'the walkthrough uses the pencil');
  assert.ok(appendix > walk && firstJson > appendix, 'no JSON before the appendix');
  assert.ok(HELP.indexOf('<!-- field reference -->') > appendix, 'the reference is the appendix');
  assert.match(HELP, /`AI-WIDGET-GUIDE\.md`/, 'the help file points at the AI guide');
});

test('every widget type has its own section in the panel\'s words', () => {
  for (const heading of ['### Line chart and bar chart', '### Bars and lines (combo)', '### One big number', '### Table', '### Part-to-whole bar (segments)', '### Heatmap', '## Text', '## Section divider', '## A widget made with the panel\'s fields', '## A widget written in SQL']) {
    assert.ok(HELP.includes('\n' + heading + '\n'), heading);
  }
  for (const family of ['### Colours', '### Value levels', '### Change and roll-up', '### Line, bar and scrub line colour', '### Meter under the number', '### Axis', '### Guide lines and zones', '### Band', '### Hint and footnote']) {
    assert.ok(HELP.includes('\n' + family), family);
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

  const older = lib.guideTextFor({ text: HELP.replace('# Dashboards: how to use the edit panel', '# Dashboards') }, '07 Databases');
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
  const pinned = { 'README.md': [1, '222cc051'], 'AI-WIDGET-GUIDE.md': [1, 'f2cb0693'] };
  for (const guide of lib.GUIDE_FILES) {
    assert.deepEqual([guide.revision, lib.guideHash(guide.text)], pinned[guide.file], guide.file);
  }
  assert.match(lib.guideTextFor(README_FILE, '07 Databases'), /\(revision 1, fingerprint [0-9a-f]{8}\)\. If you edit this file, the plugin stops updating it\. -->\n$/);
});

test('a guide is refreshed only forward, so two devices sharing a vault never rewrite each other\'s copy', async () => {
  const mine = lib.guideTextFor(README_FILE, '07 Databases');
  /* A device on a newer plugin wrote revision 2: this one leaves it. */
  const newer = lib.guideTextFor({ text: HELP + '\nNewer.\n', revision: 2 }, '07 Databases');
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
  const unrevised = body + '<!-- Written by the SQLite Viewer plugin (fingerprint ' + lib.guideHash(body.replace('# Dashboards: how to use the edit panel', '# Dashboards')) + '). If you edit this file, the plugin stops updating it. -->\n';
  const oldOwn = unrevised.replace('# Dashboards: how to use the edit panel', '# Dashboards');
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
    'a line added': text.replace('## Make your first widget', 'My own note.\n\n## Make your first widget'),
    'a word changed': text.replace('invented shop', 'invented bakery'),
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
  assert.equal(help, lib.guideTextFor(README_FILE, '07 Databases'));
  assert.equal(ai, lib.guideTextFor(AI_FILE, '07 Databases'));
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
