# ReadOut

**Read the databases in your Obsidian vault: browse and query on the desktop, view dashboards on your phone.**

ReadOut opens the SQLite files that live next to your notes: browse the
tables, run your own read-only queries, and keep charts, tables and big
numbers as dashboards you can open again. It is read-only, so it cannot
change your data. Databases up to about a gigabyte open on the desktop. On a
phone, ReadOut is a dashboard viewer (see "On a phone" below).

ReadOut is forked from the
[ICOR for Life SQLite Viewer](https://github.com/myICOR/icor-for-life-sqlite-viewer)
by myICOR, under its MIT licence, and credits its original authors (see
`LICENSE`). It is an independent project: myICOR and Paperless Movement do
not make, support or endorse it.

## What it is for

Notes are for knowledge. Millions of rows are not knowledge, they are data,
and data wants a database.

A health archive, an engagement log, an analytics store, a finance export:
these belong in your vault because they are yours, but they do not belong in
markdown. ReadOut brings the query to the vault instead of dragging the data
out of it.

## Install

ReadOut is in Obsidian's Community plugins list. In Obsidian, go to Settings →
Community plugins. If Restricted mode is on, turn on community plugins. Then
choose Browse, search for "ReadOut", and Install and Enable it.

To install it by hand instead, download `main.js`, `manifest.json` and
`styles.css` from the latest [release](../../releases) and put the three files
in a folder called `readout` inside your vault's plugins folder
(`.obsidian/plugins/readout`). Then turn ReadOut on in Settings, Community
plugins.

## Getting started

Put a `.db` or `.sqlite` file anywhere in your vault and click it. The
browser opens. Nothing is imported, converted or copied: the file stays
exactly where you put it.

A file that has a database name but is not a SQLite database (a Windows
`Thumbs.db`, a text file renamed by hand) says "This file isn't a SQLite
database" instead of showing an engine error.

For dashboards, run the command "Open dashboards" (or press the bar-chart
icon in the ribbon) and create your first one. The edit panel builds a widget
from a table with a few clicks, or you can write the SQL yourself.

## Where it keeps things

- ReadOut finds databases by searching the whole vault for `.db`, `.sqlite`
  and `.sqlite3` files. The setting "Search for databases in" can narrow that
  to the databases folder only. Clicking any database file opens it, and a
  dashboard can name a database anywhere in the vault.
- The databases folder (by default `Databases`, or `07 Databases` in an ICOR for
  Life vault) is where dashboards, exports and any move you choose go.
- A query result can be saved as a CSV file with "Save as CSV": it goes into an
  `Exports` folder inside the database folder, and ReadOut tells you where.
- Dashboards are Markdown notes in the dashboards folder. Each time the desktop
  draws a dashboard with no failed widget, it saves the answers as a note in the
  cache folder, and that is what a phone shows. Both kinds are ordinary notes,
  so default Obsidian Sync carries them. They also appear in search, the graph
  and unlinked mentions. To keep them out, add the cache folder (and, if you
  like, the dashboards folder) under Settings → Files and links → Excluded
  files. Excluded notes are hidden from search, the graph, unlinked mentions
  and the Properties and Tags views, and are only pushed lower in the Quick
  switcher and link suggestions. They still show in the file explorer and
  still sync.
- Earlier versions saved dashboards and the cache as `.json` files. ReadOut
  still reads them, and each time the desktop loads it writes a note beside
  every `.json` that has none. It never changes or deletes the `.json`. Where
  a note and a `.json` share a name, the note is the one that counts, unless
  the cache `.json` is newer. Update ReadOut on every device: a desktop still
  on 1.0.x keeps writing `.json`, which 1.1 devices ignore once a note exists.
- If Obsidian Sync's merge ever breaks a dashboard note, it shows as an error
  at the top of the dashboards view, and Version history or File recovery
  brings back the last good copy.
- The first time ReadOut runs it picks the folders: `Databases`,
  `Databases/Dashboards` and `Databases/Dashboard Cache`. In a vault that has
  the ICOR for Life scaffold it picks the vault's own Databases room
  (`07 Databases`) instead. On a synced phone, where the scaffold's hidden
  folder does not sync, a `07 Databases` folder with no `Databases` folder
  beside it counts too. That choice is only made once, on a fresh install.
  After that, whatever is in Settings wins.
- ReadOut does not open `.json` files by default. Dashboards are notes now, so
  "Open JSON files in the vault" in the settings is only for dashboards that
  are still `.json` files, and for reading other JSON in your vault: with it
  on, clicking a `.json` file opens a dashboard as its dashboard and any other
  JSON in a read-only viewer.

## What you can do

**Browse** tables and rows, with sorting and filtering.

**Query** with SQL when browsing is not enough.

**Chart** a result, and keep the chart as a dashboard you can open again.

**Put a widget in a note.** A code block in any note draws one widget of a
dashboard, read-only. The language word after the three backticks is
`readout`, and the block names the dashboard and the widget.

**On your phone**, see your dashboards, drawn from the answers your desktop
saved the last time it drew them.

## On a phone

(The short version is at the top.) On a phone, ReadOut draws each dashboard
from the answers your desktop saved the last time it drew that dashboard, and
says "Computed on desktop" on the screen. The phone shows the last saved answers: to
refresh them, open the dashboard on the desktop and let Obsidian Sync finish.

Browsing tables and running queries need the database file itself on the
device. Default Obsidian Sync does not carry it: it leaves out other file types,
which includes `.db` and `.sqlite` files, and it has a size limit per file.

The dashboards and the saved answers are notes, so they reach the phone with
default Obsidian Sync settings. You do not need to turn on syncing of other
file types.

## Dashboard files

A dashboard is one Markdown note in the dashboards folder: properties that say
`readout: dashboard`, and the dashboard's JSON in a code block. The reference
below shows a whole note. The edit panel writes it, and every widget type and
setting below can be set there. After editing a note by hand, open it and run
the command "Check this note as a dashboard".

ReadOut can write two guides into the dashboards folder, mirrored here:

- `README.md` ([DASHBOARD-HELP.md](DASHBOARD-HELP.md) in this repository):
  what each widget type shows, what it is good for, and what each of its
  settings in the edit panel does, in the panel's own words.
- [AI-WIDGET-GUIDE.md](AI-WIDGET-GUIDE.md): for AI assistants asked to
  build a widget: the rules, the procedure, the schema, the result
  shapes, and the reference below for the dashboard file.

They are written only when you ask: run the command "Write the guide files",
press the button of the same name in the settings, or press "Create Guide Files
for Your AI Team" on the empty dashboards screen (the one with "Create your
first dashboard"), which also says where the files went and offers to open the
AI guide. Each copy ends with a
fingerprint of its text. A newer version of ReadOut replaces a copy only while
it still matches (nobody has edited it); an edited copy is never
overwritten. Delete a copy and run the command again to get the newest text.

<!-- field reference -->
### The dashboard note

A dashboard is a Markdown note in the dashboards folder, named after its
`id` (`shop.md`). The properties mark it as ReadOut's, and the dashboard is
the JSON in the note's one json code block. Notes are what default Obsidian Sync
carries to a phone; a `.json` file would stay behind.

````markdown
---
readout: dashboard
---

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
````

Anything else in the note, such as a line of your own words above or below
the block, or more properties, is kept and ignored. Below, "the file" means
this JSON.

- `id`: lowercase letters, digits and hyphens. Also names the cache note.
  Renaming the title is safe; the id stays.
- `title`: the dashboard's name.
- `database`: the path of the database inside the vault. Every SQL widget
  reads this one file; a built widget's `source` may name its own.
- `globalTimeframe`: the range the header picker shows. A preset
  (`7d`, `30d`, `90d`, `12m`, `all`) or `{"from":"YYYY-MM-DD","to":"YYYY-MM-DD"}`.
- `tiles`: the widgets, in any order; each one's place is its `layout`.

A note the plugin cannot read is listed at the top of the dashboards view
with a plain sentence naming the widget and the setting. A setting the
plugin does not know is dropped the next time the panel saves the dashboard.

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
| "Sparkline columns (comma-separated)" | `sparklines` |
| "Hint by the title" | `hint` |
| "Footnote under the widget" | `footnote` |
| "Series" | `series` |
| "Part colours" | `segmentColors` |
| "Cut a hole in the middle (a doughnut)" | `doughnut` |
| "Row labels column", "Column labels column", "Cell value column" | `row`, `column`, `value` |
| "Dot column", "Dot colour", "Dot label in the legend" | `marker`, `markerColor`, `markerLabel` |
| "Highlight", "Cells", "Label every Nth column" | `highlight`, `cells`, `columnLabelEvery` |
| "Date column", "Day value column", "Week starts on", "Year" | `date`, `value`, `weekStart`, `year` |
| "The words come from", "Text" | `sql` or `text` |
| "One thin line, like a section divider (no title)" | `line` |

### Every widget

- `viz`: the type. `line`, `bar`, `stat` (one big number), `table`,
  `divider`, `combo`, `scatter`, `bullet`, `segments`, `pie`, `heatmap`, `calendar` or `text`.
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

### Value levels (stat, segments, pie, heatmap, calendar, bullet)

The levels themselves (Good, Watch, Alert by default, each with a colour)
live in the plugin settings, not in the file. A widget lists its own steps:

- `ranges`: up to 12 `{"low", "high", "level", "label"}`. Bounds are
  inclusive and either may be left out; the first range that holds the
  value wins; a range with neither is the catch-all and comes last.
  `label` is the pill's text.
- `levelColors`: a different colour for a level on this widget only,
  like `{"Good": "#2a7fff"}`.
- `rangeColumn`: judge the ranges on another column of the first row
  (SQL stat, and needed on a segments bar or a pie chart).

A range naming a level the settings do not have draws neutral. A dashboard
shared with someone else needs its levels in their settings too, or should
use the three default names.

How a level shows on a widget is a setting too: rail, outline or tint for
"One big number", and the same choice for a segments bar and a pie chart (by
default the same look as "One big number").

### Table

`"viz": "table"`: the query's rows. SQL only.

```json
{ "title": "Orders by channel", "viz": "table", "sparklines": ["trend"],
  "sql": "SELECT channel, SUM(orders) AS orders, group_concat(orders) AS trend FROM (SELECT channel, day, orders FROM sales ORDER BY day) GROUP BY channel" }
```

- `sparklines`: 1 to 8 column names. Each cell of such a column is drawn as a
  tiny line chart, on its own scale from lowest to highest, with a dot on the
  last value. The cell holds the series as numbers separated by commas, oldest
  first (a JSON list like `[3,5,4,8]` also reads); a cell with fewer than two
  numbers shows as the text it is. Read the series from a subquery that has
  its ORDER BY, as above: `group_concat` does not promise an order of its own.

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

### Pie chart

`"viz": "pie"`: a circle split into the query's rows, each slice as big as its
share, clockwise from twelve o'clock. The same columns as a segments bar.

```json
{ "title": "Orders by channel", "viz": "pie", "x": "channel", "y": "orders",
  "sql": "SELECT channel, SUM(orders) AS orders FROM sales GROUP BY channel ORDER BY orders DESC",
  "doughnut": true }
```

- `x`: the column naming each part. `y`: the one column sizing it. Up to 12
  parts; the theme has five series colours, so from the sixth part on they
  share one faint colour. Group small parts in the query.
- `doughnut`: true cuts a hole in the middle and writes the total in it.
- `segmentColors`, `ranges` (with `rangeColumn`) and `levelColors` work as on
  a segments bar.

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
- `weekStart`: `"sunday"` or `"monday"`, the day each column of weeks
  starts on. Left out, the calendar follows the plugin setting "Week starts on"
  (Sunday unless the member changed it), so one choice covers every calendar.
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

## What ReadOut can access, and why

ReadOut makes no network connection and downloads nothing. Obsidian's
community-plugin scan lists a few kinds of access; here is each one, and what
it is for.

- **Looking for databases.** ReadOut scans the whole vault for files ending in
  `.db`, `.sqlite` or `.sqlite3`. It walks the folders from the vault root
  through Obsidian's folder API, skipping the configuration folder, `.git` and
  `.trash`, and looks at file names and sizes only. It reads no note and no
  other file to do this. The setting "Search for databases in" can limit the
  search to the databases folder.
- **Reading and writing inside your vault.** It reads the databases you open,
  read-only. It writes its own files, as ordinary files in your vault: the dashboards you save, the small caches that
  let a phone show them (notes in the cache folder; when you switch on
  "Include category values in the mobile catalog", the catalog note holds
  those values and is searchable like any note), the two guides (`README.md` and
  `AI-WIDGET-GUIDE.md`) in the dashboards folder, and only when you ask, and a
  CSV file when you click "Save as CSV" on a query result (in an `Exports`
  folder inside the database folder). It creates no folder and no file just by
  starting. A database path must be a
  real file inside the vault: a path with `..`, an absolute path, or one inside
  a hidden or configuration folder is refused.
- **The clipboard.** ReadOut does not use the clipboard. A query result is
  saved as a CSV file in your vault ("Save as CSV").
- **Moving a database.** When you open a database that is outside the databases
  folder, ReadOut shows a short note, once for that file, with a "Move" button.
  It moves the file (and its `-wal` and `-shm` files) into the databases folder
  only when you click it, through Obsidian, and never over an existing file. The
  note can be turned off in the settings. Dashboards never show it.
- **No other program and no outside files.** ReadOut starts no program and uses
  no file access outside Obsidian's own vault API. On every device the engine
  is the SQLite build embedded in ReadOut (sql.js, WebAssembly), working on a
  copy of the file in memory. That is why there is a size cap: 1500 MB on a
  desktop, 200 MB on a phone or tablet, and never above 2000 MB (set it under
  "Size cap for the built-in engine" in the settings). While a big file loads
  it needs roughly three times its size in free memory.

## Good to know

- **Databases up to about 2 GB; larger files won't open.** (The default limit is
  1500 MB on a desktop and 200 MB on a phone or tablet; you can raise it to 2000 MB
  in the settings.)
