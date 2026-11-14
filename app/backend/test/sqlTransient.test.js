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

// REQ-180 (structured first): the Statement Execution API reports a failed statement as HTTP 200 with status.state FAILED and
// status.error.error_code (14 documented codes), and a rejected request as a non-200 with the body { error_code, message }. The
// classifier reads those fields before any message text (docs: /api/workspace/statementexecution/executestatement, /api/workspace/errors).
test('a documented transient error_code is transient whatever the text says (fail-pre: the classifier read only the text)', () => {
  const codes = ['TEMPORARILY_UNAVAILABLE', 'WORKSPACE_TEMPORARILY_UNAVAILABLE', 'SERVICE_UNDER_MAINTENANCE', 'RESOURCE_EXHAUSTED', 'DEADLINE_EXCEEDED'];
  for (const error_code of codes) {
    assert.equal(isTransientSqlFailure(Object.assign(new Error('Service is unavailable right now'), { error_code })), true, error_code);
  }
});

test('a documented permanent error_code is permanent even when the text names a warehouse that is stopped (fail-pre: text won)', () => {
  const stopped = 'User does not have CAN USE on warehouse abc123; the warehouse is stopped';
  for (const error_code of ['PERMISSION_DENIED', 'UNAUTHENTICATED', 'NOT_FOUND', 'INVALID_PARAMETER_VALUE']) {
    assert.equal(isTransientSqlFailure(Object.assign(new Error(stopped), { error_code, http_status: 403 })), false, error_code);
  }
});

test('the HTTP status of a rejected request decides before the text: a 400 is not transient, a 503 is, with no text at all (fail-pre)', () => {
  assert.equal(isTransientSqlFailure(Object.assign(new Error('The warehouse is starting'), { http_status: 400 })), false);
  assert.equal(isTransientSqlFailure(Object.assign(new Error('Service Unavailable'), { http_status: 503 })), true);
  assert.equal(isTransientSqlFailure(Object.assign(new Error('x'), { http_status: 429 })), true);
});

test('a FAILED statement with no documented code (BAD_REQUEST, INTERNAL_ERROR) falls back to the warehouse text (pass-post guard: the fallback stays)', () => {
  assert.equal(isTransientSqlFailure(Object.assign(new Error('The SQL warehouse is starting up'), { error_code: 'BAD_REQUEST' })), true);
  assert.equal(isTransientSqlFailure(Object.assign(new Error('Warehouse abc123 is stopped'), { error_code: 'INTERNAL_ERROR' })), true);
  assert.equal(isTransientSqlFailure(Object.assign(new Error('[TABLE_OR_VIEW_NOT_FOUND] no table'), { error_code: 'BAD_REQUEST' })), false);
});

test('a read that fails with a documented error_code through the one SQL runner is classified from the API body (fail-pre)', async () => {
  const { createExecuteSql } = require('../lib/sqlStatements');
  const sleep = async () => {};
  const failedState = async () => ({ ok: true, status: 200, json: async () => ({ statement_id: 's1',
    status: { state: 'FAILED', error: { error_code: 'TEMPORARILY_UNAVAILABLE', message: 'Service is unavailable right now' }, sql_state: '08001' } }), text: async () => '' });
  const executeFailed = createExecuteSql(failedState, { sleep });
  const failed = await executeFailed('h', 't', 'wh', 'SELECT 1').then(() => null, (e) => e);
  assert.equal(failed.error_code, 'TEMPORARILY_UNAVAILABLE', 'the statement error keeps its documented code');
  assert.equal(failed.sql_state, '08001', 'and its SQLSTATE');
  assert.equal(isTransientSqlFailure(failed), true);

  // A denial whose text says the warehouse is stopped: the body's PERMISSION_DENIED decides, so the read is not retried.
  const denied = async () => ({ ok: false, status: 403, json: async () => ({}),
    text: async () => JSON.stringify({ error_code: 'PERMISSION_DENIED', message: 'User cannot use warehouse wh; it is stopped' }) });
  const refused = await createExecuteSql(denied, { sleep })('h', 't', 'wh', 'SELECT 1').then(() => null, (e) => e);
  assert.equal(refused.http_status, 403);
  assert.equal(refused.error_code, 'PERMISSION_DENIED');
  assert.equal(isTransientSqlFailure(refused), false, 'a denial is not retried, whatever the text');
});

// REQ-180 (quota): the errors page says a RESOURCE_EXHAUSTED answer is not retried automatically, because quota can take hours to clear.
// It stays a busy state the person can check again (Try again), never a verdict on the table. A bare HTTP 429 keeps the one bounded retry.
test('a RESOURCE_EXHAUSTED read is busy and is not retried automatically (fail-pre: it was retried)', async () => {
  let calls = 0;
  const quota = await lookupWithRetry(async () => {
    calls += 1;
    throw Object.assign(new Error('Rate limit exceeded'), { error_code: 'RESOURCE_EXHAUSTED', http_status: 429 });
  }, { sleep: async () => {} });
  assert.deepEqual([quota.transient, calls, quota.error.error_code], [true, 1, 'RESOURCE_EXHAUSTED'], 'busy, asked once, Try again offered');
});

test('a bare HTTP 429 still gets the one bounded automatic retry (pass-post guard)', async () => {
  let calls = 0;
  const bare = await lookupWithRetry(async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('SQL failed (429): too many requests'), { http_status: 429 });
    return ['ok'];
  }, { sleep: async () => {} });
  assert.deepEqual([bare, calls], [{ value: ['ok'] }, 2]);
});
