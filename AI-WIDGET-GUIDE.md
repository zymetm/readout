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
says what each widget shows and what each setting of the edit panel does.
The full field reference for the dashboard file is section 8 of this guide,
called "the field reference" below.

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
`table`, `divider`, `combo`, `scatter`, `bullet`, `segments`, `heatmap`, `calendar`, `text`), `layout`
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
| `scatter` | `sql`, `x` (number column), `y` (one number column) | `colorBy` (column), `trend` (false), `color` (theme; one colour only, so not with `colorBy`), `xMin`, `xMax`, `yMin`, `yMax`, `yMaxLimit`, `yTicks`, `yTickSuffix`, `yTickCompact`, `refLines`, `zones`; never `xLabelEvery`, `band`, `headerDelta`, `chartCaption`, built `source` |
| `bullet` | `sql`, `y` (one number column: the actual value) | `x` (column naming each bar), `target` (column of targets), `scaleMin`, `scaleMax` (default zero up to the largest value, target or range end), `ranges` (the bands behind the bars), `levelColors`; never `color`, `rangeColumn`, built `source` |
| `segments` | `sql`, `x` (part name), `y` (part size) | `segmentColors` (`{"Part name": colour}`), `ranges` with `rangeColumn` (needed when there are ranges), `levelColors` |
| `heatmap` | `sql`, `row`, `column`, `value` | `ranges` (without them every cell is grey), `levelColors`, `marker`, `markerColor`, `markerLabel`, `highlight` (`"hour"`, `"day"`, `"weekday"`), `cells` (`"square"`, `"fill"`; default thin rows), `columnLabelEvery` (whole number) |
| `calendar` | `sql`, `date` (column of days), `value` (column) | `ranges` (without them every day with data is grey), `levelColors`, `weekStart` (`"sunday"` default, `"monday"`), `year` (a four-digit year; default the last 53 weeks up to the newest day) |
| `text` | `text` (up to 2,000 characters) or `sql`, never both | `line` (true: one thin strip, no title) |
| `divider` | nothing | `title` (the heading); `layout.h` must be 1; no `sql` or `source` |

- Axis fields (`line`, `bar`, `combo`, `scatter`): `yMin`, `yMax`, `yMaxLimit`
  (needs `yMax`), `yTicks` (1 to 12 rising numbers), `yTickSuffix` (up to 6
  characters), `yTickCompact` (true writes 8,000 as 8k), `xLabelEvery`
  (whole number; not on a scatter chart). A scatter chart's x is a number
  scale, so it takes `xMin` and `xMax` instead (scatter only, `xMin` below
  `xMax`). All unset means automatic.
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
| `scatter` | One row per point: `x` and `y` are number columns, and `colorBy`, if set, names the group of the point. A row with no number in `x` or `y` is left out, never drawn at zero. Dates and text in `x` are not numbers: turn a date into one in SQL, like `julianday(day) - julianday('2026-01-01')`. |
| `segments` | One row per part, in order, up to 12: the `x` column names it, the `y` column (a number, 0 or more) sizes it. With ranges, `rangeColumn` is read from the first row. |
| `bullet` | One row per bar, up to 12, in order: the `x` column labels it, the `y` column is its actual value, the `target` column its target. All the bars share one scale, so give them one unit, or write each as a percent of its target. A row with no number in `y` shows "no data". |
| `calendar` | One row per day: `date` (written `YYYY-MM-DD`, a time after it is ignored) and `value` (a number). A day with no row stays empty; a day twice takes the later row. The view ends at the newest `date`, not at today, so a lagging sync still fills the grid. |
| `heatmap` | One row per cell: `row`, `column`, `value` (a number), and the `marker` column if used. Rows and columns appear in the order the query returns them. For `highlight`, name columns 0 to 23 (hours), dates as `YYYY-MM-DD`, or weekdays like `Monday` or `Mon`. |
| `text` (from SQL) | The first column of the first row, as plain text (not Markdown). |