- **Read-only is a design decision, not a limitation to be lifted.** A viewer
  that can write is a viewer that can lose your data.
- **Desktop and mobile**, with the phone reading a cache rather than the whole
  database.
- **One maintainer.** ReadOut is looked after by one person, on a best-effort
  basis.

## Support

Bugs and ideas go to this repository's issues. Please reproduce a problem on a
clean install of the current release before reporting it. Security reports go
through the process in `SECURITY.md`, never a public issue.

## Licence

MIT, see `LICENSE`. Install it, run it, read it, change it, sell it, ship it in
your own product; keep the copyright and licence notice. The code started as
the ICOR for Life SQLite Viewer by myICOR and Paperless Movement, S.L.,
released under the same MIT licence from version 0.6.0; releases before 0.6.0
of that project were published under another licence and are not part of
ReadOut.

The licence covers the code only. "ICOR", "ICOR for Life", "myICOR" and
"Paperless Movement" are trademarks of Paperless Movement, S.L., and ReadOut
claims no connection to them beyond the truthful statement that it is forked
from their SQLite Viewer. See `TRADEMARK.md`.

Contributions are welcome as pull requests under the same MIT terms, with a
DCO sign-off on every commit. See `CONTRIBUTING.md`.

Bundled third-party components keep their own licences; see
`THIRD-PARTY-NOTICES.md`.
