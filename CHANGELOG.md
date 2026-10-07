# Changelog

All notable changes to ReadOut. Entries before 1.0.0 are the history of the
ICOR for Life SQLite Viewer by myICOR, which ReadOut is forked from; they are
kept here as they were written.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-07

ReadOut's first release: the ICOR for Life SQLite Viewer 0.7.0, forked and
renamed, under the same MIT licence with the original authors credited in
`LICENSE`. Every widget, setting and engine of 0.7.0 is here.

### Changed
- **New name and id.** The plugin is ReadOut, id `readout`. It is a new plugin
  to Obsidian: install it beside or instead of the old one, and move
  `data.json` across to keep your settings.
- **The code block in a note is now `readout`.** A note that used the
  `sqlite-viewer` block word stops drawing the widget and shows the block as
  plain code until the word is changed to `readout`. The words inside the
  block are unchanged.
- **The help file's live samples use `readout-sample`.** An unedited copy of the
  help file in a dashboards folder is brought up to date at start.
- **The folders are chosen for the vault, once.** A fresh install in a vault
  with the ICOR for Life scaffold uses `07 Databases`, `07 Databases/Dashboards`
  and `07 Databases/Dashboard Cache`; any other vault uses `Databases`,
  `Databases/Dashboards` and `Databases/Dashboard Cache`. Saved settings always
  win, and an existing `data.json` is never changed by this.
- **"Open JSON files in the vault" is off for a new install.** Switch it on in
  the settings to open a dashboard file as its dashboard. An existing
  `data.json` keeps what it saved.
- **The two guide files are written when you ask.** Starting ReadOut no longer
  writes `README.md` and `AI-WIDGET-GUIDE.md` into the dashboards folder. Run
  the command "Write the guide files", or press the button of the same name in
  the settings. A copy that is already there and still unedited is kept up to
  date at start; an edited copy is never touched. The fingerprint line now
  says "Written by ReadOut", and copies that say "Written by the SQLite Viewer
  plugin" are still recognised.
- The log prefix is "ReadOut:".

### Removed
- **The three starter dashboards** (health, engagement, YouTube). They pointed
  at databases most vaults do not have. An empty dashboards view offers
  "Create your first dashboard".
- **The automatic move from "07 Data" to "07 Databases".** It only helped
  vaults on the 0.1 to 0.4 releases of the original plugin. Set the folders in
  the settings if you are coming from one of those.

### Release
- The release is built by this repository's own workflow and carries
  `main.js`, `manifest.json` and `styles.css` only. The SQLite engine is inside
  `main.js`.

## [0.7.0] - 2026-10-06

### Added
- **A file that is not SQLite says so.** The plugin opens every `.db`,
  `.sqlite` and `.sqlite3` file, and some are not databases (a Windows
  `Thumbs.db`, a text file renamed by hand). The first 16 bytes are now
  checked before an engine is asked, and the browser, the schema picker and
  every dashboard widget show "This file isn't a SQLite database" instead of
  an engine error. The desktop engine reads the 16 bytes by file handle once
  per version of the file; the built-in engine checks the bytes it has
  loaded anyway. An empty file is still read as an empty database.
- **Scatter chart** (`"viz": "scatter"`): one point per row, placed by a
  number in `x` and a number in `y`. `colorBy` colours the points by a
  column (the four most common values, the rest as Other), `trend` draws the
  least-squares line through them, `xMin` and `xMax` fix the number scale
  along the bottom. The y axis fields, `refLines` and `zones` work as on a
  line chart.
- **Year calendar** (`"viz": "calendar"`): one square for each day, a week
  to a column, coloured by value levels like a heatmap. It reads a `date`
  and a `value` column and shows the last 53 weeks up to the newest day in
  the data, or a whole `year`; `weekStart` is `"sunday"` (default) or
  `"monday"`. It is its own widget, not a heatmap mode, because it reads one
  date column where a heatmap reads a row and a column.
- **Bullet chart** (`"viz": "bullet"`): a bar for the actual value against a
  mark for its target, for each row, on one shared scale shaded in bands by
  the value levels. `x` labels the bars, `target` names the target column,
  `scaleMin` and `scaleMax` fix the scale.
- **Sparklines in table rows**: `sparklines` on a table names the columns
  whose cells each hold a short series of numbers (written `3,5,4,8`, as
  `group_concat` writes them) and draws every such cell as a tiny line
  chart.
- The edit form builds and reads back all of these, and the help file, the
  AI guide and the README reference document them, with a light and a dark
  picture for each new widget.

### Changed
- The messages for the axis fields, guide lines, zones and colour name
  scatter among the chart types that take them.
- The table sample in the help file shows a sparkline column.

## [0.6.1] - 2026-09-26