## 6. Keep a person able to edit it

The user will change the widget later with the edit panel (the pencil), so
build widgets the panel can show in full:

- Use only fields the panel has a field for. Every field in section 4 has
  one; the table "Panel label to file setting" in section 8 maps each
  panel label to its key. The one setting that is set by dragging instead
  is `layout`.
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
- A scatter chart with a date or text in `x`: those rows are left out and the
  chart says "No numeric x and y values to draw." when none is left. Make `x`
  a number in the query.
- Bars of different units in one bullet chart: they share one scale, so the
  small ones vanish. Use one widget per unit, or write each bar as a percent
  of its target.
- A calendar whose `date` is not `YYYY-MM-DD` (`31/01/2026`, a name): those
  rows are skipped. Convert the date in SQL.
- Writing a whole new file when one widget was asked for: other widgets'
  settings and places get lost. Add or change one object in `tiles`.
- Pointing `database` at a file that is not SQLite (a renamed text file, a
  `Thumbs.db`): every widget on the dashboard then shows "This file isn't a
  SQLite database." Fix the path.
- Leaving a test dashboard or test widget behind (rule 9).

## 8. The field reference

Every setting of the dashboard file, with an example of each type on an
invented shop database. The plugin's README on GitHub carries the same
reference.

<!-- field reference -->
### The file

```json
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
```

- `id`: lowercase letters, digits and hyphens. Also names the cache file.
  Renaming the title is safe; the id stays.
- `title`: the dashboard's name.
- `database`: the path of the database inside the vault. Every SQL widget
  reads this one file; a built widget's `source` may name its own.
- `globalTimeframe`: the range the header picker shows. A preset
  (`7d`, `30d`, `90d`, `12m`, `all`) or `{"from":"YYYY-MM-DD","to":"YYYY-MM-DD"}`.
- `tiles`: the widgets, in any order; each one's place is its `layout`.

A file the plugin cannot read is listed at the top of the dashboards view
with a plain sentence naming the widget and the setting. A setting the
plugin does not know is dropped the next time the panel saves the file.

### Panel label to file setting

| Panel label | In the file |
| --- | --- |
| "Widget name", "Title", "Heading" | `title` |
| "Chart type", "Widget type" | `viz` |
| "Unit" | `unit` |
| "Size", "Width" | `layout` |
| "SQL" | `sql` |
| "X column", "Part name column", "Label column" | `x` |
| "Y columns (comma-separated)", "Y column", "Actual value column", "Value column", "Part size column" | `y` |
| "Stack the series on top of each other", "Stack the bars on top of each other" | `stack` |
| "Database", "Table", "Value", "Add it up", "Date", "Dimension", "Group by", "Filter data", "Time frame" | `source`: `database`, `table`, `metric`, `agg`, `timeColumn`, `series`, `groupBy`, `filters`, `timeframe` |
| "Compare with" | `compare` |
| "Good direction" | `favorable` |
| "Value levels" (the ranges) | `ranges` |
| "Colours for this widget" | `levelColors` |
| "Judge the ranges on column" | `rangeColumn` |
| "Caption columns (comma-separated)" | `captions` |
| "Number size", "Number size in pixels" | `valueSize` |
| "Show change over the period" | `headerDelta` |
| "Roll-up at the right of the title" | `chartCaption` |
| "Average the ends over N days" | `headerDeltaAverageDays` |
| "Line colour", "Bar colour", "Point colour" | `color` |
| "Colour the points by column" | `colorBy` |
| "Draw a trend line through the points" | `trend` |
| "Lowest x value", "Highest x value" | `xMin`, `xMax` |
| "Target column", "Lowest value on the scale", "Highest value on the scale" | `target`, `scaleMin`, `scaleMax` |
| "Scrub line colour" | `guideColor` |
| "Meter under the number" | `meter` |
| "Lowest value", "Highest value", "Let the top grow up to", "Labels at", "Text after each label", "Write thousands as k (8k)" | `yMin`, `yMax`, `yMaxLimit`, `yTicks`, `yTickSuffix`, `yTickCompact` (on the right axis `y2Min` ... `y2TickCompact`) |
| "Unit of the right axis" | `y2Unit` |
| "Label every Nth value along the bottom" | `xLabelEvery` |
| "Guide lines" | `refLines` |
| "Zones" | `zones` |
| "Band" | `band` |
| "Hint by the title" | `hint` |
| "Footnote under the widget" | `footnote` |
| "Series" | `series` |
| "Part colours" | `segmentColors` |
| "Row labels column", "Column labels column", "Cell value column" | `row`, `column`, `value` |
| "Dot column", "Dot colour", "Dot label in the legend" | `marker`, `markerColor`, `markerLabel` |
| "Highlight", "Cells", "Label every Nth column" | `highlight`, `cells`, `columnLabelEvery` |
| "Date column", "Day value column", "Week starts on", "Year" | `date`, `value`, `weekStart`, `year` |
| "The words come from", "Text" | `sql` or `text` |
| "One thin line, like a section divider (no title)" | `line` |

