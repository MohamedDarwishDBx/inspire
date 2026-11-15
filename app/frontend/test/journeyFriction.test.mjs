import test from 'node:test';
import assert from 'node:assert/strict';
import { markBuildPending, withPendingBuilds, PENDING_BUILD_TTL_MS } from '../src/lib/implementControl.js';
import { accessCheckingText } from '../src/lib/implementWizard.js';

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
