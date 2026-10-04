---
title: AI widget guide
doc_type: note
status: active
tags:
  - sqlite
  - dashboards
---

# AI widget guide: building a dashboard widget for the SQLite Viewer

This file is for AI assistants (and teams of them) asked to build or change
a widget on a dashboard of the ICOR for Life - SQLite Viewer plugin for
Obsidian. It assumes nothing about the vault around it. A person who wants
to build widgets by hand should read `README.md` in this folder instead: it
explains the edit panel field by field, and its appendix is the full field
reference for the dashboard file. This guide refers to that appendix as
"the field reference".

The plugin writes this file and keeps it up to date: a newer plugin replaces
it only while it is still exactly the plugin's text. The last line holds a
fingerprint (a hash of everything above it); an edited copy no longer
matches and is never overwritten. Delete the file to get the plugin's
newest text; it is written again on the next load or on "New dashboard".

## 1. What a dashboard is and where it lives

- A dashboard is one JSON file. The plugin reads every file ending in
  `.json` directly in its dashboards folder (not in subfolders). The folder
  is the plugin setting "Dashboards folder" (`dashboardFolder` in the
  plugin's settings); this guide is written into that folder, so the
  folder holding this file is the one.
- Any `.json` file there that does not read as a dashboard is listed as an
  error at the top of the dashboards view. Never put other JSON there.
- A dashboard holds `id`, `title`, `database`, an optional
  `globalTimeframe`, and `tiles` (the widgets). A widget is a "tile" in the
  file and a "widget" on screen.
- The plugin also keeps a cache folder (the setting "Dashboard cache
  folder") with the last results, for phones. Never write there.
- The value levels a widget's `ranges` name (their names and colours) live
  in the plugin settings, not in any dashboard file. The defaults are
  `Good`, `Watch` and `Alert`.

## 2. Hard rules

1. **Read-only.** Never write to a database. The plugin only runs one
   statement per query, starting with SELECT, WITH, PRAGMA or EXPLAIN. It
   refuses a second statement after a semicolon, any write verb (INSERT,
   UPDATE, DELETE, CREATE, DROP, ALTER, VACUUM and the like) even behind a
   WITH clause, and every PRAGMA that can change a database.
2. **One database per dashboard.** Every SQL widget reads the dashboard's
   top-level `database`. Only a built widget (with `source`) may name
   another one in `source.database`.
3. **No ATTACH.** ATTACH and DETACH are refused. A query cannot join two
   database files; if the data is in two files, it is two dashboards, or a
   built widget with its own `source.database`.
4. **The query must run in the plugin's engine.** On the desktop the
   plugin uses the sqlite3 command-line tool when it is installed (read-only,
   whatever version is on that computer); otherwise, and on phones and
   tablets, its built-in engine, sql.js 1.13.0 (SQLite compiled to
   WebAssembly), which loads the whole database into memory up to the
   setting "Size cap for the built-in engine (MB)" (200 by default). Write
   plain SQLite that both run. Do not rely on a loadable extension or a
   function only a very new SQLite has. Test with the plugin's own engine,
   not only with another tool (see the procedure).
5. **Row cap.** A widget on a dashboard gets at most 5,000 rows (the panel's
   preview 500): a query without a LIMIT gets one added. Aggregate in SQL
   (GROUP BY a day or a week) instead of returning raw rows.
6. **Timeouts.** With the sqlite3 tool, a query that runs longer than the
   setting "Query timeout (seconds)" (30 by default) is stopped. The
   built-in engine has no timeout and blocks while it works, so a slow
   query freezes the view. Keep every query fast: filter early, use indexed
   columns, avoid correlated subqueries over big tables.
7. **Window from the newest data row, not from "now".** Data often lags
   (a sync that runs nightly, a device that uploads late). A window written
   as `date('now', '-30 day')` empties the chart when the data is a few
   days behind. Anchor it on the newest row instead:
   `WHERE day >= date((SELECT MAX(day) FROM sales), '-30 day')`.
   The plugin itself does this for built widgets. It does no date
   arithmetic for an SQL widget: the dashboard's "Range" picker does not
   reach an SQL widget, so the window is written in the query.
8. **Only fields the plugin knows.** The edit panel rewrites the whole file
   on every save, and a key the plugin does not know is dropped then. Use
   only the fields in the field reference.
9. **Never leave test widgets in a user's dashboard.** Test in a copy (a
   separate dashboard file with its own `id`) and delete it when done, or
   remove any test widget before you finish.

## 3. The procedure

1. **Read the schema, read-only.** In Obsidian: the plugin's database view
   ("SQLite Viewer" database browser), tab "Schema", or tab "SQL console"
   with `PRAGMA table_info('sales')`. Outside Obsidian, any read-only SQLite
   client, for example `sqlite3 -readonly <file> ".schema sales"`. Note the
   column types and how dates are stored (text like `2026-01-31` sorts and
   compares well; numbers of seconds need `date(col, 'unixepoch')`).
2. **Write the query and test it against the database.** Run it in the
   plugin's "SQL console" tab, which uses the same engine and the same
   read-only check as a dashboard. Check that it returns the columns the
   widget type needs (section 5), in the right order, with sensible
   values, quickly. Check the newest and oldest rows of any window.
3. **Write the widget.** Add one object to the dashboard's `tiles` list,
   using only the fields in section 4. Leave `layout` out to let the
   plugin place the widget, or give a free spot (`{"x":0,"y":0,"w":2,"h":2}`
   in grid cells, 6 columns wide). Keep the file valid JSON.
4. **Validate.** Open the dashboard, press "Edit", then "Open as text". The line
   under the text says "The dashboard reads fine: N widgets." or "The
   dashboard will not open like this:" with the reason, naming the widget
   ("Tile 3") and the setting. Fix until it reads fine. The same reasons
   show at the top of the dashboards view for a file that does not read.
5. **Open the dashboard and look.** Press "Refresh". The widget must draw
   with no error box in it, and the numbers must match what the query
   returned in step 2. Check a narrow pane too: text that is cut off means
   the widget needs more room or fewer words.
6. **Open it in the edit panel.** Press "Edit", then the pencil on the
   widget. Every setting you wrote must show in a field, the preview must
   draw, and the panel must not say that saving "leaves out what this
   widget had". If it does, you used a field the panel cannot show, or one
   that does not fit the type; fix the file, not the panel.
7. **Clean up.** Delete any test dashboard or test widget. Leave the user's
   file as it was apart from the widget they asked for.

## 4. The widget schema, per type

Every type takes `title` (text), `viz` (one of `line`, `bar`, `stat`,
`table`, `divider`, `combo`, `segments`, `heatmap`, `text`), `layout`
(`{x, y, w, h}`, whole cells, `w` and `h` 1 to 12), and, all but `divider`,
`unit` (text), `hint` (text, up to 60 characters) and `footnote` (text, up
to 300). Unset means the default. Colours are a theme colour like
`var(--color-green)` or a hex colour like `#2a7fff`; nothing else is
accepted. The field reference has an example of each type on an invented
shop database.

A widget is either SQL (`sql`, plus the columns its type needs) or built
(`source`, the plugin writes the query; `line`, `bar` or `stat` only).

| Type | Needs | Optional, with defaults |
| --- | --- | --- |
| `line` | `sql`, `x` (column), `y` (column or list of columns) | `color` (theme), `guideColor` (theme), `headerDelta` (false), `chartCaption` (`"range"` or `"change"`, none), `headerDeltaAverageDays` (1 to 365, none), axis fields, `refLines`, `zones`, `band` (`{low, high, opacity 0.2}`, SQL only) |
| `bar` | `sql`, `x`, `y` | `stack` (false, needs two or more `y`), `color`, `headerDelta`, `chartCaption`, `headerDeltaAverageDays`, axis fields, `refLines`, `zones` |
| `stat` | `sql` | `y` (the column shown, default the first), `captions` (up to 4 columns, default the next column), `valueSize` (12 to 120 or `"fit"`, theme default), `meter` (`{min, max, target}`), `ranges`, `levelColors`, `rangeColumn` |
| `table` | `sql` | none beyond the common fields |
| `combo` | `sql`, `x`, `series` (1 to 8) | `stack` (false), right axis `y2Min`, `y2Max`, `y2MaxLimit`, `y2Ticks`, `y2TickSuffix`, `y2TickCompact`, `y2Unit`, left axis fields, `refLines`, `zones` (each with `axis`), `guideColor`; never `y`, `color`, `band`, `headerDelta`, `chartCaption` |
| `segments` | `sql`, `x` (part name), `y` (part size) | `segmentColors` (`{"Part name": colour}`), `ranges` with `rangeColumn` (needed when there are ranges), `levelColors` |
| `heatmap` | `sql`, `row`, `column`, `value` | `ranges` (without them every cell is grey), `levelColors`, `marker`, `markerColor`, `markerLabel`, `highlight` (`"hour"`, `"day"`, `"weekday"`), `cells` (`"square"`, `"fill"`; default thin rows), `columnLabelEvery` (whole number) |
| `text` | `text` (up to 2,000 characters) or `sql`, never both | `line` (true: one thin strip, no title) |
| `divider` | nothing | `title` (the heading); `layout.h` must be 1; no `sql` or `source` |

- Axis fields (`line`, `bar`, `combo`): `yMin`, `yMax`, `yMaxLimit` (needs
  `yMax`), `yTicks` (1 to 12 rising numbers), `yTickSuffix` (up to 6
  characters), `yTickCompact` (true writes 8,000 as 8k), `xLabelEvery`
  (whole number). All unset means automatic.
- `refLines`: up to 8 `{y, label, color, dash, axis}`; `y` is required,
  `dash` a pattern like `"4 3"`.
- `zones`: up to 8 `{from, to, color, opacity, axis}`; `from`, `to` and
  `color` required, `opacity` 0.15 by default. `axis` (`"left"` or
  `"right"`) is a combo's only.
- `series` (combo): `{column, kind, axis, color, opacity, dash, connect,
  label}`; `kind` `"bar"` or `"line"` (default line), `axis` `"left"`
  (default) or `"right"`, `dash` and `connect` a line's only, `label` up to
  40 characters. Stacked bars share one axis.
- `ranges`: up to 12 `{low, high, level, label}`; bounds inclusive, either
  may be left out; the first range that holds the value wins; a range with
  neither bound is the catch-all and comes last. `level` is a level name
  from the plugin settings; `label` (up to 24 characters) is a pill's text.
- `levelColors`: `{"Level name": colour}`, this widget only.
- `source` (built): `table`, `metric` (a number column; empty for
  `count`), `agg` (`sum`, `avg`, `min`, `max`, `count`, `latest`;
  `latest` on a stat only), `filters` (`[{column, op, value}]`, `op` one of
  `eq`, `ne`, `contains`, `not_contains`, `gt`, `gte`, `lt`, `lte`,
  `empty`, `not_empty`), `series`, `groupBy`, `timeColumn`, `timeframe`
  (`"global"`, `{"preset": "7d" | "30d" | "90d" | "12m" | "all"}`, or
  `{"from", "to"}`), `database`. On the widget: `compare` (`none`,
  `previous`, `last_year`; not with `series`) and `favorable` (`up` or
  `down`).

## 5. What each query must return

| Type | Result shape |
| --- | --- |
| `line`, `bar` | One row per point, in drawing order (end with ORDER BY the x column). The `x` column (a date like `2026-01-31` or a label) and one number column per `y`. A missing value (NULL) is a gap. "Average the ends over N days" needs real dates in `x`. |
| `stat` | The first row only. The `y` column (or the first column) is the number; the next columns (or `captions`) are lines under it; `rangeColumn`, if set, is the number the ranges judge. Return one row (ORDER BY ... LIMIT 1 for "the latest"). |
| `table` | Any columns; the rows as returned, up to the row cap. Name the columns well (`AS`), they are the headings. |
| `combo` | One row per x value, the `x` column and one column per series. An empty cell is a gap, never zero. |
| `segments` | One row per part, in order, up to 12: the `x` column names it, the `y` column (a number, 0 or more) sizes it. With ranges, `rangeColumn` is read from the first row. |
| `heatmap` | One row per cell: `row`, `column`, `value` (a number), and the `marker` column if used. Rows and columns appear in the order the query returns them. For `highlight`, name columns 0 to 23 (hours), dates as `YYYY-MM-DD`, or weekdays like `Monday` or `Mon`. |
| `text` (from SQL) | The first column of the first row, as plain text (not Markdown). |

## 6. Keep a person able to edit it

The user will change the widget later with the edit panel (the pencil), so
build widgets the panel can show in full:

- Use only fields the panel has a field for. Every field in section 4 has
  one; the README's appendix table maps each panel label to its key. The
  one setting that is set by dragging instead is `layout`.
- Use level names that exist in the user's plugin settings (Settings, then
  the plugin, then "Value levels"). A name the settings lack draws neutral
  and shows in the panel as "(not in settings)". If you cannot read the
  settings, ask, or use the three defaults: `Good`, `Watch`, `Alert`.
