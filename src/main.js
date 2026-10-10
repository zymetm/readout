/* ReadOut
 *
 * Open, browse and chart the SQLite databases that live inside the vault,
 * read-only, on every device.
 *
 * The shape, in one paragraph. A vault can carry real databases next to its
 * notes: an Apple Health archive of fifteen million rows, an engagement log,
 * an analytics snapshot store. This plugin opens them where they are. Click
 * a `.db` file and a browser opens: tables with row counts, the schema, the
 * data page by page, and a console for your own read-only SQL. Dashboards
 * are small Markdown notes in the vault (properties plus their JSON in a
 * block); the plugin runs their queries and draws the charts itself, in the
 * vault's own colors. Nothing is ever written to
 * a database, by design and by a tested gate.
 *
 * THE ONE RULE: read, never write. Enforced twice. Every database is opened
 * read-only (the engine works on an in-memory copy, which cannot reach the
 * original file at all), and every statement passes a gate first:
 * exactly one statement, starting with SELECT, WITH, PRAGMA or EXPLAIN,
 * with ATTACH refused outright. The gate lives in the pure library and is
 * measured in test/gate.test.mjs.
 *
 * One engine, on every device:
 *
 *   sql.js, a WebAssembly build of SQLite
 *   vendored into the plugin (pinned in THIRD-PARTY-NOTICES.md). It loads
 *   the whole file into memory, so a size cap guards it (200 MB on a phone,
 *   1500 MB on a desktop, never above 2000 MB, the most a file read can
 *   return), with a plain explanation when a database is over the cap.
 *   ReadOut starts no program and opens no file outside Obsidian.
 *
 * Databases over the cap still reach the phone through the DASHBOARD CACHE:
 * when a dashboard renders on the desktop, its query results are written as
 * notes into the vault, Obsidian Sync carries them, and the phone renders
 * the same dashboard from the cache with a visible "computed on desktop"
 * line. The big file itself never travels.
 *
 * Three layers, top to bottom of this file:
 *
 *   1. A pure library: the statement gate, the row cap, query building for
 *      the browser, CSV export, dashboard spec parsing, database finding,
 *      chart scales. No Obsidian, no file system. Exposed as
 *      `ReadOutPlugin.lib` for the gates.
 *   2. The engine: the sql.js loader, with the query gate in front of it.
 *   3. The Obsidian surface: the database browser view, the dashboards
 *      view, the database index, the settings tab.
 *
 * Hand-written CommonJS, no runtime npm dependencies. This file is the
 * source: `npm run build` (build.mjs) copies it to the root main.js with the
 * sql.js engine and its wasm filled in at two placeholders. The one
 * vendored exception is sql.js (sql-wasm.js + sql-wasm.wasm, pinned
 * 1.13.0, MIT, see THIRD-PARTY-NOTICES.md). Plain words in every string the
 * member reads.
 */

'use strict';

const {
  Plugin, PluginSettingTab, Setting, Modal, Notice, Platform, setIcon,
  ItemView, FileView, TFile, TFolder, normalizePath, MarkdownRenderChild,
} = require('obsidian');

/* ------------------------------------------------------------ constants -- */

const MB = 1024 * 1024;
/* The built-in engine's size cap: 200 MB where memory is tight, 1500 MB on a
 * desktop, and never more than 2000 MB, the most a single file read returns. */
const PHONE_CAP_MB = 200;
const DESKTOP_CAP_MB = 1500;
const MAX_CAP_MB = 2000;
const DB_EXTS = new Set(['db', 'sqlite', 'sqlite3']);
const SIDECAR_RE = /\.(db|sqlite|sqlite3)-(wal|shm)$/i;
/* Folders nobody means, besides the vault's own config folder (which the
 * vault names, so it is passed in; see isSkippedPath). */
const SKIP_FOLDERS = new Set(['.git', '.trash']);
const ALLOWED_KEYWORDS = new Set(['select', 'with', 'pragma', 'explain']);
/* Statement verbs that write. Refused anywhere they appear as words in a
 * stripped statement, because a WITH prefix can lead into any of them. */
const WRITE_VERBS_RE = /\b(insert|update|delete|replace|create|drop|alter|reindex|vacuum|analyze)\b/i;
/* The read-only PRAGMA allowlist (introspection only). Everything else,
 * and every assignment form, is refused. */
const READ_PRAGMAS = new Set([
  'table_info', 'table_xinfo', 'table_list', 'index_list', 'index_info', 'index_xinfo',
  'foreign_key_list', 'database_list', 'collation_list', 'function_list', 'pragma_list',
  'compile_options', 'freelist_count', 'page_count', 'page_size', 'max_page_count',
  'schema_version', 'user_version', 'data_version', 'application_id',
  'integrity_check', 'quick_check', 'encoding', 'journal_size_limit',
]);
/* The introspection PRAGMAs that genuinely take a parenthesized argument,
 * a table or index name or a row cap, never a value being set. For every
 * other allowlisted name SQLite reads "PRAGMA name(value)" as a set, the
 * same write as "PRAGMA name = value", so the paren form is refused. */
const READ_PRAGMA_FUNCS = new Set([
  'table_info', 'table_xinfo', 'table_list', 'index_list', 'index_info', 'index_xinfo',
  'foreign_key_list', 'integrity_check', 'quick_check',
]);
const VIZ_KINDS = new Set(['line', 'bar', 'stat', 'table', 'divider', 'combo', 'scatter', 'bullet', 'segments', 'pie', 'heatmap', 'calendar', 'text']);
const VIEW_BROWSER = 'readout-browser';
const VIEW_DASHBOARDS = 'readout-dashboards';
const VIEW_JSON = 'readout-json';
/* A JSON file bigger than this is shown in part, never fully rendered. */
const JSON_RENDER_CAP = 2 * MB;
const JSON_SLICE = 200 * 1024;
/* Every SQLite database starts with these 16 bytes. A file with a
 * database-style name that does not (a Thumbs.db, a renamed text file) is
 * told apart before an engine is asked, so it reaches a member as a plain
 * sentence, never as an engine's error. */
const SQLITE_MAGIC = 'SQLite format 3\u0000';
const NOT_SQLITE_TEXT = "This file isn't a SQLite database. It has a database-style name, but its first bytes are not SQLite's, so it may be another kind of file (a thumbnail cache, a renamed document) or an encrypted database.";
/* Chart series colors per the INKLINE spec: a single
 * series is the ink writing (paper-dim); two or more take the four
 * category lenses; anything past the lenses renders faint. styles.css
 * maps each token to the theme with an Obsidian fallback. */
const SERIES_TOKEN_SINGLE = 'var(--sqlv-series-1)';
const SERIES_TOKEN_LENSES = [
  'var(--sqlv-series-2)', 'var(--sqlv-series-3)',
  'var(--sqlv-series-4)', 'var(--sqlv-series-5)',
];
const SERIES_TOKEN_FAINT = 'var(--sqlv-fg-faint)';
/* At most this many series render; past it the rest aggregate as Other. */
const SERIES_CEILING = 5;

/* Value levels on stat widgets (the rules live with levelOf). Colours
 * are a theme variable, so they follow light and dark, or a plain
 * hex a member picked. Nothing else passes, so a JSON file can never
 * smuggle CSS into the tile. */
const LEVEL_COLOR_RE = /^(#[0-9a-f]{6}|var\(--[a-z0-9-]+\))$/i;
const LEVEL_THEME_COLORS = [
  ['var(--color-green)', 'Green'], ['var(--color-orange)', 'Amber'], ['var(--color-red)', 'Red'],
  ['var(--color-yellow)', 'Yellow'], ['var(--color-cyan)', 'Cyan'], ['var(--color-blue)', 'Blue'],
  ['var(--color-purple)', 'Purple'], ['var(--color-pink)', 'Pink'],
];
/* Each level carries a stable id next to its name, so a rename in the
 * settings is told apart from a delete plus an add. */
const DEFAULT_LEVELS = [
  { id: 'good', name: 'Good', color: 'var(--color-green)' },
  { id: 'watch', name: 'Watch', color: 'var(--color-orange)' },
  { id: 'alert', name: 'Alert', color: 'var(--color-red)' },
];
const LEVEL_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
/* How a level shows, per widget type that marks the whole widget: a stat
 * and a segments bar. A segments bar follows the stat look unless it has
 * its own ("same"). A heatmap colours its cells and has no widget look. */
const LEVEL_LOOKS = {
  stat: { rail: 'Coloured left rail', outline: 'Coloured outline', tint: 'Tinted background' },
  segments: { same: 'Same as "One big number"', rail: 'Coloured left rail', outline: 'Coloured outline', tint: 'Tinted background' },
};
const DEFAULT_LEVEL_LOOKS = { stat: 'rail', segments: 'same' };
const LEVEL_NAME_MAX = 24;
const LEVEL_LABEL_MAX = 24;
const RANGES_MAX = 12;
/* A stat widget shows at most this many caption lines. */
const CAPTIONS_MAX = 4;

/* The stroke and fill for series i of n. Pure, so the rule is testable:
 * one series writes in ink, lenses carry categories, the fifth entry and
 * the Other bucket stay faint, and no sixth hue is ever invented. */
/* A one-series chart with its own "color" draws in it; every other chart
 * keeps the theme's series colours. */
function chartPaletteFor(tile, count) {
  if (count === 1 && tile && isLevelColor(tile.color)) return [tile.color.trim()];
  return seriesPaletteFor(count);
}

/* The chart's own colours as custom properties on its box, so the pointer
 * line and the hover dots (drawn by styles.css) follow them; without them
 * the stylesheet falls back to the theme's marker, as before. */
function applyChartColors(box, tile) {
  if (!box || !tile) return;
  if (tile.viz !== 'bar' && isLevelColor(tile.color) && Array.isArray(tile.y) && tile.y.length === 1) box.style.setProperty('--sqlv-tile-series', tile.color.trim());
  if ((tile.viz === 'line' || tile.viz === 'combo') && isLevelColor(tile.guideColor)) box.style.setProperty('--sqlv-tile-guide', tile.guideColor.trim());
}

function seriesPaletteFor(count) {
  if (count <= 0) return [];
  if (count === 1) return [SERIES_TOKEN_SINGLE];
  const out = [];
  for (let i = 0; i < count; i++) out.push(i < SERIES_TOKEN_LENSES.length ? SERIES_TOKEN_LENSES[i] : SERIES_TOKEN_FAINT);
  return out;
}

/* ------------------------------------------------------ the grid rules -- */

/* The dashboard grid: square-ish cells, cell count derived from width. A
 * widget occupies w x h cells; its place is {x, y, w, h} in the spec. */
const GRID_MIN_COLS = 2;
const GRID_MAX_COLS = 6;
const GRID_UNIT_PX = 170;
const GRID_GAP_PX = 12;
const SPAN_CAP = 12;
/* A section divider lives in a thin row: a grid row that holds nothing
 * but dividers is this tall instead of a full cell. */
const DIVIDER_ROW_PX = 24;

/* Where the databases live by default. A vault that carries the ICOR for Life
 * scaffold (its `.icor-for-life/manifest.json`) has a Databases room called
 * "07 Databases"; every other vault gets a plain "Databases" folder. Only a
 * fresh install is seeded from this: saved settings always win. */
const PLAIN_FOLDERS = { dataFolder: 'Databases', dashboardFolder: 'Databases/Dashboards', cacheFolder: 'Databases/Dashboard Cache' };
const ICOR_FOLDERS = { dataFolder: '07 Databases', dashboardFolder: '07 Databases/Dashboards', cacheFolder: '07 Databases/Dashboard Cache' };

/* Whether the vault carries the ICOR for Life scaffold. Never throws: any
 * trouble reading the file reads as "no". */
async function detectIcorScaffold(adapter) {
  try {
    if (!adapter || typeof adapter.exists !== 'function' || typeof adapter.read !== 'function') return false;
    const path = '.icor-for-life/manifest.json';
    if (!(await adapter.exists(path))) return false;
    const parsed = JSON.parse(await adapter.read(path));
    return !!(parsed && parsed.name === 'ICOR for Life Scaffold' && typeof parsed.implements === 'string' && parsed.implements.startsWith('icor-concepts/'));
  } catch (e) {
    return false;
  }
}

/* Whether this is an ICOR for Life vault, read in a way that also works on a
 * phone. The scaffold manifest sits in a dot folder, which Obsidian Sync never
 * copies, so a synced phone vault has no manifest. There the Databases room
 * itself is the sign: a "07 Databases" folder and no plain "Databases" one.
 * Never throws. */
async function detectIcorVault(adapter) {
  if (await detectIcorScaffold(adapter)) return true;
  try {
    return !!(await adapter.exists(ICOR_FOLDERS.dataFolder)) && !(await adapter.exists(PLAIN_FOLDERS.dataFolder));
  } catch (e) {
    return false;
  }
}

const sameFolders = (a, b) => !!a && a.dataFolder === b.dataFolder && a.dashboardFolder === b.dashboardFolder && a.cacheFolder === b.cacheFolder;

/* The three folder defaults for a vault. Pure. */
function folderDefaultsFor(isIcorVault) {
  return Object.assign({}, isIcorVault ? ICOR_FOLDERS : PLAIN_FOLDERS);
}

const DEFAULT_SETTINGS = {
  pageSize: 50,
  rowCap: 500,
  mobileCapMb: Platform.isDesktopApp ? DESKTOP_CAP_MB : PHONE_CAP_MB,
  dashboardFolder: PLAIN_FOLDERS.dashboardFolder,
  cacheFolder: PLAIN_FOLDERS.cacheFolder,
  dataFolder: PLAIN_FOLDERS.dataFolder,
  /* Where databases are looked for: 'vault' (every folder, the default) or
   * 'folder' (only the database folder above). The database folder is also
   * where dashboards, exports and suggested moves go, so the two are
   * separate settings. */
  searchScope: 'vault',
  /* A gentle note, once per file, when a database is opened directly from
   * outside the database folder. The paths already noted are kept here. */
  noteOutsideFolder: true,
  outsideNoteSeen: {},
  /* The mobile catalog carries structure only unless this is on. */
  catalogIncludeValues: false,
  /* Off until the member turns it on: ReadOut then opens .json files in its
   * own reader, and a dashboard file as its dashboard. */
  openJsonFiles: false,
  /* Widgets written in notes (a code block) draw. Off, a block shows its own
   * text as plain code. */
  drawNoteBlocks: true,
  /* A note whose properties say `readout: dashboard` opens as its dashboard
   * when it is opened in a pane (the file list, the quick switcher, a link). */
  openDashboardNotes: true,
  /* The day a calendar's weeks start on, for every calendar widget that
   * does not name its own "weekStart". */
  weekStart: 'sunday',
  /* The named levels a stat widget's ranges point at, and how a level
   * shows per widget type. */
  levels: DEFAULT_LEVELS,
  levelLooks: DEFAULT_LEVEL_LOOKS,
};

/* ========================================================================
 * 1. THE PURE LIBRARY
 * ====================================================================== */

function extOf(path) {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  return dot > slash + 1 ? path.slice(dot + 1).toLowerCase() : '';
}

function baseName(path) { return path.split('/').pop(); }

function stemOf(path) {
  const name = baseName(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function formatBytes(n) {
  n = Number(n) || 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  const s = i === 0 ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
  return s + ' ' + units[i];
}

function formatNumber(v) {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'number') return String(v);
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v)) return v.toLocaleString('en-US');
  const rounded = Math.round(v * 100) / 100;
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/* "computed on desktop, 3 hours ago" - the honest line under a cached tile. */
function relativeTime(iso, nowMs) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'at an unknown time';
  const s = Math.max(0, Math.floor(((nowMs === undefined ? Date.now() : nowMs) - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m === 1 ? '1 minute ago' : m + ' minutes ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? '1 hour ago' : h + ' hours ago';
  const d = Math.floor(h / 24);
  if (d < 31) return d === 1 ? '1 day ago' : d + ' days ago';
  return 'on ' + iso.slice(0, 10);
}

/* --------------------------------------------------- the statement gate -- */

/* Blank out comments and the contents of every string and quoted identifier,
 * keeping the length, so the gate can look for keywords and semicolons
 * without being fooled by 'attach' inside a string. Handles 'text' with ''
 * escapes, "identifiers", `identifiers`, [identifiers], -- comments and
 * block comments. Returns null when a quote never closes. */
function stripSqlNoise(sql) {
  const src = String(sql);
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      for (;;) {
        if (j >= n) return null;
        if (src[j] === c) {
          if (src[j + 1] === c) { j += 2; continue; }
          break;
        }
        j++;
      }
      out += c + ' '.repeat(j - i - 1) + c;
      i = j + 1;
    } else if (c === '[') {
      const j = src.indexOf(']', i + 1);
      if (j < 0) return null;
      out += '[' + ' '.repeat(j - i - 1) + ']';
      i = j + 1;
    } else if (c === '-' && src[i + 1] === '-') {
      let j = src.indexOf('\n', i);
      if (j < 0) j = n;
      out += ' '.repeat(j - i);
      i = j;
    } else if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      if (j < 0) return null;
      out += ' '.repeat(j + 2 - i);
      i = j + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/* Functions the sqlite3 program adds to the SQL language that touch the
 * computer outside the database: files, folders, zip archives, shell-style
 * editing and loading code. A query here is data (a note block, a dashboard
 * file, a console line), so none of these may ever be named. `-safe` shuts
 * of them: on sqlite3 3.53.4 it also blocks zipfile, lsdir is not compiled
 * in, and only fsdir survives it. An older or differently built program may
 * differ, so the gate keeps every name on the list. */
const FORBIDDEN_FUNCTIONS = ['readfile', 'writefile', 'edit', 'load_extension', 'fsdir', 'lsdir', 'zipfile', 'fts3_tokenizer'];
/* `edit` is also a plain word (a column, a value), so it is refused only when
 * it is called, i.e. followed by an open bracket. The others are refused as
 * whole words anywhere, even inside a string or a quoted name. */
const FORBIDDEN_WORD_RE = new RegExp('(^|[^A-Za-z0-9_$\\u0080-\\uffff])(' + FORBIDDEN_FUNCTIONS.filter((n) => n !== 'edit').join('|') + ')(?![A-Za-z0-9_$\\u0080-\\uffff])', 'i');
const FORBIDDEN_EDIT_CALL_RE = /(^|[^A-Za-z0-9_$\u0080-\uffff])edit["'`\]]?\s*\(/i;

/* The statement with its comments blanked but every quote kept as written,
 * so a name hidden in "quotes", [brackets] or `ticks` is still seen. */
function blankComments(sql) {
  const src = String(sql);
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n) {
        if (src[j] === c) { if (src[j + 1] === c) { j += 2; continue; } break; }
        j++;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === '[') {
      const j = src.indexOf(']', i + 1);
      const e = j < 0 ? n : j + 1;
      out += src.slice(i, e);
      i = e;
    } else if (c === '-' && src[i + 1] === '-') {
      let j = src.indexOf('\n', i);
      if (j < 0) j = n;
      out += ' ';
      i = j;
    } else if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      out += ' ';
      i = j < 0 ? n : j + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function usesForbiddenFunction(sql) {
  const text = blankComments(sql);
  return FORBIDDEN_WORD_RE.test(text) || FORBIDDEN_EDIT_CALL_RE.test(text);
}

function firstKeywordOf(stripped) {
  const m = /^\s*([a-zA-Z_]+)/.exec(stripped);
  return m ? m[1].toLowerCase() : '';
}

/* The gate every statement passes before any engine sees it. Exactly one
 * statement, read-only verbs only, no ATTACH. Returns { ok: true } or
 * { ok: false, reason } with the reason in plain words. */
function gateStatement(sql) {
  if (!sql || !String(sql).trim()) {
    return { ok: false, reason: 'The query is empty.' };
  }
  const stripped = stripSqlNoise(sql);
  if (stripped === null) {
    return { ok: false, reason: 'A quote or comment never closes. Check the query for an unmatched \' or /*.' };
  }
  if (!stripped.trim()) {
    return { ok: false, reason: 'The query is empty.' };
  }
  const semi = stripped.indexOf(';');
  if (semi >= 0 && stripped.slice(semi + 1).trim() !== '') {
    return { ok: false, reason: 'One statement at a time. Remove everything after the first semicolon.' };
  }
  if (usesForbiddenFunction(sql)) {
    return { ok: false, reason: 'That statement names a function that reads or writes files or loads code (readfile, writefile, edit, load_extension, fsdir, lsdir, zipfile, fts3_tokenizer). Those never run here.' };
  }
  const kw = firstKeywordOf(stripped);
  if (!ALLOWED_KEYWORDS.has(kw)) {
    return { ok: false, reason: 'Only read queries run here. Start with SELECT, WITH, PRAGMA or EXPLAIN.' };
  }
  /* EXPLAIN only describes a statement, but SQLite accepts EXPLAIN in front
   * of a PRAGMA that sets something. So what follows EXPLAIN (or EXPLAIN
   * QUERY PLAN) goes through the whole gate again, as a statement of its own.
   * The stripped text keeps the original's offsets, so the cut is exact. */
  if (kw === 'explain') {
    const lead = /^\s*explain(?:\s+query\s+plan)?/i.exec(stripped);
    return gateStatement(String(sql).slice(lead[0].length));
  }
  if (/\b(attach|detach)\b/i.test(stripped)) {
    return { ok: false, reason: 'ATTACH is not allowed. This viewer reads one database at a time.' };
  }
  /* A WITH clause (or anything else) must not lead into a write. SQLite
   * accepts WITH x AS (...) DELETE/INSERT/UPDATE as one statement, so the
   * write verbs are refused wherever they appear as words in the stripped
   * statement. Identifiers and strings are already masked, so a column
   * named "delete" cannot trip this and a bare verb cannot hide. */
  if (WRITE_VERBS_RE.test(stripped)) {
    return { ok: false, reason: 'Only read queries run here. A statement that writes (INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, VACUUM and friends) is refused, even behind a WITH clause.' };
  }
  /* PRAGMA is a family, and half the family writes. Only the read-only
   * introspection PRAGMAs pass, and never a set form. SQLite spells a set
   * two ways, "PRAGMA name = value" and "PRAGMA name(value)", so a
   * parenthesized argument counts as a set for every scalar PRAGMA; parens
   * stay legal only for the introspection PRAGMAs that genuinely take an
   * argument, like table_info('t') or integrity_check(10). */
  if (kw === 'pragma') {
    const m = /^\s*pragma\s+([a-z0-9_]+)\s*(=|\()?/i.exec(stripped);
    const name = m && m[1] ? m[1].toLowerCase() : '';
    if (!READ_PRAGMAS.has(name)) {
      return { ok: false, reason: 'That PRAGMA can change the database. Only read-only PRAGMAs run here, for example table_info, index_list or integrity_check.' };
    }
    if (m && m[2] && (m[2] === '=' || !READ_PRAGMA_FUNCS.has(name))) {
      return { ok: false, reason: 'A PRAGMA given a value can change the database. Only the bare read form of ' + name + ' runs here.' };
    }
  }
  return { ok: true };
}

/* Add a LIMIT to a browsing query that has none, so a careless SELECT over
 * fifteen million rows comes back as a page, not a flood. PRAGMA and
 * EXPLAIN are left alone; a query that already limits itself is trusted. */
function applyRowCap(sql, cap) {
  const stripped = stripSqlNoise(sql);
  if (stripped === null) return { sql, capped: false };
  const kw = firstKeywordOf(stripped);
  if (kw !== 'select' && kw !== 'with') return { sql, capped: false };
  if (/\blimit\b/i.test(stripped)) return { sql, capped: false };
  const trimmed = String(sql).replace(/[\s;]+$/, '');
  return { sql: trimmed + ' LIMIT ' + Math.max(1, Math.floor(cap)), capped: true };
}

/* ------------------------------------------------------- result shaping -- */

/* sql.js `exec` returns [{ columns, values }], or [] for zero rows. */
function wasmTable(result) {
  if (!Array.isArray(result) || result.length === 0) return { columns: [], rows: [] };
  return { columns: result[0].columns.slice(), rows: result[0].values.map((r) => r.slice()) };
}

function toCsv(columns, rows) {
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [columns.map(cell).join(',')];
  for (const row of rows) lines.push(row.map(cell).join(','));
  return lines.join('\r\n') + '\r\n';
}

/* ------------------------------------------------------- query building -- */

function quoteIdent(name) { return '"' + String(name).replace(/"/g, '""') + '"'; }

function quoteLiteral(value) { return "'" + String(value).replace(/'/g, "''") + "'"; }

/* A per-column text filter becomes a LIKE over the text form of the value,
 * with the member's %, _ and \ treated as plain characters. */
function filterClause(column, text) {
  const pattern = '%' + String(text).replace(/[\\%_]/g, (m) => '\\' + m) + '%';
  return 'CAST(' + quoteIdent(column) + ' AS TEXT) LIKE ' + quoteLiteral(pattern) + " ESCAPE '\\'";
}

function whereOf(filters) {
  const parts = [];
  for (const [col, text] of Object.entries(filters || {})) {
    if (text !== '' && text !== null && text !== undefined) parts.push(filterClause(col, text));
  }
  return parts.length ? ' WHERE ' + parts.join(' AND ') : '';
}

function buildBrowseQuery(table, { filters, sortCol, sortDir, limit, offset } = {}) {
  let sql = 'SELECT * FROM ' + quoteIdent(table) + whereOf(filters);
  if (sortCol) sql += ' ORDER BY ' + quoteIdent(sortCol) + (sortDir === 'desc' ? ' DESC' : ' ASC');
  sql += ' LIMIT ' + Math.max(1, Math.floor(limit || 50));
  sql += ' OFFSET ' + Math.max(0, Math.floor(offset || 0));
  return sql;
}

function buildCountQuery(table, { filters } = {}) {
  return 'SELECT COUNT(*) AS n FROM ' + quoteIdent(table) + whereOf(filters);
}

/* -------------------------------------------------- the database index -- */

function isSidecarPath(path) { return SIDECAR_RE.test(path); }

function isDbPath(path) {
  if (isSidecarPath(path)) return false;
  return DB_EXTS.has(extOf(path));
}

function isSkippedPath(path, configDir) {
  const config = String(configDir || '.obsidian');
  return String(path).split('/').some((seg) => SKIP_FOLDERS.has(seg) || seg === config);
}

/* Every database in the vault, from a list of { path, size }. Sidecars and
 * the folders nobody means (the config folder, .git, .trash) stay out. */
function findDatabases(files, configDir) {
  return files
    .filter((f) => isDbPath(f.path) && !isSkippedPath(f.path, configDir))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/* True when a database-folder setting means the whole vault: empty, "/" or ".". */
function isVaultRootFolder(setting) {
  const t = String(setting === undefined || setting === null ? '' : setting).trim();
  return t === '' || t === '/' || t === '.';
}

/* Every database file under a folder, found by walking its children through
 * the vault API (a TFolder has a children list; a file has none). Only this
 * folder is walked, never the whole vault unless the folder is the vault
 * root, which the member chooses in settings. Returns { path, size }. */
function walkDatabases(folder, configDir) {
  const found = [];
  const visit = (f) => {
    for (const child of (f && Array.isArray(f.children)) ? f.children : []) {
      if (isSkippedPath(child.path, configDir)) continue;
      if (Array.isArray(child.children)) visit(child);
      else if (isDbPath(child.path)) found.push({ path: child.path, size: child.stat ? child.stat.size : 0 });
    }
  };
  visit(folder);
  return findDatabases(found, configDir);
}

/* Whether a vault path sits inside a folder setting (the vault root holds everything). */
function isInsideFolder(path, folder) {
  if (isVaultRootFolder(folder)) return true;
  const f = normalizePath(folder);
  const p = normalizePath(path);
  return p === f || p.startsWith(f + '/');
}

/* The name of a saved result file: the database's stem, a stamp, ".csv". */
function csvExportName(dbPath, now, taken) {
  const d = now instanceof Date ? now : new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  const stem = (dbPath ? stemOf(dbPath) : 'query') + ' ' + stamp;
  let name = stem + '.csv';
  for (let i = 2; taken && taken.has(name); i++) name = stem + ' (' + i + ').csv';
  return name;
}

/* Whether these bytes begin like a SQLite database file: the first 16
 * must read "SQLite format 3" and a zero byte. An empty file is not judged
 * here (SQLite reads one as an empty database); the callers skip it. Pure. */
function hasSqliteHeader(bytes) {
  if (!bytes || bytes.length < SQLITE_MAGIC.length) return false;
  for (let i = 0; i < SQLITE_MAGIC.length; i++) if (bytes[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
  return true;
}

/* A table whose engine module the built-in SQLite build does not have (an
 * FTS5 search index, for one) cannot be read, and says "no such module".
 * It is listed without columns and a plain note, never as a failure. */
const UNREADABLE_TABLE_NOTE = "This table can't be read by the built-in engine (it needs a SQLite module the engine doesn't have, for example FTS5).";
function isMissingModuleError(e) { return /no such module/i.test(String((e && e.message) || e)); }
function friendlyTableError(e) { return isMissingModuleError(e) ? UNREADABLE_TABLE_NOTE : (e && e.message) || String(e); }

function notSqliteError() {
  const e = new Error(NOT_SQLITE_TEXT);
  e.notSqlite = true;
  return e;
}

/* ---------------------------------------------------- dashboard specs -- */

/* A dashboard is a JSON file: { id, title, database?, globalTimeframe?,
 * tiles: [...] }. A tile is either a raw SQL tile
 * { title, sql, viz, x, y, unit?, stack? } or a built widget
 * { title, viz, unit?, stack?, source: { database?, table, metric, agg,
 * filter?, series?, groupBy?, timeColumn?, timeframe? } }. Raw SQL passes
 * the statement gate at parse time; built widgets get their SQL generated
 * by sqlForWidget, through the same gate at query time. */
function parseDashboardSpec(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: 'This file is not valid JSON. ' + e.message };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'A dashboard file must be a JSON object.' };
  }
  if (typeof raw.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/i.test(raw.id)) {
    return { ok: false, reason: 'The dashboard needs an "id": lowercase letters, digits and hyphens.' };
  }
  if (typeof raw.title !== 'string' || !raw.title.trim()) {
    return { ok: false, reason: 'The dashboard needs a "title".' };
  }
  if (raw.database !== undefined && (typeof raw.database !== 'string' || !raw.database.trim())) {
    return { ok: false, reason: 'The "database" must be a vault path like "Databases/example.db".' };
  }
  if (!validTimeframe(raw.globalTimeframe, false)) {
    return { ok: false, reason: 'The "globalTimeframe" must be a preset like {"preset":"90d"} or {"from":"YYYY-MM-DD","to":"YYYY-MM-DD"}.' };
  }
  if (!Array.isArray(raw.tiles)) {
    return { ok: false, reason: 'The dashboard needs a "tiles" list. An empty list is fine; the builder adds widgets to it.' };
  }
  const database = raw.database ? normalizePath(raw.database.trim()) : '';
  const tiles = [];
  for (let i = 0; i < raw.tiles.length; i++) {
    const t = raw.tiles[i];
    const at = 'Tile ' + (i + 1);
    if (!t || typeof t !== 'object') return { ok: false, reason: at + ' must be a JSON object.' };
    if (!VIZ_KINDS.has(t.viz)) return { ok: false, reason: at + ' needs a "viz" of line, bar, stat, table or divider, or one of combo, scatter, bullet, segments, pie, heatmap, calendar, text.' };

    let layout;
    if (t.layout !== undefined) {
      const l = t.layout;
      const wholeAtLeast = (v, min) => Number.isInteger(v) && v >= min;
      if (!l || typeof l !== 'object'
        || !wholeAtLeast(l.x, 0) || !wholeAtLeast(l.y, 0)
        || !wholeAtLeast(l.w, 1) || !wholeAtLeast(l.h, 1)
        || l.w > SPAN_CAP || l.h > SPAN_CAP) {
        return { ok: false, reason: at + ': "layout" must be {x, y, w, h} in whole grid cells, w and h at least 1 and at most ' + SPAN_CAP + '.' };
      }
      layout = { x: l.x, y: l.y, w: l.w, h: l.h };
    }
    const levelCheck = checkTileLevels(t, at);
    if (!levelCheck.ok) return levelCheck;

    if (t.viz === 'divider') {
      /* A section divider: a thin line with an optional heading. No data. */
      if (t.sql !== undefined || t.source !== undefined) {
        return { ok: false, reason: at + ': a section divider draws no data, so it takes no "sql" or "source". Remove them, or pick another "viz".' };
      }
      if (t.title !== undefined && typeof t.title !== 'string') {
        return { ok: false, reason: at + ': the heading ("title") of a section divider must be text.' };
      }
      if (layout && layout.h !== 1) {
        return { ok: false, reason: at + ': a section divider is one thin row, so its "layout" h must be 1.' };
      }
      tiles.push({ title: typeof t.title === 'string' ? t.title : '', viz: 'divider', layout });
      continue;
    }

    if (t.viz === 'text') {
      const check = checkTextTile(t, layout, at);
      if (!check.ok) return check;
      if (check.tile.sql && !database) return { ok: false, reason: at + ' is an SQL tile, so the dashboard needs a top-level "database".' };
      const textNotes = checkTileNotes(t, at);
      if (!textNotes.ok) return textNotes;
      tiles.push(withTileNotes(Object.assign(check.tile, { layout }), textNotes));
      continue;
    }

    if (t.source !== undefined) {
      /* A built widget. */
      if (t.viz === 'table') return { ok: false, reason: at + ': a built widget draws a line, bar or stat; use an SQL tile for a table.' };
      if (t.viz === 'segments') return { ok: false, reason: at + ': a built widget draws a line, bar or stat; use an SQL tile for a segments bar.' };
      if (t.viz === 'pie') return { ok: false, reason: at + ': a built widget draws a line, bar or stat; use an SQL tile for a pie chart.' };
      if (t.viz === 'heatmap') return { ok: false, reason: at + ': a built widget draws a line, bar or stat; use an SQL tile for a heatmap.' };
      if (t.viz === 'scatter') return { ok: false, reason: at + ': a built widget draws a line, bar or stat; use an SQL tile for a scatter chart.' };
      if (t.viz === 'calendar') return { ok: false, reason: at + ': a built widget draws a line, bar or stat; use an SQL tile for a calendar.' };
      if (t.viz === 'bullet') return { ok: false, reason: at + ': a built widget draws a line, bar or stat; use an SQL tile for a bullet chart.' };
      const check = checkWidgetSource(t.source, t.viz, at);
      if (!check.ok) return check;
      if (!t.source.database && !database) return { ok: false, reason: at + ' needs a database, on the widget or on the dashboard.' };
      const compare = t.compare === undefined ? 'none' : t.compare;
      if (!['none', 'previous', 'last_year'].includes(compare)) {
        return { ok: false, reason: at + ': "compare" must be none, previous or last_year.' };
      }
      if (compare !== 'none' && t.source.series) {
        return { ok: false, reason: at + ': a widget split into series cannot also compare periods. Remove the dimension or the comparison.' };
      }
      const favorable = t.favorable === undefined ? 'up' : t.favorable;
      if (favorable !== 'up' && favorable !== 'down') {
        return { ok: false, reason: at + ': "favorable" must be "up" or "down" (which direction counts as good).' };
      }
      if (t.rangeColumn !== undefined) {
        return { ok: false, reason: at + ': "rangeColumn" only works on an SQL stat widget; a built widget has one value to judge.' };
      }
      if (t.captions !== undefined) {
        return { ok: false, reason: at + ': "captions" only work on an SQL stat widget; a built widget has one value and no other columns.' };
      }
      const builtDelta = checkHeaderDelta(t, t.viz, t.source.series ? 2 : 1, at);
      const builtNotes = checkTileNotes(t, at);
      if (!builtNotes.ok) return builtNotes;
      if (!builtDelta.ok) return builtDelta;
      const builtSize = checkValueSize(t.valueSize, t.viz, at);
      if (!builtSize.ok) return builtSize;
      const builtColors = checkChartColors(t, t.viz, t.source.series ? 2 : 1, at);
      if (!builtColors.ok) return builtColors;
      const builtAxis = checkChartAxis(t, t.viz, at);
      if (!builtAxis.ok) return builtAxis;
      const builtMarks = checkChartMarks(t, t.viz, at);
      if (!builtMarks.ok) return builtMarks;
      if (t.band !== undefined) return { ok: false, reason: at + ': "band" only works on an SQL line chart; a built widget has one value column.' };
      if (t.viz === 'combo') return { ok: false, reason: at + ': a combo chart is an SQL widget; a built widget has one value column.' };
      const builtMeter = checkMeter(t.meter, t.viz, at);
      if (!builtMeter.ok) return builtMeter;
      tiles.push(withTileNotes(withMeter(withChartMarks(withChartAxis(withChartColors(withValueSize(withHeaderDelta(withLevels({
        title: typeof t.title === 'string' ? t.title : '',
        viz: t.viz,
        unit: typeof t.unit === 'string' ? t.unit : '',
        stack: t.stack === true,
        layout,
        compare,
        favorable,
        source: {
          database: t.source.database ? normalizePath(t.source.database) : '',
          table: t.source.table,
          metric: typeof t.source.metric === 'string' ? t.source.metric : '',
          agg: check.agg,
          filters: check.filters,
          series: t.source.series || undefined,
          groupBy: t.source.groupBy || undefined,
          timeColumn: t.source.timeColumn || undefined,
          timeframe: t.source.timeframe === undefined ? 'global' : t.source.timeframe,
        },
      }, levelCheck), builtDelta), builtSize), builtColors), builtAxis), builtMarks), builtMeter), builtNotes));
      continue;
    }

    /* A raw SQL tile. */
    if (typeof t.sql !== 'string' || !t.sql.trim()) return { ok: false, reason: at + ' needs an "sql" query or a "source".' };
    const gate = gateStatement(t.sql);
    if (!gate.ok) return { ok: false, reason: at + ': ' + gate.reason };
    if (!database) return { ok: false, reason: at + ' is an SQL tile, so the dashboard needs a top-level "database".' };
    const y = Array.isArray(t.y) ? t.y.slice() : (typeof t.y === 'string' && t.y ? [t.y] : []);
    if (y.some((c) => typeof c !== 'string' || !c)) return { ok: false, reason: at + ': every "y" entry must be a column name.' };
    const sqlCombo = checkCombo(t, at);
    if (!sqlCombo.ok) return sqlCombo;
    if (t.viz === 'combo') {
      if (typeof t.x !== 'string' || !t.x) return { ok: false, reason: at + ' needs an "x" column for a combo chart.' };
      if (t.y !== undefined) return { ok: false, reason: at + ': a combo chart lists its columns in "series", not "y".' };
    }
    if ((t.viz === 'line' || t.viz === 'bar')) {
      if (typeof t.x !== 'string' || !t.x) return { ok: false, reason: at + ' needs an "x" column for a ' + t.viz + ' chart.' };
      if (y.length === 0) return { ok: false, reason: at + ' needs a "y" column for a ' + t.viz + ' chart.' };
    }
    const scoreCheck = checkRangeColumn(t.rangeColumn, t.viz, levelCheck.ranges, y, at);
    if (!scoreCheck.ok) return scoreCheck;
    if (scoreCheck.rangeColumn) levelCheck.rangeColumn = scoreCheck.rangeColumn;
    const captionCheck = checkCaptions(t.captions, t.viz, at);
    if (!captionCheck.ok) return captionCheck;
    const sqlDelta = checkHeaderDelta(t, t.viz, y.length, at);
    const sqlNotes = checkTileNotes(t, at);
    if (!sqlNotes.ok) return sqlNotes;
    if (!sqlDelta.ok) return sqlDelta;
    const sqlSize = checkValueSize(t.valueSize, t.viz, at);
    if (!sqlSize.ok) return sqlSize;
    const sparkCheck = checkSparklines(t.sparklines, t.viz, at);
    if (!sparkCheck.ok) return sparkCheck;
    const scatterCheck = checkScatter(t, y, at);
    if (!scatterCheck.ok) return scatterCheck;
    const bulletCheck = checkBullet(t, y, at);
    if (!bulletCheck.ok) return bulletCheck;
    const sqlColors = checkChartColors(t, t.viz, t.viz === 'combo' || (t.viz === 'scatter' && t.colorBy !== undefined) ? 2 : y.length, at);
    if (!sqlColors.ok) return sqlColors;
    const sqlAxis = checkChartAxis(t, t.viz, at);
    if (!sqlAxis.ok) return sqlAxis;
    const sqlMarks = checkChartMarks(t, t.viz, at);
    if (!sqlMarks.ok) return sqlMarks;
    const sqlBand = checkBand(t.band, t.viz, y, at);
    if (!sqlBand.ok) return sqlBand;
    const segCheck = checkSegments(t, y, levelCheck, at);
    if (!segCheck.ok) return segCheck;
    const pieCheck = checkPie(t, at);
    if (!pieCheck.ok) return pieCheck;
    const sqlMeter = checkMeter(t.meter, t.viz, at);
    if (!sqlMeter.ok) return sqlMeter;
    const heatCheck = checkHeatmap(t, at);
    if (!heatCheck.ok) return heatCheck;
    const calCheck = checkCalendar(t, at);
    if (!calCheck.ok) return calCheck;
    tiles.push(withTileNotes(withPie(withCalendar(withHeatmap(withMeter(withBullet(withScatter(withSegments(withCombo(withBand(withChartMarks(withChartAxis(withChartColors(withValueSize(withSparklines(withCaptions(withHeaderDelta(withLevels({
      title: typeof t.title === 'string' ? t.title : '',
      sql: t.sql,
      viz: t.viz,
      x: typeof t.x === 'string' ? t.x : '',
      y,
      unit: typeof t.unit === 'string' ? t.unit : '',
      stack: t.stack === true,
      layout,
    }, levelCheck), sqlDelta), captionCheck), sparkCheck), sqlSize), sqlColors), sqlAxis), sqlMarks), sqlBand), sqlCombo), segCheck), scatterCheck), bulletCheck), sqlMeter), heatCheck), calCheck), pieCheck), sqlNotes));
  }
  return {
    ok: true,
    spec: {
      id: raw.id,
      title: raw.title.trim(),
      database,
      globalTimeframe: raw.globalTimeframe || DEFAULT_GLOBAL_TIMEFRAME,
      tiles,
    },
  };
}

/* The change over the period, shown at the right of a chart's title row.
 * Opt-in per tile; only a line or bar chart with one series has a single
 * line to measure. A chart may instead, or as well, carry a roll-up in
 * the same place, "chartCaption": "range" (lowest to highest of what it
 * plots) or "change" (the same change as headerDelta). Returns
 * { ok, on, days, caption } or { ok, reason }. */
const HEADER_DELTA_MAX_DAYS = 365;
const CHART_CAPTIONS = ['range', 'change'];

function checkHeaderDelta(t, viz, seriesCount, at) {
  const on = t.headerDelta;
  const days = t.headerDeltaAverageDays;
  const caption = t.chartCaption;
  if (on !== undefined && typeof on !== 'boolean') return { ok: false, reason: at + ': "headerDelta" must be true or false.' };
  if (on === true && (viz !== 'line' && viz !== 'bar' || seriesCount !== 1)) {
    return { ok: false, reason: at + ': "headerDelta" only works on a line or bar chart with one series.' };
  }
  if (caption !== undefined) {
    if (!CHART_CAPTIONS.includes(caption)) return { ok: false, reason: at + ': "chartCaption" must be "range" (lowest to highest) or "change" (change over the period).' };
    if (viz !== 'line' && viz !== 'bar' || seriesCount !== 1) {
      return { ok: false, reason: at + ': "chartCaption" only works on a line or bar chart with one series.' };
    }
  }
  const measured = on === true || caption === 'change';
  if (days !== undefined) {
    if (!measured) return { ok: false, reason: at + ': "headerDeltaAverageDays" needs "headerDelta": true or "chartCaption": "change".' };
    if (!Number.isInteger(days) || days < 1 || days > HEADER_DELTA_MAX_DAYS) {
      return { ok: false, reason: at + ': "headerDeltaAverageDays" must be a whole number of days from 1 to ' + HEADER_DELTA_MAX_DAYS + '.' };
    }
  }
  return { ok: true, on: on === true, days: measured ? days : undefined, caption };
}

/* A hint at the right of a widget's title, and a footnote line under it,
 * opt-in per tile, on any widget but a section divider: "hint": "median
 * by time of day" says how to read it at a glance, "footnote": "Line:
 * the median. Band: the middle half." explains it in a sentence. Plain
 * text. Returns { ok, hint, footnote } or { ok, reason }. */
const HINT_MAX = 60;
const FOOTNOTE_MAX = 300;

function checkTileNotes(t, at) {
  for (const [key, max] of [['hint', HINT_MAX], ['footnote', FOOTNOTE_MAX]]) {
    if (t[key] === undefined) continue;
    if (t.viz === 'divider') return { ok: false, reason: at + ': a section divider has no "' + key + '"; its heading is its words.' };
    if (typeof t[key] !== 'string' || !t[key].trim() || t[key].trim().length > max) {
      return { ok: false, reason: at + ': "' + key + '" must be text, ' + max + ' characters at most.' };
    }
  }
  return {
    ok: true,
    hint: t.hint === undefined ? undefined : t.hint.trim(),
    footnote: t.footnote === undefined ? undefined : t.footnote.trim(),
  };
}

function withTileNotes(tile, check) {
  if (check.hint) tile.hint = check.hint;
  if (check.footnote) tile.footnote = check.footnote;
  return tile;
}

/* Put the hint at the right of the title row, and the footnote under the
 * body. The title gives way first (ellipsis); the hint stays on one line
 * and only a hint wider than the whole row is cut. */
function addTileNotes(tileEl, tileSpec) {
  const hint = typeof tileSpec.hint === 'string' ? tileSpec.hint.trim() : '';
  const footnote = typeof tileSpec.footnote === 'string' ? tileSpec.footnote.trim() : '';
  if (hint) {
    let bar = Array.from(tileEl.children).find((c) => c.classList && c.classList.contains('icor-sqlv-tile-titlebar'));
    if (!bar) {
      const title = Array.from(tileEl.children).find((c) => c.classList && c.classList.contains('icor-sqlv-tile-title'));
      bar = tileEl.createDiv({ cls: 'icor-sqlv-tile-titlebar' });
      tileEl.insertBefore(bar, title || tileEl.firstChild);
      if (title) bar.appendChild(title);
    }
    const chip = bar.createSpan({ cls: 'icor-sqlv-tile-hint', text: hint });
    chip.setAttribute('title', hint);
    /* A level pill on the row stays last. */
    const pill = Array.from(bar.children).find((c) => c.classList && c.classList.contains('icor-sqlv-level-pill'));
    if (pill) bar.insertBefore(chip, pill);
  }
  if (footnote) tileEl.createDiv({ cls: 'icor-sqlv-tile-footnote', text: footnote }).setAttribute('title', footnote);
}

function withHeaderDelta(tile, check) {
  if (check.on) tile.headerDelta = true;
  if (check.days !== undefined) tile.headerDeltaAverageDays = check.days;
  if (check.caption) tile.chartCaption = check.caption;
  return tile;
}

/* A parsed tile with its checked value levels, when it has any. */
function withLevels(tile, levelCheck) {
  if (levelCheck.ranges) tile.ranges = levelCheck.ranges;
  if (levelCheck.colors) tile.levelColors = levelCheck.colors;
  if (levelCheck.ranges && levelCheck.rangeColumn) tile.rangeColumn = levelCheck.rangeColumn;
  return tile;
}

/* Validate a stat tile's "captions": the query's columns shown as caption
 * lines under the number, one line each, in order. Returns
 * { ok, captions } or { ok, reason }. */
function checkCaptions(raw, viz, at) {
  if (raw === undefined) return { ok: true, captions: undefined };
  if (viz !== 'stat') return { ok: false, reason: at + ': "captions" only work on a stat widget (One big number).' };
  if (!Array.isArray(raw) || !raw.length || raw.length > CAPTIONS_MAX
    || raw.some((c) => typeof c !== 'string' || !c.trim())) {
    return { ok: false, reason: at + ': "captions" must be a list of 1 to ' + CAPTIONS_MAX + ' column names, like ["change", "window"].' };
  }
  return { ok: true, captions: raw.map((c) => c.trim()) };
}

/* Sparklines in a table, opt-in per table widget: "sparklines" names the
 * columns whose cells each hold a short series of numbers (written 3,5,4,8,
 * as group_concat makes it) and draws every such cell as a tiny line
 * chart. A cell that holds no series of two or more numbers shows as the
 * text it is. Returns { ok, names } or { ok, reason }. */
const SPARKLINES_MAX = 8;

function checkSparklines(raw, viz, at) {
  if (raw === undefined) return { ok: true, names: undefined };
  if (viz !== 'table') return { ok: false, reason: at + ': "sparklines" only works on a table widget.' };
  if (!Array.isArray(raw) || !raw.length || raw.length > SPARKLINES_MAX || raw.some((c) => typeof c !== 'string' || !c.trim())) {
    return { ok: false, reason: at + ': "sparklines" must be a list of 1 to ' + SPARKLINES_MAX + ' column names, like ["trend"].' };
  }
  return { ok: true, names: [...new Set(raw.map((c) => c.trim()))] };
}

function withSparklines(tile, check) {
  if (check.names) tile.sparklines = check.names;
  return tile;
}

function withCaptions(tile, check) {
  if (check.captions) tile.captions = check.captions;
  return tile;
}

/* Validate a stat tile's "valueSize": the size of its number, a whole
 * number of pixels, or "fit" (the theme's size, made smaller until the
 * number shows whole). Absent means the theme and any snippet decide, as
 * before. Returns { ok, valueSize } or { ok, reason }. */
const VALUE_SIZE_MIN = 12;
const VALUE_SIZE_MAX = 120;
const VALUE_SIZE_PRESETS = [[24, 'Small'], [34, 'Medium'], [48, 'Large'], [64, 'Extra large']];

function checkValueSize(raw, viz, at) {
  if (raw === undefined) return { ok: true, valueSize: undefined };
  if (viz !== 'stat') return { ok: false, reason: at + ': "valueSize" only works on a stat widget (One big number).' };
  if (raw === 'fit') return { ok: true, valueSize: 'fit' };
  if (!Number.isInteger(raw) || raw < VALUE_SIZE_MIN || raw > VALUE_SIZE_MAX) {
    return { ok: false, reason: at + ': "valueSize" must be a whole number of pixels from ' + VALUE_SIZE_MIN + ' to ' + VALUE_SIZE_MAX + ', or "fit" to shrink the number until it shows whole.' };
  }
  return { ok: true, valueSize: raw };
}

/* A meter under a stat's number, opt-in per tile: "meter": {"min": 0,
 * "max": 60, "target": 36} draws a bar filled to where the number sits
 * between "min" and "max", in the widget's level colour (the theme's dim
 * ink when it has none), with a tick at the optional "target". A number
 * past either end fills to that end. Returns { ok, meter } or
 * { ok, reason }. */
function checkMeter(raw, viz, at) {
  if (raw === undefined) return { ok: true, meter: undefined };
  if (viz !== 'stat') return { ok: false, reason: at + ': "meter" only works on a stat widget (One big number).' };
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !finite(raw.min) || !finite(raw.max) || raw.min >= raw.max) {
    return { ok: false, reason: at + ': "meter" must be like {"min": 0, "max": 60, "target": 36}, with "min" below "max".' };
  }
  if (raw.target !== undefined && (!finite(raw.target) || raw.target < raw.min || raw.target > raw.max)) {
    return { ok: false, reason: at + ': the "meter" "target" must be a number from "min" to "max".' };
  }
  const meter = { min: raw.min, max: raw.max };
  if (raw.target !== undefined) meter.target = raw.target;
  return { ok: true, meter };
}

function withMeter(tile, check) {
  if (check.meter) tile.meter = check.meter;
  return tile;
}

/* How full a meter is, 0 to 100, for a value between min and max. */
function meterFill(value, meter) {
  const v = Number(value);
  if (!meter || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, ((v - meter.min) / (meter.max - meter.min)) * 100));
}

function renderMeter(wrap, value, tile, level) {
  const m = tile.meter;
  const track = wrap.createDiv({ cls: 'icor-sqlv-meter' });
  const fill = track.createDiv({ cls: 'icor-sqlv-meter-fill' });
  fill.style.setProperty('width', meterFill(value, m).toFixed(2) + '%');
  if (level && level.known && level.color) fill.style.setProperty('background', level.color);
  let text = formatNumber(Number(value)) + (tile.unit ? ' ' + tile.unit : '') + ' on a scale of ' + formatNumber(m.min) + ' to ' + formatNumber(m.max);
  if (typeof m.target === 'number') {
    const tick = track.createDiv({ cls: 'icor-sqlv-meter-target' });
    tick.style.setProperty('left', meterFill(m.target, m).toFixed(2) + '%');
    text += ', target ' + formatNumber(m.target);
  }
  track.setAttribute('role', 'img');
  track.setAttribute('aria-label', text);
  return track;
}

function withValueSize(tile, check) {
  if (check.valueSize !== undefined) tile.valueSize = check.valueSize;
  return tile;
}

/* A chart's own colours, opt-in per tile: "color" for the line or the
 * bars of a one-series chart, "guideColor" for the line that follows the
 * pointer on a line chart. Same rule as a level colour: a theme variable
 * or a plain hex, nothing else. Absent means the theme's colours, as
 * before. Returns { ok, color, guideColor } or { ok, reason }. */
function checkChartColors(t, viz, seriesCount, at) {
  const { color, guideColor } = t;
  if (color !== undefined) {
    if (viz !== 'line' && viz !== 'bar' && viz !== 'scatter') return { ok: false, reason: at + ': "color" only works on a line, bar or scatter chart.' };
    if (seriesCount !== 1) return { ok: false, reason: at + ': "color" only works on a chart with one series; a chart with several takes the theme\'s series colours.' };
    if (!isLevelColor(color)) return { ok: false, reason: at + ': "color" must be a theme colour like "var(--color-orange)" or a hex colour like "#ee7733".' };
  }
  if (guideColor !== undefined) {
    if (viz !== 'line' && viz !== 'combo') return { ok: false, reason: at + ': "guideColor" only works on a line or combo chart; it colours the line that follows the pointer.' };
    if (!isLevelColor(guideColor)) return { ok: false, reason: at + ': "guideColor" must be a theme colour like "var(--color-blue)" or a hex colour like "#aaaaaa".' };
  }
  return {
    ok: true,
    color: color === undefined ? undefined : color.trim(),
    guideColor: guideColor === undefined ? undefined : guideColor.trim(),
  };
}

function withChartColors(tile, check) {
  if (check.color) tile.color = check.color;
  if (check.guideColor) tile.guideColor = check.guideColor;
  return tile;
}

/* A chart's own y range and x-label spacing, opt-in per tile, on a line
 * or bar chart. "yMin" and "yMax" fix the ends of the y axis; with
 * "yMaxLimit" as well, "yMax" is where the top starts and it grows to fit
 * the data, never past the limit. "yTicks" lists the y labels to draw
 * (plus the grown top, when it grew). "xLabelEvery" labels every Nth x
 * value only, still thinned when the labels would not fit. "yTickSuffix"
 * puts short text after every y label ("h", "%"), and "yTickCompact"
 * writes thousands as "k" (8,000 as 8k). Absent means the snug automatic
 * axis with bare numbers, as before. Returns { ok, axis } or
 * { ok, reason }. */
const CHART_AXIS_KEYS = ['yMin', 'yMax', 'yMaxLimit', 'yTicks', 'xLabelEvery', 'yTickSuffix', 'yTickCompact', 'xMin', 'xMax'];
const Y_TICKS_MAX = 12;
const X_LABEL_EVERY_MAX = 1000;
const TICK_SUFFIX_MAX = 6;

function checkChartAxis(t, viz, at) {
  const axis = {};
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  for (const key of CHART_AXIS_KEYS) {
    if (t[key] === undefined) continue;
    /* A scatter chart's x is a number scale, so it takes "xMin" and "xMax"
     * and no label spacing; the y fields serve all four chart types. */
    if (key === 'xMin' || key === 'xMax') {
      if (viz !== 'scatter') return { ok: false, reason: at + ': "' + key + '" only works on a scatter chart.' };
    } else if (key === 'xLabelEvery') {
      if (viz !== 'line' && viz !== 'bar' && viz !== 'combo') return { ok: false, reason: at + ': "' + key + '" only works on a line, bar or combo chart.' };
    } else if (viz !== 'line' && viz !== 'bar' && viz !== 'combo' && viz !== 'scatter') {
      return { ok: false, reason: at + ': "' + key + '" only works on a line, bar, combo or scatter chart.' };
    }
    axis[key] = t[key];
  }
  for (const key of ['yMin', 'yMax', 'yMaxLimit', 'xMin', 'xMax']) {
    if (axis[key] !== undefined && !finite(axis[key])) return { ok: false, reason: at + ': "' + key + '" must be a number.' };
  }
  if (axis.yMin !== undefined && axis.yMax !== undefined && axis.yMin >= axis.yMax) {
    return { ok: false, reason: at + ': "yMin" (' + axis.yMin + ') must be below "yMax" (' + axis.yMax + ').' };
  }
  if (axis.xMin !== undefined && axis.xMax !== undefined && axis.xMin >= axis.xMax) {
    return { ok: false, reason: at + ': "xMin" (' + axis.xMin + ') must be below "xMax" (' + axis.xMax + ').' };
  }
  if (axis.yMaxLimit !== undefined) {
    if (axis.yMax === undefined) return { ok: false, reason: at + ': "yMaxLimit" needs "yMax": the top starts at "yMax" and grows to fit the data up to "yMaxLimit".' };
    if (axis.yMaxLimit <= axis.yMax) return { ok: false, reason: at + ': "yMaxLimit" (' + axis.yMaxLimit + ') must be above "yMax" (' + axis.yMax + ').' };
  }
  if (axis.yTicks !== undefined) {
    const ticks = axis.yTicks;
    if (!Array.isArray(ticks) || !ticks.length || ticks.length > Y_TICKS_MAX || !ticks.every(finite)
      || ticks.some((v, i) => i > 0 && v <= ticks[i - 1])) {
      return { ok: false, reason: at + ': "yTicks" must be a list of 1 to ' + Y_TICKS_MAX + ' numbers from low to high, like [0, 50, 100].' };
    }
    axis.yTicks = ticks.slice();
  }
  if (axis.xLabelEvery !== undefined && (!Number.isInteger(axis.xLabelEvery) || axis.xLabelEvery < 1 || axis.xLabelEvery > X_LABEL_EVERY_MAX)) {
    return { ok: false, reason: at + ': "xLabelEvery" must be a whole number from 1 to ' + X_LABEL_EVERY_MAX + ' (label every Nth value).' };
  }
  if (axis.yTickSuffix !== undefined && (typeof axis.yTickSuffix !== 'string' || !axis.yTickSuffix.trim() || axis.yTickSuffix.length > TICK_SUFFIX_MAX)) {
    return { ok: false, reason: at + ': "yTickSuffix" must be short text, ' + TICK_SUFFIX_MAX + ' characters at most, like "h" or "%".' };
  }
  if (axis.yTickCompact !== undefined && typeof axis.yTickCompact !== 'boolean') {
    return { ok: false, reason: at + ': "yTickCompact" must be true or false (true writes 8,000 as 8k).' };
  }
  if (axis.yTickCompact === false) delete axis.yTickCompact;
  return { ok: true, axis };
}

/* How an axis writes its labels: the number, in thousands when compact,
 * then the suffix. */
function tickFormatter(axis) {
  const suffix = axis && typeof axis.yTickSuffix === 'string' ? axis.yTickSuffix : '';
  const compact = !!(axis && axis.yTickCompact === true);
  return (v) => {
    const text = compact && typeof v === 'number' && Math.abs(v) >= 1000
      ? formatNumber(Math.round(v / 100) / 10) + 'k'
      : formatNumber(v);
    return text + suffix;
  };
}

function withChartAxis(tile, check) {
  for (const key of CHART_AXIS_KEYS) if (check.axis[key] !== undefined) tile[key] = check.axis[key];
  return tile;
}

/* The axis fields of a tile, for the copies the renderer and the cache
 * make of it. */
function chartAxisOf(tile) {
  const out = {};
  for (const key of CHART_AXIS_KEYS) if (tile && tile[key] !== undefined) out[key] = tile[key];
  return out;
}

/* Shaded zones and reference lines on a line or bar chart, opt-in per
 * tile. "zones" are horizontal bands, [{"from": 20, "to": 30, "color":
 * "#228833", "opacity": 0.1}], drawn behind everything; "refLines" are
 * horizontal lines, [{"y": 50, "color": "#bbbbbb", "dash": "4 3",
 * "label": "goal"}], drawn over the grid and under the data. Colours take
 * the level-colour rule; a line without one takes the theme's dim ink. On
 * an automatic axis they count as data, so a goal above every value is
 * still in view. Returns { ok, marks } or { ok, reason }. */
const CHART_MARK_KEYS = ['zones', 'refLines'];
const CHART_MARKS_MAX = 8;
const DASH_RE = /^\d{1,3}( \d{1,3}){1,5}$/;
const ZONE_OPACITY_DEFAULT = 0.15;

function checkChartMarks(t, viz, at) {
  const marks = {};
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  for (const key of CHART_MARK_KEYS) {
    if (t[key] === undefined) continue;
    if (viz !== 'line' && viz !== 'bar' && viz !== 'combo' && viz !== 'scatter') return { ok: false, reason: at + ': "' + key + '" only work on a line, bar, combo or scatter chart.' };
    if (!Array.isArray(t[key]) || !t[key].length || t[key].length > CHART_MARKS_MAX) {
      return { ok: false, reason: at + ': "' + key + '" must be a list of 1 to ' + CHART_MARKS_MAX + ' entries.' };
    }
  }
  if (t.zones !== undefined) {
    marks.zones = [];
    for (let i = 0; i < t.zones.length; i++) {
      const z = t.zones[i];
      const where = at + ', zone ' + (i + 1);
      if (!z || typeof z !== 'object' || !finite(z.from) || !finite(z.to) || z.from >= z.to) {
        return { ok: false, reason: where + ' must be like {"from": 20, "to": 30, "color": "#228833"}, with "from" below "to".' };
      }
      if (!isLevelColor(z.color)) return { ok: false, reason: where + ': "color" must be a theme colour like "var(--color-green)" or a hex colour like "#228833".' };
      if (z.opacity !== undefined && (!finite(z.opacity) || z.opacity <= 0 || z.opacity > 1)) {
        return { ok: false, reason: where + ': "opacity" must be a number above 0 and at most 1.' };
      }
      const zone = { from: z.from, to: z.to, color: z.color.trim() };
      if (z.opacity !== undefined) zone.opacity = z.opacity;
      const zAxis = checkMarkAxis(z.axis, viz, where);
      if (!zAxis.ok) return zAxis;
      if (zAxis.axis) zone.axis = zAxis.axis;
      marks.zones.push(zone);
    }
  }
  if (t.refLines !== undefined) {
    marks.refLines = [];
    for (let i = 0; i < t.refLines.length; i++) {
      const r = t.refLines[i];
      const where = at + ', reference line ' + (i + 1);
      if (!r || typeof r !== 'object' || !finite(r.y)) return { ok: false, reason: where + ' must be like {"y": 50}, with a number for "y".' };
      if (r.color !== undefined && !isLevelColor(r.color)) return { ok: false, reason: where + ': "color" must be a theme colour like "var(--color-blue)" or a hex colour like "#bbbbbb".' };
      if (r.dash !== undefined && (typeof r.dash !== 'string' || !DASH_RE.test(r.dash.trim()))) {
        return { ok: false, reason: where + ': "dash" must be a dash pattern like "4 3" (dash and gap lengths).' };
      }
      if (r.label !== undefined && (typeof r.label !== 'string' || r.label.trim().length > LEVEL_LABEL_MAX)) {
        return { ok: false, reason: where + ': "label" must be short text, ' + LEVEL_LABEL_MAX + ' characters at most.' };
      }
      const line = { y: r.y };
      if (r.color !== undefined) line.color = r.color.trim();
      if (r.dash !== undefined) line.dash = r.dash.trim();
      if (r.label !== undefined && r.label.trim()) line.label = r.label.trim();
      const rAxis = checkMarkAxis(r.axis, viz, where);
      if (!rAxis.ok) return rAxis;
      if (rAxis.axis) line.axis = rAxis.axis;
      marks.refLines.push(line);
    }
  }
  return { ok: true, marks };
}

function withChartMarks(tile, check) {
  for (const key of CHART_MARK_KEYS) if (check.marks[key]) tile[key] = check.marks[key];
  return tile;
}

function chartMarksOf(tile) {
  const out = {};
  for (const key of CHART_MARK_KEYS) if (tile && Array.isArray(tile[key])) out[key] = tile[key].map((m) => Object.assign({}, m));
  return out;
}

/* The values zones and reference lines add to an automatic axis. */
function chartMarkValues(tile) {
  const out = [];
  if (tile && Array.isArray(tile.zones)) for (const z of tile.zones) out.push(z.from, z.to);
  if (tile && Array.isArray(tile.refLines)) for (const r of tile.refLines) out.push(r.y);
  return out.filter((v) => typeof v === 'number' && Number.isFinite(v));
}

/* Zones go behind everything; reference lines over the grid. */
function drawZones(svg, L, tile) {
  if (!tile || !Array.isArray(tile.zones)) return;
  for (const z of tile.zones) {
    if (!isLevelColor(z.color)) continue;
    const y1 = L.yOf(Math.max(z.from, z.to));
    const y2 = L.yOf(Math.min(z.from, z.to));
    if (y2 - y1 <= 0) continue;
    const rect = svgEl('rect', { x: L.left, y: y1.toFixed(1), width: L.plotW, height: (y2 - y1).toFixed(1), class: 'icor-sqlv-zone' });
    rect.setAttribute('fill', z.color);
    rect.setAttribute('fill-opacity', typeof z.opacity === 'number' ? z.opacity : ZONE_OPACITY_DEFAULT);
    svg.appendChild(rect);
  }
}

function drawRefLines(svg, L, tile) {
  if (!tile || !Array.isArray(tile.refLines)) return;
  for (const r of tile.refLines) {
    if (typeof r.y !== 'number' || r.y < L.scale.min || r.y > L.scale.max) continue;
    const y = L.yOf(r.y);
    const line = svgEl('line', { x1: L.left, y1: y.toFixed(1), x2: L.left + L.plotW, y2: y.toFixed(1), class: 'icor-sqlv-refline' });
    if (isLevelColor(r.color)) line.setAttribute('stroke', r.color);
    if (typeof r.dash === 'string' && DASH_RE.test(r.dash)) line.setAttribute('stroke-dasharray', r.dash);
    svg.appendChild(line);
  }
}

/* A labelled reference line is named in the legend, never on the plot,
 * where bars would draw over its words. */
function guideEntries(tile) {
  if (!tile || !Array.isArray(tile.refLines)) return [];
  return tile.refLines.filter((r) => r && r.label).map((r) => ({ name: r.label, color: isLevelColor(r.color) ? r.color.trim() : '' }));
}

/* A shaded band between two columns on a line chart, opt-in per SQL
 * tile: "band": {"low": "p25", "high": "p75"} fills the space between the
 * two columns, row by row, in the first line's colour at "opacity" (0.2
 * when left out), under the lines. The band's columns are not lines of
 * their own; the hover readout shows them as a range. A row missing
 * either value breaks the band. Returns { ok, band } or { ok, reason }. */
const BAND_OPACITY_DEFAULT = 0.2;

function checkBand(raw, viz, y, at) {
  if (raw === undefined) return { ok: true, band: undefined };
  if (viz !== 'line') return { ok: false, reason: at + ': "band" only works on a line chart.' };
  const isName = (v) => typeof v === 'string' && v.trim();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !isName(raw.low) || !isName(raw.high) || raw.low.trim() === raw.high.trim()) {
    return { ok: false, reason: at + ': "band" must name two different columns, like {"low": "p25", "high": "p75"}.' };
  }
  if (raw.opacity !== undefined && (typeof raw.opacity !== 'number' || !Number.isFinite(raw.opacity) || raw.opacity <= 0 || raw.opacity > 1)) {
    return { ok: false, reason: at + ': the "band" "opacity" must be a number above 0 and at most 1.' };
  }
  const band = { low: raw.low.trim(), high: raw.high.trim() };
  if (Array.isArray(y) && (y.includes(band.low) || y.includes(band.high))) {
    return { ok: false, reason: at + ': a "band" column is drawn as the band, so it cannot also be a "y" line.' };
  }
  if (raw.opacity !== undefined) band.opacity = raw.opacity;
  return { ok: true, band };
}

/* A cell as a number, or NaN when it is empty: an empty cell is a gap,
 * never a zero. */
function withBand(tile, check) {
  if (check.band) tile.band = check.band;
  return tile;
}

function cellNumber(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return NaN;
  return Number(v);
}

/* The band's polygons, one per unbroken run of rows: the high edge left
 * to right, then the low edge back. Pure, so the shape is measured. */
function bandPaths(rows, lowIdx, highIdx, xOf, yOf) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length) {
      const top = run.map((p) => p.x.toFixed(1) + ' ' + yOf(p.hi).toFixed(1));
      const bottom = run.slice().reverse().map((p) => p.x.toFixed(1) + ' ' + yOf(p.lo).toFixed(1));
      out.push('M ' + top.join(' L ') + ' L ' + bottom.join(' L ') + ' Z');
    }
    run = [];
  };
  rows.forEach((row, i) => {
    const lo = cellNumber(row[lowIdx]);
    const hi = cellNumber(row[highIdx]);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) { flush(); return; }
    run.push({ x: xOf(i), lo: Math.min(lo, hi), hi: Math.max(lo, hi) });
  });
  flush();
  return out;
}

/* Which axis a zone or a reference line on a combo chart follows. */
function checkMarkAxis(raw, viz, where) {
  if (raw === undefined) return { ok: true, axis: undefined };
  if (viz !== 'combo') return { ok: false, reason: where + ': "axis" only works on a combo chart, which has a right axis.' };
  if (raw !== 'left' && raw !== 'right') return { ok: false, reason: where + ': "axis" must be "left" or "right".' };
  return { ok: true, axis: raw === 'right' ? 'right' : undefined };
}

/* A combo chart: bars and lines in one chart, over one x column, each
 * series on the left or the right axis. "series" lists them in drawing
 * order: [{"column": "orders", "kind": "bar", "axis": "left", "color":
 * "#ee7733", "opacity": 0.5, "label": "Orders"}, {"column": "rate",
 * "kind": "line", "axis": "right", "dash": "3 3", "connect": true}].
 * "stack" stacks the bars. The right axis takes "y2Min", "y2Max",
 * "y2MaxLimit", "y2Ticks" and "y2Unit", like the left axis takes "yMin"
 * and the rest. Returns { ok, combo } or { ok, reason }. */
const COMBO_SERIES_MAX = 8;
const COMBO_LABEL_MAX = 40;
const COMBO_AXIS2_KEYS = ['y2Min', 'y2Max', 'y2MaxLimit', 'y2Ticks', 'y2Unit', 'y2TickSuffix', 'y2TickCompact'];
const COMBO_AXIS2_CHECKED = ['y2Min', 'y2Max', 'y2MaxLimit', 'y2Ticks', 'y2TickSuffix', 'y2TickCompact'];
const COMBO_KEYS = ['series'].concat(COMBO_AXIS2_KEYS);

function checkCombo(t, at) {
  if (t.viz !== 'combo') {
    for (const key of COMBO_KEYS) {
      if (t[key] !== undefined) return { ok: false, reason: at + ': "' + key + '" only works on a combo chart.' };
    }
    return { ok: true, combo: undefined };
  }
  const raw = t.series;
  if (!Array.isArray(raw) || !raw.length || raw.length > COMBO_SERIES_MAX) {
    return { ok: false, reason: at + ': a combo chart needs "series": a list of 1 to ' + COMBO_SERIES_MAX + ' columns, like [{"column": "orders", "kind": "bar"}, {"column": "rate", "kind": "line", "axis": "right"}].' };
  }
  const series = [];
  const seen = new Set();
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const where = at + ', series ' + (i + 1);
    if (!r || typeof r !== 'object' || typeof r.column !== 'string' || !r.column.trim()) return { ok: false, reason: where + ' needs a "column".' };
    const column = r.column.trim();
    if (seen.has(column)) return { ok: false, reason: where + ': the column "' + column + '" is already a series.' };
    seen.add(column);
    const kind = r.kind === undefined ? 'line' : r.kind;
    if (kind !== 'line' && kind !== 'bar') return { ok: false, reason: where + ': "kind" must be "line" or "bar".' };
    const axis = r.axis === undefined ? 'left' : r.axis;
    if (axis !== 'left' && axis !== 'right') return { ok: false, reason: where + ': "axis" must be "left" or "right".' };
    if (r.color !== undefined && !isLevelColor(r.color)) return { ok: false, reason: where + ': "color" must be a theme colour like "var(--color-orange)" or a hex colour like "#ee7733".' };
    if (r.opacity !== undefined && (typeof r.opacity !== 'number' || !Number.isFinite(r.opacity) || r.opacity <= 0 || r.opacity > 1)) {
      return { ok: false, reason: where + ': "opacity" must be a number above 0 and at most 1.' };
    }
    if (r.dash !== undefined && (kind !== 'line' || typeof r.dash !== 'string' || !DASH_RE.test(r.dash.trim()))) {
      return { ok: false, reason: where + ': "dash" is a dash pattern like "4 3", and only a line has one.' };
    }
    if (r.connect !== undefined && (kind !== 'line' || typeof r.connect !== 'boolean')) {
      return { ok: false, reason: where + ': "connect" is true or false, and only a line has it (true joins the line across empty rows).' };
    }
    if (r.label !== undefined && (typeof r.label !== 'string' || r.label.trim().length > COMBO_LABEL_MAX)) {
      return { ok: false, reason: where + ': "label" must be short text, ' + COMBO_LABEL_MAX + ' characters at most.' };
    }
    const one = { column, kind };
    if (axis === 'right') one.axis = 'right';
    if (r.color !== undefined) one.color = r.color.trim();
    if (r.opacity !== undefined) one.opacity = r.opacity;
    if (r.dash !== undefined) one.dash = r.dash.trim();
    if (r.connect === true) one.connect = true;
    if (r.label !== undefined && r.label.trim()) one.label = r.label.trim();
    series.push(one);
  }
  const combo = { series };
  const axis2 = {};
  for (const key of COMBO_AXIS2_CHECKED) if (t[key] !== undefined) axis2[key.replace('y2', 'y')] = t[key];
  const axisCheck = checkChartAxis(axis2, 'combo', at);
  if (!axisCheck.ok) return { ok: false, reason: axisCheck.reason.replace(/"y(Min|Max|MaxLimit|Ticks|TickSuffix|TickCompact)"/g, '"y2$1"') };
  for (const key of COMBO_AXIS2_CHECKED) if (axisCheck.axis[key.replace('y2', 'y')] !== undefined) combo[key] = axisCheck.axis[key.replace('y2', 'y')];
  if (t.y2Unit !== undefined) {
    if (typeof t.y2Unit !== 'string') return { ok: false, reason: at + ': "y2Unit" must be text, like "%".' };
    if (t.y2Unit) combo.y2Unit = t.y2Unit;
  }
  if (t.stack === true) {
    const bars = series.filter((x) => x.kind === 'bar');
    if (new Set(bars.map((x) => x.axis || 'left')).size > 1) return { ok: false, reason: at + ': "stack" stacks the bars, so every bar series must be on the same axis.' };
  }
  return { ok: true, combo };
}

function withCombo(tile, check) {
  if (!check.combo) return tile;
  for (const key of COMBO_KEYS) if (check.combo[key] !== undefined) tile[key] = check.combo[key];
  tile.y = check.combo.series.map((x) => x.column);
  return tile;
}

function renderComboChart(parentEl, table, tile, extras) {
  const xIdx = columnIndex(table.columns, tile.x);
  const series = (Array.isArray(tile.series) ? tile.series : [])
    .map((x) => Object.assign({}, x, { idx: columnIndex(table.columns, x.column) }))
    .filter((x) => x.idx >= 0);
  if (xIdx < 0 || !series.length || !table.rows.length) {
    parentEl.createDiv({ cls: 'icor-sqlv-empty', text: 'No rows to draw.' });
    return;
  }
  const palette = seriesPaletteFor(series.length);
  series.forEach((x, i) => { x.paint = isLevelColor(x.color) ? x.color.trim() : palette[i]; x.name = x.label || x.column; });
  const bars = series.filter((x) => x.kind === 'bar');
  const lines = series.filter((x) => x.kind === 'line');
  const stacked = tile.stack === true && bars.length > 1;
  const n = table.rows.length;
  const xLabels = table.rows.map((r) => r[xIdx]);
  /* What each axis has to hold. Bars stand on zero. */
  const span = { left: [], right: [] };
  const sideOf = (x) => (x.axis === 'right' ? 'right' : 'left');
  if (bars.length) span[sideOf(bars[0])].push(0);
  if (stacked) {
    for (const segs of stackRows(table.rows, bars.map((b) => b.idx))) span[sideOf(bars[0])].push(segs[segs.length - 1][1]);
  } else {
    for (const b of bars) for (const row of table.rows) { const v = cellNumber(row[b.idx]); if (Number.isFinite(v)) span[sideOf(b)].push(v); }
  }
  for (const l of lines) for (const row of table.rows) { const v = cellNumber(row[l.idx]); if (Number.isFinite(v)) span[sideOf(l)].push(v); }
  for (const z of tile.zones || []) span[z.axis === 'right' ? 'right' : 'left'].push(z.from, z.to);
  for (const r of tile.refLines || []) span[r.axis === 'right' ? 'right' : 'left'].push(r.y);
  const hasRight = series.some((x) => x.axis === 'right');
  const lo = (v) => (v.length ? Math.min(...v) : 0);
  const hi = (v) => (v.length ? Math.max(...v) : 1);
  const axis2 = { yMin: tile.y2Min, yMax: tile.y2Max, yMaxLimit: tile.y2MaxLimit, yTicks: tile.y2Ticks };
  const tickTextR = tickFormatter({ yTickSuffix: tile.y2TickSuffix, yTickCompact: tile.y2TickCompact });
  const unitOf = (x) => (x.axis === 'right' ? tile.y2Unit : tile.unit) || '';
  const chart = chartBox(parentEl, series.map((x) => x.name), series.map((x) => x.paint), (svg, W, H) => {
    /* The right axis is measured first, so the left layout leaves it room. */
    const ticksFor = (h) => Math.max(2, Math.min(5, Math.floor(h / 24)));
    let R = hasRight ? chartScaleFor(axis2, lo(span.right), hi(span.right), ticksFor(H - 26)) : null;
    const showR = hasRight && W >= CHART_MIN_Y_W;
    const rightW = showR ? Math.ceil(Math.max(...R.ticks.map((v) => tickTextR(v).length)) * TICK_CHAR_W) + 10 : 0;
    const L = chartLayout(W - rightW, H, lo(span.left), hi(span.left), true, tile);
    if (hasRight) R = chartScaleFor(axis2, lo(span.right), hi(span.right), ticksFor(L.plotH));
    const yOfR = hasRight
      ? (v) => Math.max(L.top, Math.min(L.top + L.plotH, L.top + L.plotH - ((v - R.min) / (R.max - R.min)) * L.plotH))
      : L.yOf;
    const RL = hasRight ? Object.assign({}, L, { yOf: yOfR, scale: R }) : L;
    const yOfSeries = (x) => (x.axis === 'right' ? yOfR : L.yOf);
    const slot = L.plotW / n;
    const gap = Math.min(4, slot * 0.2);
    const xOf = (i) => L.left + i * slot + slot / 2;
    drawZones(svg, L, { zones: (tile.zones || []).filter((z) => z.axis !== 'right') });
    if (hasRight) drawZones(svg, RL, { zones: (tile.zones || []).filter((z) => z.axis === 'right') });
    drawAxes(svg, L, xLabels, xOf);
    if (showR) {
      for (const tick of R.ticks) {
        const label = svgEl('text', { x: L.left + L.plotW + 6, y: yOfR(tick) + 3, 'text-anchor': 'start', class: 'icor-sqlv-tick' });
        label.textContent = tickTextR(tick);
        svg.appendChild(label);
      }
    }
    drawRefLines(svg, L, { refLines: (tile.refLines || []).filter((r) => r.axis !== 'right') });
    if (hasRight) drawRefLines(svg, RL, { refLines: (tile.refLines || []).filter((r) => r.axis === 'right') });
    const titleOf = (i, x, v) => String(xLabels[i]) + ' · ' + x.name + ' ' + formatNumber(v) + (unitOf(x) ? ' ' + unitOf(x) : '');
    /* Bars first, so the lines draw over them. */
    if (stacked) {
      const yOf = yOfSeries(bars[0]);
      stackRows(table.rows, bars.map((b) => b.idx)).forEach((segs, i) => {
        const x = L.left + i * slot + gap / 2;
        const w = Math.max(0.5, slot - gap);
        segs.forEach(([a, b], k) => {
          if (b <= a) return;
          const isTopmost = segs.slice(k + 1).every(([a2, b2]) => b2 <= a2);
          const inset = isTopmost ? 0 : 1;
          const yTop = yOf(b);
          const rect = svgEl('rect', { x: x.toFixed(1), y: (yTop + inset).toFixed(1), width: w.toFixed(1), height: Math.max(0.5, yOf(a) - yTop - inset).toFixed(1), class: 'icor-sqlv-combo-bar' });
          rect.setAttribute('fill', bars[k].paint);
          if (typeof bars[k].opacity === 'number') rect.setAttribute('fill-opacity', bars[k].opacity);
          const t = svgEl('title', {});
          t.textContent = titleOf(i, bars[k], b - a);
          rect.appendChild(t);
          svg.appendChild(rect);
        });
      });
    } else if (bars.length) {
      const inner = Math.max(0.5, (slot - gap) / bars.length);
      const r = inner >= 8 ? Math.min(2, inner / 2) : 0;
      table.rows.forEach((row, i) => {
        bars.forEach((b, k) => {
          const v = cellNumber(row[b.idx]);
          if (!Number.isFinite(v) || v <= 0) return;
          const yOf = yOfSeries(b);
          const x = L.left + i * slot + gap / 2 + k * inner;
          const bar = svgEl('path', { d: barPath(x, yOf(v), inner, Math.max(0.5, yOf(0) - yOf(v)), r), class: 'icor-sqlv-combo-bar' });
          bar.setAttribute('fill', b.paint);
          if (typeof b.opacity === 'number') bar.setAttribute('fill-opacity', b.opacity);
          const t = svgEl('title', {});
          t.textContent = titleOf(i, b, v);
          bar.appendChild(t);
          svg.appendChild(bar);
        });
      });
    }
    for (const l of lines) {
      const yOf = yOfSeries(l);
      let d = '';
      let open = false;
      table.rows.forEach((row, i) => {
        const v = cellNumber(row[l.idx]);
        if (!Number.isFinite(v)) { if (!l.connect) open = false; return; }
        d += (open ? ' L ' : (d ? ' M ' : 'M ')) + xOf(i).toFixed(1) + ' ' + yOf(v).toFixed(1);
        open = true;
      });
      if (!d) continue;
      const path = svgEl('path', { d, fill: 'none', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'icor-sqlv-combo-line' });
      path.setAttribute('stroke', l.paint);
      if (l.dash) path.setAttribute('stroke-dasharray', l.dash);
      if (typeof l.opacity === 'number') path.setAttribute('stroke-opacity', l.opacity);
      svg.appendChild(path);
    }
    /* Hover: a guide, a dot on each line, and every series on the chip. */
    const guide = svgEl('line', { y1: L.top, y2: L.top + L.plotH, class: 'icor-sqlv-guide', visibility: 'hidden' });
    const chip = svgEl('rect', { class: 'icor-sqlv-readout-chip', rx: 4, height: 18, visibility: 'hidden' });
    const readout = svgEl('text', { class: 'icor-sqlv-readout', visibility: 'hidden' });
    const dots = lines.map((l) => {
      const dot = svgEl('circle', { r: 3, class: 'icor-sqlv-hover-dot', visibility: 'hidden' });
      /* Each dot in its line's colour, through the custom property the
       * hover-dot rule already reads. */
      dot.style.setProperty('--sqlv-tile-series', l.paint);
      svg.appendChild(dot);
      return dot;
    });
    svg.appendChild(guide);
    svg.appendChild(chip);
    svg.appendChild(readout);
    const hover = svgEl('rect', { x: L.left, y: L.top, width: L.plotW, height: L.plotH, fill: 'transparent' });
    svg.appendChild(hover);
    hover.addEventListener('mousemove', (ev) => {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.floor((px - L.left) / slot)));
      const x = xOf(i);
      guide.setAttribute('x1', x); guide.setAttribute('x2', x); guide.setAttribute('visibility', 'visible');
      const parts = [String(xLabels[i])];
      for (const sr of series) {
        const v = cellNumber(table.rows[i][sr.idx]);
        if (Number.isFinite(v)) parts.push(sr.name + ' ' + formatNumber(v) + (unitOf(sr) ? ' ' + unitOf(sr) : ''));
      }
      lines.forEach((l, k) => {
        const v = cellNumber(table.rows[i][l.idx]);
        if (Number.isFinite(v)) {
          dots[k].setAttribute('cx', x); dots[k].setAttribute('cy', yOfSeries(l)(v)); dots[k].setAttribute('visibility', 'visible');
        } else {
          dots[k].setAttribute('visibility', 'hidden');
        }
      });
      readout.textContent = parts.join('  ·  ');
      const flip = x > W / 2;
      readout.setAttribute('x', flip ? x - 10 : x + 10);
      readout.setAttribute('y', L.top + 12);
      readout.setAttribute('text-anchor', flip ? 'end' : 'start');
      readout.setAttribute('visibility', 'visible');
      const textW = typeof readout.getComputedTextLength === 'function'
        ? readout.getComputedTextLength() : readout.textContent.length * 6;
      chip.setAttribute('width', Math.ceil(textW) + 12);
      chip.setAttribute('x', flip ? x - 16 - textW : x + 4);
      chip.setAttribute('y', L.top);
      chip.setAttribute('visibility', 'visible');
    });
    hover.addEventListener('mouseleave', () => {
      guide.setAttribute('visibility', 'hidden');
      chip.setAttribute('visibility', 'hidden');
      readout.setAttribute('visibility', 'hidden');
      for (const dot of dots) dot.setAttribute('visibility', 'hidden');
    });
  }, extras && extras.observers, guideEntries(tile));
  applyChartColors(chart.box, tile);
}

/* Round a value up to two significant figures: 213 -> 220, 1.34 -> 1.4. */
function ceilToTwoFigures(v) {
  if (!(v > 0)) return v;
  const step = Math.pow(10, Math.floor(Math.log10(v)) - 1);
  return Math.round(Math.ceil(v / step - 1e-9) * step * 1e9) / 1e9;
}

/* The y scale of a chart: the snug automatic scale, with the tile's own
 * ends and labels laid over it. Pure, so every rule is measured in the
 * gates. */
function chartScaleFor(axis, lo, hi, maxTicks) {
  const a = axis || {};
  const fixedMin = typeof a.yMin === 'number';
  const fixedMax = typeof a.yMax === 'number';
  if (!fixedMin && !fixedMax && !Array.isArray(a.yTicks)) return niceScale(lo, hi, maxTicks);
  const auto = niceScale(fixedMin ? a.yMin : lo, fixedMax ? a.yMax : hi, maxTicks);
  const min = fixedMin ? a.yMin : auto.min;
  let max = fixedMax ? a.yMax : auto.max;
  let grew = false;
  if (fixedMax && typeof a.yMaxLimit === 'number' && Number.isFinite(hi) && hi > a.yMax) {
    max = Math.min(a.yMaxLimit, Math.max(a.yMax, ceilToTwoFigures(hi)));
    grew = max > a.yMax;
  }
  let ticks = Array.isArray(a.yTicks) ? a.yTicks.slice() : niceScale(min, max, maxTicks).ticks;
  if (grew && Array.isArray(a.yTicks)) ticks.push(max);
  ticks = ticks.filter((v) => v >= min - 1e-9 && v <= max + 1e-9);
  return { min, max, step: auto.step, ticks };
}

/* Settings the edit form has no field for yet. Editing a widget keeps
 * them, as long as it stays the same type: a hand-written "yMin" survives
 * a save from the form. */
const FORM_UNEDITED_KEYS = [];

/* The option keys the form sets on a line, bar, stat or table widget,
 * copied from its parser check onto the built tile. */
const FORM_OPTION_KEYS = ['hint', 'footnote', 'meter', 'band', 'sparklines'].concat(CHART_AXIS_KEYS, CHART_MARK_KEYS);

/* A form row's text, each field as typed: numbers stay text until the
 * build reads them. */
function formRowsOf(list, keys) {
  return Array.isArray(list) ? list.map((r) => {
    const row = {};
    for (const k of keys) row[k] = r && r[k] !== undefined && r[k] !== null ? (typeof r[k] === 'boolean' ? r[k] : String(r[k])) : '';
    return row;
  }) : [];
}

/* The axis fields the form offers, by their name after the "y" or "y2". */
const FORM_AXIS_FIELDS = [
  ['Min', 'Lowest value', 'number', 'automatic'],
  ['Max', 'Highest value', 'number', 'automatic'],
  ['MaxLimit', 'Let the top grow up to', 'number', 'empty: the top stays at the highest value'],
  ['Ticks', 'Labels at', 'list', 'automatic, or like 0, 50, 100'],
  ['TickSuffix', 'Text after each label', 'text', 'like h or %'],
  ['TickCompact', 'Write thousands as k (8k)', 'bool', ''],
];

/* Widget types the form builds whole through the parser. */
const FORM_WHOLE_VIZ = new Set(['text', 'segments', 'pie', 'heatmap', 'calendar', 'combo', 'scatter', 'bullet']);

/* The chart types the SQL form offers, in the order of its list. */
const SQL_FORM_VIZ = [['line', 'Line chart'], ['bar', 'Bar chart'], ['combo', 'Bars and lines (combo)'], ['scatter', 'Scatter chart'], ['bullet', 'Bullet chart'], ['stat', 'One big number'], ['table', 'Table'], ['segments', 'Part-to-whole bar (segments)'], ['pie', 'Pie or doughnut chart'], ['heatmap', 'Heatmap'], ['calendar', 'Year calendar'], ['text', 'Text'], ['divider', 'Section divider']];

/* Widget types that judge values against ranges of levels. */
const LEVEL_VIZ = new Set(['stat', 'segments', 'pie', 'heatmap', 'calendar', 'bullet']);

/* The heatmap fields the form keeps, by state key and file key. */
const FORM_HEAT_FIELDS = [['heatRow', 'row'], ['heatColumn', 'column'], ['heatValue', 'value'], ['heatMarker', 'marker'], ['heatMarkerColor', 'markerColor'], ['heatMarkerLabel', 'markerLabel'], ['heatHighlight', 'highlight'], ['heatColumnLabelEvery', 'columnLabelEvery'], ['heatCells', 'cells']];

/* The calendar fields the form keeps, by state key and file key. */
const FORM_CAL_FIELDS = [['calDate', 'date'], ['calValue', 'value'], ['calWeekStart', 'weekStart'], ['calYear', 'year']];

function keepUneditedKeys(tile, existing) {
  if (!tile || !existing || existing.viz !== tile.viz) return tile;
  for (const key of FORM_UNEDITED_KEYS) {
    if (existing[key] !== undefined && tile[key] === undefined) tile[key] = existing[key];
  }
  return tile;
}

/* The database a tile actually reads. */
function tileDatabase(tile, spec) {
  return (tile.source && tile.source.database) || spec.database || '';
}

/* The SQL a tile actually runs. */
function tileSql(tile, spec) {
  return tile.source ? sqlForWidget(tile, spec.globalTimeframe) : tile.sql;
}

/* A parsed spec back to the JSON the builder saves. The inverse of
 * parseDashboardSpec for everything the plugin understands; unknown keys
 * from hand-edited files are not carried (the parser ignored them too). */
function specToJson(spec) {
  const out = { id: spec.id, title: spec.title };
  if (spec.database) out.database = spec.database;
  out.globalTimeframe = spec.globalTimeframe || DEFAULT_GLOBAL_TIMEFRAME;
  out.tiles = spec.tiles.map((t) => {
    const tile = {};
    if (t.title) tile.title = t.title;
    tile.viz = t.viz;
    if (t.unit) tile.unit = t.unit;
    if (t.stack) tile.stack = true;
    if (t.layout) tile.layout = { x: t.layout.x, y: t.layout.y, w: t.layout.w, h: t.layout.h };
    if (t.compare && t.compare !== 'none') tile.compare = t.compare;
    if (t.favorable && t.favorable !== 'up') tile.favorable = t.favorable;
    if (t.viz === 'divider') return tile;
    /* The notes ride every widget but a divider, a text widget included. */
    if (t.hint) tile.hint = t.hint;
    if (t.footnote) tile.footnote = t.footnote;
    if (t.viz === 'text') {
      if (t.text !== undefined) tile.text = t.text;
      if (t.sql) tile.sql = t.sql;
      if (t.line) tile.line = true;
      return tile;
    }
    if (Array.isArray(t.ranges) && t.ranges.length) {
      tile.ranges = t.ranges.map((r) => {
        const out = {};
        if (r.low !== undefined) out.low = r.low;
        if (r.high !== undefined) out.high = r.high;
        out.level = r.level;
        if (r.label) out.label = r.label;
        return out;
      });
      if (t.rangeColumn) tile.rangeColumn = t.rangeColumn;
    }
    if (t.levelColors && Object.keys(t.levelColors).length) tile.levelColors = Object.assign({}, t.levelColors);
    if (t.headerDelta === true) tile.headerDelta = true;
    if (t.headerDeltaAverageDays !== undefined && (t.headerDelta === true || t.chartCaption === 'change')) {
      tile.headerDeltaAverageDays = t.headerDeltaAverageDays;
    }
    if (t.chartCaption) tile.chartCaption = t.chartCaption;
    if (Array.isArray(t.captions) && t.captions.length) tile.captions = t.captions.slice();
    if (Array.isArray(t.sparklines) && t.sparklines.length) tile.sparklines = t.sparklines.slice();
    if (t.valueSize !== undefined) tile.valueSize = t.valueSize;
    if (t.color) tile.color = t.color;
    if (t.guideColor) tile.guideColor = t.guideColor;
    Object.assign(tile, chartAxisOf(t), chartMarksOf(t));
    if (t.segmentColors && Object.keys(t.segmentColors).length) tile.segmentColors = Object.assign({}, t.segmentColors);
    if (t.meter) tile.meter = Object.assign({}, t.meter);
    if (t.source) {
      const s = {};
      if (t.source.database) s.database = t.source.database;
      s.table = t.source.table;
      if (t.source.metric) s.metric = t.source.metric;
      s.agg = t.source.agg;
      if (t.source.filters && t.source.filters.length) {
        s.filters = t.source.filters.map((row) => {
          const out = { column: row.column, op: row.op };
          if (row.value !== undefined) out.value = row.value;
          return out;
        });
      }
      if (t.source.series) s.series = t.source.series;
      if (t.source.groupBy) s.groupBy = t.source.groupBy;
      if (t.source.timeColumn) s.timeColumn = t.source.timeColumn;
      s.timeframe = t.source.timeframe === undefined ? 'global' : t.source.timeframe;
      tile.source = s;
    } else {
      tile.sql = t.sql;
      if (t.x) tile.x = t.x;
      if (t.y && t.y.length && t.viz !== 'combo') tile.y = t.y.length === 1 ? t.y[0] : t.y;
      for (const key of COMBO_KEYS) {
        if (t.viz === 'combo' && t[key] !== undefined) tile[key] = key === 'series' ? t.series.map((x) => Object.assign({}, x)) : t[key];
      }
      if (t.band) tile.band = Object.assign({}, t.band);
      if (t.viz === 'heatmap') for (const key of HEAT_KEYS) if (t[key] !== undefined) tile[key] = t[key];
      if (t.viz === 'scatter') for (const key of SCATTER_KEYS) if (t[key] !== undefined) tile[key] = t[key];
      if (t.viz === 'calendar') for (const key of ['date', 'value', 'weekStart', 'year']) if (t[key] !== undefined) tile[key] = t[key];
      if (t.viz === 'bullet') for (const key of BULLET_KEYS) if (t[key] !== undefined) tile[key] = t[key];
      if (t.viz === 'pie' && t.doughnut === true) tile.doughnut = true;
    }
    return tile;
  });
  return JSON.stringify(out, null, 2) + '\n';
}

/* ------------------------------------------------------ ReadOut notes -- */

/* Dashboards and the phone cache are saved as Markdown notes, because the
 * notes Obsidian Sync carries by default are .md files: a .json file is an
 * "other file type", which default Sync leaves behind, so a phone on default
 * settings would show no dashboards at all.
 *
 * A ReadOut note is plain Markdown:
 *
 *   ---
 *   readout: dashboard        (or: cache)
 *   ---
 *
 *   One line saying what the note is.
 *
 *   ```json
 *   { ...the JSON, exactly as it used to be a .json file... }
 *   ```
 *
 * The frontmatter marks the file as ReadOut's, so a README or a note of the
 * member's in the same folder is never mistaken for one. The JSON sits in a
 * fenced block, so it reads as code, can be edited in Obsidian's own editor,
 * and comes back byte for byte: the fence is made longer than any run of
 * backticks inside the JSON, and everything outside the block (the line of
 * explanation, extra properties, a member's own words) is ignored when
 * reading. */
const READOUT_NOTE_PROPERTY = 'readout';
const READOUT_NOTE_LEAD = {
  dashboard: 'A ReadOut dashboard. Open it with the "Open dashboards" command or the chart icon in the left ribbon; the JSON below is the dashboard itself.',
  cache: 'The last answers ReadOut drew, kept so a phone can show them. ReadOut rewrites this note each time the desktop draws; change the dashboard, not this note.',
};

/* The note's text for some JSON text. Exact: readReadoutNote gives the same
 * text back. */
function writeReadoutNote(kind, jsonText) {
  const text = String(jsonText);
  let longest = 0;
  for (const run of text.match(/`+/g) || []) longest = Math.max(longest, run.length);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return '---\n' + READOUT_NOTE_PROPERTY + ': ' + kind + '\n---\n\n' + READOUT_NOTE_LEAD[kind] + '\n\n' + fence + 'json\n' + text + '\n' + fence + '\n';
}

/* Where the first json block sits in a note's text, or why there is none.
 * { marked: false } for a text that is not a ReadOut note of this kind (no
 * frontmatter, no `readout:` property, or another kind); { marked: true,
 * ok: false, reason } for one that is but cannot be read; otherwise
 * { marked: true, ok: true, raw, lines, open, close, fence }, raw being the
 * text with line endings made "\n" and lines what follows the frontmatter.
 * Pure; never throws. */
function locateReadoutNote(text, kind) {
  const raw = String(text === undefined || text === null ? '' : text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const fm = /^---\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/.exec(raw);
  if (!fm) return { marked: false };
  const mark = /^readout[ \t]*:[ \t]*["']?([A-Za-z]+)["']?[ \t]*$/m.exec(fm[1] || '');
  if (!mark || mark[1].toLowerCase() !== kind) return { marked: false };
  const lines = raw.slice(fm[0].length).split('\n');
  let open = -1;
  let fence = '';
  for (let i = 0; i < lines.length && open < 0; i++) {
    const m = /^ {0,3}(`{3,}|~{3,})[ \t]*json[ \t]*$/i.exec(lines[i]);
    if (m) { open = i; fence = m[1]; }
  }
  if (open < 0) return { marked: true, ok: false, reason: 'This ReadOut note has no json block.' };
  const closer = new RegExp('^ {0,3}' + fence[0] + '{' + fence.length + ',}[ \\t]*$');
  let close = -1;
  for (let i = open + 1; i < lines.length && close < 0; i++) if (closer.test(lines[i])) close = i;
  if (close < 0) return { marked: true, ok: false, reason: 'The json block in this ReadOut note is not closed.' };
  return { marked: true, ok: true, raw, head: raw.slice(0, raw.length - lines.join('\n').length), lines, open, close, fence };
}

/* The JSON text inside a ReadOut note of this kind: { marked, ok, json }, or
 * the reason it cannot be read. */
function readReadoutNote(text, kind) {
  const at = locateReadoutNote(text, kind);
  if (!at.marked || !at.ok) return at;
  return { marked: true, ok: true, json: at.lines.slice(at.open + 1, at.close).join('\n') };
}

/* A note's text with only the JSON inside its block replaced, so whatever a
 * member wrote around the block survives a save from the builder. A fence
 * that is too short for the new JSON (or a tilde fence) is swapped for a
 * backtick fence that fits; the rest of the note is kept. A note that cannot
 * be read at all comes back written afresh. */
function rewriteReadoutNote(existingText, kind, jsonText) {
  const at = locateReadoutNote(existingText, kind);
  const text = String(jsonText);
  const needs = Math.max(3, ...(text.match(/`+/g) || []).map((r) => r.length + 1));
  if (!at.marked || !at.ok) return writeReadoutNote(kind, text);
  const fits = at.fence[0] === '`' && at.fence.length >= needs;
  const fence = fits ? null : '`'.repeat(needs);
  const open = fence ? fence + 'json' : at.lines[at.open];
  const close = fence ? fence : at.lines[at.close];
  return at.head + at.lines.slice(0, at.open).concat([open], text.split('\n'), [close], at.lines.slice(at.close + 1)).join('\n');
}

/* The .md twin of a .json path, in the same folder. */
function noteTwinOf(path) {
  return String(path).replace(/\.json$/i, '.md');
}

/* Where a dashboard's computed results live in the vault, so Obsidian Sync
 * carries them to devices that cannot open the database itself. Since
 * 0.2.0 a dashboard can read several databases, so the cache is keyed by
 * dashboard id; cachePathFor stays for reading a 0.1.x cache. The notes
 * (.md) are what is written and read first; the .json paths are what
 * versions before 1.1 wrote, still read as a fallback. */
function cachePathFor(cacheFolder, dbPath, dashboardId) {
  return normalizePath(cacheFolder + '/' + stemOf(dbPath) + '/' + dashboardId + '.json');
}

function dashCachePath(cacheFolder, dashboardId, ext) {
  return normalizePath(cacheFolder + '/dashboards/' + dashboardId + '.' + (ext || 'md'));
}

/* The catalog a desktop writes next to the cache: enough schema for the
 * mobile picker when the database itself cannot be opened there. */
/* A short stable key for a database: the stem stays readable, the FNV-1a
 * hash of the full vault path keeps two same-named databases apart. */
function shortHash(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function dbKeyOf(dbPath) {
  return stemOf(dbPath) + '-' + shortHash(normalizePath(dbPath));
}

/* Base64 decoding that works in every runtime the plugin sees: Node's
 * Buffer on the Electron desktop and in the gates, atob in the mobile
 * web view. Used for the embedded sql.js copies at the end of this file. */
function bytesOfB64(b64) {
  if (typeof Buffer === 'function' && typeof Buffer.from === 'function') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function catalogPathFor(cacheFolder, dbPath, ext) {
  return normalizePath(cacheFolder + '/catalogs/' + dbKeyOf(dbPath) + '.' + (ext || 'md'));
}

/* Where a 0.5.0 catalog lived, read as a fallback until it regenerates. */
function legacyCatalogPathFor(cacheFolder, dbPath) {
  return normalizePath(cacheFolder + '/catalogs/' + stemOf(dbPath) + '.json');
}

/* ---------------------------------------------------------- chart math -- */

/* A pleasant axis: round step sizes, ticks that land on round numbers. */
function niceScale(lo, hi, maxTicks) {
  let min = Number(lo);
  let max = Number(hi);
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 0;
  if (min > max) { const t = min; min = max; max = t; }
  if (min === max) { max = min === 0 ? 1 : min + Math.abs(min) * 0.1; }
  const span = max - min;
  const count = Math.max(2, maxTicks || 5);
  const rough = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  let step = mag;
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (mag * m >= rough) { step = mag * m; break; }
  }
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 1e6; v += step) ticks.push(Math.round(v * 1e9) / 1e9);
  return { min: start, max: end, step, ticks };
}

/* Stacked bar segments: for each row, each series' [base, top]. Negative
 * values are clamped to zero rather than drawn downward; a stacked chart of
 * hours or counts has no meaningful negative direction. */
function stackRows(rows, seriesIdx) {
  return rows.map((row) => {
    let base = 0;
    return seriesIdx.map((i) => {
      const v = Math.max(0, Number(row[i]) || 0);
      const seg = [base, base + v];
      base += v;
      return seg;
    });
  });
}

function columnIndex(columns, name) { return columns.indexOf(name); }

/* The value a stat tile shows: the named y column of the first row, or the
 * first column when no y is named. The next column, if any, is the caption;
 * a tile's rangeColumn is judged, never shown, so it is skipped. A tile
 * with "captions" names its caption lines instead, one column each; a
 * named column that is missing or empty gives no line. */
function statOf(table, tile) {
  if (!table.rows.length) return { value: null, caption: '', captions: [] };
  const row = table.rows[0];
  const yName = tile.y && tile.y.length ? tile.y[0] : table.columns[0];
  const yIdx = Math.max(0, columnIndex(table.columns, yName));
  const scoreIdx = tile.rangeColumn ? columnIndex(table.columns, tile.rangeColumn) : -1;
  const captionIdx = table.columns.findIndex((c, i) => i !== yIdx && i !== scoreIdx);
  const text = (v) => (v === null || v === undefined ? '' : String(v));
  const caption = captionIdx >= 0 ? text(row[captionIdx]) : '';
  const captions = Array.isArray(tile.captions)
    ? tile.captions.map((name) => columnIndex(table.columns, name)).filter((i) => i >= 0).map((i) => text(row[i])).filter(Boolean)
    : (caption ? [caption] : []);
  return { value: row[yIdx], caption, captions };
}

/* ------------------------------------------- widgets built without SQL -- */

/* A structured widget names what it wants (database, table, metric,
 * aggregation, slices, time) and deterministic code turns that into SQL,
 * always through quoteIdent and quoteLiteral, always through the statement
 * gate. One render path for hand-written SQL tiles and built widgets. */

const AGGS = { sum: 'SUM', avg: 'AVG', min: 'MIN', max: 'MAX', count: 'COUNT', latest: 'LATEST' };
const AGG_LABELS = { sum: 'Add up', avg: 'Average', min: 'Lowest', max: 'Highest', count: 'Count rows', latest: 'Latest value' };
const PRESETS = { '7d': { days: 7 }, '30d': { days: 30 }, '90d': { days: 90 }, '12m': { months: 12 }, all: null };
const PRESET_LABELS = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', '12m': 'Last 12 months', all: 'All time' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_GLOBAL_TIMEFRAME = { preset: '90d' };

/* Is this a usable timeframe value? 'global' means: follow the dashboard. */
function validTimeframe(tf, allowGlobal) {
  if (tf === undefined || tf === null) return true;
  if (tf === 'global') return !!allowGlobal;
  if (typeof tf !== 'object') return false;
  if (tf.preset !== undefined) return Object.prototype.hasOwnProperty.call(PRESETS, tf.preset);
  if (tf.from !== undefined || tf.to !== undefined) return DATE_RE.test(String(tf.from)) && DATE_RE.test(String(tf.to));
  return false;
}

/* A widget set to "global" takes the dashboard's range; a fixed one keeps
 * its own; nothing at all falls back to the dashboard as well. */
function resolveTimeframe(tf, globalTf) {
  const fallback = globalTf || DEFAULT_GLOBAL_TIMEFRAME;
  if (tf === undefined || tf === null || tf === 'global') return fallback;
  return tf;
}

/* The filter operators, in plain words. Each maps one filter row to one
 * SQL condition, always through quoteIdent and quoteLiteral. */
const FILTER_OPS = {
  eq: { label: 'is', sql: (c, v) => quoteIdent(c) + ' = ' + quoteLiteral(v) },
  ne: { label: 'is not', sql: (c, v) => quoteIdent(c) + ' <> ' + quoteLiteral(v) },
  contains: { label: 'contains', sql: (c, v) => filterClause(c, v) },
  not_contains: { label: 'does not contain', sql: (c, v) => 'NOT (' + filterClause(c, v) + ')' },
  gt: { label: 'greater than', sql: (c, v) => quoteIdent(c) + ' > ' + quoteLiteral(v) },
  gte: { label: 'at least', sql: (c, v) => quoteIdent(c) + ' >= ' + quoteLiteral(v) },
  lt: { label: 'less than', sql: (c, v) => quoteIdent(c) + ' < ' + quoteLiteral(v) },
  lte: { label: 'at most', sql: (c, v) => quoteIdent(c) + ' <= ' + quoteLiteral(v) },
  empty: { label: 'is empty', noValue: true, sql: (c) => '(' + quoteIdent(c) + " IS NULL OR " + quoteIdent(c) + " = '')" },
  not_empty: { label: 'is not empty', noValue: true, sql: (c) => '(' + quoteIdent(c) + " IS NOT NULL AND " + quoteIdent(c) + " <> '')" },
};

function filterConditionOf(row) {
  const op = FILTER_OPS[row.op || 'eq'];
  if (!op) return '';
  return op.sql(row.column, row.value);
}

/* Every filter row of a source as one AND chain. */
function filtersCondOf(s) {
  const rows = Array.isArray(s.filters) ? s.filters : [];
  return rows.map(filterConditionOf).filter(Boolean).join(' AND ');
}

/* The WHERE pieces for a timeframe. Presets anchor on the newest row the
 * table has (per filter), not on today, so a chart over a data set that
 * stopped updating still shows its last days instead of nothing.
 * `shift` widens the view backwards: 'previous' is the period before the
 * current one, 'year' is the same period one year earlier. */
function timeframeConditions({ table, timeColumn, frame, filterCond, shift }) {
  if (!timeColumn || !frame) return [];
  const col = quoteIdent(timeColumn);
  if (frame.preset !== undefined) {
    const span = PRESETS[frame.preset];
    if (!span) return []; /* 'all' has no previous period either */
    const step = span.days ? span.days + ' day' : span.months + ' month';
    const anchor = '(SELECT MAX(' + col + ') FROM ' + quoteIdent(table) + (filterCond ? ' WHERE ' + filterCond : '') + ')';
    if (shift === 'previous') {
      return [
        col + ' >= date(' + anchor + ", '-" + (span.days ? span.days * 2 + ' day' : span.months * 2 + ' month') + "')",
        col + ' < date(' + anchor + ", '-" + step + "')",
      ];
    }
    if (shift === 'year') {
      return [
        col + ' >= date(' + anchor + ", '-1 year', '-" + step + "')",
        col + " <= date(" + anchor + ", '-1 year')",
      ];
    }
    return [col + ' >= date(' + anchor + ", '-" + step + "')"];
  }
  if (shift === 'previous') {
    const spanDays = "(julianday(" + quoteLiteral(frame.to) + ") - julianday(" + quoteLiteral(frame.from) + ") + 1)";
    return [
      col + ' >= date(' + quoteLiteral(frame.from) + ", '-' || " + spanDays + " || ' day')",
      col + ' < ' + quoteLiteral(frame.from),
    ];
  }
  if (shift === 'year') {
    return [
      col + ' >= date(' + quoteLiteral(frame.from) + ", '-1 year')",
      col + ' <= date(' + quoteLiteral(frame.to) + ", '-1 year')",
    ];
  }
  return [
    col + ' >= ' + quoteLiteral(frame.from),
    col + ' <= ' + quoteLiteral(frame.to),
  ];
}

/* Descriptor to SQL. Charts come back as (x[, series], value); stats as a
 * single value row. Pure and deterministic: the same descriptor and the
 * same global range always produce the same string. `shift` produces the
 * comparison period's twin query. */
function sqlForWidget(tile, globalTf, shift) {
  const s = tile.source;
  const table = quoteIdent(s.table);
  const filterCond = filtersCondOf(s);
  const conds = filterCond ? [filterCond] : [];
  const frame = resolveTimeframe(s.timeframe, globalTf);
  conds.push(...timeframeConditions({ table: s.table, timeColumn: s.timeColumn, frame, filterCond, shift }));
  const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';

  if (tile.viz === 'stat') {
    if (s.agg === 'latest') {
      return 'SELECT ' + quoteIdent(s.metric) + ' AS value' + (s.timeColumn ? ', ' + quoteIdent(s.timeColumn) + ' AS at' : '') +
        ' FROM ' + table + where +
        (s.timeColumn ? ' ORDER BY ' + quoteIdent(s.timeColumn) + ' DESC' : '') + ' LIMIT 1';
    }
    const expr = s.agg === 'count' ? 'COUNT(*)' : AGGS[s.agg] + '(' + quoteIdent(s.metric) + ')';
    return 'SELECT ' + expr + ' AS value FROM ' + table + where;
  }

  const groupBy = s.groupBy || s.timeColumn;
  const expr = s.agg === 'count' ? 'COUNT(*)' : AGGS[s.agg] + '(' + quoteIdent(s.metric) + ')';
  let sql = 'SELECT ' + quoteIdent(groupBy) + ' AS x';
  if (s.series) sql += ', ' + quoteIdent(s.series) + ' AS series';
  sql += ', ' + expr + ' AS value FROM ' + table + where;
  sql += ' GROUP BY ' + quoteIdent(groupBy) + (s.series ? ', ' + quoteIdent(s.series) : '');
  sql += ' ORDER BY ' + quoteIdent(groupBy);
  return sql;
}

/* Long (x, series, value) rows to wide columns, one per series, so the
 * chart renderer sees the same shape a hand-written multi-column query
 * produces. Series are ordered by total, biggest first, capped at 8. */
function pivotSeries(table) {
  const xi = columnIndex(table.columns, 'x');
  const si = columnIndex(table.columns, 'series');
  const vi = columnIndex(table.columns, 'value');
  if (xi < 0 || si < 0 || vi < 0) return table;
  const totals = new Map();
  for (const row of table.rows) {
    const key = String(row[si]);
    totals.set(key, (totals.get(key) || 0) + (Number(row[vi]) || 0));
  }
  const ranked = [...totals.keys()].sort((a, b) => (totals.get(b) || 0) - (totals.get(a) || 0));
  /* The extent is bounded by design, never by data: at six or more series
   * the top four keep their lenses and the rest aggregate as Other. */
  const degrade = ranked.length > SERIES_CEILING;
  const names = degrade ? ranked.slice(0, SERIES_CEILING - 1) : ranked;
  const index = new Map(names.map((n, i) => [n, i]));
  const otherSlot = degrade ? names.length : -1;
  const width = names.length + (degrade ? 1 : 0);
  const xOrder = [];
  const byX = new Map();
  for (const row of table.rows) {
    const x = row[xi];
    const key = String(x);
    if (!byX.has(key)) { byX.set(key, new Array(width).fill(null)); xOrder.push(x); }
    let slot = index.get(String(row[si]));
    if (slot === undefined) slot = otherSlot;
    if (slot >= 0) {
      const cells = byX.get(key);
      const v = Number(row[vi]);
      if (Number.isFinite(v)) cells[slot] = (cells[slot] || 0) + v;
    }
  }
  const columns = ['x', ...names];
  if (degrade) columns.push('Other');
  return { columns, rows: xOrder.map((x) => [x, ...byX.get(String(x))]) };
}

/* What the renderer needs for any tile: the tile's own axes for a raw SQL
 * tile, generated axes (and a pivot when there is a series) for a built
 * one. Pure, so the live path and the cache path share it. */
function prepareTileForRender(tile, table) {
  const out = prepareTileShape(tile, table);
  if (out.spec !== tile) {
    if (tile.hint) out.spec.hint = tile.hint;
    if (tile.footnote) out.spec.footnote = tile.footnote;
  }
  return out;
}

function prepareTileShape(tile, table) {
  if (!tile.source) return { spec: tile, table };
  if (tile.viz === 'stat') {
    return { spec: { title: tile.title, viz: 'stat', y: ['value'], unit: tile.unit, ranges: tile.ranges, levelColors: tile.levelColors, valueSize: tile.valueSize, meter: tile.meter }, table };
  }
  if (tile.source.series) {
    const wide = pivotSeries(table);
    return {
      spec: Object.assign({ title: tile.title, viz: tile.viz, x: 'x', y: wide.columns.slice(1), unit: tile.unit, stack: tile.stack }, chartAxisOf(tile), chartMarksOf(tile)),
      table: wide,
    };
  }
  return {
    spec: Object.assign({ title: tile.title, viz: tile.viz, x: 'x', y: ['value'], unit: tile.unit, stack: false, headerDelta: tile.headerDelta, headerDeltaAverageDays: tile.headerDeltaAverageDays, chartCaption: tile.chartCaption, color: tile.color, guideColor: tile.guideColor }, chartAxisOf(tile), chartMarksOf(tile)),
    table,
  };
}

/* Validate one structured source. Returns { ok } or { ok, reason }. */
function checkWidgetSource(s, viz, at) {
  if (!s || typeof s !== 'object') return { ok: false, reason: at + ': "source" must be an object.' };
  if (typeof s.table !== 'string' || !s.table) return { ok: false, reason: at + ' needs a "table".' };
  const agg = s.agg === undefined ? 'sum' : s.agg;
  if (!AGGS[agg]) return { ok: false, reason: at + ': "agg" must be one of sum, avg, min, max, count, latest.' };
  if (agg !== 'count' && (typeof s.metric !== 'string' || !s.metric)) return { ok: false, reason: at + ' needs a "metric" column.' };
  if (agg === 'latest' && viz !== 'stat') return { ok: false, reason: at + ': "latest" only works on a stat widget.' };
  const rawFilters = s.filters !== undefined ? s.filters
    : (s.filter !== undefined ? [Object.assign({ op: 'eq' }, s.filter)] : []);
  if (!Array.isArray(rawFilters)) return { ok: false, reason: at + ': "filters" must be a list of rows.' };
  const filters = [];
  for (const row of rawFilters) {
    if (!row || typeof row.column !== 'string' || !row.column) {
      return { ok: false, reason: at + ': every filter row needs a "column".' };
    }
    const op = row.op === undefined ? 'eq' : row.op;
    if (!FILTER_OPS[op]) {
      return { ok: false, reason: at + ': a filter "op" must be one of ' + Object.keys(FILTER_OPS).join(', ') + '.' };
    }
    if (!FILTER_OPS[op].noValue && (row.value === undefined || row.value === null)) {
      return { ok: false, reason: at + ': the filter on ' + row.column + ' needs a "value".' };
    }
    filters.push({ column: row.column, op, value: FILTER_OPS[op].noValue ? undefined : String(row.value) });
  }
  if (s.series !== undefined && (typeof s.series !== 'string' || !s.series)) return { ok: false, reason: at + ': "series" must be a column name.' };
  if (s.series && viz === 'stat') return { ok: false, reason: at + ': a stat widget cannot be split into series.' };
  if (s.groupBy !== undefined && (typeof s.groupBy !== 'string' || !s.groupBy)) return { ok: false, reason: at + ': "groupBy" must be a column name.' };
  if (s.timeColumn !== undefined && (typeof s.timeColumn !== 'string' || !s.timeColumn)) return { ok: false, reason: at + ': "timeColumn" must be a column name.' };
  if (!validTimeframe(s.timeframe, true)) return { ok: false, reason: at + ': "timeframe" must be "global", a preset like {"preset":"90d"}, or {"from":"YYYY-MM-DD","to":"YYYY-MM-DD"}.' };
  if (viz !== 'stat' && !s.groupBy && !s.timeColumn) return { ok: false, reason: at + ' needs a "groupBy" or a "timeColumn" to chart over.' };
  if (s.database !== undefined && (typeof s.database !== 'string' || !s.database)) return { ok: false, reason: at + ': "database" must be a vault path.' };
  return { ok: true, agg, filters };
}

/* Column-type helpers for the picker and the catalog. */
function isNumericType(type) { return /INT|REAL|FLOA|DOUB|NUM|DEC/i.test(String(type || '')); }
function isTextType(type) { const t = String(type || ''); return t === '' || /CHAR|TEXT|CLOB/i.test(t); }

/* A friendly guess at the time column: the names common tables actually
 * use, most specific first. Just a default; the picker lets it change. */
function guessTimeColumn(columns) {
  const names = columns.map((c) => c.name);
  for (const exact of ['local_date', 'batch_id', 'snapshot_date', 'period_end']) {
    if (names.includes(exact)) return exact;
  }
  return names.find((n) => /date|_at$|^at$|timestamp|day|week|month/i.test(n)) || '';
}

/* Case-insensitive word match for the picker lists: every word the member
 * typed must appear somewhere in the label or the detail. */
function matchesNeedle(needle, label, detail) {
  const hay = (String(label || '') + ' ' + String(detail || '')).toLowerCase();
  return String(needle || '').toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/* ----------------------------------------------------- the grid engine -- */

/* How many columns fit a container of this width, keeping cells roughly
 * GRID_UNIT_PX square. Phones get 2, wide panes get up to 6. */
function colsForWidth(width) {
  const w = Number(width) || 0;
  const cols = Math.floor((w + GRID_GAP_PX) / (GRID_UNIT_PX + GRID_GAP_PX));
  return Math.max(GRID_MIN_COLS, Math.min(GRID_MAX_COLS, cols));
}

/* A segments bar: one horizontal bar split into the rows of the query,
 * each as wide as its share of the total: how a whole divides. "x" names
 * each part, "y" sizes it, in the query's order. "segmentColors" colours
 * the parts by name ({"Done": "#228833"}); a part without one takes the
 * theme's series colours. Like a stat, "ranges" with a "rangeColumn"
 * judge one number from the first row and mark the widget with a level.
 * Returns { ok, colors } or { ok, reason }. */
const SEGMENTS_MAX = 12;
const SEGMENT_LABEL_MIN_SHARE = 8;

/* A segments bar and a pie chart are both a whole divided into parts: the
 * same columns, the same part colours, the same level on the whole. */
function isPartsViz(viz) { return viz === 'segments' || viz === 'pie'; }

function checkSegments(t, y, levelCheck, at) {
  if (!isPartsViz(t.viz)) {
    if (t.segmentColors !== undefined) return { ok: false, reason: at + ': "segmentColors" only work on a segments bar or a pie chart.' };
    return { ok: true, colors: undefined };
  }
  const what = t.viz === 'pie' ? 'a pie chart' : 'a segments bar';
  if (typeof t.x !== 'string' || !t.x) return { ok: false, reason: at + ' needs an "x" column for ' + what + ': the name of each part.' };
  if (y.length !== 1) return { ok: false, reason: at + ' needs one "y" column for ' + what + ': the size of each part.' };
  if (levelCheck.ranges && !levelCheck.rangeColumn) {
    return { ok: false, reason: at + ': ' + what + ' has no single value, so its "ranges" need a "rangeColumn" to judge.' };
  }
  const raw = t.segmentColors;
  if (raw === undefined) return { ok: true, colors: undefined };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: at + ': "segmentColors" must be an object like {"Done": "#228833"}.' };
  }
  const colors = {};
  for (const [name, color] of Object.entries(raw)) {
    if (!isLevelColor(color)) return { ok: false, reason: at + ': the colour for "' + name + '" in "segmentColors" must be a theme colour like "var(--color-green)" or a hex colour like "#228833".' };
    colors[name] = color.trim();
  }
  return { ok: true, colors };
}

function withSegments(tile, check) {
  if (check.colors && Object.keys(check.colors).length) tile.segmentColors = check.colors;
  return tile;
}

/* The parts of a segments bar: name, value, share of the total (0 to
 * 100) and colour, for the rows with a positive value. Pure. */
function segmentsOf(table, tile) {
  const xi = columnIndex(table.columns, tile.x);
  const yi = columnIndex(table.columns, (tile.y || [])[0]);
  if (xi < 0 || yi < 0) return [];
  const rows = table.rows.slice(0, SEGMENTS_MAX)
    .map((r) => ({ name: r[xi] === null || r[xi] === undefined ? '' : String(r[xi]), value: Number(r[yi]) }))
    .filter((p) => Number.isFinite(p.value) && p.value >= 0);
  const total = rows.reduce((a, p) => a + p.value, 0);
  const palette = seriesPaletteFor(Math.max(2, rows.length));
  const own = tile.segmentColors || {};
  return rows.map((p, i) => Object.assign(p, {
    share: total > 0 ? (p.value / total) * 100 : 0,
    color: Object.prototype.hasOwnProperty.call(own, p.name) && isLevelColor(own[p.name]) ? own[p.name] : palette[i],
  }));
}

function renderSegments(parentEl, table, tile, extras) {
  const parts = segmentsOf(table, tile);
  if (!parts.length || !parts.some((p) => p.value > 0)) {
    parentEl.createDiv({ cls: 'icor-sqlv-empty', text: 'No rows to draw.' });
    return null;
  }
  const unit = tile.unit ? (tile.unit === '%' ? '%' : ' ' + tile.unit) : '';
  const wrap = parentEl.createDiv({ cls: 'icor-sqlv-segments' });
  const bar = wrap.createDiv({ cls: 'icor-sqlv-segments-bar' });
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', parts.map((p) => p.name + ': ' + formatNumber(p.value) + unit).join('. '));
  for (const p of parts) {
    if (p.value <= 0) continue;
    const seg = bar.createDiv({ cls: 'icor-sqlv-segment' });
    seg.style.setProperty('width', p.share.toFixed(3) + '%');
    seg.style.setProperty('background', p.color);
    seg.setAttribute('title', p.name + ': ' + formatNumber(p.value) + unit);
    if (p.share >= SEGMENT_LABEL_MIN_SHARE) seg.createSpan({ cls: 'icor-sqlv-segment-label', text: Math.round(p.share) + '%' });
  }
  const legend = wrap.createDiv({ cls: 'icor-sqlv-segments-legend' });
  for (const p of parts) {
    const item = legend.createSpan({ cls: 'icor-sqlv-legend-item' });
    const chip = item.createSpan({ cls: 'icor-sqlv-legend-chip is-round' });
    chip.style.setProperty('background', p.color);
    item.createSpan({ cls: 'icor-sqlv-legend-name', text: p.name, attr: { title: p.name } });
    item.createSpan({ cls: 'icor-sqlv-segments-value', text: formatNumber(p.value) + unit });
  }
  return parts.map((p) => p.name + ' ' + formatNumber(p.value) + unit).join(', ');
}

/* A pie chart: the same parts as a segments bar (one row each, "x" names
 * it, "y" sizes it, "segmentColors" colours it, "ranges" with a
 * "rangeColumn" mark the whole widget), drawn as slices of a circle from
 * twelve o'clock, clockwise, in the order of the rows, with a legend that
 * names each part, its value and its share. "doughnut": true cuts a hole
 * in the middle and writes the total in it. Drawn by hand as SVG in a
 * square box that CSS scales, so it needs no measuring. */
const PIE_R = 46;
const PIE_HOLE = 27;

function checkPie(t, at) {
  if (t.viz !== 'pie') {
    if (t.doughnut !== undefined) return { ok: false, reason: at + ': "doughnut" only works on a pie chart.' };
    return { ok: true, pie: undefined };
  }
  if (t.doughnut !== undefined && typeof t.doughnut !== 'boolean') return { ok: false, reason: at + ': "doughnut" must be true or false.' };
  return { ok: true, pie: t.doughnut === true ? { doughnut: true } : undefined };
}

function withPie(tile, check) {
  if (check.pie) Object.assign(tile, check.pie);
  return tile;
}

/* The outline of one slice from angle a0 to a1 (radians, 0 at twelve
 * o'clock, clockwise): a wedge from the centre or, with an inner radius, a
 * ring segment. A slice that is the whole circle is a circle (or, with a
 * hole, two), because an arc from a point to itself draws nothing. */
function piePath(cx, cy, rOut, rIn, a0, a1) {
  const pt = (r, a) => (cx + r * Math.sin(a)).toFixed(2) + ' ' + (cy - r * Math.cos(a)).toFixed(2);
  if (a1 - a0 >= 2 * Math.PI - 1e-6) {
    const circle = (r) => 'M ' + (cx - r) + ' ' + cy + ' A ' + r + ' ' + r + ' 0 1 1 ' + (cx + r) + ' ' + cy + ' A ' + r + ' ' + r + ' 0 1 1 ' + (cx - r) + ' ' + cy + ' Z';
    return rIn > 0 ? circle(rOut) + ' ' + circle(rIn) : circle(rOut);
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  if (rIn > 0) {
    return 'M ' + pt(rOut, a0) + ' A ' + rOut + ' ' + rOut + ' 0 ' + large + ' 1 ' + pt(rOut, a1) +
      ' L ' + pt(rIn, a1) + ' A ' + rIn + ' ' + rIn + ' 0 ' + large + ' 0 ' + pt(rIn, a0) + ' Z';
  }
  return 'M ' + cx + ' ' + cy + ' L ' + pt(rOut, a0) + ' A ' + rOut + ' ' + rOut + ' 0 ' + large + ' 1 ' + pt(rOut, a1) + ' Z';
}

/* The slices of a pie: each part with a positive value, with its start and
 * end angle and its outline. Pure. */
function pieOf(table, tile) {
  const parts = segmentsOf(table, tile);
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (!(total > 0)) return { parts, total: 0, slices: [] };
  const rIn = tile.doughnut === true ? PIE_HOLE : 0;
  let at = 0;
  const slices = [];
  for (const p of parts) {
    if (!(p.value > 0)) continue;
    const a0 = at;
    at += (p.value / total) * 2 * Math.PI;
    slices.push(Object.assign({}, p, { a0, a1: at, d: piePath(50, 50, PIE_R, rIn, a0, at) }));
  }
  return { parts, total, slices };
}

function renderPie(parentEl, table, tile, extras) {
  const pie = pieOf(table, tile);
  if (!pie.slices.length) {
    parentEl.createDiv({ cls: 'icor-sqlv-empty', text: 'No rows to draw.' });
    return null;
  }
  const unit = tile.unit ? (tile.unit === '%' ? '%' : ' ' + tile.unit) : '';
  const said = pie.parts.map((p) => p.name + ': ' + formatNumber(p.value) + unit + ' (' + Math.round(p.share) + '%)').join('. ');
  /* The tile body that holds a pie is the container the stacking rule measures. */
  parentEl.addClass('icor-sqlv-has-pie');
  const wrap = parentEl.createDiv({ cls: 'icor-sqlv-pie' });
  const svg = svgEl('svg', { viewBox: '0 0 100 100', class: 'icor-sqlv-pie-svg', role: 'img', 'aria-label': said });
  for (const sl of pie.slices) {
    const path = svgEl('path', { d: sl.d, class: 'icor-sqlv-pie-slice', 'fill-rule': 'evenodd' });
    path.style.setProperty('fill', sl.color);
    const tip = svgEl('title', {});
    tip.textContent = sl.name + ': ' + formatNumber(sl.value) + unit + ' (' + Math.round(sl.share) + '%)';
    path.appendChild(tip);
    svg.appendChild(path);
  }
  if (tile.doughnut === true) {
    const total = svgEl('text', { x: 50, y: 50, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'icor-sqlv-pie-total' });
    total.textContent = formatNumber(pie.total);
    svg.appendChild(total);
  }
  wrap.appendChild(svg);
  const legend = wrap.createDiv({ cls: 'icor-sqlv-segments-legend icor-sqlv-pie-legend' });
  for (const p of pie.parts) {
    const item = legend.createSpan({ cls: 'icor-sqlv-legend-item' });
    const chip = item.createSpan({ cls: 'icor-sqlv-legend-chip is-round' });
    chip.style.setProperty('background', p.color);
    item.createSpan({ cls: 'icor-sqlv-legend-name', text: p.name, attr: { title: p.name } });
    item.createSpan({ cls: 'icor-sqlv-segments-value', text: formatNumber(p.value) + unit + ' \u00b7 ' + Math.round(p.share) + '%' });
  }
  return pie.parts.map((p) => p.name + ' ' + formatNumber(p.value) + unit).join(', ');
}

/* The level a segments bar or a pie chart lands on: its ranges judge the
 * "rangeColumn" of the first row. */
function segmentsLevelOf(table, tile, extras) {
  if (!tile.rangeColumn || !table.rows.length) return null;
  const idx = columnIndex(table.columns, tile.rangeColumn);
  if (idx < 0) return null;
  return resolveLevel(table.rows[0][idx], tile, extras && extras.levels);
}

/* A heatmap: a grid of cells, one per row of the query, placed by its
 * "row" and "column" values in the order the query returns them, and
 * coloured by the value levels of its "value" ("ranges", judged per
 * cell). An optional "marker" column puts a dot on the cells where it is
 * true ("markerColor", "markerLabel" for the legend). "highlight" lights
 * up today on this device: "hour" the column named for the current hour
 * (0 to 23), "day" the row or column named for today's date (YYYY-MM-DD),
 * "weekday" the row or column named for today's weekday (Monday or Mon).
 * "cells": "square" draws square cells, "fill" stretches the rows over the
 * tile's height; unset, cells are a thin fixed height.
 * "columnLabelEvery" labels every Nth column. A legend names every range,
 * an empty cell and the marker. Returns { ok, heat } or { ok, reason }. */
const HEAT_KEYS = ['row', 'column', 'value', 'marker', 'markerColor', 'markerLabel', 'highlight', 'columnLabelEvery', 'cells'];
const HEAT_HIGHLIGHTS = ['hour', 'day', 'weekday'];
const HEAT_CELLS = ['square', 'fill'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/* Which row and column a highlight lights up at the given moment, in the
 * device's local time: { row, col } indexes, -1 for none. Pure. */
function heatmapHighlight(grid, mode, now) {
  const none = { row: -1, col: -1 };
  if (!grid || !HEAT_HIGHLIGHTS.includes(mode)) return none;
  const d = now instanceof Date ? now : new Date();
  if (mode === 'hour') {
    const h = d.getHours();
    return { row: -1, col: grid.cols.findIndex((c) => String(c).trim() !== '' && Number(c) === h) };
  }
  let match;
  if (mode === 'day') {
    const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    match = (k) => String(k).trim() === iso;
  } else {
    const full = WEEKDAYS[d.getDay()];
    match = (k) => { const t = String(k).trim().toLowerCase(); return t === full || t === full.slice(0, 3); };
  }
  return { row: grid.rows.findIndex(match), col: grid.cols.findIndex(match) };
}
const HEAT_LABEL_MAX = 40;

function checkHeatmap(t, at) {
  if (t.viz !== 'heatmap') {
    for (const key of HEAT_KEYS) {
      /* A calendar colours its days by a "value" column too. */
      if (t[key] !== undefined && !(key === 'value' && t.viz === 'calendar')) {
        return { ok: false, reason: at + ': "' + key + '" only works on a heatmap' + (key === 'value' ? ' or a calendar' : '') + '.' };
      }
    }
    return { ok: true, heat: undefined };
  }
  const name = (v) => typeof v === 'string' && v.trim();
  for (const key of ['row', 'column', 'value']) {
    if (!name(t[key])) return { ok: false, reason: at + ': a heatmap needs "row", "column" and "value": the columns that place and colour each cell.' };
  }
  const heat = { row: t.row.trim(), column: t.column.trim(), value: t.value.trim() };
  if (t.marker !== undefined) {
    if (!name(t.marker)) return { ok: false, reason: at + ': "marker" must be the name of a column that is true where a cell gets a dot.' };
    heat.marker = t.marker.trim();
  }
  if (t.markerColor !== undefined) {
    if (!isLevelColor(t.markerColor)) return { ok: false, reason: at + ': "markerColor" must be a theme colour like "var(--color-cyan)" or a hex colour like "#33bbee".' };
    heat.markerColor = t.markerColor.trim();
  }
  if (t.markerLabel !== undefined) {
    if (typeof t.markerLabel !== 'string' || t.markerLabel.trim().length > HEAT_LABEL_MAX) {
      return { ok: false, reason: at + ': "markerLabel" must be short text, ' + HEAT_LABEL_MAX + ' characters at most.' };
    }
    if (t.markerLabel.trim()) heat.markerLabel = t.markerLabel.trim();
  }
  if ((heat.markerColor || heat.markerLabel) && !heat.marker) return { ok: false, reason: at + ': "markerColor" and "markerLabel" need a "marker" column.' };
  if (t.highlight !== undefined) {
    if (!HEAT_HIGHLIGHTS.includes(t.highlight)) return { ok: false, reason: at + ': "highlight" must be "hour" (the column for the current hour), "day" (the row or column for today\'s date) or "weekday" (the row or column for today\'s weekday).' };
    heat.highlight = t.highlight;
  }
  if (t.cells !== undefined) {
    if (!HEAT_CELLS.includes(t.cells)) return { ok: false, reason: at + ': "cells" must be "square" (square cells) or "fill" (the rows share the tile\'s height).' };
    heat.cells = t.cells;
  }
  if (t.columnLabelEvery !== undefined) {
    if (!Number.isInteger(t.columnLabelEvery) || t.columnLabelEvery < 1 || t.columnLabelEvery > 1000) {
      return { ok: false, reason: at + ': "columnLabelEvery" must be a whole number from 1 to 1000 (label every Nth column).' };
    }
    heat.columnLabelEvery = t.columnLabelEvery;
  }
  return { ok: true, heat };
}

function withHeatmap(tile, check) {
  if (check.heat) Object.assign(tile, check.heat);
  return tile;
}

/* The grid of a heatmap: row keys and column keys in first-seen order,
 * and each cell's value and marker. Pure. */
function heatmapGrid(table, tile) {
  const ri = columnIndex(table.columns, tile.row);
  const ci = columnIndex(table.columns, tile.column);
  const vi = columnIndex(table.columns, tile.value);
  const mi = tile.marker ? columnIndex(table.columns, tile.marker) : -1;
  if (ri < 0 || ci < 0 || vi < 0) return null;
  const rows = [];
  const cols = [];
  const cells = new Map();
  const key = (v) => (v === null || v === undefined ? '' : String(v));
  for (const r of table.rows) {
    const rk = key(r[ri]);
    const ck = key(r[ci]);
    if (!rows.includes(rk)) rows.push(rk);
    if (!cols.includes(ck)) cols.push(ck);
    const m = mi >= 0 ? r[mi] : null;
    cells.set(rk + '\u0000' + ck, { value: r[vi], marker: m !== null && m !== undefined && m !== 0 && m !== '0' && m !== false && m !== '' });
  }
  return { rows, cols, cell: (rk, ck) => cells.get(rk + '\u0000' + ck) || null };
}

/* The legend of a coloured widget: a chip for each range, in its level's
 * colour, and (unless `withEmpty` is false) one for a cell with no data. */
function renderRangeLegend(legend, tile, levels, withEmpty, chipClass) {
  for (const range of tile.ranges || []) {
    const level = Array.isArray(levels) ? levels.find((l) => l && l.name === range.level) : null;
    const own = tile.levelColors && Object.prototype.hasOwnProperty.call(tile.levelColors, range.level) ? tile.levelColors[range.level] : undefined;
    const color = level ? (isLevelColor(own) ? own : level.color) : '';
    const item = legend.createSpan({ cls: 'icor-sqlv-legend-item' });
    const chip = item.createSpan({ cls: 'icor-sqlv-legend-chip' + (chipClass ? ' ' + chipClass : '') });
    if (isLevelColor(color)) chip.style.setProperty('background', color);
    item.createSpan({ cls: 'icor-sqlv-legend-name', text: range.label || range.level });
  }
  if (withEmpty === false) return;
  const none = legend.createSpan({ cls: 'icor-sqlv-legend-item' });
  none.createSpan({ cls: 'icor-sqlv-legend-chip is-empty' });
  none.createSpan({ cls: 'icor-sqlv-legend-name', text: 'no data' });
}

/* The column labels of a heatmap against the width of one cell: written
 * across when they fit, turned to read upwards when the cell is narrower
 * than the label but a line of text still fits in it, and thinned (every
 * Nth label, the rest hidden) when even that does not. Pure: the numbers
 * are 9px mono, about 5.4px a character. */
const HEAT_LABEL_CHAR_W = 5.4;
const HEAT_LABEL_LINE_W = 11;

function heatmapLabelPlan(cellW, labels, own) {
  const every = Number.isInteger(own) && own > 1 ? own : 1;
  if (!(cellW > 0)) return { rotate: false, step: every };
  const widest = Math.max(0, ...labels.map((t) => String(t).length)) * HEAT_LABEL_CHAR_W + 2;
  if (cellW >= widest) return { rotate: false, step: every };
  const step = cellW >= HEAT_LABEL_LINE_W ? 1 : Math.ceil(HEAT_LABEL_LINE_W / cellW);
  return { rotate: true, step: every * Math.max(1, Math.ceil(step / every)) };
}

/* Applies the plan, and again whenever the grid's width changes. Without
 * layout (no ResizeObserver) the labels stay as written. */
function fitHeatmapLabels(wrap, gridEl, heads, labels, own, rowTrack, observers) {
  const apply = () => {
    const cell = gridEl.querySelector ? gridEl.querySelector('.icor-sqlv-heatmap-cell') : null;
    const cellW = cell ? cell.offsetWidth : 0;
    const plan = heatmapLabelPlan(cellW, labels, own);
    if (plan.rotate) wrap.classList.add('has-turned-labels'); else wrap.classList.remove('has-turned-labels');
    heads.forEach((h, j) => { if (j % plan.step !== 0) h.classList.add('is-thinned'); else h.classList.remove('is-thinned'); });
    if (rowTrack) gridEl.style.setProperty('grid-template-rows', plan.rotate ? 'auto ' + rowTrack : '14px ' + rowTrack);
  };
  let lastWidth = -1;
  const observer = resizeObserverFor(gridEl, () => {
    if (!gridEl.isConnected) { observer.disconnect(); return; }
    if (gridEl.clientWidth === lastWidth) return;
    lastWidth = gridEl.clientWidth;
    apply();
  });
  if (!observer) return;
  observer.observe(gridEl);
  if (observers) observers.push(observer);
}

function renderHeatmap(parentEl, table, tile, extras) {
  const grid = heatmapGrid(table, tile);
  if (!grid || !grid.rows.length) {
    parentEl.createDiv({ cls: 'icor-sqlv-empty', text: 'No rows to draw.' });
    return;
  }
  const levels = extras && extras.levels;
  const unit = tile.unit ? ' ' + tile.unit : '';
  const lit = heatmapHighlight(grid, tile.highlight, new Date());
  const live = lit.col;
  const every = Number.isInteger(tile.columnLabelEvery) && tile.columnLabelEvery > 1 ? tile.columnLabelEvery : 1;
  const wrap = parentEl.createDiv({ cls: 'icor-sqlv-heatmap' + (tile.cells === 'square' ? ' is-square' : '') + (tile.cells === 'fill' ? ' is-fill' : '') });
  const scroll = wrap.createDiv({ cls: 'icor-sqlv-heatmap-scroll' });
  const el = scroll.createDiv({ cls: 'icor-sqlv-heatmap-grid' });
  el.style.setProperty('grid-template-columns', 'max-content repeat(' + grid.cols.length + ', minmax(9px, 1fr))');
  if (tile.cells === 'fill') el.style.setProperty('grid-template-rows', '14px repeat(' + grid.rows.length + ', minmax(13px, 1fr))');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Heatmap, ' + grid.rows.length + ' rows by ' + grid.cols.length + ' columns. Hover a cell for its value.');
  el.createDiv({ cls: 'icor-sqlv-heatmap-corner' });
  const heads = [];
  grid.cols.forEach((c, j) => {
    const head = el.createDiv({ cls: 'icor-sqlv-heatmap-col', text: j % every === 0 ? c : '' });
    head.setAttribute('title', c);
    if (j === live) head.addClass('is-current');
    heads.push(head);
  });
  grid.rows.forEach((r, i) => {
    const rowHead = el.createDiv({ cls: 'icor-sqlv-heatmap-row', text: r });
    rowHead.setAttribute('title', r);
    if (i === lit.row) rowHead.addClass('is-current');
    grid.cols.forEach((c, j) => {
      const cell = grid.cell(r, c);
      const box = el.createDiv({ cls: 'icor-sqlv-heatmap-cell' });
      const v = cell ? cell.value : null;
      const empty = v === null || v === undefined || v === '';
      const level = empty ? null : resolveLevel(v, tile, levels);
      if (empty) box.addClass('is-empty');
      else if (level && level.known && level.color) box.style.setProperty('background', level.color);
      if (j === live || i === lit.row) box.addClass('is-current');
      const parts = [r, c];
      parts.push(empty ? 'no data' : formatNumber(Number(v)) + unit);
      if (level && (level.label || level.name)) parts.push(level.label || level.name);
      if (cell && cell.marker) {
        box.addClass('has-marker');
        const dot = box.createSpan({ cls: 'icor-sqlv-heatmap-dot' });
        if (tile.markerColor) dot.style.setProperty('background', tile.markerColor);
        parts.push(tile.markerLabel || tile.marker);
      }
      box.setAttribute('title', parts.join(' · '));
    });
  });
  fitHeatmapLabels(wrap, el, heads, grid.cols.filter((c, j) => j % every === 0), every, tile.cells === 'fill' ? 'repeat(' + grid.rows.length + ', minmax(13px, 1fr))' : '', extras && extras.observers);
  const legend = wrap.createDiv({ cls: 'icor-sqlv-heatmap-legend' });
  renderRangeLegend(legend, tile, levels);
  if (tile.marker) {
    const m = legend.createSpan({ cls: 'icor-sqlv-legend-item' });
    const dot = m.createSpan({ cls: 'icor-sqlv-heatmap-dot is-legend' });
    if (tile.markerColor) dot.style.setProperty('background', tile.markerColor);
    m.createSpan({ cls: 'icor-sqlv-legend-name', text: tile.markerLabel || tile.marker });
  }
}

/* A year calendar: one square for each day, a week to a column and the
 * days of the week down the side, the way a contribution graph reads. Each
 * row of the query is a day: "date" names the column of days (written
 * 2026-01-31, a time after the day is ignored) and "value" the column that
 * colours it, by the value levels of "ranges", as in a heatmap. A day the
 * query has no row for is an empty square; a day twice takes the later
 * row. The view is the last 53 weeks up to the newest day in the data (the
 * data's own end, never today, so data that lags still fills the grid), or
 * the whole of "year" when it is set. "weekStart" is the day a column of
 * weeks starts on, "sunday" (the default) or "monday". It is its own
 * widget, not a heatmap setting: it reads one date column where a heatmap
 * reads a row and a column, so no row or column is named. Returns
 * { ok, cal } or { ok, reason }. */
const CAL_KEYS = ['date', 'weekStart', 'year'];
const CAL_WEEK_STARTS = ['sunday', 'monday'];
const CAL_WEEKS = 53;
const CAL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86400000;

function checkCalendar(t, at) {
  if (t.viz !== 'calendar') {
    for (const key of CAL_KEYS) {
      if (t[key] !== undefined) return { ok: false, reason: at + ': "' + key + '" only works on a calendar.' };
    }
    return { ok: true, cal: undefined };
  }
  const name = (v) => typeof v === 'string' && v.trim();
  if (!name(t.date) || !name(t.value)) {
    return { ok: false, reason: at + ': a calendar needs "date" and "value": the column of days (like 2026-01-31) and the column that colours each day.' };
  }
  const cal = { date: t.date.trim(), value: t.value.trim() };
  if (t.weekStart !== undefined) {
    if (!CAL_WEEK_STARTS.includes(t.weekStart)) return { ok: false, reason: at + ': "weekStart" must be "sunday" or "monday": the day each column of weeks starts on.' };
    cal.weekStart = t.weekStart;
  }
  if (t.year !== undefined) {
    if (!Number.isInteger(t.year) || t.year < 1000 || t.year > 9999) return { ok: false, reason: at + ': "year" must be a four-digit year like 2026; left out, the calendar shows the last 53 weeks up to the newest day.' };
    cal.year = t.year;
  }
  return { ok: true, cal };
}

function withCalendar(tile, check) {
  if (check.cal) Object.assign(tile, check.cal);
  return tile;
}

/* A day written 2026-01-31 (anything after it is ignored) as a UTC
 * midnight in milliseconds, or NaN when it is not a real day. */
function calendarDayOf(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v === null || v === undefined ? '' : v).trim());
  if (!m || Number(m[1]) < 1000) return NaN;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(ms);
  return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? ms : NaN;
}

function calendarIsoOf(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

/* The grid of a calendar: { weeks, startDay, cells, months }. Each cell is
 * a day in view with its column, its row (0 at the top, the weekStart day),
 * its weekday (0 for Sunday) and its value from the query, or undefined.
 * `months` are the labels along the top, as { col, name }, one where a month
 * starts, with at least three columns between two. Null when there is no
 * day to draw. Pure, in UTC, so no time zone moves a day. */
function calendarOf(table, tile, defaultWeekStart, maxWeeks) {
  const di = columnIndex(table.columns, tile.date);
  const vi = columnIndex(table.columns, tile.value);
  if (di < 0 || vi < 0) return null;
  const values = new Map();
  let newest = -Infinity;
  for (const row of table.rows) {
    const ms = calendarDayOf(row[di]);
    if (!Number.isFinite(ms)) continue;
    values.set(ms, row[vi]);
    if (ms > newest) newest = ms;
  }
  if (!values.size && !tile.year) return null;
  /* The widget's own "weekStart" wins; without one the plugin setting does. */
  const startDay = (tile.weekStart || defaultWeekStart) === 'monday' ? 1 : 0;
  const weekStartOf = (ms) => ms - ((new Date(ms).getUTCDay() - startDay + 7) % 7) * DAY_MS;
  let from;
  let to;
  if (tile.year) {
    from = Date.UTC(tile.year, 0, 1);
    to = Date.UTC(tile.year, 11, 31);
  } else {
    to = newest;
    from = weekStartOf(to) - (CAL_WEEKS - 1) * 7 * DAY_MS;
  }
  const firstWeek = weekStartOf(from);
  let weeks = Math.round((weekStartOf(to) - firstWeek) / (7 * DAY_MS)) + 1;
  let cells = [];
  for (let ms = from; ms <= to; ms += DAY_MS) {
    const d = new Date(ms);
    cells.push({
      iso: calendarIsoOf(ms), col: Math.round((weekStartOf(ms) - firstWeek) / (7 * DAY_MS)),
      row: (d.getUTCDay() - startDay + 7) % 7, weekday: d.getUTCDay(), day: d.getUTCDate(), month: d.getUTCMonth(),
      value: values.get(ms),
    });
  }
  /* Too narrow for every week: the newest weeks only, columns counted again from
   * the left, so the month names fall on the weeks that are left. */
  if (Number.isInteger(maxWeeks) && maxWeeks >= 1 && weeks > maxWeeks) {
    const drop = weeks - maxWeeks;
    cells = cells.filter((c) => c.col >= drop);
    for (const c of cells) c.col -= drop;
    weeks = maxWeeks;
  }
  const starts = cells.filter((c, i) => c.day === 1 || i === 0).map((c) => ({ col: c.col, name: CAL_MONTHS[c.month] }));
  const months = [];
  starts.forEach((m, i) => {
    const next = starts[i + 1];
    if (next && next.col - m.col < 3) return;
    if (months.length && m.col - months[months.length - 1].col < 3) return;
    months.push(m);
  });
  return { weeks, startDay, cells, months };
}

/* How many weeks of squares fit a box this wide: each week is a square of at
 * least CAL_MIN_CELL px and a gap, after the column of weekday names. A box
 * not measured yet (0) gets every week. */
const CAL_MIN_CELL = 6;
const CAL_GAP = 2;
const CAL_LABEL_PX = 28;
const CAL_MIN_WEEKS = 8;
function calendarWeeksFit(width) {
  if (!(width > 0)) return Infinity;
  return Math.max(CAL_MIN_WEEKS, Math.floor((width - CAL_LABEL_PX) / (CAL_MIN_CELL + CAL_GAP)));
}

function renderCalendar(parentEl, table, tile, extras) {
  const cal = calendarOf(table, tile, extras && extras.weekStart);
  if (!cal) {
    parentEl.createDiv({ cls: 'icor-sqlv-empty', text: 'No rows to draw.' });
    return;
  }
  const levels = extras && extras.levels;
  const unit = tile.unit ? ' ' + tile.unit : '';
  const wrap = parentEl.createDiv({ cls: 'icor-sqlv-calendar' });
  const scroll = wrap.createDiv({ cls: 'icor-sqlv-calendar-scroll' });
  const el = scroll.createDiv({ cls: 'icor-sqlv-calendar-grid' });
  el.setAttribute('role', 'img');
  /* Drawn for the weeks that fit; a narrow phone shows the newest weeks and
   * never scrolls sideways. */
  const draw = (c) => {
    el.empty();
    el.style.setProperty('grid-template-columns', 'max-content repeat(' + c.weeks + ', minmax(0, 1fr))');
    el.setAttribute('aria-label', 'Calendar, ' + c.cells.length + ' days from ' + c.cells[0].iso + ' to ' + c.cells[c.cells.length - 1].iso + '. Hover a day for its value.');
    for (const m of c.months) {
      const label = el.createDiv({ cls: 'icor-sqlv-calendar-month', text: m.name });
      label.style.setProperty('--sqlv-col', String(m.col + 2));
    }
    /* The rows the weekday names sit on: Monday, Wednesday and Friday. */
    for (let row = 0; row < 7; row++) {
      const weekday = (c.startDay + row) % 7;
      if (![1, 3, 5].includes(weekday)) continue;
      const label = el.createDiv({ cls: 'icor-sqlv-calendar-day', text: WEEKDAYS[weekday].slice(0, 3).replace(/^./, (ch) => ch.toUpperCase()) });
      label.style.setProperty('--sqlv-row', String(row + 2));
    }
    for (const cell of c.cells) {
      const box = el.createDiv({ cls: 'icor-sqlv-calendar-cell' });
      box.style.setProperty('--sqlv-row', String(cell.row + 2));
      box.style.setProperty('--sqlv-col', String(cell.col + 2));
      const empty = cell.value === null || cell.value === undefined || cell.value === '';
      const level = empty ? null : resolveLevel(cell.value, tile, levels);
      if (empty) box.addClass('is-empty');
      else if (level && level.known && level.color) box.style.setProperty('background', level.color);
      const parts = [cell.iso, WEEKDAYS[cell.weekday].replace(/^./, (ch) => ch.toUpperCase())];
      parts.push(empty ? 'no data' : formatNumber(Number(cell.value)) + unit);
      if (level && (level.label || level.name)) parts.push(level.label || level.name);
      box.setAttribute('title', parts.join(' · '));
    }
  };
  draw(cal);
  fitCalendarWeeks(scroll, cal, (n) => calendarOf(table, tile, extras && extras.weekStart, n), draw, extras && extras.observers);
  renderRangeLegend(wrap.createDiv({ cls: 'icor-sqlv-heatmap-legend icor-sqlv-calendar-legend' }), tile, levels);
}

/* A calendar never scrolls sideways: when its tile is too narrow for every
 * week it is drawn again with the newest weeks that fit, and again whenever
 * the tile is resized. Only a change in the number of weeks redraws. */
function fitCalendarWeeks(scroll, full, fitOf, draw, observers) {
  let shown = full.weeks;
  const apply = () => {
    const n = calendarWeeksFit(scroll.clientWidth);
    const want = Math.min(n, full.weeks);
    if (want === shown) return;
    shown = want;
    draw(want >= full.weeks ? full : fitOf(want));
  };
  apply();
  const observer = resizeObserverFor(scroll, () => {
    if (!scroll.isConnected) { observer.disconnect(); return; }
    apply();
  });
  if (!observer) return;
  observer.observe(scroll);
  if (observers) observers.push(observer);
}

/* A bullet chart: for each row of the query, a bar for the actual value
 * against a mark for its target, on a scale shaded in bands, as in a
 * goal tracker: sleep against eight hours, spend against a budget, with
 * "poor, fair, good" behind. "y" is the actual value, "x" (optional) the
 * label of each bar, "target" (optional) the column of targets; the bands
 * are the value levels of "ranges", drawn behind the bars in their level's
 * colour, so what is "good" is written once, as in a stat. All the bars of
 * one widget share one scale: "scaleMin" and "scaleMax" fix its ends,
 * otherwise it runs from zero to the largest value, target or range end on
 * a round number. Returns { ok, bullet } or { ok, reason }. */
const BULLET_KEYS = ['target', 'scaleMin', 'scaleMax'];
const BULLET_MAX = 12;

function checkBullet(t, y, at) {
  if (t.viz !== 'bullet') {
    for (const key of BULLET_KEYS) {
      if (t[key] !== undefined) return { ok: false, reason: at + ': "' + key + '" only works on a bullet chart.' };
    }
    return { ok: true, bullet: undefined };
  }
  if (y.length !== 1) return { ok: false, reason: at + ': a bullet chart needs one "y" column: the actual value of each bar.' };
  if (t.x !== undefined && typeof t.x !== 'string') return { ok: false, reason: at + ': "x" must be the name of the column that labels each bar, or left out.' };
  const bullet = {};
  if (t.target !== undefined) {
    if (typeof t.target !== 'string' || !t.target.trim()) return { ok: false, reason: at + ': "target" must be the name of the column that holds each bar\'s target.' };
    if (t.target.trim() === y[0]) return { ok: false, reason: at + ': "target" must be a different column from "y".' };
    bullet.target = t.target.trim();
  }
  for (const key of ['scaleMin', 'scaleMax']) {
    if (t[key] === undefined) continue;
    if (typeof t[key] !== 'number' || !Number.isFinite(t[key])) return { ok: false, reason: at + ': "' + key + '" must be a number.' };
    bullet[key] = t[key];
  }
  if (bullet.scaleMin !== undefined && bullet.scaleMax !== undefined && bullet.scaleMin >= bullet.scaleMax) {
    return { ok: false, reason: at + ': "scaleMin" (' + bullet.scaleMin + ') must be below "scaleMax" (' + bullet.scaleMax + ').' };
  }
  return { ok: true, bullet };
}

function withBullet(tile, check) {
  if (check.bullet) Object.assign(tile, check.bullet);
  return tile;
}

/* The bars of a bullet chart, in the query's order, up to the cap:
 * [{ label, actual, target }]. An actual or a target that is not a number
 * is NaN, never zero. Pure. */
function bulletRowsOf(table, tile) {
  const yi = columnIndex(table.columns, (tile.y || [])[0]);
  if (yi < 0) return [];
  const xi = tile.x ? columnIndex(table.columns, tile.x) : -1;
  const ti = tile.target ? columnIndex(table.columns, tile.target) : -1;
  return table.rows.slice(0, BULLET_MAX).map((row) => ({
    label: xi < 0 || row[xi] === null || row[xi] === undefined ? '' : String(row[xi]),
    actual: cellNumber(row[yi]),
    target: ti < 0 ? NaN : cellNumber(row[ti]),
  }));
}

/* The one scale of a bullet chart: the tile's own ends, or zero (or the
 * lowest value, when something is below zero) up to the largest actual,
 * target or range end on a round number. Pure. */
function bulletScaleOf(rows, tile) {
  const nums = [];
  for (const r of rows) for (const v of [r.actual, r.target]) if (Number.isFinite(v)) nums.push(v);
  for (const r of tile.ranges || []) for (const v of [r.low, r.high]) if (typeof v === 'number' && Number.isFinite(v)) nums.push(v);
  const min = typeof tile.scaleMin === 'number' ? tile.scaleMin : Math.min(0, ...nums);
  let max = typeof tile.scaleMax === 'number' ? tile.scaleMax : (nums.length ? niceScale(min, Math.max(...nums), 4).max : min + 1);
  if (max <= min) max = min + 1;
  return { min, max };
}

/* The bands behind the bars: the scale cut at every range edge inside it,
 * each piece shaded by the range that holds its middle (the first range
 * wins, as everywhere), or left plain where none does. Ranges for whole
 * numbers are written 79 and 80, which leaves a piece one unit wide
 * between them on a scale that is not whole numbers; a piece no wider than
 * a fiftieth of the scale is too thin to see as a band and joins the one
 * before it (or after it, at the start), so it does not read as a stripe
 * of the wrong colour. Pure. */
const BULLET_SLIVER = 0.02;

function bulletBands(tile, min, max) {
  const cuts = new Set([min, max]);
  for (const r of tile.ranges || []) {
    for (const v of [r.low, r.high]) if (typeof v === 'number' && v > min && v < max) cuts.add(v);
  }
  const edges = [...cuts].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const piece = { from: edges[i], to: edges[i + 1], range: levelOf((edges[i] + edges[i + 1]) / 2, tile.ranges) };
    const last = out[out.length - 1];
    if (last && piece.to - piece.from <= (max - min) * BULLET_SLIVER) last.to = piece.to;
    else out.push(piece);
  }
  if (out.length > 1 && out[0].to - out[0].from <= (max - min) * BULLET_SLIVER) {
    out[1].from = out[0].from;
    out.shift();
  }
  return out;
}

function renderBullet(parentEl, table, tile, extras) {
  const rows = bulletRowsOf(table, tile);
  if (!rows.length) {
    parentEl.createDiv({ cls: 'icor-sqlv-empty', text: 'No rows to draw.' });
    return;
  }
  const levels = extras && extras.levels;
  const unit = tile.unit ? (tile.unit === '%' ? '%' : ' ' + tile.unit) : '';
  const { min, max } = bulletScaleOf(rows, tile);
  const pct = (v) => (Math.max(0, Math.min(1, (v - min) / (max - min))) * 100).toFixed(3) + '%';
  const bands = bulletBands(tile, min, max);
  const labelled = rows.some((r) => r.label);
  const wrap = parentEl.createDiv({ cls: 'icor-sqlv-bullet' });
  /* One grid for every bar, so the tracks line up on the shared scale. */
  const list = wrap.createDiv({ cls: 'icor-sqlv-bullet-rows' + (labelled ? '' : ' is-unlabelled') });
  for (const r of rows) {
    /* The label, track and numbers are cells of the one grid. */
    const row = list;
    if (labelled) row.createSpan({ cls: 'icor-sqlv-bullet-label', text: r.label }).setAttribute('title', r.label);
    const track = row.createDiv({ cls: 'icor-sqlv-bullet-track' });
    for (const b of bands) {
      if (!b.range) continue;
      const band = track.createDiv({ cls: 'icor-sqlv-bullet-band' });
      band.style.setProperty('left', pct(b.from));
      band.style.setProperty('width', (((b.to - b.from) / (max - min)) * 100).toFixed(3) + '%');
      const level = resolveLevel((b.from + b.to) / 2, tile, levels);
      if (level && level.known && level.color) band.style.setProperty('background', level.color);
      else band.addClass('is-neutral');
    }
    const has = Number.isFinite(r.actual);
    if (has) track.createDiv({ cls: 'icor-sqlv-bullet-actual' }).style.setProperty('width', pct(r.actual));
    const hasTarget = Number.isFinite(r.target);
    if (hasTarget) track.createDiv({ cls: 'icor-sqlv-bullet-target' }).style.setProperty('left', pct(r.target));
    const level = has ? resolveLevel(r.actual, tile, levels) : null;
    const said = !has ? 'no data' : formatNumber(r.actual) + unit + (hasTarget ? ' of ' + formatNumber(r.target) + unit : '');
    const detail = (r.label ? r.label + ': ' : '') + said + (level && (level.label || level.name) ? ' · ' + (level.label || level.name) : '');
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', detail);
    track.setAttribute('title', detail);
    row.createSpan({ cls: 'icor-sqlv-bullet-value', text: !has ? 'no data' : formatNumber(r.actual) + (hasTarget ? ' / ' + formatNumber(r.target) : '') + unit });
  }
  const legend = wrap.createDiv({ cls: 'icor-sqlv-heatmap-legend icor-sqlv-bullet-legend' });
  /* The bands behind the bars are drawn pale; the swatches are too, so a swatch matches its band. */
  renderRangeLegend(legend, tile, levels, false, 'is-band');
  if (rows.some((r) => Number.isFinite(r.target))) {
    const item = legend.createSpan({ cls: 'icor-sqlv-legend-item' });
    item.createSpan({ cls: 'icor-sqlv-legend-chip is-target' });
    item.createSpan({ cls: 'icor-sqlv-legend-name', text: 'target' });
  }
}

/* The span a widget gets when its spec carries none (a 0.2.x file):
 * a stat is a small square, a chart a 2x2 block, a table a wide 3x2. */
function defaultSpanFor(tile) {
  if (tile.viz === 'divider') return { w: GRID_MAX_COLS, h: 1 };
  if (tile.viz === 'text') return tile.line === true ? { w: GRID_MAX_COLS, h: 1 } : { w: 2, h: 1 };
  if (tile.viz === 'stat') return { w: 1, h: 1 };
  if (tile.viz === 'table') return { w: 3, h: 2 };
  if (tile.viz === 'segments') return { w: 3, h: 1 };
  if (tile.viz === 'heatmap') return { w: 4, h: 2 };
  if (tile.viz === 'calendar') return { w: 4, h: 2 };
  if (tile.viz === 'bullet') return { w: 3, h: 1 };
  return { w: 2, h: 2 };
}

function clampLayout(l, cols) {
  const w = Math.max(1, Math.min(Math.floor(l.w) || 1, Math.min(cols, SPAN_CAP)));
  const h = Math.max(1, Math.min(Math.floor(l.h) || 1, SPAN_CAP));
  const x = Math.max(0, Math.min(Math.floor(l.x) || 0, cols - w));
  const y = Math.max(0, Math.floor(l.y) || 0);
  return { x, y, w, h };
}

function rectsCollide(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/* First free spot for a w x h rectangle, scanning rows top to bottom. */
function findSpot(placed, size, cols) {
  const w = Math.min(size.w, cols);
  for (let y = 0; ; y++) {
    for (let x = 0; x + w <= cols; x++) {
      const candidate = { x, y, w, h: size.h };
      if (!placed.some((p) => rectsCollide(candidate, p))) return candidate;
    }
  }
}

/* THE PACKING RULE, in plain words: the widget being placed stays exactly
 * where it was put; every other widget that overlaps it is pushed DOWN
 * until nothing overlaps; then everything floats UP into the gaps, in
 * reading order. Deterministic: the same input always packs the same. */
function packLayout(layouts, cols, anchorIndex) {
  const clamped = layouts.map((l) => clampLayout(l, cols));
  const order = clamped.map((l, i) => i).sort((a, b) =>
    (clamped[a].y - clamped[b].y) || (clamped[a].x - clamped[b].x) || (a - b));
  const out = new Array(clamped.length);
  const placed = [];
  /* The anchor claims its ground first. */
  if (anchorIndex >= 0 && anchorIndex < clamped.length) {
    out[anchorIndex] = Object.assign({}, clamped[anchorIndex]);
    placed.push(out[anchorIndex]);
  }
  /* Everyone else lands in reading order, pushed down past any overlap. */
  for (const i of order) {
    if (i === anchorIndex) continue;
    const l = Object.assign({}, clamped[i]);
    while (placed.some((p) => rectsCollide(l, p))) l.y++;
    out[i] = l;
    placed.push(l);
  }
  /* Float up: in reading order, every widget except the anchor rises while
   * the space above it is free. */
  const upOrder = out.map((l, i) => i).sort((a, b) =>
    (out[a].y - out[b].y) || (out[a].x - out[b].x) || (a - b));
  for (const i of upOrder) {
    if (i === anchorIndex) continue;
    const l = out[i];
    while (l.y > 0) {
      const above = { x: l.x, y: l.y - 1, w: l.w, h: l.h };
      if (out.some((other, j) => j !== i && rectsCollide(above, other))) break;
      l.y--;
    }
  }
  return out;
}

/* True when a saved layout was drawn for more columns than this pane has. */
function overflowsColumns(layout, cols) {
  const wide = clampLayout(layout, GRID_MAX_COLS);
  return wide.x + wide.w > cols;
}

/* THE NARROW REFLOW, in plain words: a dashboard drawn for six columns,
 * shown in two or three, would have every tile past the last column pushed
 * into it and the cells before it left empty. Instead the tiles keep their
 * reading order (top to bottom, left to right on the wide layout) and each
 * takes the first free spot from the top, so there are no gaps. A tile that
 * spans the whole width (a divider, or a table cut down to the width) is a
 * wall: nothing after it moves up past it, so a section stays below its
 * heading. Only a pane narrower than the layout does this; a layout that
 * fits is left exactly as it was saved. */
function reflowNarrow(tiles, cols) {
  const wide = normalizeLayout(tiles, GRID_MAX_COLS);
  const order = wide.map((l, i) => i).sort((a, b) => (wide[a].y - wide[b].y) || (wide[a].x - wide[b].x) || (a - b));
  const out = new Array(tiles.length);
  const placed = [];
  let floor = 0;
  for (const i of order) {
    const w = Math.min(wide[i].w, cols);
    const h = wide[i].h;
    let spot = null;
    for (let y = floor; !spot; y++) {
      for (let x = 0; x + w <= cols && !spot; x++) {
        const candidate = { x, y, w, h };
        if (!placed.some((p) => rectsCollide(candidate, p))) spot = candidate;
      }
    }
    out[i] = spot;
    placed.push(spot);
    if (spot.w >= cols) floor = spot.y + spot.h;
  }
  return out;
}

/* Layouts for every tile: the spec's own {x,y,w,h} where present, a
 * sensible default spot where not (the 0.2.x migration), everything
 * clamped to the column count and packed without overlaps. */
function normalizeLayout(tiles, cols) {
  if (cols < GRID_MAX_COLS && tiles.some((t) => t.layout && overflowsColumns(t.layout, cols))) return reflowNarrow(tiles, cols);
  const layouts = [];
  const placed = [];
  for (const tile of tiles) {
    if (tile.layout) {
      const l = clampLayout(tile.layout, cols);
      layouts.push(l);
      placed.push(l);
    } else {
      const spot = findSpot(placed, defaultSpanFor(tile), cols);
      layouts.push(spot);
      placed.push(spot);
    }
  }
  return packLayout(layouts, cols, -1);
}

/* THE ROW HEIGHTS, in plain words: the grid keeps one row unit for every
 * widget, and a row whose only occupants are section dividers is drawn
 * DIVIDER_ROW_PX tall instead of a full cell. A row that also holds a
 * widget (or the add tile), and an empty row, stay a full cell. So the
 * layout, the packing and the saved {x, y, w, h} are unchanged; only the
 * track heights differ. rects: [{ l: {x,y,w,h}, thin }]. */
/* A full row is at least its set height and grows to hold what is in it, so
 * a narrow pane never squeezes a chart out of its tile. */
function growingRow(px) {
  return 'minmax(' + px + 'px, auto)';
}

function rowTracks(rects, cellH) {
  let rows = 0;
  for (const { l } of rects) rows = Math.max(rows, l.y + l.h);
  const tracks = [];
  for (let r = 0; r < rows; r++) {
    let thin = false;
    let full = false;
    for (const { l, thin: isThin } of rects) {
      if (r < l.y || r >= l.y + l.h) continue;
      if (isThin) thin = true; else full = true;
    }
    tracks.push(thin && !full ? DIVIDER_ROW_PX : cellH);
  }
  return tracks;
}

/* How many rows a drag of dy pixels crosses, starting at row fromRow,
 * when rows differ in height: a row is crossed once the pointer passes
 * half of it (with its gap), the same rounding as uniform rows had. */
function rowsForOffset(tracks, gap, fromRow, dy, fallback) {
  const size = (r) => (r >= 0 && r < tracks.length ? tracks[r] : fallback) + gap;
  let rem = dy;
  let r = fromRow;
  let d = 0;
  if (dy > 0) {
    while (rem >= size(r) / 2) { rem -= size(r); r++; d++; }
  } else {
    while (r > 0 && -rem > size(r - 1) / 2) { rem += size(r - 1); r--; d--; }
  }
  return d;
}

/* The + tile shows only on an empty dashboard or in edit mode: a full
 * dashboard at rest is widgets and nothing else. */
function showAddTile(tileCount, editMode) {
  return tileCount === 0 || editMode === true;
}

/* What reaches the developer console: a stable line naming the place and
 * the error class, never SQL text and never database content. The full
 * message stays in the on-screen error UI. */
function safeLogLine(context, e) {
  return 'ReadOut: ' + context + ' (' + ((e && e.name) || 'Error') + ')';
}

/* --------------------------------------------------- comparison rules -- */

const COMPARE_LABELS = { none: 'No comparison', previous: 'Previous period', last_year: 'Same period last year' };

/* A widget can compare periods only when it has a time column, a bounded
 * frame, and no series split. */
function canCompare(tile, globalTf) {
  const s = tile.source;
  if (!s || !s.timeColumn || s.series) return false;
  const frame = resolveTimeframe(s.timeframe, globalTf);
  return !(frame.preset === 'all');
}

/* The comparison badge, and which direction is good. Good is a property
 * of the metric, never of the sign: weight going down is a win. */
function deltaBadge(current, previous, favorable) {
  if (current === null || current === undefined || current === '') return null;
  if (previous === null || previous === undefined || previous === '') return null;
  const cur = Number(current);
  const prev = Number(previous);
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  const diff = cur - prev;
  const direction = diff > 0 ? 'up' : (diff < 0 ? 'down' : 'flat');
  let label;
  if (prev === 0) label = diff === 0 ? '0%' : (diff > 0 ? '+' : '-') + '100%';
  else {
    const pct = Math.round((diff / Math.abs(prev)) * 1000) / 10;
    label = (pct > 0 ? '+' : '') + formatNumber(pct) + '%';
  }
  const good = direction === 'flat' ? null : (direction === (favorable === 'down' ? 'down' : 'up'));
  return { direction, label, good, diff };
}

/* ---------------------------------------------- change over the period -- */

/* A number to one decimal, without a pointless ".0": 361 not 361.0, 15.5 stays. */
function oneDecimal(v) {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? r.toLocaleString('en-US') : r.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/* How much a chart's one series moved over what it shows: the last end
 * minus the first. With averageDays, each end is the average of the
 * points within the first and the last N days of the plotted dates (a
 * weekly average instead of one noisy day); without it, or when the x
 * values are not dates, the first and last plotted points. One decimal (none when whole),
 * the same diagonal arrows as the stat chips, a typographic minus. Pure;
 * null when there is nothing to compare. */
function headerDeltaOf(table, tile) {
  const xIdx = columnIndex(table.columns, tile.x);
  const yName = tile.y && tile.y.length ? tile.y[0] : '';
  const yIdx = columnIndex(table.columns, yName);
  if (xIdx < 0 || yIdx < 0) return null;
  const points = [];
  for (const row of table.rows) {
    const v = row[yIdx];
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') continue;
    const n = Number(v);
    if (Number.isFinite(n)) points.push({ x: row[xIdx], v: n });
  }
  if (points.length < 2) return null;
  const dayOf = (x) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(x === null || x === undefined ? '' : x));
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 : null;
  };
  const days = tile.headerDeltaAverageDays;
  let first;
  let last;
  const days0 = points.map((p) => dayOf(p.x));
  if (Number.isInteger(days) && days > 0 && days0.every((d) => d !== null)) {
    const lo = Math.min(...days0);
    const hi = Math.max(...days0);
    const end = (pick) => {
      const chosen = points.map((p, i) => ({ p, d: days0[i] })).filter((e) => pick(e.d)).sort((x, y) => x.d - y.d);
      return {
        v: chosen.reduce((sum, e) => sum + e.p.v, 0) / chosen.length,
        from: chosen[0].p.x, to: chosen[chosen.length - 1].p.x, count: chosen.length,
      };
    };
    first = end((d) => d < lo + days);
    last = end((d) => d > hi - days);
  } else {
    first = { v: points[0].v, from: points[0].x, to: points[0].x, count: 1 };
    last = { v: points[points.length - 1].v, from: points[points.length - 1].x, to: points[points.length - 1].x, count: 1 };
  }
  const diff = Math.round((last.v - first.v) * 10) / 10;
  const direction = diff > 0 ? 'up' : (diff < 0 ? 'down' : 'flat');
  const unit = tile.unit ? ' ' + tile.unit : '';
  const arrow = direction === 'up' ? '\u2197 +' : (direction === 'down' ? '\u2198 \u2212' : '\u2192 \u00b1');
  const text = arrow + oneDecimal(Math.abs(diff)) + unit;
  const endText = (e) => oneDecimal(e.v) + unit + ' (' + (e.count > 1 ? 'average of ' + e.count + ', ' + e.from + ' to ' + e.to : String(e.from)) + ')';
  return { diff, direction, text, first, last, hover: 'From ' + endText(first) + ' to ' + endText(last) };
}

/* The lowest and highest of a chart's one series, over what it plots:
 * "247.2-262.0 lb" (with an en dash). Whole numbers stay whole
 * ("1,200-15,034 orders"); anything else gets one decimal. The tile's
 * unit once. Pure; null when there is nothing to show. */
function chartRangeOf(table, tile) {
  const xIdx = columnIndex(table.columns, tile.x);
  const yName = tile.y && tile.y.length ? tile.y[0] : '';
  const yIdx = columnIndex(table.columns, yName);
  if (yIdx < 0) return null;
  let lo = null;
  let hi = null;
  for (const row of table.rows) {
    const v = row[yIdx];
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    const at = xIdx >= 0 ? row[xIdx] : null;
    if (!lo || n < lo.v) lo = { v: n, at };
    if (!hi || n > hi.v) hi = { v: n, at };
  }
  if (!lo) return null;
  const unit = tile.unit ? ' ' + tile.unit : '';
  const whole = Number.isInteger(lo.v) && Number.isInteger(hi.v);
  const num = (v) => (whole ? formatNumber(v) : v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
  const when = (e) => (e.at === null || e.at === undefined || e.at === '' ? '' : ' (' + e.at + ')');
  return {
    text: num(lo.v) + '\u2013' + num(hi.v) + unit,
    hover: 'Lowest ' + num(lo.v) + unit + when(lo) + ', highest ' + num(hi.v) + unit + when(hi),
  };
}

/* The roll-up a chart asked for, or null. */
function chartCaptionOf(table, tile) {
  if (tile.viz !== 'line' && tile.viz !== 'bar') return null;
  if (tile.chartCaption === 'range') return chartRangeOf(table, tile);
  if (tile.chartCaption === 'change') {
    const d = headerDeltaOf(table, tile);
    return d ? { text: d.text, hover: d.hover } : null;
  }
  return null;
}

/* ------------------------------------------------------- value levels -- */

/* A stat widget can judge its headline number (never the change) against
 * a list of ranges. Each range names a level from the plugin settings
 * (Good, Watch, Alert by default). The first range that holds the number
 * wins; a range with neither "low" nor "high" holds every number, so it
 * is the "anything else" at the end. Bounds are inclusive. The colour is
 * never the only signal: the level name rides the tile's accessible
 * label, and a range may carry a short text pill ("see doctor"). A
 * missing or broken setup draws a neutral tile, never an error. */

function isLevelColor(v) { return typeof v === 'string' && LEVEL_COLOR_RE.test(v.trim()); }

/* The levels from the settings file, made safe: a named level with a
 * valid colour survives, anything else is dropped or loses its colour.
 * A file with no levels at all gets the three defaults. */
function normalizeLevels(raw) {
  if (!Array.isArray(raw)) return DEFAULT_LEVELS.map((l) => Object.assign({}, l));
  const out = [];
  const seen = new Set();
  const ids = new Set();
  for (const l of raw) {
    if (!l || typeof l !== 'object') continue;
    const name = typeof l.name === 'string' ? l.name.trim() : '';
    if (!name || name.length > LEVEL_NAME_MAX || seen.has(name)) continue;
    seen.add(name);
    const id = typeof l.id === 'string' && LEVEL_ID_RE.test(l.id) && !ids.has(l.id) ? l.id : levelIdFor(name, ids);
    ids.add(id);
    out.push({ id, name, color: isLevelColor(l.color) ? l.color.trim() : '' });
  }
  return out;
}

/* A fresh id for a level, from its name, never one already taken. */
function levelIdFor(name, taken) {
  const slug = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'level';
  let id = slug;
  for (let n = 2; taken.has(id); n++) id = slug + '-' + n;
  return id;
}

/* A rename, checked: the level is found by its id, never by its name.
 * Returns { ok, from, to, unchanged } or { ok, reason }. */
function planLevelRename(levels, id, newName) {
  const level = Array.isArray(levels) ? levels.find((l) => l && l.id === id) : null;
  if (!level) return { ok: false, reason: 'That level is no longer in the settings.' };
  const to = typeof newName === 'string' ? newName.trim() : '';
  if (!to) return { ok: false, reason: 'A level needs a name.' };
  if (to.length > LEVEL_NAME_MAX) return { ok: false, reason: 'A level name can be ' + LEVEL_NAME_MAX + ' characters at most.' };
  if (to === level.name) return { ok: true, from: level.name, to, unchanged: true };
  if (levels.some((l) => l && l !== level && l.name === to)) return { ok: false, reason: 'There is already a level called ' + to + '.' };
  return { ok: true, from: level.name, to, unchanged: false };
}

/* Carry a renamed level over inside one dashboard file (or one cache
 * file: the same tiles list), in the raw JSON so nothing else in the file
 * changes. Returns how many widgets changed. A widget that already has a
 * colour under the new name keeps it; the old name's colour then goes. */
function renameLevelInDashboard(raw, from, to) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tiles) || !from || !to || from === to) return 0;
  let changed = 0;
  for (const tile of raw.tiles) {
    if (!tile || typeof tile !== 'object') continue;
    let hit = false;
    if (Array.isArray(tile.ranges)) {
      for (const r of tile.ranges) {
        if (r && typeof r === 'object' && typeof r.level === 'string' && r.level.trim() === from) { r.level = to; hit = true; }
      }
    }
    const colors = tile.levelColors;
    if (colors && typeof colors === 'object' && !Array.isArray(colors) && Object.prototype.hasOwnProperty.call(colors, from)) {
      const next = {};
      for (const [key, value] of Object.entries(colors)) {
        if (key === from) { if (!Object.prototype.hasOwnProperty.call(colors, to)) next[to] = value; }
        else next[key] = value;
      }
      tile.levelColors = next;
      hit = true;
    }
    if (hit) changed++;
  }
  return changed;
}

function normalizeLevelLooks(raw) {
  const out = {};
  for (const [kind, looks] of Object.entries(LEVEL_LOOKS)) {
    const v = raw && typeof raw === 'object' ? raw[kind] : undefined;
    out[kind] = Object.prototype.hasOwnProperty.call(looks, v) ? v : DEFAULT_LEVEL_LOOKS[kind];
  }
  return out;
}

/* Validate a tile's "ranges". Returns { ok, ranges } or { ok, reason }. */
function checkRanges(raw, viz, at) {
  if (raw === undefined) return { ok: true, ranges: undefined };
  if (viz !== 'stat' && !isPartsViz(viz) && viz !== 'heatmap' && viz !== 'calendar' && viz !== 'bullet') return { ok: false, reason: at + ': "ranges" only work on a stat widget (One big number), a segments bar, a pie chart, a heatmap, a calendar or a bullet chart.' };
  if (!Array.isArray(raw)) return { ok: false, reason: at + ': "ranges" must be a list like [{"low": 18.5, "high": 24.9, "level": "Good"}].' };
  if (raw.length > RANGES_MAX) return { ok: false, reason: at + ': "ranges" can hold at most ' + RANGES_MAX + ' ranges.' };
  const out = [];
  let catchAll = -1;
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const where = at + ', range ' + (i + 1);
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      return { ok: false, reason: where + ' must be a JSON object like {"low": 18.5, "high": 24.9, "level": "Good"}.' };
    }
    if (catchAll >= 0) {
      return { ok: false, reason: where + ' can never match: range ' + (catchAll + 1) + ' has no "low" and no "high", so it already catches every number. Put the catch-all last.' };
    }
    const range = {};
    for (const key of ['low', 'high']) {
      const v = r[key];
      if (v === undefined || v === null) continue;
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return { ok: false, reason: where + ': "' + key + '" must be a number, or left out for no limit.' };
      }
      range[key] = v;
    }
    if (range.low !== undefined && range.high !== undefined && range.low > range.high) {
      return { ok: false, reason: where + ': "low" (' + range.low + ') is above "high" (' + range.high + ').' };
    }
    const level = typeof r.level === 'string' ? r.level.trim() : '';
    if (!level || level.length > LEVEL_NAME_MAX) {
      return { ok: false, reason: where + ' needs a "level": the name of a level from the plugin settings, like "Good".' };
    }
    range.level = level;
    if (r.label !== undefined) {
      if (typeof r.label !== 'string' || r.label.trim().length > LEVEL_LABEL_MAX) {
        return { ok: false, reason: where + ': "label" must be short text, ' + LEVEL_LABEL_MAX + ' characters at most.' };
      }
      if (r.label.trim()) range.label = r.label.trim();
    }
    if (range.low === undefined && range.high === undefined) catchAll = i;
    out.push(range);
  }
  return { ok: true, ranges: out.length ? out : undefined };
}

/* Validate a tile's "levelColors": a per-widget colour for a level. The
 * override keeps the level's name and changes only its colour. */
function checkLevelColors(raw, viz, at) {
  if (raw === undefined) return { ok: true, colors: undefined };
  if (viz !== 'stat' && !isPartsViz(viz) && viz !== 'heatmap' && viz !== 'calendar' && viz !== 'bullet') return { ok: false, reason: at + ': "levelColors" only work on a stat widget (One big number), a segments bar, a pie chart, a heatmap, a calendar or a bullet chart.' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: at + ': "levelColors" must be an object like {"Alert": "#cc3311"}.' };
  }
  const out = {};
  for (const [name, color] of Object.entries(raw)) {
    const key = name.trim();
    if (!key || key.length > LEVEL_NAME_MAX) {
      return { ok: false, reason: at + ': every name in "levelColors" must be a level name, like "Alert".' };
    }
    if (!isLevelColor(color)) {
      return { ok: false, reason: at + ': the colour for "' + key + '" in "levelColors" must be a theme colour like "var(--color-red)" or a hex colour like "#cc3311".' };
    }
    out[key] = color.trim();
  }
  return { ok: true, colors: Object.keys(out).length ? out : undefined };
}

/* Both level checks for one tile. Returns { ok, ranges, colors } or
 * { ok, reason }. */
function checkTileLevels(t, at) {
  const ranges = checkRanges(t.ranges, t.viz, at);
  if (!ranges.ok) return ranges;
  const colors = checkLevelColors(t.levelColors, t.viz, at);
  if (!colors.ok) return colors;
  return { ok: true, ranges: ranges.ranges, colors: colors.colors };
}

/* Validate a tile's "rangeColumn": the column whose number the ranges
 * judge instead of the shown value, for a value that is not one number
 * ("114/66"). The column is never shown. Returns { ok, rangeColumn } or
 * { ok, reason }. */
function checkRangeColumn(raw, viz, ranges, y, at) {
  if (raw === undefined) return { ok: true, rangeColumn: undefined };
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: at + ': "rangeColumn" must be the name of a column from the query.' };
  if (viz !== 'stat' && !isPartsViz(viz)) return { ok: false, reason: at + ': "rangeColumn" only works on a stat widget (One big number), a segments bar or a pie chart.' };
  if (!ranges) return { ok: false, reason: at + ': "rangeColumn" needs "ranges" to judge it against.' };
  const name = raw.trim();
  if (Array.isArray(y) && y[0] === name) return { ok: false, reason: at + ': "rangeColumn" is the shown value already; leave it out and the ranges judge the value.' };
  return { ok: true, rangeColumn: name };
}

/* The first range that holds the value, or null. Defensive on shape,
 * because a cached tile is a plain file that can be edited by hand: a
 * range with a broken bound never matches. Values arrive as numbers or
 * as numeric text (printf output). */
function levelOf(value, ranges) {
  if (!Array.isArray(ranges) || !ranges.length) return null;
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  const bound = (b) => b === undefined || b === null || (typeof b === 'number' && Number.isFinite(b));
  for (const r of ranges) {
    if (!r || typeof r !== 'object' || typeof r.level !== 'string' || !r.level) continue;
    if (!bound(r.low) || !bound(r.high)) continue;
    if (typeof r.low === 'number' && v < r.low) continue;
    if (typeof r.high === 'number' && v > r.high) continue;
    return r;
  }
  return null;
}

/* The level a tile's value lands on, with its colour: the widget's own
 * override when it has one, else the settings colour. null when nothing
 * matches; known is false when the range names a level the settings do
 * not have (the tile then stays neutral, override or not). */
function resolveLevel(value, tile, levels) {
  const range = levelOf(value, tile && tile.ranges);
  if (!range) return null;
  const known = Array.isArray(levels) ? levels.find((l) => l && l.name === range.level) : null;
  const own = tile.levelColors && typeof tile.levelColors === 'object' && Object.prototype.hasOwnProperty.call(tile.levelColors, range.level)
    ? tile.levelColors[range.level] : undefined;
  const overridden = !!known && isLevelColor(own);
  const color = overridden ? own.trim() : (known && isLevelColor(known.color) ? known.color.trim() : '');
  return { name: range.level, label: typeof range.label === 'string' ? range.label : '', color, known: !!known, overridden };
}

function levelLookFor(kind, looks) {
  const all = normalizeLevelLooks(looks);
  const look = all[kind] || DEFAULT_LEVEL_LOOKS[kind] || '';
  return look === 'same' ? all.stat : look;
}

/* The preview gate as a state machine: a widget that never previewed
 * green does not save. Only 'ok' unlocks Save; any change makes the
 * preview stale again. */
function nextPreviewState(state, event) {
  if (event === 'change') return 'stale';
  if (event === 'run') return 'running';
  if (event === 'ok') return state === 'running' ? 'ok' : state;
  if (event === 'error') return state === 'running' ? 'error' : state;
  return state;
}

function canSave(previewState) { return previewState === 'ok'; }

/* What a widget type is called in the form, for the plain sentences. */
const VIZ_NAMES = {
  line: 'a line chart', bar: 'a bar chart', scatter: 'a scatter chart', stat: 'one big number', table: 'a table', divider: 'a section divider',
  combo: 'a combo chart', segments: 'a segments bar', pie: 'a pie chart', heatmap: 'a heatmap', calendar: 'a year calendar', bullet: 'a bullet chart', text: 'a text widget',
};

/* A form field's text as a number: empty is "not set", anything else must
 * read as a number. Returns { ok, value } or { ok, reason }. */
function formNumber(text, label) {
  const t = String(text === undefined || text === null ? '' : text).trim();
  if (!t) return { ok: true, value: undefined };
  const n = Number(t);
  if (!Number.isFinite(n)) return { ok: false, reason: label + ' must be a number, or left empty.' };
  return { ok: true, value: n };
}

/* A comma-separated list of numbers, like "0, 50, 100". */
function formNumberList(text, label) {
  const t = String(text === undefined || text === null ? '' : text).trim();
  if (!t) return { ok: true, value: undefined };
  const parts = t.split(',').map((p) => p.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isFinite(n)) return { ok: false, reason: label + ' must be numbers separated by commas, like 0, 50, 100.' };
    out.push(n);
  }
  return { ok: true, value: out };
}

/* The edit form's last word on a widget: one tile, read by the same
 * parser as a dashboard file, so the form can never save what the file
 * would refuse. Returns { ok, tile } or { ok, reason } in plain words. */
function checkFormTile(raw, database) {
  const parsed = parseDashboardSpec(JSON.stringify({ id: 'form-check', title: 'Form', database: database || undefined, tiles: [raw] }));
  if (!parsed.ok) return { ok: false, reason: parsed.reason.replace(/^Tile 1/, 'This widget') };
  const tile = parsed.spec.tiles[0];
  delete tile.layout;
  return { ok: true, tile };
}

/* The settings of the widget being edited that the widget about to be
 * saved does not carry. The widget's frame (its type, query or source,
 * columns, name, unit, place) is the form's own and is never listed. */
const FORM_FRAME_KEYS = new Set(['title', 'viz', 'sql', 'source', 'x', 'y', 'unit', 'stack', 'compare', 'favorable', 'layout']);

function droppedSettings(existing, tile) {
  if (!existing || !tile) return [];
  return Object.keys(existing).filter((k) => !FORM_FRAME_KEYS.has(k) && existing[k] !== undefined && tile[k] === undefined);
}

/* Size presets for the form: names a member can pick without thinking in
 * grid cells. */
const SIZE_PRESETS = {
  small: { label: 'Small (a square)', w: 1, h: 1 },
  medium: { label: 'Medium', w: 2, h: 2 },
  wide: { label: 'Wide', w: 3, h: 2 },
  large: { label: 'Large', w: 3, h: 3 },
};

function sizePresetOf(layout) {
  if (!layout) return '';
  for (const [key, p] of Object.entries(SIZE_PRESETS)) {
    if (p.w === layout.w && p.h === layout.h) return key;
  }
  return '';
}

/* ========================================================================
 * 2. THE ENGINES
 * ====================================================================== */

/* The engine: sql.js. The whole database file is loaded into memory, so the
 * caller checks the size cap first. The wasm module loads once per session;
 * an open database is kept until the file on disk changes. */
class WasmEngine {
  constructor(plugin) {
    this.plugin = plugin;
    this.SQL = null;
    this.open = new Map(); /* dbPath -> { db, mtime, size } */
  }

  /* The sql.js runtime. The JavaScript half is compiled into this file (see
   * "the vendored sql.js" at the end), so no code is ever read from disk or
   * built from a string. Only the WebAssembly binary is data: from the
   * plugin folder when the standalone sql-wasm.wasm is installed there
   * (manual installs keep smaller diffs), otherwise from the copy embedded
   * at the end of main.js. Obsidian's community-directory installer
   * downloads exactly three files (main.js, manifest.json, styles.css), so
   * a directory install has no standalone copy and runs on the embedded one. */
  async loadWasmBinary() {
    const adapter = this.plugin.app.vault.adapter;
    const dir = this.plugin.manifest.dir;
    try {
      const wasmPath = dir + '/sql-wasm.wasm';
      if (await adapter.exists(wasmPath)) {
        return new Uint8Array(await adapter.readBinary(wasmPath));
      }
    } catch (e) {
      /* An unreadable standalone copy falls through to the embedded one
       * rather than breaking the engine. */
    }
    return bytesOfB64(EMBEDDED_SQL_WASM_B64);
  }

  async init() {
    if (this.SQL) return;
    const wasmBinary = await this.loadWasmBinary();
    const mod = { exports: {} };
    /* sql-wasm.js is a UMD build: given a `module` it exports initSqlJs.
     * `require`, `__dirname` and `__filename` ride along for its Node
     * branch (Electron computes them eagerly even though the wasm arrives
     * as bytes); a plain web view detects the web and never asks. */
    vendoredSqlJs(
      mod, mod.exports, typeof require === 'function' ? require : undefined, '/', '/sql-wasm.js'
    );
    const initSqlJs = mod.exports;
    if (typeof initSqlJs !== 'function') throw new Error('The bundled sql-wasm.js did not load.');
    this.SQL = await initSqlJs({ wasmBinary });
  }

  async database(dbPath) {
    const adapter = this.plugin.app.vault.adapter;
    const stat = await adapter.stat(dbPath);
    if (!stat) throw new Error('The database file was not found at ' + dbPath + '.');
    const cached = this.open.get(dbPath);
    if (cached && cached.mtime === stat.mtime && cached.size === stat.size) return cached.db;
    if (cached) { try { cached.db.close(); } catch (e) { /* already gone */ } this.open.delete(dbPath); }
    await this.init();
    const bytes = await adapter.readBinary(dbPath);
    /* The bytes are in hand already, so the header costs nothing here. */
    if (bytes.byteLength > 0 && !hasSqliteHeader(new Uint8Array(bytes, 0, Math.min(SQLITE_MAGIC.length, bytes.byteLength)))) throw notSqliteError();
    const db = new this.SQL.Database(new Uint8Array(bytes));
    this.open.set(dbPath, { db, mtime: stat.mtime, size: stat.size });
    return db;
  }

  async query(dbPath, sql) {
    const db = await this.database(dbPath);
    return wasmTable(db.exec(sql));
  }

  closeAll() {
    for (const { db } of this.open.values()) { try { db.close(); } catch (e) { /* already gone */ } }
    this.open.clear();
  }
}

/* The one place a query happens. Gate first, cap second, engine third. */
class QueryService {
  constructor(plugin) {
    this.plugin = plugin;
    this.wasm = new WasmEngine(plugin);
  }

  /* THE PATH GUARD. A database path is untrusted text (a console box, a
   * dashboard file, a note block), and it is handed to the vault to read.
   * So the only paths that pass are real
   * vault files: no `..` segment, no absolute path or drive letter, nothing
   * inside a dot folder or the vault's config folder, and the vault itself
   * must know a file there. Returns a plain reason, or null when it is fine. */
  pathRefusal(dbPath) {
    if (typeof dbPath !== 'string' || dbPath.trim() === '') return 'No database path was given.';
    const vault = this.plugin.app.vault;
    const segments = dbPath.split(/[\\/]/);
    if (dbPath.indexOf('\0') >= 0) return 'That database path is not allowed.';
    if (/^[\\/]/.test(dbPath) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(dbPath)) {
      return 'A database path must be a path inside the vault, not an absolute path or a URI: ' + dbPath;
    }
    if (segments.some((s) => s === '..')) {
      return 'A database path may not contain "..": ' + dbPath;
    }
    const configDir = String(vault.configDir || '.obsidian').replace(/^[\\/]+|[\\/]+$/g, '').toLowerCase();
    if (segments.some((s) => s.startsWith('.')) || (configDir && segments[0].toLowerCase() === configDir)) {
      return 'A database inside a hidden or configuration folder is not opened: ' + dbPath;
    }
    const file = typeof vault.getAbstractFileByPath === 'function' ? vault.getAbstractFileByPath(dbPath) : null;
    if (!(file instanceof TFile)) return 'The database file was not found in the vault at ' + dbPath + '.';
    return null;
  }

  /* Which engine answers for this database, or a plain reason why none can. */
  async engineFor(dbPath) {
    const refusal = this.pathRefusal(dbPath);
    if (refusal) return { engine: null, reason: refusal };
    const adapter = this.plugin.app.vault.adapter;
    const stat = await adapter.stat(dbPath);
    if (!stat) return { engine: null, reason: 'The database file was not found at ' + dbPath + '.' };
    const capMb = this.plugin.settings.mobileCapMb;
    if (stat.size <= capMb * MB) return { engine: 'wasm', size: stat.size };
    let reason;
    if (!Platform.isDesktopApp) {
      reason = 'This database is too big to load into memory on this device (' + formatBytes(stat.size) + ', the cap is ' + capMb + ' MB). Dashboards for it still work from the desktop cache.';
    } else if (stat.size > MAX_CAP_MB * MB) {
      reason = 'This database is too big for ReadOut to open (' + formatBytes(stat.size) + '; the most it can load is ' + MAX_CAP_MB + ' MB). Dashboards for it still work from the cache the desktop wrote before, if there is one.';
    } else {
      reason = 'This database is too big for the size cap (' + formatBytes(stat.size) + ', the cap is ' + capMb + ' MB). Raise "Size cap for the built-in engine" in the ReadOut settings to open it, up to ' + MAX_CAP_MB + ' MB; while it loads it needs roughly three times the file size in free memory.';
    }
    return { engine: null, size: stat.size, tooBig: true, reason };
  }

  /* Run one read-only statement. `cap` adds a LIMIT to an uncapped SELECT;
   * pass 0 to trust the query (the browser builds its own LIMIT). */
  async query(dbPath, sql, { cap } = {}) {
    const gate = gateStatement(sql);
    if (!gate.ok) throw new Error(gate.reason);
    let finalSql = sql;
    let capped = false;
    if (cap) {
      const r = applyRowCap(sql, cap);
      finalSql = r.sql;
      capped = r.capped;
    }
    const choice = await this.engineFor(dbPath);
    if (!choice.engine) throw new Error(choice.reason);
    const t0 = Date.now();
    const table = await this.wasm.query(dbPath, finalSql);
    return { columns: table.columns, rows: table.rows, ms: Date.now() - t0, engine: choice.engine, capped };
  }
}

async function ensureFolder(adapter, folder) {
  const parts = normalizePath(folder).split('/');
  let path = '';
  for (const part of parts) {
    path = path ? path + '/' + part : part;
    if (!(await adapter.exists(path))) await adapter.mkdir(path);
  }
}

/* ========================================================================
 * 3. THE OBSIDIAN SURFACE
 * ====================================================================== */

/* ------------------------------------------------------------- charts -- */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  return el;
}

/* Charts are drawn to the size they are given, never stretched: the
 * viewBox is the real width and height of the chart's box, so text keeps
 * its size and nothing is cut by the tile edge. The box is measured, and
 * the chart is redrawn whenever the tile resizes. Where there is nothing
 * to measure (no layout yet, or the gates), the 640 x 260 frame stands in
 * and scales to the width, as before. */
const CHART_W = 640;
const CHART_H = 260;
/* Tick labels are 10px mono: about 0.6em a character. */
const TICK_CHAR_W = 6.2;
/* Below these the labels step aside before anything could be cut: no
 * x labels under CHART_MIN_X_H tall, no y labels under CHART_MIN_Y_W wide. */
const CHART_MIN_X_H = 90;
const CHART_MIN_Y_W = 140;
/* The legend goes before the plot gets shorter than this. */
const CHART_MIN_PLOT_WITH_LEGEND = 70;

/* The frame for a W x H chart: paddings, the plot, the y scale, and
 * which labels fit. Pure, so every size can be measured in the gates. */
/* `axis`, when given, is the tile: its own y range and x-label spacing. */
function chartLayout(W, H, lo, hi, hasXLabels, axis) {
  W = Math.max(1, Math.floor(W));
  H = Math.max(1, Math.floor(H));
  const top = 6;
  const right = 8;
  const showX = hasXLabels && H >= CHART_MIN_X_H;
  const bottom = showX ? 20 : 4;
  const plotH = Math.max(1, H - top - bottom);
  const scale = chartScaleFor(axis, lo, hi, Math.max(2, Math.min(5, Math.floor(plotH / 24))));
  const showY = W >= CHART_MIN_Y_W && plotH >= 30;
  const tickText = tickFormatter(axis);
  const yText = scale.ticks.map(tickText);
  const left = showY ? Math.ceil(Math.max(...yText.map((t) => t.length)) * TICK_CHAR_W) + 10 : 4;
  const plotW = Math.max(1, W - left - right);
  /* A value past a fixed end is drawn at that end, never outside the plot. */
  const yOf = (v) => Math.max(top, Math.min(top + plotH, top + plotH - ((v - scale.min) / (scale.max - scale.min)) * plotH));
  const xLabelEvery = axis && Number.isInteger(axis.xLabelEvery) && axis.xLabelEvery > 1 ? axis.xLabelEvery : 1;
  return { W, H, top, right, bottom, left, plotW, plotH, scale, showX, showY, yOf, xLabelEvery, tickText };
}

/* Which x labels to draw, where, and how anchored: thinned to what fits
 * the plot width, kept inside the chart, never overlapping. */
function xLabelPlan(L, xLabels, xOf) {
  if (!L.showX || !xLabels.length) return [];
  const texts = xLabels.map(shortXLabel);
  const n = texts.length;
  const widest = Math.max(...texts.map((t) => t.length)) * TICK_CHAR_W;
  const fit = Math.max(1, Math.floor(L.plotW / (widest + 10)));
  const fitEvery = Math.max(1, Math.ceil(n / Math.min(7, fit)));
  /* A tile's own spacing: every Nth label, or a multiple of N when even
   * that does not fit. */
  const own = L.xLabelEvery || 1;
  const every = own * Math.max(1, Math.ceil(fitEvery / own));
  const out = [];
  let lastRight = -Infinity;
  for (let i = 0; i < n; i += every) {
    const half = (texts[i].length * TICK_CHAR_W) / 2;
    const x = Math.min(Math.max(xOf(i), half + 1), L.W - half - 1);
    if (x - half < lastRight + 6) continue;
    out.push({ i, x, text: texts[i] });
    lastRight = x + half;
  }
  return out;
}

function drawAxes(svg, L, xLabels, xOf) {
  for (const tick of L.scale.ticks) {
    const y = L.yOf(tick);
    svg.appendChild(svgEl('line', { x1: L.left, y1: y, x2: L.left + L.plotW, y2: y, class: 'icor-sqlv-gridline' }));
    if (!L.showY) continue;
    const label = svgEl('text', { x: L.left - 6, y: y + 3, 'text-anchor': 'end', class: 'icor-sqlv-tick' });
    label.textContent = (L.tickText || formatNumber)(tick);
    svg.appendChild(label);
  }
  /* The baseline is the axis; it separates, it does not frame. */
  svg.appendChild(svgEl('line', {
    x1: L.left, y1: L.top + L.plotH, x2: L.left + L.plotW, y2: L.top + L.plotH,
    class: 'icor-sqlv-baseline',
  }));
  for (const { x, text } of xLabelPlan(L, xLabels, xOf)) {
    const label = svgEl('text', { x: x.toFixed(1), y: L.H - L.bottom + 14, 'text-anchor': 'middle', class: 'icor-sqlv-tick' });
    label.textContent = text;
    svg.appendChild(label);
  }
}

function shortXLabel(v) {
  const s = String(v === null || v === undefined ? '' : v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(5) : s;
}

function legendFor(parentEl, names, palette, guides) {
  const shown = names.length < 2 ? [] : names;
  const lines = Array.isArray(guides) ? guides : [];
  if (!shown.length && !lines.length) return null;
  const legend = parentEl.createDiv({ cls: 'icor-sqlv-legend' });
  shown.forEach((name, i) => {
    const item = legend.createSpan({ cls: 'icor-sqlv-legend-item' });
    item.setAttribute('title', name);
    const chip = item.createSpan({ cls: 'icor-sqlv-legend-chip' });
    chip.style.background = palette[i];
    item.createSpan({ cls: 'icor-sqlv-legend-name', text: name });
  });
  for (const g of lines) {
    const item = legend.createSpan({ cls: 'icor-sqlv-legend-item' });
    item.setAttribute('title', g.name);
    const chip = item.createSpan({ cls: 'icor-sqlv-legend-chip is-guide' });
    if (g.color) chip.style.setProperty('border-top-color', g.color);
    item.createSpan({ cls: 'icor-sqlv-legend-name', text: g.name });
  }
  return legend;
}

/* A ResizeObserver built from the element's own window. Obsidian gives
 * every node `win`, which in a popout is the popout's window; the main
 * window's constructor may deliver late or never there. The global is the
 * fallback. Null when there is no ResizeObserver at all. */
function resizeObserverFor(el, callback) {
  const win = el && el.win;
  const Ctor = (win && win.ResizeObserver) || (typeof ResizeObserver !== 'undefined' ? ResizeObserver : null);
  return Ctor ? new Ctor(callback) : null;
}

/* The chart's box: a measured drawing area over a one-line legend. The
 * legend steps aside when the plot would get too short. Redraws only when
 * the measured size changes; stops when the tile is gone. `observers`, when
 * given, collects the box's observer so its owner can disconnect it. */
function chartBox(parentEl, names, palette, draw, observers, guides) {
  const box = parentEl.createDiv({ cls: 'icor-sqlv-chart-box' });
  const host = box.createDiv({ cls: 'icor-sqlv-chart-host' });
  const legend = legendFor(box, names, palette, guides);
  let last = '';
  const redraw = () => {
    if (legend) {
      legend.classList.remove('is-hidden');
      const boxH = box.clientHeight;
      if (boxH > 0 && boxH - (legend.offsetHeight || 0) < CHART_MIN_PLOT_WITH_LEGEND) legend.classList.add('is-hidden');
    }
    const w = host.clientWidth;
    const h = host.clientHeight;
    const measured = w > 0 && h > 0;
    const W = measured ? Math.floor(w) : CHART_W;
    const H = measured ? Math.floor(h) : CHART_H;
    const key = W + 'x' + H + (measured ? '' : '?');
    if (key === last) return;
    last = key;
    host.empty();
    const attrs = { viewBox: '0 0 ' + W + ' ' + H, class: 'icor-sqlv-chart' + (measured ? ' is-measured' : ''), role: 'img' };
    if (measured) { attrs.width = W; attrs.height = H; }
    const svg = svgEl('svg', attrs);
    host.appendChild(svg);
    draw(svg, W, H);
  };
  redraw();
  /* A chart drawn before it has its final size (a note section built off
   * screen, a frame whose style lands a moment later) is measured again on
   * the next frames, even if no observer reports the change: for about two
   * seconds, and for as long as it has no size at all. */
  {
    const win = box.win || (typeof window !== 'undefined' ? window : null);
    let tries = 0;
    const settle = () => {
      tries++;
      if (tries > 600 || (tries > 120 && !last.endsWith('?'))) return;
      if (box.isConnected) redraw();
      win.requestAnimationFrame(settle);
    };
    if (win && typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(settle);

    /* A section the note draws off screen gets its size only when it is
     * scrolled to: measure again whenever it comes into view. */
    const Seen = win && win.IntersectionObserver;
    if (Seen) {
      const seen = new Seen(() => {
        if (!box.isConnected) return;
        redraw();
        if (win.requestAnimationFrame) win.requestAnimationFrame(redraw);
      });
      seen.observe(box);
    }
  }
  const observer = resizeObserverFor(box, () => {
    if (!box.isConnected) { observer.disconnect(); return; }
    redraw();
  });
  if (observer) {
    observer.observe(box);
    if (observers) observers.push(observer);
  }
  return { box, host, legend, redraw };
}

/* A bar with only its top corners rounded; square when narrow. */
function barPath(x, y, w, h, r) {
  if (r <= 0 || h < r) {
    return 'M ' + x.toFixed(1) + ' ' + (y + h).toFixed(1) + ' V ' + y.toFixed(1) + ' H ' + (x + w).toFixed(1) + ' V ' + (y + h).toFixed(1) + ' Z';
  }
  return 'M ' + x.toFixed(1) + ' ' + (y + h).toFixed(1) +
    ' V ' + (y + r).toFixed(1) +
    ' Q ' + x.toFixed(1) + ' ' + y.toFixed(1) + ' ' + (x + r).toFixed(1) + ' ' + y.toFixed(1) +
    ' H ' + (x + w - r).toFixed(1) +
    ' Q ' + (x + w).toFixed(1) + ' ' + y.toFixed(1) + ' ' + (x + w).toFixed(1) + ' ' + (y + r).toFixed(1) +
    ' V ' + (y + h).toFixed(1) + ' Z';
}

/* The prior period as a dotted ghost, aligned point-for-point with the
 * current period. Dots mean "another time", a state, not a category. */
function drawGhost(svg, ghost, { xOf, yOf, scale, color, top, count }) {
  if (!ghost || !ghost.rows || !ghost.rows.length) return;
  const vi = columnIndex(ghost.columns, 'value');
  if (vi < 0) return;
  let d = '';
  /* Point for point with the current period, never past its last point. */
  ghost.rows.slice(0, count).forEach((row, i) => {
    const v = Number(row[vi]);
    if (!Number.isFinite(v)) return;
    const y = Math.max(top, Math.min(yOf(scale.min), yOf(v)));
    d += (d ? ' L ' : 'M ') + xOf(i).toFixed(1) + ' ' + y.toFixed(1);
  });
  if (!d) return;
  const path = svgEl('path', {
    d, fill: 'none', 'stroke-width': 1.5, 'stroke-linecap': 'round',
    'stroke-dasharray': '2 4', class: 'icor-sqlv-ghost',
  });
  path.setAttribute('stroke', color);
  svg.appendChild(path);
}

function renderLineChart(parentEl, table, tile, extras) {
  const xIdx = columnIndex(table.columns, tile.x);
  const seriesNames = tile.y.filter((c) => columnIndex(table.columns, c) >= 0);
  const seriesIdx = seriesNames.map((c) => columnIndex(table.columns, c));
  if (xIdx < 0 || seriesIdx.length === 0 || table.rows.length === 0) {
    parentEl.createDiv({ cls: 'icor-sqlv-empty', text: 'No rows to draw.' });
    return;
  }
  const values = [];
  for (const row of table.rows) for (const i of seriesIdx) { const v = Number(row[i]); if (Number.isFinite(v)) values.push(v); }
  const ghost = extras && extras.ghost;
  if (ghost && ghost.rows) {
    const vi = columnIndex(ghost.columns || [], 'value');
    if (vi >= 0) for (const row of ghost.rows) { const v = Number(row[vi]); if (Number.isFinite(v)) values.push(v); }
  }
  values.push(...chartMarkValues(tile));
  const band = tile.band && typeof tile.band === 'object' ? tile.band : null;
  const bandLow = band ? columnIndex(table.columns, band.low) : -1;
  const bandHigh = band ? columnIndex(table.columns, band.high) : -1;
  const hasBand = bandLow >= 0 && bandHigh >= 0;
  if (hasBand) {
    for (const row of table.rows) for (const i of [bandLow, bandHigh]) { const v = cellNumber(row[i]); if (Number.isFinite(v)) values.push(v); }
  }
  const palette = chartPaletteFor(tile, seriesIdx.length);
  const xLabels = table.rows.map((r) => r[xIdx]);
  const n = table.rows.length;
  const chart = chartBox(parentEl, seriesNames, palette, (svg, W, H) => {
    /* A snug axis: a heart rate line living between 60 and 90 should use
     * the whole plot, not hover above an empty run down to zero. */
    const L = chartLayout(W, H, Math.min(...values), Math.max(...values), true, tile);
    const xOf = (i) => L.left + (n === 1 ? L.plotW / 2 : (i / (n - 1)) * L.plotW);
    const yOf = L.yOf;
    drawZones(svg, L, tile);
    drawAxes(svg, L, xLabels, xOf);
    drawRefLines(svg, L, tile);
    if (hasBand) {
      /* Under the lines, in the first line's colour. */
      for (const d of bandPaths(table.rows, bandLow, bandHigh, xOf, yOf)) {
        const area = svgEl('path', { d, stroke: 'none', class: 'icor-sqlv-band' });
        area.setAttribute('fill', palette[0]);
        area.setAttribute('fill-opacity', typeof band.opacity === 'number' ? band.opacity : BAND_OPACITY_DEFAULT);
        svg.appendChild(area);
      }
    }
    seriesIdx.forEach((colIdx, s) => {
      let d = '';
      table.rows.forEach((row, i) => {
        const v = Number(row[colIdx]);
        if (!Number.isFinite(v)) return;
        d += (d ? ' L ' : 'M ') + xOf(i).toFixed(1) + ' ' + yOf(v).toFixed(1);
      });
      if (!d) return;
      /* Ruled, not drawn: this surface measures. */
      const path = svgEl('path', { d, fill: 'none', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
      path.setAttribute('stroke', palette[s]);
      svg.appendChild(path);
    });
    if (ghost) drawGhost(svg, ghost, { xOf, yOf, scale: L.scale, color: palette[0], top: L.top, count: n });

    /* Hover: the pen points. A solid marker guide, marker dots on the
     * hovered points, and the values on a small chip. */
    const guide = svgEl('line', { y1: L.top, y2: L.top + L.plotH, class: 'icor-sqlv-guide', visibility: 'hidden' });
    const chip = svgEl('rect', { class: 'icor-sqlv-readout-chip', rx: 4, height: 18, visibility: 'hidden' });
    const readout = svgEl('text', { class: 'icor-sqlv-readout', visibility: 'hidden' });
    const dots = seriesIdx.map(() => {
      const dot = svgEl('circle', { r: 3, class: 'icor-sqlv-hover-dot', visibility: 'hidden' });
      svg.appendChild(dot);
      return dot;
    });
    svg.appendChild(guide);
    svg.appendChild(chip);
    svg.appendChild(readout);
    const hover = svgEl('rect', { x: L.left, y: L.top, width: L.plotW, height: L.plotH, fill: 'transparent' });
    svg.appendChild(hover);
    hover.addEventListener('mousemove', (ev) => {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - L.left) / L.plotW) * (n - 1))));
      const x = xOf(i);
      guide.setAttribute('x1', x); guide.setAttribute('x2', x); guide.setAttribute('visibility', 'visible');
      const parts = [String(xLabels[i])];
      seriesIdx.forEach((colIdx, s) => {
        const v = Number(table.rows[i][colIdx]);
        if (Number.isFinite(v)) {
          parts.push(seriesNames[s] + ' ' + formatNumber(v) + (tile.unit ? ' ' + tile.unit : ''));
          dots[s].setAttribute('cx', x); dots[s].setAttribute('cy', yOf(v)); dots[s].setAttribute('visibility', 'visible');
        } else {
          dots[s].setAttribute('visibility', 'hidden');
        }
      });
      if (hasBand) {
        const lo = cellNumber(table.rows[i][bandLow]);
        const hi = cellNumber(table.rows[i][bandHigh]);
        if (Number.isFinite(lo) && Number.isFinite(hi)) {
          parts.push(band.low + '\u2013' + band.high + ' ' + formatNumber(lo) + '\u2013' + formatNumber(hi) + (tile.unit ? ' ' + tile.unit : ''));
        }
      }
      readout.textContent = parts.join('  ·  ');
      const flip = x > W / 2;
      readout.setAttribute('x', flip ? x - 10 : x + 10);
      readout.setAttribute('y', L.top + 12);
      readout.setAttribute('text-anchor', flip ? 'end' : 'start');
      readout.setAttribute('visibility', 'visible');
      const textW = typeof readout.getComputedTextLength === 'function'
        ? readout.getComputedTextLength() : readout.textContent.length * 6;
      chip.setAttribute('width', Math.ceil(textW) + 12);
      chip.setAttribute('x', flip ? x - 16 - textW : x + 4);
      chip.setAttribute('y', L.top);
      chip.setAttribute('visibility', 'visible');
    });
    hover.addEventListener('mouseleave', () => {
      guide.setAttribute('visibility', 'hidden');
      chip.setAttribute('visibility', 'hidden');
      readout.setAttribute('visibility', 'hidden');
      for (const dot of dots) dot.setAttribute('visibility', 'hidden');
    });
  }, extras && extras.observers, guideEntries(tile));
  applyChartColors(chart.box, tile);
}

function renderBarChart(parentEl, table, tile, extras) {
  const xIdx = columnIndex(table.columns, tile.x);
  const seriesNames = tile.y.filter((c) => columnIndex(table.columns, c) >= 0);
  const seriesIdx = seriesNames.map((c) => columnIndex(table.columns, c));
  if (xIdx < 0 || seriesIdx.length === 0 || table.rows.length === 0) {
    parentEl.createDiv({ cls: 'icor-sqlv-empty', text: 'No rows to draw.' });
    return;
  }
  const stacked = tile.stack && seriesIdx.length > 1;
  let top = 0;
  if (stacked) {
    for (const segs of stackRows(table.rows, seriesIdx)) top = Math.max(top, segs[segs.length - 1][1]);
  } else {
    for (const row of table.rows) for (const i of seriesIdx) top = Math.max(top, Number(row[i]) || 0);
  }
  for (const v of chartMarkValues(tile)) top = Math.max(top, v);
  const xLabels = table.rows.map((r) => r[xIdx]);
  const n = table.rows.length;
  const titleOf = (rowI, s, v) =>
    String(xLabels[rowI]) + ' · ' + seriesNames[s] + ' ' + formatNumber(v) + (tile.unit ? ' ' + tile.unit : '');
  const palette = chartPaletteFor(tile, seriesIdx.length);
  const ghost = extras && extras.ghost;
  const chart = chartBox(parentEl, seriesNames, palette, (svg, W, H) => {
    const L = chartLayout(W, H, 0, top, true, tile);
    const slot = L.plotW / n;
    const gap = Math.min(4, slot * 0.2);
    const yOf = L.yOf;
    const xOfBar = (i) => L.left + i * slot + slot / 2;
    drawZones(svg, L, tile);
    drawAxes(svg, L, xLabels, xOfBar);
    drawRefLines(svg, L, tile);
    if (stacked) {
      const stacks = stackRows(table.rows, seriesIdx);
      stacks.forEach((segs, rowI) => {
        const x = L.left + rowI * slot + gap / 2;
        const w = Math.max(0.5, slot - gap);
        segs.forEach(([lo, hi], s) => {
          if (hi <= lo) return;
          /* Segments separated by 1px of tile ground, not by stroke. */
          const yTop = yOf(hi);
          const pixelH = Math.max(0.5, yOf(lo) - yTop);
          const isTopmost = segs.slice(s + 1).every(([l2, h2]) => h2 <= l2);
          const inset = isTopmost ? 0 : 1;
          const bar = svgEl('rect', {
            x: x.toFixed(1), y: (yTop + inset).toFixed(1),
            width: w.toFixed(1), height: Math.max(0.5, pixelH - inset).toFixed(1),
          });
          bar.setAttribute('fill', palette[s]);
          const t = svgEl('title', {});
          t.textContent = titleOf(rowI, s, hi - lo);
          bar.appendChild(t);
          svg.appendChild(bar);
        });
      });
    } else {
      const inner = Math.max(0.5, (slot - gap) / seriesIdx.length);
      /* Flat tops when narrow, a 4px round at wide bars. */
      const r = inner >= 8 ? Math.min(4, inner / 2) : 0;
      table.rows.forEach((row, rowI) => {
        seriesIdx.forEach((colIdx, s) => {
          const v = Number(row[colIdx]) || 0;
          if (v <= 0) return;
          const x = L.left + rowI * slot + gap / 2 + s * inner;
          const h = Math.max(0.5, yOf(0) - yOf(v));
          const bar = svgEl('path', { d: barPath(x, yOf(v), inner, h, r) });
          bar.setAttribute('fill', palette[s]);
          const t = svgEl('title', {});
          t.textContent = titleOf(rowI, s, v);
          bar.appendChild(t);
          svg.appendChild(bar);
        });
      });
    }
    if (ghost) drawGhost(svg, ghost, { xOf: xOfBar, yOf, scale: L.scale, color: 'var(--sqlv-fg-dim)', top: L.top, count: n });
  }, extras && extras.observers, guideEntries(tile));
  applyChartColors(chart.box, tile);
}

/* A scatter chart: one point per row of the query, placed by a number in
 * the "x" column along the bottom and a number in the "y" column up the
 * side, to see whether two measures move together. "colorBy" names a
 * column whose values colour the points, one colour per value (the most
 * common four, the rest together as Other); "trend": true adds the
 * least-squares line through all the points. The y axis, "refLines" and
 * "zones" work as on a line chart; "xMin" and "xMax" fix the ends of the
 * x scale, which is a number scale and takes no label spacing. A row with
 * no number in either column is left out, never drawn at zero. Returns
 * { ok, scatter } or { ok, reason }. */
const SCATTER_KEYS = ['colorBy', 'trend'];

function checkScatter(t, y, at) {
  if (t.viz !== 'scatter') {
    for (const key of SCATTER_KEYS) {
      if (t[key] !== undefined) return { ok: false, reason: at + ': "' + key + '" only works on a scatter chart.' };
    }
    return { ok: true, scatter: undefined };
  }
  if (typeof t.x !== 'string' || !t.x.trim()) return { ok: false, reason: at + ': a scatter chart needs an "x" column: the number along the bottom.' };
  if (y.length !== 1) return { ok: false, reason: at + ': a scatter chart needs one "y" column: the number up the side.' };
  const scatter = {};
  if (t.colorBy !== undefined) {
    if (typeof t.colorBy !== 'string' || !t.colorBy.trim()) return { ok: false, reason: at + ': "colorBy" must be the name of a column whose values colour the points.' };
    if (t.colorBy.trim() === t.x.trim() || t.colorBy.trim() === y[0]) return { ok: false, reason: at + ': "colorBy" must be a different column from "x" and "y".' };
    scatter.colorBy = t.colorBy.trim();
  }
  if (t.trend !== undefined) {
    if (typeof t.trend !== 'boolean') return { ok: false, reason: at + ': "trend" must be true or false (true draws the least-squares line through the points).' };
    if (t.trend) scatter.trend = true;
  }
  return { ok: true, scatter };
}

function withScatter(tile, check) {
  if (check.scatter) Object.assign(tile, check.scatter);
  return tile;
}

/* The points of a scatter chart, and the colour groups when "colorBy"
 * names a column: [{ x, y, group, label }], where `group` indexes
 * `groups` (the names, most points first, the rest folded into Other past
 * the series ceiling) and `label` is the row's own value. Pure. */
function scatterOf(table, tile) {
  const xi = columnIndex(table.columns, tile.x);
  const yi = columnIndex(table.columns, (tile.y || [])[0]);
  const gi = tile.colorBy ? columnIndex(table.columns, tile.colorBy) : -1;
  if (xi < 0 || yi < 0) return null;
  const raw = [];
  for (const row of table.rows) {
    const x = cellNumber(row[xi]);
    const y = cellNumber(row[yi]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const label = gi < 0 ? '' : (row[gi] === null || row[gi] === undefined || row[gi] === '' ? 'no value' : String(row[gi]));
    raw.push({ x, y, label });
  }
  if (gi < 0) return { points: raw.map((p) => Object.assign(p, { group: 0 })), groups: [] };
  const counts = new Map();
  for (const p of raw) counts.set(p.label, (counts.get(p.label) || 0) + 1);
  const ranked = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
  const degrade = ranked.length > SERIES_CEILING;
  const names = degrade ? ranked.slice(0, SERIES_CEILING - 1) : ranked;
  const index = new Map(names.map((n, i) => [n, i]));
  const groups = degrade ? names.concat(['Other']) : names;
  for (const p of raw) p.group = index.has(p.label) ? index.get(p.label) : names.length;
  return { points: raw, groups };
}

/* The least-squares line through points [{x, y}]: slope, intercept and r
 * squared (how much of the spread in y the line explains, 0 to 1). Null
 * for fewer than two points or when every x is the same, where no line
 * stands. All y equal is a flat line that fits exactly. Pure. */
function leastSquares(points) {
  const n = points.length;
  if (n < 2) return null;
  let mx = 0;
  let my = 0;
  for (const p of points) { mx += p.x; my += p.y; }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    sxx += (p.x - mx) * (p.x - mx);
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) * (p.y - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy) };
}

/* The x scale of a scatter chart: the data's range on a round scale, or
 * the tile's own "xMin" and "xMax", with the labels that fall inside. */
function scatterXScale(lo, hi, axis, plotW) {
  const fixedMin = !!axis && typeof axis.xMin === 'number';
  const fixedMax = !!axis && typeof axis.xMax === 'number';
  const count = Math.max(2, Math.min(8, Math.floor(plotW / 70)));
  const nice = niceScale(fixedMin ? axis.xMin : lo, fixedMax ? axis.xMax : hi, count);
  const min = fixedMin ? axis.xMin : nice.min;
  let max = fixedMax ? axis.xMax : nice.max;
  if (max <= min) max = min + 1;
  const slack = nice.step / 1e6;
  return { min, max, ticks: nice.ticks.filter((v) => v >= min - slack && v <= max + slack) };
}

let scatterClipCount = 0;

function renderScatterChart(parentEl, table, tile, extras) {
  const data = scatterOf(table, tile);
  if (!data || table.rows.length === 0) {
    parentEl.createDiv({ cls: 'icor-sqlv-empty', text: 'No rows to draw.' });
    return;
  }
  if (!data.points.length) {
    parentEl.createDiv({ cls: 'icor-sqlv-empty', text: 'No numeric x and y values to draw.' });
    return;
  }
  const { points, groups } = data;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y).concat(chartMarkValues(tile));
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const palette = groups.length > 1 ? seriesPaletteFor(groups.length) : chartPaletteFor(tile, 1);
  const fit = tile.trend === true ? leastSquares(points) : null;
  const guides = guideEntries(tile).concat(fit ? [{ name: 'Trend', color: '' }] : []);
  const unit = tile.unit ? ' ' + tile.unit : '';
  const radius = points.length > 1500 ? 2 : 3;
  const chart = chartBox(parentEl, groups, palette, (svg, W, H) => {
    const L = chartLayout(W, H, Math.min(...ys), Math.max(...ys), true, tile);
    const X = scatterXScale(lo, hi, tile, L.plotW);
    const xOf = (v) => Math.max(L.left, Math.min(L.left + L.plotW, L.left + ((v - X.min) / (X.max - X.min)) * L.plotW));
    drawZones(svg, L, tile);
    drawAxes(svg, L, [], xOf);
    drawRefLines(svg, L, tile);
    if (L.showX) {
      let lastRight = -Infinity;
      for (const v of X.ticks) {
        const text = formatNumber(v);
        const half = (text.length * TICK_CHAR_W) / 2;
        const x = Math.min(Math.max(xOf(v), half + 1), L.W - half - 1);
        if (x - half < lastRight + 6) continue;
        const label = svgEl('text', { x: x.toFixed(1), y: L.H - L.bottom + 14, 'text-anchor': 'middle', class: 'icor-sqlv-tick' });
        label.textContent = text;
        svg.appendChild(label);
        lastRight = x + half;
      }
    }
    if (fit) {
      /* The line runs the data's own x range and is cut at the plot edge,
       * never bent to it, so a steep line leaves the frame at its true slope. */
      const clipId = 'icor-sqlv-scatter-clip-' + (++scatterClipCount);
      const defs = svgEl('defs');
      const clip = svgEl('clipPath', { id: clipId });
      clip.appendChild(svgEl('rect', { x: L.left, y: L.top, width: L.plotW, height: L.plotH }));
      defs.appendChild(clip);
      svg.appendChild(defs);
      const yRaw = (v) => L.top + L.plotH - ((v - L.scale.min) / (L.scale.max - L.scale.min)) * L.plotH;
      const line = svgEl('line', {
        x1: xOf(lo).toFixed(1), y1: yRaw(fit.slope * lo + fit.intercept).toFixed(1),
        x2: xOf(hi).toFixed(1), y2: yRaw(fit.slope * hi + fit.intercept).toFixed(1),
        class: 'icor-sqlv-trend', 'clip-path': 'url(#' + clipId + ')',
      });
      const tip = svgEl('title', {});
      tip.textContent = 'Trend: ' + tile.y[0] + ' changes by ' + formatNumber(Math.round(fit.slope * 1000) / 1000) + ' for each 1 of ' + tile.x + ' (r² ' + (Math.round(fit.r2 * 100) / 100) + ', ' + points.length + ' points)';
      line.appendChild(tip);
      svg.appendChild(line);
    }
    for (const p of points) {
      const dot = svgEl('circle', { cx: xOf(p.x).toFixed(1), cy: L.yOf(p.y).toFixed(1), r: radius, class: 'icor-sqlv-point' });
      dot.setAttribute('fill', palette[Math.min(p.group, palette.length - 1)]);
      const tip = svgEl('title', {});
      tip.textContent = tile.x + ' ' + formatNumber(p.x) + ' · ' + tile.y[0] + ' ' + formatNumber(p.y) + unit + (groups.length ? ' · ' + p.label : '');
      dot.appendChild(tip);
      svg.appendChild(dot);
    }
  }, extras && extras.observers, guides);
  applyChartColors(chart.box, tile);
}

function renderStatTile(parentEl, table, tile, extras) {
  const { value, captions } = statOf(table, tile);
  const wrap = parentEl.createDiv({ cls: 'icor-sqlv-stat' });
  if (value === null || value === undefined) {
    wrap.createDiv({ cls: 'icor-sqlv-stat-value', text: 'no data' });
    return null;
  }
  const line = wrap.createDiv({ cls: 'icor-sqlv-stat-value' });
  const shown = formatNumber(typeof value === 'string' ? value : Number(value));
  line.createSpan({ text: shown });
  if (tile.unit) line.createSpan({ cls: 'icor-sqlv-stat-unit', text: ' ' + tile.unit });
  /* A size of its own, set on the number itself, beats any theme or
   * snippet rule. */
  if (typeof tile.valueSize === 'number') line.style.setProperty('font-size', tile.valueSize + 'px');
  /* The comparison badge: the triangle points where the number went; the
   * color says whether that direction is good FOR THIS metric. */
  if (extras && extras.ghost && extras.ghost.rows && extras.ghost.rows.length) {
    const prev = extras.ghost.rows[0][0];
    const badge = deltaBadge(value, prev, extras.favorable);
    if (badge) {
      const cls = badge.good === null ? 'is-flat' : (badge.good ? 'is-good' : 'is-bad');
      /* Always on its own line under the number, however long the number. */
      const pill = wrap.createDiv({ cls: 'icor-sqlv-stat-change' }).createSpan({ cls: 'icor-sqlv-delta ' + cls });
      pill.createSpan({ text: (badge.direction === 'up' ? '▲ ' : badge.direction === 'down' ? '▼ ' : '') + badge.label });
      pill.setAttribute('aria-label', 'Compared with the ' + (extras.compare === 'last_year' ? 'same period last year' : 'previous period') + ': ' + badge.label);
      pill.setAttribute('title', 'vs ' + formatNumber(Number(prev)) + (tile.unit ? ' ' + tile.unit : ''));
    }
  }
  /* The meter sits under the number, above the caption lines. */
  if (tile.meter && typeof tile.meter === 'object') renderMeter(wrap, value, tile, extras && extras.pillLevel);
  /* Named caption lines ("captions") are one line each, never wrapped,
   * cut with an ellipsis; the first stays plain (the change line), the
   * rest are a small bulleted list. The one caption of a tile without
   * "captions" keeps its two-line clamp. */
  const named = Array.isArray(tile.captions);
  let list = null;
  const caps = captions.map((text, i) => {
    let cap;
    if (named && i > 0) {
      if (!list) list = wrap.createEl('ul', { cls: 'icor-sqlv-stat-bullets' });
      cap = list.createEl('li', { cls: 'icor-sqlv-stat-caption', text });
      cap.addClass('is-line');
      cap.addClass('is-bullet');
    } else {
      cap = wrap.createDiv({ cls: 'icor-sqlv-stat-caption', text });
      if (named) cap.addClass('is-line');
    }
    cap.setAttribute('title', text);
    return cap;
  });
  /* The level pill closes the tile, bottom right, under everything else. */
  const level = extras && extras.pillLevel;
  if (level && level.known && level.label) {
    const pill = wrap.createDiv({ cls: 'icor-sqlv-stat-foot' }).createSpan({ cls: 'icor-sqlv-level-pill', text: level.label });
    pill.setAttribute('title', level.label);
  }
  const refitCaption = caps.length ? fitStatCaption(wrap, caps.length === 1 && !named ? caps[0] : caps, extras && extras.observers, named) : null;
  if (tile.valueSize === 'fit') fitStatValue(wrap, line, extras && extras.observers, refitCaption);
  return shown + (tile.unit ? ' ' + tile.unit : '');
}

/* The caption is the one part of a stat tile that gives way: it shows two
 * whole lines, then one, then none, until the stat fits its tile, so the
 * tile edge never cuts a line and the number and the pill are never
 * touched. Named caption lines are one line each already, so they only
 * drop, from the last one up. It measures, so it holds at any font size a theme or snippet
 * sets, and it re-fits when the tile resizes. Its observer comes from the
 * tile's own window, like a chart's, and joins `observers` when given.
 * Where there is no layout (no ResizeObserver), the CSS two-line clamp
 * stands alone. */
const STAT_CAPTION_STEPS = ['', 'is-clamped-1', 'is-dropped'];

/* "Shrink to fit": the number starts at the theme's size and gets smaller
 * until it shows whole, never below VALUE_SIZE_MIN. It measures, so it
 * holds at any theme or snippet size, and it re-fits when the tile's width
 * changes; the caption fits after it, since a smaller number leaves the
 * caption more room. Its observer comes from the tile's own window and
 * joins `observers` when given. */
const STAT_VALUE_FALLBACK_PX = 34;

function nextFitSize(size, clientWidth, scrollWidth) {
  if (!(clientWidth > 0) || !(scrollWidth > clientWidth + 1)) return size;
  return Math.max(VALUE_SIZE_MIN, Math.min(size - 1, Math.floor((size * clientWidth) / scrollWidth)));
}

function fitStatValue(statEl, lineEl, observers, after) {
  const fit = () => {
    lineEl.style.removeProperty('font-size');
    const win = lineEl.win;
    const css = win && typeof win.getComputedStyle === 'function' ? win.getComputedStyle(lineEl) : null;
    let size = css ? parseFloat(css.fontSize) : NaN;
    if (!Number.isFinite(size) || size <= 0) size = STAT_VALUE_FALLBACK_PX;
    for (let i = 0; i < 128; i++) {
      const next = nextFitSize(size, lineEl.clientWidth, lineEl.scrollWidth);
      if (next >= size) break;
      size = next;
      lineEl.style.setProperty('font-size', size + 'px');
    }
    if (after) after();
  };
  let lastWidth = -1;
  const observer = resizeObserverFor(statEl, () => {
    if (!statEl.isConnected) { observer.disconnect(); return; }
    if (statEl.clientWidth === lastWidth) return;
    lastWidth = statEl.clientWidth;
    fit();
  });
  if (!observer) return null;
  observer.observe(statEl);
  if (observers) observers.push(observer);
  return fit;
}

function statCaptionSteps(n, oneLine) {
  if (!oneLine) return STAT_CAPTION_STEPS.map((step) => [step]);
  const steps = [Array(n).fill('')];
  for (let dropped = 1; dropped <= n; dropped++) {
    steps.push(Array.from({ length: n }, (_, i) => (i >= n - dropped ? 'is-dropped' : '')));
  }
  return steps;
}

function fitStatCaption(statEl, captionEls, observers, oneLine) {
  const els = Array.isArray(captionEls) ? captionEls : [captionEls];
  const steps = statCaptionSteps(els.length, oneLine);
  const fit = () => {
    for (const step of steps) {
      els.forEach((el, i) => {
        for (const cls of STAT_CAPTION_STEPS) if (cls) el.classList.remove(cls);
        if (step[i]) el.classList.add(step[i]);
      });
      if (statEl.scrollHeight <= statEl.clientHeight + 1) return step;
    }
    return steps[steps.length - 1];
  };
  let lastHeight = -1;
  const observer = resizeObserverFor(statEl, () => {
    if (!statEl.isConnected) { observer.disconnect(); return; }
    if (statEl.clientHeight === lastHeight) return;
    lastHeight = statEl.clientHeight;
    fit();
  });
  if (!observer) return;
  observer.observe(statEl);
  if (observers) observers.push(observer);
  return fit;
}

/* The value level a stat tile's headline number lands on (never the
 * change), or null. With a rangeColumn, the ranges judge that column's
 * number instead; a query without that column draws a neutral tile. */
function statLevelOf(table, tile, extras) {
  const { value } = statOf(table, tile);
  if (value === null || value === undefined) return null;
  if (tile.rangeColumn) {
    const idx = columnIndex(table.columns, tile.rangeColumn);
    if (idx < 0) return null;
    return resolveLevel(table.rows[0][idx], tile, extras && extras.levels);
  }
  return resolveLevel(value, tile, extras && extras.levels);
}

/* Mark a tile with its value level: the look chosen for this widget type
 * in the settings, the colour as one custom property, and the level name
 * as the tile's accessible label so the colour is never the only signal.
 * A level the settings do not know leaves the tile neutral. */
function applyLevel(tileEl, level, kind, tile, extras) {
  if (!level || !level.known) return;
  const look = levelLookFor(kind, extras && extras.levelLooks);
  if (level.color && look) {
    tileEl.addClass('is-level');
    tileEl.addClass('is-level-' + look);
    tileEl.style.setProperty('--sqlv-level-color', level.color);
  }
  tileEl.setAttribute('role', 'group');
  tileEl.setAttribute('aria-label', [tile.title, level.shown, 'level ' + level.name, level.label].filter(Boolean).join(', '));
}

/* The series a table cell holds, for a sparkline: numbers written
 * 3,5,4,8 or [3, 5, 4, 8], split on commas, spaces, semicolons or bars. A
 * word that is not a number is left out. Two numbers make a line; fewer
 * make none (null), and only the last 200 are kept. Pure. */
const SPARK_MAX_POINTS = 200;

function sparkValuesOf(cell) {
  if (cell === null || cell === undefined || typeof cell !== 'string') return null;
  const out = [];
  for (const word of cell.replace(/[[\]]/g, ' ').split(/[\s,;|]+/)) {
    if (!word) continue;
    const n = Number(word);
    if (Number.isFinite(n)) out.push(n);
  }
  return out.length >= 2 ? out.slice(-SPARK_MAX_POINTS) : null;
}

/* One sparkline in a table cell: the series as a line on its own scale,
 * lowest to highest, with a dot on the last value. */
const SPARK_W = 80;
const SPARK_H = 20;

function drawSpark(td, values) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = 2.5;
  const xOf = (i) => pad + (i / (values.length - 1)) * (SPARK_W - 2 * pad);
  const yOf = (v) => (hi === lo ? SPARK_H / 2 : SPARK_H - pad - ((v - lo) / (hi - lo)) * (SPARK_H - 2 * pad));
  const said = 'Trend of ' + values.length + ' values, from ' + formatNumber(values[0]) + ' to ' + formatNumber(values[values.length - 1]) + ', lowest ' + formatNumber(lo) + ', highest ' + formatNumber(hi);
  const svg = svgEl('svg', { viewBox: '0 0 ' + SPARK_W + ' ' + SPARK_H, width: SPARK_W, height: SPARK_H, class: 'icor-sqlv-spark', role: 'img', 'aria-label': said });
  const tip = svgEl('title', {});
  tip.textContent = said;
  svg.appendChild(tip);
  svg.appendChild(svgEl('polyline', { points: values.map((v, i) => xOf(i).toFixed(1) + ',' + yOf(v).toFixed(1)).join(' '), class: 'icor-sqlv-spark-line' }));
  svg.appendChild(svgEl('circle', { cx: xOf(values.length - 1).toFixed(1), cy: yOf(values[values.length - 1]).toFixed(1), r: 2, class: 'icor-sqlv-spark-end' }));
  td.appendChild(svg);
}

function renderResultTable(parentEl, table, { maxRows, sparklines } = {}) {
  const cap = maxRows || 200;
  const sparks = new Set(Array.isArray(sparklines) ? sparklines : []);
  /* The tile body that holds a table is the container the narrow-table rules measure. */
  parentEl.addClass('icor-sqlv-has-table-scroll');
  const scroller = parentEl.createDiv({ cls: 'icor-sqlv-table-scroll' });
  const t = scroller.createEl('table', { cls: 'icor-sqlv-table' });
  /* On a narrow screen the table scrolls sideways and a trend column at
   * the right would be out of sight, so the last sparkline column stays
   * pinned to the right edge while the other columns scroll under it. */
  let pinned = -1;
  table.columns.forEach((c, i) => { if (sparks.has(c)) pinned = i; });
  const head = t.createEl('thead').createEl('tr');
  table.columns.forEach((col, i) => { const th = head.createEl('th', { text: col, cls: i === pinned ? 'icor-sqlv-pinned' : '' }); th.setAttribute('lang', 'en'); });
  const body = t.createEl('tbody');
  for (const row of table.rows.slice(0, cap)) {
    const tr = body.createEl('tr');
    row.forEach((v, i) => {
      const series = sparks.has(table.columns[i]) ? sparkValuesOf(v) : null;
      const td = tr.createEl('td', { text: series ? '' : (v === null || v === undefined ? '' : String(v)) });
      if (series) { td.addClass('icor-sqlv-spark-cell'); drawSpark(td, series); }
      else if (typeof v === 'string' && v.length > 8) td.setAttribute('title', v);
      else if (typeof v === 'number') td.addClass('icor-sqlv-num');
      if (i === pinned) td.addClass('icor-sqlv-pinned');
    });
  }
  if (table.rows.length > cap) {
    parentEl.createDiv({ cls: 'icor-sqlv-note', text: 'Showing the first ' + cap + ' of ' + table.rows.length + ' rows.' });
  }
  return scroller;
}

/* A text widget: words on the dashboard, no chart. Either "text" written
 * in the tile, or "sql" whose first row's first column is the text, so a
 * sentence can carry live numbers. Plain text: a blank line starts a new
 * paragraph, a single line break stays. "line": true makes it one thin
 * line that sits in a thin row like a section divider (its "layout" h is
 * then 1). Returns { ok, tile } or { ok, reason }. */
const TEXT_MAX = 2000;

/* The widget types the edit form can build. */
const FORM_VIZ = new Set(['line', 'bar', 'stat', 'table', 'divider', 'text', 'segments', 'pie', 'heatmap', 'calendar', 'combo', 'scatter', 'bullet']);

function checkTextTile(t, layout, at) {
  const hasText = t.text !== undefined;
  const hasSql = t.sql !== undefined;
  if (t.source !== undefined) return { ok: false, reason: at + ': a text widget shows "text" or the result of its "sql"; it takes no "source".' };
  if (hasText === hasSql) return { ok: false, reason: at + ': a text widget needs either "text" (written in the tile) or "sql" (its first column is the text), not both.' };
  if (hasText && (typeof t.text !== 'string' || !t.text.trim() || t.text.length > TEXT_MAX)) {
    return { ok: false, reason: at + ': "text" must be text, up to ' + TEXT_MAX + ' characters.' };
  }
  if (hasSql) {
    if (typeof t.sql !== 'string' || !t.sql.trim()) return { ok: false, reason: at + ' needs an "sql" query or "text".' };
    const gate = gateStatement(t.sql);
    if (!gate.ok) return { ok: false, reason: at + ': ' + gate.reason };
  }
  if (t.line !== undefined && typeof t.line !== 'boolean') return { ok: false, reason: at + ': "line" must be true or false.' };
  if (t.title !== undefined && typeof t.title !== 'string') return { ok: false, reason: at + ': the "title" of a text widget must be text.' };
  if (t.line === true && layout && layout.h !== 1) return { ok: false, reason: at + ': a text line is one thin row, so its "layout" h must be 1.' };
  const tile = { title: typeof t.title === 'string' ? t.title : '', viz: 'text' };
  if (hasText) tile.text = t.text;
  else tile.sql = t.sql;
  if (t.line === true) tile.line = true;
  return { ok: true, tile };
}

/* A widget that sits in a thin row: a section divider, or a text line. */
function isThinTile(tile) {
  return !!tile && (tile.viz === 'divider' || (tile.viz === 'text' && tile.line === true));
}

/* A widget that has nothing to query, on any device. */
function drawsNoData(tile) {
  return !!tile && (tile.viz === 'divider' || (tile.viz === 'text' && typeof tile.text === 'string'));
}

/* The words of a text widget: its own text, or the first column of the
 * query's first row. */
function textOf(tile, table) {
  if (typeof tile.text === 'string') return tile.text;
  const row = table && table.rows && table.rows[0];
  const v = row ? row[0] : null;
  return v === null || v === undefined ? '' : String(v);
}

function renderText(tileEl, tile, table) {
  const text = textOf(tile, table).trim();
  if (tile.line === true) {
    const line = tileEl.createDiv({ cls: 'icor-sqlv-text-line', text: text.replace(/\s+/g, ' ') });
    line.setAttribute('title', text);
    return line;
  }
  if (tile.title) tileEl.createDiv({ cls: 'icor-sqlv-tile-title', text: tile.title }).setAttribute('title', tile.title);
  const body = tileEl.createDiv({ cls: 'icor-sqlv-tile-body icor-sqlv-text' });
  if (!text) { body.createDiv({ cls: 'icor-sqlv-empty', text: 'No text to show.' }); return body; }
  for (const para of text.split(/\n\s*\n/)) {
    const p = body.createEl('p', { cls: 'icor-sqlv-text-para' });
    para.split('\n').forEach((ln, i) => {
      if (i > 0) p.createEl('br');
      p.createSpan({ text: ln });
    });
  }
  return body;
}

/* A section divider: a line through the heading's vertical centre, with a
 * real gap around the heading (never a filled background), starting a
 * short stretch in from the left edge. Without a heading, just the line. */
function renderDivider(parentEl, heading) {
  const text = typeof heading === 'string' ? heading.trim() : '';
  const rule = parentEl.createDiv({ cls: 'icor-sqlv-divider' + (text ? ' has-heading' : '') });
  rule.setAttribute('role', 'separator');
  if (text) {
    rule.setAttribute('aria-label', text);
    rule.createSpan({ cls: 'icor-sqlv-divider-heading', text }).setAttribute('title', text);
  }
  return rule;
}

function renderTile(tileEl, tileSpec, table, extras) {
  drawTile(tileEl, tileSpec, table, extras);
  addTileNotes(tileEl, tileSpec);
}

function drawTile(tileEl, tileSpec, table, extras) {
  if (tileSpec.viz === 'divider') { renderDivider(tileEl, tileSpec.title); return; }
  if (tileSpec.viz === 'text') { renderText(tileEl, tileSpec, table); return; }
  if (tileSpec.viz === 'stat') {
    /* Top to bottom: the title (its own full row, one line), the number,
     * the change line, and the level pill in a footer at the bottom right.
     * Only the change line gives way when space runs short. */
    const level = statLevelOf(table, tileSpec, extras);
    if (tileSpec.title) {
      const title = tileEl.createDiv({ cls: 'icor-sqlv-tile-title', text: tileSpec.title });
      title.setAttribute('title', tileSpec.title);
    }
    const body = tileEl.createDiv({ cls: 'icor-sqlv-tile-body' });
    const shown = renderStatTile(body, table, tileSpec, Object.assign({}, extras, { pillLevel: level }));
    applyLevel(tileEl, level && shown ? Object.assign({ shown }, level) : null, 'stat', tileSpec, extras);
    return;
  }
  if (isPartsViz(tileSpec.viz)) {
    /* Like a stat: the level marks the whole widget. Its pill sits at the
     * right of the title row, the title giving way first. A pie chart has
     * the same parts and the same level as a segments bar. */
    const level = segmentsLevelOf(table, tileSpec, extras);
    const pill = level && level.known && level.label ? level.label : '';
    const row = pill ? tileEl.createDiv({ cls: 'icor-sqlv-tile-titlebar' }) : tileEl;
    if (tileSpec.title) row.createDiv({ cls: 'icor-sqlv-tile-title', text: tileSpec.title }).setAttribute('title', tileSpec.title);
    if (pill) row.createSpan({ cls: 'icor-sqlv-level-pill', text: pill }).setAttribute('title', pill);
    const segBody = tileEl.createDiv({ cls: 'icor-sqlv-tile-body' });
    const shown = tileSpec.viz === 'pie' ? renderPie(segBody, table, tileSpec, extras) : renderSegments(segBody, table, tileSpec, extras);
    applyLevel(tileEl, level && shown ? Object.assign({ shown }, level) : null, 'segments', tileSpec, extras);
    return;
  }
  /* A chart may show its change over the period at the right of its
   * title row; the title ellipsizes before the change gives way. */
  const delta = tileSpec.headerDelta === true && (tileSpec.viz === 'line' || tileSpec.viz === 'bar') ? headerDeltaOf(table, tileSpec) : null;
  /* A roll-up ("chartCaption") sits in the same right corner, after the
   * change when there is one, on one line. Like the change, it stays
   * whole and the title ellipsizes first; hovering shows it all. */
  const rollup = chartCaptionOf(table, tileSpec);
  if (rollup) {
    const bar = tileEl.createDiv({ cls: 'icor-sqlv-tile-titlebar has-rollup' });
    if (tileSpec.title) bar.createDiv({ cls: 'icor-sqlv-tile-title', text: tileSpec.title }).setAttribute('title', tileSpec.title);
    const parts = [];
    if (delta && tileSpec.chartCaption !== 'change') parts.push(delta);
    parts.push(rollup);
    const text = parts.map((p) => p.text).join(' \u00b7 ');
    const hover = parts.map((p) => p.hover).join('\n');
    const chip = bar.createSpan({ cls: 'icor-sqlv-head-rollup', text });
    chip.setAttribute('title', hover);
    chip.setAttribute('aria-label', text + '. ' + parts.map((p) => p.hover).join('. '));
  } else if (delta) {
    const bar = tileEl.createDiv({ cls: 'icor-sqlv-tile-titlebar' });
    if (tileSpec.title) bar.createDiv({ cls: 'icor-sqlv-tile-title', text: tileSpec.title }).setAttribute('title', tileSpec.title);
    const chip = bar.createSpan({ cls: 'icor-sqlv-head-delta is-' + delta.direction, text: delta.text });
    chip.setAttribute('title', delta.hover);
    chip.setAttribute('aria-label', 'Change over the period: ' + delta.text + '. ' + delta.hover);
  } else if (tileSpec.title) {
    const title = tileEl.createDiv({ cls: 'icor-sqlv-tile-title', text: tileSpec.title });
    title.setAttribute('title', tileSpec.title);
  }
  const body = tileEl.createDiv({ cls: 'icor-sqlv-tile-body' });
  if (tileSpec.viz === 'line') renderLineChart(body, table, tileSpec, extras);
  else if (tileSpec.viz === 'bar') renderBarChart(body, table, tileSpec, extras);
  else if (tileSpec.viz === 'combo') renderComboChart(body, table, tileSpec, extras);
  else if (tileSpec.viz === 'scatter') renderScatterChart(body, table, tileSpec, extras);
  else if (tileSpec.viz === 'heatmap') renderHeatmap(body, table, tileSpec, extras);
  else if (tileSpec.viz === 'calendar') renderCalendar(body, table, tileSpec, extras);
  else if (tileSpec.viz === 'bullet') renderBullet(body, table, tileSpec, extras);
  else renderResultTable(body, table, { maxRows: 50, sparklines: tileSpec.sparklines });
}

/* ---------------------------------------------------- the browser view -- */

class SqliteBrowserView extends FileView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.allowNoFile = true;
    this.navigation = true;
    this.dbPath = null;
    this.tables = [];
    this.counts = new Map();
    this.unreadable = new Set();
    this.active = null;
    this.tab = 'data';
    this.page = 0;
    this.sortCol = null;
    this.sortDir = 'asc';
    this.filters = {};
    this.filtersVisible = false;
    this.focusFilters = false;
    this.funnelEl = null;
    this.consoleSql = '';
    this.consoleResult = null;
    this.engineInfo = null;
  }

  getViewType() { return VIEW_BROWSER; }
  getIcon() { return 'database'; }
  getDisplayText() { return this.file ? this.file.name : 'SQLite browser'; }
  canAcceptExtension(ext) { return DB_EXTS.has(String(ext).toLowerCase()); }

  async onLoadFile(file) {
    await this.setDatabase(file.path);
  }

  async onUnloadFile() {
    this.dbPath = null;
    this.tables = [];
    this.counts.clear();
    this.unreadable.clear();
    this.active = null;
  }

  async setDatabase(dbPath) {
    this.dbPath = dbPath;
    this.plugin.noteIfOutsideFolder(dbPath, (to) => { this.setDatabase(to); });
    this.tables = [];
    this.counts.clear();
    this.unreadable.clear();
    this.active = null;
    this.page = 0;
    this.sortCol = null;
    this.filters = {};
    this.consoleResult = null;
    this.engineInfo = await this.plugin.query.engineFor(dbPath);
    if (this.engineInfo.engine) {
      try {
        const res = await this.plugin.query.query(dbPath,
          "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name");
        this.tables = res.rows.map(([name, type]) => ({ name, type }));
        if (this.tables.length) this.active = this.tables[0].name;
      } catch (e) {
        this.engineInfo = { engine: null, reason: e.message };
      }
    }
    this.render();
    this.fillCounts();
  }

  async fillCounts() {
    const dbPath = this.dbPath;
    for (const t of this.tables) {
      if (this.dbPath !== dbPath) return;
      if (this.counts.has(t.name)) continue;
      try {
        const res = await this.plugin.query.query(dbPath, buildCountQuery(t.name));
        this.counts.set(t.name, res.rows.length ? Number(res.rows[0][0]) : 0);
      } catch (e) {
        this.counts.set(t.name, null);
        if (isMissingModuleError(e)) this.unreadable.add(t.name);
      }
      this.renderRailCounts();
    }
  }

  async onOpen() {
    this.render();
  }

  render() {
    const root = this.contentEl;
    root.empty();
    this.guideUi = null;
    root.addClass('icor-sqlv-root');
    /* INKLINE's plugin-owned control boundary: inside a subtree carrying
     * data-ink-plugin the theme's element-level input and button skins
     * stand down, and this plugin owns its own controls. Other themes see
     * the explicit resets in styles.css. */
    root.setAttribute('data-ink-plugin', 'icor-for-life-sqlite-viewer');

    if (!this.dbPath) {
      const empty = root.createDiv({ cls: 'icor-sqlv-blank' });
      empty.createDiv({ text: 'Open a database to browse it.' });
      const btn = empty.createEl('button', { text: 'List the databases in this vault' });
      btn.addEventListener('click', () => new DatabaseIndexModal(this.plugin, (path) => this.openDb(path)).open());
      return;
    }

    const header = root.createDiv({ cls: 'icor-sqlv-header' });
    header.createSpan({ cls: 'icor-sqlv-header-name', text: baseName(this.dbPath) });
    const sub = [];
    if (this.engineInfo && this.engineInfo.size !== undefined) sub.push(formatBytes(this.engineInfo.size));
    if (this.engineInfo && this.engineInfo.engine === 'wasm') sub.push('read-only, in memory');
    header.createSpan({ cls: 'icor-sqlv-header-sub', text: sub.join(' · ') });

    if (!this.engineInfo || !this.engineInfo.engine) {
      const info = this.engineInfo;
      root.createDiv({ cls: info && info.tooBig ? 'icor-sqlv-note' : 'icor-sqlv-error', text: (info && info.reason) || 'This database cannot be opened here.' });
      return;
    }

    const split = root.createDiv({ cls: 'icor-sqlv-split' });
    this.railEl = split.createDiv({ cls: 'icor-sqlv-rail' });
    this.mainEl = split.createDiv({ cls: 'icor-sqlv-main' });
    this.renderRail();
    this.renderMain();
  }

  renderRail() {
    const rail = this.railEl;
    rail.empty();
    rail.createDiv({ cls: 'icor-sqlv-rail-heading', text: 'Tables' });
    this.rowEls = new Map();
    for (const t of this.tables) {
      const row = rail.createDiv({ cls: 'icor-sqlv-rail-row' + (t.name === this.active ? ' is-active' : '') });
      row.createSpan({ cls: 'icor-sqlv-rail-name', text: t.name + (t.type === 'view' ? ' (view)' : '') });
      const count = row.createSpan({ cls: 'icor-sqlv-rail-count', text: this.countLabel(t.name) });
      this.rowEls.set(t.name, count);
      if (this.unreadable.has(t.name)) row.setAttribute('title', UNREADABLE_TABLE_NOTE);
      row.addEventListener('click', () => {
        this.active = t.name;
        this.page = 0;
        this.sortCol = null;
        this.filters = {};
        this.renderRail();
        this.renderMain();
      });
    }
    if (!this.tables.length) rail.createDiv({ cls: 'icor-sqlv-note', text: 'No tables.' });

    rail.createDiv({ cls: 'icor-sqlv-rail-heading', text: 'Databases in this vault' });
    for (const db of this.plugin.vaultDatabases()) {
      const row = rail.createDiv({ cls: 'icor-sqlv-rail-row' + (db.path === this.dbPath ? ' is-active' : '') });
      row.createSpan({ cls: 'icor-sqlv-rail-name', text: db.path });
      row.createSpan({ cls: 'icor-sqlv-rail-count', text: formatBytes(db.size) });
      if (db.path !== this.dbPath) row.addEventListener('click', () => this.openDb(db.path));
    }
  }

  countLabel(name) {
    if (!this.counts.has(name)) return '…';
    const n = this.counts.get(name);
    if (n === null) return this.unreadable.has(name) ? '–' : '?';
    return formatNumber(n);
  }

  renderRailCounts() {
    if (!this.rowEls) return;
    for (const [name, el] of this.rowEls) {
      el.setText(this.countLabel(name));
      if (this.unreadable.has(name) && el.parentElement) el.parentElement.setAttribute('title', UNREADABLE_TABLE_NOTE);
    }
  }

  async openDb(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.leaf.openFile(file);
    else await this.setDatabase(path);
  }

  hasActiveFilters() {
    return Object.values(this.filters || {}).some((v) => v !== '' && v !== null && v !== undefined);
  }

  /* Keep the funnel's dot honest after a filter changes without redrawing
   * the whole tab bar. */
  renderFunnelState() {
    if (!this.funnelEl) return;
    if (this.hasActiveFilters()) this.funnelEl.classList.add('has-filters');
    else this.funnelEl.classList.remove('has-filters');
  }

  renderMain() {
    const main = this.mainEl;
    main.empty();
    const tabs = main.createDiv({ cls: 'icor-sqlv-tabs' });
    for (const [id, label] of [['data', 'Data'], ['schema', 'Schema'], ['sql', 'SQL console']]) {
      const b = tabs.createEl('button', { text: label, cls: this.tab === id ? 'is-active' : '' });
      b.addEventListener('click', () => { this.tab = id; this.renderMain(); });
    }
    if (this.tab === 'data') {
      /* The funnel: filters live behind it, so the table at rest is just a
       * header and its rows. An accent dot says filters are active even
       * while the row is hidden, so a hidden filter never hides data
       * silently. */
      tabs.createDiv({ cls: 'icor-sqlv-tabs-spacer' });
      const funnel = tabs.createEl('button', { cls: 'icor-sqlv-funnel' + (this.hasActiveFilters() ? ' has-filters' : '') });
      this.funnelEl = funnel;
      setIcon(funnel, 'filter');
      funnel.setAttribute('aria-label', this.filtersVisible ? 'Hide the filter row' : 'Show the filter row');
      funnel.setAttribute('title', (this.filtersVisible ? 'Hide filters' : 'Filter columns') + (this.hasActiveFilters() ? ' (filters are active)' : ''));
      funnel.setAttribute('aria-pressed', this.filtersVisible ? 'true' : 'false');
      funnel.addEventListener('click', () => {
        this.filtersVisible = !this.filtersVisible;
        this.focusFilters = this.filtersVisible;
        this.renderMain();
      });
    }
    this.bodyEl = main.createDiv({ cls: 'icor-sqlv-body' });
    if (this.tab === 'data') this.renderData();
    else if (this.tab === 'schema') this.renderSchema();
    else this.renderConsole();
  }

  async renderData() {
    const body = this.bodyEl;
    body.empty();
    if (!this.active) { body.createDiv({ cls: 'icor-sqlv-note', text: 'No table selected.' }); return; }
    const pageSize = this.plugin.settings.pageSize;
    const sql = buildBrowseQuery(this.active, {
      filters: this.filters, sortCol: this.sortCol, sortDir: this.sortDir,
      limit: pageSize, offset: this.page * pageSize,
    });
    let res;
    try {
      res = await this.plugin.query.query(this.dbPath, sql);
    } catch (e) {
      body.createDiv({ cls: isMissingModuleError(e) ? 'icor-sqlv-note' : 'icor-sqlv-error', text: friendlyTableError(e) });
      return;
    }
    if (this.tab !== 'data') return;
    body.empty();

    const scroller = body.createDiv({ cls: 'icor-sqlv-table-scroll icor-sqlv-grow' });
    const t = scroller.createEl('table', { cls: 'icor-sqlv-table' });
    const thead = t.createEl('thead');
    const headRow = thead.createEl('tr');
    for (const col of res.columns) {
      const th = headRow.createEl('th');
      const btn = th.createEl('button', { cls: 'icor-sqlv-sort' });
      btn.createSpan({ cls: 'icor-sqlv-sort-label' + (this.sortCol === col ? ' is-sorted' : ''), text: col });
      if (this.sortCol === col) btn.createSpan({ cls: 'icor-sqlv-sort-mark', text: this.sortDir === 'asc' ? '▴' : '▾' });
      btn.setAttribute('aria-label', 'Sort by ' + col);
      /* The full name survives a narrow column. */
      btn.setAttribute('title', col);
      btn.addEventListener('click', () => {
        if (this.sortCol === col) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
        else { this.sortCol = col; this.sortDir = 'asc'; }
        this.page = 0;
        this.renderData();
      });
    }
    if (this.filtersVisible) {
      const filterRow = thead.createEl('tr', { cls: 'icor-sqlv-filter-row' });
      let firstInput = null;
      for (const col of res.columns) {
        const th = filterRow.createEl('th');
        const input = th.createEl('input', { type: 'text', cls: 'icor-sqlv-filter', value: this.filters[col] || '' });
        if (!firstInput) firstInput = input;
        input.setAttribute('placeholder', 'filter');
        input.setAttribute('aria-label', 'Filter ' + col);
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') {
            this.filters[col] = input.value.trim();
            this.page = 0;
            this.renderData();
            this.renderFunnelState();
          }
        });
      }
      if (this.focusFilters && firstInput && typeof firstInput.focus === 'function') {
        this.focusFilters = false;
        firstInput.focus();
      }
    }
    const tbody = t.createEl('tbody');
    for (const row of res.rows) {
      const tr = tbody.createEl('tr');
      row.forEach((v) => {
        const td = tr.createEl('td', { text: v === null || v === undefined ? '' : String(v) });
        if (typeof v === 'number') td.addClass('icor-sqlv-num');
      });
    }
    if (!res.rows.length) body.createDiv({ cls: 'icor-sqlv-note', text: 'No rows match.' });

    const pager = body.createDiv({ cls: 'icor-sqlv-pager' });
    const prev = pager.createEl('button', { text: 'Previous' });
    prev.disabled = this.page === 0;
    prev.addEventListener('click', () => { this.page = Math.max(0, this.page - 1); this.renderData(); });
    const info = pager.createSpan({ cls: 'icor-sqlv-pager-info', text: 'Rows ' + (this.page * pageSize + 1) + ' to ' + (this.page * pageSize + res.rows.length) });
    const next = pager.createEl('button', { text: 'Next' });
    next.disabled = res.rows.length < pageSize;
    next.addEventListener('click', () => { this.page += 1; this.renderData(); });
    if (Object.values(this.filters).some((v) => v)) {
      const clear = pager.createEl('button', { text: 'Clear filters' });
      clear.addEventListener('click', () => { this.filters = {}; this.page = 0; this.renderData(); this.renderFunnelState(); });
    }
    /* Total, filled in when the count comes back. */
    this.plugin.query.query(this.dbPath, buildCountQuery(this.active, { filters: this.filters }))
      .then((c) => {
        if (this.tab !== 'data' || !c.rows.length) return;
        info.setText('Rows ' + (this.page * pageSize + (res.rows.length ? 1 : 0)) + ' to ' + (this.page * pageSize + res.rows.length) + ' of ' + formatNumber(Number(c.rows[0][0])));
      })
      .catch(() => { /* the page already shows without a total */ });
  }

  async renderSchema() {
    const body = this.bodyEl;
    body.empty();
    if (!this.active) { body.createDiv({ cls: 'icor-sqlv-note', text: 'No table selected.' }); return; }
    try {
      const cols = await this.plugin.query.query(this.dbPath, 'PRAGMA table_info(' + quoteIdent(this.active) + ')');
      body.createDiv({ cls: 'icor-sqlv-section-title', text: 'Columns of ' + this.active });
      renderResultTable(body, cols, { maxRows: 500 });
      const idx = await this.plugin.query.query(this.dbPath, 'PRAGMA index_list(' + quoteIdent(this.active) + ')');
      if (idx.rows.length) {
        body.createDiv({ cls: 'icor-sqlv-section-title', text: 'Indexes' });
        const nameIdx = columnIndex(idx.columns, 'name');
        const uniqueIdx = columnIndex(idx.columns, 'unique');
        const listing = { columns: ['index', 'columns', 'unique'], rows: [] };
        for (const row of idx.rows) {
          const indexName = row[nameIdx];
          const info = await this.plugin.query.query(this.dbPath, 'PRAGMA index_info(' + quoteIdent(indexName) + ')');
          const colNameIdx = columnIndex(info.columns, 'name');
          listing.rows.push([indexName, info.rows.map((r) => r[colNameIdx]).join(', '), row[uniqueIdx] ? 'yes' : 'no']);
        }
        renderResultTable(body, listing, { maxRows: 200 });
      }
    } catch (e) {
      body.empty();
      body.createDiv({ cls: isMissingModuleError(e) ? 'icor-sqlv-note' : 'icor-sqlv-error', text: friendlyTableError(e) });
    }
  }

  renderConsole() {
    const body = this.bodyEl;
    body.empty();
    const intro = body.createDiv({ cls: 'icor-sqlv-note' });
    intro.setText('Read-only SQL. One statement, starting with SELECT, WITH, PRAGMA or EXPLAIN. A SELECT with no LIMIT gets one of ' + this.plugin.settings.rowCap + ' rows.');
    const area = body.createEl('textarea', { cls: 'icor-sqlv-console' });
    area.value = this.consoleSql;
    area.setAttribute('rows', '5');
    area.setAttribute('placeholder', "SELECT * FROM " + (this.active ? quoteIdent(this.active) : 'my_table') + ' LIMIT 20');
    area.setAttribute('aria-label', 'SQL query');
    const bar = body.createDiv({ cls: 'icor-sqlv-console-bar' });
    const run = bar.createEl('button', { text: 'Run', cls: 'mod-cta' });
    const hint = bar.createSpan({ cls: 'icor-sqlv-note', text: Platform.isMacOS ? 'Cmd+Enter runs it' : 'Ctrl+Enter runs it' });
    const out = body.createDiv({ cls: 'icor-sqlv-console-out icor-sqlv-grow' });

    const execute = async () => {
      this.consoleSql = area.value;
      out.empty();
      run.disabled = true;
      try {
        const res = await this.plugin.query.query(this.dbPath, area.value, { cap: this.plugin.settings.rowCap });
        this.consoleResult = res;
        const meta = out.createDiv({ cls: 'icor-sqlv-console-meta' });
        meta.createSpan({ text: formatNumber(res.rows.length) + (res.rows.length === 1 ? ' row' : ' rows') + ' in ' + res.ms + ' ms' + (res.capped ? ', capped at ' + this.plugin.settings.rowCap : '') });
        const save = meta.createEl('button', { text: 'Save as CSV' });
        save.setAttribute('aria-label', 'Save this result as a CSV file in the vault');
        save.addEventListener('click', async () => {
          try { await this.plugin.saveCsv(this.dbPath, res); } catch (e) { new Notice('Could not save the CSV: ' + e.message); }
        });
        renderResultTable(out, res, { maxRows: this.plugin.settings.rowCap });
      } catch (e) {
        this.consoleResult = null;
        out.createDiv({ cls: 'icor-sqlv-error', text: e.message });
      }
      run.disabled = false;
    };
    run.addEventListener('click', execute);
    area.addEventListener('keydown', (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { ev.preventDefault(); execute(); }
    });
    if (this.consoleResult) {
      const res = this.consoleResult;
      const meta = out.createDiv({ cls: 'icor-sqlv-console-meta' });
      meta.createSpan({ text: formatNumber(res.rows.length) + (res.rows.length === 1 ? ' row' : ' rows') + ' in ' + res.ms + ' ms' });
      renderResultTable(out, res, { maxRows: this.plugin.settings.rowCap });
    }
  }
}

/* -------------------------------------------------- the dashboards view -- */

/* The text each loaded dashboard spec was read from, or last saved as.
 * A save checks the file against it, and the view tells its own save's
 * echo from a change made somewhere else. Keyed by the spec object, so a
 * spec held by an open form keeps the text it was read from. */
const DASHBOARD_LOADED_TEXT = new WeakMap();

class SqliteDashboardsView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = true;
    this.specs = [];
    this.errors = [];
    this.activeId = null;
    this.editMode = false;
    this.gridState = null;
    this.gridRO = null;
    /* Every chart tile's ResizeObserver, disconnected on redraw and close. */
    this.tileROs = [];
    this.dragging = false;
    this.reloadPending = false;
  }

  getViewType() { return VIEW_DASHBOARDS; }
  getIcon() { return 'bar-chart-3'; }
  getDisplayText() { return 'Dashboards'; }

  /* The dashboard shown rides the view state, like any Obsidian view option,
   * so a pane that is restored, or reached by Back or Forward, shows the
   * dashboard it was showing. */
  getState() {
    const state = super.getState ? super.getState() : {};
    if (this.activeId) state.activeId = this.activeId;
    return state;
  }

  async setState(state, result) {
    if (state && typeof state.activeId === 'string' && state.activeId) {
      this.activeId = state.activeId;
      if (this.specs.length && this.specs.some((sp) => sp.id === this.activeId)) this.render();
    }
    if (super.setState) await super.setState(state, result);
  }

  /* The pane's "More options" menu: the open dashboard's file as text,
   * for any setting the edit form has no field for. */
  onPaneMenu(menu, source) {
    if (super.onPaneMenu) super.onPaneMenu(menu, source);
    const spec = this.specs.find((s) => s.id === this.activeId);
    if (!spec || !spec.path) return;
    menu.addItem((item) => {
      item.setTitle('Open as text');
      item.setIcon('file-code');
      item.onClick(() => this.plugin.openDashboardAsText(spec.path, this.leaf));
    });
  }

  async onOpen() {
    /* A dashboard file changed on disk (an edit as text in another pane,
     * or one that arrived through Sync): show it, rather than keep a spec
     * the next save would write over it. The gates' fake vaults have no
     * events. */
    const vault = this.app.vault;
    if (vault && typeof vault.on === 'function') {
      this.registerEvent(vault.on('modify', (file) => { this.onDashboardFileChanged(file).catch(() => {}); }));
      /* The guide button follows the two guide files: gone, renamed or moved
       * and it is active again. Registered with the view, so Obsidian
       * removes the listeners when the view closes. */
      const guideChanged = (file, oldPath) => { this.onGuidePathChanged(file, oldPath); };
      this.registerEvent(vault.on('create', guideChanged));
      this.registerEvent(vault.on('delete', guideChanged));
      this.registerEvent(vault.on('rename', guideChanged));
    }
    try {
      await this.reload();
    } catch (e) {
      this.showFailure(e);
    }
  }

  /* True when a vault event could change whether the two guide files are
   * there: one of them, or the folder holding them (or a folder above it). */
  guidePathMatters(path) {
    if (typeof path !== 'string') return false;
    const folder = this.plugin.settings.dashboardFolder;
    if (path === folder || folder.startsWith(path + '/')) return true;
    return GUIDE_FILES.some((g) => path === folder + '/' + g.file);
  }

  onGuidePathChanged(file, oldPath) {
    if (!this.guideUi) return;
    if (this.guidePathMatters(file && file.path) || this.guidePathMatters(oldPath)) this.refreshGuideButton().catch(() => {});
  }

  /* Both guide files in the dashboards folder: the button is greyed out and
   * says why; if either is missing it is active again. The latest check wins. */
  async refreshGuideButton() {
    const ui = this.guideUi;
    if (!ui) return;
    const seq = (this.guideSeq = (this.guideSeq || 0) + 1);
    const folder = this.plugin.settings.dashboardFolder;
    const adapter = this.app.vault.adapter;
    let done = true;
    for (const g of GUIDE_FILES) {
      try { if (!(await adapter.exists(folder + '/' + g.file))) done = false; } catch (e) { done = false; }
    }
    if (seq !== this.guideSeq || this.guideUi !== ui) return;
    ui.button.disabled = done;
    ui.note.empty();
    if (done) {
      ui.note.createDiv({ text: 'Guide files are in ' + folder });
      const open = ui.note.createEl('button', { text: 'Open the AI guide' });
      open.addEventListener('click', () => this.plugin.openGuideFile('AI-WIDGET-GUIDE.md'));
    }
  }

  async onDashboardFileChanged(file) {
    const path = file && file.path;
    if (typeof path !== 'string') return;
    const spec = this.specs.find((s) => s.path === path);
    if (!spec && !this.errors.some((e) => e.path === path)) return;
    if (spec) {
      let text;
      try { text = await this.app.vault.adapter.read(path); } catch (e) { return; }
      if (this.plugin.dashboardTextIsLoaded(spec, text)) return;
    }
    /* Mid-drag the drop's save finds the change and reloads; a cancelled
     * drag reloads here. */
    if (this.dragging) { this.reloadPending = true; return; }
    await this.reload();
  }

  async reload() {
    this.reloadPending = false;
    const { specs, errors } = await this.plugin.loadDashboardSpecs();
    this.specs = specs;
    this.errors = errors;
    if (!this.activeId || !this.specs.some((s) => s.id === this.activeId)) {
      this.activeId = this.specs.length ? this.specs[0].id : null;
    }
    this.render();
  }

  /* A dashboard is never allowed to fail into a blank pane. Whatever went
   * wrong is written into the view, in plain words plus the raw detail. */
  showFailure(e, host) {
    const el = (host || this.contentEl).createDiv({ cls: 'icor-sqlv-error' });
    el.createDiv({ text: 'The dashboards could not be drawn. This is a plugin problem, not a data problem.' });
    el.createDiv({ text: String((e && e.message) || e) });
    if (e && e.stack) el.createDiv({ cls: 'icor-sqlv-error-detail', text: String(e.stack).split('\n').slice(0, 4).join('\n') });
    console.error(safeLogLine('dashboards failed to render', e));
  }

  async saveAndRender(spec) {
    if (!(await this.plugin.saveDashboardSpec(spec))) { await this.reload(); return; }
    this.render();
  }

  render() {
    const root = this.contentEl;
    this.releaseTileObservers();
    root.empty();
    root.addClass('icor-sqlv-root');
    /* INKLINE's plugin-owned control boundary: inside a subtree carrying
     * data-ink-plugin the theme's element-level input and button skins
     * stand down, and this plugin owns its own controls. Other themes see
     * the explicit resets in styles.css. */
    root.setAttribute('data-ink-plugin', 'icor-for-life-sqlite-viewer');
    const bar = root.createDiv({ cls: 'icor-sqlv-dash-bar' });
    if (this.specs.length) {
      const select = bar.createEl('select', { cls: 'dropdown' });
      select.setAttribute('aria-label', 'Dashboard');
      for (const spec of this.specs) {
        const opt = select.createEl('option', { text: spec.title });
        opt.value = spec.id;
        if (spec.id === this.activeId) opt.selected = true;
      }
      select.addEventListener('change', () => { this.activeId = select.value; this.render(); });
    }
    const newBtn = bar.createEl('button', { text: 'New dashboard' });
    newBtn.addEventListener('click', async () => {
      const spec = await this.plugin.createDashboard();
      this.activeId = spec.id;
      await this.reload();
    });
    const refresh = bar.createEl('button', { text: 'Refresh' });
    refresh.addEventListener('click', () => this.reload());

    for (const err of this.errors) {
      root.createDiv({ cls: 'icor-sqlv-error', text: err.path + ': ' + err.reason });
    }
    if (!this.specs.length) {
      const empty = root.createDiv({ cls: 'icor-sqlv-blank' });
      empty.createDiv({ text: 'No dashboards yet.' });
      const start = empty.createEl('button', { text: 'Create your first dashboard', cls: 'mod-cta' });
      start.addEventListener('click', async () => {
        const spec = await this.plugin.createDashboard();
        this.activeId = spec.id;
        await this.reload();
      });
      const guides = empty.createEl('button', { text: 'Create Guide Files for Your AI Team' });
      const guideNote = empty.createDiv({ cls: 'icor-sqlv-guide-note' });
      this.guideUi = { button: guides, note: guideNote };
      guides.addEventListener('click', async () => {
        if (guides.disabled) return;
        const where = this.plugin.settings.dashboardFolder;
        const results = await this.plugin.writeGuideFilesWithNotice();
        const ok = results.some((r) => r.outcome !== 'failed');
        await this.refreshGuideButton();
        if (!ok) {
          guideNote.empty();
          guideNote.createDiv({ text: 'The guide files could not be written to ' + where + '.' });
        }
      });
      this.refreshGuideButton().catch(() => {});
      return;
    }
    const spec = this.specs.find((s) => s.id === this.activeId);
    if (spec) {
      /* Un-awaited on purpose so the frame paints first, but never allowed
       * to fail silently: a rejection lands in the view as text. */
      this.renderDashboard(root, spec).catch((e) => this.showFailure(e, root));
    }
  }

  async renderDashboard(root, spec) {
    const host = root.createDiv({ cls: 'icor-sqlv-dash' });
    this.renderHeader(host, spec);
    const status = host.createDiv({ cls: 'icor-sqlv-note icor-sqlv-dash-status' });
    const grid = host.createDiv({ cls: 'icor-sqlv-grid' });
    this.gridState = { spec, grid, cols: 0, cellH: 0, tileEls: [], layouts: [], addEl: null };
    this.setupGridGeometry();
    this.watchGridWidth();
    try {
      await this.renderDashboardInto(spec, status, grid);
    } catch (e) {
      this.showFailure(e, host);
    }
    this.placeAddTile();
  }

  /* Square-ish cells: the column count follows the pane width, the row
   * height follows the resulting cell width. */
  setupGridGeometry() {
    const gs = this.gridState;
    if (!gs) return;
    const width = gs.grid.clientWidth || 1080;
    gs.cols = colsForWidth(width);
    gs.cellH = Math.max(90, Math.floor((width - (gs.cols - 1) * GRID_GAP_PX) / gs.cols));
    gs.grid.style.gridTemplateColumns = 'repeat(' + gs.cols + ', minmax(0, 1fr))';
    gs.grid.style.gridAutoRows = growingRow(gs.cellH);
  }

  watchGridWidth() {
    if (this.gridRO) { this.gridRO.disconnect(); this.gridRO = null; }
    if (!this.gridState) return;
    this.gridRO = resizeObserverFor(this.gridState.grid, () => {
      const gs = this.gridState;
      if (!gs || this.dragging) return;
      const cols = colsForWidth(gs.grid.clientWidth || 1080);
      if (cols === gs.cols) return;
      this.setupGridGeometry();
      gs.layouts = normalizeLayout(gs.spec.tiles, gs.cols);
      this.applyGridDisplay();
      this.placeAddTile();
    });
    if (this.gridRO) this.gridRO.observe(this.gridState.grid);
  }

  releaseTileObservers() {
    for (const observer of this.tileROs) observer.disconnect();
    this.tileROs = [];
  }

  async onClose() {
    this.guideUi = null;
    if (this.gridRO) { this.gridRO.disconnect(); this.gridRO = null; }
    this.releaseTileObservers();
  }

  /* Row heights follow what lives in each row (rowTracks): a row of only
   * dividers is thin, every other row a full cell. */
  applyRowTracks(layouts) {
    const gs = this.gridState;
    if (!gs || !gs.grid) return;
    const rects = (layouts || []).map((l, i) => ({ l, thin: isThinTile(gs.spec.tiles[i]) }));
    if (gs.addSpot) rects.push({ l: gs.addSpot, thin: false });
    gs.grid.style.gridTemplateRows = rowTracks(rects, gs.cellH).map((px) => (px === DIVIDER_ROW_PX ? px + 'px' : growingRow(px))).join(' ');
  }

  applyGridDisplay(preview) {
    const gs = this.gridState;
    if (!gs) return;
    const layouts = preview || gs.layouts;
    this.applyRowTracks(layouts);
    gs.tileEls.forEach((el, i) => {
      const l = layouts[i];
      if (!el || !l) return;
      el.style.gridColumn = (l.x + 1) + ' / span ' + l.w;
      el.style.gridRow = (l.y + 1) + ' / span ' + l.h;
    });
  }

  /* The + tile: only on an empty dashboard or in edit mode, in the first
   * free 2x1 slot. */
  placeAddTile() {
    const gs = this.gridState;
    if (!gs) return;
    if (gs.addEl) { if (gs.addEl.parentElement) gs.addEl.parentElement.removeChild(gs.addEl); gs.addEl = null; }
    gs.addSpot = null;
    if (!showAddTile(gs.spec.tiles.length, this.editMode)) { this.applyRowTracks(gs.layouts); return; }
    const spot = findSpot(gs.layouts, { w: 2, h: 1 }, gs.cols);
    gs.addSpot = spot;
    this.applyRowTracks(gs.layouts);
    const add = gs.grid.createDiv({ cls: 'icor-sqlv-tile icor-sqlv-add-tile' });
    add.setAttribute('role', 'button');
    add.setAttribute('tabindex', '0');
    add.setAttribute('aria-label', 'Add a widget');
    add.style.gridColumn = (spot.x + 1) + ' / span ' + spot.w;
    add.style.gridRow = (spot.y + 1) + ' / span ' + spot.h;
    const plus = add.createDiv({ cls: 'icor-sqlv-add-plus' });
    setIcon(plus, 'plus');
    add.createDiv({ cls: 'icor-sqlv-add-text', text: 'Add widget' });
    const start = () => new WidgetFormModal(this.plugin, this, gs.spec, -1).open();
    add.addEventListener('click', start);
    add.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); start(); } });
    gs.addEl = add;
  }

  /* The dashboard header: the title, editable in place, and the global
   * range every widget set to "follow the dashboard" obeys. */
  renderHeader(host, spec) {
    const header = host.createDiv({ cls: 'icor-sqlv-dash-header' });
    const titleWrap = header.createDiv({ cls: 'icor-sqlv-dash-title' });
    const title = titleWrap.createEl('h2', { text: spec.title, cls: 'icor-sqlv-dash-title-text' });
    title.setAttribute('title', 'Click to rename');
    title.setAttribute('role', 'button');
    title.setAttribute('tabindex', '0');
    title.setAttribute('aria-label', 'Rename dashboard ' + spec.title);
    const startRename = () => {
      titleWrap.empty();
      const input = titleWrap.createEl('input', { type: 'text', cls: 'icor-sqlv-dash-title-input', value: spec.title });
      input.setAttribute('aria-label', 'Dashboard title');
      const commit = async () => {
        const next = input.value.trim();
        if (next && next !== spec.title) {
          spec.title = next;
          await this.saveAndRender(spec);
        } else {
          this.render();
        }
      };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
        if (ev.key === 'Escape') { ev.preventDefault(); this.render(); }
      });
      input.addEventListener('blur', commit);
      input.focus();
      if (typeof input.select === 'function') input.select();
    };
    title.addEventListener('click', startRename);
    title.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); startRename(); } });

    const range = header.createDiv({ cls: 'icor-sqlv-range' });
    range.createSpan({ cls: 'icor-sqlv-range-label', text: 'Range' });
    const select = range.createEl('select', { cls: 'dropdown' });
    select.setAttribute('aria-label', 'Time range for the whole dashboard');
    const current = spec.globalTimeframe || DEFAULT_GLOBAL_TIMEFRAME;
    for (const [key, label] of Object.entries(PRESET_LABELS)) {
      const opt = select.createEl('option', { text: label });
      opt.value = key;
      if (current.preset === key) opt.selected = true;
    }
    const customOpt = select.createEl('option', { text: 'Custom range' });
    customOpt.value = 'custom';
    if (current.from) customOpt.selected = true;
    const customWrap = range.createDiv({ cls: 'icor-sqlv-range-custom' });
    const buildCustom = () => {
      customWrap.empty();
      const from = customWrap.createEl('input', { type: 'date', value: current.from || '' });
      from.setAttribute('aria-label', 'From date');
      const to = customWrap.createEl('input', { type: 'date', value: current.to || '' });
      to.setAttribute('aria-label', 'To date');
      const apply = customWrap.createEl('button', { text: 'Apply' });
      apply.addEventListener('click', async () => {
        if (DATE_RE.test(from.value) && DATE_RE.test(to.value)) {
          spec.globalTimeframe = { from: from.value, to: to.value };
          await this.saveAndRender(spec);
        } else {
          new Notice('Pick both dates first.');
        }
      });
    };
    if (current.from) buildCustom();
    select.addEventListener('change', async () => {
      if (select.value === 'custom') { buildCustom(); return; }
      spec.globalTimeframe = { preset: select.value };
      await this.saveAndRender(spec);
    });

    const editBtn = header.createEl('button', { cls: 'icor-sqlv-edit-toggle' + (this.editMode ? ' is-on' : '') });
    setIcon(editBtn, this.editMode ? 'check' : 'pencil');
    editBtn.createSpan({ text: this.editMode ? 'Done' : 'Edit' });
    editBtn.setAttribute('aria-pressed', this.editMode ? 'true' : 'false');
    editBtn.setAttribute('aria-label', this.editMode ? 'Leave edit mode' : 'Edit this dashboard: move, resize, add and remove widgets');
    editBtn.addEventListener('click', () => {
      this.editMode = !this.editMode;
      this.render();
    });
    if (this.editMode && spec.path) {
      const textBtn = header.createEl('button', { cls: 'icor-sqlv-edit-toggle icor-sqlv-edit-text' });
      setIcon(textBtn, 'file-code');
      textBtn.createSpan({ text: 'Open as text' });
      textBtn.addEventListener('click', () => this.plugin.openDashboardAsText(spec.path, this.leaf));
    }
  }

  /* Move by dragging the tile, resize by dragging the corner handle.
   * Pointer events, so mouse and touch behave the same; the CSS sets
   * touch-action: none on these surfaces so the pane does not scroll
   * while a widget is in hand. */
  attachEditHandles(tileEl, index) {
    const surface = tileEl.createDiv({ cls: 'icor-sqlv-drag-surface' });
    surface.setAttribute('aria-label', 'Drag to move this widget');
    surface.setAttribute('title', 'Drag to move');
    surface.addEventListener('pointerdown', (ev) => this.startDrag(ev, index, 'move', surface));
    const handle = tileEl.createDiv({ cls: 'icor-sqlv-resize-handle' });
    handle.setAttribute('aria-label', 'Drag to resize this widget');
    handle.setAttribute('title', 'Drag to resize');
    handle.addEventListener('pointerdown', (ev) => this.startDrag(ev, index, 'resize', handle));
  }

  startDrag(ev, index, mode, surface) {
    const gs = this.gridState;
    if (!this.editMode || !gs || this.dragging) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.dragging = true;
    if (typeof surface.setPointerCapture === 'function') {
      try { surface.setPointerCapture(ev.pointerId); } catch (e) { /* capture is best effort */ }
    }
    const startX = ev.clientX;
    const startY = ev.clientY;
    const base = gs.layouts.map((l) => Object.assign({}, l));
    const origin = Object.assign({}, base[index]);
    const width = gs.grid.clientWidth || gs.cols * GRID_UNIT_PX;
    const cellW = width / gs.cols;
    /* Rows differ in height once a thin divider row is in the grid. */
    const tracks = rowTracks(base.map((l, j) => ({ l, thin: isThinTile(gs.spec.tiles[j]) })), gs.cellH);
    const isDivider = isThinTile(gs.spec.tiles[index]);
    const tileEl = gs.tileEls[index];
    tileEl.classList.add('is-dragging');
    let placeholder = null;
    let hole = null;
    if (mode === 'move') {
      /* Two dashed states while a widget is in hand: the hole it left
       * behind (hairline) and the cell it would land in (marker). */
      hole = gs.grid.createDiv({ cls: 'icor-sqlv-drag-hole' });
      hole.style.gridColumn = (origin.x + 1) + ' / span ' + origin.w;
      hole.style.gridRow = (origin.y + 1) + ' / span ' + origin.h;
      placeholder = gs.grid.createDiv({ cls: 'icor-sqlv-drop-cell' });
    }
    let preview = base;

    const onMove = (mv) => {
      const dx = mv.clientX - startX;
      const dy = mv.clientY - startY;
      const dCol = Math.round(dx / cellW);
      const dRow = rowsForOffset(tracks, GRID_GAP_PX, mode === 'move' ? origin.y : origin.y + origin.h, dy, gs.cellH);
      const candidate = Object.assign({}, origin);
      if (mode === 'move') {
        candidate.x = origin.x + dCol;
        candidate.y = Math.max(0, origin.y + dRow);
      } else {
        candidate.w = Math.max(1, origin.w + dCol);
        /* A divider is sized in width only; its row stays thin. */
        candidate.h = isDivider ? 1 : Math.max(1, origin.h + dRow);
      }
      const next = base.map((l, j) => (j === index ? candidate : Object.assign({}, l)));
      preview = packLayout(next, gs.cols, index);
      this.applyGridDisplay(preview);
      if (mode === 'move') {
        /* The tile itself follows the pointer from its old cell; the
         * placeholder shows the exact cell it would land in. */
        const p = preview[index];
        placeholder.style.gridColumn = (p.x + 1) + ' / span ' + p.w;
        placeholder.style.gridRow = (p.y + 1) + ' / span ' + p.h;
        tileEl.style.gridColumn = (origin.x + 1) + ' / span ' + origin.w;
        tileEl.style.gridRow = (origin.y + 1) + ' / span ' + origin.h;
        tileEl.classList.add('is-moving');
        tileEl.style.setProperty('--sqlv-drag-x', dx + 'px');
        tileEl.style.setProperty('--sqlv-drag-y', dy + 'px');
      }
    };

    const cleanup = () => {
      surface.removeEventListener('pointermove', onMove);
      surface.removeEventListener('pointerup', commit);
      surface.removeEventListener('pointercancel', cancel);
      tileEl.classList.remove('is-dragging');
      tileEl.classList.remove('is-moving');
      tileEl.style.removeProperty('--sqlv-drag-x');
      tileEl.style.removeProperty('--sqlv-drag-y');
      if (placeholder && placeholder.parentElement) placeholder.parentElement.removeChild(placeholder);
      if (hole && hole.parentElement) hole.parentElement.removeChild(hole);
      this.dragging = false;
    };

    const commit = async () => {
      cleanup();
      gs.layouts = preview;
      this.applyGridDisplay();
      this.placeAddTile();
      gs.spec.tiles.forEach((t, j) => { t.layout = Object.assign({}, gs.layouts[j]); });
      try {
        if (!(await this.plugin.saveDashboardSpec(gs.spec))) await this.reload();
      } catch (e) {
        new Notice('The layout could not be saved: ' + e.message);
      }
    };

    const cancel = () => {
      cleanup();
      this.applyGridDisplay();
      if (this.reloadPending) this.reload().catch((e) => this.showFailure(e));
    };

    surface.addEventListener('pointermove', onMove);
    surface.addEventListener('pointerup', commit);
    surface.addEventListener('pointercancel', cancel);
  }

  /* Edit and remove, in the corner of every widget. */
  addTileActions(tileEl, spec, index) {
    const tile = spec.tiles[index];
    const actions = tileEl.createDiv({ cls: 'icor-sqlv-tile-actions' });
    /* The form builds the widget types it knows; any other type is edited
     * in the dashboard file, so the form never saves half of it. */
    if (FORM_VIZ.has(tile.viz)) {
      const edit = actions.createEl('button', { cls: 'icor-sqlv-tile-action' });
      setIcon(edit, 'pencil');
      edit.setAttribute('aria-label', 'Edit this widget');
      edit.setAttribute('title', 'Edit');
      edit.addEventListener('click', () => {
        new WidgetFormModal(this.plugin, this, spec, index).open();
      });
    }
    const remove = actions.createEl('button', { cls: 'icor-sqlv-tile-action' });
    setIcon(remove, 'trash-2');
    remove.setAttribute('aria-label', 'Remove this widget');
    remove.setAttribute('title', 'Remove');
    remove.addEventListener('click', () => {
      new ConfirmModal(this.plugin.app, {
        title: 'Remove this widget?',
        body: 'The widget "' + (tile.title || 'Untitled') + '" is removed from the dashboard. The data it showed is not touched.',
        cta: 'Remove',
        onConfirm: async () => {
          spec.tiles.splice(index, 1);
          await this.saveAndRender(spec);
        },
      }).open();
    });
  }

  async renderDashboardInto(spec, status, grid) {
    const cache = await this.plugin.readDashboardCache(spec);
    const engines = new Map();
    const engineOf = async (db) => {
      if (!engines.has(db)) engines.set(db, await this.plugin.query.engineFor(db));
      return engines.get(db);
    };
    const cachedTiles = [];
    let failed = 0;
    let fromCache = 0;
    const t0 = Date.now();
    const gs = this.gridState;
    gs.layouts = normalizeLayout(spec.tiles, gs.cols);
    this.applyRowTracks(gs.layouts);
    /* Dividers draw no data: they count as neither live nor cached. */
    const dataCount = spec.tiles.filter((t) => !drawsNoData(t)).length;

    for (let i = 0; i < spec.tiles.length; i++) {
      const tile = spec.tiles[i];
      status.setText('Running query ' + (i + 1) + ' of ' + spec.tiles.length + (tile.title ? ': ' + tile.title : '') + ' …');
      const tileEl = grid.createDiv({ cls: 'icor-sqlv-tile' + (tile.viz === 'stat' ? ' is-stat' : '') + (tile.viz === 'divider' ? ' is-divider' : '') + (tile.viz === 'text' ? ' is-text' + (tile.line === true ? ' is-line' : '') : '') + (this.editMode ? ' is-editing' : '') });
      gs.tileEls[i] = tileEl;
      const l = gs.layouts[i];
      tileEl.style.gridColumn = (l.x + 1) + ' / span ' + l.w;
      tileEl.style.gridRow = (l.y + 1) + ' / span ' + l.h;
      if (this.editMode) {
        this.addTileActions(tileEl, spec, i);
        this.attachEditHandles(tileEl, i);
      }
      if (drawsNoData(tile)) {
        /* Nothing to compute, on any device; the cache keeps its slot so
         * every later widget's cached result stays at its own index. */
        renderTile(tileEl, tile, { columns: [], rows: [] }, {});
        cachedTiles.push(Object.assign({}, tile));
        continue;
      }
      const db = tileDatabase(tile, spec);
      if (!db) {
        failed++;
        tileEl.createDiv({ cls: 'icor-sqlv-error', text: 'This widget names no database. Edit it and pick one.' });
        continue;
      }
      const choice = await engineOf(db);
      if (choice.engine) {
        try {
          const sql = tileSql(tile, spec);
          const res = await this.plugin.query.query(db, sql, { cap: 5000 });
          /* The comparison period rides as a second, twin query. */
          let ghost = null;
          if (tile.source && tile.compare && tile.compare !== 'none' && canCompare(tile, spec.globalTimeframe)) {
            const shift = tile.compare === 'last_year' ? 'year' : 'previous';
            const ghostRes = await this.plugin.query.query(db, sqlForWidget(tile, spec.globalTimeframe, shift), { cap: 5000 });
            ghost = { columns: ghostRes.columns, rows: ghostRes.rows };
          }
          const prepared = prepareTileForRender(tile, res);
          renderTile(tileEl, prepared.spec, prepared.table, Object.assign({ ghost, compare: tile.compare, favorable: tile.favorable, observers: this.tileROs }, this.plugin.levelExtras()));
          cachedTiles.push(Object.assign({}, tile, { columns: res.columns, rows: res.rows, ghost }));
          this.plugin.maybeWriteCatalog(db);
        } catch (e) {
          failed++;
          if (tile.title) tileEl.createDiv({ cls: 'icor-sqlv-tile-title', text: tile.title });
          tileEl.createDiv({ cls: 'icor-sqlv-error', text: e.message });
        }
        continue;
      }
      /* No engine for this database on this device: the desktop cache. */
      const cachedTile = cache && cache.tiles[i];
      if (cachedTile) {
        try {
          const prepared = prepareTileForRender(cachedTile, { columns: cachedTile.columns, rows: cachedTile.rows });
          renderTile(tileEl, prepared.spec, prepared.table, Object.assign({ ghost: cachedTile.ghost || null, compare: cachedTile.compare, favorable: cachedTile.favorable, observers: this.tileROs }, this.plugin.levelExtras()));
          const cacheNote = 'Computed on desktop, ' + relativeTime(cache.computedAt) + '.';
          tileEl.createDiv({ cls: 'icor-sqlv-note icor-sqlv-cache-note', text: cacheNote }).setAttribute('title', cacheNote);
          fromCache++;
        } catch (e) {
          failed++;
          tileEl.createDiv({ cls: 'icor-sqlv-error', text: e.message });
        }
      } else {
        if (tile.title) tileEl.createDiv({ cls: 'icor-sqlv-tile-title', text: tile.title });
        tileEl.createDiv({ cls: 'icor-sqlv-note', text: (choice.reason || 'This database cannot be opened here.') + ' No cached result yet. Open this dashboard once on the desktop and sync.' });
      }
    }

    if (!spec.tiles.length) {
      status.setText('An empty dashboard. Add the first widget with the + tile.');
      return;
    }
    let line;
    if (failed) {
      line = failed + ' of ' + spec.tiles.length + ' widgets failed; the errors are shown in their tiles.';
    } else if (fromCache === dataCount && dataCount > 0) {
      line = 'Computed on desktop, ' + (cache ? relativeTime(cache.computedAt) : 'at an unknown time') + '.';
    } else if (fromCache > 0) {
      line = (dataCount - fromCache) + ' live, ' + fromCache + ' from the desktop cache.';
    } else {
      line = dataCount + (dataCount === 1 ? ' query' : ' queries') + ' in ' + (Date.now() - t0) + ' ms.';
    }
    /* The cache the phone renders from. Only a fully live, fully healthy
     * run is worth freezing; anything less would overwrite a good cache. */
    if (!failed && !fromCache && Platform.isDesktopApp) {
      try {
        const kept = await this.plugin.writeDashboardCache(spec, cachedTiles);
        if (kept && kept.bytes > CACHE_NOTE_WARN_BYTES) {
          line += ' This dashboard\'s cache is ' + (kept.bytes / MB).toFixed(1) + ' MB; Obsidian Sync Standard carries files up to 5 MB, so your phone may not get it. Fewer rows in big tables will fix it.';
        }
      } catch (e) {
        line += ' The cache could not be written: ' + e.message;
      }
    }
    status.setText(line);
  }
}

/* ------------------------------------------------------ builder modals -- */

/* A plain confirm dialog, so nothing ever falls back to window.confirm. */
class ConfirmModal extends Modal {
  constructor(app, { title, body, cta, onConfirm }) {
    super(app);
    this.opts = { title, body, cta, onConfirm };
  }
  onOpen() {
    this.titleEl.setText(this.opts.title);
    (this.modalEl || this.contentEl).setAttribute('data-ink-plugin', 'icor-for-life-sqlite-viewer');
    this.contentEl.empty();
    this.contentEl.createDiv({ text: this.opts.body });
    const bar = this.contentEl.createDiv({ cls: 'icor-sqlv-console-bar icor-sqlv-modal-bar' });
    const go = bar.createEl('button', { text: this.opts.cta, cls: 'mod-warning' });
    go.addEventListener('click', async () => { this.close(); await this.opts.onConfirm(); });
    const cancel = bar.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
  }
  onClose() { this.contentEl.empty(); }
}

/* ------------------------------------------------- the widget form -- */

/* A cancelable delay with injected timers, so the preview debounce is a
 * pure mechanism the gates can drive with fake clocks. */
function makeDebounce(ms, schedule, cancel) {
  let handle = null;
  return {
    bump(fn) {
      if (handle !== null) cancel(handle);
      handle = schedule(() => { handle = null; fn(); }, ms);
    },
    stop() { if (handle !== null) { cancel(handle); handle = null; } },
  };
}

/* The shared searchable list (the 0.3.0 component, now standalone):
 * search on top for long lists, grouped rows, arrows and Enter. */
function searchList(body, { items, search = true, autofocus = true, placeholder = 'Type to narrow the list' }) {
  let input = null;
  if (search && items.length > 4) {
    input = body.createEl('input', { type: 'text', cls: 'icor-sqlv-wizard-search' });
    input.setAttribute('placeholder', placeholder);
    input.setAttribute('aria-label', placeholder);
  }
  const host = body.createDiv({ cls: 'icor-sqlv-wizard-listhost' });
  let active = -1;
  let visible = [];
  const draw = () => {
    host.empty();
    const needle = input ? input.value.trim() : '';
    visible = items.filter((item) => matchesNeedle(needle, item.label, item.detail));
    if (active >= visible.length) active = visible.length - 1;
    let lastGroup;
    let listEl = null;
    visible.forEach((item, i) => {
      if (item.group !== lastGroup || !listEl) {
        if (item.group && item.group !== lastGroup) host.createDiv({ cls: 'icor-sqlv-wizard-group', text: item.group });
        listEl = host.createDiv({ cls: 'icor-sqlv-wizard-list' });
        lastGroup = item.group;
      }
      const rowEl = listEl.createDiv({ cls: 'icor-sqlv-wizard-row' + (item.selected ? ' is-selected' : '') + (i === active ? ' is-keyboard' : '') });
      rowEl.setAttribute('role', 'button');
      rowEl.setAttribute('tabindex', '0');
      rowEl.createDiv({ cls: 'icor-sqlv-wizard-row-label', text: item.label });
      if (item.detail) rowEl.createDiv({ cls: 'icor-sqlv-wizard-row-detail', text: item.detail });
      const pick = () => item.onPick();
      rowEl.addEventListener('click', pick);
      rowEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); } });
    });
    if (!visible.length) host.createDiv({ cls: 'icor-sqlv-empty', text: 'Nothing matches.' });
  };
  if (input) {
    input.addEventListener('input', () => { active = -1; draw(); });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); active = Math.min(visible.length - 1, active + 1); draw(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); active = Math.max(0, active - 1); draw(); }
      else if (ev.key === 'Enter') {
        ev.preventDefault();
        const pick = visible[Math.max(0, active)] || visible[0];
        if (pick) pick.onPick();
      }
    });
  }
  draw();
  if (input && autofocus && typeof input.focus === 'function') input.focus();
  return { input };
}

/* THE WIDGET FORM. One settings page that reads top to bottom like a
 * sentence: which database, which table, which value, when, split by
 * what, narrowed how, added up how, compared with what, called what,
 * drawn how, how big, over which period. A live preview runs beside it
 * through the normal read-only engines, and only a green preview can
 * save. SQL is optional and folded away under Advanced; turning a
 * widget into plain SQL is a one-way door and says so. */
class WidgetFormModal extends Modal {
  constructor(plugin, view, spec, editIndex) {
    super(plugin.app);
    this.plugin = plugin;
    this.view = view;
    this.spec = spec;
    this.editIndex = editIndex;
    const existing = editIndex >= 0 ? spec.tiles[editIndex] : null;
    const src = existing && existing.source ? existing.source : null;
    this.state = {
      mode: existing && existing.viz === 'divider' ? 'divider' : (existing && existing.viz === 'text' ? 'text' : (existing && !existing.source ? 'sql' : 'form')),
      /* Where "A widget with data" goes back to from the divider form. */
      dataMode: existing && existing.viz !== 'divider' && !existing.source ? 'sql' : 'form',
      dividerWidth: existing ? '' : String(GRID_MAX_COLS),
      /* A text widget: its words written here, or from a query. */
      textFrom: existing && existing.viz === 'text' && typeof existing.sql === 'string' ? 'sql' : 'text',
      textBody: existing && typeof existing.text === 'string' ? existing.text : '',
      textLine: !!(existing && existing.viz === 'text' && existing.line === true),
      database: (src && src.database) || spec.database || '',
      table: (src && src.table) || '',
      metric: (src && src.metric) || '',
      agg: (src && src.agg) || 'sum',
      series: (src && src.series) || '',
      groupBy: (src && src.groupBy) || '',
      timeColumn: (src && src.timeColumn) || '',
      timeframe: src ? (src.timeframe === undefined ? 'global' : src.timeframe) : 'global',
      filters: src && src.filters ? src.filters.map((f) => Object.assign({}, f)) : [],
      compare: (existing && existing.compare) || 'none',
      favorable: (existing && existing.favorable) || 'up',
      viz: existing ? existing.viz : 'line',
      stack: existing ? !!existing.stack : false,
      title: existing ? existing.title : '',
      unit: existing ? existing.unit : '',
      sizeKey: existing && existing.layout ? sizePresetOf(existing.layout) : (existing ? '' : 'medium'),
      sqlText: existing && existing.sql ? existing.sql : '',
      x: existing && existing.x ? existing.x : 'x',
      y: existing && existing.y && existing.y.length ? existing.y.join(', ') : 'value',
      /* Value levels, as the form edits them: the bounds stay text until
       * buildTile reads them. */
      ranges: existing && Array.isArray(existing.ranges) ? existing.ranges.map((r) => ({
        low: r.low === undefined ? '' : String(r.low),
        high: r.high === undefined ? '' : String(r.high),
        level: r.level || '',
        label: r.label || '',
      })) : [],
      levelColors: existing && existing.levelColors ? Object.assign({}, existing.levelColors) : {},
      headerDelta: !!(existing && existing.headerDelta === true),
      headerDeltaAverageDays: existing && existing.headerDeltaAverageDays !== undefined ? String(existing.headerDeltaAverageDays) : '',
      chartCaption: (existing && existing.chartCaption) || '',
      rangeColumn: existing && existing.rangeColumn ? existing.rangeColumn : '',
      captions: existing && Array.isArray(existing.captions) ? existing.captions.join(', ') : '',
      sparklines: existing && Array.isArray(existing.sparklines) ? existing.sparklines.join(', ') : '',
      valueSize: existing && existing.valueSize !== undefined ? String(existing.valueSize) : '',
      valueSizeCustom: !!(existing && typeof existing.valueSize === 'number' && !VALUE_SIZE_PRESETS.some(([px]) => px === existing.valueSize)),
      color: existing && existing.color ? existing.color : '',
      guideColor: existing && existing.guideColor ? existing.guideColor : '',
      hint: existing && existing.hint ? existing.hint : '',
      footnote: existing && existing.footnote ? existing.footnote : '',
      meterMin: existing && existing.meter ? String(existing.meter.min) : '',
      xLabelEvery: existing && existing.xLabelEvery !== undefined ? String(existing.xLabelEvery) : '',
      xMin: existing && existing.xMin !== undefined ? String(existing.xMin) : '',
      xMax: existing && existing.xMax !== undefined ? String(existing.xMax) : '',
      scatterColorBy: existing && existing.colorBy ? existing.colorBy : '',
      scatterTrend: !!(existing && existing.trend === true),
      pieDoughnut: !!(existing && existing.viz === 'pie' && existing.doughnut === true),
      bulletTarget: existing && existing.target ? existing.target : '',
      scaleMin: existing && existing.scaleMin !== undefined ? String(existing.scaleMin) : '',
      scaleMax: existing && existing.scaleMax !== undefined ? String(existing.scaleMax) : '',
      bandLow: existing && existing.band ? existing.band.low : '',
      bandHigh: existing && existing.band ? existing.band.high : '',
      bandOpacity: existing && existing.band && existing.band.opacity !== undefined ? String(existing.band.opacity) : '',
      meterMax: existing && existing.meter ? String(existing.meter.max) : '',
      meterTarget: existing && existing.meter && existing.meter.target !== undefined ? String(existing.meter.target) : '',
      advancedOpen: false,
      /* Which option groups are open; a group opens by itself when the
       * widget already has a value in it. */
      groups: {},
    };
    for (const p of ['y', 'y2']) {
      for (const [name, , kind] of FORM_AXIS_FIELDS) {
        const v = existing ? existing[p + name] : undefined;
        this.state[p + name] = kind === 'bool' ? v === true : (v === undefined ? '' : (Array.isArray(v) ? v.join(', ') : String(v)));
      }
    }
    this.state.refLines = formRowsOf(existing && existing.refLines, ['y', 'label', 'color', 'dash', 'axis']);
    for (const [key, file] of FORM_HEAT_FIELDS) this.state[key] = existing && existing.viz === 'heatmap' && existing[file] !== undefined ? String(existing[file]) : '';
    for (const [key, file] of FORM_CAL_FIELDS) this.state[key] = existing && existing.viz === 'calendar' && existing[file] !== undefined ? String(existing[file]) : '';
    this.state.comboSeries = formRowsOf(existing && existing.viz === 'combo' && existing.series, ['column', 'kind', 'axis', 'color', 'label', 'opacity', 'dash', 'connect']);
    this.state.y2Unit = existing && existing.y2Unit ? existing.y2Unit : '';
    this.state.segmentColors = existing && existing.segmentColors ? Object.entries(existing.segmentColors).map(([name, color]) => ({ name, color })) : [];
    this.state.zones = formRowsOf(existing && existing.zones, ['from', 'to', 'color', 'opacity', 'axis']);
    /* The columns of the last query the preview ran, for the column
     * pickers of an SQL widget. */
    this.resultColumns = null;
    this.schema = null;
    this.schemaFor = '';
    this.schemaError = '';
    this.openPicker = '';
    this.previewState = 'stale';
    this.previewError = '';
    this.previewSeq = 0;
    this.debounce = makeDebounce(400, (fn, ms) => window.setTimeout(fn, ms), (h) => window.clearTimeout(h));
  }

  onOpen() {
    this.modalEl.addClass('icor-sqlv-wizard-modal');
    this.modalEl.addClass('icor-sqlv-form-modal');
    this.modalEl.setAttribute('data-ink-plugin', 'icor-for-life-sqlite-viewer');
    this.titleEl.setText(this.editIndex >= 0 ? 'Edit widget' : 'New widget');
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('icor-sqlv-form');
    const panes = contentEl.createDiv({ cls: 'icor-sqlv-form-panes' });
    this.formEl = panes.createDiv({ cls: 'icor-sqlv-form-fields' });
    const side = panes.createDiv({ cls: 'icor-sqlv-form-side' });
    side.createDiv({ cls: 'icor-sqlv-wizard-group', text: 'Preview' });
    this.previewEl = side.createDiv({ cls: 'icor-sqlv-form-preview' });
    this.previewNote = side.createDiv({ cls: 'icor-sqlv-note' });
    this.dropNote = side.createDiv({ cls: 'icor-sqlv-note icor-sqlv-form-dropped' });
    const bar = contentEl.createDiv({ cls: 'icor-sqlv-console-bar icor-sqlv-modal-bar' });
    this.saveBtn = bar.createEl('button', { text: this.editIndex >= 0 ? 'Save widget' : 'Add widget', cls: 'mod-cta' });
    this.saveBtn.addEventListener('click', () => this.save());
    const cancel = bar.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    this.renderForm();
    this.touch();
    this.loadSchemaForEdit();
  }

  /* Editing a built widget: its table is already chosen, so load that
   * table's columns now. The fields after Table (value, name, chart type,
   * unit ...) are drawn from them; before this, they only appeared once
   * the member reopened the Table picker. */
  async loadSchemaForEdit() {
    const s = this.state;
    if (s.mode !== 'form' || !s.database || !s.table || this.tableInfo()) return;
    try {
      await this.ensureSchema();
      this.schemaError = '';
    } catch (e) {
      this.schemaError = e.message;
    }
    if (this.formEl) this.renderForm();
  }

  onClose() {
    this.debounce.stop();
    this.contentEl.empty();
  }

  /* Any change makes the preview stale and re-arms the debounce. */
  touch() {
    this.previewState = nextPreviewState(this.previewState, 'change');
    this.syncGate();
    this.debounce.bump(() => this.runPreview());
  }

  syncGate() {
    if (!this.saveBtn) return;
    this.saveBtn.disabled = !canSave(this.previewState);
    if (this.previewNote) {
      if (this.previewState === 'ok') this.previewNote.setText('The preview ran. Save is open.');
      else if (this.previewState === 'running') this.previewNote.setText('Running the preview …');
      else if (this.previewState === 'error') this.previewNote.setText(this.previewError);
      else this.previewNote.setText('The preview runs after each change; a widget saves only after its preview worked.');
    }
  }

  async ensureSchema() {
    if (this.schema && this.schemaFor === this.state.database) return this.schema;
    this.schema = await this.plugin.schemaFor(this.state.database);
    this.schemaFor = this.state.database;
    return this.schema;
  }

  tableInfo() {
    return this.schema ? this.schema.tables.find((t) => t.name === this.state.table) : null;
  }

  /* The state as a tile, or a plain-words reason. */
  /* The state as a tile: the type's own fields first, then the option
   * families, and the parser's check over the whole. */
  buildTile() {
    const base = this.buildBaseTile();
    if (!base.ok) return base;
    return this.withFormOptions(base.tile);
  }

  withFormOptions(tile) {
    if (tile.viz === 'divider') return { ok: true, tile };
    const opts = this.optionsFromForm(tile.viz, !!tile.source);
    if (!opts.ok) return opts;
    const raw = Object.assign({}, tile, opts.raw);
    if (tile.viz === 'heatmap' || tile.viz === 'calendar') { delete raw.x; delete raw.y; }
    if (tile.viz === 'combo') { delete raw.y; raw.stack = this.state.stack === true; }
    const check = checkFormTile(raw, this.spec.database);
    if (!check.ok) return check;
    if (FORM_WHOLE_VIZ.has(tile.viz)) return { ok: true, tile: check.tile };
    for (const key of FORM_OPTION_KEYS) if (check.tile[key] !== undefined) tile[key] = check.tile[key];
    return { ok: true, tile };
  }

  /* The option families as the file writes them, for the widget type at
   * hand: a family the type cannot carry is left out. */
  optionsFromForm(viz, built) {
    const s = this.state;
    const raw = {};
    if (viz !== 'divider') {
      if (s.hint.trim()) raw.hint = s.hint;
      if (s.footnote.trim()) raw.footnote = s.footnote;
    }
    if (viz === 'table' && !built) {
      const names = s.sparklines.split(',').map((v) => v.trim()).filter(Boolean);
      if (names.length) raw.sparklines = names;
    }
    if (viz === 'stat' && (s.meterMin.trim() || s.meterMax.trim() || s.meterTarget.trim())) {
      const min = formNumber(s.meterMin, 'Meter: the lowest value');
      const max = formNumber(s.meterMax, 'Meter: the highest value');
      const target = formNumber(s.meterTarget, 'Meter: the target');
      for (const n of [min, max, target]) if (!n.ok) return n;
      if (min.value === undefined || max.value === undefined) return { ok: false, reason: 'Meter: give the lowest and the highest value, or clear all three fields.' };
      raw.meter = { min: min.value, max: max.value };
      if (target.value !== undefined) raw.meter.target = target.value;
    }
    if (viz === 'line' || viz === 'bar' || viz === 'combo' || viz === 'scatter') {
      const axis = this.axisFromForm('y', 'Axis');
      if (!axis.ok) return axis;
      Object.assign(raw, axis.raw);
      const every = String(s.xLabelEvery || '').trim();
      if (every && viz !== 'scatter') {
        const n = Number(every);
        if (!Number.isInteger(n)) return { ok: false, reason: 'Axis: label every Nth value must be a whole number.' };
        raw.xLabelEvery = n;
      }
    }
    if (viz === 'scatter') {
      for (const [key, label] of [['xMin', 'Axis: the lowest x value'], ['xMax', 'Axis: the highest x value']]) {
        const n = formNumber(s[key], label);
        if (!n.ok) return n;
        if (n.value !== undefined) raw[key] = n.value;
      }
      if (s.scatterColorBy) raw.colorBy = s.scatterColorBy;
      if (s.scatterTrend === true) raw.trend = true;
    }
    if (viz === 'pie' && s.pieDoughnut === true) raw.doughnut = true;
    if (viz === 'line' || viz === 'bar' || viz === 'combo' || viz === 'scatter') {
      const marks = this.marksFromForm(viz);
      if (!marks.ok) return marks;
      Object.assign(raw, marks.raw);
    }
    if (viz === 'line' && !built && (s.bandLow || s.bandHigh)) {
      if (!s.bandLow || !s.bandHigh) return { ok: false, reason: 'Band: pick both columns, the low edge and the high edge, or neither.' };
      const op = formNumber(s.bandOpacity, 'Band: opacity');
      if (!op.ok) return op;
      raw.band = { low: s.bandLow, high: s.bandHigh };
      if (op.value !== undefined) raw.band.opacity = op.value;
    }
    if (isPartsViz(viz)) {
      const colors = {};
      for (const row of s.segmentColors) {
        const name = String(row.name || '').trim();
        if (!name || !row.color) continue;
        colors[name] = row.color;
      }
      if (Object.keys(colors).length) raw.segmentColors = colors;
    }
    if (viz === 'heatmap') {
      for (const [key, file] of FORM_HEAT_FIELDS) {
        const v = String(s[key] || '').trim();
        if (!v) continue;
        if (file === 'columnLabelEvery') {
          const n = Number(v);
          if (!Number.isInteger(n)) return { ok: false, reason: 'Label every Nth column must be a whole number.' };
          raw[file] = n;
        } else {
          raw[file] = v;
        }
      }
    }
    if (viz === 'bullet') {
      for (const [key, label] of [['scaleMin', 'Scale: the lowest value'], ['scaleMax', 'Scale: the highest value']]) {
        const n = formNumber(s[key], label);
        if (!n.ok) return n;
        if (n.value !== undefined) raw[key] = n.value;
      }
      if (s.bulletTarget) raw.target = s.bulletTarget;
    }
    if (viz === 'calendar') {
      for (const [key, file] of FORM_CAL_FIELDS) {
        const v = String(s[key] || '').trim();
        if (!v) continue;
        if (file === 'year') {
          const n = Number(v);
          if (!Number.isInteger(n)) return { ok: false, reason: 'Year must be a whole number like 2026, or left empty.' };
          raw[file] = n;
        } else {
          raw[file] = v;
        }
      }
    }
    if (viz === 'combo') {
      const series = [];
      for (let i = 0; i < s.comboSeries.length; i++) {
        const r = s.comboSeries[i];
        const where = 'Series ' + (i + 1);
        if (!String(r.column || '').trim()) return { ok: false, reason: where + ' needs a column.' };
        const one = { column: r.column.trim(), kind: r.kind === 'bar' ? 'bar' : 'line' };
        if (r.axis === 'right') one.axis = 'right';
        if (r.color) one.color = r.color;
        const op = formNumber(r.opacity, where + ': opacity');
        if (!op.ok) return op;
        if (op.value !== undefined) one.opacity = op.value;
        if (one.kind === 'line' && String(r.dash || '').trim()) one.dash = r.dash.trim();
        if (one.kind === 'line' && r.connect === true) one.connect = true;
        if (String(r.label || '').trim()) one.label = r.label.trim();
        series.push(one);
      }
      if (series.length) raw.series = series;
      const axis2 = this.axisFromForm('y2', 'Right axis');
      if (!axis2.ok) return axis2;
      Object.assign(raw, axis2.raw);
      if (s.y2Unit.trim()) raw.y2Unit = s.y2Unit.trim();
    }
    void built;
    return { ok: true, raw };
  }

  /* A combo chart: one x column and a list of series, each a bar or a
   * line on the left or the right axis. */
  renderComboFields(form) {
    const s = this.state;
    form.createDiv({ cls: 'icor-sqlv-note', text: 'Bars and lines over one x column, each series on the left or the right axis. One row per series, drawn in this order; the legend shows when there are two or more.' });
    this.columnField(form, { label: 'X column', value: s.x, onChange: (v) => { s.x = v; this.touch(); } });
    const wrap = this.field(form, { label: 'Series', required: true });
    this.rowsEditor(wrap, {
      rows: s.comboSeries, what: 'Series', max: COMBO_SERIES_MAX,
      newRow: () => ({ column: '', kind: s.comboSeries.length ? 'line' : 'bar', axis: '', color: '', label: '', opacity: '', dash: '', connect: false }),
      fields: [
        { key: 'column', label: 'column', kind: 'column' },
        { key: 'kind', label: 'drawn as', kind: 'select', options: () => [['bar', 'Bars'], ['line', 'Line']] },
        { key: 'axis', label: 'axis', kind: 'select', options: () => [['left', 'Left axis'], ['right', 'Right axis']] },
        { key: 'color', label: 'colour', kind: 'color' },
        { key: 'label', label: 'name in the legend', placeholder: 'legend name (optional)' },
        { key: 'opacity', label: 'opacity', kind: 'number', placeholder: 'opacity 1' },
        { key: 'dash', label: 'dash', placeholder: 'solid, or like 4 3', show: (r) => r.kind !== 'bar' },
        { key: 'connect', label: 'join across empty rows', kind: 'bool', show: (r) => r.kind !== 'bar' },
      ],
    });
    if (s.comboSeries.filter((r) => r.kind === 'bar').length > 1) {
      const row = form.createDiv({ cls: 'icor-sqlv-wizard-toggle' });
      const cb = row.createEl('input', { type: 'checkbox' });
      cb.checked = s.stack === true;
      cb.setAttribute('id', 'icor-sqlv-combo-stack');
      cb.setAttribute('aria-label', 'Stack the bars on top of each other');
      const lbl = row.createEl('label', { text: 'Stack the bars on top of each other' });
      lbl.setAttribute('for', 'icor-sqlv-combo-stack');
      cb.addEventListener('change', () => { s.stack = cb.checked; this.touch(); });
    }
  }

  /* The right axis of a combo chart: the left axis's fields, and the unit
   * its values carry in the readout. */
  renderRightAxisFields(form) {
    const s = this.state;
    const has = FORM_AXIS_FIELDS.some(([name, , kind]) => (kind === 'bool' ? s['y2' + name] === true : String(s['y2' + name]).trim())) || !!s.y2Unit.trim();
    const body = this.optionGroup(form, { key: 'axis2', label: 'Right axis', hasValues: has });
    if (!body) return;
    this.renderAxisFieldsFor(body, 'y2');
    this.textInput(body, { label: 'Unit of the right axis', optional: true, value: s.y2Unit, placeholder: 'like orders or %', ariaLabel: 'Right axis: unit', onInput: (v) => { s.y2Unit = v; this.touch(); } });
  }

  /* A scatter chart: the two number columns that place a point, an optional
   * column that colours the points, and the trend line. */
  renderScatterFields(form) {
    const s = this.state;
    form.createDiv({ cls: 'icor-sqlv-note', text: 'One point per row of the query, placed by a number along the bottom and a number up the side. A row with no number in either column is left out.' });
    this.columnField(form, { label: 'X column', value: s.x, onChange: (v) => { s.x = v; this.touch(); } });
    this.columnField(form, { label: 'Y column', value: s.y.split(',')[0].trim(), onChange: (v) => { s.y = v; this.touch(); } });
    this.columnField(form, {
      label: 'Colour the points by column', optional: true, noneLabel: 'No colouring', value: s.scatterColorBy,
      onChange: (v) => { s.scatterColorBy = v; this.renderForm(); this.touch(); },
    });
    if (s.scatterColorBy) form.createDiv({ cls: 'icor-sqlv-note', text: 'One colour for each value of the column: the four most common, the rest together as Other.' });
    const row = form.createDiv({ cls: 'icor-sqlv-wizard-toggle' });
    const cb = row.createEl('input', { type: 'checkbox' });
    cb.checked = s.scatterTrend === true;
    cb.setAttribute('id', 'icor-sqlv-scatter-trend');
    cb.setAttribute('aria-label', 'Draw a trend line through the points');
    const lbl = row.createEl('label', { text: 'Draw a trend line through the points' });
    lbl.setAttribute('for', 'icor-sqlv-scatter-trend');
    cb.addEventListener('change', () => { s.scatterTrend = cb.checked; this.touch(); });
  }

  /* A bullet chart: a label column, the actual value, a target, and the
   * ends of the shared scale. The bands are the value levels below. */
  renderBulletFields(form) {
    const s = this.state;
    form.createDiv({ cls: 'icor-sqlv-note', text: 'One bar for each row of the query: the actual value against a target mark, on one scale shaded in bands by the value levels below.' });
    this.columnField(form, { label: 'Label column', optional: true, noneLabel: 'No labels', value: s.x, onChange: (v) => { s.x = v; this.touch(); } });
    this.columnField(form, { label: 'Actual value column', value: s.y.split(',')[0].trim(), onChange: (v) => { s.y = v; this.touch(); } });
    this.columnField(form, { label: 'Target column', optional: true, noneLabel: 'No target', value: s.bulletTarget, onChange: (v) => { s.bulletTarget = v; this.touch(); } });
    for (const [key, label] of [['scaleMin', 'Lowest value on the scale'], ['scaleMax', 'Highest value on the scale']]) {
      const input = this.textInput(form, { label, optional: true, value: s[key], placeholder: 'automatic', onInput: (v) => { s[key] = v; this.touch(); } });
      input.setAttribute('inputmode', 'decimal');
    }
  }

  /* A year calendar: the column of days, the column that colours each day,
   * which day a week starts on, and which year to show. */
  renderCalendarFields(form) {
    const s = this.state;
    form.createDiv({ cls: 'icor-sqlv-note', text: 'One square for each day, a week to a column, coloured by the value levels below. A day the query has no row for stays empty.' });
    this.columnField(form, { label: 'Date column', value: s.calDate, onChange: (v) => { s.calDate = v; this.touch(); } });
    this.columnField(form, { label: 'Day value column', value: s.calValue, onChange: (v) => { s.calValue = v; this.touch(); } });
    this.nativeSelect(form, {
      label: 'Week starts on', optional: true,
      options: [['', 'The plugin setting (default)'], ['sunday', 'Sunday'], ['monday', 'Monday']],
      value: s.calWeekStart,
      onChange: (v) => { s.calWeekStart = v; this.touch(); },
    });
    const year = this.textInput(form, { label: 'Year', optional: true, value: s.calYear, placeholder: 'empty: the last 53 weeks up to the newest day', onInput: (v) => { s.calYear = v; this.touch(); } });
    year.setAttribute('inputmode', 'numeric');
  }

  /* A heatmap: which columns place a cell (row, column) and colour it
   * (value), an optional dot per cell, and the current hour lit up. */
  renderHeatmapFields(form) {
    const s = this.state;
    form.createDiv({ cls: 'icor-sqlv-note', text: 'A grid with one cell per row of the query, placed by its row and column values and coloured by the value levels below. Rows and columns appear in the order the query returns them.' });
    this.columnField(form, { label: 'Row labels column', value: s.heatRow, onChange: (v) => { s.heatRow = v; this.touch(); } });
    this.columnField(form, { label: 'Column labels column', value: s.heatColumn, onChange: (v) => { s.heatColumn = v; this.touch(); } });
    this.columnField(form, { label: 'Cell value column', value: s.heatValue, onChange: (v) => { s.heatValue = v; this.touch(); } });
  }

  renderHeatmapExtras(form) {
    const s = this.state;
    const body = this.optionGroup(form, { key: 'heat', label: 'Dots, highlight, cells and labels', hasValues: !!(s.heatMarker || s.heatHighlight || s.heatColumnLabelEvery || s.heatCells) });
    if (!body) return;
    this.columnField(body, { label: 'Dot column', optional: true, noneLabel: 'No dots', value: s.heatMarker, onChange: (v) => { s.heatMarker = v; if (!v) { s.heatMarkerColor = ''; s.heatMarkerLabel = ''; } this.touch(); } });
    if (s.heatMarker) {
      body.createDiv({ cls: 'icor-sqlv-note', text: 'A cell gets a dot where this column is not empty, 0 or false.' });
      this.colorField(body, { label: 'Dot colour', key: 'heatMarkerColor', ariaLabel: 'Colour of the dot' });
      this.textInput(body, { label: 'Dot label in the legend', optional: true, value: s.heatMarkerLabel, placeholder: 'empty: the column name', onInput: (v) => { s.heatMarkerLabel = v; this.touch(); } });
    }
    this.nativeSelect(body, {
      label: 'Highlight', optional: true,
      options: [['', 'None'], ['hour', 'The current hour’s column (columns named 0 to 23)'], ['day', 'Today’s row or column (named like 2026-01-31)'], ['weekday', 'Today’s weekday (named like Monday or Mon)']],
      value: s.heatHighlight,
      onChange: (v) => { s.heatHighlight = v; this.renderForm(); this.touch(); },
    });
    this.nativeSelect(body, {
      label: 'Cells', optional: true,
      options: [['', 'Thin rows (default)'], ['square', 'Square'], ['fill', 'Fill the tile’s height']],
      value: s.heatCells,
      onChange: (v) => { s.heatCells = v; this.touch(); },
    });
    const every = this.textInput(body, { label: 'Label every Nth column', optional: true, value: s.heatColumnLabelEvery, placeholder: 'empty: every column', onInput: (v) => { s.heatColumnLabelEvery = v; this.touch(); } });
    every.setAttribute('inputmode', 'numeric');
  }

  /* A segments bar: which column names each part, which sizes it, and a
   * colour per part name. */
  renderSegmentsFields(form) {
    const s = this.state;
    form.createDiv({ cls: 'icor-sqlv-note', text: 'One bar split into the query’s rows, each part as wide as its share of the total, in the order of the rows.' });
    this.columnField(form, { label: 'Part name column', value: s.x, onChange: (v) => { s.x = v; this.touch(); } });
    this.columnField(form, { label: 'Part size column', value: s.y, onChange: (v) => { s.y = v; this.touch(); } });
  }

  /* A pie chart: the same two columns as a segments bar, and whether it is
   * a doughnut. */
  renderPieFields(form) {
    const s = this.state;
    form.createDiv({ cls: 'icor-sqlv-note', text: 'A circle split into the query’s rows, each slice as big as its share of the total, from twelve o’clock in the order of the rows. A legend names every part.' });
    this.columnField(form, { label: 'Part name column', value: s.x, onChange: (v) => { s.x = v; this.touch(); } });
    this.columnField(form, { label: 'Part size column', value: s.y, onChange: (v) => { s.y = v; this.touch(); } });
    const row = form.createDiv({ cls: 'icor-sqlv-wizard-toggle' });
    const cb = row.createEl('input', { type: 'checkbox' });
    cb.checked = s.pieDoughnut === true;
    cb.setAttribute('id', 'icor-sqlv-pie-doughnut');
    cb.setAttribute('aria-label', 'Cut a hole in the middle (a doughnut)');
    const lbl = row.createEl('label', { text: 'Cut a hole in the middle (a doughnut)' });
    lbl.setAttribute('for', 'icor-sqlv-pie-doughnut');
    cb.addEventListener('change', () => { s.pieDoughnut = cb.checked; this.touch(); });
  }

  renderSegmentColors(form) {
    const s = this.state;
    const wrap = this.field(form, { label: 'Part colours', optional: true });
    wrap.createDiv({ cls: 'icor-sqlv-note', text: 'A colour for a part, by its name exactly as the query writes it. A part without one takes the theme colours in turn.' });
    this.rowsEditor(wrap, {
      rows: s.segmentColors, what: 'Part colour', max: SEGMENTS_MAX,
      newRow: () => ({ name: '', color: '' }),
      fields: [
        { key: 'name', label: 'part name', placeholder: 'part name' },
        { key: 'color', label: 'colour', kind: 'color', emptyLabel: 'Theme colour' },
      ],
    });
    const names = this.partNames();
    const missing = names.filter((n) => !s.segmentColors.some((r) => r.name === n));
    if (missing.length) {
      const fill = wrap.createEl('button', { text: '+ A row for each part in the preview', cls: 'icor-sqlv-add-filter' });
      fill.addEventListener('click', () => {
        for (const name of missing) if (s.segmentColors.length < SEGMENTS_MAX) s.segmentColors.push({ name, color: '' });
        this.renderForm();
      });
    }
  }

  /* The part names in the last preview, in their order. */
  partNames() {
    const cols = this.resultColumns;
    const rows = this.resultRows;
    if (!cols || !rows) return [];
    const i = cols.indexOf(this.state.x);
    if (i < 0) return [];
    const out = [];
    for (const r of rows) { const v = r[i] === null || r[i] === undefined ? '' : String(r[i]); if (v && !out.includes(v)) out.push(v); }
    return out.slice(0, SEGMENTS_MAX);
  }

  /* A shaded band between two columns, row by row, under the line. */
  renderBandFields(form, viz, built) {
    if (viz !== 'line' || built) return;
    const s = this.state;
    const body = this.optionGroup(form, { key: 'band', label: 'Band', hasValues: !!(s.bandLow || s.bandHigh) });
    if (!body) return;
    body.createDiv({ cls: 'icor-sqlv-note', text: 'A shaded area between two columns of the query, like a low and a high per day, drawn under the line in its colour.' });
    this.columnField(body, { label: 'Low edge column', optional: true, value: s.bandLow, onChange: (v) => { s.bandLow = v; this.touch(); } });
    this.columnField(body, { label: 'High edge column', optional: true, value: s.bandHigh, onChange: (v) => { s.bandHigh = v; this.touch(); } });
    const op = this.textInput(body, { label: 'Band opacity', optional: true, value: s.bandOpacity, placeholder: '0.2', onInput: (v) => { s.bandOpacity = v; this.touch(); } });
    op.setAttribute('inputmode', 'decimal');
  }

  /* Guide lines and zones as the file writes them. A row left blank is
   * skipped; the side ("axis") is a combo chart's only. */
  marksFromForm(viz) {
    const s = this.state;
    const raw = {};
    const blank = (row, keys) => keys.every((k) => !String(row[k] || '').trim());
    const lines = [];
    for (let i = 0; i < s.refLines.length; i++) {
      const r = s.refLines[i];
      if (blank(r, ['y', 'label', 'color', 'dash'])) continue;
      const y = formNumber(r.y, 'Guide line ' + (i + 1) + ': the value');
      if (!y.ok) return y;
      if (y.value === undefined) return { ok: false, reason: 'Guide line ' + (i + 1) + ' needs a value: where it crosses the chart.' };
      const line = { y: y.value };
      if (r.label.trim()) line.label = r.label.trim();
      if (r.color) line.color = r.color;
      if (r.dash.trim()) line.dash = r.dash.trim();
      if (viz === 'combo' && r.axis === 'right') line.axis = 'right';
      lines.push(line);
    }
    if (lines.length) raw.refLines = lines;
    const zones = [];
    for (let i = 0; i < s.zones.length; i++) {
      const z = s.zones[i];
      if (blank(z, ['from', 'to', 'opacity'])) continue;
      const from = formNumber(z.from, 'Zone ' + (i + 1) + ': from');
      const to = formNumber(z.to, 'Zone ' + (i + 1) + ': to');
      const op = formNumber(z.opacity, 'Zone ' + (i + 1) + ': opacity');
      for (const n of [from, to, op]) if (!n.ok) return n;
      if (from.value === undefined || to.value === undefined) return { ok: false, reason: 'Zone ' + (i + 1) + ' needs both ends: from and to.' };
      if (!z.color) return { ok: false, reason: 'Zone ' + (i + 1) + ' needs a colour.' };
      const zone = { from: from.value, to: to.value, color: z.color };
      if (op.value !== undefined) zone.opacity = op.value;
      if (viz === 'combo' && z.axis === 'right') zone.axis = 'right';
      zones.push(zone);
    }
    if (zones.length) raw.zones = zones;
    return { ok: true, raw };
  }

  /* A colour inside a row: the theme colours, a colour from the member's
   * own CSS kept as it is, or a custom colour from a picker. */
  rowColor(parent, { value, onChange, ariaLabel, emptyLabel }) {
    const themed = LEVEL_THEME_COLORS.some(([v]) => v === value);
    const fromCss = !!value && !themed && /^var\(/.test(value);
    const select = parent.createEl('select', { cls: 'dropdown' });
    select.setAttribute('aria-label', ariaLabel);
    const options = [['', emptyLabel || 'Theme default']].concat(
      LEVEL_THEME_COLORS.map(([v, text]) => [v, text]),
      fromCss ? [[value, 'From your CSS: ' + value]] : [],
      [['custom', 'Custom colour']],
    );
    const current = !value ? '' : (themed || fromCss ? value : 'custom');
    for (const [v, text] of options) {
      const opt = select.createEl('option', { text });
      opt.value = v;
      if (v === current) opt.selected = true;
    }
    select.addEventListener('change', () => {
      onChange(select.value === 'custom' ? (/^#/.test(value || '') ? value : '#808080') : select.value);
      this.renderForm();
      this.touch();
    });
    if (value && !themed && !fromCss) {
      const picker = parent.createEl('input', { type: 'color', value });
      picker.setAttribute('aria-label', ariaLabel + ', custom');
      picker.addEventListener('input', () => { if (isLevelColor(picker.value)) { onChange(picker.value); this.touch(); } });
    }
    return select;
  }

  /* An editable list of rows, each a few small fields, with add and
   * remove: guide lines, zones, combo series, part colours. */
  rowsEditor(parent, { rows, fields, what, max, newRow }) {
    const list = parent.createDiv({ cls: 'icor-sqlv-filter-rows icor-sqlv-range-rows' });
    rows.forEach((row, i) => {
      const at = what + ' ' + (i + 1);
      const rowEl = list.createDiv({ cls: 'icor-sqlv-filter-row-edit icor-sqlv-range-row icor-sqlv-form-row' });
      /* A row of many fields wraps; its name on top keeps it one unit. */
      if (fields.length > 4) rowEl.createDiv({ cls: 'icor-sqlv-form-row-name', text: at });
      for (const f of fields) {
        if (f.show && !f.show(row)) continue;
        const aria = at + ': ' + f.label;
        if (f.kind === 'column' && this.resultColumns && this.resultColumns.length) {
          const cols = this.resultColumns;
          const select = rowEl.createEl('select', { cls: 'dropdown' });
          select.setAttribute('aria-label', aria);
          const opts = [['', 'Pick a column']].concat(cols.map((c) => [c, c]));
          if (row[f.key] && !cols.includes(row[f.key])) opts.push([row[f.key], row[f.key] + ' (not in the result)']);
          for (const [v, text] of opts) {
            const opt = select.createEl('option', { text });
            opt.value = v;
            if (v === (row[f.key] || '')) opt.selected = true;
          }
          select.addEventListener('change', () => { row[f.key] = select.value; this.touch(); });
        } else if (f.kind === 'color') {
          this.rowColor(rowEl, { value: row[f.key], ariaLabel: aria, emptyLabel: f.emptyLabel, onChange: (v) => { row[f.key] = v; } });
        } else if (f.kind === 'select') {
          const options = f.options(row);
          const select = rowEl.createEl('select', { cls: 'dropdown' });
          select.setAttribute('aria-label', aria);
          for (const [v, text] of options) {
            const opt = select.createEl('option', { text });
            opt.value = v;
            if (v === (row[f.key] || options[0][0])) opt.selected = true;
          }
          select.addEventListener('change', () => { row[f.key] = select.value; this.renderForm(); this.touch(); });
        } else if (f.kind === 'bool') {
          const pair = rowEl.createEl('label', { cls: 'icor-sqlv-form-row-check' });
          const cb = pair.createEl('input', { type: 'checkbox' });
          cb.checked = row[f.key] === true;
          cb.setAttribute('aria-label', aria);
          pair.createSpan({ cls: 'icor-sqlv-note', text: f.label });
          cb.addEventListener('change', () => { row[f.key] = cb.checked; this.touch(); });
        } else {
          const input = rowEl.createEl('input', { type: 'text', cls: 'icor-sqlv-wizard-input' + (f.kind === 'number' ? ' icor-sqlv-range-num' : ''), value: row[f.key] || '' });
          input.setAttribute('placeholder', f.placeholder || f.label);
          input.setAttribute('aria-label', aria);
          if (f.kind === 'number') input.setAttribute('inputmode', 'decimal');
          input.addEventListener('input', () => { row[f.key] = input.value; this.touch(); });
        }
      }
      const remove = rowEl.createEl('button', { cls: 'icor-sqlv-tile-action icor-sqlv-filter-remove' });
      setIcon(remove, 'x');
      remove.setAttribute('aria-label', 'Remove ' + at.toLowerCase());
      remove.addEventListener('click', () => { rows.splice(i, 1); this.renderForm(); this.touch(); });
    });
    if (rows.length < max) {
      const add = parent.createEl('button', { text: '+ Add ' + what.toLowerCase(), cls: 'icor-sqlv-add-filter' });
      add.addEventListener('click', () => { rows.push(newRow()); this.renderForm(); this.touch(); });
    }
  }

  /* Horizontal guide lines (a goal, a limit) and shaded zones (a target
   * band) on a line, bar or combo chart. */
  renderMarkFields(form, viz) {
    if (viz !== 'line' && viz !== 'bar' && viz !== 'combo' && viz !== 'scatter') return;
    const s = this.state;
    const body = this.optionGroup(form, { key: 'marks', label: 'Guide lines and zones', hasValues: s.refLines.length > 0 || s.zones.length > 0 });
    if (!body) return;
    const sides = [['left', 'Left axis'], ['right', 'Right axis']];
    const lines = this.field(body, { label: 'Guide lines', optional: true });
    lines.createDiv({ cls: 'icor-sqlv-note', text: 'A line across the chart at one value. A label names it in the legend.' });
    this.rowsEditor(lines, {
      rows: s.refLines, what: 'Guide line', max: CHART_MARKS_MAX,
      newRow: () => ({ y: '', label: '', color: '', dash: '', axis: '' }),
      fields: [
        { key: 'y', label: 'value', kind: 'number', placeholder: 'at' },
        { key: 'label', label: 'label', placeholder: 'label (optional)' },
        { key: 'color', label: 'colour', kind: 'color' },
        { key: 'dash', label: 'dash', placeholder: 'solid, or like 4 3' },
      ].concat(viz === 'combo' ? [{ key: 'axis', label: 'axis', kind: 'select', options: () => sides }] : []),
    });
    const zones = this.field(body, { label: 'Zones', optional: true });
    zones.createDiv({ cls: 'icor-sqlv-note', text: 'A shaded band behind the chart, from one value to another.' });
    this.rowsEditor(zones, {
      rows: s.zones, what: 'Zone', max: CHART_MARKS_MAX,
      newRow: () => ({ from: '', to: '', color: 'var(--color-green)', opacity: '', axis: '' }),
      fields: [
        { key: 'from', label: 'from', kind: 'number' },
        { key: 'to', label: 'to', kind: 'number' },
        { key: 'color', label: 'colour', kind: 'color', emptyLabel: 'Pick a colour' },
        { key: 'opacity', label: 'opacity', kind: 'number', placeholder: 'opacity 0.15' },
      ].concat(viz === 'combo' ? [{ key: 'axis', label: 'axis', kind: 'select', options: () => sides }] : []),
    });
  }

  /* One axis's fields as the file writes them: "y" for the left axis, "y2"
   * for a combo chart's right axis. */
  axisFromForm(p, where) {
    const s = this.state;
    const raw = {};
    for (const [name, label, kind] of FORM_AXIS_FIELDS) {
      const v = s[p + name];
      if (kind === 'bool') { if (v === true) raw[p + name] = true; continue; }
      if (kind === 'text') { if (String(v).trim()) raw[p + name] = String(v).trim(); continue; }
      const n = kind === 'list' ? formNumberList(v, where + ': ' + label.toLowerCase()) : formNumber(v, where + ': ' + label.toLowerCase());
      if (!n.ok) return n;
      if (n.value !== undefined) raw[p + name] = n.value;
    }
    return { ok: true, raw };
  }

  /* The fields of one axis, under a heading when there are two. */
  renderAxisFieldsFor(body, p) {
    const s = this.state;
    for (const [name, label, kind, ph] of FORM_AXIS_FIELDS) {
      const key = p + name;
      const aria = (p === 'y2' ? 'Right axis: ' : '') + label;
      if (kind === 'bool') {
        const row = body.createDiv({ cls: 'icor-sqlv-wizard-toggle' });
        const cb = row.createEl('input', { type: 'checkbox' });
        cb.checked = s[key] === true;
        cb.setAttribute('id', 'icor-sqlv-' + key);
        cb.setAttribute('aria-label', aria);
        const lbl = row.createEl('label', { text: label });
        lbl.setAttribute('for', 'icor-sqlv-' + key);
        cb.addEventListener('change', () => { s[key] = cb.checked; this.touch(); });
        continue;
      }
      const input = this.textInput(body, { label, optional: true, value: s[key], placeholder: ph, ariaLabel: aria, onInput: (v) => { s[key] = v; this.touch(); } });
      if (kind !== 'text') input.setAttribute('inputmode', 'decimal');
    }
  }

  /* The y range, its labels and the spacing of the x labels. */
  renderAxisFields(form, viz) {
    if (viz !== 'line' && viz !== 'bar' && viz !== 'combo' && viz !== 'scatter') return;
    const s = this.state;
    const has = FORM_AXIS_FIELDS.some(([name, , kind]) => (kind === 'bool' ? s['y' + name] === true : String(s['y' + name]).trim()))
      || !!String(s.xLabelEvery).trim() || !!String(s.xMin).trim() || !!String(s.xMax).trim();
    const body = this.optionGroup(form, { key: 'axis', label: viz === 'combo' ? 'Left axis' : 'Axis', hasValues: has });
    if (!body) return;
    if (viz === 'scatter') body.createDiv({ cls: 'icor-sqlv-note', text: 'These fields set the scale up the side; the two x fields below set the scale along the bottom.' });
    this.renderAxisFieldsFor(body, 'y');
    if (viz === 'scatter') {
      for (const [key, label] of [['xMin', 'Lowest x value'], ['xMax', 'Highest x value']]) {
        const input = this.textInput(body, { label, optional: true, value: s[key], placeholder: 'automatic', onInput: (v) => { s[key] = v; this.touch(); } });
        input.setAttribute('inputmode', 'decimal');
      }
      return;
    }
    const every = this.textInput(body, {
      label: 'Label every Nth value along the bottom', optional: true, value: s.xLabelEvery, placeholder: 'empty: as many as fit',
      onInput: (v) => { s.xLabelEvery = v; this.touch(); },
    });
    every.setAttribute('inputmode', 'numeric');
  }

  /* A thin bar under the number, filled to where it sits from lowest to
   * highest, with an optional target mark. */
  renderMeterFields(form, viz) {
    if (viz !== 'stat') return;
    const s = this.state;
    const body = this.optionGroup(form, { key: 'meter', label: 'Meter under the number', hasValues: !!(s.meterMin || s.meterMax) });
    if (!body) return;
    body.createDiv({ cls: 'icor-sqlv-note', text: 'A bar under the number, filled to where it sits between the lowest and the highest value. The target draws a mark.' });
    for (const [key, label, ph] of [['meterMin', 'Lowest value', 'like 0'], ['meterMax', 'Highest value', 'like 100'], ['meterTarget', 'Target', 'optional']]) {
      const input = this.textInput(body, { label, optional: key === 'meterTarget', value: s[key], placeholder: ph, onInput: (v) => { s[key] = v; this.touch(); } });
      input.setAttribute('inputmode', 'decimal');
    }
  }

  /* A hint at the right of the title, a footnote under the widget. */
  renderNotesFields(form, viz) {
    if (viz === 'divider') return;
    const s = this.state;
    const body = this.optionGroup(form, { key: 'notes', label: 'Hint and footnote', hasValues: !!(s.hint || s.footnote) });
    if (!body) return;
    this.textInput(body, {
      label: 'Hint by the title', optional: true, value: s.hint, placeholder: 'a few words, up to ' + HINT_MAX + ' characters',
      onInput: (v) => { s.hint = v; this.touch(); },
    });
    const row = this.field(body, { label: 'Footnote under the widget', optional: true });
    const area = row.createEl('textarea', { cls: 'icor-sqlv-wizard-input' });
    area.value = s.footnote;
    area.setAttribute('rows', '2');
    area.setAttribute('placeholder', 'a sentence, up to ' + FOOTNOTE_MAX + ' characters');
    area.setAttribute('aria-label', 'Footnote under the widget');
    area.addEventListener('input', () => { s.footnote = area.value; this.touch(); });
  }

  buildBaseTile() {
    const s = this.state;
    if (s.mode === 'text') {
      const tile = { viz: 'text' };
      if (!s.textLine && String(s.title || '').trim()) tile.title = String(s.title).trim();
      if (s.textFrom === 'sql') {
        if (!s.sqlText.trim()) return { ok: false, reason: 'The SQL is empty.' };
        tile.sql = s.sqlText;
      } else {
        if (!s.textBody.trim()) return { ok: false, reason: 'Write the text first.' };
        tile.text = s.textBody;
      }
      if (s.textLine) tile.line = true;
      return { ok: true, tile };
    }
    if (s.mode === 'divider') return { ok: true, tile: { title: String(s.title || '').trim(), viz: 'divider' } };
    if (s.mode === 'sql') {
      if (!s.sqlText.trim()) return { ok: false, reason: 'The SQL is empty.' };
      const gate = gateStatement(s.sqlText);
      if (!gate.ok) return { ok: false, reason: gate.reason };
      const y = s.y.split(',').map((v) => v.trim()).filter(Boolean);
      const tile = {
        title: s.title || 'SQL widget',
        sql: s.sqlText,
        viz: s.viz,
        x: s.x.trim(),
        y,
        unit: s.unit,
        stack: s.stack && y.length > 1,
      };
      if ((tile.viz === 'line' || tile.viz === 'bar') && (!tile.x || !y.length)) {
        return { ok: false, reason: 'A ' + tile.viz + ' chart needs the x column and at least one y column.' };
      }
      if (tile.viz === 'scatter' && (!tile.x || y.length !== 1)) {
        return { ok: false, reason: 'A scatter chart needs the x column and one y column.' };
      }
      if (tile.viz === 'bullet' && y.length !== 1) {
        return { ok: false, reason: 'A bullet chart needs one actual value column.' };
      }
      const levels = this.levelsFromForm(tile.viz);
      if (!levels.ok) return levels;
      const sqlDelta = this.headerDeltaFromForm(tile.viz, y.length);
      if (!sqlDelta.ok) return sqlDelta;
      const score = s.rangeColumn.trim() && (tile.viz === 'stat' || isPartsViz(tile.viz)) && levels.ranges
        ? checkRangeColumn(s.rangeColumn, tile.viz, levels.ranges, y, 'This widget')
        : { ok: true };
      if (!score.ok) return score;
      if (score.rangeColumn) levels.rangeColumn = score.rangeColumn;
      const captionNames = s.captions.split(',').map((v) => v.trim()).filter(Boolean);
      const captions = tile.viz === 'stat' && captionNames.length ? checkCaptions(captionNames, tile.viz, 'This widget') : { ok: true };
      if (!captions.ok) return captions;
      const sqlSize = this.valueSizeFromForm(tile.viz);
      if (!sqlSize.ok) return sqlSize;
      const colors = this.chartColorsFromForm(tile.viz, tile.viz === 'scatter' && s.scatterColorBy ? 2 : y.length);
      if (!colors.ok) return colors;
      return { ok: true, tile: withChartColors(withValueSize(withCaptions(withHeaderDelta(withLevels(tile, levels), sqlDelta), captions), sqlSize), colors) };
    }
    if (!s.database) return { ok: false, reason: 'Pick a database first.' };
    if (!s.table) return { ok: false, reason: 'Pick a table.' };
    if (s.agg !== 'count' && !s.metric) return { ok: false, reason: 'Pick a value to measure.' };
    const filters = [];
    for (const row of s.filters) {
      if (!row.column) continue;
      if (!FILTER_OPS[row.op || 'eq'].noValue && (row.value === undefined || row.value === '')) {
        return { ok: false, reason: 'The filter on ' + row.column + ' still needs a value.' };
      }
      filters.push({ column: row.column, op: row.op || 'eq', value: row.value });
    }
    const source = {
      table: s.table,
      metric: s.agg === 'count' ? '' : s.metric,
      agg: s.agg,
      filters,
      series: s.series || undefined,
      groupBy: s.groupBy || undefined,
      timeColumn: s.timeColumn || undefined,
      timeframe: s.timeframe,
    };
    if (s.database && s.database !== this.spec.database) source.database = s.database;
    const viz = s.agg === 'latest' ? 'stat' : s.viz;
    const tile = {
      title: s.title || this.suggestedTitle(),
      viz,
      unit: s.unit,
      stack: s.stack && !!s.series && viz === 'bar',
      compare: s.series ? 'none' : s.compare,
      favorable: s.favorable,
      source,
    };
    if (viz !== 'stat' && !source.timeColumn && !source.groupBy) {
      return { ok: false, reason: 'A chart needs a date column. Pick one, or choose the stat widget.' };
    }
    const check = checkWidgetSource(source, viz, 'This widget');
    if (!check.ok) return check;
    source.filters = check.filters;
    const levels = this.levelsFromForm(viz);
    if (!levels.ok) return levels;
    const builtDelta = this.headerDeltaFromForm(viz, s.series ? 2 : 1);
    if (!builtDelta.ok) return builtDelta;
    const builtSize = this.valueSizeFromForm(viz);
    if (!builtSize.ok) return builtSize;
    const colors = this.chartColorsFromForm(viz, s.series ? 2 : 1);
    if (!colors.ok) return colors;
    return { ok: true, tile: withChartColors(withValueSize(withHeaderDelta(withLevels(tile, levels), builtDelta), builtSize), colors) };
  }

  /* The change-over-the-period fields as a checked setting. They apply
   * only to a one-series line or bar chart and stay in the form if the
   * chart type changes. */
  headerDeltaFromForm(viz, seriesCount) {
    const s = this.state;
    if ((!s.headerDelta && !s.chartCaption) || (viz !== 'line' && viz !== 'bar') || seriesCount !== 1) return { ok: true, on: false };
    const text = s.headerDelta || s.chartCaption === 'change' ? String(s.headerDeltaAverageDays || '').trim() : '';
    const raw = {};
    if (s.headerDelta) raw.headerDelta = true;
    if (s.chartCaption) raw.chartCaption = s.chartCaption;
    if (text) {
      const n = Number(text);
      if (!Number.isInteger(n)) return { ok: false, reason: 'Average the ends over N days: N must be a whole number of days.' };
      raw.headerDeltaAverageDays = n;
    }
    return checkHeaderDelta(raw, viz, 1, 'This widget');
  }

  renderHeaderDeltaFields(form, viz, seriesCount) {
    if ((viz !== 'line' && viz !== 'bar') || seriesCount !== 1) return;
    const s = this.state;
    const row = form.createDiv({ cls: 'icor-sqlv-wizard-toggle' });
    const cb = row.createEl('input', { type: 'checkbox' });
    cb.checked = s.headerDelta;
    cb.setAttribute('id', 'icor-sqlv-header-delta');
    cb.setAttribute('aria-label', 'Show change over the period');
    const lbl = row.createEl('label', { text: 'Show change over the period' });
    lbl.setAttribute('for', 'icor-sqlv-header-delta');
    cb.addEventListener('change', () => { s.headerDelta = cb.checked; this.renderForm(); this.touch(); });
    this.nativeSelect(form, {
      label: 'Roll-up at the right of the title', optional: true,
      options: [['', 'None'], ['range', 'Lowest to highest'], ['change', 'Change over the period']],
      value: s.chartCaption,
      onChange: (v) => { s.chartCaption = v; this.renderForm(); this.touch(); },
    });
    if (s.headerDelta || s.chartCaption === 'change') {
      const input = this.textInput(form, {
        label: 'Average the ends over N days', optional: true, value: s.headerDeltaAverageDays,
        placeholder: 'empty: first and last point',
        onInput: (v) => { s.headerDeltaAverageDays = v; this.touch(); },
      });
      input.setAttribute('inputmode', 'numeric');
    }
  }

  /* The number size as a checked setting. Only a stat widget carries it;
   * the choice stays in the form if the chart type changes back. */
  valueSizeFromForm(viz) {
    const s = this.state;
    if (viz !== 'stat') return { ok: true, valueSize: undefined };
    const text = String(s.valueSize || '').trim();
    if (!text) {
      if (s.valueSizeCustom) return { ok: false, reason: 'Number size: type a whole number of pixels from ' + VALUE_SIZE_MIN + ' to ' + VALUE_SIZE_MAX + '.' };
      return { ok: true, valueSize: undefined };
    }
    return checkValueSize(text === 'fit' ? 'fit' : Number(text), viz, 'This widget');
  }

  renderValueSizeField(form, viz) {
    if (viz !== 'stat') return;
    const s = this.state;
    const options = [['', 'Theme default']]
      .concat(VALUE_SIZE_PRESETS.map(([px, text]) => [String(px), text + ' (' + px + ' px)']))
      .concat([['fit', 'Shrink to fit'], ['custom', 'Custom']]);
    this.nativeSelect(form, {
      label: 'Number size', optional: true, options,
      value: s.valueSizeCustom ? 'custom' : s.valueSize,
      ariaLabel: 'Size of the number',
      onChange: (v) => {
        if (v === 'custom') {
          if (!/^\d+$/.test(s.valueSize)) s.valueSize = '';
          s.valueSizeCustom = true;
        } else {
          s.valueSize = v;
          s.valueSizeCustom = false;
        }
        this.renderForm();
        this.touch();
      },
    });
    if (s.valueSizeCustom) {
      const input = this.textInput(form, {
        label: 'Number size in pixels', value: s.valueSize,
        placeholder: VALUE_SIZE_MIN + ' to ' + VALUE_SIZE_MAX,
        onInput: (v) => { s.valueSize = v.trim(); this.touch(); },
      });
      input.setAttribute('inputmode', 'numeric');
    }
  }

  /* The chart colour fields as a checked setting. They apply only where
   * the spec takes them (a one-series line or bar chart; the pointer line
   * on a line chart) and stay in the form if the chart type changes. */
  chartColorsFromForm(viz, seriesCount) {
    const s = this.state;
    const raw = {};
    if (s.color && (viz === 'line' || viz === 'bar' || viz === 'scatter') && seriesCount === 1) raw.color = s.color;
    if (s.guideColor && (viz === 'line' || viz === 'combo')) raw.guideColor = s.guideColor;
    return checkChartColors(raw, viz, seriesCount, 'This widget');
  }

  /* One colour field: the theme default, the theme colours, or a custom
   * colour from a picker. A colour from the member's own CSS (another
   * var(--...)) shows as such and is kept until another one is chosen. */
  colorField(form, { label, key, ariaLabel }) {
    const s = this.state;
    const own = s[key];
    const themed = LEVEL_THEME_COLORS.some(([v]) => v === own);
    const fromCss = !!own && !themed && /^var\(/.test(own);
    const options = [['', 'Theme default']].concat(
      LEVEL_THEME_COLORS.map(([v, text]) => [v, text + ' (theme)']),
      fromCss ? [[own, 'From your CSS: ' + own]] : [],
      [['custom', 'Custom colour']],
    );
    const select = this.nativeSelect(form, {
      label, optional: true, options,
      value: !own ? '' : (themed || fromCss ? own : 'custom'),
      ariaLabel,
      onChange: (v) => {
        if (v === 'custom') s[key] = /^#/.test(own) ? own : '#808080';
        else s[key] = v;
        this.renderForm();
        this.touch();
      },
    });
    if (own && !themed && !fromCss) {
      const picker = select.parentElement.createEl('input', { type: 'color', value: own });
      picker.setAttribute('aria-label', 'Custom ' + ariaLabel.charAt(0).toLowerCase() + ariaLabel.slice(1));
      picker.addEventListener('input', () => {
        if (!isLevelColor(picker.value)) return;
        s[key] = picker.value;
        this.touch();
      });
    }
    return select;
  }

  renderChartColorFields(form, viz, seriesCount) {
    if (viz === 'combo') {
      this.colorField(form, { label: 'Scrub line colour', key: 'guideColor', ariaLabel: 'Colour of the line that follows the pointer' });
      return;
    }
    if ((viz !== 'line' && viz !== 'bar' && viz !== 'scatter') || seriesCount !== 1) return;
    this.colorField(form, {
      label: viz === 'line' ? 'Line colour' : (viz === 'scatter' ? 'Point colour' : 'Bar colour'), key: 'color',
      ariaLabel: viz === 'line' ? 'Colour of the line' : (viz === 'scatter' ? 'Colour of the points' : 'Colour of the bars'),
    });
    if (viz === 'line') {
      this.colorField(form, {
        label: 'Scrub line colour', key: 'guideColor',
        ariaLabel: 'Colour of the line that follows the pointer',
      });
    }
  }

  /* The form's range rows as checked ranges. Only a stat widget carries
   * them; the rows stay in the form if the chart type changes back. */
  levelsFromForm(viz) {
    if (!LEVEL_VIZ.has(viz)) return { ok: true, ranges: undefined };
    const colors = checkLevelColors(Object.keys(this.state.levelColors).length ? this.state.levelColors : undefined, viz, 'This widget');
    if (!colors.ok) return colors;
    if (!this.state.ranges.length) return { ok: true, ranges: undefined, colors: colors.colors };
    const raw = [];
    for (let i = 0; i < this.state.ranges.length; i++) {
      const row = this.state.ranges[i];
      const out = { level: row.level, label: row.label };
      for (const key of ['low', 'high']) {
        const text = String(row[key] === undefined ? '' : row[key]).trim();
        if (!text) continue;
        const n = Number(text);
        if (!Number.isFinite(n)) return { ok: false, reason: 'Range ' + (i + 1) + ': the ' + key + ' end must be a number, or left empty for no limit.' };
        out[key] = n;
      }
      raw.push(out);
    }
    const ranges = checkRanges(raw, viz, 'This widget');
    if (!ranges.ok) return ranges;
    return { ok: true, ranges: ranges.ranges, colors: colors.colors };
  }

  suggestedTitle() {
    const s = this.state;
    const eq = s.filters.find((f) => f.op === 'eq' && f.value);
    const what = eq ? eq.value : (s.agg === 'count' ? 'Rows' : s.metric);
    const how = s.agg === 'count' ? 'count' : (AGG_LABELS[s.agg] || '').toLowerCase();
    return what ? (what + (how && s.viz !== 'stat' ? ', ' + how : '')) : 'New widget';
  }

  /* The widget a save writes, from the built tile. */
  tileToSave(tile) {
    return keepUneditedKeys(tile, this.editIndex >= 0 ? this.spec.tiles[this.editIndex] : null);
  }

  /* Say before the save which settings of the widget being edited the
   * saved widget will not carry: a type change can leave some out (a
   * line chart has no value levels), and so can a cleared field. */
  showDropped(tile) {
    if (!this.dropNote) return;
    const existing = this.editIndex >= 0 ? this.spec.tiles[this.editIndex] : null;
    const dropped = tile ? droppedSettings(existing, this.tileToSave(tile)) : [];
    this.dropNote.setText(!dropped.length ? ''
      : (existing.viz !== tile.viz
        ? 'Saving as ' + (VIZ_NAMES[tile.viz] || tile.viz) + ' leaves out what this widget had: ' + dropped.join(', ') + '. Change the type back to keep them.'
        : 'Saving leaves out what this widget had: ' + dropped.join(', ') + '.'));
  }

  async runPreview() {
    const seq = ++this.previewSeq;
    const built = this.buildTile();
    this.showDropped(built.ok ? built.tile : null);
    if (!built.ok) {
      this.previewState = 'error';
      this.previewError = built.reason;
      this.previewEl.empty();
      this.syncGate();
      /* A widget still being set up (no columns picked yet) has a query
       * worth running anyway: its columns fill the pickers. */
      if (this.state.mode === 'sql' && gateStatement(this.state.sqlText).ok) {
        try {
          const res = await this.plugin.query.query(this.spec.database, this.state.sqlText, { cap: 20 });
          if (seq === this.previewSeq) { this.resultRows = res.rows; this.noteColumns(res.columns); }
        } catch (e) { /* the build error already says what to fix first */ }
      }
      return;
    }
    this.previewState = nextPreviewState(this.previewState, 'run');
    this.syncGate();
    if (drawsNoData(built.tile)) {
      /* Nothing to query: the preview is the divider, or the words, itself. */
      this.previewEl.empty();
      const cls = built.tile.viz === 'divider' ? ' is-divider' : ' is-text' + (built.tile.line === true ? ' is-line' : '');
      renderTile(this.previewEl.createDiv({ cls: 'icor-sqlv-tile is-preview' + cls }), built.tile, { columns: [], rows: [] }, {});
      this.previewState = nextPreviewState(this.previewState, 'ok');
      this.syncGate();
      return;
    }
    try {
      const tile = built.tile;
      const db = tileDatabase(tile, this.spec);
      const sql = tileSql(tile, this.spec.globalTimeframe ? this.spec : { globalTimeframe: DEFAULT_GLOBAL_TIMEFRAME });
      const res = await this.plugin.query.query(db, sql, { cap: 500 });
      let ghost = null;
      if (tile.source && tile.compare && tile.compare !== 'none' && canCompare(tile, this.spec.globalTimeframe)) {
        const shift = tile.compare === 'last_year' ? 'year' : 'previous';
        const ghostRes = await this.plugin.query.query(db, sqlForWidget(tile, this.spec.globalTimeframe, shift), { cap: 500 });
        ghost = { columns: ghostRes.columns, rows: ghostRes.rows };
      }
      if (seq !== this.previewSeq) return;
      this.previewEl.empty();
      const tileEl = this.previewEl.createDiv({ cls: 'icor-sqlv-tile is-preview' + (tile.viz === 'stat' ? ' is-stat' : '') });
      const prepared = prepareTileForRender(tile, res);
      renderTile(tileEl, prepared.spec, prepared.table, Object.assign({ ghost, compare: tile.compare, favorable: tile.favorable }, this.plugin.levelExtras()));
      if (!res.rows.length) this.previewEl.createDiv({ cls: 'icor-sqlv-note', text: 'The query ran but returned no rows. Check the filters and the period.' });
      this.previewState = nextPreviewState(this.previewState, 'ok');
      this.syncGate();
      if (!tile.source) { this.resultRows = res.rows; this.noteColumns(res.columns); }
    } catch (e) {
      if (seq !== this.previewSeq) return;
      this.previewState = nextPreviewState(this.previewState, 'error');
      this.previewError = e.message;
      this.previewEl.empty();
      this.previewEl.createDiv({ cls: 'icor-sqlv-error', text: e.message });
      this.syncGate();
    }
  }

  /* The query's columns arrived: redraw the form only when they changed,
   * and keep the cursor where it was in the SQL box. */
  noteColumns(columns) {
    const next = Array.isArray(columns) ? columns.map(String) : null;
    if (next && this.resultColumns && next.join('\u0000') === this.resultColumns.join('\u0000')) return;
    this.resultColumns = next;
    if (!this.formEl || this.state.mode === 'form') return;
    const doc = this.formEl.doc || (typeof document !== 'undefined' ? document : null);
    const active = doc && doc.activeElement;
    const inSql = !!(active && active.getAttribute && active.getAttribute('aria-label') === 'SQL query');
    const caret = inSql ? [active.selectionStart, active.selectionEnd] : null;
    this.renderForm();
    if (inSql) {
      const area = this.sqlArea;
      if (area && typeof area.focus === 'function') {
        area.focus();
        if (caret && typeof area.setSelectionRange === 'function') area.setSelectionRange(caret[0], caret[1]);
      }
    }
  }

  /* ---------------------------------------------------- form fields -- */

  /* A column of an SQL widget's query: a list of the result's columns once
   * the preview has run, else typed. A name not in the result stays,
   * marked, so nothing is lost while the query is being changed. */
  columnField(parent, { label, value, onChange, optional, noneLabel, ariaLabel }) {
    const cols = this.resultColumns;
    if (!cols || !cols.length) {
      const input = this.textInput(parent, {
        label, optional, value, ariaLabel,
        placeholder: optional ? 'column name (optional)' : 'column name',
        onInput: (v) => onChange(v.trim()),
      });
      return input;
    }
    const options = [['', optional ? (noneLabel || 'None') : 'Pick a column']].concat(cols.map((c) => [c, c]));
    if (value && !cols.includes(value)) options.push([value, value + ' (not in the result)']);
    return this.nativeSelect(parent, {
      label, optional, options, value: value || '', ariaLabel,
      onChange: (v) => { onChange(v); this.renderForm(); },
    });
  }

  /* A group of optional settings behind a toggle, like Advanced. Returns
   * the group's body, or null while it is closed. */
  optionGroup(parent, { key, label, hasValues }) {
    const s = this.state;
    if (s.groups[key] === undefined) s.groups[key] = !!hasValues;
    const open = s.groups[key];
    const wrap = parent.createDiv({ cls: 'icor-sqlv-advanced icor-sqlv-option-group' });
    const toggle = wrap.createEl('button', { cls: 'icor-sqlv-advanced-toggle', text: (open ? '▾ ' : '▸ ') + label });
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.addEventListener('click', () => { s.groups[key] = !open; this.renderForm(); });
    return open ? wrap.createDiv({ cls: 'icor-sqlv-option-body' }) : null;
  }

  field(parent, { label, required, optional }) {
    const row = parent.createDiv({ cls: 'icor-sqlv-field' });
    const lab = row.createDiv({ cls: 'icor-sqlv-field-label' });
    lab.createSpan({ text: label });
    if (required) lab.createSpan({ cls: 'icor-sqlv-field-required', text: ' (required)' });
    if (optional) lab.createSpan({ cls: 'icor-sqlv-field-optional', text: ' (optional)' });
    return row;
  }

  /* A searchable picker that expands inline under its field. */
  pickerField(parent, { key, label, required, optional, valueText, placeholder, getItems }) {
    const row = this.field(parent, { label, required, optional });
    const btn = row.createEl('button', { cls: 'icor-sqlv-picker' + (valueText ? '' : ' is-empty') });
    btn.createSpan({ text: valueText || placeholder });
    btn.createSpan({ cls: 'icor-sqlv-picker-chev', text: '▾' });
    btn.setAttribute('aria-label', label + (valueText ? ': ' + valueText : ''));
    btn.setAttribute('aria-expanded', this.openPicker === key ? 'true' : 'false');
    btn.addEventListener('click', () => {
      this.openPicker = this.openPicker === key ? '' : key;
      this.renderForm();
    });
    if (this.openPicker === key) {
      const panel = row.createDiv({ cls: 'icor-sqlv-picker-panel' });
      panel.createDiv({ cls: 'icor-sqlv-note', text: 'Loading …' });
      Promise.resolve(getItems()).then((items) => {
        if (this.openPicker !== key) return;
        panel.empty();
        searchList(panel, { items });
      }).catch((e) => {
        panel.empty();
        panel.createDiv({ cls: 'icor-sqlv-error', text: e.message });
      });
    }
    return row;
  }

  nativeSelect(parent, { label, optional, options, value, onChange, ariaLabel }) {
    const row = this.field(parent, { label, optional });
    const select = row.createEl('select', { cls: 'dropdown' });
    select.setAttribute('aria-label', ariaLabel || label);
    for (const [val, text] of options) {
      const opt = select.createEl('option', { text });
      opt.value = val;
      if (val === value) opt.selected = true;
    }
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  textInput(parent, { label, optional, value, placeholder, onInput, ariaLabel }) {
    const row = this.field(parent, { label, optional });
    const input = row.createEl('input', { type: 'text', cls: 'icor-sqlv-wizard-input', value: value || '' });
    if (placeholder) input.setAttribute('placeholder', placeholder);
    input.setAttribute('aria-label', ariaLabel || label);
    input.addEventListener('input', () => onInput(input.value));
    return input;
  }

  pick(mutate) {
    mutate();
    this.openPicker = '';
    this.renderForm();
    this.touch();
  }

  renderForm() {
    const s = this.state;
    const form = this.formEl;
    form.empty();

    if (s.mode === 'sql') { this.renderSqlForm(form); return; }
    if (s.mode === 'divider') { this.renderDividerForm(form); return; }
    if (s.mode === 'text') { this.renderTextForm(form); return; }
    if (this.editIndex < 0) {
      const divider = form.createEl('button', { text: 'Add a section divider instead', cls: 'icor-sqlv-add-filter' });
      divider.setAttribute('aria-label', 'Add a section divider: a thin line with an optional heading, no data');
      divider.addEventListener('click', () => this.toDivider());
      const text = form.createEl('button', { text: 'Add text instead', cls: 'icor-sqlv-add-filter' });
      text.setAttribute('aria-label', 'Add a text widget: plain words, written here or from a query');
      text.addEventListener('click', () => this.toText());
      const sql = form.createEl('button', { text: 'Write SQL instead', cls: 'icor-sqlv-add-filter' });
      sql.setAttribute('aria-label', 'Start this widget from an SQL query: every chart type, including combo, segments and heatmap');
      sql.addEventListener('click', () => { s.mode = 'sql'; s.x = ''; s.y = ''; this.openPicker = ''; this.renderForm(); this.touch(); });
    }

    this.pickerField(form, {
      key: 'database', label: 'Database', required: true,
      valueText: s.database ? baseName(s.database) : '',
      placeholder: 'Pick a database',
      getItems: () => this.plugin.vaultDatabases().map((db) => ({
        label: baseName(db.path), detail: db.path + '  ·  ' + formatBytes(db.size),
        selected: db.path === s.database,
        onPick: () => this.pick(() => {
          if (s.database !== db.path) { s.table = ''; s.metric = ''; s.series = ''; s.timeColumn = ''; s.filters = []; this.schema = null; }
          s.database = db.path;
          this.openPicker = 'table';
        }),
      })),
    });

    if (s.database) {
      this.pickerField(form, {
        key: 'table', label: 'Table', required: true,
        valueText: s.table, placeholder: 'Pick a table',
        getItems: async () => (await this.ensureSchema()).tables.map((t) => ({
          label: t.name, detail: t.unreadable ? "can't be read by the built-in engine (needs a SQLite module it doesn't have, e.g. FTS5)" : t.columns.length + ' columns',
          selected: t.name === s.table,
          onPick: () => this.pick(() => {
            if (s.table !== t.name) {
              s.metric = ''; s.series = ''; s.filters = [];
              s.timeColumn = guessTimeColumn(t.columns);
            }
            s.table = t.name;
          }),
        })),
      });
    }

    const table = this.tableInfo();
    if (s.table && table) {
      const numbers = table.columns.filter((c) => isNumericType(c.type));
      const texts = table.columns.filter((c) => isTextType(c.type));

      this.pickerField(form, {
        key: 'metric', label: 'Value', required: true,
        valueText: s.agg === 'count' ? 'Count rows' : s.metric,
        placeholder: 'What to measure',
        getItems: () => {
          const items = [{
            label: 'Count rows', detail: 'how many rows match',
            selected: s.agg === 'count',
            onPick: () => this.pick(() => { s.metric = ''; s.agg = 'count'; }),
          }];
          for (const c of numbers) {
            items.push({
              group: 'Numbers', label: c.name, detail: c.type,
              selected: s.agg !== 'count' && s.metric === c.name,
              onPick: () => this.pick(() => { s.metric = c.name; if (s.agg === 'count') s.agg = 'sum'; }),
            });
          }
          return items;
        },
      });

      this.pickerField(form, {
        key: 'timeColumn', label: 'Date', optional: true,
        valueText: s.timeColumn, placeholder: 'Which column holds the time',
        getItems: () => [{
          label: 'None', detail: 'no time axis',
          selected: !s.timeColumn,
          onPick: () => this.pick(() => { s.timeColumn = ''; s.compare = 'none'; }),
        }].concat(table.columns.filter((c) => isTextType(c.type) || /INT/i.test(String(c.type))).map((c) => ({
          label: c.name,
          selected: s.timeColumn === c.name,
          onPick: () => this.pick(() => { s.timeColumn = c.name; }),
        }))),
      });

      this.pickerField(form, {
        key: 'series', label: 'Dimension', optional: true,
        valueText: s.series ? 'By ' + s.series : '',
        placeholder: 'Split into series',
        getItems: () => [{
          label: 'No split',
          selected: !s.series,
          onPick: () => this.pick(() => { s.series = ''; }),
        }].concat(texts.map((c) => ({
          label: 'By ' + c.name,
          selected: s.series === c.name,
          onPick: () => this.pick(() => { s.series = c.name; s.compare = 'none'; if (s.viz === 'stat') s.viz = 'bar'; }),
        }))),
      });

      this.pickerField(form, {
        key: 'groupBy', label: 'Group by', optional: true,
        valueText: s.groupBy ? 'By ' + s.groupBy : '',
        placeholder: 'The date (default)',
        getItems: () => [{
          label: 'The date', detail: 'one point per day, week or month',
          selected: !s.groupBy,
          onPick: () => this.pick(() => { s.groupBy = ''; }),
        }].concat(table.columns.map((c) => ({
          label: 'By ' + c.name, detail: c.type,
          selected: s.groupBy === c.name,
          onPick: () => this.pick(() => { s.groupBy = c.name; }),
        }))),
      });

      this.renderFilters(form, table, texts);

      this.nativeSelect(form, {
        label: 'Add it up', options: Object.entries(AGG_LABELS).map(([k, v]) => [k, v]),
        value: s.agg,
        onChange: (v) => { s.agg = v; if (v === 'latest') s.viz = 'stat'; this.renderForm(); this.touch(); },
      });

      if (s.timeColumn && !s.series) {
        this.nativeSelect(form, {
          label: 'Compare with', optional: true,
          options: Object.entries(COMPARE_LABELS).map(([k, v]) => [k, v]),
          value: s.compare,
          onChange: (v) => { s.compare = v; this.renderForm(); this.touch(); },
        });
        if (s.compare !== 'none') {
          this.nativeSelect(form, {
            label: 'Good direction',
            options: [['up', 'Up is good'], ['down', 'Down is good (costs, open tasks)']],
            value: s.favorable,
            onChange: (v) => { s.favorable = v; this.touch(); },
            ariaLabel: 'Which direction counts as good for this metric',
          });
        }
      }

      this.textInput(form, {
        label: 'Widget name', value: s.title, placeholder: this.suggestedTitle(),
        onInput: (v) => { s.title = v; this.touch(); },
      });

      const vizOptions = s.agg === 'latest' ? [['stat', 'One big number']]
        : [['line', 'Line chart'], ['bar', 'Bar chart'], ['stat', 'One big number']];
      this.nativeSelect(form, {
        label: 'Chart type', options: vizOptions.concat([['divider', 'Section divider']]), value: s.viz,
        onChange: (v) => { if (v === 'divider') { this.toDivider(); return; } s.viz = v; this.renderForm(); this.touch(); },
      });
      if (s.series && s.viz === 'bar') {
        const stackRow = form.createDiv({ cls: 'icor-sqlv-wizard-toggle' });
        const cb = stackRow.createEl('input', { type: 'checkbox' });
        cb.checked = s.stack;
        cb.setAttribute('id', 'icor-sqlv-stack');
        const lbl = stackRow.createEl('label', { text: 'Stack the series on top of each other' });
        lbl.setAttribute('for', 'icor-sqlv-stack');
        cb.addEventListener('change', () => { s.stack = cb.checked; this.touch(); });
      }

      this.renderRanges(form, s.agg === 'latest' ? 'stat' : s.viz);
      this.renderHeaderDeltaFields(form, s.agg === 'latest' ? 'stat' : s.viz, s.series ? 2 : 1);
      this.renderValueSizeField(form, s.agg === 'latest' ? 'stat' : s.viz);
      this.renderChartColorFields(form, s.agg === 'latest' ? 'stat' : s.viz, s.series ? 2 : 1);
      this.renderOptionGroups(form, s.agg === 'latest' ? 'stat' : s.viz, true);

      this.nativeSelect(form, {
        label: 'Size', options: [['', 'Keep as is']].concat(Object.entries(SIZE_PRESETS).map(([k, p]) => [k, p.label])).slice(this.editIndex >= 0 ? 0 : 1),
        value: s.sizeKey,
        onChange: (v) => { s.sizeKey = v; },
        ariaLabel: 'Widget size on the grid',
      });

      this.nativeSelect(form, {
        label: 'Time frame',
        options: [['global', 'Follow the dashboard']].concat(Object.entries(PRESET_LABELS).map(([k, v]) => [k, v])),
        value: s.timeframe === 'global' ? 'global' : (s.timeframe && s.timeframe.preset) || 'global',
        onChange: (v) => { s.timeframe = v === 'global' ? 'global' : { preset: v }; this.touch(); },
        ariaLabel: 'Time frame for this widget',
      });

      this.textInput(form, {
        label: 'Unit', optional: true, value: s.unit, placeholder: 'orders, %, hours …',
        onInput: (v) => { s.unit = v; this.touch(); },
      });

      this.renderAdvanced(form);
    } else if (s.table) {
      /* The table's columns are loading, or cannot be read on this
       * device: the fields that need no columns stay editable, so a
       * widget can always be renamed. */
      form.createDiv({ cls: 'icor-sqlv-note', text: this.schemaError
        ? 'The columns of ' + s.table + ' cannot be read here: ' + this.schemaError + ' The name and unit can still be changed.'
        : 'Loading the columns of ' + s.table + ' …' });
      this.textInput(form, {
        label: 'Widget name', value: s.title, placeholder: this.suggestedTitle(),
        onInput: (v) => { s.title = v; this.touch(); },
      });
      this.textInput(form, {
        label: 'Unit', optional: true, value: s.unit, placeholder: 'orders, %, hours …',
        onInput: (v) => { s.unit = v; this.touch(); },
      });
    }
  }

  renderFilters(form, table, texts) {
    const s = this.state;
    const wrap = this.field(form, { label: 'Filter data', optional: true });
    const rows = wrap.createDiv({ cls: 'icor-sqlv-filter-rows' });
    s.filters.forEach((row, i) => {
      const rowEl = rows.createDiv({ cls: 'icor-sqlv-filter-row-edit' });
      const col = rowEl.createEl('select', { cls: 'dropdown' });
      col.setAttribute('aria-label', 'Filter column');
      for (const c of table.columns) {
        const opt = col.createEl('option', { text: c.name });
        opt.value = c.name;
        if (c.name === row.column) opt.selected = true;
      }
      col.addEventListener('change', () => { row.column = col.value; row.value = ''; this.renderForm(); this.touch(); });
      const op = rowEl.createEl('select', { cls: 'dropdown' });
      op.setAttribute('aria-label', 'Filter condition');
      for (const [key, def] of Object.entries(FILTER_OPS)) {
        const opt = op.createEl('option', { text: def.label });
        opt.value = key;
        if (key === (row.op || 'eq')) opt.selected = true;
      }
      op.addEventListener('change', () => { row.op = op.value; this.renderForm(); this.touch(); });
      if (!FILTER_OPS[row.op || 'eq'].noValue) {
        const isCategory = texts.some((c) => c.name === row.column) && (row.op || 'eq') === 'eq';
        if (isCategory) {
          const btn = rowEl.createEl('button', { cls: 'icor-sqlv-picker' + (row.value ? '' : ' is-empty') });
          btn.createSpan({ text: row.value || 'Pick a value' });
          btn.createSpan({ cls: 'icor-sqlv-picker-chev', text: '▾' });
          btn.setAttribute('aria-label', 'Filter value for ' + row.column);
          btn.addEventListener('click', () => {
            this.openPicker = this.openPicker === 'filter-' + i ? '' : 'filter-' + i;
            this.renderForm();
          });
        } else {
          const input = rowEl.createEl('input', { type: 'text', cls: 'icor-sqlv-wizard-input', value: row.value === undefined ? '' : String(row.value) });
          input.setAttribute('aria-label', 'Filter value for ' + row.column);
          input.addEventListener('input', () => { row.value = input.value; this.touch(); });
        }
      }
      const remove = rowEl.createEl('button', { cls: 'icor-sqlv-tile-action icor-sqlv-filter-remove' });
      setIcon(remove, 'x');
      remove.setAttribute('aria-label', 'Remove this filter');
      remove.addEventListener('click', () => { s.filters.splice(i, 1); this.renderForm(); this.touch(); });
      if (this.openPicker === 'filter-' + i) {
        const panel = rows.createDiv({ cls: 'icor-sqlv-picker-panel' });
        panel.createDiv({ cls: 'icor-sqlv-note', text: 'Loading values …' });
        this.plugin.distinctValues(s.database, s.table, row.column).then((values) => {
          if (this.openPicker !== 'filter-' + i) return;
          panel.empty();
          if (values.truncated) panel.createDiv({ cls: 'icor-sqlv-note', text: 'Showing the first 200 values.' });
          searchList(panel, {
            items: values.values.map((v) => ({
              label: v, selected: row.value === v,
              onPick: () => this.pick(() => { row.value = v; }),
            })),
          });
        }).catch((e) => {
          /* No value list on this device: degrade to typed entry, with the
           * column named, instead of a dead end. */
          if (this.openPicker !== 'filter-' + i) return;
          panel.empty();
          panel.createDiv({ cls: 'icor-sqlv-note', text: e.message });
          const input = panel.createEl('input', { type: 'text', cls: 'icor-sqlv-wizard-input', value: row.value || '' });
          input.setAttribute('placeholder', 'Exact value of ' + row.column);
          input.setAttribute('aria-label', 'Exact value of ' + row.column);
          const use = panel.createEl('button', { text: 'Use this value' });
          use.addEventListener('click', () => this.pick(() => { row.value = input.value; }));
          if (typeof input.focus === 'function') input.focus();
        });
      }
    });
    const add = wrap.createEl('button', { text: '+ Add filter', cls: 'icor-sqlv-add-filter' });
    add.addEventListener('click', () => {
      s.filters.push({ column: (texts[0] && texts[0].name) || (table.columns[0] && table.columns[0].name) || '', op: 'eq', value: '' });
      this.renderForm();
    });
    if (s.filters.length > 1) wrap.createDiv({ cls: 'icor-sqlv-note', text: 'All filter rows must match (AND).' });
  }

  /* Value levels: which level the headline number lands on. One row per
   * range, the first that holds the number wins. The levels themselves
   * (names and colours) live in the plugin settings. */
  renderRanges(form, viz) {
    if (!LEVEL_VIZ.has(viz)) return;
    const s = this.state;
    const levels = (this.plugin.settings && this.plugin.settings.levels) || [];
    const names = levels.map((l) => l.name);
    const wrap = this.field(form, { label: 'Value levels', optional: true });
    const what = viz === 'segments' ? 'Mark the whole bar, and show a pill, by where the judged value lands.'
      : viz === 'pie' ? 'Mark the whole chart, and show a pill, by where the judged value lands.'
      : viz === 'heatmap' ? 'Colour each cell by where its value lands.'
      : viz === 'calendar' ? 'Colour each day by where its value lands.'
      : viz === 'bullet' ? 'Shade the scale behind the bars in bands, by where each range falls.'
      : 'Colour the number by where it lands.';
    wrap.createDiv({ cls: 'icor-sqlv-note', text: what + ' The first range that holds it wins; leave low or high empty for no limit. The levels and their colours live in the plugin settings.' });
    const rows = wrap.createDiv({ cls: 'icor-sqlv-filter-rows icor-sqlv-range-rows' });
    s.ranges.forEach((row, i) => {
      const at = 'Range ' + (i + 1);
      const rowEl = rows.createDiv({ cls: 'icor-sqlv-filter-row-edit icor-sqlv-range-row' });
      for (const key of ['low', 'high']) {
        const input = rowEl.createEl('input', { type: 'text', cls: 'icor-sqlv-wizard-input icor-sqlv-range-num', value: row[key] });
        input.setAttribute('placeholder', key === 'low' ? 'from' : 'to');
        input.setAttribute('inputmode', 'decimal');
        input.setAttribute('aria-label', at + ': ' + (key === 'low' ? 'lowest value (empty for no limit)' : 'highest value (empty for no limit)'));
        input.addEventListener('input', () => { row[key] = input.value; this.touch(); });
      }
      const select = rowEl.createEl('select', { cls: 'dropdown' });
      select.setAttribute('aria-label', at + ': level');
      const options = names.includes(row.level) || !row.level ? names : names.concat([row.level]);
      for (const name of options) {
        const opt = select.createEl('option', { text: names.includes(name) ? name : name + ' (not in settings)' });
        opt.value = name;
        if (name === row.level) opt.selected = true;
      }
      select.addEventListener('change', () => { row.level = select.value; this.touch(); });
      const label = rowEl.createEl('input', { type: 'text', cls: 'icor-sqlv-wizard-input', value: row.label });
      label.setAttribute('placeholder', 'pill text (optional)');
      label.setAttribute('aria-label', at + ': short text shown as a pill (optional)');
      label.addEventListener('input', () => { row.label = label.value; this.touch(); });
      const remove = rowEl.createEl('button', { cls: 'icor-sqlv-tile-action icor-sqlv-filter-remove' });
      setIcon(remove, 'x');
      remove.setAttribute('aria-label', 'Remove ' + at.toLowerCase());
      remove.addEventListener('click', () => { s.ranges.splice(i, 1); this.renderForm(); this.touch(); });
    });
    if (!names.length) {
      wrap.createDiv({ cls: 'icor-sqlv-note', text: 'No levels are set up yet. Add them in the plugin settings first.' });
      return;
    }
    const isCatchAll = (r) => !String(r.low).trim() && !String(r.high).trim();
    const hasCatchAll = s.ranges.length > 0 && isCatchAll(s.ranges[s.ranges.length - 1]);
    const add = wrap.createEl('button', { text: '+ Add range', cls: 'icor-sqlv-add-filter' });
    add.addEventListener('click', () => {
      const row = { low: '', high: '', level: names[0], label: '' };
      /* A new range goes before the catch-all, which must stay last. */
      if (hasCatchAll) s.ranges.splice(s.ranges.length - 1, 0, row);
      else s.ranges.push(row);
      this.renderForm();
      this.touch();
    });
    if (!hasCatchAll) {
      const other = wrap.createEl('button', { text: '+ Anything else', cls: 'icor-sqlv-add-filter' });
      other.setAttribute('aria-label', 'Add a last range that catches every other number');
      other.addEventListener('click', () => {
        s.ranges.push({ low: '', high: '', level: names[names.length - 1], label: '' });
        this.renderForm();
        this.touch();
      });
    }
    this.renderLevelColors(wrap, levels);
  }

  /* A per-widget colour for a level. The level keeps its name; only the
   * colour changes, and the form says so plainly, with a way back. */
  renderLevelColors(wrap, levels) {
    const s = this.state;
    const overridden = Object.keys(s.levelColors).length > 0;
    const box = wrap.createDiv({ cls: 'icor-sqlv-level-colors' + (overridden ? ' is-overridden' : '') });
    const head = box.createDiv({ cls: 'icor-sqlv-level-colors-head' });
    head.createSpan({ cls: 'icor-sqlv-field-label', text: 'Colours for this widget' });
    if (overridden) {
      head.createSpan({ cls: 'icor-sqlv-level-override-mark', text: 'Changed for this widget' });
      const reset = head.createEl('button', { text: 'Reset to settings' });
      reset.setAttribute('aria-label', 'Use the colours from the plugin settings again');
      reset.addEventListener('click', () => { s.levelColors = {}; this.renderForm(); this.touch(); });
    }
    for (const level of levels) {
      const own = s.levelColors[level.name];
      const row = box.createDiv({ cls: 'icor-sqlv-filter-row-edit icor-sqlv-level-color-row' + (own ? ' is-overridden' : '') });
      const swatch = row.createSpan({ cls: 'icor-sqlv-level-swatch' });
      if (isLevelColor(own || level.color)) swatch.style.setProperty('--sqlv-level-color', (own || level.color).trim());
      row.createSpan({ cls: 'icor-sqlv-level-color-name', text: level.name + (own ? ' (changed)' : '') });
      const themed = !own || LEVEL_THEME_COLORS.some(([v]) => v === own);
      const select = row.createEl('select', { cls: 'dropdown' });
      select.setAttribute('aria-label', 'Colour of ' + level.name + ' on this widget');
      const options = [['', 'Settings colour']].concat(LEVEL_THEME_COLORS.map(([v, text]) => [v, text + ' (theme)']), [['custom', 'Custom colour']]);
      for (const [value, text] of options) {
        const opt = select.createEl('option', { text });
        opt.value = value;
        if (value === (own ? (themed ? own : 'custom') : '')) opt.selected = true;
      }
      select.addEventListener('change', () => {
        if (!select.value) delete s.levelColors[level.name];
        else if (select.value === 'custom') s.levelColors[level.name] = own && /^#/.test(own) ? own : '#808080';
        else s.levelColors[level.name] = select.value;
        this.renderForm();
        this.touch();
      });
      if (own && !themed) {
        const picker = row.createEl('input', { type: 'color', value: own });
        picker.setAttribute('aria-label', 'Custom colour of ' + level.name + ' on this widget');
        picker.addEventListener('input', () => {
          if (!isLevelColor(picker.value)) return;
          s.levelColors[level.name] = picker.value;
          swatch.style.setProperty('--sqlv-level-color', picker.value);
          this.touch();
        });
      }
    }
  }

  renderAdvanced(form) {
    const s = this.state;
    const adv = form.createDiv({ cls: 'icor-sqlv-advanced' });
    const toggle = adv.createEl('button', { cls: 'icor-sqlv-advanced-toggle', text: (s.advancedOpen ? '▾' : '▸') + ' Advanced' });
    toggle.setAttribute('aria-expanded', s.advancedOpen ? 'true' : 'false');
    toggle.addEventListener('click', () => { s.advancedOpen = !s.advancedOpen; this.renderForm(); });
    if (!s.advancedOpen) return;
    const built = this.buildTile();
    const pre = adv.createEl('pre', { cls: 'icor-sqlv-sql-pre' });
    pre.setText(built.ok ? tileSql(built.tile, this.spec) : 'The form is not complete yet: ' + built.reason);
    const note = adv.createDiv({ cls: 'icor-sqlv-note', text: 'This is the query the widget runs, read-only. Editing it as SQL is a one-way door: the form fields go away for this widget and only the SQL stays.' });
    const convert = adv.createEl('button', { text: 'Edit as SQL' });
    if (s.series) {
      convert.disabled = true;
      adv.createDiv({ cls: 'icor-sqlv-note', text: 'A widget split into series cannot convert: its chart needs the split the form provides. Remove the dimension first.' });
    }
    convert.addEventListener('click', () => {
      if (!built.ok) { new Notice('Finish the form first: ' + built.reason); return; }
      new ConfirmModal(this.plugin.app, {
        title: 'Edit as SQL?',
        body: 'This widget becomes a plain SQL query. The form (value, date, filters, aggregation) goes away for it and cannot be brought back; the SQL stays editable. Nothing happens to your data.',
        cta: 'Edit as SQL',
        onConfirm: () => {
          s.mode = 'sql';
          s.sqlText = tileSql(built.tile, this.spec);
          s.viz = built.tile.viz;
          s.x = built.tile.viz === 'stat' ? '' : 'x';
          s.y = 'value';
          s.title = s.title || built.tile.title;
          this.renderForm();
          this.touch();
        },
      }).open();
    });
    void note;
  }

  toDivider() {
    const s = this.state;
    s.dataMode = s.mode === 'sql' ? 'sql' : 'form';
    s.mode = 'divider';
    if (!s.dividerWidth && this.editIndex < 0) s.dividerWidth = String(GRID_MAX_COLS);
    this.openPicker = '';
    this.renderForm();
    this.touch();
  }

  toText() {
    const s = this.state;
    if (s.mode !== 'divider' && s.mode !== 'text') s.dataMode = s.mode === 'sql' ? 'sql' : 'form';
    if (s.mode === 'sql' && s.sqlText.trim()) s.textFrom = 'sql';
    s.mode = 'text';
    this.openPicker = '';
    this.renderForm();
    this.touch();
  }

  /* The text form: words written here or from a query, as a card with a
   * title or as one thin line. */
  renderTextForm(form) {
    const s = this.state;
    this.nativeSelect(form, {
      label: 'Widget type',
      options: [['text', 'Text'], ['divider', 'Section divider'], ['data', 'A widget with data']],
      value: 'text',
      onChange: (v) => {
        if (v === 'divider') { this.toDivider(); return; }
        if (v === 'data') { s.mode = s.dataMode || 'form'; this.renderForm(); this.touch(); }
      },
    });
    form.createDiv({ cls: 'icor-sqlv-note', text: 'Plain words on the dashboard, written here or taken from the first column of a query’s first row. Plain text, not Markdown: a blank line starts a paragraph.' });
    this.nativeSelect(form, {
      label: 'The words come from',
      options: [['text', 'Written here'], ['sql', 'A query (its first column, first row)']],
      value: s.textFrom,
      onChange: (v) => { s.textFrom = v; this.renderForm(); this.touch(); },
    });
    if (s.textFrom === 'sql') {
      const sqlField = this.field(form, { label: 'SQL', required: true });
      const area = sqlField.createEl('textarea', { cls: 'icor-sqlv-console' });
      area.value = s.sqlText;
      area.setAttribute('rows', '5');
      area.setAttribute('aria-label', 'SQL query');
      area.addEventListener('input', () => { s.sqlText = area.value; this.touch(); });
      this.sqlArea = area;
    } else {
      const row = this.field(form, { label: 'Text', required: true });
      const area = row.createEl('textarea', { cls: 'icor-sqlv-wizard-input' });
      area.value = s.textBody;
      area.setAttribute('rows', '4');
      area.setAttribute('aria-label', 'Text of the widget');
      area.addEventListener('input', () => { s.textBody = area.value; this.touch(); });
    }
    const lineRow = form.createDiv({ cls: 'icor-sqlv-wizard-toggle' });
    const cb = lineRow.createEl('input', { type: 'checkbox' });
    cb.checked = s.textLine;
    cb.setAttribute('id', 'icor-sqlv-text-line');
    cb.setAttribute('aria-label', 'One thin line, like a section divider');
    const lbl = lineRow.createEl('label', { text: 'One thin line, like a section divider (no title)' });
    lbl.setAttribute('for', 'icor-sqlv-text-line');
    cb.addEventListener('change', () => {
      s.textLine = cb.checked;
      if (s.textLine && !s.dividerWidth && this.editIndex < 0) s.dividerWidth = String(GRID_MAX_COLS);
      this.renderForm();
      this.touch();
    });
    if (!s.textLine) {
      this.textInput(form, { label: 'Title', optional: true, value: s.title, placeholder: 'no title', onInput: (v) => { s.title = v; this.touch(); } });
    }
    this.renderOptionGroups(form, 'text', false);
    if (s.textLine) {
      this.nativeSelect(form, {
        label: 'Width',
        options: (this.editIndex >= 0 ? [['', 'Keep as is']] : []).concat([[String(GRID_MAX_COLS), 'Full width'], ['3', 'Half'], ['2', 'A third'], ['1', 'One cell']]),
        value: s.dividerWidth,
        onChange: (v) => { s.dividerWidth = v; },
        ariaLabel: 'Width of the text line on the grid',
      });
    } else {
      this.nativeSelect(form, {
        label: 'Size', options: [['', 'Keep as is']].concat(Object.entries(SIZE_PRESETS).map(([k, p]) => [k, p.label])).slice(this.editIndex >= 0 ? 0 : 1),
        value: s.sizeKey,
        onChange: (v) => { s.sizeKey = v; },
        ariaLabel: 'Widget size on the grid',
      });
    }
  }

  /* The divider form: a heading and a width. No database, no query. */
  renderDividerForm(form) {
    const s = this.state;
    this.nativeSelect(form, {
      label: 'Widget type',
      options: [['divider', 'Section divider'], ['text', 'Text'], ['data', 'A widget with data']],
      value: 'divider',
      onChange: (v) => { if (v === 'text') { this.toText(); return; } if (v === 'data') { s.mode = s.dataMode || 'form'; this.renderForm(); this.touch(); } },
    });
    form.createDiv({ cls: 'icor-sqlv-note', text: 'A thin line across the dashboard that separates groups of widgets, with an optional heading. In edit mode, drag its right end to change its width.' });
    this.textInput(form, {
      label: 'Heading', optional: true, value: s.title, placeholder: 'Sales, Costs, Projects …',
      onInput: (v) => { s.title = v; this.touch(); },
    });
    this.nativeSelect(form, {
      label: 'Width',
      options: (this.editIndex >= 0 ? [['', 'Keep as is']] : []).concat([[String(GRID_MAX_COLS), 'Full width'], ['3', 'Half'], ['2', 'A third'], ['1', 'One cell']]),
      value: s.dividerWidth,
      onChange: (v) => { s.dividerWidth = v; },
      ariaLabel: 'Width of the divider on the grid',
    });
  }

  /* The option groups under a widget's own fields, in the order a reader
   * meets them on the widget. */
  renderOptionGroups(form, viz, built) {
    this.renderMeterFields(form, viz);
    this.renderAxisFields(form, viz);
    if (viz === 'combo') this.renderRightAxisFields(form);
    this.renderMarkFields(form, viz);
    this.renderBandFields(form, viz, built);
    this.renderNotesFields(form, viz);
  }

  renderSqlForm(form) {
    const s = this.state;
    form.createDiv({ cls: 'icor-sqlv-note', text: 'This widget is written in SQL. It runs read-only: one statement, starting with SELECT, WITH, PRAGMA or EXPLAIN.' });
    this.textInput(form, {
      label: 'Widget name', value: s.title, placeholder: 'SQL widget',
      onInput: (v) => { s.title = v; this.touch(); },
    });
    const sqlField = this.field(form, { label: 'SQL', required: true });
    const area = sqlField.createEl('textarea', { cls: 'icor-sqlv-console' });
    area.value = s.sqlText;
    area.setAttribute('rows', '6');
    area.setAttribute('aria-label', 'SQL query');
    area.addEventListener('input', () => { s.sqlText = area.value; this.touch(); });
    this.sqlArea = area;
    this.nativeSelect(form, {
      label: 'Chart type',
      options: SQL_FORM_VIZ,
      value: s.viz,
      onChange: (v) => { if (v === 'divider') { this.toDivider(); return; } if (v === 'text') { this.toText(); return; } s.viz = v; if (v === 'bullet' && s.x === 'x') s.x = ''; this.renderForm(); this.touch(); },
    });
    if (s.viz === 'segments') this.renderSegmentsFields(form);
    if (s.viz === 'pie') this.renderPieFields(form);
    if (s.viz === 'heatmap') this.renderHeatmapFields(form);
    if (s.viz === 'calendar') this.renderCalendarFields(form);
    if (s.viz === 'bullet') this.renderBulletFields(form);
    if (s.viz === 'combo') this.renderComboFields(form);
    if (s.viz === 'scatter') this.renderScatterFields(form);
    if (s.viz === 'line' || s.viz === 'bar') {
      this.columnField(form, { label: 'X column', value: s.x, onChange: (v) => { s.x = v; this.touch(); } });
      const yInput = this.textInput(form, { label: 'Y columns (comma-separated)', value: s.y, onInput: (v) => { s.y = v; this.touch(); } });
      /* Leaving the field redraws the form, so stacking shows for two bars. */
      yInput.addEventListener('change', () => this.renderForm());
      if (s.viz === 'bar' && s.y.split(',').map((v) => v.trim()).filter(Boolean).length > 1) {
        const row = form.createDiv({ cls: 'icor-sqlv-wizard-toggle' });
        const cb = row.createEl('input', { type: 'checkbox' });
        cb.checked = s.stack === true;
        cb.setAttribute('id', 'icor-sqlv-sql-stack');
        cb.setAttribute('aria-label', 'Stack the bars on top of each other');
        const lbl = row.createEl('label', { text: 'Stack the bars on top of each other' });
        lbl.setAttribute('for', 'icor-sqlv-sql-stack');
        cb.addEventListener('change', () => { s.stack = cb.checked; this.touch(); });
      }
    }
    this.textInput(form, {
      label: 'Unit', optional: true, value: s.unit, placeholder: 'orders, %, hours …',
      onInput: (v) => { s.unit = v; this.touch(); },
    });
    this.renderRanges(form, s.viz);
    this.renderHeaderDeltaFields(form, s.viz, s.y.split(',').map((v) => v.trim()).filter(Boolean).length);
    this.renderChartColorFields(form, s.viz, s.viz === 'scatter' && s.scatterColorBy ? 2 : s.y.split(',').map((v) => v.trim()).filter(Boolean).length);
    if (s.viz === 'stat') {
      this.columnField(form, {
        label: 'Value column', optional: true, noneLabel: 'The first column', value: s.y.split(',')[0].trim(),
        onChange: (v) => { s.y = v; this.touch(); },
      });
      this.textInput(form, {
        label: 'Judge the ranges on column', optional: true, value: s.rangeColumn,
        placeholder: 'empty: the shown value',
        onInput: (v) => { s.rangeColumn = v; this.touch(); },
      });
      this.textInput(form, {
        label: 'Caption columns (comma-separated)', optional: true, value: s.captions,
        placeholder: 'empty: the next column',
        onInput: (v) => { s.captions = v; this.touch(); },
      });
      this.renderValueSizeField(form, s.viz);
    }
    if (s.viz === 'table') {
      this.textInput(form, {
        label: 'Sparkline columns (comma-separated)', optional: true, value: s.sparklines,
        placeholder: 'empty: no sparklines',
        onInput: (v) => { s.sparklines = v; this.touch(); },
      });
    }
    if (isPartsViz(s.viz)) {
      this.columnField(form, { label: 'Judge the ranges on column', optional: true, noneLabel: 'None (needed when there are ranges)', value: s.rangeColumn, onChange: (v) => { s.rangeColumn = v; this.touch(); } });
      this.renderSegmentColors(form);
    }
    if (s.viz === 'heatmap') this.renderHeatmapExtras(form);
    this.renderOptionGroups(form, s.viz, false);
    this.nativeSelect(form, {
      label: 'Size', options: [['', 'Keep as is']].concat(Object.entries(SIZE_PRESETS).map(([k, p]) => [k, p.label])).slice(this.editIndex >= 0 ? 0 : 1),
      value: s.sizeKey,
      onChange: (v) => { s.sizeKey = v; },
      ariaLabel: 'Widget size on the grid',
    });
  }

  async save() {
    if (!canSave(this.previewState)) return;
    const built = this.buildTile();
    if (!built.ok) { new Notice(built.reason); return; }
    const existing = this.editIndex >= 0 ? this.spec.tiles[this.editIndex] : null;
    const tile = this.tileToSave(built.tile);
    if (isThinTile(tile)) {
      /* One thin row (a divider, a text line); only the width is chosen. */
      const w = Number(this.state.dividerWidth) || (existing && existing.layout ? existing.layout.w : GRID_MAX_COLS);
      if (existing && existing.layout) {
        tile.layout = { x: existing.layout.x, y: existing.layout.y, w, h: 1 };
      } else {
        tile.layout = findSpot(normalizeLayout(this.spec.tiles, GRID_MAX_COLS), { w, h: 1 }, GRID_MAX_COLS);
      }
    } else if (this.state.sizeKey && SIZE_PRESETS[this.state.sizeKey]) {
      const p = SIZE_PRESETS[this.state.sizeKey];
      if (existing && existing.layout) {
        tile.layout = { x: existing.layout.x, y: existing.layout.y, w: p.w, h: p.h };
      } else {
        const layouts = normalizeLayout(this.spec.tiles, GRID_MAX_COLS);
        tile.layout = findSpot(layouts, { w: p.w, h: p.h }, GRID_MAX_COLS);
      }
    } else if (existing && existing.layout) {
      tile.layout = existing.layout;
    }
    if (this.editIndex >= 0) this.spec.tiles[this.editIndex] = tile;
    else this.spec.tiles.push(tile);
    this.close();
    await this.view.saveAndRender(this.spec);
  }
}

/* --------------------------------------------------- the index modal -- */

class DatabaseIndexModal extends Modal {
  constructor(plugin, onPick) {
    super(plugin.app);
    this.plugin = plugin;
    this.onPick = onPick || null;
  }

  onOpen() {
    this.titleEl.setText('Databases in this vault');
    (this.modalEl || this.contentEl).setAttribute('data-ink-plugin', 'icor-for-life-sqlite-viewer');
    const { contentEl } = this;
    contentEl.empty();
    const dbs = this.plugin.vaultDatabases();
    if (!dbs.length) {
      contentEl.createDiv({ text: 'No SQLite databases found. Files ending in .db, .sqlite or .sqlite3 would be listed here.' });
      return;
    }
    const list = contentEl.createDiv({ cls: 'icor-sqlv-index' });
    for (const db of dbs) {
      const row = list.createDiv({ cls: 'icor-sqlv-index-row' });
      const label = row.createDiv({ cls: 'icor-sqlv-index-path' });
      label.createSpan({ text: baseName(db.path) });
      label.createDiv({ cls: 'icor-sqlv-index-folder', text: db.path });
      row.createSpan({ cls: 'icor-sqlv-index-size', text: formatBytes(db.size) });
      row.addEventListener('click', async () => {
        this.close();
        if (this.onPick) this.onPick(db.path);
        else await this.plugin.openBrowserFor(db.path);
      });
    }
  }

  onClose() { this.contentEl.empty(); }
}

/* ------------------------------------------------------- the settings -- */

class SqliteViewerSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createDiv({ cls: 'icor-sqlv-note', text: 'ReadOut reads every database with its built-in engine, on every device. It starts no other program. The engine loads the whole file into memory, up to the size cap below.' });

    new Setting(containerEl)
      .setName('Rows per page')
      .setDesc('How many rows the data browser shows at a time.')
      .addText((t) => t.setValue(String(this.plugin.settings.pageSize)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n >= 5 && n <= 1000) { this.plugin.settings.pageSize = n; await this.plugin.saveSettings(); }
      }));

    new Setting(containerEl)
      .setName('Search for databases in')
      .setDesc('Where ReadOut looks for database files (.db, .sqlite, .sqlite3) to list them in the browser, the index and the widget form. "Whole vault" looks through every folder by name; it reads no note and no file other than a database you open. Clicking a database anywhere, or naming one in a dashboard, works either way.')
      .addDropdown((d) => {
        d.addOption('vault', 'Whole vault');
        d.addOption('folder', 'Only the databases folder');
        d.setValue(this.plugin.settings.searchScope === 'folder' ? 'folder' : 'vault');
        d.onChange(async (v) => {
          this.plugin.settings.searchScope = v === 'folder' ? 'folder' : 'vault';
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Databases folder')
      .setDesc('The folder for dashboards, exports ("Save as CSV" goes into Exports inside it) and for moving a database into, when you choose to.')
      .addText((t) => t.setValue(this.plugin.settings.dataFolder).onChange(async (v) => {
        if (isVaultRootFolder(v)) return;
        this.plugin.settings.dataFolder = normalizePath(v);
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('Note when a database is outside the databases folder')
      .setDesc('When you open a database that sits outside the databases folder, show a short note once for that file, with a button to move it. It only moves when you click. Dashboards never show it.')
      .addToggle((t) => t.setValue(this.plugin.settings.noteOutsideFolder !== false).onChange(async (v) => {
        this.plugin.settings.noteOutsideFolder = v;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('Size cap for the built-in engine (MB)')
      .setDesc('The built-in engine loads the whole database file into memory, and needs roughly three times the file size in free memory while it does. Files over this cap are not loaded; their dashboards render from the cache the desktop wrote instead. Databases up to about 2 GB (' + MAX_CAP_MB + ' MB) can be opened; larger files will not open, whatever the cap. The default is ' + DESKTOP_CAP_MB + ' MB on a desktop and ' + PHONE_CAP_MB + ' MB on a phone or tablet.')
      .addText((t) => t.setValue(String(this.plugin.settings.mobileCapMb)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n >= 1 && n <= MAX_CAP_MB) { this.plugin.settings.mobileCapMb = n; await this.plugin.saveSettings(); }
      }));

    new Setting(containerEl)
      .setName('Dashboards folder')
      .setDesc('Where dashboards live. Each dashboard is one Markdown note, so Obsidian Sync carries it to your phone.')
      .addText((t) => t.setValue(this.plugin.settings.dashboardFolder).onChange(async (v) => {
        this.plugin.settings.dashboardFolder = normalizePath(v || DEFAULT_SETTINGS.dashboardFolder);
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('Dashboard cache folder')
      .setDesc('Where computed dashboard results are stored, as notes, so phones and tablets can show them without opening the database.')
      .addText((t) => t.setValue(this.plugin.settings.cacheFolder).onChange(async (v) => {
        this.plugin.settings.cacheFolder = normalizePath(v || DEFAULT_SETTINGS.cacheFolder);
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('Include category values in the mobile catalog')
      .setDesc('Off by default. When on, the desktop writes the distinct values of small text columns (200 or fewer values, for example every metric name, workout type or category) into a note in the cache folder, so phones can offer them as a picker. That note syncs with the vault and is readable and searchable like any other. Leave this off if a database holds values you would not put in a note, for example health or contact details; the phone picker then asks you to type the value instead.')
      .addToggle((t) => t.setValue(this.plugin.settings.catalogIncludeValues).onChange(async (v) => {
        this.plugin.settings.catalogIncludeValues = v;
        if (this.plugin.catalogged) this.plugin.catalogged.clear();
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('Open JSON files in the vault')
      .setDesc('Dashboards are notes now, so this is only for .json files: a dashboard made as a .json file, and any other JSON in your vault. When on, clicking a .json file opens it in this plugin: a dashboard opens as its dashboard, any other JSON in a clean read-only viewer. Turn it off if another plugin should own .json files. Takes effect after the plugin reloads.')
      .addToggle((t) => t.setValue(this.plugin.settings.openJsonFiles).onChange(async (v) => {
        this.plugin.settings.openJsonFiles = v;
        await this.plugin.saveSettings();
        new Notice('Reload the plugin (or restart Obsidian) to apply this.');
      }));

    new Setting(containerEl)
      .setName('Draw widgets written in notes')
      .setDesc('When on, a code block with the word ' + WIDGET_BLOCK_LANG + ' in any note draws one widget, read-only. When off, such a block shows its own text as plain code. A note that is already open changes the next time it is shown.')
      .addToggle((t) => t.setValue(this.plugin.settings.drawNoteBlocks !== false).onChange(async (v) => {
        this.plugin.settings.drawNoteBlocks = v;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('Open dashboard notes as dashboards')
      .setDesc('When on, opening a dashboard note (from the file list, the quick switcher or a link) shows the dashboard instead of the note. To see the note itself, use "Open as note" in the file menu, "Open as text" on the dashboard, or switch the note to source mode.')
      .addToggle((t) => t.setValue(this.plugin.settings.openDashboardNotes !== false).onChange(async (v) => {
        this.plugin.settings.openDashboardNotes = v;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('Week starts on')
      .setDesc('The day each column of weeks starts on in a calendar widget. A widget with its own "Week starts on" keeps it.')
      .addDropdown((d) => {
        d.addOption('sunday', 'Sunday');
        d.addOption('monday', 'Monday');
        d.setValue(CAL_WEEK_STARTS.includes(this.plugin.settings.weekStart) ? this.plugin.settings.weekStart : DEFAULT_SETTINGS.weekStart);
        d.onChange(async (v) => {
          this.plugin.settings.weekStart = CAL_WEEK_STARTS.includes(v) ? v : DEFAULT_SETTINGS.weekStart;
          await this.plugin.saveSettings();
          const ws = this.app.workspace;
          if (ws && typeof ws.getLeavesOfType === 'function') {
            for (const leaf of ws.getLeavesOfType(VIEW_DASHBOARDS)) {
              if (leaf.view && typeof leaf.view.reload === 'function') leaf.view.reload().catch(() => {});
            }
          }
        });
      });

    this.displayLevels(containerEl);

    new Setting(containerEl).setName('Guide files').setHeading();
    new Setting(containerEl)
      .setName('Write the guide files')
      .setDesc('Writes README.md and AI-WIDGET-GUIDE.md into ' + this.plugin.settings.dashboardFolder + ': the first says what each widget does, the second is for an AI assistant that builds widgets for you. A copy you have edited is never replaced. ReadOut writes nothing here unless you ask.')
      .addButton((b) => b.setButtonText('Write now').onClick(async () => { await this.plugin.writeGuideFilesWithNotice(); }));
  }

  /* The value levels a stat widget's ranges point at: a name and a colour
   * each, plus how a level shows per widget type. A widget names a level;
   * renaming one here leaves the widgets that used the old name neutral
   * until they are edited. */
  displayLevels(containerEl) {
    const settings = this.plugin.settings;
    const save = async (redraw) => { await this.plugin.saveSettings(); if (redraw) this.display(); };
    new Setting(containerEl).setName('Value levels').setHeading();
    containerEl.createDiv({ cls: 'icor-sqlv-note', text: 'A "One big number" widget can colour itself by where its number lands: each widget lists its own ranges and names one of these levels for each. The colour is never the only signal; the level name is read out, and a range can add a short text. Renaming a level updates every widget that uses it, in every dashboard; removing one leaves its widgets neutral.' });
    settings.levels.forEach((level, i) => {
      const themed = LEVEL_THEME_COLORS.some(([v]) => v === level.color);
      const row = new Setting(containerEl).setName('Level ' + (i + 1));
      /* A rename lands when the field is left, never per keystroke, and
       * goes by the level's id so it reaches every widget using it. */
      row.addText((t) => {
        t.setPlaceholder('Name').setValue(level.name);
        const commit = async () => {
          const result = await this.plugin.renameLevel(level.id, t.getValue());
          if (!result.ok) { new Notice(result.reason); t.setValue(level.name); return; }
          if (result.unchanged) return;
          new Notice('Renamed ' + result.from + ' to ' + result.to + (result.widgets
            ? ' in ' + result.widgets + (result.widgets === 1 ? ' widget.' : ' widgets.')
            : '. No widget used it.'));
          this.display();
        };
        t.inputEl.addEventListener('blur', () => { commit(); });
        t.inputEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); t.inputEl.blur(); } });
      });
      row.addDropdown((d) => {
        for (const [value, label] of LEVEL_THEME_COLORS) d.addOption(value, label + ' (theme)');
        d.addOption('custom', 'Custom colour');
        d.setValue(themed ? level.color : 'custom');
        d.onChange(async (v) => {
          level.color = v === 'custom' ? (/^#/.test(level.color) ? level.color : '#808080') : v;
          await save(true);
        });
      });
      if (!themed) {
        row.addColorPicker((c) => c.setValue(/^#/.test(level.color) ? level.color : '#808080').onChange(async (v) => {
          if (!isLevelColor(v)) return;
          level.color = v;
          await save(false);
        }));
      }
      row.addExtraButton((b) => b.setIcon('trash-2').setTooltip('Remove this level').onClick(async () => {
        settings.levels.splice(i, 1);
        await save(true);
      }));
    });
    new Setting(containerEl)
      .addButton((b) => b.setButtonText('Add a level').onClick(async () => {
        let n = settings.levels.length + 1;
        while (settings.levels.some((l) => l.name === 'Level ' + n)) n++;
        const name = 'Level ' + n;
        settings.levels.push({ id: levelIdFor(name, new Set(settings.levels.map((l) => l.id))), name, color: 'var(--color-blue)' });
        await save(true);
      }))
      .addButton((b) => b.setButtonText('Back to Good, Watch, Alert').onClick(async () => {
        settings.levels = DEFAULT_LEVELS.map((l) => Object.assign({}, l));
        await save(true);
      }));
    new Setting(containerEl)
      .setName('How a level shows on "One big number"')
      .setDesc('The coloured mark a stat widget gets when its number lands on a level.')
      .addDropdown((d) => {
        for (const [value, label] of Object.entries(LEVEL_LOOKS.stat)) d.addOption(value, label);
        d.setValue(levelLookFor('stat', settings.levelLooks));
        d.onChange(async (v) => {
          settings.levelLooks = normalizeLevelLooks(Object.assign({}, settings.levelLooks, { stat: v }));
          await save(false);
        });
      });
    new Setting(containerEl)
      .setName('How a level shows on a segments bar or pie chart')
      .setDesc('The coloured mark a segments bar or a pie chart gets when the value its ranges judge lands on a level. "Same" follows the setting above.')
      .addDropdown((d) => {
        for (const [value, label] of Object.entries(LEVEL_LOOKS.segments)) d.addOption(value, label);
        d.setValue(normalizeLevelLooks(settings.levelLooks).segments);
        d.onChange(async (v) => {
          settings.levelLooks = normalizeLevelLooks(Object.assign({}, settings.levelLooks, { segments: v }));
          await save(false);
        });
      });
  }
}

/* ------------------------------------------------------ the JSON view -- */

/* Obsidian does not open .json files natively, so this plugin claims the
 * extension. A file that parses as a dashboard spec opens as its dashboard
 * in the builder; every other JSON gets a clean reader: pretty-printed,
 * read-only, monospace, with a copy button and an explicit switch to a
 * plain text editor that saves on blur or Cmd+S. A big file is shown in
 * part instead of freezing the pane. */
class JsonFileView extends FileView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.allowNoFile = false;
    this.navigation = true;
    this.text = null;
    this.tooBig = false;
    this.editing = false;
    /* Set by "Open as text": a dashboard file stays here, in the text
     * editor, instead of going to the builder. */
    this.asText = false;
  }

  getViewType() { return VIEW_JSON; }
  getIcon() { return 'braces'; }
  getDisplayText() { return this.file ? this.file.name : 'JSON'; }
  canAcceptExtension(ext) { return String(ext).toLowerCase() === 'json'; }

  /* "Open as text" rides the view state, like any Obsidian view option, so
   * it survives a workspace reload and works on every device. */
  getState() {
    const state = super.getState ? super.getState() : {};
    if (this.asText) state.asText = true;
    return state;
  }

  async setState(state, result) {
    this.asText = !!(state && state.asText);
    if (super.setState) await super.setState(state, result);
    /* The same file already loaded: switch to the editor in place. */
    if (this.asText && this.text !== null && !this.tooBig && !this.editing) {
      this.editing = true;
      this.render();
    }
  }

  async onOpen() {
    if (super.onOpen) await super.onOpen();
    /* The file changed on disk (the dashboards view saved it, or Sync
     * brought a newer copy): show the new text, unless there is unsaved
     * text in the editor, which a save then refuses to write over. */
    const vault = this.app.vault;
    if (vault && typeof vault.on === 'function') {
      this.registerEvent(vault.on('modify', (file) => { this.onFileChanged(file).catch(() => {}); }));
    }
  }

  async onFileChanged(file) {
    if (!this.file || !file || file.path !== this.file.path || this.text === null || this.tooBig) return;
    const text = await this.app.vault.read(this.file);
    if (text === this.text) return;
    if (this.editing && this.area && this.area.value !== this.text) return;
    this.text = text;
    this.render();
  }

  async onLoadFile(file) {
    this.tooBig = file.stat.size > JSON_RENDER_CAP;
    this.editing = this.asText && !this.tooBig;
    this.text = await this.app.vault.read(file);

    /* A dashboard spec does not belong in a raw reader: hand the leaf to
     * the builder, after this load settles. Unless it was opened as text. */
    if (!this.tooBig && !this.asText) {
      const parsed = parseDashboardSpec(this.text);
      if (parsed.ok) {
        this.handToDashboards(parsed.spec.id);
        return;
      }
    }
    this.render();
  }

  handToDashboards(id) {
    const leaf = this.leaf;
    window.setTimeout(async () => {
      try {
        await leaf.setViewState({ type: VIEW_DASHBOARDS, active: true });
        const view = leaf.view;
        if (view && typeof view.reload === 'function') {
          view.activeId = id;
          await view.reload();
        }
      } catch (e) {
        console.error(safeLogLine('could not open the dashboard view', e));
      }
    }, 0);
  }

  async onUnloadFile() {
    this.text = null;
    this.editing = false;
    this.area = null;
  }

  render() {
    const root = this.contentEl;
    root.empty();
    this.area = null;
    root.addClass('icor-sqlv-root');
    root.setAttribute('data-ink-plugin', 'icor-for-life-sqlite-viewer');
    if (this.text === null) return;
    const host = root.createDiv({ cls: 'icor-sqlv-json' });
    const bar = host.createDiv({ cls: 'icor-sqlv-console-bar' });

    let parsed = null;
    let parseError = '';
    if (!this.tooBig) {
      try { parsed = JSON.parse(this.text); } catch (e) { parseError = e.message; }
    }

    if (this.editing) {
      const area = host.createEl('textarea', { cls: 'icor-sqlv-console icor-sqlv-json-editor' });
      area.value = this.text;
      this.area = area;
      area.setAttribute('aria-label', 'JSON text');
      /* Opened as a dashboard: say after each change whether it still
       * reads, in the same plain words the dashboards view uses. */
      if (this.asText) {
        const check = host.createDiv({ cls: 'icor-sqlv-note icor-sqlv-json-check' });
        const recheck = () => {
          const parsed = parseDashboardSpec(area.value);
          if (parsed.ok) check.classList.remove('is-error'); else check.classList.add('is-error');
          check.setText(parsed.ok
            ? 'The dashboard reads fine: ' + parsed.spec.tiles.length + (parsed.spec.tiles.length === 1 ? ' widget.' : ' widgets.')
            : 'The dashboard will not open like this: ' + parsed.reason);
        };
        recheck();
        area.addEventListener('input', recheck);
      }
      /* The save goes through Vault.process and writes only over the text
       * this editor loaded: a file that changed on disk since (a save from
       * the dashboards view, or a Sync arrival) is never overwritten. */
      /* One save at a time: a click on "Done editing" first blurs the
       * editor, so its save waits for the blur's save and then finds
       * nothing left to write, instead of racing it. */
      const save = () => {
        this.saveChain = (this.saveChain || Promise.resolve()).then(saveNow, saveNow);
        return this.saveChain;
      };
      const saveNow = async () => {
        if (area.value === this.text) return true;
        const loaded = this.text;
        const next = area.value;
        let changed = false;
        await this.app.vault.process(this.file, (current) => {
          if (current !== loaded) { changed = true; return current; }
          return next;
        });
        if (changed) {
          new Notice(this.file.name + ' changed on disk since it was opened here, so this text was not saved. Copy what you need, then reopen the file.');
          return false;
        }
        this.text = next;
        new Notice('Saved ' + this.file.name + '.');
        return true;
      };
      /* Leaving the editor saves a dashboard file only when it reads, so
       * half-typed text never reaches the dashboard; Cmd+S and "Done
       * editing" always save. */
      area.addEventListener('blur', () => {
        if (this.asText && !parseDashboardSpec(area.value).ok) return;
        save();
      });
      area.addEventListener('keydown', (ev) => {
        if ((ev.metaKey || ev.ctrlKey) && ev.key === 's') { ev.preventDefault(); save(); }
      });
      const done = bar.createEl('button', { text: 'Done editing', cls: 'mod-cta' });
      done.addEventListener('click', async () => {
        if (!(await save())) return;
        this.editing = false;
        /* Opened from a dashboard: go back to it when it reads, else stay
         * here, in the reader, which says why it does not. */
        if (this.asText) {
          this.asText = false;
          const parsed = parseDashboardSpec(this.text);
          if (parsed.ok) { this.handToDashboards(parsed.spec.id); return; }
        }
        this.render();
      });
      if (typeof area.focus === 'function') area.focus();
      return;
    }

    if (!this.tooBig) {
      const edit = bar.createEl('button', { text: 'Edit as text' });
      edit.addEventListener('click', () => { this.editing = true; this.render(); });
    }
    const note = bar.createSpan({ cls: 'icor-sqlv-note' });
    if (this.tooBig) {
      note.setText('A big file (' + formatBytes(this.text.length) + '). Showing the first part, read-only.');
    } else if (parseError) {
      note.setText('Not valid JSON: ' + parseError);
    } else {
      note.setText(formatBytes(this.text.length) + ', read-only');
    }

    const pre = host.createEl('pre', { cls: 'icor-sqlv-json-pre' });
    if (this.tooBig) {
      pre.setText(this.text.slice(0, JSON_SLICE) + '\n…');
    } else if (parsed !== null) {
      pre.setText(JSON.stringify(parsed, null, 2));
    } else {
      pre.setText(this.text);
    }
  }
}

/* ------------------------------------------------- the starter content -- */

/* The two guides the plugin writes into the dashboards folder: the help
 * file for people (README.md) and the guide for AI assistants
 * (AI-WIDGET-GUIDE.md). Both are refreshed on the same rule, so a newer
 * plugin brings newer guides without ever overwriting a member's edits:
 *
 * - no file yet: it is written;
 * - the file is still the plugin's own, unedited text: it is replaced
 *   when this plugin's text is a newer revision, and left alone when it
 *   is the same revision or an older one;
 * - anything else (someone edited it): it is never touched.
 *
 * "Unedited" is decided by a fingerprint. The plugin ends each copy with
 * one comment line holding the text's revision and a hash of everything
 * above it. A copy whose text still hashes to its own fingerprint is the
 * plugin's; any edit above the line (or to the line) breaks the match.
 * Copies written before the fingerprint existed carry none; they count as
 * the plugin's own only when their whole text hashes to one of the texts
 * earlier versions wrote (`legacy`). The hash is FNV-1a, 32 bits: an
 * identity check on a small text, not a security measure.
 *
 * Refreshing only forward keeps two devices that share a vault through
 * Sync from rewriting each other's copy: a device on an older plugin
 * never replaces a newer revision, and two devices on the same revision
 * leave each other's copy alone even when their data folder settings
 * (which are written into the text) differ. A copy without a revision
 * (written before revisions existed) counts as revision 0. Every change
 * to a guide's text raises its `revision` in GUIDE_FILES; a gate pins
 * each revision to its text. */
const GUIDE_MARK_RE = /<!-- Written by (?:the SQLite Viewer plugin|ReadOut) \((?:revision (\d+), )?fingerprint ([0-9a-f]{8})\)\. If you edit this file, (?:the plugin|ReadOut) stops updating it\. -->\n?$/;

function guideHash(text) {
  let h = 0x811c9dc5;
  const t = String(text).replace(/\r\n/g, '\n');
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/* The text as the plugin writes it: the data folder filled in, and the
 * fingerprint line last. */
function guideTextFor(guide, dataFolder) {
  /* A function, so a "$" in the folder name is written as it is. */
  const folder = dataFolder || '07 Databases';
  const body = guide.text.replace(/07 Databases/g, () => folder);
  return body + '<!-- Written by ReadOut (revision ' + (guide.revision || 0) + ', fingerprint ' + guideHash(body) + '). If you edit this file, ReadOut stops updating it. -->\n';
}

/* Whether a copy on disk is still the plugin's own, unedited text. */
function guideIsPluginOwn(current, legacy, dataFolder) {
  const t = String(current).replace(/\r\n/g, '\n');
  const mark = GUIDE_MARK_RE.exec(t);
  if (mark) return guideHash(t.slice(0, mark.index)) === mark[2];
  const known = new Set(legacy || []);
  if (known.has(guideHash(t))) return true;
  return !!dataFolder && dataFolder !== '07 Databases' && known.has(guideHash(t.split(dataFolder).join('07 Databases')));
}

/* The revision a copy says it is: 0 for one without a revision. */
function guideRevision(text) {
  const mark = GUIDE_MARK_RE.exec(String(text).replace(/\r\n/g, '\n'));
  return mark && mark[1] ? Number(mark[1]) : 0;
}

/* What to do with the copy on disk, in a word: 'current' (nothing to do),
 * 'newer' (a newer plugin wrote it: leave it), 'kept' (edited: never
 * touch) or 'refresh'. */
function guideRefreshFor(current, text, legacy, dataFolder) {
  const t = String(current).replace(/\r\n/g, '\n');
  if (t === text) return 'current';
  if (!guideIsPluginOwn(t, legacy, dataFolder)) return 'kept';
  const theirs = guideRevision(t);
  const mine = guideRevision(text);
  if (theirs > mine) return 'newer';
  if (theirs === mine) return 'current';
  return 'refresh';
}

/* Write, refresh or keep one guide, through the Vault API: these are
 * notes a member may have open. The refresh is a Vault.process that
 * decides again on the text it is handed, so a change that lands between
 * the read and the write is never overwritten. Nothing is written when
 * nothing needs to be. Returns what happened, in a word. */
async function refreshGuideFile(vault, path, text, legacy, dataFolder) {
  const file = vault.getAbstractFileByPath(path);
  if (!file) {
    /* On disk but not in the vault (a folder Obsidian does not index):
     * not the plugin's to touch. */
    if (await vault.adapter.exists(path)) return 'kept';
    await vault.create(path, text);
    return 'written';
  }
  if (!(file instanceof TFile)) return 'kept';
  let current;
  try { current = await vault.read(file); } catch (e) { return 'kept'; }
  const action = guideRefreshFor(current, text, legacy, dataFolder);
  if (action !== 'refresh') return action;
  let outcome = 'refreshed';
  await vault.process(file, (now) => {
    const again = guideRefreshFor(now, text, legacy, dataFolder);
    if (again === 'refresh') return text;
    outcome = again;
    return now;
  });
  return outcome;
}

const DASHBOARD_README = `---
title: Dashboard widgets
doc_type: note
status: active
tags:
  - sqlite
  - dashboards
---

# Dashboard widgets

What each widget type shows, what it is good for, and what each of its settings does. To change a setting, press "Edit" on the dashboard, then the pencil on the widget. Every data widget also has "Widget name", "Unit" (shown with the values, like orders or %) and "Size" ("Small (a square)", "Medium", "Wide", "Large", or "Keep as is" when editing).

Editing dashboard files by hand, or asking an AI to? Use \`AI-WIDGET-GUIDE.md\` in this folder. If it is missing, press "Create Guide Files for Your AI Team" on the empty dashboards screen, or run the command "Write the guide files".

## Phones, and dashboards as notes

On a phone, ReadOut is a dashboard viewer. Your desktop draws each dashboard
and saves its answers as notes. Obsidian Sync carries notes with its default
settings, so your phone draws each dashboard from those saved answers: the last
ones the desktop saved. Browsing tables and running queries need the database
file on the device, and default Sync does not carry database files.

Dashboards are notes on every device, not only on the phone. That is what lets
default Sync carry them. Tapping a dashboard note opens the dashboard; "Open as
note" in the file menu, or "Open as text" on the dashboard, shows the note
itself. After updating from 1.0, each dashboard has an old \`.json\` file beside
its note. Once every device runs ReadOut 1.1, run the command "Remove old .json
dashboards and cache files" and they go where your deleted files go.

## Line chart and bar chart

*Sample: a line chart of orders per day, with a dashed goal line. Every number in the samples is invented.*

\`\`\`readout-sample
line
\`\`\`

*Sample: a bar chart of orders per week, web and shop stacked.*

\`\`\`readout-sample
bar
\`\`\`

**What it shows:** how a number changes over time or across groups, as a line or as bars.

**Good for:**
- Revenue per day, with a guide line at break-even.
- Pages read per week against a reading goal.
- Visits to a site per day, split by source.
- Open tasks per project, one bar each.

**What the query returns:** one column for along the bottom (usually a date) and one or more number columns. A line chart, bar chart or one big number can also be built by picking a table and a column, and the plugin writes the query.

| Panel label | What it does | Default |
| --- | --- | --- |
| "X column" | The column along the bottom. Rows draw in the order the query returns them. | |
| "Y columns (comma-separated)" | The number column, or several for several lines or bars. | |
| "Stack the bars on top of each other" | A bar chart with two or more Y columns: stacks them. | Off |
| "Stack the series on top of each other" | The same, for a bar chart built by picking a column to split by. | Off |
| "Compare with" | Built charts only. Draws an earlier period faintly behind: "No comparison", "Previous period", "Same period last year". | "No comparison" |
| "Good direction" | Which way the change counts as good: "Up is good", "Down is good (costs, open tasks)". | "Up is good" |

Shared: colours and scrub line, change and roll-up, axis, guide lines and zones, band (line only), hint and footnote.

## Bars and lines (combo)

*Sample: orders per month as bars, with the return rate as a dashed line on the right axis.*

\`\`\`readout-sample
combo
\`\`\`

**What it shows:** bars and lines on one chart, each on a left or right scale.

**Good for:**
- Monthly spending as bars, with the share of budget used as a line.
- Orders as bars, with the return rate as a dashed line on the right.
- Tasks finished per week as bars, with a running total as a line.
- Site visits as bars, with the sign-up rate on the right.

**What the query returns:** one column for along the bottom and one number column per series.

| Panel label | What it does | Default |
| --- | --- | --- |
| "X column" | The column along the bottom. | |
| "Series" | One row per series, up to 8, added with "+ Add series". | |
| "Stack the bars on top of each other" | Stacks two or more bar series. They must share one axis. | Off |

Each series row has:

| Row field | What it does | Default |
| --- | --- | --- |
| column | The query column it draws. | |
| drawn as | "Bars" or "Line". | First row Bars, the rest Line |
| axis | "Left axis" or "Right axis". | "Left axis" |
| colour | See colours. | "Theme default" |
| name in the legend | The series' name in the legend. | "legend name (optional)": the column name |
| opacity | How see-through, 0 to 1. | "opacity 1" |
| dash | Line only. "solid, or like 4 3": 4 drawn, 3 left out. | Solid |
| join across empty rows | Line only. Draws the line across rows with no value. | Off |

Shared: scrub line colour, axis (as "Left axis" and "Right axis"), guide lines and zones, hint and footnote.

## Scatter chart

*Sample: a scatter chart of orders against ad spend, coloured by channel, with a trend line.*

\`\`\`readout-sample
scatter
\`\`\`

**What it shows:** how two numbers move together, one point for each row.

**Good for:**
- Orders against ad spend, one point per day.
- Sleep hours against the next day's mood.
- Pages read against minutes read, coloured by book.
- Price against rating, with a trend line.

**What the query returns:** one row per point: a number for along the bottom, a number for up the side, and optionally a column to colour by. A row with no number in either column is left out.

| Panel label | What it does | Default |
| --- | --- | --- |
| "X column" | The number along the bottom. | |
| "Y column" | The number up the side. | |
| "Colour the points by column" | One colour for each value of the column: the four most common, the rest together as Other. "No colouring" keeps one colour. | "No colouring" |
| "Draw a trend line through the points" | The straight line that fits all the points best (least squares). | Off |

Shared: point colour, axis (with "Lowest x value" and "Highest x value"), guide lines and zones, hint and footnote.

## Bullet chart

*Sample: a bullet chart of sales against target by region, shaded by value levels.*

\`\`\`readout-sample
bullet
\`\`\`

**What it shows:** for each row, a bar for the actual value against a mark for its target, on one scale shaded in bands like poor, fair and good.

**Good for:**
- Sales per region against target.
- Hours slept per night against a goal of eight.
- Spend per category against budget.
- Pages read per book against its length.

**What the query returns:** one row per bar, up to 12: a label, the actual number and, for a target mark, the target number. All the bars share one scale, so give them one unit, or write each as a percent of its target.

| Panel label | What it does | Default |
| --- | --- | --- |
| "Label column" | Names each bar. "No labels" draws the bars alone. | "No labels" |
| "Actual value column" | The number each bar is as long as. | |
| "Target column" | The number each target mark sits at. "No target" draws no marks. | "No target" |
| "Lowest value on the scale" | Where the scale starts. Automatic: zero, or the lowest value when something is below zero. | "automatic" |
| "Highest value on the scale" | Where the scale ends; a bigger value is drawn at the end. Automatic: the largest value, target or band end, on a round number. | "automatic" |

The bands behind the bars are the value levels: each range is drawn as a band, in its level's colour.

Shared: value levels, hint and footnote.

## One big number

*Sample: one big number, orders this month, with a caption line, a meter and a level.*

\`\`\`readout-sample
stat
\`\`\`

**What it shows:** one number, large, with optional small lines under it.

**Good for:**
- Sales this month.
- Books finished this year.
- Budget left, coloured red when it runs low.
- The current streak on a habit.

**What the query returns:** one row. The number comes from one column; caption lines can come from others.

| Panel label | What it does | Default |
| --- | --- | --- |
| "Value column" | Which column of the first row is the number. | "The first column" |
| "Caption columns (comma-separated)" | Up to 4 columns shown as small lines under the number. | "empty: the next column" |

Shared: number size, value levels, meter, hint and footnote.

## Table

*Sample: a table of orders by channel, with a sparkline column for the last 14 days.*

\`\`\`readout-sample
table
\`\`\`

**What it shows:** the query's rows, as written. A column can show as a sparkline: a tiny line chart in each row, one line to a cell.

**Good for:**
- The last ten orders.
- Overdue tasks with their projects.
- Books in progress and the page you are on.
- The top pages on a site this week, each with its visits per day as a sparkline.

**What the query returns:** any rows and columns. A sparkline column holds a short series of numbers in each cell, written like 3,5,4,8: the query builds it with \`group_concat\` (the AI guide has the pattern).

| Panel label | What it does | Default |
| --- | --- | --- |
| "Sparkline columns (comma-separated)" | The columns to draw as a tiny line chart, up to 8. Each line has its own scale, lowest to highest, with a dot on the last value. A cell with fewer than two numbers shows as the text it is. | "empty: no sparklines" |

Shared: hint and footnote.

## Part-to-whole bar (segments)

*Sample: a part-to-whole bar of tasks by status.*

\`\`\`readout-sample
segments
\`\`\`

**What it shows:** one bar split into parts, each as wide as its share of the total.

**Good for:**
- Tasks by status: to do, doing, done.
- This month's spending by category.
- Site visits by device.
- Reading time by genre.

**What the query returns:** one row per part, in order: a name column and a number column.

| Panel label | What it does | Default |
| --- | --- | --- |
| "Part name column" | The column that names each part. | |
| "Part size column" | The number column that sizes each part. | |
| "Part colours" | A colour per part, matched to the part's name exactly. Up to 12. Each row has "part name" and "colour". "+ Add part colour" adds one; "+ A row for each part in the preview" adds one for every part without a colour. | "Theme colour": the theme's colours in turn |

Shared: value levels, hint and footnote.

## Pie or doughnut chart

*Sample: a doughnut chart of orders by channel, with its legend.*

\`\`\`readout-sample
pie
\`\`\`

**What it shows:** a circle split into slices, each as big as its share of the total, starting at twelve o'clock and going clockwise in the order of the rows. A legend names every part with its value and share.

**Good for:**
- Orders by channel.
- This month's spending by category.
- Time by project, when a few big parts matter more than small differences.

**What the query returns:** one row per part, in order: a name column and a number column. Use a part-to-whole bar when there are many small parts; a pie reads best with five or fewer.

| Panel label | What it does | Default |
| --- | --- | --- |
| "Part name column" | The column that names each part. | |
| "Part size column" | The number column that sizes each part. | |
| "Cut a hole in the middle (a doughnut)" | Draws a doughnut and writes the total in the hole. | Off: a full pie |
| "Part colours" | A colour per part, as on the part-to-whole bar. | "Theme colour": the theme's colours in turn |

Shared: value levels, hint and footnote. The theme has five series colours; from the sixth part on, parts share one faint colour, so group small parts in the query.

## Heatmap

*Sample: a heatmap of orders by weekday and hour, coloured by value levels.*

\`\`\`readout-sample
heatmap
\`\`\`

**What it shows:** a grid of cells, each coloured by its value.

**Good for:**
- Minutes worked by day and hour, with a dot on hours with a meeting.
- Habits done by day of the week.
- Site visits by weekday and hour.
- Spending by category and month.

**What the query returns:** one row per cell: a row label, a column label and a number.

| Panel label | What it does | Default |
| --- | --- | --- |
| "Row labels column" | Names each row of the grid. | |
| "Column labels column" | Names each column of the grid. | |
| "Cell value column" | The number that colours the cell. Without value levels every cell is grey. | |

The group "Dots, highlight, cells and labels":

| Panel label | What it does | Default |
| --- | --- | --- |
| "Dot column" | A cell gets a dot where this column is not empty, 0 or false. | "No dots" |
| "Dot colour" | The dot's colour. | "Theme default" |
| "Dot label in the legend" | The dot's name in the legend. | "empty: the column name" |
| "Highlight" | Lights up the present: "The current hour’s column (columns named 0 to 23)", "Today’s row or column (named like 2026-01-31)", "Today’s weekday (named like Monday or Mon)". | "None" |
| "Cells" | "Thin rows (default)", "Square", "Fill the tile’s height". | Thin rows |
| "Label every Nth column" | 3 labels every third column. | "empty: every column" |

Shared: value levels, hint and footnote.

## Year calendar

*Sample: a year calendar of orders per day, coloured by value levels.*

\`\`\`readout-sample
calendar
\`\`\`

**What it shows:** a year at a glance: one square for each day, a week to a column, each coloured by its value.

**Good for:**
- Days a habit was kept, like a contribution graph.
- Orders or visits per day across a year.
- Sleep hours per night, coloured by how restful.
- Days with a workout, a purchase or a headache.

**What the query returns:** one row per day: a date written like 2026-01-31 and a number. A day with no row stays empty. Without value levels every day with data is grey.

| Panel label | What it does | Default |
| --- | --- | --- |
| "Date column" | The day of each row, written like 2026-01-31 (a time after it is ignored). | |
| "Day value column" | The number that colours the day. | |
| "Week starts on" | "The plugin setting (default)", "Sunday" or "Monday": the day each column of weeks starts on. The plugin setting "Week starts on" (Settings, then this plugin) is the default for every calendar; pick Sunday or Monday here to override it for this widget. | "The plugin setting (default)" |
| "Year" | Shows that whole calendar year, like 2026. | "empty: the last 53 weeks up to the newest day" |

Shared: value levels, hint and footnote.

## Text

*Sample: a text widget with two short paragraphs.*

\`\`\`readout-sample
text
\`\`\`

**What it shows:** plain words on the dashboard, written by you or filled from a query.

**Good for:**
- A note on what a section of the dashboard means.
- "Data through" and the newest date, filled from a query.
- This week's focus for a project.
- A reading goal, written once.

**What the query returns:** one value, from the first column of the first row. Written text runs no query.

| Panel label | What it does | Default |
| --- | --- | --- |
| "Widget type" | "Text", "Section divider" or "A widget with data". | |
| "The words come from" | "Written here" or "A query (its first column, first row)". | "Written here" |
| "Text" | The words, up to 2,000 characters. Plain text, not Markdown. | |
| "SQL" | The query, when the words come from one. | |
| "One thin line, like a section divider (no title)" | One slim strip of text in a thin row. | Off |
| "Title" | Not on a thin line. | "no title" |
| "Width" | A thin line's width: "Full width", "Half", "A third", "One cell". | "Full width" |

Shared: hint and footnote.

## Section divider

*Sample: a section divider with the heading Sales.*

\`\`\`readout-sample
divider
\`\`\`

**What it shows:** a thin line with an optional heading that separates groups of widgets.

**Good for:**
- Splitting a dashboard into Sales and Costs.
- One heading per project.
- Keeping this week apart from this year.
- Grouping reading, habits and budget on one page.

**What the query returns:** nothing. It runs no query.

| Panel label | What it does | Default |
| --- | --- | --- |
| "Widget type" | "Section divider", "Text" or "A widget with data". | |
| "Heading" | The words on the line. | Empty |
| "Width" | "Full width", "Half", "A third", "One cell". | "Full width" |

No shared settings.

## Showing a widget in a note

Any note can show one widget of a dashboard, read-only, so a project page or a journal entry carries the chart itself. Write a code block whose language is \`readout\` and name the dashboard and the widget. The block below is shown here as plain text; in a note, put three backticks before and after it:

    \`\`\`readout
    dashboard: health-overview
    widget: Heart rate, last 90 days
    \`\`\`

- "dashboard" is the dashboard's id: its note's file name in the dashboards folder, without \`.md\`.
- "widget" is the widget's title, or its number on the dashboard counting from 1 (a section divider counts).
- The note always shows what the dashboard shows now. Edit the widget on the dashboard and every note follows.
- On a phone or tablet the note shows the dashboard's last desktop result, with a line saying when it was computed. Open the dashboard once on the desktop and let it sync to refresh it.
- The block has no buttons: change the widget on the dashboard. To write a widget out inside the note instead, see \`AI-WIDGET-GUIDE.md\`.

## Settings shared by several widgets

| Setting | Line | Bar | Combo | Scatter | Bullet | One big number | Table | Segments | Pie | Heatmap | Calendar | Text |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Colours and scrub line | Yes | Bar colour | Scrub line | Point colour | | | | | | | | |
| Number size | | | | | | Yes | | | | | | |
| Value levels | | | | | Bands | Yes | | Yes | Yes | Yes | Yes | |
| Change and roll-up | One series | One series | | | | | | | | | | |
| Meter | | | | | | Yes | | | | | | |
| Sparklines | | | | | | | Yes | | | | | |
| Axis | Yes | Yes | Left and right | Side and bottom | | | | | | | | |
| Guide lines and zones | Yes | Yes | Yes | Yes | | | | | | | | |
| Band | SQL only | | | | | | | | | | | |
| Hint and footnote | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |

### Colours and scrub line

| Panel label | What it does | Default |
| --- | --- | --- |
| "Line colour" | A one-series line chart's line. | "Theme default" |
| "Bar colour" | A one-series bar chart's bars. | "Theme default" |
| "Point colour" | A scatter chart's points, when they are not coloured by a column. | "Theme default" |
| "Scrub line colour" | Line chart or combo: the thin line that follows your pointer. | "Theme default" |

Every colour list offers "Theme default"; the theme's "Green (theme)", "Amber (theme)", "Red (theme)", "Yellow (theme)", "Cyan (theme)", "Blue (theme)", "Purple (theme)", "Pink (theme)" (in a row of fields just "Green", "Amber", "Red", "Yellow", "Cyan", "Blue", "Purple", "Pink"), which follow light and dark mode; and "Custom colour", which opens a colour picker. A zone's list starts at "Pick a colour".

### Number size

| Panel label | What it does | Default |
| --- | --- | --- |
| "Number size" | "Small (24 px)", "Medium (34 px)", "Large (48 px)", "Extra large (64 px)", "Shrink to fit" (shrinks until the number shows whole), or "Custom". | "Theme default" |
| "Number size in pixels" | With "Custom": a whole number from "12 to 120". | |

### Value levels

Value levels colour a widget by where its number lands, like Good, Watch and Alert. The levels' names and colours live in the plugin settings; each widget sets its own ranges. The first range that holds the number wins.

| Panel label | What it does | Default |
| --- | --- | --- |
| "Value levels" | One row per range: "from" and "to" ("lowest value (empty for no limit)", "highest value (empty for no limit)", both ends inside), "level", and "pill text (optional)": "short text shown as a pill (optional)" by the title. "+ Add range" adds one; "+ Anything else" adds a last range that catches every other number. | No ranges |
| "Judge the ranges on column" | One big number, segments and pie: judge on another column of the first row, like a score. On segments and pie its "None (needed when there are ranges)" must be changed once ranges exist. | "empty: the shown value" |
| "Colours for this widget" | Changes a level's colour on this widget only: "Settings colour", a theme colour or "Custom colour". A changed level reads "Changed for this widget"; "Reset to settings" undoes it. | "Settings colour" |

### Change and roll-up

| Panel label | What it does | Default |
| --- | --- | --- |
| "Show change over the period" | A badge by the title with the change from first to last point. | Off |
| "Roll-up at the right of the title" | "None", "Lowest to highest" or "Change over the period". | "None" |
| "Average the ends over N days" | Compares the average of the first and last N days (1 to 365), so one odd day does not swing it. | "empty: first and last point" |

### Meter under the number

| Panel label | What it does | Default |
| --- | --- | --- |
| "Lowest value" | Where the bar under the number starts. | "like 0" |
| "Highest value" | Where the bar is full. | "like 100" |
| "Target" | A mark on the bar. | |

### Axis

On a combo, "Left axis" and "Right axis" each have these. On a scatter chart the fields up to "Write thousands as k (8k)" set the scale up the side, and "Lowest x value" and "Highest x value" set the scale along the bottom.

| Panel label | What it does | Default |
| --- | --- | --- |
| "Lowest value" | The bottom of the scale. 0 keeps bars honest. | "automatic" |
| "Highest value" | The top of the scale. | "automatic" |
| "Let the top grow up to" | The top starts at the highest value and grows to fit, never past this. | "empty: the top stays at the highest value" |
| "Labels at" | Where the labels sit, 1 to 12 numbers. | "automatic, or like 0, 50, 100" |
| "Text after each label" | Up to 6 characters. | "like h or %" |
| "Write thousands as k (8k)" | 8,000 shows as 8k. | Off |
| "Label every Nth value along the bottom" | 7 labels every seventh day. Not on a scatter chart, whose bottom is a number scale. | "empty: as many as fit" |
| "Lowest x value" | Scatter chart only: the left end of the scale along the bottom. | "automatic" |
| "Highest x value" | Scatter chart only: the right end of the scale along the bottom. | "automatic" |
| "Unit of the right axis" | Combo, right axis only: the unit in the readout. | "like orders or %" |

### Guide lines and zones

| Panel label | What it does | Default |
| --- | --- | --- |
| "Guide lines" | A line across the chart at one value, up to 8, added with "+ Add guide line". Each row: "value" ("at"), "label" ("label (optional)", names it in the legend), "colour", "dash" ("solid, or like 4 3"). | None |
| "Zones" | A shaded band from one value to another, up to 8, added with "+ Add zone". Each row: "from", "to", "colour", "opacity". | "opacity 0.15" |

On a combo each row also has "axis". On a scatter chart they follow the scale up the side. A guide line or zone stays in view on an automatic scale.

### Band

A line chart written in SQL: a shaded area between two columns, like a low and a high per day, under the line.

| Panel label | What it does | Default |
| --- | --- | --- |
| "Low edge column" | The bottom edge. | |
| "High edge column" | The top edge. | |
| "Band opacity" | 0 to 1. | "0.2" |

### Hint and footnote

| Panel label | What it does | Default |
| --- | --- | --- |
| "Hint by the title" | A few words at the right of the title, like per day. | "a few words, up to 60 characters" |
| "Footnote under the widget" | Small text under the widget. | "a sentence, up to 300 characters" |

---

Delete this file to get a fresh copy; editing it stops updates.
`;

/* The guide for AI assistants asked to build a widget: generic, for any
 * assistant in any vault. Written beside the help file, on its rule. */
const AI_WIDGET_GUIDE = `---
title: AI widget guide
doc_type: note
status: active
tags:
  - sqlite
  - dashboards
---

# AI widget guide: building a dashboard widget for ReadOut

This file is for AI assistants (and teams of them) asked to build or change
a widget on a ReadOut dashboard in an Obsidian vault. It assumes nothing
about the vault around it. A person who wants
to build widgets by hand should read \`README.md\` in this folder instead: it
says what each widget shows and what each setting of the edit panel does.
The full field reference for the dashboard file is section 8 of this guide,
called "the field reference" below.

The plugin writes this file and keeps it up to date: a newer plugin replaces
it only while it is still exactly the plugin's text. The last line holds a
fingerprint (a hash of everything above it); an edited copy no longer
matches and is never overwritten. Delete the file to get the plugin's
newest text; it is written again on the next load or on "New dashboard".

## 1. What a dashboard is and where it lives

- A dashboard is one Markdown note (\`.md\`), named after its \`id\` (\`shop.md\`),
  directly in the dashboards folder (not in subfolders). Its properties say
  \`readout: dashboard\`, and the dashboard itself is the JSON in the note's
  one json code block; the field reference ("The dashboard note") shows a
  whole note. The folder is the plugin setting "Dashboards folder"
  (\`dashboardFolder\` in the plugin's settings); this guide is written into
  that folder, so the folder holding this file is the one.
- Create a note, never a \`.json\` file. Obsidian Sync carries notes by
  default and leaves \`.json\` files behind, so a dashboard saved as \`.json\`
  does not reach a phone on default settings. A \`.json\` dashboard (from an
  earlier version, or made by hand) still opens, and the plugin writes its
  note beside it the next time it loads; from then on the note is the
  dashboard and the \`.json\` is no longer read.
- Other notes in that folder, this guide included, are not dashboards and
  are left alone. A note with \`readout: dashboard\` that does not read as a
  dashboard is listed as an error at the top of the dashboards view, with
  the file's name and the reason.
- A dashboard holds \`id\`, \`title\`, \`database\`, an optional
  \`globalTimeframe\`, and \`tiles\` (the widgets). A widget is a "tile" in the
  file and a "widget" on screen.
- The plugin also keeps a cache folder (the setting "Dashboard cache
  folder") with the last results, for phones. Never write there.
- The value levels a widget's \`ranges\` name (their names and colours) live
  in the plugin settings, not in any dashboard file. The defaults are
  \`Good\`, \`Watch\` and \`Alert\`.

## 2. Hard rules

1. **Read-only.** Never write to a database. The plugin only runs one
   statement per query, starting with SELECT, WITH, PRAGMA or EXPLAIN. It
   refuses a second statement after a semicolon, any write verb (INSERT,
   UPDATE, DELETE, CREATE, DROP, ALTER, VACUUM and the like) even behind a
   WITH clause, and every PRAGMA that can change a database.
2. **One database per dashboard.** Every SQL widget reads the dashboard's
   top-level \`database\`. Only a built widget (with \`source\`) may name
   another one in \`source.database\`.
3. **No ATTACH.** ATTACH and DETACH are refused. A query cannot join two
   database files; if the data is in two files, it is two dashboards, or a
   built widget with its own \`source.database\`.
4. **The query must run in the plugin's engine.** On every device the
   plugin uses its built-in engine, sql.js 1.13.0 (SQLite compiled to
   WebAssembly), which loads the whole database into memory up to the
   setting "Size cap for the built-in engine (MB)" (1500 by default on a
   desktop, 200 on a phone or tablet). Write plain SQLite. Do not rely on a
   loadable extension or a function only a very new SQLite has. Test with
   the plugin's own engine, not only with another tool (see the procedure).
5. **Row cap.** A widget on a dashboard gets at most 5,000 rows (the panel's
   preview 500): a query without a LIMIT gets one added. Aggregate in SQL
   (GROUP BY a day or a week) instead of returning raw rows.
6. **Timeouts.** The built-in engine has no timeout and blocks while it
   works, so a slow query freezes the view. Keep every query fast: filter
   early, use indexed columns, avoid correlated subqueries over big tables.
7. **Window from the newest data row, not from "now".** Data often lags
   (a sync that runs nightly, a device that uploads late). A window written
   as \`date('now', '-30 day')\` empties the chart when the data is a few
   days behind. Anchor it on the newest row instead:
   \`WHERE day >= date((SELECT MAX(day) FROM sales), '-30 day')\`.
   The plugin itself does this for built widgets. It does no date
   arithmetic for an SQL widget: the dashboard's "Range" picker does not
   reach an SQL widget, so the window is written in the query.
8. **Only fields the plugin knows.** The edit panel rewrites the
   dashboard's JSON on every save, and a key the plugin does not know is
   dropped then (what is written around the JSON block stays). Use only the
   fields in the field reference.
9. **Never leave test widgets in a user's dashboard.** Test in a copy (a
   separate dashboard note with its own \`id\`) and delete it when done, or
   remove any test widget before you finish.

## 3. The procedure

1. **Read the schema, read-only.** In Obsidian: the plugin's database view
   (the ReadOut database browser), tab "Schema", or tab "SQL console"
   with \`PRAGMA table_info('sales')\`. Outside Obsidian, any read-only SQLite
   client, for example \`sqlite3 -readonly <file> ".schema sales"\`. Note the
   column types and how dates are stored (text like \`2026-01-31\` sorts and
   compares well; numbers of seconds need \`date(col, 'unixepoch')\`).
2. **Write the query and test it against the database.** Run it in the
   plugin's "SQL console" tab, which uses the same engine and the same
   read-only check as a dashboard. Check that it returns the columns the
   widget type needs (section 5), in the right order, with sensible
   values, quickly. Check the newest and oldest rows of any window.
3. **Write the widget.** Add one object to the dashboard's \`tiles\` list,
   using only the fields in section 4. Leave \`layout\` out to let the
   plugin place the widget, or give a free spot (\`{"x":0,"y":0,"w":2,"h":2}\`
   in grid cells; the grid is 2 columns wide on a phone and up to 6 on a
   wide pane, about 5 on a typical one; a widget wider than the columns on screen
   is narrowed to fit). Keep the JSON in the block valid, and leave the
   properties and the block's fence lines as they are.
4. **Validate.** With the note open in Obsidian, run the command "Check this
   note as a dashboard". It says "The dashboard reads fine: N widgets." or
   "The dashboard will not open like this:" with the reason, naming the
   widget ("Tile 3") and the setting. Fix until it reads fine. The same
   reasons show at the top of the dashboards view for a note that does not
   read. ("Open as text" on a dashboard opens its note.)
5. **Open the dashboard and look.** Press "Refresh". The widget must draw
   with no error box in it, and the numbers must match what the query
   returned in step 2. Check a narrow pane too: text that is cut off means
   the widget needs more room or fewer words.
6. **Open it in the edit panel.** Press "Edit", then the pencil on the
   widget. Every setting you wrote must show in a field, the preview must
   draw, and the panel must not say that saving "leaves out what this
   widget had". If it does, you used a field the panel cannot show, or one
   that does not fit the type; fix the note, not the panel.
7. **Clean up.** Delete any test dashboard or test widget. Leave the user's
   file as it was apart from the widget they asked for.

## 4. The widget schema, per type

Every type takes \`title\` (text), \`viz\` (one of \`line\`, \`bar\`, \`stat\`,
\`table\`, \`divider\`, \`combo\`, \`scatter\`, \`bullet\`, \`segments\`, \`pie\`, \`heatmap\`, \`calendar\`, \`text\`), \`layout\`
(\`{x, y, w, h}\`, whole cells, \`w\` and \`h\` 1 to 12), and, all but \`divider\`,
\`unit\` (text), \`hint\` (text, up to 60 characters) and \`footnote\` (text, up
to 300). Unset means the default. Colours are a theme colour like
\`var(--color-green)\` or a hex colour like \`#2a7fff\`; nothing else is
accepted. The field reference has an example of each type on an invented
shop database.

A widget is either SQL (\`sql\`, plus the columns its type needs) or built
(\`source\`, the plugin writes the query; \`line\`, \`bar\` or \`stat\` only).

| Type | Needs | Optional, with defaults |
| --- | --- | --- |
| \`line\` | \`sql\`, \`x\` (column), \`y\` (column or list of columns) | \`color\` (theme), \`guideColor\` (theme), \`headerDelta\` (false), \`chartCaption\` (\`"range"\` or \`"change"\`, none), \`headerDeltaAverageDays\` (1 to 365, none), axis fields, \`refLines\`, \`zones\`, \`band\` (\`{low, high, opacity 0.2}\`, SQL only) |
| \`bar\` | \`sql\`, \`x\`, \`y\` | \`stack\` (false, needs two or more \`y\`), \`color\`, \`headerDelta\`, \`chartCaption\`, \`headerDeltaAverageDays\`, axis fields, \`refLines\`, \`zones\` |
| \`stat\` | \`sql\` | \`y\` (the column shown, default the first), \`captions\` (up to 4 columns, default the next column), \`valueSize\` (12 to 120 or \`"fit"\`, theme default), \`meter\` (\`{min, max, target}\`), \`ranges\`, \`levelColors\`, \`rangeColumn\` |
| \`table\` | \`sql\` | \`sparklines\` (1 to 8 column names whose cells draw as tiny line charts) |
| \`combo\` | \`sql\`, \`x\`, \`series\` (1 to 8) | \`stack\` (false), right axis \`y2Min\`, \`y2Max\`, \`y2MaxLimit\`, \`y2Ticks\`, \`y2TickSuffix\`, \`y2TickCompact\`, \`y2Unit\`, left axis fields, \`refLines\`, \`zones\` (each with \`axis\`), \`guideColor\`; never \`y\`, \`color\`, \`band\`, \`headerDelta\`, \`chartCaption\` |
| \`scatter\` | \`sql\`, \`x\` (number column), \`y\` (one number column) | \`colorBy\` (column), \`trend\` (false), \`color\` (theme; one colour only, so not with \`colorBy\`), \`xMin\`, \`xMax\`, \`yMin\`, \`yMax\`, \`yMaxLimit\`, \`yTicks\`, \`yTickSuffix\`, \`yTickCompact\`, \`refLines\`, \`zones\`; never \`xLabelEvery\`, \`band\`, \`headerDelta\`, \`chartCaption\`, built \`source\` |
| \`bullet\` | \`sql\`, \`y\` (one number column: the actual value) | \`x\` (column naming each bar), \`target\` (column of targets), \`scaleMin\`, \`scaleMax\` (default zero up to the largest value, target or range end), \`ranges\` (the bands behind the bars), \`levelColors\`; never \`color\`, \`rangeColumn\`, built \`source\` |
| \`segments\` | \`sql\`, \`x\` (part name), \`y\` (part size) | \`segmentColors\` (\`{"Part name": colour}\`), \`ranges\` with \`rangeColumn\` (needed when there are ranges), \`levelColors\` |
| \`pie\` | \`sql\`, \`x\` (part name), \`y\` (part size) | \`doughnut\` (true: a hole with the total in it), \`segmentColors\`, \`ranges\` with \`rangeColumn\` (needed when there are ranges), \`levelColors\` |
| \`heatmap\` | \`sql\`, \`row\`, \`column\`, \`value\` | \`ranges\` (without them every cell is grey), \`levelColors\`, \`marker\`, \`markerColor\`, \`markerLabel\`, \`highlight\` (\`"hour"\`, \`"day"\`, \`"weekday"\`), \`cells\` (\`"square"\`, \`"fill"\`; default thin rows), \`columnLabelEvery\` (whole number) |
| \`calendar\` | \`sql\`, \`date\` (column of days), \`value\` (column) | \`ranges\` (without them every day with data is grey), \`levelColors\`, \`weekStart\` (\`"sunday"\` or \`"monday"\`; left out, the plugin setting "Week starts on", Sunday unless changed), \`year\` (a four-digit year; default the last 53 weeks up to the newest day) |
| \`text\` | \`text\` (up to 2,000 characters) or \`sql\`, never both | \`line\` (true: one thin strip, no title) |
| \`divider\` | nothing | \`title\` (the heading); \`layout.h\` must be 1; no \`sql\` or \`source\` |

- Axis fields (\`line\`, \`bar\`, \`combo\`, \`scatter\`): \`yMin\`, \`yMax\`, \`yMaxLimit\`
  (needs \`yMax\`), \`yTicks\` (1 to 12 rising numbers), \`yTickSuffix\` (up to 6
  characters), \`yTickCompact\` (true writes 8,000 as 8k), \`xLabelEvery\`
  (whole number; not on a scatter chart). A scatter chart's x is a number
  scale, so it takes \`xMin\` and \`xMax\` instead (scatter only, \`xMin\` below
  \`xMax\`). All unset means automatic.
- \`refLines\`: up to 8 \`{y, label, color, dash, axis}\`; \`y\` is required,
  \`dash\` a pattern like \`"4 3"\`.
- \`zones\`: up to 8 \`{from, to, color, opacity, axis}\`; \`from\`, \`to\` and
  \`color\` required, \`opacity\` 0.15 by default. \`axis\` (\`"left"\` or
  \`"right"\`) is a combo's only.
- \`series\` (combo): \`{column, kind, axis, color, opacity, dash, connect,
  label}\`; \`kind\` \`"bar"\` or \`"line"\` (default line), \`axis\` \`"left"\`
  (default) or \`"right"\`, \`dash\` and \`connect\` a line's only, \`label\` up to
  40 characters. Stacked bars share one axis.
- \`ranges\`: up to 12 \`{low, high, level, label}\`; bounds inclusive, either
  may be left out; the first range that holds the value wins; a range with
  neither bound is the catch-all and comes last. \`level\` is a level name
  from the plugin settings; \`label\` (up to 24 characters) is a pill's text.
- \`levelColors\`: \`{"Level name": colour}\`, this widget only.
- \`source\` (built): \`table\`, \`metric\` (a number column; empty for
  \`count\`), \`agg\` (\`sum\`, \`avg\`, \`min\`, \`max\`, \`count\`, \`latest\`;
  \`latest\` on a stat only), \`filters\` (\`[{column, op, value}]\`, \`op\` one of
  \`eq\`, \`ne\`, \`contains\`, \`not_contains\`, \`gt\`, \`gte\`, \`lt\`, \`lte\`,
  \`empty\`, \`not_empty\`), \`series\`, \`groupBy\`, \`timeColumn\`, \`timeframe\`
  (\`"global"\`, \`{"preset": "7d" | "30d" | "90d" | "12m" | "all"}\`, or
  \`{"from", "to"}\`), \`database\`. On the widget: \`compare\` (\`none\`,
  \`previous\`, \`last_year\`; not with \`series\`) and \`favorable\` (\`up\` or
  \`down\`).

## 5. What each query must return

| Type | Result shape |
| --- | --- |
| \`line\`, \`bar\` | One row per point, in drawing order (end with ORDER BY the x column). The \`x\` column (a date like \`2026-01-31\` or a label) and one number column per \`y\`. A missing value (NULL) is a gap. "Average the ends over N days" needs real dates in \`x\`. |
| \`stat\` | The first row only. The \`y\` column (or the first column) is the number; the next columns (or \`captions\`) are lines under it; \`rangeColumn\`, if set, is the number the ranges judge. Return one row (ORDER BY ... LIMIT 1 for "the latest"). |
| \`table\` | Any columns; the rows as returned, up to the row cap. Name the columns well (\`AS\`), they are the headings. A \`sparklines\` column holds a short series of numbers in each cell, comma-separated and oldest first, like \`3,5,4,8\`: build it with \`group_concat(value)\` over a subquery that has the ORDER BY. A cell with fewer than two numbers shows as text. |
| \`combo\` | One row per x value, the \`x\` column and one column per series. An empty cell is a gap, never zero. |
| \`scatter\` | One row per point: \`x\` and \`y\` are number columns, and \`colorBy\`, if set, names the group of the point. A row with no number in \`x\` or \`y\` is left out, never drawn at zero. Dates and text in \`x\` are not numbers: turn a date into one in SQL, like \`julianday(day) - julianday('2026-01-01')\`. |
| \`segments\` | One row per part, in order, up to 12: the \`x\` column names it, the \`y\` column (a number, 0 or more) sizes it. With ranges, \`rangeColumn\` is read from the first row. |
| \`pie\` | The same rows as \`segments\`: one per part, in order, up to 12, \`x\` names it and \`y\` sizes it. Slices run clockwise from twelve o'clock; a part of 0 has no slice but stays in the legend. |
| \`bullet\` | One row per bar, up to 12, in order: the \`x\` column labels it, the \`y\` column is its actual value, the \`target\` column its target. All the bars share one scale, so give them one unit, or write each as a percent of its target. A row with no number in \`y\` shows "no data". |
| \`calendar\` | One row per day: \`date\` (written \`YYYY-MM-DD\`, a time after it is ignored) and \`value\` (a number). A day with no row stays empty; a day twice takes the later row. The view ends at the newest \`date\`, not at today, so a lagging sync still fills the grid. |
| \`heatmap\` | One row per cell: \`row\`, \`column\`, \`value\` (a number), and the \`marker\` column if used. Rows and columns appear in the order the query returns them. For \`highlight\`, name columns 0 to 23 (hours), dates as \`YYYY-MM-DD\`, or weekdays like \`Monday\` or \`Mon\`. |
| \`text\` (from SQL) | The first column of the first row, as plain text (not Markdown). |

## 6. Keep a person able to edit it

The user will change the widget later with the edit panel (the pencil), so
build widgets the panel can show in full:

- Use only fields the panel has a field for. Every field in section 4 has
  one; the table "Panel label to file setting" in section 8 maps each
  panel label to its key. The one setting that is set by dragging instead
  is \`layout\`.
- Use level names that exist in the user's plugin settings (Settings, then
  the plugin, then "Value levels"). A name the settings lack draws neutral
  and shows in the panel as "(not in settings)". If you cannot read the
  settings, ask, or use the three defaults: \`Good\`, \`Watch\`, \`Alert\`.
- For a dashboard meant to be shared, use only the three default level
  names, a \`database\` path the other person has, and theme colours.
- Name every SQL column with \`AS\` so the panel's column lists read well.
- Keep the query readable. The user will see it in the panel's "SQL"
  field.
- Prefer one clear widget per question over a crowded one.

## 7. Common mistakes

- A window anchored on \`date('now')\`: empty charts when data lags. Use the
  newest row (rule 7).
- Forgetting ORDER BY: lines zigzag, bars come out of order, a stat shows an
  arbitrary row.
- \`y\` on a combo (it takes \`series\`), \`color\` on a chart with two or more
  series, \`band\` on a bar or a built widget, \`rangeColumn\` or \`captions\` on
  a built widget: the file does not read.
- A segments bar or a pie chart with ranges and no \`rangeColumn\`.
- A divider with a \`layout\` taller than 1, or with \`sql\`.
- Dates stored as text in another format (\`31/01/2026\`): they neither sort
  nor compare. Convert them in SQL or pick another column.
- Integer division: \`SUM(a)/SUM(b)\` is a whole number in SQLite when both
  are integers. Write \`100.0*SUM(a)/SUM(b)\`.
- Inventing a setting (a key not in the field reference): it is dropped on
  the next save from the panel, and some unknown values make the file
  unreadable.
- A scatter chart with a date or text in \`x\`: those rows are left out and the
  chart says "No numeric x and y values to draw." when none is left. Make \`x\`
  a number in the query.
- Bars of different units in one bullet chart: they share one scale, so the
  small ones vanish. Use one widget per unit, or write each bar as a percent
  of its target.
- A calendar whose \`date\` is not \`YYYY-MM-DD\` (\`31/01/2026\`, a name): those
  rows are skipped. Convert the date in SQL.
- Writing a whole new file when one widget was asked for: other widgets'
  settings and places get lost. Add or change one object in \`tiles\`.
- Pointing \`database\` at a file that is not SQLite (a renamed text file, a
  \`Thumbs.db\`): every widget on the dashboard then shows "This file isn't a
  SQLite database." Fix the path.
- Leaving a test dashboard or test widget behind (rule 9).

## 8. The field reference

Every setting of the dashboard, with an example of each type on an invented
shop database. The plugin's README on GitHub carries the same reference.

<!-- field reference -->
### The dashboard note

A dashboard is a Markdown note in the dashboards folder, named after its
\`id\` (\`shop.md\`). The properties mark it as ReadOut's, and the dashboard is
the JSON in the note's one json code block. Notes are what default Obsidian Sync
carries to a phone; a \`.json\` file would stay behind.

\`\`\`\`markdown
---
readout: dashboard
---

\`\`\`json
{
  "id": "shop",
  "title": "Shop",
  "database": "07 Databases/shop.db",
  "globalTimeframe": { "preset": "90d" },
  "tiles": [
    { "title": "Orders per day", "viz": "line", "x": "day", "y": "orders",
      "sql": "SELECT day, SUM(orders) AS orders FROM sales GROUP BY day ORDER BY day" }
  ]
}
\`\`\`
\`\`\`\`

Anything else in the note, such as a line of your own words above or below
the block, or more properties, is kept and ignored. Below, "the file" means
this JSON.

- \`id\`: lowercase letters, digits and hyphens. Also names the cache note.
  Renaming the title is safe; the id stays.
- \`title\`: the dashboard's name.
- \`database\`: the path of the database inside the vault. Every SQL widget
  reads this one file; a built widget's \`source\` may name its own.
- \`globalTimeframe\`: the range the header picker shows. A preset
  (\`7d\`, \`30d\`, \`90d\`, \`12m\`, \`all\`) or \`{"from":"YYYY-MM-DD","to":"YYYY-MM-DD"}\`.
- \`tiles\`: the widgets, in any order; each one's place is its \`layout\`.

A note the plugin cannot read is listed at the top of the dashboards view
with a plain sentence naming the widget and the setting. A setting the
plugin does not know is dropped the next time the panel saves the dashboard.

### Panel label to file setting

| Panel label | In the file |
| --- | --- |
| "Widget name", "Title", "Heading" | \`title\` |
| "Chart type", "Widget type" | \`viz\` |
| "Unit" | \`unit\` |
| "Size", "Width" | \`layout\` |
| "SQL" | \`sql\` |
| "X column", "Part name column", "Label column" | \`x\` |
| "Y columns (comma-separated)", "Y column", "Actual value column", "Value column", "Part size column" | \`y\` |
| "Stack the series on top of each other", "Stack the bars on top of each other" | \`stack\` |
| "Database", "Table", "Value", "Add it up", "Date", "Dimension", "Group by", "Filter data", "Time frame" | \`source\`: \`database\`, \`table\`, \`metric\`, \`agg\`, \`timeColumn\`, \`series\`, \`groupBy\`, \`filters\`, \`timeframe\` |
| "Compare with" | \`compare\` |
| "Good direction" | \`favorable\` |
| "Value levels" (the ranges) | \`ranges\` |
| "Colours for this widget" | \`levelColors\` |
| "Judge the ranges on column" | \`rangeColumn\` |
| "Caption columns (comma-separated)" | \`captions\` |
| "Number size", "Number size in pixels" | \`valueSize\` |
| "Show change over the period" | \`headerDelta\` |
| "Roll-up at the right of the title" | \`chartCaption\` |
| "Average the ends over N days" | \`headerDeltaAverageDays\` |
| "Line colour", "Bar colour", "Point colour" | \`color\` |
| "Colour the points by column" | \`colorBy\` |
| "Draw a trend line through the points" | \`trend\` |
| "Lowest x value", "Highest x value" | \`xMin\`, \`xMax\` |
| "Target column", "Lowest value on the scale", "Highest value on the scale" | \`target\`, \`scaleMin\`, \`scaleMax\` |
| "Scrub line colour" | \`guideColor\` |
| "Meter under the number" | \`meter\` |
| "Lowest value", "Highest value", "Let the top grow up to", "Labels at", "Text after each label", "Write thousands as k (8k)" | \`yMin\`, \`yMax\`, \`yMaxLimit\`, \`yTicks\`, \`yTickSuffix\`, \`yTickCompact\` (on the right axis \`y2Min\` ... \`y2TickCompact\`) |
| "Unit of the right axis" | \`y2Unit\` |
| "Label every Nth value along the bottom" | \`xLabelEvery\` |
| "Guide lines" | \`refLines\` |
| "Zones" | \`zones\` |
| "Band" | \`band\` |
| "Sparkline columns (comma-separated)" | \`sparklines\` |
| "Hint by the title" | \`hint\` |
| "Footnote under the widget" | \`footnote\` |
| "Series" | \`series\` |
| "Part colours" | \`segmentColors\` |
| "Cut a hole in the middle (a doughnut)" | \`doughnut\` |
| "Row labels column", "Column labels column", "Cell value column" | \`row\`, \`column\`, \`value\` |
| "Dot column", "Dot colour", "Dot label in the legend" | \`marker\`, \`markerColor\`, \`markerLabel\` |
| "Highlight", "Cells", "Label every Nth column" | \`highlight\`, \`cells\`, \`columnLabelEvery\` |
| "Date column", "Day value column", "Week starts on", "Year" | \`date\`, \`value\`, \`weekStart\`, \`year\` |
| "The words come from", "Text" | \`sql\` or \`text\` |
| "One thin line, like a section divider (no title)" | \`line\` |

### Every widget

- \`viz\`: the type. \`line\`, \`bar\`, \`stat\` (one big number), \`table\`,
  \`divider\`, \`combo\`, \`scatter\`, \`bullet\`, \`segments\`, \`pie\`, \`heatmap\`, \`calendar\` or \`text\`.
- \`title\`: the name on top of the widget.
- \`unit\`: shown with the values, like "orders" or "%".
- \`layout\`: the widget's place on the grid, \`{"x":0,"y":0,"w":2,"h":2}\` in
  cells. Edit mode writes it when you drag and resize.
- \`hint\`: a few words at the right of the title, up to 60 characters.
- \`footnote\`: a sentence under the widget, up to 300 characters.
  Every type but \`divider\` takes both.

A widget is either an SQL widget (\`sql\`, and the column names its type
needs) or a built widget (\`source\`: the plugin writes the SQL). Only read
queries run: one statement starting with SELECT, WITH, PRAGMA or EXPLAIN,
up to 5,000 rows. The plugin never writes to a database, and it does no
date arithmetic for an SQL widget: a window like "the last 14 days" is
written in the query.

Colours, wherever a setting takes one, are a theme colour such as
\`var(--color-green)\` or a hex colour such as \`#2a7fff\`; nothing else is
accepted.

### Built widgets

\`"source": { ... }\` instead of \`sql\`, on a line, bar or stat:

- \`table\`, \`metric\` (a number column), \`agg\` (\`sum\`, \`avg\`, \`min\`, \`max\`,
  \`count\`, \`latest\`; \`latest\` on a stat only).
- \`filters\`: a list of \`{"column", "op", "value"}\`; \`op\` is \`eq\`, \`ne\`,
  \`contains\`, \`not_contains\`, \`gt\`, \`gte\`, \`lt\`, \`lte\`, \`empty\`,
  \`not_empty\`. All rows must match.
- \`series\`: one line or bar per value of a column. \`groupBy\`: what to chart
  over (defaults to the time column). \`timeColumn\`: the date column.
- \`timeframe\`: \`"global"\` follows the header picker; a preset or a from/to
  range is fixed. \`database\`: a database other than the dashboard's.
- On the widget: \`compare\` (\`none\`, \`previous\`, \`last_year\`) draws the
  earlier period faintly; \`favorable\` (\`up\` or \`down\`) says which direction
  is good.

### Line and bar charts

\`"viz": "line"\` or \`"bar"\`, \`x\` (the column along the bottom) and \`y\` (one
column, or a list for several series). \`stack: true\` stacks a bar chart's
series.

\`\`\`json
{ "title": "Revenue per day", "viz": "bar", "x": "day", "y": "revenue",
  "sql": "SELECT day, SUM(revenue) AS revenue FROM sales GROUP BY day ORDER BY day",
  "color": "#2a7fff", "yMin": 0, "yTickCompact": true,
  "refLines": [{ "y": 1000, "label": "break-even", "dash": "4 3" }] }
\`\`\`

- \`color\`: the line or bars of a one-series chart. \`guideColor\`: the line
  that follows the pointer (line and combo).
- \`headerDelta: true\`: the change over the period at the right of the
  title. \`chartCaption\`: \`"range"\` (lowest to highest) or \`"change"\` in
  the same place. \`headerDeltaAverageDays\` (1 to 365) averages each end.
  One-series line or bar only.

#### Axis (line, bar, combo, scatter)

- \`yMin\`, \`yMax\`: a fixed range. \`yMaxLimit\`: the top starts at \`yMax\` and
  grows to fit the data, never past this (needs \`yMax\`).
- \`yTicks\`: the labels' positions, 1 to 12 rising numbers like \`[0, 50, 100]\`.
- \`yTickSuffix\`: up to 6 characters after each label, like "h" or "%".
  \`yTickCompact: true\` writes 8,000 as 8k.
- \`xLabelEvery\`: label every Nth value along the bottom (not on a scatter
  chart).
- \`xMin\`, \`xMax\`: scatter chart only: the ends of the number scale along the
  bottom.

A value outside a fixed range is drawn at the edge.

#### Guide lines and zones (line, bar, combo, scatter)

- \`refLines\`: up to 8 \`{"y", "color", "dash", "label", "axis"}\`: a line
  across the chart. \`dash\` is a pattern like "4 3"; a \`label\` names the
  line in the legend.
- \`zones\`: up to 8 \`{"from", "to", "color", "opacity", "axis"}\`: a shaded
  band behind the chart; \`opacity\` defaults to 0.15.
- \`axis\` (\`"left"\` or \`"right"\`) is a combo chart's only. On a scatter chart
  they follow the scale up the side.

On an automatic axis, lines and zones count as data, so a goal above every
value stays in view.

#### Band (SQL line chart)

\`"band": {"low": "lo", "high": "hi", "opacity": 0.2}\`: the area between two
columns, row by row, under the line, in its colour. The band columns are
not also in \`y\`.

\`\`\`json
{ "title": "Order value", "viz": "line", "x": "day", "y": "avg",
  "sql": "SELECT day, AVG(revenue/orders) AS avg, MIN(revenue/orders) AS lo, MAX(revenue/orders) AS hi FROM sales GROUP BY day ORDER BY day",
  "band": { "low": "lo", "high": "hi" },
  "zones": [{ "from": 20, "to": 30, "color": "var(--color-green)" }] }
\`\`\`

### One big number (stat)

\`"viz": "stat"\`. An SQL stat shows the first row's \`y\` column (unset, the
first column); a built stat its one value.

\`\`\`json
{ "title": "Fulfilled", "viz": "stat", "unit": "%", "valueSize": "fit",
  "sql": "SELECT ROUND(100.0*SUM(orders-returns)/SUM(orders),1) AS pct FROM sales",
  "meter": { "min": 0, "max": 100, "target": 95 } }
\`\`\`

- \`valueSize\`: the number's size, 12 to 120 pixels, or \`"fit"\` to shrink it
  until it shows whole. Unset, the theme decides.
- \`meter\`: \`{"min", "max", "target"}\`: a thin bar under the number, filled
  to where it sits, with a mark at the target.
- \`captions\`: the columns shown as lines under the number (SQL), up to 4;
  unset, the next column.
- \`ranges\`, \`levelColors\`, \`rangeColumn\`: value levels, below.

### Value levels (stat, segments, pie, heatmap, calendar, bullet)

The levels themselves (Good, Watch, Alert by default, each with a colour)
live in the plugin settings, not in the file. A widget lists its own steps:

- \`ranges\`: up to 12 \`{"low", "high", "level", "label"}\`. Bounds are
  inclusive and either may be left out; the first range that holds the
  value wins; a range with neither is the catch-all and comes last.
  \`label\` is the pill's text.
- \`levelColors\`: a different colour for a level on this widget only,
  like \`{"Good": "#2a7fff"}\`.
- \`rangeColumn\`: judge the ranges on another column of the first row
  (SQL stat, and needed on a segments bar or a pie chart).

A range naming a level the settings do not have draws neutral. A dashboard
shared with someone else needs its levels in their settings too, or should
use the three default names.

How a level shows on a widget is a setting too: rail, outline or tint for
"One big number", and the same choice for a segments bar and a pie chart (by
default the same look as "One big number").

### Table

\`"viz": "table"\`: the query's rows. SQL only.

\`\`\`json
{ "title": "Orders by channel", "viz": "table", "sparklines": ["trend"],
  "sql": "SELECT channel, SUM(orders) AS orders, group_concat(orders) AS trend FROM (SELECT channel, day, orders FROM sales ORDER BY day) GROUP BY channel" }
\`\`\`

- \`sparklines\`: 1 to 8 column names. Each cell of such a column is drawn as a
  tiny line chart, on its own scale from lowest to highest, with a dot on the
  last value. The cell holds the series as numbers separated by commas, oldest
  first (a JSON list like \`[3,5,4,8]\` also reads); a cell with fewer than two
  numbers shows as the text it is. Read the series from a subquery that has
  its ORDER BY, as above: \`group_concat\` does not promise an order of its own.

### Section divider

\`"viz": "divider"\`: a thin line with an optional heading (\`title\`). No query;
its \`layout\` is one row high.

### Combo chart

\`"viz": "combo"\`: bars and lines over one \`x\` column, each series on the left
or the right axis. One row per x value; an empty cell is a gap, never zero.

\`\`\`json
{ "title": "Orders and returns", "viz": "combo", "x": "day", "stack": true,
  "sql": "SELECT day, SUM(CASE WHEN channel='Web' THEN orders END) AS web, SUM(CASE WHEN channel='Shop' THEN orders END) AS shop, ROUND(100.0*SUM(returns)/SUM(orders),1) AS rate FROM sales GROUP BY day ORDER BY day",
  "series": [{ "column": "web", "kind": "bar" }, { "column": "shop", "kind": "bar" },
             { "column": "rate", "kind": "line", "axis": "right", "dash": "4 3" }],
  "y2Unit": "%", "y2TickSuffix": "%" }
\`\`\`

- \`series\`: 1 to 8 \`{"column", "kind", "axis", "color", "opacity", "dash",
  "connect", "label"}\`. \`kind\` is \`"bar"\` or \`"line"\` (default line);
  \`axis\` \`"left"\` (default) or \`"right"\`; \`dash\` and \`connect\` (true joins
  a line across empty rows) are a line's only; \`label\` names the series in
  the legend.
- \`stack: true\` stacks the bars; they must share one axis.
- The right axis: \`y2Min\`, \`y2Max\`, \`y2MaxLimit\`, \`y2Ticks\`,
  \`y2TickSuffix\`, \`y2TickCompact\`, like their left twins, and \`y2Unit\`
  for the readout. The left axis, guide lines, zones, \`guideColor\`,
  \`hint\` and \`footnote\` work as on a line chart.
- A combo takes no \`y\`, \`color\`, \`band\`, \`headerDelta\` or \`chartCaption\`.

### Scatter chart

\`"viz": "scatter"\`: one point per row of the query, placed by a number in \`x\`
(along the bottom) and a number in \`y\` (up the side). One \`y\` column.

\`\`\`json
{ "title": "Orders against ad spend", "viz": "scatter", "x": "spend", "y": "orders",
  "sql": "SELECT ad_spend AS spend, orders, channel FROM sales ORDER BY day",
  "colorBy": "channel", "trend": true, "xMin": 0, "yMin": 0 }
\`\`\`

- \`x\`, \`y\`: number columns. A row with no number in either is left out,
  never drawn at zero.
- \`colorBy\`: a column whose values colour the points, one colour each: the
  four most common, the rest together as Other, named in the legend.
  Without it the points take \`color\`, or the theme ink.
- \`trend: true\`: the least-squares line through all the points, dashed,
  named in the legend; hovering it reads its slope and r squared.
- \`xMin\`, \`xMax\`, and the y axis fields, \`refLines\` and \`zones\`: as above.
  Hovering a point reads its numbers.

### Bullet chart

\`"viz": "bullet"\`: for each row, a bar for the actual value against a mark
for its target, on one scale shaded in bands by the value levels.

\`\`\`json
{ "title": "Sales against target", "viz": "bullet", "x": "channel", "y": "sales", "target": "goal",
  "sql": "SELECT channel, SUM(revenue) AS sales, 1000 AS goal FROM sales GROUP BY channel ORDER BY channel",
  "ranges": [{ "low": 1000, "level": "Good" }, { "low": 600, "level": "Watch" }, { "level": "Alert" }],
  "scaleMax": 1500 }
\`\`\`

- \`y\`: the actual value, one number column. \`x\`: the column that labels each
  bar; left out, the bars have no labels. \`target\`: the column of targets,
  drawn as a mark; left out, no marks.
- \`ranges\`, \`levelColors\`: the bands, each range in its level's colour behind
  the bars. A gap between ranges stays plain; two ranges written for whole
  numbers (79 and 80) read as one band.
- \`scaleMin\`, \`scaleMax\`: the ends of the one scale all the bars share. Left
  out, the scale runs from zero (or the lowest value, below zero) up to the
  largest value, target or range end, on a round number. A value past the end
  is drawn at the end.

### Segments bar

\`"viz": "segments"\`: one bar split into the query's rows, each as wide as its
share. One row per part, in order, up to 12.

\`\`\`json
{ "title": "Tasks", "viz": "segments", "x": "status", "y": "n",
  "sql": "SELECT status, n FROM tasks ORDER BY ord",
  "segmentColors": { "Done": "var(--color-green)" } }
\`\`\`

- \`x\`: the column naming each part. \`y\`: the one column sizing it.
- \`segmentColors\`: a colour per part name; a part without one takes the
  theme colours in turn.
- \`ranges\` (with \`rangeColumn\`) and \`levelColors\`: a level pill on the
  title row and the level look on the whole bar.

### Pie chart

\`"viz": "pie"\`: a circle split into the query's rows, each slice as big as its
share, clockwise from twelve o'clock. The same columns as a segments bar.

\`\`\`json
{ "title": "Orders by channel", "viz": "pie", "x": "channel", "y": "orders",
  "sql": "SELECT channel, SUM(orders) AS orders FROM sales GROUP BY channel ORDER BY orders DESC",
  "doughnut": true }
\`\`\`

- \`x\`: the column naming each part. \`y\`: the one column sizing it. Up to 12
  parts; the theme has five series colours, so from the sixth part on they
  share one faint colour. Group small parts in the query.
- \`doughnut\`: true cuts a hole in the middle and writes the total in it.
- \`segmentColors\`, \`ranges\` (with \`rangeColumn\`) and \`levelColors\` work as on
  a segments bar.

### Heatmap

\`"viz": "heatmap"\`: a grid with one cell per row of the query, placed by its
row and column values (in the order the query returns them) and coloured by
the value levels.

\`\`\`json
{ "title": "Minutes by hour", "viz": "heatmap", "row": "day", "column": "hr", "value": "minutes",
  "sql": "SELECT day, printf('%02d', hour) AS hr, minutes, meeting FROM work ORDER BY day DESC, hour",
  "ranges": [{ "high": 20, "level": "Good" }, { "high": 45, "level": "Watch" }, { "level": "Alert" }],
  "marker": "meeting", "highlight": "hour", "cells": "fill" }
\`\`\`

- \`row\`, \`column\`, \`value\`: the columns that place and colour each cell.
- \`ranges\`, \`levelColors\`: the colours; without ranges every cell is grey.
- \`marker\`: a column; a cell gets a dot where it is not empty, 0 or false.
  \`markerColor\`, \`markerLabel\` (its name in the legend) need a \`marker\`.
- \`highlight\`: lights up today on this device: \`"hour"\` the column named
  for the current hour (0 to 23), \`"day"\` the row or column named for
  today's date (YYYY-MM-DD), \`"weekday"\` the row or column named for
  today's weekday (Monday or Mon).
- \`cells\`: \`"square"\` for square cells, \`"fill"\` to stretch the rows over
  the tile's height; unset, thin rows.
- \`columnLabelEvery\`: label every Nth column.

### Year calendar

\`"viz": "calendar"\`: one square for each day, a week to a column, coloured by
the value levels. A separate type from the heatmap because it reads one date
column where a heatmap reads a row and a column.

\`\`\`json
{ "title": "Orders per day", "viz": "calendar", "date": "day", "value": "orders",
  "sql": "SELECT day, SUM(orders) AS orders FROM sales GROUP BY day ORDER BY day",
  "ranges": [{ "low": 40, "level": "Good" }, { "low": 20, "level": "Watch" }, { "level": "Alert" }],
  "weekStart": "monday" }
\`\`\`

- \`date\`, \`value\`: the columns of days (written \`2026-01-31\`) and numbers. A
  day with no row stays empty; a day twice takes the later row.
- \`ranges\`, \`levelColors\`: the colours, as on a heatmap; without ranges every
  day with data is grey.
- \`weekStart\`: \`"sunday"\` or \`"monday"\`, the day each column of weeks
  starts on. Left out, the calendar follows the plugin setting "Week starts on"
  (Sunday unless the member changed it), so one choice covers every calendar.
- \`year\`: a whole calendar year like \`2026\`. Left out, the calendar shows the
  last 53 weeks up to the newest day in the data, never "today".

### Text

\`"viz": "text"\`: plain words. Either \`text\` (up to 2,000 characters) or \`sql\`
(the first column of the first row is shown), never both.

\`\`\`json
{ "viz": "text", "line": true, "text": "Every number here is invented." }
{ "title": "Freshness", "viz": "text", "sql": "SELECT 'Data through ' || MAX(day) FROM sales" }
\`\`\`

- Plain text, not Markdown: a blank line starts a paragraph, a single line
  break stays; links and bold show as typed.
- \`line: true\`: one thin strip in a thin row, like a divider, with no title.
- Written text runs no query on any device.
<!-- /field reference -->

## 9. A widget inside a note

A code block in any note draws one widget, read-only. The language word after
the three backticks is \`readout\`. The block below is shown indented; in
a note it is fenced:

    \`\`\`readout
    dashboard: sales
    widget: Orders per day
    \`\`\`

Or the block holds one widget written out as JSON: the widget's own settings
from section 4 plus \`database\`, the vault path of the database. It is read by
the same parser as a dashboard file, so every rule above applies and the query
must be read-only.

    \`\`\`readout
    { "database": "Databases/shop.db", "title": "Orders per day", "viz": "bar",
      "x": "day", "y": "orders", "sql": "SELECT day, SUM(orders) AS orders FROM sales GROUP BY day ORDER BY day" }
    \`\`\`

- By name: \`dashboard\` is the dashboard's id (its note's file name without \`.md\`),
  \`widget\` is a widget's \`title\` or its number counting from 1 (dividers count).
  The note follows the dashboard; nothing is copied.
- Written out: not a whole dashboard (no \`tiles\`), one widget. Use it when the
  chart belongs to the note and no dashboard needs it.
- Where the data comes from: live where the device can open the database,
  otherwise the desktop's last result. A named widget reads the dashboard's
  cache; a written-out widget keeps its own small cache in the cache folder,
  written by the desktop when the note is shown. A phone writes nothing.
- A mistake in the block, an unknown dashboard or a failed query is shown as a
  line in the block, never as an error in the note.

## 10. Turn this guide into a skill

An agent can turn this guide into a skill, a saved routine it runs each time
it is asked to build a widget or a whole dashboard. Whatever your agent calls
such a thing, the shape is the same:

- **Point at this file, do not copy it.** ReadOut brings this guide up to
  date with each version, with new chart types and settings. A copy goes
  stale; a skill that says "read this file first" always reads the current
  text. The skill names this file's path in the dashboards folder:
  \`07 Databases/Dashboards/AI-WIDGET-GUIDE.md\`, unless your "Dashboards
  folder" setting says otherwise.
- **Keep the procedure as its spine.** The seven steps of section 3, with
  the plugin checks of steps 4 to 6 (check the note, open the
  dashboard and look, open the widget in the edit panel), are what leave a
  widget a person can still edit. The skill runs them in order.
- **Add only the user's own preferences on top**: their databases, colours,
  value levels and layout habits. Everything else stays in this guide.

A prompt to give an agent:

    Read 07 Databases/Dashboards/AI-WIDGET-GUIDE.md and make a skill that follows its procedure. Link to the guide, don't copy it, and add my preferences.
`;

/* The guides the plugin writes into the dashboards folder. `legacy` holds
 * the fingerprints of the texts released versions wrote without a
 * fingerprint line, so an unedited old copy is still recognised and
 * refreshed. */
const GUIDE_FILES = [
  { file: 'README.md', text: DASHBOARD_README, revision: 12, legacy: ['ac2ce38f', '110587e1', '187f3e85', '9b05f8bf'] },
  { file: 'AI-WIDGET-GUIDE.md', text: AI_WIDGET_GUIDE, revision: 12, legacy: [] },
];

/* Live samples in the help file. Each widget section of the help file
 * carries a small code block, ```readout-sample with one word in it
 * (the widget type), and the plugin draws a sample widget there with the
 * real renderer and the fixed, invented rows below: no file, no query, no
 * network, and it always looks like the widget does in this version and
 * this theme. Without the plugin (or on GitHub) the block shows as a plain
 * code block, so the caption above it says in words what it is.
 *
 * The samples use the default levels and looks, never the member's
 * settings, so a sample looks the same in every vault. Nothing here is
 * relative to today: no date highlight, no "last N days". */
const SAMPLE_BLOCK_LANG = 'readout-sample';

const SAMPLE_HEAT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const SAMPLE_HEAT_ROWS = [];
for (let d = 0; d < SAMPLE_HEAT_DAYS.length; d++) {
  for (let hr = 9; hr <= 17; hr++) {
    /* A made-up week: busy late mornings, a lunch dip, a quiet Monday. */
    const base = hr === 12 || hr === 13 ? 3 : (hr >= 10 && hr <= 11) || (hr >= 14 && hr <= 15) ? 9 : 5;
    SAMPLE_HEAT_ROWS.push([SAMPLE_HEAT_DAYS[d], String(hr), Math.max(0, base + ((d * 7 + hr * 3) % 5) - 2 - (d === 0 ? 2 : 0))]);
  }
}

/* A made-up fortnight and a half of orders against ad spend, two channels. */
const SAMPLE_SCATTER_ROWS = [];
for (let i = 0; i < 26; i++) {
  const spend = 20 + i * 5 + ((i * 7) % 9);
  SAMPLE_SCATTER_ROWS.push([spend, Math.round(0.9 * spend + 12 + ((i * 13) % 11) - 5), i % 3 === 0 ? 'Shop' : 'Web']);
}

/* A made-up year of orders per day, ending 2026-01-18: quieter weekends, a
 * busy spring and autumn, a few days with no row. */
const SAMPLE_CALENDAR_ROWS = [];
for (let i = 0; i < 365; i++) {
  const ms = Date.UTC(2026, 0, 18) - (364 - i) * 86400000;
  const weekday = new Date(ms).getUTCDay();
  if (i % 23 === 11) continue;
  const season = 18 + Math.round(14 * Math.sin((i / 365) * 2 * Math.PI * 2));
  SAMPLE_CALENDAR_ROWS.push([calendarIsoOf(ms), Math.max(0, season + (weekday === 0 || weekday === 6 ? -12 : 6) + ((i * 37) % 17) - 8)]);
}

const WIDGET_SAMPLES = {
  line: {
    size: 'chart',
    spec: { title: 'Orders per day', viz: 'line', x: 'day', y: ['orders'], unit: 'orders', refLines: [{ y: 40, label: 'goal', dash: '4 3' }] },
    table: { columns: ['day', 'orders'], rows: [['2026-01-05', 31], ['2026-01-06', 35], ['2026-01-07', 33], ['2026-01-08', 38], ['2026-01-09', 44], ['2026-01-10', 41], ['2026-01-11', 29], ['2026-01-12', 34], ['2026-01-13', 39], ['2026-01-14', 42], ['2026-01-15', 40], ['2026-01-16', 47], ['2026-01-17', 45], ['2026-01-18', 36]] },
  },
  bar: {
    size: 'chart',
    spec: { title: 'Orders per week, by channel', viz: 'bar', x: 'week', y: ['web', 'shop'], stack: true, unit: 'orders' },
    table: { columns: ['week', 'web', 'shop'], rows: [['W1', 120, 80], ['W2', 135, 76], ['W3', 128, 90], ['W4', 150, 85], ['W5', 162, 70], ['W6', 158, 88], ['W7', 171, 92], ['W8', 180, 84]] },
  },
  combo: {
    size: 'chart',
    spec: { title: 'Orders and return rate', viz: 'combo', x: 'month', unit: 'orders', y2Unit: '%', y2TickSuffix: '%', y2Min: 0,
      series: [{ column: 'orders', kind: 'bar' }, { column: 'returns', kind: 'line', axis: 'right', dash: '4 3', label: 'return rate' }] },
    table: { columns: ['month', 'orders', 'returns'], rows: [['Jan', 820, 6.1], ['Feb', 760, 5.4], ['Mar', 910, 4.8], ['Apr', 980, 5.2], ['May', 1040, 4.1], ['Jun', 1120, 3.7]] },
  },
  scatter: {
    size: 'chart',
    spec: { title: 'Orders against ad spend', viz: 'scatter', x: 'spend', y: ['orders'], unit: 'orders', colorBy: 'channel', trend: true },
    table: { columns: ['spend', 'orders', 'channel'], rows: SAMPLE_SCATTER_ROWS },
  },
  stat: {
    size: 'short',
    spec: { title: 'Orders this month', viz: 'stat', y: ['orders'], unit: 'orders', meter: { min: 0, max: 1500, target: 1200 },
      ranges: [{ low: 1200, level: 'Good', label: 'on track' }, { level: 'Watch', label: 'behind' }] },
    table: { columns: ['orders', 'note'], rows: [[1240, '+12% on last month']] },
  },
  table: {
    size: 'chart',
    spec: { title: 'Orders by channel', viz: 'table', sparklines: ['last 14 days'] },
    table: { columns: ['channel', 'orders', 'last 14 days'], rows: [
      ['Web', 1240, '31,35,33,38,44,41,29,34,39,42,40,47,45,36'],
      ['Shop', 612, '22,18,25,21,19,30,33,20,17,24,26,22,28,31'],
      ['Phone', 238, '9,12,10,8,7,11,14,9,12,15,13,10,8,6'],
      ['Email', 96, '2,3,2,5,4,6,5,4,7,6,8,9,7,10'],
      ['Market', 54, '8,7,7,6,5,5,4,6,4,3,4,2,3,2'],
    ] },
  },
  segments: {
    size: 'short',
    spec: { title: 'Tasks by status', viz: 'segments', x: 'status', y: ['tasks'], unit: 'tasks' },
    table: { columns: ['status', 'tasks'], rows: [['To do', 8], ['Doing', 5], ['Done', 12]] },
  },
  pie: {
    size: 'chart',
    spec: { title: 'Orders by channel', viz: 'pie', x: 'channel', y: ['orders'], unit: 'orders', doughnut: true },
    table: { columns: ['channel', 'orders'], rows: [['Web', 1240], ['Shop', 612], ['Phone', 238], ['Email', 96]] },
  },
  heatmap: {
    size: 'chart',
    spec: { title: 'Orders by weekday and hour', viz: 'heatmap', row: 'day', column: 'hour', value: 'orders', unit: 'orders', cells: 'fill',
      ranges: [{ low: 8, level: 'Good' }, { low: 4, level: 'Watch' }, { level: 'Alert' }] },
    table: { columns: ['day', 'hour', 'orders'], rows: SAMPLE_HEAT_ROWS },
  },
  bullet: {
    size: 'short',
    spec: { title: 'Sales against target, by region', viz: 'bullet', x: 'region', y: ['sales'], target: 'goal', unit: 'k', scaleMax: 350,
      ranges: [{ low: 250, level: 'Good', label: 'on target' }, { low: 150, level: 'Watch', label: 'close' }, { level: 'Alert', label: 'behind' }] },
    table: { columns: ['region', 'sales', 'goal'], rows: [['North', 275, 250], ['South', 190, 220], ['West', 140, 200]] },
  },
  calendar: {
    size: 'short',
    spec: { title: 'Orders per day', viz: 'calendar', date: 'day', value: 'orders', unit: 'orders',
      ranges: [{ low: 30, level: 'Good', label: '30 or more' }, { low: 15, level: 'Watch', label: '15 to 29' }, { level: 'Alert', label: 'under 15' }] },
    table: { columns: ['day', 'orders'], rows: SAMPLE_CALENDAR_ROWS },
  },
  text: {
    size: 'short',
    spec: { title: 'About this dashboard', viz: 'text', text: 'Every number here is invented.\n\nOrders count once they are paid; returns count in the month they come back.' },
    table: { columns: [], rows: [] },
  },
  divider: {
    size: 'thin',
    spec: { title: 'Sales', viz: 'divider' },
    table: { columns: [], rows: [] },
  },
};

/* The tile classes the dashboards view gives a widget of this type. */
function sampleTileClass(tile) {
  return 'icor-sqlv-tile' + (tile.viz === 'stat' ? ' is-stat' : '') + (tile.viz === 'divider' ? ' is-divider' : '') +
    (tile.viz === 'text' ? ' is-text' + (tile.line === true ? ' is-line' : '') : '');
}

/* Draw the sample named by a block's text into `el`. Returns whether a
 * sample was drawn; an unknown word gets a short line, never an error.
 * `observers` collects the resize observers the widget makes, so the
 * owner can disconnect them. */
function renderWidgetSample(el, word, observers) {
  const key = String(word || '').trim();
  const sample = Object.prototype.hasOwnProperty.call(WIDGET_SAMPLES, key) ? WIDGET_SAMPLES[key] : null;
  if (!sample) {
    el.createDiv({ cls: 'icor-sqlv-note icor-sqlv-sample-missing', text: 'No sample for this widget type.' });
    return false;
  }
  const box = el.createDiv({ cls: 'icor-sqlv-sample is-' + sample.size });
  /* The plugin's colour and font tokens live under this attribute. */
  box.setAttribute('data-ink-plugin', 'icor-for-life-sqlite-viewer');
  const tileEl = box.createDiv({ cls: sampleTileClass(sample.spec) });
  renderTile(tileEl, sample.spec, sample.table, { observers, levels: DEFAULT_LEVELS, levelLooks: DEFAULT_LEVEL_LOOKS });
  return true;
}

/* One sample block in a note: drawn when the block loads, its observers
 * released when the block goes (the note closes or re-renders). */
class WidgetSampleChild extends MarkdownRenderChild {
  constructor(containerEl, word) {
    super(containerEl);
    this.word = word;
    this.observers = [];
  }

  onload() {
    renderWidgetSample(this.containerEl, this.word, this.observers);
  }

  onunload() {
    for (const observer of this.observers) observer.disconnect();
    this.observers = [];
  }
}

/* ------------------------------------------- a widget inside a note -- */

/* A code block in any note draws one widget, read-only:
 *
 *     ```readout
 *     dashboard: health-overview
 *     widget: Heart rate
 *     ```
 *
 * names a widget of a saved dashboard (by its title or its number on the
 * dashboard, counting from 1), so the note always shows what the dashboard
 * shows; or the block holds one widget written out, as a JSON object with
 * the dashboard's "database" and the widget's own settings:
 *
 *     ```readout
 *     { "database": "Databases/shop.db", "viz": "bar", "x": "day", "y": "orders", "sql": "SELECT ..." }
 *     ```
 *
 * The word after the three backticks is the one constant below. Every rule
 * of a dashboard file applies, because the block is run through the same
 * parser. It reads like the dashboards do: live where this device can open
 * the database; otherwise from the desktop's cache. A named widget reads
 * the dashboard's own cache (the dashboards view writes it, a block never
 * does); a written-out widget has none, so on the desktop it keeps its own
 * small cache beside the others, keyed by what the block says. */
const WIDGET_BLOCK_LANG = 'readout';

/* The block's text as a request, or a plain-words reason. Pure.
 * { ok, kind: 'ref', dashboard, widget } with widget a 1-based number or a
 * title, or { ok, kind: 'inline', spec, key }: a one-widget dashboard the
 * parser accepted, and the key its cache is filed under. */
function parseWidgetBlock(text) {
  const body = String(text === null || text === undefined ? '' : text).trim();
  if (!body) return { ok: false, reason: 'The block is empty. Name a widget ("dashboard: ..." and "widget: ...") or write one as JSON.' };
  if (body.startsWith('{')) {
    let raw;
    try { raw = JSON.parse(body); } catch (e) { return { ok: false, reason: 'The block looks like JSON but is not valid JSON. ' + e.message }; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'A written-out widget must be one JSON object.' };
    if (raw.tiles !== undefined) return { ok: false, reason: 'A block draws one widget, not a whole dashboard. Write one widget, or name one with "dashboard:" and "widget:".' };
    const database = raw.database;
    const tile = Object.assign({}, raw);
    delete tile.database;
    const wrapped = JSON.stringify({ id: 'note-block', title: 'Note block', database: typeof database === 'string' ? database : undefined, tiles: [tile] });
    const parsed = parseDashboardSpec(wrapped);
    if (!parsed.ok) return { ok: false, reason: parsed.reason.replace(/^Tile 1/, 'The widget').replace('the dashboard needs a top-level "database"', 'the block needs a "database": the vault path of the database') };
    return { ok: true, kind: 'inline', spec: parsed.spec, key: shortHash(JSON.stringify(parsed.spec.tiles[0]) + '|' + parsed.spec.database) };
  }
  const fields = {};
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = /^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (!m) return { ok: false, reason: 'Each line of a block is "name: value", like "dashboard: health-overview". This line is not: ' + line.trim().slice(0, 60) };
    const key = m[1].toLowerCase();
    if (key !== 'dashboard' && key !== 'widget') return { ok: false, reason: 'A block knows "dashboard" and "widget", not "' + m[1] + '".' };
    fields[key] = m[2];
  }
  if (!fields.dashboard) return { ok: false, reason: 'The block needs a "dashboard:" line: the id of a dashboard, which is its note\'s file name without .md.' };
  if (!fields.widget) return { ok: false, reason: 'The block needs a "widget:" line: the title of a widget on the dashboard, or its number counting from 1.' };
  const widget = /^\d+$/.test(fields.widget) ? Number(fields.widget) : fields.widget;
  return { ok: true, kind: 'ref', dashboard: fields.dashboard, widget };
}

/* The index of the widget a block names on a dashboard, or -1. A number
 * counts from 1, dividers included, as the dashboard lays them out; a title
 * matches without regard to case or the spaces around it. Pure. */
function widgetIndexIn(spec, widget) {
  const tiles = (spec && spec.tiles) || [];
  if (typeof widget === 'number') return widget >= 1 && widget <= tiles.length ? widget - 1 : -1;
  const want = String(widget).trim().toLowerCase();
  return tiles.findIndex((t) => String(t.title || '').trim().toLowerCase() === want);
}

/* How tall a block is, by what it draws (the sizes are in styles.css). */
function blockSizeFor(tile) {
  if (tile.viz === 'divider' || (tile.viz === 'text' && tile.line === true)) return 'thin';
  if (['stat', 'segments', 'bullet', 'calendar', 'text'].includes(tile.viz)) return 'short';
  return 'chart';
}

/* Where a written-out widget's desktop result is kept. */
/* How long one read of the dashboards folder serves the widget blocks of a note. */
const BLOCK_SPEC_PASS_MS = 2000;

/* How long a note-block cache file may sit unused before it is removed. */
const BLOCK_CACHE_MAX_AGE_DAYS = 60;

/* When a cache entry was computed, as a number; 0 when it does not say. */
function cachedAt(entry) {
  const t = Date.parse(entry && entry.computedAt);
  return Number.isFinite(t) ? t : 0;
}

/* A cache note this big is warned about on the desktop: Obsidian Sync
 * Standard carries files up to 5 MB. */
const CACHE_NOTE_WARN_BYTES = 4 * MB;

function blockCachePath(cacheFolder, key, ext) {
  return normalizePath(cacheFolder + '/notes/' + key + '.' + (ext || 'md'));
}

class WidgetBlockChild extends MarkdownRenderChild {
  constructor(containerEl, source, plugin) {
    super(containerEl);
    this.source = source;
    this.plugin = plugin;
    this.observers = [];
    this.gone = false;
  }

  onload() {
    this.draw().catch((e) => {
      console.error(safeLogLine('a ' + WIDGET_BLOCK_LANG + ' block failed to draw', e));
      this.say('This widget could not be drawn: ' + (e && e.message ? e.message : 'unknown error') + '.');
    });
  }

  onunload() {
    this.gone = true;
    for (const observer of this.observers) observer.disconnect();
    this.observers = [];
  }

  /* A line in the block's own box, never an exception into the note. */
  say(text) {
    if (this.gone) return;
    const box = this.containerEl.createDiv({ cls: 'icor-sqlv-block-note' });
    box.setAttribute('data-ink-plugin', 'icor-for-life-sqlite-viewer');
    box.createDiv({ cls: 'icor-sqlv-error', text });
  }

  async draw() {
    const request = parseWidgetBlock(this.source);
    if (!request.ok) { this.say(request.reason); return; }
    const plugin = this.plugin;
    let spec;
    let index = 0;
    let dashboardCache = null;
    if (request.kind === 'ref') {
      const { specs } = await plugin.blockSpecs();
      spec = specs.find((d) => d.id === request.dashboard);
      if (!spec) { this.say('There is no dashboard "' + request.dashboard + '". Use the id of a dashboard in ' + plugin.settings.dashboardFolder + ', which is its note\'s file name without .md.'); return; }
      index = widgetIndexIn(spec, request.widget);
      if (index < 0) {
        this.say('The dashboard "' + spec.title + '" has no widget ' + (typeof request.widget === 'number' ? 'number ' + request.widget : 'titled "' + request.widget + '"') + '.');
        return;
      }
    } else {
      spec = request.spec;
    }
    const tile = spec.tiles[index];
    const box = this.containerEl.createDiv({ cls: 'icor-sqlv-block is-' + blockSizeFor(tile) });
    box.setAttribute('data-ink-plugin', 'icor-for-life-sqlite-viewer');
    const tileEl = box.createDiv({ cls: sampleTileClass(tile) });
    const extras = (table, more) => Object.assign({ observers: this.observers }, more || {}, plugin.levelExtras());
    if (drawsNoData(tile)) { renderTile(tileEl, tile, { columns: [], rows: [] }, extras()); return; }

    const db = tileDatabase(tile, spec);
    if (!db) { tileEl.createDiv({ cls: 'icor-sqlv-error', text: 'This widget names no database.' }); return; }
    const choice = await plugin.query.engineFor(db);
    if (this.gone) return;
    if (choice.engine) {
      try {
        const res = await plugin.query.query(db, tileSql(tile, spec), { cap: 5000 });
        let ghost = null;
        if (tile.source && tile.compare && tile.compare !== 'none' && canCompare(tile, spec.globalTimeframe)) {
          const shift = tile.compare === 'last_year' ? 'year' : 'previous';
          const g = await plugin.query.query(db, sqlForWidget(tile, spec.globalTimeframe, shift), { cap: 5000 });
          ghost = { columns: g.columns, rows: g.rows };
        }
        if (this.gone) return;
        const prepared = prepareTileForRender(tile, res);
        renderTile(tileEl, prepared.spec, prepared.table, extras(null, { ghost, compare: tile.compare, favorable: tile.favorable }));
        if (request.kind === 'inline') plugin.keepBlockResult(request.key, { columns: res.columns, rows: res.rows, ghost });
      } catch (e) {
        if (tile.title) tileEl.createDiv({ cls: 'icor-sqlv-tile-title', text: tile.title });
        tileEl.createDiv({ cls: 'icor-sqlv-error', text: e.message });
      }
      return;
    }
    /* This device cannot open the database: the desktop's cache. */
    let cached = null;
    let computedAt = '';
    if (request.kind === 'ref') {
      dashboardCache = await plugin.readDashboardCache(spec);
      const t = dashboardCache && dashboardCache.tiles[index];
      if (t && Array.isArray(t.columns) && Array.isArray(t.rows)) { cached = t; computedAt = dashboardCache.computedAt; }
    } else {
      const c = await plugin.readBlockCache(request.key);
      if (c) { cached = c.result; computedAt = c.computedAt; }
    }
    if (this.gone) return;
    if (!cached) {
      if (tile.title) tileEl.createDiv({ cls: 'icor-sqlv-tile-title', text: tile.title });
      tileEl.createDiv({ cls: 'icor-sqlv-note', text: (choice.reason || 'This database cannot be opened here.') + ' No cached result yet. ' + (request.kind === 'ref' ? 'Open this dashboard once on the desktop and sync.' : 'Open this note once on the desktop and sync.') });
      return;
    }
    const prepared = prepareTileForRender(tile, { columns: cached.columns, rows: cached.rows });
    renderTile(tileEl, prepared.spec, prepared.table, extras(null, { ghost: cached.ghost || null, compare: tile.compare, favorable: tile.favorable }));
    const note = 'Computed on desktop, ' + relativeTime(computedAt) + '.';
    tileEl.createDiv({ cls: 'icor-sqlv-note icor-sqlv-cache-note', text: note }).setAttribute('title', note);
  }
}

/* ------------------------------------------------------- the plugin -- */

class ReadOutPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.query = new QueryService(this);

    /* The help file's live samples (see WIDGET_SAMPLES), and a widget of a
     * dashboard, or one written out, inside any note. Obsidian throws when
     * another plugin already owns a code-block word, and that must not abort
     * the rest of onload, so each registration is guarded like the file
     * extensions below. */
    try {
      this.registerMarkdownCodeBlockProcessor(SAMPLE_BLOCK_LANG, (source, el, ctx) => { ctx.addChild(new WidgetSampleChild(el, source)); });
    } catch (e) {
      new Notice('Another plugin already uses the "' + SAMPLE_BLOCK_LANG + '" code block, so the help file samples will not draw.');
    }
    try {
      this.registerMarkdownCodeBlockProcessor(WIDGET_BLOCK_LANG, (source, el, ctx) => {
        if (this.settings.drawNoteBlocks === false) {
          /* Switched off in the settings: the block stays what it is, text. */
          el.createEl('pre').createEl('code', { text: source });
          return;
        }
        ctx.addChild(new WidgetBlockChild(el, source, this));
      });
    } catch (e) {
      new Notice('Another plugin already uses the "' + WIDGET_BLOCK_LANG + '" code block, so widgets written in notes will not draw.');
    }
    this.registerView(VIEW_BROWSER, (leaf) => new SqliteBrowserView(leaf, this));
    this.registerView(VIEW_DASHBOARDS, (leaf) => new SqliteDashboardsView(leaf, this));
    this.registerView(VIEW_JSON, (leaf) => new JsonFileView(leaf, this));
    try {
      this.registerExtensions(['db', 'sqlite', 'sqlite3'], VIEW_BROWSER);
    } catch (e) {
      new Notice('Another plugin already opens .db files. Use the "ReadOut: List databases" command instead.');
    }
    if (this.settings.openJsonFiles) {
      try {
        this.registerExtensions(['json'], VIEW_JSON);
      } catch (e) {
        new Notice('Another plugin already opens .json files, so this plugin leaves them to it.');
      }
    }

    this.addRibbonIcon('bar-chart-3', 'Open ReadOut dashboards', () => this.openDashboards());

    /* "New dashboard" next to New note and New folder in the folder menu.
     * Dashboards always land in the configured dashboards folder; a click
     * from somewhere else says so. */
    /* "Open as text" on a dashboard file, which otherwise always opens in
     * the dashboards view. */
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!file || file instanceof TFolder || typeof file.path !== 'string') return;
      if (!file.path.startsWith(this.settings.dashboardFolder + '/')) return;
      if (/\.json$/i.test(file.path)) {
        menu.addItem((item) => {
          item.setTitle('Open as text');
          item.setIcon('file-code');
          item.onClick(() => this.openDashboardAsText(file.path));
        });
        return;
      }
      /* A dashboard note opens as a note when clicked; this opens it as the
       * dashboard. Only a note whose properties say it is one is offered. */
      const cache = this.app.metadataCache && typeof this.app.metadataCache.getFileCache === 'function' ? this.app.metadataCache.getFileCache(file) : null;
      const mark = cache && cache.frontmatter ? cache.frontmatter[READOUT_NOTE_PROPERTY] : null;
      if (!/\.md$/i.test(file.path) || String(mark).toLowerCase() !== 'dashboard') return;
      menu.addItem((item) => {
        item.setTitle('Open as dashboard');
        item.setIcon('bar-chart-3');
        item.onClick(async () => {
          const { specs } = await this.loadDashboardSpecs();
          const spec = specs.find((s) => s.path === file.path);
          await this.openDashboards(spec ? spec.id : undefined);
        });
      });
      menu.addItem((item) => {
        item.setTitle('Open as note');
        item.setIcon('file-code');
        item.onClick(() => this.openNoteRaw(file.path));
      });
    }));

    /* Opening a dashboard note shows the dashboard. The mechanism is the
     * workspace's own 'file-open' event and leaf.setViewState on the leaf the
     * note was just opened in; nothing is patched. */
    this.registerEvent(this.app.workspace.on('file-open', (file) => {
      this.maybeOpenAsDashboard(file).catch(() => {});
    }));
    /* A pane that has moved on to something that is not a note (or was
     * emptied and reused) forgets what it was told about dashboard notes. */
    this.registerEvent(this.app.workspace.on('layout-change', () => {
      const ws = this.app.workspace;
      if (ws && typeof ws.iterateAllLeaves === 'function') ws.iterateAllLeaves((leaf) => this.tidyLeaf(leaf));
    }));

    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFolder)) return;
      menu.addItem((item) => {
        item.setTitle('New dashboard');
        item.setIcon('bar-chart-3');
        if (typeof item.setSection === 'function') item.setSection('action-primary');
        item.onClick(async () => {
          const spec = await this.createDashboard();
          const folder = this.settings.dashboardFolder;
          const near = file.path === folder || file.path === '/'
            || folder.startsWith(file.path + '/') || file.path.startsWith(folder + '/');
          if (!near) new Notice('New dashboard saved in ' + folder + '.');
          await this.openDashboards(spec.id);
        });
      });
    }));

    this.addCommand({ id: 'open-dashboards', name: 'Open dashboards', callback: () => this.openDashboards() });
    this.addCommand({
      id: 'new-dashboard',
      name: 'Create new dashboard',
      callback: async () => {
        const spec = await this.createDashboard();
        await this.openDashboards(spec.id);
      },
    });
    this.addCommand({ id: 'list-databases', name: 'List databases', callback: () => new DatabaseIndexModal(this).open() });
    this.addCommand({ id: 'open-browser', name: 'Open database browser', callback: () => this.openBrowserFor(null) });
    this.addCommand({ id: 'write-guide-files', name: 'Write the guide files', callback: () => this.writeGuideFilesWithNotice() });
    /* A dashboard note opens in Obsidian's own editor, which cannot say
     * whether the dashboard still reads; this does, in the same words the
     * text editor of the JSON view uses. */
    this.addCommand({ id: 'remove-old-json', name: 'Remove old .json dashboards and cache files', callback: () => this.removeOldJsonWithNotice() });
    this.addCommand({
      id: 'check-dashboard-note',
      name: 'Check this note as a dashboard',
      checkCallback: (checking) => {
        const ws = this.app.workspace;
        const file = ws && typeof ws.getActiveFile === 'function' ? ws.getActiveFile() : null;
        if (!file || typeof file.path !== 'string' || !/\.md$/i.test(file.path)) return false;
        if (!checking) this.checkDashboardNote(file).catch(() => {});
        return true;
      },
    });

    this.addSettingTab(new SqliteViewerSettingTab(this.app, this));

    /* Nothing is created at start. A guide file that is already in the
     * dashboards folder and still unedited is brought up to date; a vault
     * without one gets it only when the member asks (the command or the
     * button in the settings). */
    this.app.workspace.onLayoutReady(() => {
      this.refreshExistingGuideFiles().catch(() => {});
      /* The desktop writes the notes for the .json files it holds, so a phone
       * on default Sync can have them. A phone writes nothing. */
      if (Platform.isDesktopApp) {
        this.migrateJsonToNotes().then((n) => {
          if (n > 0) new Notice('ReadOut wrote ' + n + (n === 1 ? ' note' : ' notes') + ' beside your old .json dashboards and cache so your phone gets them. The .json files are unchanged. Once every device runs ReadOut 1.1, run "Remove old .json dashboards and cache files".');
        }).catch(() => {});
      }
      /* The desktop is the only writer of the note-block cache, so it is the
       * only one that tidies it. */
      if (Platform.isDesktopApp) this.pruneBlockCache().catch(() => {});
    });
  }

  onunload() {
    if (this.query && this.query.wasm) this.query.wasm.closeAll();
  }

  async loadSettings() {
    /* A fresh install (no saved settings yet) is seeded with the folders
     * that fit the vault, and that choice is saved so it never flips later.
     * Whatever is saved always wins; a key the file lacks takes the vault's
     * default. */
    const saved = await this.loadData();
    const adapter = this.app.vault.adapter;
    const isIcor = await detectIcorVault(adapter);
    const seeded = folderDefaultsFor(isIcor);
    this.settings = Object.assign({}, DEFAULT_SETTINGS, seeded, saved);
    /* Up to 1.0.9 a synced phone could not see the scaffold manifest (a dot
     * folder Sync skips), so it saved the plain folders in an ICOR vault and
     * showed no dashboards. Move such an install to the Databases room, but
     * only while it still has the plain defaults and no plain "Databases"
     * folder exists, so nothing anyone made is left behind. */
    let healed = false;
    try {
      healed = !!saved && isIcor && sameFolders(saved, PLAIN_FOLDERS) && !(await adapter.exists(PLAIN_FOLDERS.dataFolder));
    } catch (e) { healed = false; }
    if (healed) {
      Object.assign(this.settings, ICOR_FOLDERS);
      try { await this.saveSettings(); } catch (e) { /* the next change saves it */ }
    }
    /* 1.0.6 stored the vault root as the databases folder to mean "search the
     * whole vault". The two are separate settings now: restore this vault's
     * default databases folder and search the whole vault. */
    if (saved && isVaultRootFolder(saved.dataFolder) && saved.searchScope === undefined) {
      this.settings.dataFolder = seeded.dataFolder;
      this.settings.searchScope = 'vault';
      try { await this.saveSettings(); } catch (e) { /* the next change saves it */ }
    }
    /* Folders typed into data.json by hand may carry a trailing slash, a
     * backslash or a doubled slash; every path the plugin builds from them
     * assumes the clean form the settings screen saves. */
    for (const key of ['dashboardFolder', 'cacheFolder']) {
      if (typeof this.settings[key] === 'string' && this.settings[key].trim()) this.settings[key] = normalizePath(this.settings[key].trim());
    }
    this.settings.outsideNoteSeen = Object.assign({}, this.settings.outsideNoteSeen);
    this.settings.levels = normalizeLevels(this.settings.levels);
    this.settings.levelLooks = normalizeLevelLooks(this.settings.levelLooks);
    if (!CAL_WEEK_STARTS.includes(this.settings.weekStart)) this.settings.weekStart = DEFAULT_SETTINGS.weekStart;
    if (!saved) { try { await this.saveSettings(); } catch (e) { /* the next change saves it */ } }
  }

  /* Rename a level in the settings and carry the new name into every
   * widget that used the old one: every dashboard file, and the desktop
   * cache so phones follow before the next desktop run. */
  async renameLevel(id, newName) {
    const plan = planLevelRename(this.settings.levels, id, newName);
    if (!plan.ok || plan.unchanged) return plan;
    this.settings.levels.find((l) => l.id === id).name = plan.to;
    await this.saveSettings();
    const widgets = await this.renameLevelInFiles(plan.from, plan.to);
    return Object.assign({ widgets }, plan);
  }

  async renameLevelInFiles(from, to) {
    const adapter = this.app.vault.adapter;
    const folders = [
      { folder: this.settings.dashboardFolder, kind: 'dashboard', skip: GUIDE_FILES.map((g) => g.file) },
      { folder: normalizePath(this.settings.cacheFolder + '/dashboards'), kind: 'cache', skip: [] },
    ];
    let widgets = 0;
    for (const { folder, kind, skip } of folders) {
      if (!(await adapter.exists(folder))) continue;
      const { notes, jsons } = await this.listStoredFiles(folder, kind, skip);
      /* A dashboard note is rewritten inside its block, so what a member
       * wrote around it stays. A .json that has no note beside it (nothing
       * has migrated it yet) is changed as before. */
      for (const { path, text, note } of notes) {
        if (!note.ok) continue;
        let raw;
        try { raw = JSON.parse(note.json); } catch { continue; }
        const changed = renameLevelInDashboard(raw, from, to);
        if (!changed) continue;
        const wrote = await this.writeNoteText(path, (current) => (current === text ? rewriteReadoutNote(text, kind, JSON.stringify(raw, null, 2)) : null));
        if (wrote && kind === 'dashboard') widgets += changed;
      }
      for (const path of jsons) {
        let raw;
        try { raw = JSON.parse(await adapter.read(path)); } catch (e) { continue; }
        const changed = renameLevelInDashboard(raw, from, to);
        if (!changed) continue;
        await adapter.write(path, JSON.stringify(raw, null, 2) + (kind === 'dashboard' ? '\n' : ''));
        if (kind === 'dashboard') widgets += changed;
      }
    }
    const ws = this.app.workspace;
    if (ws && typeof ws.getLeavesOfType === 'function') {
      for (const leaf of ws.getLeavesOfType(VIEW_DASHBOARDS)) {
        if (leaf.view && typeof leaf.view.reload === 'function') await leaf.view.reload();
      }
    }
    return widgets;
  }

  /* What every tile render needs to draw value levels. */
  levelExtras() {
    const settings = this.settings || {};
    return { levels: settings.levels || [], levelLooks: settings.levelLooks, weekStart: settings.weekStart };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /* The databases ReadOut lists. By default it searches the whole vault, by
   * walking the folders from the vault root through the vault API (a folder's
   * children, never a flat list of every file), skipping the config folder,
   * .git and .trash. With the search set to the database folder it walks only
   * that folder. A database anywhere in the vault opens when you click it or a
   * dashboard names it, whatever the search covers. */
  vaultDatabases() {
    const vault = this.app.vault;
    if (!vault || typeof vault.getAbstractFileByPath !== 'function') return [];
    const settings = this.settings || {};
    const wholeVault = settings.searchScope !== 'folder' || isVaultRootFolder(settings.dataFolder);
    let folder = null;
    if (wholeVault) folder = typeof vault.getRoot === 'function' ? vault.getRoot() : null;
    else folder = vault.getAbstractFileByPath(normalizePath(settings.dataFolder));
    return walkDatabases(folder, vault.configDir);
  }

  /* Move one database (and its -wal and -shm files) into the database folder,
   * only when asked, through the vault API, never over an existing file. */
  async moveIntoDataFolder(dbPath) {
    const vault = this.app.vault;
    const folder = isVaultRootFolder(this.settings.dataFolder) ? '' : normalizePath(this.settings.dataFolder);
    if (!folder) return { ok: false, reason: 'There is no database folder to move it into.' };
    const file = vault.getAbstractFileByPath(dbPath);
    if (!file || !(file instanceof TFile)) return { ok: false, reason: 'The file is gone.' };
    const to = folder + '/' + baseName(dbPath);
    if (vault.getAbstractFileByPath(to) || (await vault.adapter.exists(to))) {
      return { ok: false, reason: 'A file named ' + baseName(dbPath) + ' already exists in ' + folder + ', so nothing was moved.' };
    }
    await ensureFolder(vault.adapter, folder);
    const rename = async (f, target) => {
      if (this.app.fileManager && typeof this.app.fileManager.renameFile === 'function') await this.app.fileManager.renameFile(f, target);
      else await vault.rename(f, target);
    };
    await rename(file, to);
    for (const suffix of ['-wal', '-shm']) {
      const side = vault.getAbstractFileByPath(dbPath + suffix);
      if (side instanceof TFile && !(await vault.adapter.exists(to + suffix))) await rename(side, to + suffix);
    }
    return { ok: true, to };
  }

  /* The gentle note for a database opened directly from outside the database
   * folder: once per file, off with one setting, and the move happens only
   * when the member clicks. Dashboards never trigger it. Returns whether a
   * note was shown. */
  noteIfOutsideFolder(dbPath, onMoved) {
    const settings = this.settings;
    if (!settings || settings.noteOutsideFolder === false) return false;
    if (isInsideFolder(dbPath, settings.dataFolder)) return false;
    if (!settings.outsideNoteSeen || typeof settings.outsideNoteSeen !== 'object') settings.outsideNoteSeen = {};
    if (settings.outsideNoteSeen[dbPath]) return false;
    settings.outsideNoteSeen[dbPath] = true;
    this.saveSettings().catch(() => {});
    const folder = normalizePath(settings.dataFolder);
    const notice = new Notice('This database isn\'t in your databases folder. You can move it to ' + folder + ' to keep things together, but that may break any app that writes to it where it is now.', 20000);
    const el = notice.noticeEl;
    if (el && typeof el.createEl === 'function') {
      const move = el.createEl('button', { text: 'Move to ' + folder });
      move.addEventListener('click', async (ev) => {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        move.disabled = true;
        try {
          const r = await this.moveIntoDataFolder(dbPath);
          new Notice(r.ok ? 'Moved to ' + r.to + '.' : r.reason);
          if (r.ok && typeof onMoved === 'function') onMoved(r.to);
        } catch (e) { new Notice('Could not move it: ' + e.message); }
        if (notice.hide) notice.hide();
      });
    }
    return true;
  }

  /* Save a query result as a CSV file in the vault: <database folder>/Exports,
   * a name no file has, and a notice that opens it when clicked. */
  async saveCsv(dbPath, res) {
    const vault = this.app.vault;
    const root = isVaultRootFolder(this.settings.dataFolder) ? '' : normalizePath(this.settings.dataFolder);
    const folder = normalizePath((root ? root + '/' : '') + 'Exports');
    await ensureFolder(vault.adapter, folder);
    const taken = new Set();
    const listing = await vault.adapter.list(folder).catch(() => ({ files: [] }));
    for (const f of listing.files || []) taken.add(baseName(f));
    const path = folder + '/' + csvExportName(dbPath, new Date(), taken);
    const file = await vault.create(path, toCsv(res.columns, res.rows));
    const text = 'Saved ' + res.rows.length + (res.rows.length === 1 ? ' row' : ' rows') + ' to ' + path + '. Click to open it.';
    const notice = new Notice(text, 10000);
    const el = notice.noticeEl || notice.containerEl;
    if (el && el.addEventListener) {
      el.addEventListener('click', () => { this.app.workspace.getLeaf(true).openFile(file).catch(() => {}); });
    }
    return path;
  }

  async openBrowserFor(dbPath) {
    const leaf = this.app.workspace.getLeaf(true);
    if (dbPath) {
      const file = this.app.vault.getAbstractFileByPath(dbPath);
      if (file instanceof TFile) { await leaf.openFile(file); return; }
    }
    await leaf.setViewState({ type: VIEW_BROWSER, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  /* A dashboard file in the JSON view's text editor: in the dashboards
   * view's own leaf, so "Done editing" comes back to it, or the active one. */
  async openDashboardAsText(path, leaf) {
    const target = leaf || this.app.workspace.getLeaf(false);
    /* A dashboard is a note: Obsidian's own editor is the text editor. A
     * dashboard that is still only a .json file (or whose note cannot be
     * opened) goes to the text editor of the JSON view, as before. */
    let note = path;
    if (/\.json$/i.test(path)) {
      const twin = noteTwinOf(path);
      note = (await this.app.vault.adapter.exists(twin)) ? twin : '';
    }
    if (note) {
      const file = this.app.vault.getAbstractFileByPath(note);
      if (file instanceof TFile && typeof target.openFile === 'function') {
        this.leafState(target).note = file.path;
        await target.openFile(file);
        return;
      }
      /* A note is never handed to the JSON view, which opens .json only. */
      if (/\.md$/i.test(note)) {
        new Notice('Obsidian has not listed ' + note.split('/').pop() + ' yet. Try again in a moment.');
        return;
      }
    }
    await target.setViewState({ type: VIEW_JSON, state: { file: path, asText: true }, active: true });
  }

  /* A dashboard note in a new pane as the note itself, not the dashboard. */
  async openNoteRaw(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf(true);
    this.leafState(leaf).note = file.path;
    await leaf.openFile(file);
  }

  /* What each pane has been told about dashboard notes, kept on the pane
   * itself (a WeakMap, gone with the pane): `note` is the path the member
   * asked to see as a note in it, honoured for as long as the pane shows that
   * path and dropped as soon as it shows anything else; `from` holds the
   * paths the pane was converted from, so that Back, which replays the note's
   * own history entry, shows the note once instead of converting it again. */
  /* What a pane remembers only holds while it stays on the same step:
   * `from` is for the immediate Back, so it goes as soon as the pane shows
   * any other note, or anything that is not a dashboard; `note` goes as soon
   * as the pane shows another file. A pane that has moved on and is later
   * given a dashboard note is therefore an ordinary open. A pane showing a
   * dashboard keeps `from`: that is the note Back will replay. */
  tidyLeaf(leaf) {
    const st = this.leafStates && leaf ? this.leafStates.get(leaf) : null;
    if (!st) return;
    const view = leaf.view;
    const type = view && typeof view.getViewType === 'function' ? view.getViewType() : null;
    if (type === VIEW_DASHBOARDS) { st.note = null; return; }
    const path = type === 'markdown' && view.file ? view.file.path : null;
    if (path === null) {
      /* An empty pane may be the one a note is about to be opened in. */
      if (type !== 'empty') st.note = null;
      st.from.clear();
      return;
    }
    if (st.note !== null && st.note !== path) st.note = null;
    for (const p of [...st.from]) if (p !== path) st.from.delete(p);
  }

  leafState(leaf) {
    if (!this.leafStates) this.leafStates = new WeakMap();
    let st = this.leafStates.get(leaf);
    if (!st) { st = { note: null, from: new Set() }; this.leafStates.set(leaf, st); }
    return st;
  }

  /* Called when a file is opened in a pane. A note whose properties say
   * `readout: dashboard` and that reads as a dashboard is replaced, in that
   * same pane, by the dashboard. Left alone: a cache note, any other note, a
   * note that does not read as a dashboard (so it can be fixed), a note the
   * member asked for as a note in this pane (for as long as the pane shows
   * it, tab switches included), a note this pane was converted from when it
   * is replayed by Back (shown once, as the note), a note in source mode, a
   * pane that is not showing this note, and the setting turned off. */
  async maybeOpenAsDashboard(file) {
    if (this.settings.openDashboardNotes === false || !file || typeof file.path !== 'string' || !/\.md$/i.test(file.path)) return;
    const ws = this.app.workspace;
    const leaf = typeof ws.getMostRecentLeaf === 'function' ? ws.getMostRecentLeaf() : null;
    const view = leaf && leaf.view;
    if (!view || typeof view.getViewType !== 'function' || view.getViewType() !== 'markdown') return;
    if (!view.file || view.file.path !== file.path) return;
    this.tidyLeaf(leaf);
    const mode = this.leafState(leaf);
    if (mode.note !== null) {
      if (mode.note === file.path) return;
      mode.note = null;
    }
    if (mode.from.delete(file.path)) { mode.note = file.path; return; }
    const state = typeof view.getState === 'function' ? view.getState() : null;
    if (state && state.mode === 'source' && state.source === true) return;
    /* The property cache says at once whether this is a dashboard note; only
     * when it has nothing yet is the note's own text the judge. */
    const cache = this.app.metadataCache && typeof this.app.metadataCache.getFileCache === 'function' ? this.app.metadataCache.getFileCache(file) : null;
    if (cache && (!cache.frontmatter || String(cache.frontmatter[READOUT_NOTE_PROPERTY]).toLowerCase() !== 'dashboard')) return;
    const vault = this.app.vault;
    const note = readReadoutNote(await (typeof vault.cachedRead === 'function' ? vault.cachedRead(file) : vault.read(file)), 'dashboard');
    if (!note.marked || !note.ok) return;
    const parsed = parseDashboardSpec(note.json);
    if (!parsed.ok) return;
    /* The member may have moved on while this read. */
    if (leaf.view !== view) return;
    mode.from.add(file.path);
    await leaf.setViewState({ type: VIEW_DASHBOARDS, active: true, state: { activeId: parsed.spec.id } });
  }

  async openDashboards(activeId) {
    const existing = this.app.workspace.getLeavesOfType(VIEW_DASHBOARDS);
    if (existing.length) {
      this.app.workspace.revealLeaf(existing[0]);
      /* A revealed view re-reads the folder. Without this, a view that
       * opened before the starter files existed stayed empty forever. */
      const view = existing[0].view;
      if (view && typeof view.reload === 'function') {
        if (activeId) view.activeId = activeId;
        await view.reload();
      }
      return;
    }
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_DASHBOARDS, active: true, state: activeId ? { activeId } : {} });
    this.app.workspace.revealLeaf(leaf);
  }

  /* The dashboards for the widget blocks of a note: a note with several blocks
   * draws them together, so they share one read of the folder for a couple of
   * seconds. A save of a dashboard starts a fresh read. Blocks only read what
   * they get. */
  blockSpecs() {
    const now = Date.now();
    if (this.blockSpecCache && now - this.blockSpecCache.at < BLOCK_SPEC_PASS_MS) return this.blockSpecCache.promise;
    const promise = this.loadDashboardSpecs();
    const entry = { at: now, promise };
    this.blockSpecCache = entry;
    promise.catch(() => { if (this.blockSpecCache === entry) this.blockSpecCache = null; });
    return promise;
  }

  /* What a folder holds of ReadOut's: the notes (.md files whose
   * frontmatter says `readout: <kind>`, read once each, so a README or a
   * member's own note in the same folder is passed over) and the .json files
   * that have no such note beside them, which are what versions before 1.1
   * wrote and are still read. Where a note and a .json share a name the note
   * wins and the .json is not listed. `skip` names files never to read. */
  async listStoredFiles(folder, kind, skip) {
    const adapter = this.app.vault.adapter;
    const out = { notes: [], jsons: [] };
    if (!(await adapter.exists(folder))) return out;
    const listing = await adapter.list(folder);
    const files = ((listing && listing.files) || []).slice().sort();
    const skipped = new Set((skip || []).map((n) => n.toLowerCase()));
    const marked = new Set();
    for (const path of files) {
      if (!/\.md$/i.test(path) || skipped.has(baseName(path).toLowerCase())) continue;
      let text;
      try { text = await adapter.read(path); } catch { continue; }
      const note = readReadoutNote(text, kind);
      if (!note.marked) continue;
      marked.add(path.toLowerCase());
      out.notes.push({ path, text, note });
    }
    for (const path of files) {
      if (!/\.json$/i.test(path) || marked.has(noteTwinOf(path).toLowerCase())) continue;
      out.jsons.push(path);
    }
    return out;
  }

  async loadDashboardSpecs() {
    const folder = this.settings.dashboardFolder;
    const specs = [];
    const errors = [];
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(folder))) return { specs, errors };
    const { notes, jsons } = await this.listStoredFiles(folder, 'dashboard', GUIDE_FILES.map((g) => g.file));
    for (const { path, text, note } of notes) {
      if (!note.ok) { errors.push({ path, reason: note.reason }); continue; }
      const parsed = parseDashboardSpec(note.json);
      if (parsed.ok) {
        parsed.spec.path = path;
        DASHBOARD_LOADED_TEXT.set(parsed.spec, text);
        specs.push(parsed.spec);
      } else errors.push({ path, reason: parsed.reason });
    }
    for (const path of jsons) {
      try {
        const text = await adapter.read(path);
        const parsed = parseDashboardSpec(text);
        if (parsed.ok) {
          parsed.spec.path = path;
          DASHBOARD_LOADED_TEXT.set(parsed.spec, text);
          specs.push(parsed.spec);
        } else errors.push({ path, reason: parsed.reason });
      } catch (e) {
        errors.push({ path, reason: e.message });
      }
    }
    const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    specs.sort(byPath);
    /* Two files with one id: Sync's conflict copies ("shop (Conflicted copy
     * ...).md") carry the id of the note they copy and sort ahead of it. The
     * one named after the id is kept, else the first; the rest are errors. */
    const kept = new Map();
    for (const spec of specs) {
      const k = kept.get(spec.id);
      if (!k || (stemOf(spec.path) === spec.id && stemOf(k.path) !== spec.id)) kept.set(spec.id, spec);
    }
    const unique = [];
    for (const spec of specs) {
      const k = kept.get(spec.id);
      if (k === spec) { unique.push(spec); continue; }
      const name = baseName(k.path);
      errors.push({ path: spec.path, reason: 'Has the same id as ' + name + '; it may be a Sync conflict copy. Merge what you need into ' + name + ' and delete this one.' });
    }
    return { specs: unique, errors: errors.sort(byPath) };
  }

  /* The builder writes a dashboard back to its own note; a new dashboard
   * gets a fresh note named after its id. A dashboard that was read from a
   * .json file is saved as its .md twin (the .json is left as it is), and
   * from then on the note is the dashboard. A file that changed on disk
   * since this spec was read (an edit as text in another pane, or one that
   * arrived through Sync) is not overwritten: the save is refused with a
   * notice and returns false, so the caller reloads and shows the file as
   * it is now. */
  async saveDashboardSpec(spec) {
    const adapter = this.app.vault.adapter;
    const folder = this.settings.dashboardFolder;
    await ensureFolder(adapter, folder);
    if (!spec.path) spec.path = normalizePath(folder + '/' + spec.id + '.md');
    const loaded = DASHBOARD_LOADED_TEXT.get(spec);
    const changedNotice = (path) => {
      new Notice(path.split('/').pop() + ' changed on disk since this dashboard was loaded, so this change was not saved. The dashboard now shows the file as it is.');
      return false;
    };
    if (loaded !== undefined && (await adapter.exists(spec.path)) && (await adapter.read(spec.path)) !== loaded) return changedNotice(spec.path);
    /* A note replaces a .json (or a note) at its own place. */
    const target = noteTwinOf(spec.path);
    const json = specToJson(spec).replace(/\n$/, '');
    let existing = null;
    if (await adapter.exists(target)) {
      try { existing = await adapter.read(target); } catch { existing = null; }
    }
    if (target !== spec.path && existing !== null) {
      /* A dashboard note that appeared beside the .json since this spec was
       * read is the newer word. One that is not a ReadOut note is someone's
       * own file and is never written over: the .json stays the dashboard. */
      if (readReadoutNote(existing, 'dashboard').marked) return changedNotice(target);
      const text = specToJson(spec);
      await adapter.write(spec.path, text);
      DASHBOARD_LOADED_TEXT.set(spec, text);
      this.blockSpecCache = null;
      return true;
    }
    /* The checks run again on the text as it is at the moment of writing. */
    let conflict = false;
    let note = null;
    await this.writeNoteText(target, (current) => {
      if (current !== null) {
        const moved = target === spec.path && loaded !== undefined && current !== loaded;
        const notOurs = target !== spec.path || (loaded === undefined && !readReadoutNote(current, 'dashboard').marked);
        if (moved || notOurs) { conflict = true; return null; }
      }
      note = current === null ? writeReadoutNote('dashboard', json) : rewriteReadoutNote(current, 'dashboard', json);
      return note;
    });
    if (conflict) return changedNotice(target);
    spec.path = target;
    DASHBOARD_LOADED_TEXT.set(spec, note);
    this.blockSpecCache = null;
    return true;
  }

  /* Whether a dashboard file's text on disk is still the text this spec
   * was read from or last saved as: true for the echo of the view's own
   * save, false for a change made somewhere else. */
  dashboardTextIsLoaded(spec, text) {
    return DASHBOARD_LOADED_TEXT.get(spec) === text;
  }

  async createDashboard() {
    const adapter = this.app.vault.adapter;
    const folder = this.settings.dashboardFolder;
    const { specs, errors } = await this.loadDashboardSpecs();
    const taken = new Set(specs.map((s) => s.id));
    const free = async (id) => {
      if (taken.has(id)) return false;
      const stem = normalizePath(folder + '/' + id);
      for (const ext of ['.md', '.json']) {
        if (errors.some((e) => e.path === stem + ext) || (await adapter.exists(stem + ext))) return false;
      }
      return true;
    };
    let n = 1;
    while (!(await free('dashboard-' + n))) n++;
    const spec = {
      id: 'dashboard-' + n,
      title: 'New dashboard',
      database: '',
      globalTimeframe: DEFAULT_GLOBAL_TIMEFRAME,
      tiles: [],
    };
    await this.saveDashboardSpec(spec);
    return spec;
  }

  async writeDashboardCache(spec, tiles) {
    const path = dashCachePath(this.settings.cacheFolder, spec.id);
    const payload = {
      dashboardId: spec.id,
      title: spec.title,
      computedAt: new Date().toISOString(),
      tiles,
    };
    return this.writeCacheNote(path, JSON.stringify(payload));
  }

  /* A cache entry is a ReadOut note (kind cache), so default Obsidian Sync
   * carries it. It is machine-written, so it is written afresh, but never
   * over a note that is not ReadOut's: that throws, and the dashboards view
   * says so in its status line. Returns { bytes }, the size of the note. */
  async writeCacheNote(path, jsonText) {
    const adapter = this.app.vault.adapter;
    await ensureFolder(adapter, path.slice(0, path.lastIndexOf('/')));
    if (await adapter.exists(path)) {
      let existing = null;
      try { existing = await adapter.read(path); } catch { existing = null; }
      if (existing !== null && !readReadoutNote(existing, 'cache').marked) throw new Error(path.split('/').pop() + ' is not a ReadOut note');
    }
    const note = writeReadoutNote('cache', jsonText);
    await adapter.write(path, note);
    return { bytes: new TextEncoder().encode(note).length };
  }

  /* Writes a note's text. When Obsidian has the file, through Vault.process,
   * so `make` sees the text as it is at the moment of writing; a new file
   * through Vault.create; otherwise (a folder Obsidian does not index, or no
   * Vault API) through the adapter. `make(current)` gets the text or null
   * and returns the new text, or null to leave the file alone. Returns
   * whether it wrote. */
  async writeNoteText(path, make) {
    const vault = this.app.vault;
    const adapter = vault.adapter;
    const indexed = typeof vault.getAbstractFileByPath === 'function' ? vault.getAbstractFileByPath(path) : null;
    if (indexed instanceof TFile && typeof vault.process === 'function') {
      let wrote = false;
      await vault.process(indexed, (current) => {
        const next = make(current);
        if (next === null) return current;
        wrote = true;
        return next;
      });
      return wrote;
    }
    let current = null;
    if (await adapter.exists(path)) {
      try { current = await adapter.read(path); } catch { current = null; }
    }
    const next = make(current);
    if (next === null) return false;
    if (current === null && !indexed && typeof vault.create === 'function') {
      try { await vault.create(path, next); return true; } catch { /* the adapter below */ }
    }
    await adapter.write(path, next);
    return true;
  }

  /* The JSON a cache path holds, or null: a note is read as a ReadOut note,
   * a .json (what versions before 1.1 wrote) as plain JSON. A file that is
   * missing, unreadable or not JSON reads as none, never as an error. */
  async readCachedJson(path) {
    const adapter = this.app.vault.adapter;
    try {
      if (!(await adapter.exists(path))) return null;
      const text = await adapter.read(path);
      if (/\.md$/i.test(path)) {
        const note = readReadoutNote(text, 'cache');
        return note.ok ? JSON.parse(note.json) : null;
      }
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  /* The desktop result of a widget written out in a note, filed by a key
   * of what the block says. Once per key per session, desktop only, in the
   * background: a note never waits for it and never fails because of it. */
  keepBlockResult(key, result) {
    if (!Platform.isDesktopApp) return;
    if (!this.keptBlocks) this.keptBlocks = new Set();
    if (this.keptBlocks.has(key)) return;
    this.keptBlocks.add(key);
    (async () => {
      const path = blockCachePath(this.settings.cacheFolder, key);
      await this.writeCacheNote(path, JSON.stringify({ computedAt: new Date().toISOString(), result }));
    })().catch((e) => {
      this.keptBlocks.delete(key);
      console.error(safeLogLine('the note block cache write failed', e));
    });
  }

  /* Dashboards and cache files that earlier versions saved as .json get
   * their note (.md twin) written beside them, so default Obsidian Sync
   * carries them to a phone. Safe to run on any device, at any time:
   *
   * - a .json with a note of the same name is skipped, whatever the note
   *   holds (the note wins, and a member's edit to it is never touched);
   * - a .json that is not valid, or is JSON that is not a dashboard (or not
   *   the cache entry it sits among), gets no note;
   * - the .json is never rewritten, moved or removed;
   * - only the dashboards folder and <cache>/dashboards, /catalogs and
   *   /notes are looked at, and only the files directly inside them;
   * - nothing here can fail the plugin: a folder or file that cannot be
   *   listed, read or written is skipped.
   *
   * Returns how many notes it wrote. Running it again writes none. */
  async migrateJsonToNotes() {
    return this.migrateOrRemove(false);
  }

  /* Moves the old .json dashboards and cache files to the trash, once their
   * note is there. Only a .json whose .md twin exists, is marked as
   * ReadOut's (the right kind) and holds the same id (dashboardId, or
   * database, for a cache entry that has one) is touched, and only through
   * Obsidian's own trashing (File Manager, which honours the "Deleted files"
   * preference), so a file goes where your deleted files go and can be got
   * back. A file that is not in the vault's index is left, and counted in
   * unindexedJson. Nothing here is automatic: the command runs it.
   * Returns how many files went. */
  async removeOldJsonFiles() {
    return this.migrateOrRemove(true);
  }

  async removeOldJsonWithNotice() {
    const n = await this.removeOldJsonFiles();
    const left = this.unindexedJson || 0;
    const moved = 'Moved ' + n + ' old .json ' + (n === 1 ? 'file' : 'files') + ' to where your deleted files go. Their notes are what ReadOut uses.';
    const waiting = left + (left === 1 ? ' old .json file has' : ' old .json files have') + ' a note but Obsidian has not listed ' + (left === 1 ? 'it' : 'them') + ' yet; run this again in a moment.';
    new Notice(n === 0 && left === 0
      ? 'No old .json dashboards or cache files have a note beside them yet, so nothing was moved.'
      : (n > 0 ? moved : '') + (n > 0 && left > 0 ? ' ' : '') + (left > 0 ? waiting : ''));
    return n;
  }

  async migrateOrRemove(remove) {
    this.unindexedJson = 0;
    const adapter = this.app.vault.adapter;
    const cache = this.settings.cacheFolder;
    const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    const places = [
      { folder: this.settings.dashboardFolder, kind: 'dashboard', accept: () => true, valid: (text) => parseDashboardSpec(text).ok },
      { folder: normalizePath(cache + '/dashboards'), kind: 'cache', accept: () => true, valid: (text) => { const v = JSON.parse(text); return isObject(v) && Array.isArray(v.tiles); } },
      /* A 0.5.0 catalog is keyed by the database's stem alone and is only
       * ever read as a fallback; it is not carried over. */
      { folder: normalizePath(cache + '/catalogs'), kind: 'cache', accept: (path) => /-[0-9a-f]{8}\.json$/i.test(path), valid: (text) => { const v = JSON.parse(text); return isObject(v) && Array.isArray(v.tables); } },
      { folder: normalizePath(cache + '/notes'), kind: 'cache', accept: () => true, valid: (text) => { const v = JSON.parse(text); return isObject(v) && isObject(v.result) && Array.isArray(v.result.columns); } },
    ];
    let written = 0;
    for (const { folder, kind, accept, valid } of places) {
      try {
        if (!(await adapter.exists(folder))) continue;
        const listing = await adapter.list(folder);
        for (const path of ((listing && listing.files) || []).slice().sort()) {
          if (!/\.json$/i.test(path) || !accept(path)) continue;
          try {
            const twin = noteTwinOf(path);
            if (remove) {
              if (!(await adapter.exists(twin))) continue;
              const note = readReadoutNote(await adapter.read(twin), kind);
              if (!note.marked || !note.ok) continue;
              let mine;
              let theirs;
              try { mine = JSON.parse(await adapter.read(path)); theirs = JSON.parse(note.json); } catch { continue; }
              if (!isObject(mine) || !isObject(theirs)) continue;
              const keys = ['id', 'dashboardId', 'database'].filter((k) => mine[k] !== undefined);
              if (kind === 'dashboard' && !keys.includes('id')) continue;
              if (keys.some((k) => mine[k] !== theirs[k])) continue;
              const file = this.app.vault.getAbstractFileByPath(path);
              if (!(file instanceof TFile) || !this.app.fileManager || typeof this.app.fileManager.trashFile !== 'function') { this.unindexedJson++; continue; }
              await this.app.fileManager.trashFile(file);
              written++;
              continue;
            }
            if (await adapter.exists(twin)) continue;
            const text = await adapter.read(path);
            if (!valid(text)) continue;
            /* Sync may have brought the note while this was reading. */
            if (await adapter.exists(twin)) continue;
            await adapter.write(twin, writeReadoutNote(kind, text.replace(/\s+$/, '')));
            written++;
          } catch { /* this file is left for the next start */ }
        }
      } catch { /* this folder is left for the next start */ }
    }
    if (written) this.blockSpecCache = null;
    return written;
  }

  /* A block's cache file is rewritten once per session in which its note is
   * shown, so a file nobody has touched for BLOCK_CACHE_MAX_AGE_DAYS belongs
   * to a block that was edited or removed. Only the cache notes (.md marked
   * readout: cache) and the .json files of earlier versions directly inside
   * <cache>/notes/ are considered; the dashboard cache is never touched.
   * Returns how many files went. A file that cannot be read or removed is
   * skipped, never an error. */
  async pruneBlockCache() {
    const adapter = this.app.vault.adapter;
    const folder = normalizePath(this.settings.cacheFolder + '/notes');
    let listing;
    try {
      if (!(await adapter.exists(folder))) return 0;
      listing = await adapter.list(folder);
    } catch (e) {
      return 0;
    }
    const cutoff = Date.now() - BLOCK_CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const path of (listing && listing.files) || []) {
      const isNote = /\.md$/i.test(path);
      if (!isNote && !/\.json$/i.test(path)) continue;
      try {
        const stat = await adapter.stat(path);
        if (!stat || typeof stat.mtime !== 'number' || stat.mtime >= cutoff) continue;
        /* A note of the member's own in this folder is not ours to remove. */
        if (isNote && !readReadoutNote(await adapter.read(path), 'cache').marked) continue;
        await adapter.remove(path);
        removed++;
      } catch (e) {
        /* locked or already gone: the next start tries again */
      }
    }
    return removed;
  }

  /* The cache entry among these paths that was computed last. A note and a
   * .json of the same entry can both be there (a desktop still on an earlier
   * version keeps writing the .json); a tie goes to the first, the note. */
  async newestCached(paths, accept) {
    let best = null;
    for (const path of paths) {
      const c = await this.readCachedJson(path);
      if (!c || !accept(c)) continue;
      if (!best || cachedAt(c) > cachedAt(best)) best = c;
    }
    return best;
  }

  async readBlockCache(key) {
    const folder = this.settings.cacheFolder;
    return this.newestCached([blockCachePath(folder, key, 'md'), blockCachePath(folder, key, 'json')],
      (c) => typeof c.computedAt === 'string' && c.result && Array.isArray(c.result.columns) && Array.isArray(c.result.rows));
  }

  async readDashboardCache(spec) {
    /* The note first, then what versions before 1.1 wrote. */
    const accept = (c) => Array.isArray(c.tiles) && typeof c.computedAt === 'string';
    const folder = this.settings.cacheFolder;
    const found = await this.newestCached([dashCachePath(folder, spec.id, 'md'), dashCachePath(folder, spec.id, 'json')], accept);
    if (found || !spec.database) return found;
    return this.newestCached([cachePathFor(folder, spec.database, spec.id)], accept);
  }

  /* Says in a notice whether a note reads as a dashboard, and returns what
   * it said. */
  async checkDashboardNote(file) {
    let message;
    try {
      const note = readReadoutNote(await this.app.vault.read(file), 'dashboard');
      if (!note.marked) message = 'This note is not a ReadOut dashboard: its properties need "readout: dashboard".';
      else if (!note.ok) message = 'The dashboard will not open like this: ' + note.reason;
      else {
        const parsed = parseDashboardSpec(note.json);
        const n = parsed.ok ? parsed.spec.tiles.length : 0;
        message = parsed.ok
          ? 'The dashboard reads fine: ' + n + (n === 1 ? ' widget.' : ' widgets.')
          : 'The dashboard will not open like this: ' + parsed.reason;
      }
    } catch (e) {
      message = 'This note could not be read: ' + (e && e.message ? e.message : 'unknown error') + '.';
    }
    new Notice(message);
    return message;
  }

  /* The two guide files in the dashboards folder: written when missing,
   * refreshed when still the unedited text of an older version, never
   * touched once the member has edited one. Returns what happened per file.
   * Only the command and the settings button create a missing file. */
  async writeGuideFiles(opts) {
    const createMissing = !(opts && opts.createMissing === false);
    const adapter = this.app.vault.adapter;
    const folder = this.settings.dashboardFolder;
    const results = [];
    for (const guide of GUIDE_FILES) {
      const path = folder + '/' + guide.file;
      try {
        if (!createMissing && !(await adapter.exists(path))) { results.push({ file: guide.file, outcome: 'absent' }); continue; }
        if (createMissing) await ensureFolder(adapter, folder);
        const outcome = await refreshGuideFile(this.app.vault, path, guideTextFor(guide, this.settings.dataFolder), guide.legacy, this.settings.dataFolder);
        results.push({ file: guide.file, outcome });
      } catch (e) {
        /* A guide that cannot be written never stops the other one. */
        console.error(safeLogLine('could not write ' + guide.file, e));
        results.push({ file: guide.file, outcome: 'failed' });
      }
    }
    return results;
  }

  /* At start: only the copies that already exist, and only the ones that
   * are still the plugin's own text. Creates no folder and no file. */
  async refreshExistingGuideFiles() {
    return this.writeGuideFiles({ createMissing: false });
  }

  /* Opens one of the guide files in a new tab; says so when it is not there. */
  async openGuideFile(name) {
    const path = this.settings.dashboardFolder + '/' + name;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) { new Notice(name + ' is not in ' + this.settings.dashboardFolder + ' yet.'); return; }
    await this.app.workspace.getLeaf(true).openFile(file);
  }

  /* The command, the settings button and the empty dashboards screen's
   * button. Says in plain words what it did. */
  async writeGuideFilesWithNotice() {
    const results = await this.writeGuideFiles();
    const where = this.settings.dashboardFolder;
    const words = results.map((r) => {
      if (r.outcome === 'written') return r.file + ' written';
      if (r.outcome === 'refreshed') return r.file + ' updated';
      if (r.outcome === 'kept') return r.file + ' left alone (you edited it, or it is not a note)';
      if (r.outcome === 'newer') return r.file + ' left alone (a newer copy is there)';
      if (r.outcome === 'failed') return r.file + ' could not be written';
      return r.file + ' is already up to date';
    });
    new Notice('Guide files in ' + where + ': ' + words.join('; ') + '.');
    return results;
  }

  /* ------------------------------------------- schema for the picker -- */

  /* Tables, columns and types for one database: live when an engine can
   * open it, from the desktop-written catalog when it cannot. */
  async schemaFor(dbPath) {
    const choice = await this.query.engineFor(dbPath);
    if (choice.engine) {
      const tables = [];
      const res = await this.query.query(dbPath, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
      for (const [name] of res.rows) {
        /* One table that cannot be read (an FTS5 index, say) never takes the
         * others with it: it is listed with no columns and marked. */
        try {
          const info = await this.query.query(dbPath, 'PRAGMA table_info(' + quoteIdent(name) + ')');
          const nameIdx = columnIndex(info.columns, 'name');
          const typeIdx = columnIndex(info.columns, 'type');
          tables.push({ name, columns: info.rows.map((r) => ({ name: r[nameIdx], type: r[typeIdx] })) });
        } catch (e) {
          tables.push({ name, columns: [], unreadable: true });
        }
      }
      return { live: true, tables };
    }
    const catalog = await this.readCatalog(dbPath);
    if (catalog) return { live: false, tables: catalog.tables, computedAt: catalog.computedAt };
    throw new Error((choice.reason || 'This database cannot be opened here.') + ' No catalog yet. Open the database once on the desktop and sync.');
  }

  /* The distinct values of one text column, for the tall-table picker. */
  async distinctValues(dbPath, table, column) {
    const choice = await this.query.engineFor(dbPath);
    if (choice.engine) {
      const res = await this.query.query(dbPath,
        'SELECT DISTINCT ' + quoteIdent(column) + ' FROM ' + quoteIdent(table) +
        ' WHERE ' + quoteIdent(column) + ' IS NOT NULL ORDER BY 1 LIMIT 201');
      return { values: res.rows.map((r) => String(r[0])), truncated: res.rows.length > 200 };
    }
    const catalog = await this.readCatalog(dbPath);
    const key = table + '.' + column;
    if (catalog && catalog.values && catalog.values[key]) {
      return { values: catalog.values[key], truncated: false };
    }
    throw new Error('The values of ' + column + ' are not listed on this device. The catalog carries them only when "Include category values in the mobile catalog" is on and the desktop has synced since. Type the exact value instead.');
  }

  async readCatalog(dbPath) {
    /* A legacy stem-keyed file may belong to a same-named database in
     * another folder; trust it only when it names this database. */
    const accept = (c) => Array.isArray(c.tables) && (!c.database || c.database === dbPath);
    const folder = this.settings.cacheFolder;
    const found = await this.newestCached([catalogPathFor(folder, dbPath, 'md'), catalogPathFor(folder, dbPath, 'json')], accept);
    return found || this.newestCached([legacyCatalogPathFor(folder, dbPath)], accept);
  }

  /* On the desktop, after a database was successfully touched, write the
   * catalog the mobile picker needs: tables, columns, types, and the
   * distinct values of low-cardinality text columns. Once per session per
   * database, in the background, never blocking a render. */
  maybeWriteCatalog(dbPath) {
    if (!Platform.isDesktopApp) return;
    if (!this.catalogged) this.catalogged = new Set();
    if (this.catalogged.has(dbPath)) return;
    this.catalogged.add(dbPath);
    this.writeCatalog(dbPath).catch((e) => {
      console.error(safeLogLine('the catalog write failed', e));
      this.catalogged.delete(dbPath);
    });
  }

  async writeCatalog(dbPath) {
    const schema = await this.schemaFor(dbPath);
    if (!schema.live) return;
    /* Structure only by default. Raw values move into the synced catalog
     * only when the member turned the setting on (M2, Vex 2026-09-01). */
    const values = {};
    if (this.settings.catalogIncludeValues) {
      for (const table of schema.tables) {
        for (const col of table.columns) {
          if (!isTextType(col.type)) continue;
          try {
            const res = await this.query.query(dbPath,
              'SELECT DISTINCT ' + quoteIdent(col.name) + ' FROM ' + quoteIdent(table.name) +
              ' WHERE ' + quoteIdent(col.name) + ' IS NOT NULL LIMIT 201');
            if (res.rows.length > 0 && res.rows.length <= 200) {
              values[table.name + '.' + col.name] = res.rows.map((r) => String(r[0])).sort();
            }
          } catch (e) { /* a column that will not enumerate is left out */ }
        }
      }
    }
    const path = catalogPathFor(this.settings.cacheFolder, dbPath);
    await this.writeCacheNote(path, JSON.stringify({
      database: dbPath,
      computedAt: new Date().toISOString(),
      tables: schema.tables,
      values,
    }));
  }
}

/* ------------------------------------------------ the embedded sql.js -- */
/* Obsidian's community-directory installer ships exactly three files:
 * main.js, manifest.json and styles.css. So the vendored sql.js build lives
 * here, and WasmEngine uses it whenever the standalone wasm is not
 * installed alongside.
 *
 * The WebAssembly binary is base64 (it is data, not code). In this source
 * file the string is a placeholder (see build.mjs); `npm run build`
 * replaces it with sql-wasm.wasm encoded as base64.
 *
 * The JavaScript half is added at the VENDORED_SQLJS marker below as plain
 * source inside a function, between BEGIN and END marker comments, so the
 * shipped main.js is reviewable and nothing is compiled from a string at run
 * time. The build takes the vendored sql-wasm.js and applies the one patch
 * (see the note at the marker; embedded-sqljs.mjs holds it as a scripted
 * transform). The vendored originals and their hashes are recorded in
 * THIRD-PARTY-NOTICES.md, and a gate asserts the shipped main.js equals this
 * source plus the vendored file with that patch and the embedded binary is
 * byte-identical to the standalone file. */
const EMBEDDED_SQL_WASM_B64 = '@@EMBEDDED_SQL_WASM_B64@@';

/* The pure library, exposed for the gates. */
ReadOutPlugin.lib = {
  WIDGET_BLOCK_LANG, parseWidgetBlock, widgetIndexIn, blockSizeFor, blockCachePath, WidgetBlockChild,
  checkSegments, segmentsOf, checkPie, pieOf, piePath, isPartsViz,
  checkMeter, meterFill,
  checkHeatmap, heatmapHighlight, heatmapGrid,
  checkTextTile, isThinTile, drawsNoData, textOf, FORM_VIZ,
  checkTileNotes,
  extOf, baseName, stemOf, formatBytes, formatNumber, relativeTime,
  stripSqlNoise, gateStatement, applyRowCap,
  wasmTable, toCsv,
  quoteIdent, quoteLiteral, filterClause, buildBrowseQuery, buildCountQuery,
  isSidecarPath, isDbPath, isSkippedPath, findDatabases,
  parseDashboardSpec, cachePathFor, dashCachePath, catalogPathFor, walkDatabases, isVaultRootFolder, isInsideFolder,
  niceScale, stackRows, statOf,
  validTimeframe, resolveTimeframe, timeframeConditions, sqlForWidget,
  pivotSeries, prepareTileForRender, checkWidgetSource, specToJson,
  writeReadoutNote, readReadoutNote, rewriteReadoutNote, noteTwinOf,
  tileDatabase, tileSql, isNumericType, isTextType, guessTimeColumn,
  matchesNeedle, colsForWidth, defaultSpanFor, clampLayout, rectsCollide,
  findSpot, packLayout, normalizeLayout, showAddTile, seriesPaletteFor, barPath,
  FILTER_OPS, filterConditionOf, filtersCondOf, COMPARE_LABELS, canCompare,
  deltaBadge, nextPreviewState, canSave, droppedSettings, formNumber, formNumberList, checkFormTile, DASHBOARD_README, AI_WIDGET_GUIDE, GUIDE_FILES, SAMPLE_BLOCK_LANG, WIDGET_SAMPLES, renderWidgetSample, WidgetSampleChild, guideHash, guideTextFor, guideIsPluginOwn, guideRevision, guideRefreshFor, refreshGuideFile, VIZ_KINDS, SIZE_PRESETS, sizePresetOf, makeDebounce,
  chartLayout, xLabelPlan, heatmapLabelPlan, CHART_MIN_X_H, CHART_MIN_Y_W, TICK_CHAR_W, renderTile,
  fitStatCaption, STAT_CAPTION_STEPS, isLevelColor, checkChartColors, chartPaletteFor, normalizeLevels, levelIdFor, planLevelRename, renameLevelInDashboard, normalizeLevelLooks, checkRanges, checkLevelColors, checkTileLevels, levelOf, resolveLevel, levelLookFor,
  headerDeltaOf, checkHeaderDelta, chartRangeOf, chartCaptionOf,
  checkRangeColumn, checkCaptions, statCaptionSteps, CAPTIONS_MAX, checkValueSize, fitStatValue, nextFitSize, VALUE_SIZE_PRESETS,
  LEVEL_THEME_COLORS, DEFAULT_LEVELS, LEVEL_LOOKS, DEFAULT_LEVEL_LOOKS,
  rowTracks, rowsForOffset, DIVIDER_ROW_PX, renderDivider,
  detectIcorScaffold, detectIcorVault, folderDefaultsFor, PLAIN_FOLDERS, ICOR_FOLDERS,
  shortHash, dbKeyOf, legacyCatalogPathFor, safeLogLine, READ_PRAGMAS, READ_PRAGMA_FUNCS,
  ensureFolder, csvExportName,
  bytesOfB64, EMBEDDED_SQL_WASM_B64,
  DEFAULT_SETTINGS, PRESET_LABELS, AGG_LABELS, DEFAULT_GLOBAL_TIMEFRAME,
  checkChartAxis, chartScaleFor, ceilToTwoFigures, keepUneditedKeys,
  checkChartMarks, chartMarkValues,
  checkBand, bandPaths, cellNumber,
  checkCombo,
  checkScatter, scatterOf, leastSquares, scatterXScale, renderScatterChart,
  checkCalendar, calendarOf, calendarWeeksFit, calendarDayOf, renderCalendar,
  checkBullet, bulletRowsOf, bulletScaleOf, bulletBands, renderBullet,
  checkSparklines, sparkValuesOf, renderResultTable,
  SQLITE_MAGIC, NOT_SQLITE_TEXT, hasSqliteHeader, UNREADABLE_TABLE_NOTE,
};

/* The form modal, exposed for the gates only. */
ReadOutPlugin.modals = { WidgetFormModal, ConfirmModal };

module.exports = ReadOutPlugin;

/* ---------------------------------------------------- the vendored sql.js -- */
/* sql.js 1.13.0, sql-wasm.js (MIT, see THIRD-PARTY-NOTICES.md), added by the build as
 * the body of one function so it runs as ordinary source and never through
 * eval or new Function. It is a UMD build: called with a `module` it sets
 * module.exports to initSqlJs.
 *
 * MODIFIED, one patch: the Node.js loading branch is removed. The vendored
 * file has a branch that loads Node's file system, path and crypto modules
 * when it detects Node outside a renderer, and a stdin read in the same
 * case. All of it is cut, and random bytes come from crypto.getRandomValues
 * only. The browser path is untouched, and nothing else is changed. The patch
 * is four mechanical edits listed in embedded-sqljs.mjs, and a test asserts
 * this copy equals the vendored sql-wasm.js with exactly that patch applied.
 *
 * What this code can reach in this plugin: initSqlJs is always called with
 * `wasmBinary` (the bytes are already in hand), so its fetch and
 * XMLHttpRequest paths and its document.currentScript lookup never fetch
 * or read a file here: the binary is never requested by URL. */
/*@@VENDORED_SQLJS@@*/
