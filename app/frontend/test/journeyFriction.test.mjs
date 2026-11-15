import test from 'node:test';
import assert from 'node:assert/strict';
import { withPendingBuilds, PENDING_BUILD_TTL_MS } from '../src/lib/implementControl.js';
import { accessCheckingText } from '../src/lib/implementWizard.js';

// REQ-323: a build submitted from the Build page shows at once, and drops out only when the history read shows that build.
test('a submitted build with no history row yet shows as a queued placeholder (REQ-323)', () => {
  const pending = new Map([['uc-1', { at: 1000, name: 'Churn', before: '' }]]);
  const rows = withPendingBuilds([], pending, 2000);
  assert.deepEqual(rows.map((r) => [r.use_case_id, r.use_case_name, r.status, r.pending]), [['uc-1', 'Churn', 'queued', true]]);
  assert.equal(pending.has('uc-1'), true, 'the placeholder stays until history has the build');
});

test('the placeholder drops out once history shows a newer version of that use case (REQ-323)', () => {
  const pending = new Map([['uc-1', { at: 1000, name: 'Churn', before: '2' }]]);
  assert.deepEqual(withPendingBuilds([{ use_case_id: 'uc-1', spec_version: 2, status: 'ready' }], pending, 2000).map((r) => r.status), ['ready'],
    'an older version does not clear it, and the placeholder is not added beside the row that exists');
  assert.equal(pending.has('uc-1'), true);
  const landed = withPendingBuilds([{ use_case_id: 'uc-1', spec_version: 3, status: 'queued' }], pending, 2000);
  assert.deepEqual(landed.map((r) => [r.spec_version, r.pending]), [[3, undefined]]);
  assert.equal(pending.has('uc-1'), false, 'a landed build is no longer pending');
});

test('a build that never lands is dropped after the TTL, so the list never shows a ghost forever (REQ-323)', () => {
  const pending = new Map([['uc-1', { at: 0, name: 'Churn', before: '' }]]);
  assert.deepEqual(withPendingBuilds([], pending, PENDING_BUILD_TTL_MS + 1), []);
  assert.equal(pending.size, 0);
});

// REQ-324: the Build button's wait names the checks that run together, and for how long.
test('the access wait names the checks running together and the seconds so far (REQ-324)', () => {
  assert.equal(accessCheckingText(7), "Checking the source tables, where results go and the App's access, 7 s so far");
});
