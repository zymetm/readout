# Changelog

All notable changes to ReadOut. Entries before 1.0.0 are the history of the
ICOR for Life SQLite Viewer by myICOR, which ReadOut is forked from; they are
kept here as they were written.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

## [1.0.9] - 2026-10-09

### Fixed
- **Text widgets have their styling back.** One stray closing brace in the
  stylesheet made Obsidian skip the rule after it, so a text widget's
  paragraphs lost their size, colour and spacing in 1.0.8. A test now checks
  that every brace in the stylesheet is balanced.

## [1.0.8] - 2026-10-09

### Fixed
- **No pointless decimals in a chart's change.** A whole change reads
  "+361 USD", not "+361.0 USD", in the title row, the caption and the hover
  text; a real decimal stays ("+2.5 USD") and thousands get a comma.
- **The year calendar fits a phone.** When its tile is too narrow for every
  week it shows the newest weeks that fit (squares of at least 6 px), with the
  month names moved to the weeks that are left, and never scrolls sideways.
  Wider tiles show every week as before.
- **Tables in a narrow tile are tidier.** A heading wraps at its spaces and is
  never cut off or broken in the middle of a word, headings share one baseline,
  numbers are never clipped, text and type are a little tighter, and a cut text
  cell shows its whole text on hover. A table that still cannot fit scrolls
  sideways.
- **The change badge of a big-number widget always has its own line** directly
  under the number, whatever the length of the number, so every stat tile
  looks the same. The unit stays beside the number.

## [1.0.7] - 2026-10-09

### Changed
- **ReadOut searches the whole vault for databases again, by default.** It walks
  the folders from the vault root through Obsidian's folder API, skipping the
  configuration folder, `.git` and `.trash`. A new setting, "Search for databases
  in", can limit this to the databases folder. The search scope and the
  databases folder are now separate settings: the databases folder is where
  dashboards, exports and any move you choose go.
- **Settings from 1.0.6 are carried over.** If 1.0.6 stored the vault root as
  the databases folder, it is restored to the vault's usual databases folder
  (`Databases`, or `07 Databases` in an ICOR for Life vault) and the whole vault
  is searched.
- The README no longer opens with a "Safe by design" box. "What ReadOut can
  access" says plainly what it does, including that it scans the whole vault.

### Added
- **A note for a database outside the databases folder.** When you open one
  directly (a click, the browser or the index), a short note appears once for
  that file, with a "Move" button. It moves the file and its `-wal` and `-shm`
  files into the databases folder only when you click it, and never over an
  existing file. Dashboards never show it. A setting turns the notes off.

## [1.0.6] - 2026-10-09

Changes from the Obsidian community plugin scan of 1.0.5, and a real build.

### Changed
- **ReadOut is now built from source.** The hand-written code is in
  `src/main.js` and `src/styles.css`; `npm run build` puts the SQLite engine
  and its WebAssembly file into `main.js` and copies `styles.css`, using only
  Node's own modules and giving the same bytes every time. `main.js` and
  `styles.css` stay committed because Obsidian installs them, and the checks on
  every pull request and release fail if a fresh build differs from them.
- **ReadOut no longer lists every file in your vault.** It looks for databases
  by walking the database folder (`Databases`, or `07 Databases` in an ICOR for
  Life vault) and its subfolders. Clicking any database file anywhere still opens
  it, and a dashboard can name a database anywhere in the vault. A new setting,
  "Database folder", names the folder, and "Search the whole vault for databases"
  widens the search to every folder. (1.0.7 makes the whole vault the default
  again.)
- **ReadOut no longer uses the clipboard.** "Copy as CSV" on a query result is
  now "Save as CSV": it writes a `.csv` file into an `Exports` folder inside the
  database folder, never over an existing file, and a notice opens it. The JSON
  viewer's "Copy JSON" button is gone; the JSON is already a file in your vault.

### Removed
- **The "Move databases into ..." button.** It needed a listing of the whole
  vault. Move a database in Obsidian's file explorer instead.
- History: the optional desktop `sqlite3` helper was removed in 1.0.5; the
  built-in engine is the only engine.

## [1.0.5] - 2026-10-09

Changes from the Obsidian community plugin scan of 1.0.4.

### Changed
- **ReadOut no longer contains any code that touches Node's file system.** The
  last "direct file system access" warning came from the SQLite engine
  (sql.js) pasted into `main.js`: it carried a branch for running under Node
  that loads Node's file system, path and crypto modules. That branch never ran
  in Obsidian. It is now cut out of the copy in `main.js`, and nothing else in
  the engine is changed. Measured in Obsidian: the dashboards and the data
  browser load, query and draw as before.
- **The size limit is stated plainly.** The README and the settings now say
  databases up to about 2 GB open and larger files will not.

### Fixed
- **Every "Unexpected duplicate property" warning in the CSS lint.** 31
  declarations in the stylesheet repeated a property already set earlier in the
  same rule (the button resets). Each property is now written once per rule with
  its final value. The look is unchanged: the computed style and the position of
  4,777 elements (the tab bar, filter button and row, sort headers, tile
  buttons, the Advanced toggle, and three dashboards in view and edit mode) were
  compared with 1.0.4 and match.

### Added
- **A `build` script that is honest about having no build.** `npm run build`
  compiles nothing and changes no file. It checks that `main.js` embeds the
  vendored sql.js (with the one patch above) and the vendored `.wasm` exactly,
  and fails if not. CI and the release workflow run it, then check that
  `main.js`, `manifest.json` and `styles.css` are unchanged.
