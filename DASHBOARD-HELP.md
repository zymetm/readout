---
title: Dashboards
doc_type: note
status: active
tags:
  - sqlite
  - dashboards
---

# Dashboards: how to use the edit panel

Each JSON file in this folder is one dashboard for the ICOR for Life - SQLite
Viewer plugin. Open them with the "SQLite Viewer: Open dashboards" command or
the chart icon in the ribbon.

This help file explains the edit panel: the window that opens when you add a
widget or press the pencil on one. It goes through every setting, list and
field in the panel, in the panel's own words and in the order the panel
shows them, for every kind of widget. You never need to edit a file by hand;
a short reference for the file itself is at the end, for the curious.

There is a second file in this folder, `AI-WIDGET-GUIDE.md`. It is written
for AI assistants that are asked to build a widget for you. You can ignore
it, or point your assistant at it.

The plugin keeps both files up to date: when a newer version of the plugin
changes this text, it replaces the file, but only while the file is still
exactly as the plugin wrote it. The last line of the file holds a
fingerprint of the text above it; if you change anything, the fingerprint no
longer matches and the plugin leaves your copy alone from then on. To get
the plugin's newest text again, delete the file: the plugin writes a fresh
copy the next time it loads or when you press "New dashboard".

The examples use an invented shop: a `sales` table (day, channel, orders,
revenue, returns), a `work` table (day, hour, minutes, meeting) and a
`tasks` table (ord, status, n).

## Make your first widget

1. Open the dashboards view. With no dashboard yet, press "Create your first
   dashboard"; otherwise press "New dashboard" at the top. Click the
   dashboard's title to rename it.
2. Press "Edit" at the top right (the pencil). The dashboard is now in edit
   mode: the button reads "Done", and an empty "Add widget" tile with a +
   appears.
3. Press the "Add widget" tile. The panel opens with the title "New widget".
   The fields are on the left, the "Preview" on the right.
4. Pick the "Database", then the "Table", for example `sales`.
5. Pick the "Value": the number column to measure, for example `orders`, or
   "Count rows" to count.
6. Check the "Date" the panel guessed (it looks for a column like `day`).
7. Leave "Add it up" on "Add up", type a "Widget name" such as "Orders per
   day", and keep "Chart type" on "Line chart".
8. Watch the Preview. When it has drawn, the note under it says "The
   preview ran. Save is open." Press "Add widget".
9. In edit mode, drag a widget to move it and drag its bottom-right corner to
   resize it. The bin on a widget ("Remove this widget") removes it, after
   asking "Remove this widget?". Press "Done" when you are finished.

