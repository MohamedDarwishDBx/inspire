// A run Inspire has just launched may not have its launch record yet. Monitor waits a bounded time before it says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RUN_RECORD_WAIT_MS, isUnrecordedRefusal, monitorFailureChoices, unrecordedWaitOver } from '../src/lib/monitorState.js';

test('only the recorded policy refusal (403 with rule recorded) counts as an unrecorded run; an access refusal does not (must-exclude)', () => {
  assert.equal(isUnrecordedRefusal({ status: 403, body: { policy: { rule: 'recorded' } } }), true);
  assert.equal(isUnrecordedRefusal({ status: 403, body: { policy: { rule: 'launcher' } } }), false, 'a launcher refusal is not a missing record');
  assert.equal(isUnrecordedRefusal({ status: 403, body: null }), false, 'a plain 403 from Databricks is an access refusal');
  assert.equal(isUnrecordedRefusal({ status: 503, body: { policy: { rule: 'recorded' } } }), false, 'a retryable 503 is not a refusal');
});

test('the wait is bounded: a refusal is pending until RUN_RECORD_WAIT_MS has passed since its first answer, and not before (fail-pre: no wait existed)', () => {
  const first = 1_000_000;
  assert.equal(unrecordedWaitOver(null, first + 999999), false, 'no refusal yet');
  assert.equal(unrecordedWaitOver(first, first + RUN_RECORD_WAIT_MS - 1), false, 'still inside the wait, so Starting');
  assert.equal(unrecordedWaitOver(first, first + RUN_RECORD_WAIT_MS), true, 'the wait is over, the refusal shows');
  assert.ok(RUN_RECORD_WAIT_MS >= 60000, 'the wait covers the first minute after a launch');
});

test('after the wait, Check again says Inspire checks its record, never that the person needs access (must-exclude: access wording stays for real access refusals)', () => {
  const unrecorded = monitorFailureChoices({ cannotRead: true, unrecorded: true });
  const read = unrecorded.find((c) => c.id === 'read');
  assert.match(read.detail, /record of this run again/);
  assert.doesNotMatch(read.detail, /access/);
  const access = monitorFailureChoices({ cannotRead: true }).find((c) => c.id === 'read');
  assert.match(access.detail, /Once you have access/);
});
