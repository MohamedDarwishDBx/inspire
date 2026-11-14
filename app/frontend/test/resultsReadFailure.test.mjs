// REQ-188 follow-up: the Results page shows a policy refusal or a retry as the server said it, and the denied review link only for a real access denial.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resultsReadFailure, reviewLinkText } from '../src/lib/runPages.js';

const SID = '1234567890123456789';
const DB = 'main._inspire';
const policy403 = Object.assign(new Error('Inspire has no record of this run, so it does not read it.'), { status: 403, body: { error: 'x', policy: { rule: 'recorded' } } });

test('(fail-pre) a policy 403 shows the server message, not the denied review link (HEAD returned "denied" for every 403)', () => {
  const got = resultsReadFailure(policy403, { sid: SID, inspireDb: DB });
  assert.equal(got.outcome, 'refused');
  assert.equal(got.message, 'Inspire has no record of this run, so it does not read it.');
  assert.doesNotMatch(got.message, /read access/);
});

test('a 503 says try again with the server message, never the denied link', () => {
  const err = Object.assign(new Error('Inspire could not check its record of run 9 just now; try again'), { status: 503, body: { error: 'x' } });
  assert.deepEqual(resultsReadFailure(err, { sid: SID, inspireDb: DB }), { outcome: 'retry', message: 'Inspire could not check its record of run 9 just now; try again' });
});

test('must-exclude: a real access denial (plain 403, no policy body) still shows the denied review link', () => {
  const denied = Object.assign(new Error('PERMISSION_DENIED: User does not have SELECT'), { status: 403, body: { error: 'PERMISSION_DENIED' } });
  const got = resultsReadFailure(denied, { sid: SID, inspireDb: DB });
  assert.equal(got.outcome, 'denied');
  assert.equal(got.message, reviewLinkText({ sessionId: SID, valid: true }, DB, 'denied'));
  assert.match(got.message, /no read access/);
});

test('a 403 with no run id stays a plain error, and other failures keep their message', () => {
  assert.equal(resultsReadFailure(Object.assign(new Error('nope'), { status: 403 }), {}).outcome, 'error');
  assert.deepEqual(resultsReadFailure(new Error('boom'), { sid: SID }), { outcome: 'error', message: 'boom' });
});
