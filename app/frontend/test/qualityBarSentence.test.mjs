// REQ-165 (P91, D-AUTO): one sentence form for the quality-bar count on every surface, "N of M use cases meet the quality bar",
// built only by qualityBarCountText. Fail-pre: a page that writes its own "N of M ... meet ... bar" sentence fails the source scan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { qualityBarCountText } from '../src/lib/qualityBarWording.js';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const OWN = join(SRC, 'lib', 'qualityBarWording.js');
// runOutcome.js matches the old wording only to strip it from stored messages (withoutStoredCount), it never writes it.
const STRIPS_OLD = join(SRC, 'lib', 'runOutcome.js');
const HAND_WRITTEN = /\$\{[^}]*\}\s+of\s+\$\{[^}]*\}\s+use cases?\s+(?:found\s+)?meets?\b|\b\d+ of \d+ use cases?\s+(?:found\s+)?meets?\b/;

function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(js|jsx)$/.test(name) ? [path] : [];
  });
}

test('the one sentence reads N of M use cases meet the quality bar, with the mode when the line names it', () => {
  assert.equal(qualityBarCountText(2, 0), '0 of 2 use cases meet the quality bar');
  assert.equal(qualityBarCountText(1, 1), '1 of 1 use case meets the quality bar');
  assert.equal(qualityBarCountText(2, 0, 'Good'), '0 of 2 use cases meet the Good quality bar');
});

test('no source file writes its own quality-bar count sentence (must-exclude: a hand-written copy fails)', () => {
  const offenders = sources(SRC)
    .filter((path) => path !== OWN && path !== STRIPS_OLD)
    .filter((path) => HAND_WRITTEN.test(readFileSync(path, 'utf8')))
    .map((path) => relative(SRC, path));
  assert.deepEqual(offenders, [], 'a quality-bar count sentence must come from qualityBarCountText');
});

test('the scan itself catches a hand-written copy in the old wording (must-include)', () => {
  assert.ok(HAND_WRITTEN.test('`${passed} of ${total} use cases meet your Good bar`'.replace('meet your Good bar', 'meet the quality bar')));
  assert.ok(HAND_WRITTEN.test('11 of 20 use cases found meet your Good bar'));
});