To change a widget later: press "Edit", then the pencil on the widget ("Edit
this widget"). The panel opens with the title "Edit widget", filled in with
the widget's settings, and the button at the bottom reads "Save widget".
"Cancel" closes the panel without saving.

## The dashboard around the widgets

- **"New dashboard"** makes an empty dashboard file in this folder.
- **"Refresh"** reads the dashboard files again and runs every widget's
  query again.
- **The dashboard list** at the top picks which dashboard to show.
- **The title**: click it to rename the dashboard. The file keeps its name.
- **"Range"**: the time range for the whole dashboard. Choices: "Last 7
  days", "Last 30 days", "Last 90 days" (the default), "Last 12 months",
  "All time", or "Custom range" (pick a "From date" and a "To date", then
  press "Apply"). It applies to widgets made with the panel's own fields
  whose "Time frame" is "Follow the dashboard". A widget written in SQL
  sets its own period in its query.
- **"Edit"** turns edit mode on; **"Done"** turns it off.
- **"Open as text"** (in edit mode) opens the dashboard file as text inside
  Obsidian. A line under the text says either "The dashboard reads fine: 3
  widgets." or "The dashboard will not open like this:" followed by the
  reason. "Done editing" saves and goes back to the dashboard. The same
  "Open as text" is in the view's "More options" menu and in the file's
  menu.

## How the panel works

- **"Preview"**: the right side of the panel draws the widget as you go.
  After each change it runs again; the note under it says "The preview runs
  after each change; a widget saves only after its preview worked.", then
  "Running the preview …", then either "The preview ran. Save is open." or
  the reason it could not draw, in plain words. "Add widget" and "Save
  widget" stay greyed out until the preview has worked, so a broken widget
  cannot be saved.
- If the query runs but finds nothing, the preview says "The query ran but
  returned no rows. Check the filters and the period."
- **"(required)"** after a label means the widget needs it. **"(optional)"**
  means you can leave it empty.
- **Groups**: some settings sit in a group with a ▸ in front of its name,
  like "Axis" or "Hint and footnote". Click the name to open it (▾) or close
  it. A group opens by itself when the widget already uses something in it.
- **Column lists**: once the preview has run, a field that asks for a column
  of your query becomes a list of the query's columns, starting with "Pick
  a column". Before that, you type the column name. A name that is not in
  the query's result stays in the list with "(not in the result)" after it,
  so nothing is lost while you change the query.
- **Lists of rows** (filters, guide lines, zones, series, part colours, value
  ranges) each have a "+ Add ..." button under them and an x at the end of
  each row to remove it.
- **The type-change warning**: when you edit a widget and pick another
  "Chart type", some settings may not fit the new type (a line chart has no
  value levels, for example). Under the preview the panel then says:
  "Saving as a line chart leaves out what this widget had: ranges.
  Change the type back to keep them." The names in that list are the settings' names in the
  file (the table at the end translates them). Change the type back before
  saving and nothing is lost. If you emptied a field yourself, it says
  "Saving leaves out what this widget had:" and the names.

### Colours

Every colour setting offers the same choices:

- **"Theme default"**: the colour your theme gives it. This is the default.
  (A zone's colour starts at Green and must have a colour; its empty choice
  reads "Pick a colour". A part colour's empty choice reads "Theme colour".)
- **"Green (theme)", "Amber (theme)", "Red (theme)", "Yellow (theme)", "Cyan
  (theme)", "Blue (theme)", "Purple (theme)", "Pink (theme)"**: your
  theme's own colours, so they follow light and dark mode. (In a row of
  fields they read "Green", "Amber", "Red", "Yellow", "Cyan", "Blue",
  "Purple", "Pink".)
- **"Custom colour"**: a colour picker appears next to the list; pick any
  colour.
- **"From your CSS: ..."** shows when a widget already uses a colour from your
  own CSS snippet. It is kept until you pick another.

## A widget made with the panel's fields

This is what the panel shows for a new widget. You pick from your data and
the plugin writes the query for you. It makes a line chart, a bar chart or
one big number. For other kinds, use the three buttons at the top.

- **"Add a section divider instead"**: switches the panel to a section divider
  (see "Section divider" below). Only on a new widget.
- **"Add text instead"**: switches the panel to a text widget (see "Text"
  below). Only on a new widget.
- **"Write SQL instead"**: switches the panel to a widget written in SQL,
  which can draw every kind of widget (see "A widget written in SQL"). Only
  on a new widget.
- **"Database"** (required): the database file in your vault. *Tip:* picking
  another database empties the fields below it.
- **"Table"** (required): the table to read, with its number of columns
  shown beside it.
- **"Value"** (required): what to measure. Choices: "Count rows" (how many
  rows match), or any number column of the table, under "Numbers".
- **"Date"** (optional): which column holds the time. "None" means no time
  axis (fine for one big number). *Default:* the panel guesses a date-like
  column. A chart needs a date or a "Group by".
- **"Dimension"** (optional): splits the chart into one line or bar per value
  of a text column, like one line per channel. Choices: "No split" (the
  default) or "By" a column. A widget with a dimension cannot compare
  periods or be one big number.
- **"Group by"** (optional): what the chart runs along. "The date" (the
  default: one point per day, week or month), or "By" any column, like one
  bar per channel.
- **"Filter data"** (optional): keep only some rows. Press "+ Add filter";
  each row has a column, a condition and a value. Conditions: "is", "is
  not", "contains", "does not contain", "greater than", "at least", "less
  than", "at most", "is empty", "is not empty" (the last two need no
  value). For a text column with "is", the value is a list of the values in
  the table (the first 200). With two or more rows the panel notes "All
  filter rows must match (AND)." *Example:* channel is Web.
