// REQ-405: a launch whose identity cannot query any chat model is stopped before the job exists, with the grant named.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

const OWN = '/Shared/inspire-test-app/dbx_inspire_ai_agent';
const body = () => ({ params: { '00_business_name': 'Acme', '02_inspire_database': S.APP_DB, '14_session_id': '7101' }, notebook_path: OWN });

test('a launch the App cannot query any chat model for is refused with Permission Required, and no job is created', async () => {
  S.reset({ notebookPresent: true, modelDenied: true });
  const got = await S.request('POST', '/api/run', { body: body() });
  assert.equal(got.status, 403, got.text);
  assert.ok(Array.isArray(got.data.permissions) && got.data.permissions.length === 1, got.text);
  assert.ok(got.data.permissions[0].steps.some((s) => s.includes('CAN_QUERY')), got.text);
  assert.equal(S.state.createdJob, null, 'no job is created');
});

test('the launch check names the same grant before the Launch button is pressed', async () => {
  S.reset({ notebookPresent: true, modelDenied: true });
  const got = await S.request('POST', '/api/run/check', { body: { params: body().params } });
  assert.equal(got.status, 200, got.text);
  assert.ok(got.data.permissions.some((p) => p.steps.some((s) => s.includes('CAN_QUERY'))), got.text);
});

test('a launch the App can query a chat model for starts with no permission entry', async () => {
  S.reset({ notebookPresent: true, modelDenied: false });
  const got = await S.request('POST', '/api/run', { body: body() });
  assert.equal(got.status, 200, got.text);
  assert.ok(S.state.createdJob, 'the job is created');
});