- **README:** "What ReadOut can access, and why" now says the vault listing
  finds databases anywhere in your vault (it reads file names and sizes only),
  and that the clipboard is written only when you click a copy button and is
  never read.

## [1.0.4] - 2026-10-08

Changes from the Obsidian community plugin scan of 1.0.3.

### Changed
- **ReadOut no longer starts the `sqlite3` program or touches Node's file
  system.** The scan flagged "shell execution" and "file system access", and
  both came from the optional desktop `sqlite3` engine. It is removed. Every
  device now uses the built-in engine (sql.js), which loads the database file
  into memory. Measured in Obsidian on an 847 MB and a 905 MB database, the
  engine loads in about a second and answers a dashboard's queries in
  milliseconds. While a big file loads it needs roughly three times its size in
  free memory.
- **The size cap defaults to 1500 MB on a desktop** (it stays 200 MB on a phone
  or tablet) and can be raised to 2000 MB, the most a single file read can
  return. A file over the cap now gets a plain message that names the setting
  to raise, in place of an error.
- **The "Path to sqlite3" and "Query timeout" settings are gone**, with the
  program they belonged to. The built-in engine has no timeout, so keep queries
  fast. The AI widget guide (revision 11) and the help say so.
- **The data browser's header** now reads "read-only, in memory" on every
  device.

### Fixed
- **Every CSS lint warning in the scan.** No `!important`, no `all:` reset, no
  `:has()`, no `column-gap` and no `display: contents` remain in the stylesheet.
  The look is unchanged: the computed style and the position of every button,
  the filter box, the sort headers and the dashboard tiles were compared with
  1.0.3 and match.
- **A table the built-in engine cannot read no longer breaks the rest.** A database
  can hold a table that needs a SQLite module the built-in engine does not have
  (an FTS5 search index, for one). Reading its columns failed, which stopped the
  mobile catalog from being written (the console logged "the catalog write
  failed"), and the widget editor's table picker with it. Such a table is now
  listed with no columns and a plain note ("can't be read by the built-in
  engine"), its row count shows a dash, and every other table works as before.

### Added
- **A README section, "What ReadOut can access, and why"**, for the scan's
  notes on file listing, vault reads and writes, and the clipboard.
- **Build provenance.** The release workflow now signs a GitHub artifact
  attestation for `main.js`, `manifest.json` and `styles.css`, and the release
  check verifies each published file against it.
- **A lockfile** (`package-lock.json`, no dependencies) so the build can be
  checked with `npm ci`.

## [1.0.3] - 2026-10-08

Layout fixes found by checking a real 13-widget dashboard at a wide pane and at
about 400px.

### Fixed
- **Pie and doughnut legend.** The ring no longer takes more than 45% of the
  tile's width, so the legend keeps room for its names (they were cut to one or
  two letters beside empty space). A tile too narrow for a name of 8 characters
  puts the legend under the ring. Every name has its full text as a tooltip.
- **Bullet chart labels.** The label column is as wide as the longest label, up
  to 45% of the tile; a longer label wraps to a second line, and the bar takes
  the rest.
- **Chart axis labels are never cut.** A label along the bottom of a bar or line
  chart was cut to ten characters ("before 201"). It is now drawn whole, and
  labels are skipped to make room.
- **A narrow pane leaves no gaps.** A dashboard drawn for six columns, shown in
  two, left empty cells and put tiles alone in the right column. The tiles now
  keep their reading order and fill from the top left; a divider still keeps
  the tiles after it below it. A layout that fits the pane is untouched.
- **Stat units.** The unit and the change badge sit beside the number while they
  fit and drop below it when they do not, instead of being cut ("g...").
- **Heatmap column labels.** Labels that ran into each other (the year columns)
  now turn to read upwards, or are thinned to every Nth, and the grid no longer
  demands 360px, so a narrow tile does not scroll sideways.
- **Tables in a narrow tile.** In a tile of 400px or less the table shares the
  width: headers wrap instead of being cut, text columns are trimmed, and the
  sparkline column shrinks first. A header was cut to two letters and the last
  column pushed out of sight.
- **Tile titles and hints.** A title may take two lines and a hint two lines (at
  most 45% of the row) before anything is cut with an ellipsis.

### Changed
- **The AI widget guide has a new section, "Turn this guide into a skill"** (the
  guide is revision 10). It tells an agent to make a skill that points at the
  guide in the dashboards folder instead of copying it, keeps the seven step
  procedure and its plugin checks (steps 4 to 6), and adds only the user's own
  preferences. It includes a sample prompt and names no one vendor's format.
  Unedited copies are brought up to date at start.

## [1.0.2] - 2026-10-07

### Changed
- **"Create Guide Files for Your AI Team" greys out once the files exist.**
  When `README.md` and `AI-WIDGET-GUIDE.md` are both in the dashboards folder,
  the button on the empty dashboards screen goes inactive, says "Guide files are
  in" the folder, and still offers "Open the AI guide". If either file goes
  missing (deleted, renamed, moved, or the folder setting changed) the button is
  active again. It reacts while the screen is open and is checked every time the
  screen is drawn.

## [1.0.1] - 2026-10-07

### Added
- **"Create Guide Files for Your AI Team" on the empty dashboards screen.** It
  sits beside "Create your first dashboard" and does what the command "Write
  the guide files" does: writes `README.md` and `AI-WIDGET-GUIDE.md` into the
  dashboards folder. A notice and a line on the screen say where they went, with
  a button to open the AI guide. If the files are already there it behaves like
  the command: an unedited copy is brought up to date, an edited one is left
  alone.

### Changed
- The help file mentions the new button (revision 9).

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