- **"Add it up"**: how the rows become one number per point. Choices: "Add
  up" (the default), "Average", "Lowest", "Highest", "Count rows", "Latest
  value" (the newest value; this makes the widget one big number).
- **"Compare with"** (optional, shows when there is a "Date" and no
  "Dimension"): draws an earlier period faintly behind this one. Choices:
  "No comparison" (the default), "Previous period", "Same period last
  year".
- **"Good direction"** (shows once "Compare with" is set): which way counts
  as good, for the change badge. Choices: "Up is good" (the default), "Down
  is good (weight, resting heart rate)". *Example:* returns going down is
  good.
- **"Widget name"**: the title on top of the widget. Left empty, the panel
  suggests one from your choices.
- **"Chart type"**: "Line chart" (the default), "Bar chart", "One big
  number", or "Section divider". With "Latest value" only "One big number"
  is offered.
- **"Stack the series on top of each other"** (a bar chart with a
  "Dimension"): stacks the bars instead of setting them side by side.

Then, depending on the chart type, the settings described in "Settings
that several types share" below: "Value levels" (one big number); "Show
change over the period", "Roll-up at the right of the title" and "Average
the ends over N days" (a line or bar chart without a dimension); "Number
size" (one big number); "Line colour", "Bar colour" and "Scrub line colour";
and the groups "Meter under the number", "Axis", "Guide lines and zones"
and "Hint and footnote". After those:

- **"Size"**: the widget's size on the grid. Choices: "Small (a square)",
  "Medium" (the default for a new widget, 2 by 2 cells), "Wide", "Large".
  When editing, "Keep as is" (the default) leaves the size alone. You can
  also resize by dragging in edit mode.
- **"Time frame"**: "Follow the dashboard" (the default: the dashboard's
  "Range") or a fixed period: "Last 7 days", "Last 30 days", "Last 90
  days", "Last 12 months", "All time". The period counts back from the
  newest row in the table, not from today, so a table that is a few days
  behind still fills the chart.
- **"Unit"** (optional): shown with the values, like orders or %.
- **"Advanced"**: shows the query the widget runs, read-only, with "Edit as
  SQL". That button turns the widget into a widget written in SQL. It is a
  one-way door: it asks "Edit as SQL?" first, because the fields above go
  away for this widget and cannot be brought back; the SQL stays editable.
  Nothing happens to your data. A widget with a "Dimension" cannot convert;
  remove the dimension first.

## A widget written in SQL

Press "Write SQL instead" on a new widget. The panel says: "This widget is
written in SQL. It runs read-only: one statement, starting with SELECT,
WITH, PRAGMA or EXPLAIN." A widget written in SQL reads the dashboard's
database and has no "Time frame": write any period into the query itself.

- **"Widget name"**: the title on top of the widget. Empty, it reads "SQL
  widget".
- **"SQL"** (required): the query. Each change runs the preview again.
  *Example:* `SELECT day, SUM(orders) AS orders FROM sales GROUP BY day
  ORDER BY day`.
- **"Chart type"**: "Line chart" (the default), "Bar chart", "Bars and lines
  (combo)", "One big number", "Table", "Part-to-whole bar (segments)",
  "Heatmap", "Text" or "Section divider". The last two switch the panel to
  their own form.

Then the fields of the type you picked:

### Line chart and bar chart

- **"X column"**: the column along the bottom, usually a date. The rows
  are drawn in the order the query returns them, so end the query with
  ORDER BY on this column.
- **"Y columns (comma-separated)"**: the number column, or several separated
  by commas for several lines or bars. *Example:* `orders, returns`.
- **"Stack the bars on top of each other"** (a bar chart with two or more Y
  columns): stacks them instead of side by side.
- **"Unit"** (optional): shown with the values. *Placeholder:* "kg, steps,
  kcal …".
- With one Y column: "Show change over the period", "Roll-up at the right
  of the title", "Average the ends over N days", "Line colour" or "Bar
  colour". A line chart also has "Scrub line colour".
