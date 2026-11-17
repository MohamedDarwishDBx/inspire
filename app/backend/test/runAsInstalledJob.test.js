// REQ-409: in run-as-me (schema mode) the installed jobs run as the installer, and only the App's service principal holds CAN_MANAGE_RUN.
// A person who is not the installer must still start, watch and cancel a run; the run-now, cancel and run reads of an installed job use the
// App's token. Everything else (SQL, files, Unity Catalog) keeps the signed-in person's token.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');

const SP_TOKEN = 'sp-token';
const PERSON = 'person-token';
const PERSON_EMAIL = 'run.person@example.com';
const INSTALLED_DISCOVER_JOB = '555';
const RUN = '99';
const APP_ENV = {
  NODE_ENV: 'production', DATABRICKS_CLIENT_ID: 'inspire-client', DATABRICKS_CLIENT_SECRET: 'inspire-secret', INSPIRE_WAREHOUSE_ID: 'wh',
  INSPIRE_RUN_AS_PERSON: '1', INSPIRE_JOB_ID_DISCOVER: INSPIRE_DISCOVER_JOB_ID(),
};
function INSPIRE_DISCOVER_JOB_ID() { return INSTALLED_DISCOVER_JOB; }
const signedIn = { 'x-forwarded-access-token': PERSON, 'x-forwarded-email': PERSON_EMAIL };
const DENIED = [400, { status: { state: 'FAILED', error: { message: "[INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table 'main.s.orders'." } } }];
const rows = (list) => {
  const keys = Object.keys(list[0] || { x: 1 });
  return [200, { status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: keys.map((name) => ({ name })) } },
    result: { data_array: list.map((r) => keys.map((k) => r[k])) } }];
};
// The person owns the table (as in the Discover tests), so Discover's read checks pass for the person.
const OWNS = [
  { level: 'catalog', privilege: 'OWNER', principal: PERSON_EMAIL, mine: 'true', me: PERSON_EMAIL },
  { level: 'catalog', privilege: 'USE_CATALOG', principal: 'account users', mine: 'true', me: PERSON_EMAIL },
  { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: PERSON_EMAIL },
  { level: 'table', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: PERSON_EMAIL },
];

// The installed job belongs to the installer: only the App's service principal may start, read and cancel its runs.
function workspaceFor(live) {
  return (call) => {
    const url = new URL(`http://x${call.path}`);
    if (call.path === '/oidc/v1/token') return [200, { access_token: SP_TOKEN, expires_in: 3600 }];
    if (url.pathname.startsWith('/api/2.0/preview/scim/v2/Me')) {
      return [200, call.token === SP_TOKEN ? { userName: 'sp-app-id', applicationId: 'sp-app-id', displayName: 'inspire-app' } : { userName: PERSON_EMAIL }];
    }
    if (/^\/api\/2\.1\/unity-catalog\/tables\//.test(url.pathname)) return [200, { full_name: decodeURIComponent(url.pathname.split('/').pop()) }];
    if (url.pathname === '/api/2.0/workspace/get-status' && url.searchParams.get('path') === '/Shared/inspire/dbx_inspire_ai_agent') {
      return [200, { object_type: 'NOTEBOOK', path: url.searchParams.get('path') }];
    }
    if (url.pathname === '/api/2.1/jobs/run-now') {
      live.runNow.push(call.token);
      return call.token === SP_TOKEN ? [200, { run_id: Number(RUN) }] : [403, { message: 'Permission denied: CAN_MANAGE_RUN on the job' }];
    }
    if (url.pathname === '/api/2.1/jobs/runs/get') {
      live.runGets.push(call.token);
      if (call.token !== SP_TOKEN) return [403, { message: 'Permission denied: run is not visible' }];
      return [200, { run_id: Number(RUN), job_id: Number(INSTALLED_DISCOVER_JOB), state: { life_cycle_state: 'RUNNING' } }];
    }
    if (url.pathname === '/api/2.1/jobs/runs/cancel') {
      live.cancels.push(call.token);
      return call.token === SP_TOKEN ? [200, {}] : [403, { message: 'Permission denied: CAN_MANAGE_RUN on the job' }];
    }
    if (url.pathname === '/api/2.0/sql/statements') {
      const sql = String((call.body && call.body.statement) || '');
      live.sql.push(call.token);
      if (/LIMIT 0/.test(sql)) return call.token === SP_TOKEN && !live.appReads ? DENIED : rows([]);
      if (/^GRANT /.test(sql)) {
        live.grants.push(sql);
        if (call.token === PERSON && sql.includes('`sp-app-id`')) live.appReads = true;
        return rows([]);
      }
      if (/information_schema/.test(sql)) return rows(call.token === PERSON ? OWNS : []);
      return rows([]);
    }
    return null;
  };
}

async function withRunAsApp(fn) {
  const live = { runNow: [], runGets: [], cancels: [], sql: [], grants: [], appReads: true };
  // The run's default output folder is writable by the person, as in a real install.
  const workspace = await fakeWorkspace(workspaceFor(live), { folders: { '/Shared': { id: 1, writers: '*' }, '/Shared/run_out': { id: 2, writers: '*' } } });
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url, NOTEBOOK_PATH: '/Shared/inspire/dbx_inspire_ai_agent', ...APP_ENV });
    return await fn(inspire.url, live);
  } finally {
    if (inspire) await inspire.stop();
    await workspace.close();
  }
}

test('REQ-409: a non-installer starts a run-as Discover on the installed job with the App token, and the person token is never used to start it', async () => {
  await withRunAsApp(async (url, live) => {
    const resp = await fetch(`${url}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...signedIn },
      body: JSON.stringify({ params: { '00_business_name': 'Acme', '02_inspire_database': 'main._inspire', '01_uc_metadata': 'main.s.orders', '11_generation_path': '/Shared/run_out' } }) });
    const data = await resp.json();
    assert.equal(resp.status, 200, JSON.stringify(data));
    assert.equal(data.run_id, RUN);
    assert.deepEqual(live.runNow, [SP_TOKEN], 'run-now carries the App service principal token only');
  });
});

test('REQ-409: SQL keeps the signed-in person token in run-as mode (no App token for SQL)', async () => {
  await withRunAsApp(async (url, live) => {
    await fetch(`${url}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...signedIn },
      body: JSON.stringify({ params: { '00_business_name': 'Acme', '02_inspire_database': 'main._inspire', '01_uc_metadata': 'main.s.orders', '11_generation_path': '/Shared/run_out' } }) });
    assert.ok(live.sql.length > 0, 'the launch writes its tracking rows with SQL');
    assert.ok(live.sql.every((t) => t === PERSON), `every SQL call uses the person token: ${JSON.stringify(live.sql)}`);
  });
});