### Every widget

- `viz`: the type. `line`, `bar`, `stat` (one big number), `table`,
  `divider`, `combo`, `scatter`, `bullet`, `segments`, `heatmap`, `calendar` or `text`.
- `title`: the name on top of the widget.
- `unit`: shown with the values, like "orders" or "%".
- `layout`: the widget's place on the grid, `{"x":0,"y":0,"w":2,"h":2}` in
  cells. Edit mode writes it when you drag and resize.
- `hint`: a few words at the right of the title, up to 60 characters.
- `footnote`: a sentence under the widget, up to 300 characters.
  Every type but `divider` takes both.

A widget is either an SQL widget (`sql`, and the column names its type
needs) or a built widget (`source`: the plugin writes the SQL). Only read
queries run: one statement starting with SELECT, WITH, PRAGMA or EXPLAIN,
up to 5,000 rows. The plugin never writes to a database, and it does no
date arithmetic for an SQL widget: a window like "the last 14 days" is
written in the query.

Colours, wherever a setting takes one, are a theme colour such as
`var(--color-green)` or a hex colour such as `#2a7fff`; nothing else is
accepted.

### Built widgets

`"source": { ... }` instead of `sql`, on a line, bar or stat:

- `table`, `metric` (a number column), `agg` (`sum`, `avg`, `min`, `max`,
  `count`, `latest`; `latest` on a stat only).
- `filters`: a list of `{"column", "op", "value"}`; `op` is `eq`, `ne`,
  `contains`, `not_contains`, `gt`, `gte`, `lt`, `lte`, `empty`,
  `not_empty`. All rows must match.
- `series`: one line or bar per value of a column. `groupBy`: what to chart
  over (defaults to the time column). `timeColumn`: the date column.
- `timeframe`: `"global"` follows the header picker; a preset or a from/to
  range is fixed. `database`: a database other than the dashboard's.
- On the widget: `compare` (`none`, `previous`, `last_year`) draws the
  earlier period faintly; `favorable` (`up` or `down`) says which direction
  is good.

### Line and bar charts

`"viz": "line"` or `"bar"`, `x` (the column along the bottom) and `y` (one
column, or a list for several series). `stack: true` stacks a bar chart's
series.

```json
{ "title": "Revenue per day", "viz": "bar", "x": "day", "y": "revenue",
  "sql": "SELECT day, SUM(revenue) AS revenue FROM sales GROUP BY day ORDER BY day",
  "color": "#2a7fff", "yMin": 0, "yTickCompact": true,
  "refLines": [{ "y": 1000, "label": "break-even", "dash": "4 3" }] }
```

