import test from 'node:test';
import assert from 'node:assert/strict';
import { trackBuildSubmit, withPendingBuilds } from '../src/lib/implementControl.js';

// F22 / REQ-352: a rebuild of a use case that already has a row. The overlay must end once history shows a run from the click or a newer version.
const iso = (ms) => new Date(ms).toISOString();
const row = (over = {}) => ({ use_case_id: 'uc-r', use_case_name: 'Rebuild', spec_version: 1, status: 'ready', created_at: iso(1000), ...over });
const mine = (rows) => rows.filter((r) => r.use_case_id === 'uc-r');

test('an older run keeps its row overlaid as queued until a run from the click shows (REQ-352)', async () => {
  const click = 100000;
  // history read before the click: the older run is the row
  withPendingBuilds([row()], click - 1);
  const pending = trackBuildSubmit({ use_case_id: 'uc-r', use_case_name: 'Rebuild' }, async () => ({ session_id: '42', use_case_id: 'uc-r' }), null, click);
  await pending;
  const before = mine(withPendingBuilds([row()], click + 1000));
  assert.deepEqual(before.map((r) => [r.spec_version, r.status, r.pending]), [[2, 'queued', true]], 'the older run still reads as the build in progress, as the next version (REQ-386)');
});

test('a newer run created after the click clears the overlay, even when the answer had no spec_version (REQ-352)', async () => {
  const click = 200000;
  withPendingBuilds([row({ use_case_id: 'uc-r' })], click - 1);
  await trackBuildSubmit({ use_case_id: 'uc-r', use_case_name: 'Rebuild' }, async () => ({ session_id: '42' }), null, click);
  const shown = mine(withPendingBuilds([row({ spec_version: 1, status: 'running', created_at: iso(click + 500) })], click + 1000));
  assert.deepEqual(shown.map((r) => [r.spec_version, r.status, r.pending]), [[1, 'running', undefined]], 'the real run status shows, not a stale queued');
});

test('a higher version than the baseline clears the overlay when no run time is known (REQ-352)', async () => {
  const click = 300000;
  withPendingBuilds([row({ use_case_id: 'uc-r', created_at: undefined })], click - 1);
  await trackBuildSubmit({ use_case_id: 'uc-r', use_case_name: 'Rebuild' }, async () => ({ session_id: '42', use_case_id: 'uc-r' }), null, click);
  const shown = mine(withPendingBuilds([row({ spec_version: 2, status: 'building', created_at: undefined })], click + 1000));
  assert.deepEqual(shown.map((r) => [r.spec_version, r.status, r.pending]), [[2, 'building', undefined]]);
});

test('an older run created before the click, at the same version, keeps the overlay (REQ-352 must-exclude)', async () => {
  const click = 400000;
  withPendingBuilds([row({ use_case_id: 'uc-r', created_at: iso(click - 60000) })], click - 1);
  await trackBuildSubmit({ use_case_id: 'uc-r', use_case_name: 'Rebuild' }, async () => ({ session_id: '42', use_case_id: 'uc-r' }), null, click);
  const shown = mine(withPendingBuilds([row({ created_at: iso(click - 60000) })], click + 1000));
  assert.deepEqual(shown.map((r) => [r.status, r.pending]), [['queued', true]], 'a run from before the click is not the build');
});

test('a failed run newer than the click is shown as failed, not overlaid (REQ-352)', async () => {
  const click = 500000;
  withPendingBuilds([row({ use_case_id: 'uc-r' })], click - 1);
  await trackBuildSubmit({ use_case_id: 'uc-r', use_case_name: 'Rebuild' }, async () => ({ session_id: '42', use_case_id: 'uc-r' }), null, click);
  const shown = mine(withPendingBuilds([row({ spec_version: 1, status: 'failed', created_at: iso(click + 2000) })], click + 3000));
  assert.deepEqual(shown.map((r) => [r.status, r.pending]), [['failed', undefined]]);
});

