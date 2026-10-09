/* The harness every ReadOut gate loads the real main.js through.
 *
 * An `obsidian` module stub, just enough of the API for main.js to load and
 * for the plugin class to be constructed. The gates measure the pure library
 * and the engines with injected fakes; no real database and no real process
 * is ever started here. `loadPlugin()` runs main.js inside a vm context with
 * `require('obsidian')` answered by the stub and every other require
 * answered by Node, which is what the plugin sees on the desktop.
 * `Platform.isDesktopApp` is a switch so the mobile path can be measured
 * too.
 *
 * One realm note, learned on the Sync gates: arrays made inside the vm have
 * the sandbox's Array prototype and fail strict deepEqual against literals.
 * `unwrap()` deep-copies a value into the test realm first.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(repo, 'main.js'), 'utf8');
const nodeRequire = createRequire(import.meta.url);

export const notices = [];
export const noticeObjects = [];

/* ------------------------------------------------------------ fake DOM -- */

class FakeEl {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attrs = Object.create(null);
    this.classSet = new Set();
    this.handlers = Object.create(null);
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.style = { setProperty(k, v) { this[k] = String(v); }, removeProperty(k) { delete this[k]; } };
  }
  /* Obsidian gives every node its window as `win`, a popout's window in a
   * popout. Here it is inherited from the parent, so a gate sets it once on
   * a root. Undefined unless a gate sets it. */
  get win() { return this.ownWin !== undefined ? this.ownWin : (this.parentElement ? this.parentElement.win : undefined); }
  set win(w) { this.ownWin = w; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addClass(c) { this.classSet.add(c); }
  get classList() {
    const s = this.classSet;
    return { add: (...c) => { for (const x of c) s.add(x); }, remove: (...c) => { for (const x of c) s.delete(x); }, contains: (c) => s.has(c) };
  }
  focus() { this.focused = true; }
  /* Like the DOM: a node lives in one place, so adding it moves it. */
  appendChild(node) { detach(node); node.parentElement = this; this.children.push(node); return node; }
  insertBefore(node, ref) {
    detach(node);
    node.parentElement = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(node); else this.children.splice(i, 0, node);
    return node;
  }
  get firstChild() { return this.children[0] || null; }
  addEventListener(type, fn) { (this.handlers[type] || (this.handlers[type] = [])).push(fn); }
  empty() { this.children = []; }
  setText(t) { this.textContent = String(t); }
  createDiv(opts) { return this.appendChild(makeEl('div', opts)); }
  createSpan(opts) { return this.appendChild(makeEl('span', opts)); }
  createEl(tag, opts) { return this.appendChild(makeEl(tag, opts)); }
  * walk() { for (const child of this.children) { yield child; yield* child.walk(); } }
}

function detach(node) {
  const p = node.parentElement;
  if (!p) return;
  const i = p.children.indexOf(node);
  if (i >= 0) p.children.splice(i, 1);
}

function makeEl(tag, opts = {}) {
  const el = new FakeEl(tag);
  if (opts && typeof opts === 'object') {
    if (opts.cls) for (const c of String(opts.cls).split(/\s+/).filter(Boolean)) el.classSet.add(c);
    if (opts.attr) for (const [k, v] of Object.entries(opts.attr)) el.attrs[k] = String(v);
    if (opts.text) el.textContent = String(opts.text);
    if (opts.type) el.attrs.type = String(opts.type);
    if (opts.value !== undefined) el.value = String(opts.value);
  }
  return el;
}

/* ----------------------------------------------------------- the stub -- */

