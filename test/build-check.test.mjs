/* `npm run build` compiles nothing: it checks that main.js embeds the vendored
 * sql.js (plus its one patch) and the vendored wasm. These gates check the
 * check: it passes on the repo as committed, fails when the embedded copy is
 * touched, and leaves every release file exactly as it found it. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { checkEmbedded } from '../embedded-sqljs.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (p) => createHash('sha256').update(readFileSync(resolve(repo, p))).digest('hex');

test('package.json has an honest build script that only runs the check', () => {
  const pkg = JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.build, 'node embedded-sqljs.mjs');
});

test('npm run build passes on the committed files and leaves them byte-identical', () => {
  const before = ['main.js', 'manifest.json', 'styles.css'].map(sha);
  const r = spawnSync(process.execPath, [resolve(repo, 'embedded-sqljs.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no build step/i);
  assert.deepEqual(['main.js', 'manifest.json', 'styles.css'].map(sha), before);
});

test('the check fails when the embedded sql.js or wasm is changed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readout-build-'));
  try {
    for (const f of ['sql-wasm.js', 'sql-wasm.wasm']) copyFileSync(resolve(repo, f), join(dir, f));
    const main = readFileSync(resolve(repo, 'main.js'), 'utf8');
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