- For a dashboard meant to be shared, use only the three default level
  names, a `database` path the other person has, and theme colours.
- Name every SQL column with `AS` so the panel's column lists read well.
- Keep the query readable. The user will see it in the panel's "SQL"
  field.
- Prefer one clear widget per question over a crowded one.

## 7. Common mistakes

- A window anchored on `date('now')`: empty charts when data lags. Use the
  newest row (rule 7).
- Forgetting ORDER BY: lines zigzag, bars come out of order, a stat shows an
  arbitrary row.
- `y` on a combo (it takes `series`), `color` on a chart with two or more
  series, `band` on a bar or a built widget, `rangeColumn` or `captions` on
  a built widget: the file does not read.
- A segments bar with ranges and no `rangeColumn`.
- A divider with a `layout` taller than 1, or with `sql`.
- Dates stored as text in another format (`31/01/2026`): they neither sort
  nor compare. Convert them in SQL or pick another column.
- Integer division: `SUM(a)/SUM(b)` is a whole number in SQLite when both
  are integers. Write `100.0*SUM(a)/SUM(b)`.
- Inventing a setting (a key not in the field reference): it is dropped on
  the next save from the panel, and some unknown values make the file
  unreadable.
- Writing a whole new file when one widget was asked for: other widgets'
  settings and places get lost. Add or change one object in `tiles`.
- Leaving a test dashboard or test widget behind (rule 9).
<!-- Written by the SQLite Viewer plugin (fingerprint f2cb0693). If you edit this file, the plugin stops updating it. -->
