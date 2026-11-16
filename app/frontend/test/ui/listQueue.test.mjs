import test from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, isNetworkFailure, queuedListing } from '../../src/lib/listQueue.js';

// REQ-378: a whole-catalog pick lists every schema; the listing requests must not all be in flight at once.
test('the limiter keeps at most N listing requests in flight, and runs the rest as they finish', async () => {
  const limit = createLimiter(3);
  let inFlight = 0;
  let peak = 0;
  const one = (i) => limit(async () => { inFlight += 1; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight -= 1; return i; });
  const got = await Promise.all(Array.from({ length: 20 }, (_, i) => one(i)));
  assert.equal(peak, 3, 'at most 3 at once (a planted burst of 20 would show 20)');
  assert.deepEqual(got, Array.from({ length: 20 }, (_, i) => i));
});

test('a network failure is tried once more; a refusal from the App is not retried', async () => {
  let calls = 0;
  const flaky = () => { calls += 1; return calls === 1 ? Promise.reject(Object.assign(new TypeError('Failed to fetch'), {})) : Promise.resolve('ok'); };
  assert.equal(await queuedListing(createLimiter(3), flaky), 'ok');
  assert.equal(calls, 2);
  let refused = 0;
  const denied = () => { refused += 1; return Promise.reject(Object.assign(new Error('User does not have USE SCHEMA'), { status: 403 })); };
  await assert.rejects(queuedListing(createLimiter(3), denied));
  assert.equal(refused, 1, 'no retry for a refusal');
  assert.equal(isNetworkFailure(new Error('Failed to fetch')), true);
  assert.equal(isNetworkFailure(Object.assign(new Error('Failed to fetch'), { status: 500 })), false);
});
