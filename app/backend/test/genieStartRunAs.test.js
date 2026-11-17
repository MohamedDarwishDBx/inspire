// REQ-409 (Genie start, through the real server): POST /api/inspire/generate-genie in run-as-me starts the installed Genie job with the App's
// token (run-now) and never looks the job up by name. A run of another session does not block this session. Outside run-as the job is found
// by its session name and started with the signed-in person's token.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');

const SP_TOKEN = 'sp-token';
const PERSON = 'person-token';
const PERSON_EMAIL = ['run.person', 'example.com'].join('@');
const GENIE_JOB = '557';
const NOTEBOOK = '/Shared/inspire/dbx_inspire_ai_agent';
const BODY = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', use_case_ids: ['N01-U01'], notebook_path: NOTEBOOK };
const SESSION = { session_id: 42, business_name: 'Acme', inspire_database_name: 'main.inspire', processing_status: 'ready',
  tables_str: 'main.s.orders', generation_path: '/Shared/run_out', discovery_type: 'AI Enhanced Discovery' };
const signedIn = { 'x-forwarded-access-token': PERSON, 'x-forwarded-email': PERSON_EMAIL };

const rows = (list) => {
  const keys = Object.keys(list[0] || { x: 1 });
  return [200, { status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: keys.map((name) => ({ name })) } },
    result: { data_array: list.map((r) => keys.map((k) => r[k])) } }];
};

// The installed Genie job is the installer's: only the App's token starts it and lists its runs. `genieRuns` are the job's runs.
function workspaceFor(live, genieRuns, runAs) {
  return (call) => {
    const url = new URL(`http://x${call.path}`);
    if (call.path === '/oidc/v1/token') return [200, { access_token: SP_TOKEN, expires_in: 3600 }];
    if (url.pathname.startsWith('/api/2.0/preview/scim/v2/Me')) {
      return [200, call.token === SP_TOKEN ? { userName: 'sp-app-id', applicationId: 'sp-app-id', displayName: 'inspire-app' } : { userName: PERSON_EMAIL }];
    }
    if (/^\/api\/2\.1\/unity-catalog\/tables\//.test(url.pathname)) return [200, { full_name: decodeURIComponent(url.pathname.split('/').pop()) }];
    if (url.pathname === '/api/2.0/workspace/get-status' && url.searchParams.get('path') === NOTEBOOK) return [200, { object_type: 'NOTEBOOK', path: NOTEBOOK }];
    if (url.pathname === '/api/2.1/jobs/run-now') {
      live.runNow.push(call.token);
      if (!runAs) return [200, { run_id: 98 }];
      return call.token === SP_TOKEN ? [200, { run_id: 99 }] : [403, { message: 'Permission denied: CAN_MANAGE_RUN on the job' }];
    }
    if (url.pathname === '/api/2.1/jobs/runs/list') {
      live.runsList.push({ token: call.token, job: url.searchParams.get('job_id') });
      if (url.searchParams.get('job_id') !== GENIE_JOB) return [200, { runs: [] }];
      return call.token === SP_TOKEN ? [200, { runs: genieRuns }] : [403, { message: 'Permission denied: the run is not visible' }];
    }
    if (url.pathname === '/api/2.1/jobs/create') return [200, { job_id: 700 }];
    if (url.pathname === '/api/2.1/jobs/list') {
      live.jobsList.push(call.token);
      return [200, { jobs: [] }];
    }
    if (url.pathname === '/api/2.0/sql/statements') {
      const sql = String((call.body && call.body.statement) || '');
      if (/__inspire_session/.test(sql)) return rows([SESSION]);
      // The launch ledger names the person who launched this session (the launcher may manage its own unbuilt session).
      if (/launched_by/.test(sql)) return rows([{ launched_by: PERSON_EMAIL }]);
      return rows([]);
    }
    return null;
  };
}

async function startGenie({ runAs, genieRuns = [] }, fn) {
  const saved = { run: process.env.INSPIRE_RUN_AS_PERSON, job: process.env.INSPIRE_JOB_ID_GENIE };
  if (runAs) {
    process.env.INSPIRE_RUN_AS_PERSON = '1';
    process.env.INSPIRE_JOB_ID_GENIE = GENIE_JOB;
  } else {
    delete process.env.INSPIRE_RUN_AS_PERSON;
    delete process.env.INSPIRE_JOB_ID_GENIE;
  }
  const live = { runNow: [], runsList: [], jobsList: [] };
  const workspace = await fakeWorkspace(workspaceFor(live, genieRuns, runAs), { folders: { '/Shared': { id: 1, writers: '*' }, '/Shared/run_out': { id: 2, writers: '*' } } });
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url, NOTEBOOK_PATH: NOTEBOOK, DATABRICKS_CLIENT_ID: 'inspire-client',
      DATABRICKS_CLIENT_SECRET: 'inspire-secret', INSPIRE_WAREHOUSE_ID: 'wh', INSPIRE_RUN_AS_PERSON: runAs ? '1' : '',
      INSPIRE_JOB_ID_GENIE: runAs ? GENIE_JOB : '' });
    const resp = await fetch(`${inspire.url}/api/inspire/generate-genie`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...signedIn },
      body: JSON.stringify(BODY) });
    const data = await resp.json().catch(() => ({}));
    await fn({ status: resp.status, data }, live);
  } finally {
    if (inspire) await inspire.stop();
    await workspace.close();
    if (saved.run === undefined) delete process.env.INSPIRE_RUN_AS_PERSON; else process.env.INSPIRE_RUN_AS_PERSON = saved.run;
    if (saved.job === undefined) delete process.env.INSPIRE_JOB_ID_GENIE; else process.env.INSPIRE_JOB_ID_GENIE = saved.job;
  }
}