test('an answer without use_case_id falls back to the submitted use case (REQ-352)', async () => {
  const click = 600000;
  withPendingBuilds([], click - 1);
  await trackBuildSubmit({ use_case_id: 'uc-fallback', use_case_name: 'Fallback' }, async () => ({ session_id: '42', spec_version: 3 }), null, click);
  const shown = withPendingBuilds([], click + 1000).filter((r) => r.use_case_id === 'uc-fallback');
  assert.deepEqual(shown.map((r) => [r.status, r.pending]), [['queued', true]], 'the placeholder is kept for the submitted use case');
});

// F22 / REQ-352: UseCaseDetail sits outside ImplementPage's scope, so it must take the queued callback as a prop, never the parent's local name.
test('UseCaseDetail submits through its own onBuildQueued prop, not the parent-only showQueuedBuild (REQ-352)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/pages/ImplementPage.jsx', import.meta.url), 'utf8');
  const detail = src.slice(src.indexOf('function UseCaseDetail('));
  assert.ok(detail.length > 0);
  assert.equal(detail.includes('showQueuedBuild'), false, 'showQueuedBuild is not in scope in UseCaseDetail: every detail submit threw a ReferenceError');
  assert.match(detail, /trackBuildSubmit\(body\.spec, \(\) => apiPostJson\(path, body\), onBuildQueued\)/);
});

// REQ-386: while the submit is pending the queued build is the next version and counts from the click; once the server answers, its version is shown.
test('a queued build over a failed v1 reads v2 timed from the click, and follows the version the server answered (REQ-386)', async () => {
  const click = 700000;
  const failedV1 = () => row({ created_at: iso(click - 15 * 3600000), status: 'failed' });
  withPendingBuilds([failedV1()], click - 1);
  let release = () => {};
  const held = new Promise((resolve) => { release = resolve; });
  const pending = trackBuildSubmit({ use_case_id: 'uc-r', use_case_name: 'Rebuild' }, async () => { await held; return { session_id: '42', use_case_id: 'uc-r', spec_version: 3 }; }, null, click);
  const pendingShown = mine(withPendingBuilds([failedV1()], click + 1000));
  assert.deepEqual(pendingShown.map((r) => [r.spec_version, r.created_at, r.status]), [[2, iso(click), 'queued']],
    'v2 timed from the click, with no 15-hour start (must-fail before the fix: v1 with the old start)');
  release();
  await pending;
  const answered = mine(withPendingBuilds([failedV1()], click + 2000));
  assert.deepEqual(answered.map((r) => [r.spec_version, r.created_at, r.status]), [[3, iso(click), 'queued']],
    'after the answer the panel follows the server version 3 and still counts from the submit');
});

// REQ-386: the callers feed the overlaid list back in. An overlay is never read as history, so a second read keeps the queued build (the
// one-build-per-use-case lock depends on it) and a landed build shows its server row again.
test('feeding the overlaid list back in keeps the queued overlay, and a landed build shows its server row (REQ-386)', async () => {
  const click = 800000;
  withPendingBuilds([row({ use_case_id: 'uc-r', spec_version: 3 })], click - 1);
  let release = () => {};
  const held = new Promise((resolve) => { release = resolve; });
  const pending = trackBuildSubmit({ use_case_id: 'uc-r', use_case_name: 'Rebuild' }, async () => { await held; return { session_id: '42', use_case_id: 'uc-r' }; }, null, click);
  const once = withPendingBuilds([row({ use_case_id: 'uc-r', spec_version: 3 })], click + 1000);
  const twice = withPendingBuilds(once, click + 2000);
  assert.deepEqual(mine(twice).map((r) => [r.spec_version, r.status, r.pending]), [[4, 'queued', true]], 'the second read still shows the queued build');
  assert.deepEqual(mine(withPendingBuilds(twice, click + 2500)).map((r) => [r.spec_version, r.pending]), [[4, true]], 'a third read too');
  release();
  await pending;
  const landedRow = row({ use_case_id: 'uc-r', spec_version: 4, status: 'ready', created_at: iso(click + 500) });
  assert.deepEqual(mine(withPendingBuilds([landedRow, ...twice.filter((r) => r.pending)], click + 3000)).map((r) => [r.spec_version, r.status, r.pending]),
    [[4, 'ready', undefined]], 'a landed build shows its server row, not the overlay');
});
