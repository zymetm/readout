/* `npm run build`: assembles the two files Obsidian installs, from the source
 * in src/, using only Node's own modules.
 *
 *   src/main.js    + the patched vendored sql-wasm.js + sql-wasm.wasm (base64)
 *                    -> main.js
 *   src/styles.css -> styles.css
 *
 * manifest.json is not a build output: it stays at the repo root and is read
 * as it is. The output is deterministic (no dates, no paths, no randomness), so
 * the same inputs always give the same bytes, and CI and the release workflow
 * fail if a fresh build differs from the committed main.js and styles.css.
 *
 *   node build.mjs           write main.js and styles.css
 *   node build.mjs --check   write nothing; exit 1 if the committed files differ */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { patchSqlJs, BEGIN, END } from './embedded-sqljs.mjs';

export const WASM_MARK = '@@EMBEDDED_SQL_WASM_B64@@';
export const SQLJS_MARK = '/*@@VENDORED_SQLJS@@*/';

function once(src, mark) {
  const a = src.indexOf(mark);
  if (a < 0 || src.indexOf(mark, a + 1) >= 0) throw new Error('src/main.js must hold ' + mark + ' exactly once');
  return a;
}

/* The bytes of main.js and styles.css the sources make. */
export function buildFiles(repo) {
  const src = readFileSync(resolve(repo, 'src/main.js'), 'utf8');
  const wasm = readFileSync(resolve(repo, 'sql-wasm.wasm')).toString('base64');
  const sqljs = patchSqlJs(readFileSync(resolve(repo, 'sql-wasm.js'), 'utf8'));
  const w = once(src, WASM_MARK);
  let main = src.slice(0, w) + wasm + src.slice(w + WASM_MARK.length);
  const j = once(main, SQLJS_MARK);
  main = main.slice(0, j) + BEGIN + sqljs + END + main.slice(j + SQLJS_MARK.length);
  return { 'main.js': Buffer.from(main, 'utf8'), 'styles.css': readFileSync(resolve(repo, 'src/styles.css')) };
}

/* Names of the committed files that differ from a fresh build; empty means identical. */
export function stale(repo) {
  const out = buildFiles(repo);
  return Object.keys(out).filter((name) => {
    try { return !readFileSync(resolve(repo, name)).equals(out[name]); } catch { return true; }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = dirname(fileURLToPath(import.meta.url));
  if (process.argv.includes('--check')) {
    const bad = stale(repo);
    if (bad.length) { console.error('Not what the build makes: ' + bad.join(', ') + '. Run `npm run build` and commit.'); process.exit(1); }
    console.log('main.js and styles.css are exactly what `npm run build` makes.');
  } else {
    const out = buildFiles(repo);
    for (const name of Object.keys(out)) writeFileSync(resolve(repo, name), out[name]);
    console.log('Built main.js (' + out['main.js'].length + ' bytes) and styles.css (' + out['styles.css'].length + ' bytes).');
  }
}
