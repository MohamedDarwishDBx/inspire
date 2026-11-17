// REQ-387: the catalog's schema list never offers a use case's own result schema (`_inspire_<business>_<use case>`).
// The Inspire database `_inspire` itself and the person's schemas stay listed. Runs the real server against a fake workspace.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');
const { isInspireOwnSchema } = require('../../frontend/src/lib/inspireOwnObjects.js');

const SP_TOKEN = 'sp-token';
const PERSON = 'person-token';
const PERSON_EMAIL = ['pat.lee', 'example.com'].join('@');
const APP_ENV = { NODE_ENV: 'production', DATABRICKS_CLIENT_ID: 'inspire-client', DATABRICKS_CLIENT_SECRET: 'inspire-secret' };
// REST lists one own schema; SHOW SCHEMAS (the SQL merge) adds another, so both paths into the list are covered.
const REST_SCHEMAS = ['_inspire', '_inspire_acme_n01_u01', 'sales', 'inspire_notes'];
const SQL_SCHEMAS = ['_inspire', '_INSPIRE_walk_n02_u04', 'sales', 'finance'];

function answer(call) {
  const url = new URL(`http://x${call.path}`);
  if (call.path === '/oidc/v1/token') return [200, { access_token: SP_TOKEN, expires_in: 3600 }];
  if (call.path.startsWith('/api/2.0/preview/scim/v2/Me')) return [200, call.token === SP_TOKEN ? { userName: 'sp', applicationId: 'sp' } : { userName: PERSON_EMAIL }];
  if (url.pathname === '/api/2.1/unity-catalog/schemas') return [200, { schemas: REST_SCHEMAS.map((name) => ({ name })) }];
  const statement = String(call.body && call.body.statement);
  if (url.pathname === '/api/2.0/sql/statements' && /^SHOW SCHEMAS IN/.test(statement)) {
    return [200, { status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: [{ name: 'databaseName' }] } },
      result: { data_array: SQL_SCHEMAS.map((v) => [v]) } }];
  }
  return null;
}

test('the rule names a use case result schema and keeps the Inspire database and look-alike person schemas (REQ-387)', () => {
  for (const name of ['_inspire_acme_n01_u01', 'main._inspire_w9_joined_n02_u04', '`main`.`_INSPIRE_x`']) assert.equal(isInspireOwnSchema(name), true, name);
  for (const name of ['_inspire', 'main._inspire', 'inspire_notes', 'sales', 'main.my_inspire_', '', null]) assert.equal(isInspireOwnSchema(name), false, String(name));
});

test('GET /api/catalogs/:catalog/schemas hides use case result schemas from REST and SQL, and keeps the rest (REQ-387)', async () => {
  const workspace = await fakeWorkspace(answer);
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url, NOTEBOOK_PATH: '/Shared/inspire/dbx_inspire_ai_agent', ...APP_ENV });
    const resp = await fetch(`${inspire.url}/api/catalogs/main/schemas?warehouse_id=wh`,
      { headers: { 'x-forwarded-access-token': PERSON, 'x-forwarded-email': PERSON_EMAIL } });
    const data = await resp.json();
    assert.equal(resp.status, 200, JSON.stringify(data));
    assert.deepEqual(data.schemas.map((s) => s.full_name), ['main._inspire', 'main.finance', 'main.inspire_notes', 'main.sales']);
    assert.equal(data.count, 4);
  } finally {
    if (inspire) await inspire.stop();
    await workspace.close();
  }
});