- `color`: the line or bars of a one-series chart. `guideColor`: the line
  that follows the pointer (line and combo).
- `headerDelta: true`: the change over the period at the right of the
  title. `chartCaption`: `"range"` (lowest to highest) or `"change"` in
  the same place. `headerDeltaAverageDays` (1 to 365) averages each end.
  One-series line or bar only.

#### Axis (line, bar, combo, scatter)

- `yMin`, `yMax`: a fixed range. `yMaxLimit`: the top starts at `yMax` and
  grows to fit the data, never past this (needs `yMax`).
- `yTicks`: the labels' positions, 1 to 12 rising numbers like `[0, 50, 100]`.
- `yTickSuffix`: up to 6 characters after each label, like "h" or "%".
  `yTickCompact: true` writes 8,000 as 8k.
- `xLabelEvery`: label every Nth value along the bottom (not on a scatter
  chart).
- `xMin`, `xMax`: scatter chart only: the ends of the number scale along the
  bottom.

A value outside a fixed range is drawn at the edge.

#### Guide lines and zones (line, bar, combo, scatter)

- `refLines`: up to 8 `{"y", "color", "dash", "label", "axis"}`: a line
  across the chart. `dash` is a pattern like "4 3"; a `label` names the
  line in the legend.
- `zones`: up to 8 `{"from", "to", "color", "opacity", "axis"}`: a shaded
  band behind the chart; `opacity` defaults to 0.15.
- `axis` (`"left"` or `"right"`) is a combo chart's only. On a scatter chart
  they follow the scale up the side.

On an automatic axis, lines and zones count as data, so a goal above every
value stays in view.

#### Band (SQL line chart)

`"band": {"low": "lo", "high": "hi", "opacity": 0.2}`: the area between two
columns, row by row, under the line, in its colour. The band columns are
not also in `y`.

```json
{ "title": "Order value", "viz": "line", "x": "day", "y": "avg",
  "sql": "SELECT day, AVG(revenue/orders) AS avg, MIN(revenue/orders) AS lo, MAX(revenue/orders) AS hi FROM sales GROUP BY day ORDER BY day",
  "band": { "low": "lo", "high": "hi" },
  "zones": [{ "from": 20, "to": 30, "color": "var(--color-green)" }] }
```

### One big number (stat)

`"viz": "stat"`. An SQL stat shows the first row's `y` column (unset, the
first column); a built stat its one value.

```json
{ "title": "Fulfilled", "viz": "stat", "unit": "%", "valueSize": "fit",
  "sql": "SELECT ROUND(100.0*SUM(orders-returns)/SUM(orders),1) AS pct FROM sales",
  "meter": { "min": 0, "max": 100, "target": 95 } }
```

- `valueSize`: the number's size, 12 to 120 pixels, or `"fit"` to shrink it
  until it shows whole. Unset, the theme decides.
- `meter`: `{"min", "max", "target"}`: a thin bar under the number, filled
  to where it sits, with a mark at the target.
- `captions`: the columns shown as lines under the number (SQL), up to 4;
  unset, the next column.
- `ranges`, `levelColors`, `rangeColumn`: value levels, below.

### Value levels (stat, segments, heatmap, calendar, bullet)

The levels themselves (Good, Watch, Alert by default, each with a colour)
live in the plugin settings, not in the file. A widget lists its own steps:

- `ranges`: up to 12 `{"low", "high", "level", "label"}`. Bounds are
  inclusive and either may be left out; the first range that holds the
  value wins; a range with neither is the catch-all and comes last.
  `label` is the pill's text.
- `levelColors`: a different colour for a level on this widget only,
  like `{"Good": "#2a7fff"}`.
- `rangeColumn`: judge the ranges on another column of the first row
  (SQL stat, and needed on a segments bar).

A range naming a level the settings do not have draws neutral. A dashboard
shared with someone else needs its levels in their settings too, or should
use the three default names.