- Groups: "Axis", "Guide lines and zones", "Band" (a line chart), "Hint and
  footnote". Then "Size".

### Bars and lines (combo)

The panel says: "Bars and lines over one x column, each series on the left
or the right axis. One row per series, drawn in this order; the legend
shows when there are two or more."

- **"X column"**: the column along the bottom.
- **"Series"** (required): one row per series, up to 8, added with
  "+ Add series". Each row (named "Series 1", "Series 2" ...) has:
  - "column": the query column it draws.
  - "drawn as": "Bars" or "Line". The first row starts as Bars, the next
    ones as Line.
  - "axis": "Left axis" (the default) or "Right axis". Put a percentage on
    the right when the bars are counts.
  - "colour": see Colours.
  - "name in the legend": the series' name in the legend. *Placeholder:*
    "legend name (optional)"; empty, the column name.
  - "opacity": how see-through, from 0 to 1. *Placeholder:* "opacity 1"
    (solid).
  - "dash" (a line only): "solid, or like 4 3" (4 units drawn, 3 left out).
  - "join across empty rows" (a line only): tick it to draw the line across
    rows where the value is missing; otherwise the line has a gap.
- **"Stack the bars on top of each other"** (two or more bar series): stacks
  them. Stacked bars must share one axis.
- **"Unit"** (optional), then "Scrub line colour".
- Groups: "Left axis", "Right axis", "Guide lines and zones", "Hint and
  footnote". Then "Size".

### One big number

- **"Unit"** (optional): shown with the number.
- **"Value levels"**: colour the number by where it lands (see below).
- **"Value column"** (optional): which column of the first row is the number.
  *Default:* "The first column".
- **"Judge the ranges on column"** (optional): judge the value levels on
  another column of the first row, for example a score, while showing the
  number. *Placeholder:* "empty: the shown value".
- **"Caption columns (comma-separated)"** (optional): up to 4 columns shown
  as small lines under the number. *Placeholder:* "empty: the next column".
  *Tip:* with a single caption, leave this empty; the next column is used
  and it may wrap onto two lines.
- **"Number size"** (optional): "Theme default" (the default), "Small (24
  px)", "Medium (34 px)", "Large (48 px)", "Extra large (64 px)", "Shrink
  to fit" (makes the number smaller until it shows whole), or "Custom",
  which adds **"Number size in pixels"**: a whole number from "12 to 120".
- Groups: "Meter under the number", "Hint and footnote". Then "Size".

### Table

The query's rows as a table. Fields: "Unit" (optional), the group "Hint and
footnote", and "Size".

### Part-to-whole bar (segments)

The panel says: "One bar split into the query’s rows, each part as wide as
its share of the total, in the order of the rows."

- **"Part name column"**: the column that names each part, like status.
- **"Part size column"**: the number column that sizes each part.
- **"Unit"** (optional).
- **"Value levels"**: "Mark the whole bar, and show a pill, by where the
  judged value lands." (see below).
- **"Judge the ranges on column"** (optional): the column the value levels
  judge. Its first choice reads "None (needed when there are ranges)": a
  segments bar with ranges must name this column.
- **"Part colours"** (optional): "A colour for a part, by its name exactly
  as the query writes it. A part without one takes the theme colours in
  turn." Each row has "part name" and "colour". "+ Add part colour" adds one
  row; "+ A row for each part in the preview" adds a row for every part the
  preview found that has none yet. Up to 12.
- Group: "Hint and footnote". Then "Size".

### Heatmap

The panel says: "A grid with one cell per row of the query, placed by its
row and column values and coloured by the value levels below. Rows and
columns appear in the order the query returns them."

- **"Row labels column"**: the column that names each row of the grid, like
  day.
- **"Column labels column"**: the column that names each column of the grid,
  like hour.
- **"Cell value column"**: the number that colours the cell.
- **"Unit"** (optional).
- **"Value levels"**: "Colour each cell by where its value lands." Without
  ranges every cell is grey.
