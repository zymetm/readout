/* `npm run build` really builds: main.js is src/main.js with the patched
 * vendored sql.js and the base64 wasm filled in, and styles.css is
 * src/styles.css. Obsidian installs the committed root copies, so these gates
 * prove a fresh build gives back exactly those bytes, from a clean checkout
 * that has none of the build outputs, and that the check fails when the
 * committed copies or the engine drift. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { checkEmbedded } from '../embedded-sqljs.mjs';
import { buildFiles, stale } from '../build.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(repo, p));

/* A copy of just the inputs of the build. No main.js, no styles.css. */
function cleanCheckout() {
  const dir = mkdtempSync(join(tmpdir(), 'readout-build-'));
  mkdirSync(join(dir, 'src'));
  for (const f of ['build.mjs', 'embedded-sqljs.mjs', 'package.json', 'manifest.json', 'sql-wasm.js', 'sql-wasm.wasm', 'src/main.js', 'src/styles.css']) {
    copyFileSync(resolve(repo, f), join(dir, f));
  }
  return dir;
}

test('package.json: npm run build is build.mjs, and there are no dependencies', () => {
  const pkg = JSON.parse(read('package.json').toString('utf8'));
  assert.equal(pkg.scripts.build, 'node build.mjs');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});

test('a fresh build is byte-identical to the committed main.js and styles.css', () => {
  const out = buildFiles(repo);
  assert.ok(out['main.js'].equals(read('main.js')), 'main.js differs from the build of src/main.js; run npm run build');
  assert.ok(out['styles.css'].equals(read('styles.css')), 'styles.css differs from src/styles.css; run npm run build');
  assert.deepEqual(stale(repo), []);
});

test('on a clean checkout with main.js and styles.css deleted, npm run build makes them byte-for-byte', () => {
  const dir = cleanCheckout();
  try {
    assert.equal(existsSync(join(dir, 'main.js')), false);
    assert.equal(existsSync(join(dir, 'styles.css')), false);
    const manifestBefore = readFileSync(join(dir, 'manifest.json'));
    const r = spawnSync(process.execPath, [join(dir, 'build.mjs')], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(readFileSync(join(dir, 'main.js')).equals(read('main.js')));
    assert.ok(readFileSync(join(dir, 'styles.css')).equals(read('styles.css')));
    assert.ok(readFileSync(join(dir, 'manifest.json')).equals(manifestBefore), 'the build leaves manifest.json alone');
    assert.deepEqual(checkEmbedded(dir), []);
    const again = spawnSync(process.execPath, [join(dir, 'build.mjs')], { cwd: dir, encoding: 'utf8' });
    assert.equal(again.status, 0, again.stderr);
    assert.ok(readFileSync(join(dir, 'main.js')).equals(read('main.js')), 'a second build gives the same bytes');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--check passes on the committed files and fails when one drifts', () => {
  const dir = cleanCheckout();
  try {
    spawnSync(process.execPath, [join(dir, 'build.mjs')], { cwd: dir });
    const ok = spawnSync(process.execPath, [join(dir, 'build.mjs'), '--check'], { cwd: dir, encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    writeFileSync(join(dir, 'styles.css'), read('styles.css') + '\n/* hand edit */\n');
    const bad = spawnSync(process.execPath, [join(dir, 'build.mjs'), '--check'], { cwd: dir, encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /styles\.css/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the engine check fails when the embedded sql.js or wasm is changed', () => {
  const dir = cleanCheckout();
  try {
    const main = read('main.js').toString('utf8');
    writeFileSync(join(dir, 'main.js'), main);
    assert.deepEqual(checkEmbedded(dir), []);
    writeFileSync(join(dir, 'main.js'), main.replace('crypto.getRandomValues(b)', 'crypto.getRandomValues(b) '));
    assert.equal(checkEmbedded(dir).length, 1);
    writeFileSync(join(dir, 'main.js'), main.replace(/(const EMBEDDED_SQL_WASM_B64 = ')A/, '$1B'));
    assert.equal(checkEmbedded(dir).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the source holds each placeholder once and no engine', () => {
  const src = read('src/main.js').toString('utf8');
  assert.equal(src.split('@@EMBEDDED_SQL_WASM_B64@@').length, 2);
  assert.equal(src.split('/*@@VENDORED_SQLJS@@*/').length, 2);
  assert.ok(!src.includes('BEGIN vendored sql-wasm.js'));
});
