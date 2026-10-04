# ICOR for Life - SQLite Viewer

**Read the databases in your vault, on any device.**

Open, browse and chart SQLite files that live next to your notes. Read-only.
A multi-gigabyte database answers in milliseconds on the desktop, and your
phone shows the same dashboards.

Made by [myICOR](https://myicor.com). Part of the ICOR for Life suite, and
useful in any vault that keeps SQLite files.

## What it is for

Notes are for knowledge. Millions of rows are not knowledge, they are data,
and data wants a database.

An Apple Health archive, an engagement log, an analytics store: these belong
in your vault because they are yours, but they do not belong in markdown.
This brings the query to the vault instead of dragging the data out of it.

## Getting started

Put a `.db` or `.sqlite` file anywhere in your vault and click it. The viewer
opens.

Nothing is imported, converted or copied. The file stays exactly where you
put it.

## What you can do

**Browse** tables and rows, with sorting and filtering.

**Query** with SQL when browsing is not enough.

**Chart** a result, and keep the chart as a dashboard you can open again.

**On your phone**, see the same dashboards from a synced cache, so a database
too large to sync still shows you its answers.

## Dashboard files

A dashboard is one JSON file in the dashboards folder. The edit form
writes it, and every widget type and setting below can be set there; the
same reference is written into the folder as its README.md.

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
plugin does not know is dropped the next time the form saves the file.

### Every widget

- `viz`: the type. `line`, `bar`, `stat` (one big number), `table`,
  `divider`, `combo`, `segments`, `heatmap` or `text`.
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

#### Axis (line, bar, combo)

- `yMin`, `yMax`: a fixed range. `yMaxLimit`: the top starts at `yMax` and
  grows to fit the data, never past this (needs `yMax`).
- `yTicks`: the labels' positions, 1 to 12 rising numbers like `[0, 50, 100]`.
- `yTickSuffix`: up to 6 characters after each label, like "h" or "%".
  `yTickCompact: true` writes 8,000 as 8k.
- `xLabelEvery`: label every Nth value along the bottom.

A value outside a fixed range is drawn at the edge.

#### Guide lines and zones (line, bar, combo)

- `refLines`: up to 8 `{"y", "color", "dash", "label", "axis"}`: a line
  across the chart. `dash` is a pattern like "4 3"; a `label` names the
  line in the legend.
- `zones`: up to 8 `{"from", "to", "color", "opacity", "axis"}`: a shaded
  band behind the chart; `opacity` defaults to 0.15.
- `axis` (`"left"` or `"right"`) is a combo chart's only.

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
- `captions`: the columns shown as lines under the number (SQL); unset, the
  next column.
- `ranges`, `levelColors`, `rangeColumn`: value levels, below.

### Value levels (stat, segments, heatmap)

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

## What it touches

- **Reads database files in your vault.** Read-only, always. It never writes
  to your databases, and it cannot alter your data.
- **Writes the dashboards you save**, as ordinary files in your vault.

**It makes no network connection and starts no process.**

## Good to know

- **Read-only is a design decision, not a limitation to be lifted.** A viewer
  that can write is a viewer that can lose your data.
- **Desktop and mobile**, with the phone reading a cache rather than the whole
  database.
- **Beta.** In daily use in a real vault; rough edges likely. Open an issue.

## Support

What myICOR supports: the plugin as published in a tagged release, on the
current version, installed from that release. Bugs go to this repo's issues,
security reports to the process in `SECURITY.md`.

What the community maintains: anything marked community-maintained, including
community source adapters. We review it before it is merged. We do not support
it, we cannot promise it keeps working, and it can be disabled or removed in
any release.

What is yours: your own changes, your fork, your local patch. Please reproduce
the problem on a clean install of the current release before reporting it.

## Licence

MIT, see `LICENSE`. Install it, run it, read it, change it, sell it, ship it in
your own product; keep the copyright and licence notice.
Releases before 0.6.0 stay under the ICOR for Life
Source-Available License (Code) v1.0 they were published with.

The licence covers the code only. "ICOR", "ICOR for Life", "myICOR" and
"Paperless Movement" are trademarks of Paperless Movement, S.L.; a fork needs
its own plugin id and name. See `TRADEMARK.md`.

Contributions are welcome as pull requests under the same MIT terms, with a
DCO sign-off on every commit. See `CONTRIBUTING.md`.

Bundled third-party components keep their own licences; see
`THIRD-PARTY-NOTICES.md`.