- **"Dots, highlight, cells and labels"** (a group):
  - **"Dot column"** (optional): "A cell gets a dot where this column is not
    empty, 0 or false." "No dots" is the default. *Example:* a meeting
    column puts a dot on hours with a meeting.
  - **"Dot colour"** (shows with a dot column): see Colours.
  - **"Dot label in the legend"** (optional): the dot's name in the legend.
    *Placeholder:* "empty: the column name".
  - **"Highlight"** (optional): lights up the present moment on this device.
    Choices: "None" (the default), "The current hour’s column (columns
    named 0 to 23)", "Today’s row or column (named like 2026-01-31)",
    "Today’s weekday (named like Monday or Mon)".
  - **"Cells"** (optional): "Thin rows (default)", "Square", "Fill the
    tile’s height".
  - **"Label every Nth column"** (optional): a whole number; 3 labels every
    third column. *Placeholder:* "empty: every column".
- Group: "Hint and footnote". Then "Size".

## Text

From "Add text instead", or "Text" in a chart type list.

- **"Widget type"**: "Text", "Section divider", or "A widget with data" (back
  to the data form).
- The panel says: "Plain words on the dashboard, written here or taken from
  the first column of a query’s first row. Plain text, not Markdown: a blank
  line starts a paragraph." Links, bold and headings show exactly as typed.
- **"The words come from"**: "Written here" (the default) or "A query (its
  first column, first row)".
- **"Text"** (required, when written here): the words, up to 2,000
  characters. Written text runs no query on any device.
- **"SQL"** (required, from a query). *Example:* `SELECT 'Data through ' ||
  MAX(day) FROM sales`.
- **"One thin line, like a section divider (no title)"**: tick it for one
  slim strip of text in a thin row, like a note under a heading.
- **"Title"** (optional, not on a thin line). *Placeholder:* "no title".
- Group: "Hint and footnote".
- **"Width"** (a thin line): "Full width" (the default for a new one),
  "Half", "A third", "One cell"; when editing also "Keep as is". Or
  **"Size"** (a card): as above.

## Section divider

From "Add a section divider instead", or "Section divider" in a chart type
list. The panel says: "A thin line across the dashboard that separates
groups of widgets, with an optional heading. In edit mode, drag its right
end to change its width."

- **"Widget type"**: "Section divider", "Text", or "A widget with data".
- **"Heading"** (optional). *Placeholder:* "Body, Sleep, Activity …";
  *example:* Sales.
- **"Width"**: "Full width" (the default for a new one), "Half", "A third",
  "One cell"; when editing also "Keep as is".

## Settings that several types share

### Value levels (one big number, segments, heatmap)

**"Value levels"** (optional) colour a widget by where its number lands, for
example green for good, amber to watch, red for an alert. The panel says:
"Colour the number by where it lands. The first range that holds it wins;
leave low or high empty for no limit. The levels and their colours live in
the plugin settings."

The levels themselves (their names and colours) live in the plugin settings,
under "Value levels", not in the dashboard. They start as Good, Watch and
Alert. A dashboard shared with someone else needs its levels in their
settings too, or should use those three default names; a range that names a
level their settings do not have draws neutral. With no levels set up, the
panel says "No levels are set up yet. Add them in the plugin settings
first."

Each range (named "Range 1", "Range 2" ...) is one row:

- "from": the lowest value, "lowest value (empty for no limit)".
- "to": the highest value, "highest value (empty for no limit)". Both ends
  count as inside the range.
- "level": one of the levels from the settings. A level the settings no
  longer have shows "(not in settings)" after its name.
- "pill text (optional)": "short text shown as a pill (optional)" next to the
  title, like "on track".

Buttons: **"+ Add range"** adds a row (before the catch-all, if there is
one). **"+ Anything else"** adds a last range with no limits that catches
every other number; it must stay last.

*Example:* 0 to 50 Good, 51 to 80 Watch, Anything else Alert.

**"Colours for this widget"**: one row per level with a list: "Settings
colour" (the default), the theme colours, or "Custom colour". This changes a
level's colour on this widget only; the level keeps its name. A changed
level reads "(changed)", the box says "Changed for this widget", and
"Reset to settings" puts every level back to the settings colour.

