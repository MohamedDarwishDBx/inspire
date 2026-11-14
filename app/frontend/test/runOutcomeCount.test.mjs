// REQ-165: the quality-bar count is rendered once, from the data (qualityBarCountText). A stored message can carry its own copy
// of the count in an older wording, which must never reach the screen. Fail-pre: each stored count reaches barMessage/message.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runOutcomeOf, withoutStoredCount } from '../src/lib/runOutcome.js';
import { qualityBarCountText } from '../src/lib/qualityBarWording.js';

const OLD_WORDING = '11 of 20 use cases found meet your Good bar';

test('a stored count in the old "found meet your" wording never reaches the outcome line (must-exclude)', () => {
  const outcome = runOutcomeOf({ quality_bar: { mode: 'Good', found: 20, meets: 11, message: OLD_WORDING } });
  assert.equal(outcome.barMessage, '');
  assert.equal(outcome.message, '');
  assert.equal(outcome.found, 20);
  assert.equal(outcome.meets, 11);
  assert.equal(qualityBarCountText(outcome.found, outcome.meets, outcome.mode), '11 of 20 use cases meet the Good quality bar');
});

test('a stored run message that carries the count keeps only what it adds', () => {
  const outcome = runOutcomeOf({ run_status: 'warning', run_message: 'Completed: 0 of 6 use cases meet the High quality bar; 2 tables have no rows yet: a, b',
    quality_bar: { mode: 'High', found: 6, meets: 0 } });
  assert.equal(outcome.message, 'Completed: 2 tables have no rows yet: a, b');
  assert.doesNotMatch(outcome.message, /of 6 use cases/);
});

test('the rest of a stored bar message is kept: what was found and the reason', () => {
  const outcome = runOutcomeOf({ quality_bar: { mode: 'High', found: 6, meets: 0,
    message: '0 of 6 use cases meet the High quality bar. Here is what we found, each marked with its reason' } });
  assert.equal(outcome.barMessage, 'Here is what we found, each marked with its reason');
});

test('withoutStoredCount removes every wording of the count and leaves text without a count alone', () => {
  assert.equal(withoutStoredCount('1 of 1 use case meets the Ultra High quality bar'), '');
  assert.equal(withoutStoredCount('3 of 6 use cases meet the quality bar'), '');
  assert.equal(withoutStoredCount('11 of 20 use cases found meet your Good bar'), '');
  assert.equal(withoutStoredCount('2 tables have no rows yet'), '2 tables have no rows yet');
  assert.equal(withoutStoredCount(null), '');
});
