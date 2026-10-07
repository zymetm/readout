/* THE MANIFEST AND THE RELEASE FILES.
 *
 * What the Obsidian directory reads, and what the trademark notice asks of a
 * fork, as gates: the id and the name are ReadOut's own, the description
 * follows the directory's rules, the version is mapped in versions.json, and
 * the release workflow is this repository's own and ships three files.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const manifest = JSON.parse(read('manifest.json'));
const versions = JSON.parse(read('versions.json'));

test('the id and the name are ReadOut\'s own, and name no mark of the original project', () => {
  assert.equal(manifest.id, 'readout');
  assert.equal(manifest.name, 'ReadOut');
  assert.equal(manifest.author, 'Matt Zymet');
  assert.equal(manifest.authorUrl, 'https://github.com/zymetm');
  for (const field of ['id', 'name', 'description']) {
    assert.doesNotMatch(manifest[field], /icor|obsidian|plugin/i, field + ' names no ICOR, Obsidian or plugin');
  }
});

test('the description follows the directory rules', () => {
  const d = manifest.description;
  assert.ok(d.length <= 250, 'at most 250 characters, is ' + d.length);
  assert.match(d, /^[A-Z]/, 'starts with a capital');
  assert.match(d, /\.$/, 'ends with a full stop');
  assert.match(d, /^[A-Za-z0-9 .,!?'"\-]+$/, 'letters, digits, spaces and . , ! ? \' " - only');
});

test('the version is in versions.json with the same minimum app version', () => {
  assert.equal(versions[manifest.version], manifest.minAppVersion);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.match(read('CHANGELOG.md'), new RegExp('^## \\[' + manifest.version.replace(/\./g, '\\.') + '\\]', 'm'), 'the changelog has a section for it');
});

test('the repository has its own release workflow, which ships three files and calls no outside workflow', () => {
  const wf = read('.github/workflows/release.yml');
  assert.doesNotMatch(wf, /myICOR\//i, 'no shared workflow of another organisation');
  assert.doesNotMatch(wf, /^\s*uses:\s*[^\s@]+\/[^\s@]+\/\.github\/workflows\//m, 'no reusable workflow is called');
  assert.match(wf, /gh release create "\$TAG" main\.js manifest\.json styles\.css/);
  assert.doesNotMatch(wf, /sql-wasm/, 'the engine is inside main.js, so it is not a release file');
  for (const line of wf.split('\n').filter((l) => /^\s*uses:/.test(l))) {
    assert.match(line, /@[0-9a-f]{40}\b/, 'pinned to a commit: ' + line.trim());
  }
  assert.doesNotMatch(read('.github/CODEOWNERS'), /TomSolid/);
});

test('the three release files carry no mark of the original project in the places a directory reads', () => {
  assert.doesNotMatch(read('package.json'), /icor/i);
  assert.match(read('LICENSE'), /Paperless Movement, S\.L\./, 'the original authors stay credited');
  assert.match(read('LICENSE'), /Matt Zymet/);
  assert.match(read('THIRD-PARTY-NOTICES.md'), /forked from the ICOR for Life SQLite Viewer/);
});
