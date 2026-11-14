// REQ-180: one classifier decides whether a failed read can succeed on a retry (lib/sqlStatements.js). A warehouse that is starting,
// stopped or not yet running is transient; a denial or a missing object is not. The retry helper runs a read once more only then.
const test = require('node:test');
const assert = require('node:assert/strict');
const { isTransientSqlFailure, lookupWithRetry } = require('../lib/sqlStatements');

test('a warehouse that is starting, stopped or not yet running fails a read transiently (fail-pre: the classifier did not exist)', () => {
  assert.equal(isTransientSqlFailure(new Error('The warehouse is starting up, please wait a moment')), true);
  assert.equal(isTransientSqlFailure(new Error('SQL warehouse abc123 is stopped')), true);
  assert.equal(isTransientSqlFailure(new Error('Warehouse abc123 is not yet running')), true);
  assert.equal(isTransientSqlFailure(new Error('The SQL warehouse may be starting or waiting for compute')), true);
});

test('busy and down statuses, a timeout and a dropped network are transient; a denial or a missing object is not', () => {
  assert.equal(isTransientSqlFailure(new Error('SQL failed (429): too many requests')), true);
  assert.equal(isTransientSqlFailure(new Error('SQL failed (503): Service Unavailable')), true);
  assert.equal(isTransientSqlFailure(Object.assign(new Error('deadline'), { code: 'SQL_DEADLINE' })), true);
  assert.equal(isTransientSqlFailure(Object.assign(new Error('x did not answer'), { timedOut: true })), true);
  assert.equal(isTransientSqlFailure(new Error('Cannot reach Databricks at https://x (fetch failed)')), true);
  assert.equal(isTransientSqlFailure(new Error('SQL failed (403): [PERMISSION_DENIED] User does not have USE CATALOG on warehouse')), false,
    'a denial that names a warehouse is still a denial');
  assert.equal(isTransientSqlFailure(new Error('[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`s`.`x` cannot be found')), false);
  assert.equal(isTransientSqlFailure(new Error('SQL failed (400): syntax error')), false);
  assert.equal(isTransientSqlFailure(undefined), false);
});

test('lookupWithRetry retries a transient failure once and returns the value when the retry answers', async () => {
  let calls = 0;
  const got = await lookupWithRetry(async () => {
    calls += 1;
    if (calls === 1) throw new Error('SQL failed (503): busy');
    return ['ok'];
  }, { sleep: async () => {} });
  assert.deepEqual(got, { value: ['ok'] });
  assert.equal(calls, 2);
});

test('lookupWithRetry gives up after one retry on a transient failure, and never retries a permanent one', async () => {
  let calls = 0;
  const busy = await lookupWithRetry(async () => { calls += 1; throw new Error('SQL failed (503): busy'); }, { sleep: async () => {} });
  assert.deepEqual([busy.transient, calls], [true, 2]);
  calls = 0;
  const denied = await lookupWithRetry(async () => { calls += 1; throw new Error('SQL failed (403): PERMISSION_DENIED'); }, { sleep: async () => {} });
  assert.deepEqual([denied.transient, calls], [false, 1]);
});
