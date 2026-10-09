/* How the sql.js copy inside the shipped main.js differs from the vendored
 * sql-wasm.js. build.mjs (`npm run build`) uses patchSqlJs() below to put the
 * patched engine into main.js; the tests use checkEmbedded() to prove the
 * committed main.js still holds exactly that.
 *
 * The one modification (sql.js 1.13.0, recorded in THIRD-PARTY-NOTICES.md):
 * the Node.js loading branch is removed, so the pasted copy never names
 * Node's file system, path or crypto modules. The browser path stays, and
 * random bytes come from crypto.getRandomValues. Four mechanical edits, each
 * of which must match the vendored file exactly once:
 *
 *   1. drop the `ca` flag that detects Node outside a renderer;
 *   2. drop the `if(ca){...}else` Node branch that loads the wasm from disk;
 *   3. drop the `if(ca){...}else` branch that reads stdin;
 *   4. use crypto.getRandomValues only, and drop `&&!ca` before streaming.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const BEGIN = '/* BEGIN vendored sql-wasm.js */\nfunction vendoredSqlJs(module, exports, require, __dirname, __filename) {\n';
export const END = '\n}\n/* END vendored sql-wasm.js */';

/* Replace the text from `from` through `to` (both exact, `from` unique) with `by`. */
function cut(src, from, to, by) {
  const a = src.indexOf(from);
  if (a < 0 || src.indexOf(from, a + 1) >= 0) throw new Error('patch anchor not found exactly once: ' + from);
  const b = src.indexOf(to, a);
  if (b < 0) throw new Error('patch end anchor not found: ' + to);
  return src.slice(0, a) + by + src.slice(b + to.length);
}

function swap(src, from, by) {
  const a = src.indexOf(from);
  if (a < 0 || src.indexOf(from, a + 1) >= 0) throw new Error('patch anchor not found exactly once: ' + from);
  return src.slice(0, a) + by + src.slice(a + from.length);
}

/* The vendored sql-wasm.js with the Node.js loading branch removed. */
export function patchSqlJs(vendored) {
  let s = vendored.replace(/\s+$/, '');
  /* 1. the Node-detection flag */
  s = cut(s, ',ca="object"==typeof process', '"renderer"!=process.type', '');
  /* 2. the Node branch that loads the wasm from disk */
  s = cut(s, 'if(ca){var fs=require("fs");', '}else if(aa||ba)', 'if(aa||ba)');
  /* 3. the Node branch that reads stdin */
  s = cut(s, 'if(ca){var b=Buffer.alloc(256)', '}else"undefined"!=typeof window', '"undefined"!=typeof window');
  /* 4. random bytes from the browser API only; no Node check before streaming */
  s = swap(s, 'hb=()=>{if(ca){var a=require("crypto");return b=>a.randomFillSync(b)}return b=>crypto.getRandomValues(b)}', 'hb=()=>b=>crypto.getRandomValues(b)');
  s = swap(s, '&&!Ga(b)&&!ca)try', '&&!Ga(b))try');
  if (/(?<![.\w$])ca(?![\w$])/.test(s)) throw new Error('a reference to the removed Node flag is left');
  return s;
}

/* The sql.js text between the markers in main.js. */
export function embeddedSource(main) {
  const a = main.indexOf(BEGIN);
  const b = main.indexOf(END);
  if (a < 0 || b < a) throw new Error('the vendored source markers are not in main.js');
  return main.slice(a + BEGIN.length, b);
}

/* Returns a list of problems; empty means main.js embeds exactly what it should. */
export function checkEmbedded(repo) {
  const problems = [];
  const main = readFileSync(resolve(repo, 'main.js'), 'utf8');
  let expected;
  try {
    expected = patchSqlJs(readFileSync(resolve(repo, 'sql-wasm.js'), 'utf8'));
  } catch (e) {
    return ['the patch no longer applies to sql-wasm.js: ' + e.message];
  }
  let pasted;
  try { pasted = embeddedSource(main); } catch (e) { return [e.message]; }
  if (pasted !== expected) problems.push('the sql.js copy in main.js is not sql-wasm.js plus the Node-branch removal');
  const m = main.match(/^const EMBEDDED_SQL_WASM_B64 = '([^']*)';$/m);
  if (!m) problems.push('the embedded wasm string is missing from main.js');
  else if (!Buffer.from(m[1], 'base64').equals(readFileSync(resolve(repo, 'sql-wasm.wasm')))) {
    problems.push('the embedded wasm in main.js is not sql-wasm.wasm');
  }
  return problems;
}
