# Third-party notices

ReadOut is forked from the ICOR for Life SQLite Viewer by myICOR
(https://github.com/myICOR/icor-for-life-sqlite-viewer), copyright (c) 2026
Paperless Movement, S.L., released under the MIT licence (see `LICENSE`).
Its code is the base of this one, and its authors are credited there. ReadOut
is not made, supported or endorsed by myICOR or Paperless Movement.

ReadOut bundles one third-party component.

## sql.js

`sql-wasm.js` and `sql-wasm.wasm` are sql.js version 1.13.0, a WebAssembly
build of SQLite, vendored from
https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.13.0/. The files in the
repository are the originals; the copy pasted into `main.js` carries one
patch (below). It is the engine
that reads databases on every device. The files ship two ways, and nothing is ever downloaded:

- `sql-wasm.js` is pasted into `main.js` as plain, readable source inside
  one function (between two marker comments). **Modified: Node.js loading
  branch removed.** The original loads Node's file system, path and crypto
  modules when it detects Node outside a renderer, and reads stdin in the same
  case. The pasted copy has that branch cut, and random bytes come from
  `crypto.getRandomValues` only; the browser path and everything else are
  unchanged. The patch is four mechanical text edits, kept as a script
  (`embedded-sqljs.mjs`). It runs as ordinary code, never through `eval` or `new Function`, and no
  JavaScript is ever read from the plugin folder.
- `sql-wasm.wasm` is data: the standalone file in the plugin folder is used
  when it is installed there (manual installs), otherwise the copy embedded
  in `main.js` as a base64 string, byte-identical once decoded, because
  Obsidian's community-directory installer downloads only `main.js`,
  `manifest.json` and `styles.css`.

A test gate asserts the pasted source equals the vendored `sql-wasm.js`
with exactly that patch applied, that `main.js` contains no `require` of a
Node module, and that the embedded binary is byte-identical to the vendored
`sql-wasm.wasm`. `npm run build` runs the same check.

SHA-256 of the vendored standalone files (unchanged since 0.5.0; the
embedded `.wasm` is the same bytes, and the embedded `.js` is the same text
less the removed Node branch):

- `sql-wasm.js` `694ca5b36aa3e6e71f417819d7df390b65343665fcfa5c69015ca33d93d291b3`
- `sql-wasm.wasm` `0734155c83e493983d1f2ff5b09a4fab6e35a32e9449c7e4e545756439f62d73`

sql.js is licensed under the MIT License (https://github.com/sql-js/sql.js):

```
MIT License

Copyright (c) 2017 sql.js authors (see AUTHORS)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

SQLite itself, which sql.js compiles, is public domain
(https://sqlite.org/copyright.html).

## Not bundled

Icons are the Lucide icons Obsidian itself ships, drawn at runtime through
Obsidian's `setIcon()`. Lucide is licensed under the ISC License by Lucide
Contributors; the copy in use is Obsidian's, not this plugin's.
