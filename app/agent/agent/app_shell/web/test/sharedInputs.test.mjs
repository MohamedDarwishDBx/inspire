import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHARED_DIR, SHARED_INPUTS } from './freshDist.mjs';

// Every file in app/shared is an input of the App shell build: the embed pin (embed.py) and the staleness check (freshDist.mjs)
// both list it. A new shared file that one of them misses fails here.
const EMBED_PY = join(SHARED_DIR, '..', 'agent', 'agent', 'app_shell', 'embed.py');
const embedText = readFileSync(EMBED_PY, 'utf8');
const embedList = embedText.match(/SHARED_INPUTS = \(([^)]*)\)/)[1].match(/"([^"]+)"/g).map((s) => s.slice(1, -1));

test('every file in app/shared is listed by freshDist.mjs and by embed.py', () => {
  const onDisk = readdirSync(SHARED_DIR, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
  assert.deepEqual([...SHARED_INPUTS].sort(), onDisk, 'freshDist.mjs SHARED_INPUTS matches app/shared');
  assert.deepEqual([...embedList].sort(), onDisk, 'embed.py SHARED_INPUTS matches app/shared');
});

test('the boot guard and its Vite plugin are both shared inputs', () => {
  assert.ok(SHARED_INPUTS.includes('bootGuard.js'));
  assert.ok(SHARED_INPUTS.includes('bootGuardPlugin.mjs'));
});
