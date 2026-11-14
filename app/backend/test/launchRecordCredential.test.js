// REQ-188 root cause: the route-policy gate runs before requireToken, so the launch-record reads it makes must take the App's own
// credential themselves. A read with no credential answers 401 "Credential was not sent", which Monitor saw as "no record".
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');

const PERSON = ['pat.lee', 'example.com'].join('@');
const NOTEBOOK = '/Workspace/Shared/inspire_ai/dbx_inspire_ai_agent';
const SP_TOKEN = 'sp-token';
const OUTPUT_FOLDERS = { '/Shared': { id: 1, writers: '*' }, '/Shared/inspire_out': { id: 7, writers: '*' } };
const NO_CREDENTIAL = 'Credential was not sent or was of an unsupported type for this API';

function workspaceAnswer(call) {
  if (call.path === '/oidc/v1/token') return [200, { access_token: SP_TOKEN, expires_in: 3600 }];
  if (call.path.startsWith('/api/2.0/preview/scim/v2/Me')) return [200, { userName: PERSON }];
  if (/^\/api\/2\.1\/unity-catalog\/tables\//.test(call.path)) return [200, { full_name: 'main.s.orders' }];
  if (call.path.split('?')[0] === '/api/2.0/workspace/get-status') {
    const at = new URL(`http://x${call.path}`).searchParams.get('path');
    return at === NOTEBOOK ? [200, { object_type: 'NOTEBOOK', path: NOTEBOOK }] : [200, { object_type: 'DIRECTORY', path: at }];
  }
  if (call.path === '/api/2.1/jobs/create') return [200, { job_id: 1111111111111111 }];
  if (call.path === '/api/2.0/permissions/jobs/1111111111111111') return [200, {}];
  if (call.path === '/api/2.1/jobs/run-now') return [200, { run_id: 99 }];
  if (call.path.startsWith('/api/2.1/jobs/runs/get')) return [200, { run_id: 99, run_name: 'Inspire AI - Acme', state: { life_cycle_state: 'RUNNING' } }];
  if (call.path === '/api/2.0/sql/statements') {
    const statement = String((call.body && call.body.statement) || '');
    // The App database reads and writes: the launch record is the only one this test follows.
    if (/^SELECT launched_by FROM/.test(statement)) {
      if (call.token !== SP_TOKEN) return [401, { error_code: 'UNAUTHENTICATED', message: NO_CREDENTIAL }];
      return [200, { statement_id: 's1', status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: [{ name: 'launched_by' }] } }, result: { data_array: [[PERSON]] } }];
    }
    return [200, { statement_id: 's1', status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: [{ name: 'num_inserted_rows' }] } }, result: { data_array: [['1']] } }];
  }
  return null;
}

const launchEnv = { DATABRICKS_HOST: '', NOTEBOOK_PATH: NOTEBOOK, NODE_ENV: 'production', INSPIRE_WAREHOUSE_ID: 'w1', INSPIRE_DATABASE: 'main._inspire',
  DATABRICKS_CLIENT_ID: 'inspire-client', DATABRICKS_CLIENT_SECRET: 'inspire-secret' };

test('after the person launches a run, the launch-record read for that run carries the same App credential as the launch INSERT and the run passes the gate (fail-pre: 503 with no credential)', async () => {
  const workspace = await fakeWorkspace(workspaceAnswer, { folders: OUTPUT_FOLDERS });
  const inspire = await startInspire({ ...launchEnv, DATABRICKS_HOST: workspace.url });
  try {
    const launched = await fetch(`${inspire.url}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-access-token': 'person-token', 'x-forwarded-email': PERSON },
      body: JSON.stringify({ params: { '00_business_name': 'Acme', '02_inspire_database': 'main._inspire', '01_uc_metadata': 'main.s.orders', '11_generation_path': '/Shared/inspire_out' } }),
    });
    assert.equal(launched.status, 200, await launched.text());
    const read = await fetch(`${inspire.url}/api/run/99`, { headers: { 'x-forwarded-access-token': 'person-token', 'x-forwarded-email': PERSON } });
    const body = await read.json();
    assert.equal(read.status, 200, JSON.stringify(body));
    assert.equal(body.run_id, 99);
    const insert = workspace.calls.find((c) => c.path === '/api/2.0/sql/statements' && /INSERT INTO .*__inspire_launch/.test(String(c.body && c.body.statement)));
    const select = workspace.calls.find((c) => c.path === '/api/2.0/sql/statements' && /^SELECT launched_by FROM/.test(String(c.body && c.body.statement)));
    assert.ok(insert, 'the launch record was written');
    assert.ok(select, 'the launch record was read');
    assert.equal(select.token, SP_TOKEN, 'the read carries the App credential, not none');
    assert.equal(select.token, insert.token, 'the read uses the same credential as the launch INSERT');
  } finally {
    await inspire.stop();
    await workspace.close();
  }
});

test('must-exclude: with no App credential at all, the run read fails closed with a plain 503 that tries again, never a 401, a crash, or "no record" (must-exclude)', async () => {
  const workspace = await fakeWorkspace(workspaceAnswer, { folders: OUTPUT_FOLDERS });
  const inspire = await startInspire({ ...launchEnv, DATABRICKS_HOST: workspace.url, DATABRICKS_CLIENT_ID: '', DATABRICKS_CLIENT_SECRET: '' });
  try {
    const read = await fetch(`${inspire.url}/api/run/99`, { headers: { 'x-forwarded-email': PERSON } });
    const body = await read.json();
    assert.equal(read.status, 503, JSON.stringify(body));
    assert.match(body.error, /^Inspire could not check its record of run 99 just now \(Inspire has no credential of its own/);
    assert.doesNotMatch(body.error, /no record of run|Credential was not sent/);
    assert.equal(workspace.calls.filter((c) => c.path === '/api/2.0/sql/statements').length, 0, 'no SQL call goes out without a credential');
  } finally {
    await inspire.stop();
    await workspace.close();
  }
});