export function makeObsidian({ desktop = true } = {}) {
  const chain = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : chain()), apply: () => chain() });
  class Component {
    constructor() { this.events = []; }
    registerEvent(e) { this.events.push(e); }
  }
  class ItemView extends Component {
    constructor(leaf) { super(); this.leaf = leaf; this.contentEl = makeEl('div'); this.containerEl = makeEl('div'); this.app = leaf ? leaf.app : undefined; }
  }
  class FileView extends ItemView {
    constructor(leaf) { super(leaf); this.file = null; }
  }
  class TFile { constructor(path) { this.path = path; } }
  /* A rendered block's owner: Obsidian calls onload when the block is
   * added and onunload when the note goes; a gate calls them by hand. */
  class MarkdownRenderChild extends Component {
    constructor(containerEl) { super(); this.containerEl = containerEl; }
    onload() {}
    onunload() {}
  }
  return {
    Plugin: class extends Component {
      constructor(app, manifest) { super(); this.app = app; this.manifest = manifest; this.saved = null; }
      async loadData() { return this.saved === null ? null : JSON.parse(JSON.stringify(this.saved)); }
      async saveData(d) { this.saved = JSON.parse(JSON.stringify(d)); }
      registerView(type, factory) { (this.viewFactories || (this.viewFactories = {}))[type] = factory; }
      registerExtensions() {}
      addRibbonIcon() { return makeEl('div'); }
      addCommand(c) { (this.commands || (this.commands = [])).push(c); }
      addSettingTab() {}
      registerMarkdownCodeBlockProcessor(lang, handler) { (this.codeBlocks || (this.codeBlocks = {}))[lang] = handler; }
    },
    PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = makeEl('div'); } },
    Setting: class { constructor() { return chain(); } },
    Modal: class { constructor(app) { this.app = app; this.contentEl = makeEl('div'); this.titleEl = makeEl('div'); this.modalEl = makeEl('div'); } open() { this.opened = true; if (this.onOpen) this.onOpen(); } close() { this.closed = true; if (this.onClose) this.onClose(); } },
    Notice: class { constructor(msg) { this.msg = msg; this.noticeEl = makeEl('div'); this.hidden = false; notices.push(String(msg)); noticeObjects.push(this); } hide() { this.hidden = true; } },
    Platform: { isDesktopApp: desktop, isMobile: !desktop, isMobileApp: !desktop, isMacOS: true, isWin: false, isLinux: false },
    setIcon: (el, icon) => { el.attrs['data-icon'] = icon; },
    normalizePath: (p) => String(p).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, ''),
    ItemView, FileView, TFile, MarkdownRenderChild,
    TFolder: class {},
  };
}

/* Load main.js. Returns the plugin class, the pure library it exposes for
 * the gates, and a `makePlugin(app)` that constructs an instance.
 * `sourceOverride` loads a mutated copy of main.js instead, so a gate can
 * prove its guard owns the refusal rather than passing vacuously. */
export function loadPlugin({ desktop = true, sourceOverride = null, globals = {} } = {}) {
  const obsidian = makeObsidian({ desktop });
  const body = makeEl('body');
  const doc = {
    body,
    createElement: (tag) => makeEl(tag),
    createElementNS: (ns, tag) => makeEl(tag),
  };
  const sandbox = {
    require: (name) => (name === 'obsidian' ? obsidian : (sandbox.requireHook ? sandbox.requireHook(name) : nodeRequire(name))),
    module: { exports: {} },
    document: doc,
    window: { setTimeout, clearTimeout },
    navigator: { clipboard: { writeText: async () => {} } },
    Function,
    encodeURIComponent, decodeURIComponent, JSON, Date, Math, Number, String, Array, Object, Map, Set, Promise, Buffer, Error, RegExp, Uint8Array,
    console, setTimeout, clearTimeout, process, URL,
    /* What sql-wasm.js needs when the wasm gate loads it for real. */
    WebAssembly, TextDecoder, TextEncoder, performance,
  };
  /* Extra globals a gate needs, e.g. a fake ResizeObserver. */
  Object.assign(sandbox, globals);
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(sourceOverride || source, sandbox, { filename: 'main.js' });
  const PluginClass = sandbox.module.exports;
  return {
    PluginClass,
    lib: PluginClass.lib,
    obsidian,
    /* `saved` is what data.json holds. Left out, it is the settings of a
     * vault that has been set up (the ICOR for Life folders, JSON claimed),
     * which is what most gates draw against. Pass `null` for a true fresh
     * install, or an object to say exactly what is saved on top of those. */
    makePlugin(app, saved = undefined) {
      const plugin = new PluginClass(app, { id: 'readout', version: '0.0.0-gate', dir: '.obsidian/plugins/readout' });
      plugin.saved = saved === null ? null : Object.assign({}, SET_UP_VAULT, saved || {});
      return plugin;
    },
  };
}

/* The folders and the JSON claim a set-up vault has saved. */
export const SET_UP_VAULT = {
  dataFolder: '07 Databases',
  dashboardFolder: '07 Databases/Dashboards',
  cacheFolder: '07 Databases/Dashboard Cache',
  openJsonFiles: true,
};

/* A small dashboard file, for the gates that need one to exist (the plugin
 * ships none of its own). Its place is the set-up vault's dashboards folder. */
export const FIXTURE_DASHBOARD_PATH = '07 Databases/Dashboards/engagement-overview.json';
export const FIXTURE_DASHBOARD = {
  id: 'engagement-overview',
  title: 'Engagement',
  database: '07 Databases/engagement.db',
  tiles: [
    { title: 'Total', viz: 'stat', y: 'total', sql: 'SELECT COUNT(*) AS total FROM events' },
    { title: 'Per day', viz: 'line', x: 'day', y: ['n'], sql: 'SELECT day, COUNT(*) AS n FROM events GROUP BY day ORDER BY day' },
    { title: 'Latest', viz: 'table', sql: 'SELECT * FROM events ORDER BY day DESC LIMIT 10' },
  ],
};
export const FIXTURE_DASHBOARD_FILES = { [FIXTURE_DASHBOARD_PATH]: JSON.stringify(FIXTURE_DASHBOARD, null, 2) + '\n' };