How a level shows on a widget is a setting too: rail, outline or tint for
"One big number", and the same choice for a segments bar (by default the
same look as "One big number").

### Table

`"viz": "table"`: the query's rows. SQL only.

### Section divider

`"viz": "divider"`: a thin line with an optional heading (`title`). No query;
its `layout` is one row high.

### Combo chart

`"viz": "combo"`: bars and lines over one `x` column, each series on the left
or the right axis. One row per x value; an empty cell is a gap, never zero.

```json
{ "title": "Orders and returns", "viz": "combo", "x": "day", "stack": true,
  "sql": "SELECT day, SUM(CASE WHEN channel='Web' THEN orders END) AS web, SUM(CASE WHEN channel='Shop' THEN orders END) AS shop, ROUND(100.0*SUM(returns)/SUM(orders),1) AS rate FROM sales GROUP BY day ORDER BY day",
  "series": [{ "column": "web", "kind": "bar" }, { "column": "shop", "kind": "bar" },
             { "column": "rate", "kind": "line", "axis": "right", "dash": "4 3" }],
  "y2Unit": "%", "y2TickSuffix": "%" }
```

- `series`: 1 to 8 `{"column", "kind", "axis", "color", "opacity", "dash",
  "connect", "label"}`. `kind` is `"bar"` or `"line"` (default line);
  `axis` `"left"` (default) or `"right"`; `dash` and `connect` (true joins
  a line across empty rows) are a line's only; `label` names the series in
  the legend.
- `stack: true` stacks the bars; they must share one axis.
- The right axis: `y2Min`, `y2Max`, `y2MaxLimit`, `y2Ticks`,
  `y2TickSuffix`, `y2TickCompact`, like their left twins, and `y2Unit`
  for the readout. The left axis, guide lines, zones, `guideColor`,
  `hint` and `footnote` work as on a line chart.
- A combo takes no `y`, `color`, `band`, `headerDelta` or `chartCaption`.

### Scatter chart

`"viz": "scatter"`: one point per row of the query, placed by a number in `x`
(along the bottom) and a number in `y` (up the side). One `y` column.

```json
{ "title": "Orders against ad spend", "viz": "scatter", "x": "spend", "y": "orders",
  "sql": "SELECT ad_spend AS spend, orders, channel FROM sales ORDER BY day",
  "colorBy": "channel", "trend": true, "xMin": 0, "yMin": 0 }
```

- `x`, `y`: number columns. A row with no number in either is left out,
  never drawn at zero.
- `colorBy`: a column whose values colour the points, one colour each: the
  four most common, the rest together as Other, named in the legend.
  Without it the points take `color`, or the theme ink.
- `trend: true`: the least-squares line through all the points, dashed,
  named in the legend; hovering it reads its slope and r squared.
- `xMin`, `xMax`, and the y axis fields, `refLines` and `zones`: as above.
  Hovering a point reads its numbers.

### Bullet chart

`"viz": "bullet"`: for each row, a bar for the actual value against a mark
for its target, on one scale shaded in bands by the value levels.

```json
{ "title": "Sales against target", "viz": "bullet", "x": "channel", "y": "sales", "target": "goal",
  "sql": "SELECT channel, SUM(revenue) AS sales, 1000 AS goal FROM sales GROUP BY channel ORDER BY channel",
  "ranges": [{ "low": 1000, "level": "Good" }, { "low": 600, "level": "Watch" }, { "level": "Alert" }],
  "scaleMax": 1500 }
```

- `y`: the actual value, one number column. `x`: the column that labels each
  bar; left out, the bars have no labels. `target`: the column of targets,
  drawn as a mark; left out, no marks.
- `ranges`, `levelColors`: the bands, each range in its level's colour behind
  the bars. A gap between ranges stays plain; two ranges written for whole
  numbers (79 and 80) read as one band.
