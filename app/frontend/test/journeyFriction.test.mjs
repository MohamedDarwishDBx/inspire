import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { markBuildPending, noteBuildSubmitted, withPendingBuilds, PENDING_BUILD_TTL_MS } from '../src/lib/implementControl.js';
import { accessCheckingText, buildNowDefaultsText, dataCheckingText } from '../src/lib/implementWizard.js';

// REQ-323: a build submitted from the app shows on the Build page at once, and drops out only when the history read shows that version or newer.
test('a submitted build with no history row yet shows as a queued placeholder (REQ-323)', () => {
  markBuildPending('uc-a1', { name: 'Churn', version: 2 }, 1000);
  const rows = withPendingBuilds([], 2000);
  assert.deepEqual(rows.map((r) => [r.use_case_id, r.use_case_name, r.status, r.pending]), [['uc-a1', 'Churn', 'queued', true]]);
});

test('the placeholder drops out once history shows that version or newer (REQ-323)', () => {
  markBuildPending('uc-a2', { name: 'Fraud', version: 3 }, 1000);
  const mine = (rows) => rows.filter((r) => r.use_case_id === 'uc-a2');
  assert.equal(mine(withPendingBuilds([{ use_case_id: 'uc-a2', spec_version: 2, status: 'ready' }], 2000)).length, 1,
    'an older version does not clear it, and no placeholder is added beside the row that exists');
  const landed = mine(withPendingBuilds([{ use_case_id: 'uc-a2', spec_version: 3, status: 'queued' }], 2000));
  assert.deepEqual(landed.map((r) => [r.spec_version, r.pending]), [[3, undefined]]);
  assert.deepEqual(mine(withPendingBuilds([], 2000)), [], 'a landed build is no longer pending');
});

test('a build that never lands is dropped after the TTL, so the list never shows a ghost forever (REQ-323)', () => {
  markBuildPending('uc-a3', { name: 'Churn', version: 1 }, 0);
  assert.deepEqual(withPendingBuilds([], PENDING_BUILD_TTL_MS + 1).filter((r) => r.use_case_id === 'uc-a3'), []);
});

// REQ-324: the Build button's wait names the checks that run together, and for how long.
test('the access wait names the checks running together and the seconds so far (REQ-324)', () => {
  assert.equal(accessCheckingText(7), "Checking the source tables, where results go and the App's access, 7 s so far");
});

// REQ-323: a queued build survives a reload of the tab (a full page load empties module memory, so the store is in sessionStorage too).
test('a queued build survives a reload of the tab (REQ-323)', async () => {
  const store = new Map();
  globalThis.sessionStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const before = await import('../src/lib/implementControl.js?tab=before');
  before.markBuildPending('uc-reload', { name: 'Reload', version: 1 }, Date.now());
  const reloaded = await import('../src/lib/implementControl.js?tab=after');
  assert.deepEqual(reloaded.withPendingBuilds([]).map((r) => [r.use_case_id, r.pending]), [['uc-reload', true]]);
  delete globalThis.sessionStorage;
});

// REQ-323: every build submit hands its answer to noteBuildSubmitted, so no path (wizard, Build next, Rebuild, Try again, Results) can skip the queued build.
test('every build submit in the app calls noteBuildSubmitted (REQ-323)', () => {
  const files = [];
  const walk = (dir) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (/\.jsx?$/.test(name)) files.push(path); } };
  walk(new URL('../src', import.meta.url).pathname);
  const code = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  const submits = (code.match(/implement\/submit'/g) || []).length;
  const calls = (code.match(/noteBuildSubmitted\(/g) || []).length - 1; // minus the definition in implementControl.js
  assert.equal(calls, submits, `${submits} submit paths, ${calls} noteBuildSubmitted calls: a path without the helper shows no queued build`);
});

// REQ-344: the early build button names the steps it keeps as defaults; no line when no step is skipped.
test('the early Build button names the steps it keeps as defaults (REQ-344)', () => {
  assert.equal(buildNowDefaultsText(['Data groups', 'First run', 'Measure', 'Where it lives']),
    'Uses the defaults for Data groups, First run, Measure and Where it lives');
  assert.equal(buildNowDefaultsText([]), '');
});

// REQ-345: the data check names what it reads and the seconds so far.
test('the data check names what it reads and the seconds so far (REQ-345)', () => {
  assert.equal(dataCheckingText(3), 'Counting the rows the use case reads and checking its columns and filters, 3 s so far');
});