/* Deep-copy a sandbox-realm value into the test realm so deepEqual works. */
export function unwrap(value) { return JSON.parse(JSON.stringify(value)); }

/* The Vault API over a fake adapter, for the gates that write notes: a
 * TFile for every file the adapter holds, read, create (refused when the
 * file exists, like Obsidian) and process, each going through the
 * adapter so its log shows every write. `TFile` is the stub's class from
 * the same loadPlugin() call, so main.js's instanceof checks hold. */
export function makeFakeVault(adapter, TFile) {
  const sizeOf = (p) => (adapter.binaries.has(p) ? adapter.binaries.get(p).length : String(adapter.files.get(p) || '').length);
  const treeOf = (root) => {
    const prefix = root ? root + '/' : '';
    const folders = new Map([[root, { path: root, children: [] }]]);
    const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
    const ensure = (dir) => {
      if (folders.has(dir)) return folders.get(dir);
      const f = { path: dir, children: [] };
      folders.set(dir, f);
      ensure(parentOf(dir)).children.push(f);
      return f;
    };
    for (const p of [...adapter.files.keys(), ...adapter.binaries.keys()]) {
      if (prefix && !p.startsWith(prefix)) continue;
      const f = new TFile(p);
      f.stat = { size: sizeOf(p) };
      ensure(parentOf(p)).children.push(f);
    }
    return folders.get(root);
  };
  return {
    adapter,
    configDir: '.obsidian',
    /* The folder tree, built from what the adapter holds: a folder has a
     * children list, a file has a stat. */
    getRoot: () => treeOf(''),
    getAbstractFileByPath: (p) => {
      if (adapter.files.has(p) || adapter.binaries.has(p)) { const f = new TFile(p); f.stat = { size: sizeOf(p) }; return f; }
      const t = treeOf(p);
      return t.children.length ? t : null;
    },
    read: async (f) => adapter.read(f.path),
    async create(p, text) {
      if (adapter.files.has(p)) throw new Error('File already exists.');
      await adapter.write(p, text);
      return new TFile(p);
    },
    async process(f, fn) {
      const next = fn(await adapter.read(f.path));
      await adapter.write(f.path, next);
      return next;
    },
  };
}

/* An in-memory vault adapter for the migration and cache gates. Paths and
 * contents live in a Map; rename moves the entry; nothing touches disk. */
export function makeFakeAdapter(initialFiles = {}, initialBinaries = {}) {
  const files = new Map(Object.entries(initialFiles));
  const binaries = new Map(Object.entries(initialBinaries));
  const folders = new Set(['']);
  const log = [];
  return {
    files, binaries, folders, log,
    async exists(p) {
      if (files.has(p) || binaries.has(p) || folders.has(p)) return true;
      /* Like a real vault: a folder exists when something lives under it. */
      const prefix = p + '/';
      for (const key of files.keys()) if (key.startsWith(prefix)) return true;
      for (const key of binaries.keys()) if (key.startsWith(prefix)) return true;
      for (const key of folders) if (key.startsWith(prefix)) return true;
      return false;
    },
    async stat(p) {
      if (binaries.has(p)) return { size: binaries.get(p).length, mtime: 1 };
      return files.has(p) ? { size: (files.get(p) || '').length, mtime: 1 } : null;
    },
    async readBinary(p) { if (!binaries.has(p)) throw new Error('not found: ' + p); return binaries.get(p); },
    async mkdir(p) { folders.add(p); log.push(['mkdir', p]); },
    async read(p) { if (!files.has(p)) throw new Error('not found: ' + p); return files.get(p); },
    async write(p, text) { files.set(p, text); log.push(['write', p]); },
    async rename(from, to) {
      if (binaries.has(from)) {
        if (binaries.has(to) || files.has(to)) throw new Error('already exists: ' + to);
        binaries.set(to, binaries.get(from));
        binaries.delete(from);
        log.push(['rename', from, to]);
        return;
      }
      if (!files.has(from)) throw new Error('not found: ' + from);
      if (files.has(to)) throw new Error('already exists: ' + to);
      files.set(to, files.get(from));
      files.delete(from);
      log.push(['rename', from, to]);
    },
    async remove(p) {
      if (!files.has(p) && !binaries.has(p)) throw new Error('not found: ' + p);
      files.delete(p); binaries.delete(p);
      log.push(['remove', p]);
    },
    async list(p) {
      const out = { files: [], folders: [] };
      for (const key of files.keys()) if (key.startsWith(p + '/') && !key.slice(p.length + 1).includes('/')) out.files.push(key);
      return out;
    },
  };
}