- `scaleMin`, `scaleMax`: the ends of the one scale all the bars share. Left
  out, the scale runs from zero (or the lowest value, below zero) up to the
  largest value, target or range end, on a round number. A value past the end
  is drawn at the end.

### Segments bar

`"viz": "segments"`: one bar split into the query's rows, each as wide as its
share. One row per part, in order, up to 12.

```json
{ "title": "Tasks", "viz": "segments", "x": "status", "y": "n",
  "sql": "SELECT status, n FROM tasks ORDER BY ord",
  "segmentColors": { "Done": "var(--color-green)" } }
```

- `x`: the column naming each part. `y`: the one column sizing it.
- `segmentColors`: a colour per part name; a part without one takes the
  theme colours in turn.
- `ranges` (with `rangeColumn`) and `levelColors`: a level pill on the
  title row and the level look on the whole bar.

### Heatmap

`"viz": "heatmap"`: a grid with one cell per row of the query, placed by its
row and column values (in the order the query returns them) and coloured by
the value levels.

```json
{ "title": "Minutes by hour", "viz": "heatmap", "row": "day", "column": "hr", "value": "minutes",
  "sql": "SELECT day, printf('%02d', hour) AS hr, minutes, meeting FROM work ORDER BY day DESC, hour",
  "ranges": [{ "high": 20, "level": "Good" }, { "high": 45, "level": "Watch" }, { "level": "Alert" }],
  "marker": "meeting", "highlight": "hour", "cells": "fill" }
```

- `row`, `column`, `value`: the columns that place and colour each cell.
- `ranges`, `levelColors`: the colours; without ranges every cell is grey.
- `marker`: a column; a cell gets a dot where it is not empty, 0 or false.
  `markerColor`, `markerLabel` (its name in the legend) need a `marker`.
- `highlight`: lights up today on this device: `"hour"` the column named
  for the current hour (0 to 23), `"day"` the row or column named for
  today's date (YYYY-MM-DD), `"weekday"` the row or column named for
  today's weekday (Monday or Mon).
- `cells`: `"square"` for square cells, `"fill"` to stretch the rows over
  the tile's height; unset, thin rows.
- `columnLabelEvery`: label every Nth column.

### Year calendar

`"viz": "calendar"`: one square for each day, a week to a column, coloured by
the value levels. A separate type from the heatmap because it reads one date
column where a heatmap reads a row and a column.

```json
{ "title": "Orders per day", "viz": "calendar", "date": "day", "value": "orders",
  "sql": "SELECT day, SUM(orders) AS orders FROM sales GROUP BY day ORDER BY day",
  "ranges": [{ "low": 40, "level": "Good" }, { "low": 20, "level": "Watch" }, { "level": "Alert" }],
  "weekStart": "monday" }
```

- `date`, `value`: the columns of days (written `2026-01-31`) and numbers. A
  day with no row stays empty; a day twice takes the later row.
- `ranges`, `levelColors`: the colours, as on a heatmap; without ranges every
  day with data is grey.
- `weekStart`: `"sunday"` (the default) or `"monday"`, the day each column of
  weeks starts on.
- `year`: a whole calendar year like `2026`. Left out, the calendar shows the
  last 53 weeks up to the newest day in the data, never "today".

### Text

`"viz": "text"`: plain words. Either `text` (up to 2,000 characters) or `sql`
(the first column of the first row is shown), never both.

```json
{ "viz": "text", "line": true, "text": "Every number here is invented." }
{ "title": "Freshness", "viz": "text", "sql": "SELECT 'Data through ' || MAX(day) FROM sales" }
```

- Plain text, not Markdown: a blank line starts a paragraph, a single line
  break stays; links and bold show as typed.
- `line: true`: one thin strip in a thin row, like a divider, with no title.
- Written text runs no query on any device.
<!-- /field reference -->
<!-- Written by the SQLite Viewer plugin (revision 4, fingerprint 9b3ec7fa). If you edit this file, the plugin stops updating it. -->