test('REQ-409 Genie start in run-as mode: the installed Genie job is started with the App token and never looked up by name', async () => {
  await startGenie({ runAs: true }, async (got, live) => {
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(live.runNow, [SP_TOKEN], 'run-now carries the App token only');
    assert.equal(live.jobsList.length, 0, 'run-as never looks the Genie job up by name');
  });
});

test('REQ-409 Genie start in run-as mode: a Genie run of this session blocks the start, a run of another session does not', async () => {
  const mine = [{ run_id: 7, job_id: Number(GENIE_JOB), overriding_parameters: { notebook_params: { '14_session_id': '42' } },
    state: { life_cycle_state: 'RUNNING', result_state: null } }];
  await startGenie({ runAs: true, genieRuns: mine }, async (got, live) => {
    assert.equal(got.status, 409, JSON.stringify(got.data));
    assert.equal(got.data.run_id, 7);
    assert.deepEqual(live.runNow, [], 'a blocked start runs nothing');
    assert.ok(live.runsList.every((r) => r.token === SP_TOKEN && r.job === GENIE_JOB), 'the session check reads the installed job with the App token');
  });
  const others = [{ run_id: 8, job_id: Number(GENIE_JOB), overriding_parameters: { notebook_params: { '14_session_id': '43' } },
    state: { life_cycle_state: 'RUNNING', result_state: null } }];
  await startGenie({ runAs: true, genieRuns: others }, async (got) => {
    assert.equal(got.status, 200, `another session's run does not block this one: ${JSON.stringify(got.data)}`);
  });
});

test('REQ-409 Genie start outside run-as: the job is found by its session name and started with the person token (unchanged)', async () => {
  await startGenie({ runAs: false }, async (got, live) => {
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.ok(live.jobsList.length >= 1 && live.jobsList.every((t) => t === PERSON), 'the name lookup uses the person token');
    assert.ok(live.runNow.every((t) => t === PERSON), `outside run-as every start uses the person token: ${JSON.stringify(live.runNow)}`);
  });
});
