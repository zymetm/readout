# ReadOut

**Read the SQLite databases in your Obsidian vault: browse and query on the desktop, build and view dashboards on your desktop and phone.**

- Browse tables and rows, with sorting and filtering.
- Run your own read-only SQL queries and save results as CSV.
- Build dashboards of charts, tables and big numbers, viewable on desktop or phone.

ReadOut is a fork of the
[ICOR for Life SQLite Viewer](https://github.com/myICOR/icor-for-life-sqlite-viewer)
by myICOR, used under its MIT licence. It is an independent project, not made,
supported or endorsed by myICOR or Paperless Movement.

## Install

From Obsidian:

1. Open Settings → Community plugins. If Restricted mode is on, turn on community plugins.
2. Choose Browse and search for "ReadOut".
3. Select Install, then Enable.

By hand:

1. Download `main.js`, `manifest.json` and `styles.css` from the latest
   [release](https://github.com/zymetm/readout/releases).
2. Put the three files in `.obsidian/plugins/readout` in your vault.
3. Enable ReadOut in Settings → Community plugins.

## Quick start

1. Put your `.db`, `.sqlite` or `.sqlite3` files in the databases folder:
   `Databases`, or `07 Databases` in an ICOR for Life vault. Create the folder
   yourself, or ReadOut creates it the first time it saves something there.
2. Click a database file to open it in the database browser. It has three tabs:
   "Data", "Schema" and "SQL console".
3. To build a dashboard, run the command "Open dashboards" or select the
   bar-chart icon in the left ribbon, then select "Create your first dashboard".

ReadOut also finds database files anywhere else in the vault. When you open one
that is outside the databases folder, it offers to move it there (see
[Moving a database](https://github.com/zymetm/readout#moving-a-database)).

Other commands:

| Command | What it does |
| --- | --- |
| "List databases" | Lists every database ReadOut found. |
| "Open database browser" | Opens the browser without a file. |
| "Create new dashboard" | Creates an empty dashboard and opens it. |
| "Write the guide files" | Writes the two guide files (see [Reference](https://github.com/zymetm/readout#reference)). |
| "Check this note as a dashboard" | Checks the open note after you edit a dashboard by hand. |

## Dashboards

Each dashboard is one Markdown note in the dashboards folder. Opening the note
shows the dashboard. The note holds the dashboard as JSON in a code block; the
[AI widget guide](https://github.com/zymetm/readout/blob/main/AI-WIDGET-GUIDE.md)
documents the format.

**Editing.** Select "Edit" to move, resize, add or change widgets, or "Open as
text" to edit the note directly. "Done" leaves edit mode.

**The widget form.** Build a widget from a table by picking a value, a date
and filters, or select "Write SQL instead" to write the query yourself. A built
widget can be turned into SQL later with "Edit as SQL" under "Advanced". This
cannot be undone for that widget.

**A widget in a note.** A `readout` code block in any note draws one widget.
Name the dashboard (its note's file name without `.md`) and the widget (its
title, or its number counting from 1, dividers included):

````markdown
```readout
dashboard: health-overview
widget: Heart rate
```
````

Or write one widget out as JSON, with the database path:

````markdown
```readout
{ "database": "Databases/shop.db", "viz": "bar", "x": "day", "y": "orders", "sql": "SELECT day, SUM(orders) AS orders FROM sales GROUP BY day ORDER BY day" }
```
````

**Related settings and menus:**

- "Open dashboard notes as dashboards": turn it off to open dashboard notes as
  plain notes. With it on, use "Open as note" in the file menu to see the note.
- "Draw widgets written in notes": turn it off to show `readout` blocks as plain code.
- Right-click a folder and choose "New dashboard" to create one from the file explorer.

**A broken dashboard note** shows its error at the top of the dashboards view.
Restore the last good copy with Obsidian's Version history or File recovery.

## On a phone

ReadOut works on phones and tablets, but it usually has no database to read
there. Obsidian Sync does not carry `.db` or `.sqlite` files with its default
settings, and it has a size limit per file. Dashboards reach the phone this way:

1. Each time the desktop draws a dashboard live with no failed widget, it saves the
   answers as a cache note.
2. Obsidian Sync carries the dashboard notes and the cache notes to the phone
   with its default settings.
3. The phone draws each dashboard from those saved answers and shows
   "Computed on desktop" with how long ago that was.

What this means in practice:

- **To refresh a dashboard on the phone**, open it on the desktop and let Sync finish.
- **A dashboard never opened on the desktop** shows "No cached result yet. Open
  this dashboard once on the desktop and sync."
- **Large caches may not sync.** Obsidian Sync Standard carries files up to 5 MB.
  When a cache note passes 4 MB, the desktop warns you. Return fewer rows in
  large tables to shrink it.
- **Browsing tables and running queries** need the database file on the
  device. If you sync it some other way and it is under the phone's size cap
  (200 MB by default), the phone reads it live.
- **You can edit dashboards on the phone.** The widget form lists tables and
  columns from a catalog note the desktop writes. To pick from a column's
  values on the phone, turn on "Include category values in the mobile catalog"
  on the desktop. The catalog note is described below.
- **Folder choice on a fresh phone install.** If the vault has a
  `07 Databases` folder and no `Databases` folder, ReadOut uses the ICOR for
  Life folders.

## What ReadOut writes in your vault

Each folder below is created the first time ReadOut saves something into it.

| What | Where | When |
| --- | --- | --- |
| Dashboard notes | Dashboards folder, one note per dashboard | When you create or edit a dashboard |
| Cache notes | `dashboards` inside the cache folder | Desktop only, after a dashboard draws live with no failed widget |
| Catalog notes | `catalogs` inside the cache folder, one per database | Desktop only, when a dashboard draws from that database |
| Note-widget caches | `notes` inside the cache folder | Desktop only, for widgets written out as JSON in a `readout` block; removed after 60 days unused |
| CSV exports | `Exports` inside the databases folder | When you select "Save as CSV" on a query result |
| Guide files | Dashboards folder | Only when you ask (see [Reference](https://github.com/zymetm/readout#reference)) |

The default folders:

| Setting | Default | ICOR for Life vault |
| --- | --- | --- |
| "Databases folder" | `Databases` | `07 Databases` |
| "Dashboards folder" | `Databases/Dashboards` | `07 Databases/Dashboards` |
| "Dashboard cache folder" | `Databases/Dashboard Cache` | `07 Databases/Dashboard Cache` |

ReadOut sets these once, on a fresh install. After that, your settings win.

**The catalog note** lists each database's tables, columns and types. With
"Include category values in the mobile catalog" on, it also lists the values of
small text columns (200 values or fewer), and that note is searchable like any
other. Leave the setting off for a database that holds values you would not put
in a note, such as health or contact details.

**Search and graph.** Dashboard and cache notes are ordinary notes, so they
appear in search, the graph and unlinked mentions. To hide them, add the cache
folder and the dashboards folder under Settings → Files and
links → Excluded files. Excluded notes still show in the file explorer and still
sync.

**Guide files.** An edited copy is never overwritten. To get the newest text,
delete your copy and run "Write the guide files" again.

### Moving a database

When you open a database that is outside the databases folder, ReadOut shows a
notice once for that file, with a "Move to `<folder>`" button. Moving takes the
database and its `-wal` and `-shm` files. Moving may break an app that writes
to the database in its current location. Turn the notice off with "Note when a
database is outside the databases folder".

## Limits and settings worth knowing

**Size.** ReadOut loads the whole database into memory with its built-in
SQLite engine, on every device.

| | Default cap | Highest cap |
| --- | --- | --- |
| Desktop | 1500 MB | 2000 MB |
| Phone or tablet | 200 MB | 2000 MB |

- Change it with "Size cap for the built-in engine (MB)".
- Loading needs roughly three times the file size in free memory.
- Files over 2000 MB do not open.
- A dashboard for a database over the cap draws from the desktop cache instead.

**Queries.** ReadOut opens databases read-only.

- One statement per query, starting with `SELECT`, `WITH`, `PRAGMA` or `EXPLAIN`.
  Only read-only PRAGMAs run.
- A `SELECT` with no `LIMIT` gets one: 500 rows in the SQL console, 5,000 rows
  in a dashboard widget.

**Where it looks.** "Search for databases in" is "Whole vault" by default. Set
it to "Only the databases folder" to list only those. Clicking a database
anywhere, or naming one in a dashboard, works either way.

**Where a database can be.** It must be a file inside the vault, not inside a
hidden folder or Obsidian's configuration folder.

**Not a database.** A file with a database extension that is not SQLite, such
as a Windows `Thumbs.db`, shows "This file isn't a SQLite database".

## Reference

- [DASHBOARD-HELP.md](https://github.com/zymetm/readout/blob/main/DASHBOARD-HELP.md):
  what each widget type shows and what each setting in the widget form does.
  "Write the guide files" also writes it into your dashboards folder as `README.md`.
- [AI-WIDGET-GUIDE.md](https://github.com/zymetm/readout/blob/main/AI-WIDGET-GUIDE.md):
  every field of a dashboard file, for editing dashboards by hand or with an AI
  assistant. Also written into your dashboards folder.

You can write both guides into your vault with the command "Write the guide
files", the "Write now" button in the settings, or "Create Guide Files for Your
AI Team" on the empty dashboards screen.

## Support

ReadOut has one maintainer and is supported on a best-effort basis.

- Report bugs and ideas in the [issues](https://github.com/zymetm/readout/issues).
  Please reproduce a problem on a clean install of the current release first.
- Report security issues through the process in
  [SECURITY.md](https://github.com/zymetm/readout/blob/main/SECURITY.md), not
  in a public issue.

## Licence

MIT. See [LICENSE](https://github.com/zymetm/readout/blob/main/LICENSE).

- **Origin.** The code started as the ICOR for Life SQLite Viewer by myICOR and
  Paperless Movement, S.L., released under the MIT licence from version 0.6.0.
  Releases of that project before 0.6.0 used another licence and are not part
  of ReadOut.
- **Trademarks.** The licence covers the code only. "ICOR", "ICOR for Life",
  "myICOR" and "Paperless Movement" are trademarks of Paperless Movement, S.L.
  ReadOut claims no connection to them beyond being forked from their SQLite
  Viewer. See [TRADEMARK.md](https://github.com/zymetm/readout/blob/main/TRADEMARK.md).
- **Contributions.** Pull requests are welcome under the same MIT terms, with a
  DCO sign-off on every commit. See
  [CONTRIBUTING.md](https://github.com/zymetm/readout/blob/main/CONTRIBUTING.md).
- **Third-party components** keep their own licences. See
  [THIRD-PARTY-NOTICES.md](https://github.com/zymetm/readout/blob/main/THIRD-PARTY-NOTICES.md).
