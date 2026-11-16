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
  assert.deepEqual(before.map((r) => [r.spec_version, r.status, r.pending]), [[1, 'queued', true]], 'the older run still reads as the build in progress');
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