In the plugin settings, under "Value levels": each "Level 1", "Level 2" ...
has a name, a colour and a bin to remove it; "Add a level" adds one; "Back to
Good, Watch, Alert" restores the three defaults. Renaming a level updates
every widget that uses it, in every dashboard. "How a level shows on "One
big number"" picks the mark: "Coloured left rail" (the default), "Coloured
outline" or "Tinted background". "How a level shows on a segments bar" has
the same choices plus "Same as "One big number"" (the default).

### Change and roll-up (a line or bar chart with one series)

- **"Show change over the period"**: a tick box. Puts the change from the
  first to the last point at the right of the title, as a small badge.
- **"Roll-up at the right of the title"** (optional): "None" (the default),
  "Lowest to highest" (the range of the values), or "Change over the
  period".
- **"Average the ends over N days"** (optional, shows with a change): a whole
  number of days, 1 to 365. The change then compares the average of the
  first N days with the average of the last N days, so one odd day does not
  swing it. Needs dates along the bottom. *Placeholder:* "empty: first and
  last point".

### Line, bar and scrub line colour

- **"Line colour"** (a line chart with one series) or **"Bar colour"** (a bar
  chart with one series): see Colours. *Default:* "Theme default".
- **"Scrub line colour"** (a line chart or a combo): the thin vertical line
  that follows your pointer across the chart.

### Meter under the number (one big number)

A group. The panel says: "A bar under the number, filled to where it sits
between the lowest and the highest value. The target draws a mark."

- **"Lowest value"**: where the bar starts. *Placeholder:* "like 0".
- **"Highest value"**: where the bar is full. *Placeholder:* "like 100".
- **"Target"** (optional): a mark on the bar. *Example:* 0, 100 and a target
  of 95 for a percentage.

Give both the lowest and the highest value, or clear all three fields.

### Axis (line, bar), Left axis and Right axis (combo)

A group, called "Axis" on a line or bar chart and "Left axis" on a combo. A
combo also has "Right axis" with the same fields for its right side. Every
field is optional; empty means automatic.

- **"Lowest value"**: the bottom of the scale. *Placeholder:* "automatic".
  *Tip:* 0 keeps bars honest.
- **"Highest value"**: the top of the scale. *Placeholder:* "automatic".
- **"Let the top grow up to"**: with a highest value set, the top starts
  there and grows to fit bigger values, but never past this number.
  *Placeholder:* "empty: the top stays at the highest value".
- **"Labels at"**: where the scale labels sit, as numbers separated by
  commas, rising, 1 to 12 of them. *Placeholder:* "automatic, or like 0, 50,
  100".
- **"Text after each label"**: up to 6 characters, like "h" or "%".
  *Placeholder:* "like h or %".
- **"Write thousands as k (8k)"**: a tick box; 8,000 shows as 8k.
- **"Label every Nth value along the bottom"** (not on the right axis): a
  whole number; 7 labels every seventh day. *Placeholder:* "empty: as many
  as fit".
- **"Unit of the right axis"** (the right axis only): the unit the right
  side's values carry in the readout. *Placeholder:* "like kcal or %".

A value outside a fixed scale is drawn at the edge.

### Guide lines and zones (line, bar, combo)

A group.

- **"Guide lines"** (optional): "A line across the chart at one value. A
  label names it in the legend." Up to 8, added with "+ Add guide line".
  Each row ("Guide line 1" ...) has "value" (where it crosses; placeholder
  "at"; required), "label" ("label (optional)"), "colour", and "dash"
  ("solid, or like 4 3"). On a combo also "axis": "Left axis" or "Right
  axis". *Example:* a dashed line at 1000 labelled break-even.
- **"Zones"** (optional): "A shaded band behind the chart, from one value to
  another." Up to 8, added with "+ Add zone". Each row ("Zone 1" ...) has
  "from" and "to" (both required), "colour" (required, starts at Green),
  and "opacity" (from 0 to 1; placeholder "opacity 0.15", the default). On
  a combo also "axis". *Example:* a green zone from 20 to 30 for a target
  band.