### Fixed
- **Charts fit their tile.** Line and bar charts were drawn in a fixed
  640 x 260 frame and stretched to the tile's width, so a wide, short tile
  cut off the bottom of the chart. A chart is now drawn to the measured
  size of its tile and redrawn when the tile is resized. When space is
  short, date labels thin out, dates and values step aside, gridlines get
  fewer and the legend stays on one line. The dotted comparison line stops
  at the current period's last point, and every tile title is one line
  with the full text on hover. Where nothing can be measured, the old
  frame is used, scaled to the width. Thanks to Matt Zymet (@zymetm) for
  the fix (#5, closes #4).
- **A built widget can be renamed again.** Editing a widget built from a
  table showed only the Database and Table pickers until the Table picker
  was reopened, so its name could not be changed. The form now loads the
  table's columns when it opens; while they load, or when the table cannot
  be read on this device, the name and unit stay editable and the form
  says why. Thanks to Matt Zymet (@zymetm) for the fix (#3, closes #2).
- **Charts in a popout window follow their tile.** Each chart's resize
  watcher now comes from the window the tile lives in, so a dashboard
  moved to its own window keeps redrawing as it is resized. The watchers
  are closed when the dashboard redraws or closes (#7, follow-up to #5).

### Known issues
- The value shown while hovering a line chart can still be cut at the
  edge of a very narrow chart.

## [0.6.0] - 2026-09-21

### Changed
- Relicensed under MIT. Releases before 0.6.0 remain under the ICOR for Life
  Source-Available License (Code) v1.0.
- README rewritten for the person installing the plugin, not the person rebuilding it.
- Security contact is support@myicor.com.
- The live test derives its cache folder from the plugin's resolved settings.
- README: a support section instead of a fundingUrl.

## [0.5.3] - 2026-09-01

### Fixed
- A community-directory install now works: Obsidian's installer downloads
  only `main.js`, `manifest.json` and `styles.css`, so the sql.js engine
  (`sql-wasm.js` + `sql-wasm.wasm`) is now embedded in `main.js` as
  base64, byte-identical to the standalone files. The standalone copies
  are preferred when installed alongside (manual installs); the embedded
  copies answer otherwise. Three new gates, including a simulated
  three-file install answering `SELECT 1`.

### Changed
- `main.js` grows to about 1.1 MB from the embedded engine; common for
  wasm plugins and the cost of a directory install that works everywhere.

## [0.5.2] - 2026-09-01

### Security
- The statement gate now refuses the paren set form of scalar PRAGMAs
  (`PRAGMA user_version(7)` and friends). Parens are allowed only for the
  introspection pragmas that genuinely take an argument. Closes the last
  audit finding (L5); three new gate tests.

## [0.5.1] - 2026-09-01

### Security
- The statement gate enforces read-only itself instead of leaning on the
  engine: write verbs are refused anywhere in the statement (including
  behind a `WITH` chain), and PRAGMA is an explicit read-only allowlist
  with assignments refused. (Audit M1)
- The catalog stores structure only by default; harvesting distinct column
  values into the synced catalog file is now an opt-in setting with a
  plain-words privacy warning. (Audit M2)
- The `.json` viewer can be handed back to other plugins via a setting. (L1)
- Console errors log a safe one-line summary, never SQL or row data. (L2)
- The custom `sqlite3` path setting validates the path and warns that the
  plugin runs whatever it points to. (L3)

### Fixed
- Catalog and cache files are keyed by filename plus a hash of the full
  vault path, so two same-named databases no longer collide. (L4)

## [0.5.0] - 2026-09-01

### Changed
- The home folder becomes `07 Databases`, with silent adoption of the
  legacy location.

### Added
- Public-release readiness: README rewritten for strangers, SECURITY.md,
  THIRD-PARTY-NOTICES.md with verified hashes of the vendored sql.js.

## [0.4.0] - 2026-09-01

### Added
- The widget form: build and edit widgets in a dialog instead of raw JSON.
- One settings page with a live preview that gates Save.

## [0.3.0] - 2026-09-01

### Added
- Search in every picker.
- Edit mode with a square grid for dashboards.
- The INKLINE instrument-panel skin.

## [0.2.1] - 2026-09-01

### Added
- A JSON view.
- "New dashboard" in the folder context menu.

### Changed
- Filters sit quietly behind a funnel icon; the INKLINE control boundary.

## [0.2.0] - 2026-09-01

### Added
- The dashboard builder: widgets without writing SQL.
- The global date range.
- The mobile catalog, so pickers work on phones and tablets.

## [0.1.1] - 2026-09-01

### Fixed
- A stale dashboards view reloads on reveal.
- Every failure is visible; flat table headers.

## [0.1.0] - 2026-09-01

### Added
- First release: read-only table browser, SQL console, dashboards, and the
  two engines (the system `sqlite3` on desktop, the bundled sql.js
  everywhere else).