A row left completely empty is skipped. On an automatic scale, guide lines
and zones count as data, so a goal above every value stays in view.

### Band (a line chart written in SQL)

A group. The panel says: "A shaded area between two columns of the query,
like a low and a high per day, drawn under the line in its colour."

- **"Low edge column"**: the column for the bottom edge.
- **"High edge column"**: the column for the top edge. Pick both, or
  neither.
- **"Band opacity"** (optional): from 0 to 1. *Placeholder:* "0.2", the
  default.

*Example:* the lowest and highest order value per day, around the average.

### Hint and footnote (every type except a section divider)

A group.

- **"Hint by the title"** (optional): a few words at the right of the title,
  "a few words, up to 60 characters". *Example:* per day.
- **"Footnote under the widget"** (optional): small text under the widget, "a
  sentence, up to 300 characters". *Example:* Web orders only.

## Phones and tablets

When a dashboard renders on the desktop without an error, its results are
saved under the cache folder and synced like any note. A device that cannot
open the database itself shows the cached results, with a line saying when
they were computed. Small databases render live everywhere.

## Appendix: the dashboard file

You do not need this to use the panel. It describes what the panel writes,
for reading a file with "Open as text" or sharing one.

<!-- field reference -->
## The file

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

## Panel label to file setting

| Panel label | In the file |
| --- | --- |
| "Widget name", "Title", "Heading" | `title` |
| "Chart type", "Widget type" | `viz` |
| "Unit" | `unit` |
| "Size", "Width" | `layout` |
| "SQL" | `sql` |
| "X column", "Part name column" | `x` |
| "Y columns (comma-separated)", "Value column", "Part size column" | `y` |
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
| "Line colour", "Bar colour" | `color` |
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
| "The words come from", "Text" | `sql` or `text` |
| "One thin line, like a section divider (no title)" | `line` |

## Every widget

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

## Built widgets

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

## Line and bar charts

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

### Axis (line, bar, combo)

- `yMin`, `yMax`: a fixed range. `yMaxLimit`: the top starts at `yMax` and
  grows to fit the data, never past this (needs `yMax`).
- `yTicks`: the labels' positions, 1 to 12 rising numbers like `[0, 50, 100]`.
- `yTickSuffix`: up to 6 characters after each label, like "h" or "%".
  `yTickCompact: true` writes 8,000 as 8k.
- `xLabelEvery`: label every Nth value along the bottom.

A value outside a fixed range is drawn at the edge.

### Guide lines and zones (line, bar, combo)

- `refLines`: up to 8 `{"y", "color", "dash", "label", "axis"}`: a line
  across the chart. `dash` is a pattern like "4 3"; a `label` names the
  line in the legend.
- `zones`: up to 8 `{"from", "to", "color", "opacity", "axis"}`: a shaded
  band behind the chart; `opacity` defaults to 0.15.
- `axis` (`"left"` or `"right"`) is a combo chart's only.

On an automatic axis, lines and zones count as data, so a goal above every
value stays in view.

### Band (SQL line chart)

`"band": {"low": "lo", "high": "hi", "opacity": 0.2}`: the area between two
columns, row by row, under the line, in its colour. The band columns are
not also in `y`.

```json
{ "title": "Order value", "viz": "line", "x": "day", "y": "avg",
  "sql": "SELECT day, AVG(revenue/orders) AS avg, MIN(revenue/orders) AS lo, MAX(revenue/orders) AS hi FROM sales GROUP BY day ORDER BY day",
  "band": { "low": "lo", "high": "hi" },
  "zones": [{ "from": 20, "to": 30, "color": "var(--color-green)" }] }
```

## One big number (stat)

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

## Value levels (stat, segments, heatmap)

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

## Table

`"viz": "table"`: the query's rows. SQL only.

## Section divider

`"viz": "divider"`: a thin line with an optional heading (`title`). No query;
its `layout` is one row high.

## Combo chart

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

## Segments bar

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

## Heatmap

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

## Text

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
<!-- Written by the SQLite Viewer plugin (fingerprint 222cc051). If you edit this file, the plugin stops updating it. -->
