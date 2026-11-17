// REQ-409 over HTTP, in run-as-me: the Build start (implement rerun) and the Build's run lists start and read the installed job with the App's
// token, never the person's; the Genie Code check reports unchecked (not refused) in run-as mode and blocks nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const SP = 'sp-token';
const PERSON = 'tok';
const IMPLEMENT_JOB = '77';
const SPEC = { use_case_id: 'N01-U01', use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' }, outputs: { dashboard: true } };
const HISTORY = [
  { spec_version: 3, status: 'ready', use_case_id: 'N01-U01', job_id: 77, spec_json: JSON.stringify(SPEC), genie_widgets: null },
  { spec_version: 1, status: 'ready', use_case_id: 'N01-U01', job_id: 77, spec_json: JSON.stringify(SPEC),
    genie_widgets: JSON.stringify([{ name: 'top_k', type: 'text', default: '25', allowed: 'whole number, at least 1' }]) }];
const NO_GENIE = { answer: () => [{ error_code: 'RESOURCE_DOES_NOT_EXIST', message: 'no such model' }, 404] };

// The installed job belongs to the installer: only the App's token starts, reads and lists its runs.
function refusePersonOnInstalledJob(state) {
  state.workspace = ({ token, path }) => {
    if (token === PERSON && (path.startsWith('/api/2.1/jobs/run-now') || path.startsWith('/api/2.1/jobs/runs/list'))) {
      return [{ error_code: 'PERMISSION_DENIED', message: 'Permission denied: CAN_MANAGE_RUN on the job' }, 403];
    }
    if (path.startsWith('/api/2.1/jobs/runs/list')) return [{ runs: [{ run_id: 9, state: { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS' } }] }, 200];
    return undefined;
  };
}

async function withRunAs(overrides, fn) {
  const saved = { run: process.env.INSPIRE_RUN_AS_PERSON, job: process.env.INSPIRE_JOB_ID_IMPLEMENT };
  process.env.INSPIRE_RUN_AS_PERSON = '1';
  process.env.INSPIRE_JOB_ID_IMPLEMENT = IMPLEMENT_JOB;
  try {
    const made = makeApp({ history: HISTORY, runAs: { env: { INSPIRE_JOB_ID_IMPLEMENT: IMPLEMENT_JOB }, appToken: SP }, ...overrides });
    const srv = await listen(made.app);
    try {
      await fn(srv.url, made);
    } finally {
      await srv.close();
    }
  } finally {
    if (saved.run === undefined) delete process.env.INSPIRE_RUN_AS_PERSON; else process.env.INSPIRE_RUN_AS_PERSON = saved.run;
    if (saved.job === undefined) delete process.env.INSPIRE_JOB_ID_IMPLEMENT; else process.env.INSPIRE_JOB_ID_IMPLEMENT = saved.job;
  }
}

async function call(base, p, opts = {}) {
  const resp = await fetch(base + p, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await resp.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* plain text */ }
  return { status: resp.status, data };
}

test('REQ-409 Build start: the rerun that starts the installed Implement job uses the App token, and the person token is refused there', async () => {
  await withRunAs({ workspace: null }, async (url, made) => {
    refusePersonOnInstalledJob(made.state || {});
    const got = await call(url, `/api/inspire/implement/rerun?${Q}`, { method: 'POST', body: { overrides: { top_k: '10' } } });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    const runNow = made.fetches.filter((f) => f.path === '/api/2.1/jobs/run-now');
    assert.equal(runNow.length, 1);
    assert.equal(runNow[0].token, SP, 'the installed job is started with the App token');
  });
});

test('REQ-409 Build\'s run list reads the installed job with the App token, not the person token', async () => {
  await withRunAs({ workspace: null }, async (url, made) => {
    refusePersonOnInstalledJob(made.state || {});
    const got = await call(url, `/api/inspire/implement/status?${Q}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    const lists = made.fetches.filter((f) => f.path.startsWith('/api/2.1/jobs/runs/list'));
    assert.ok(lists.length >= 1, 'the status route lists the job runs');
    assert.ok(lists.every((f) => f.token === SP), `every runs list on the installed job uses the App token: ${JSON.stringify(lists.map((f) => f.token))}`);
  });
});

test('REQ-409 Genie Code in run-as mode: the context and the submit report the check unchecked, and the build is not refused', async () => {
  await withRunAs({ gateway: NO_GENIE, workspace: null }, async (url, made) => {
    refusePersonOnInstalledJob(made.state || {});
    const context = await call(url, `/api/inspire/implement/context?${Q}`);
    assert.equal(context.status, 200, JSON.stringify(context.data));
    assert.equal(context.data.features.genie_code.available, null, 'unchecked, not refused');
    assert.match(context.data.features.genie_code.reason, /run-as mode: the run checks its AI model as the installer/);
    const submit = await call(url, '/api/inspire/implement/submit', { method: 'POST',
      body: { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: SPEC } });
    assert.equal(submit.status, 200, `the build is not refused by the Genie check in run-as mode: ${JSON.stringify(submit.data)}`);
  });
});

test('REQ-409 Genie Code outside run-as: the same missing model still refuses the submit (REQ-405, unchanged)', async () => {
  const saved = process.env.INSPIRE_RUN_AS_PERSON;
  delete process.env.INSPIRE_RUN_AS_PERSON;
  try {
    const made = makeApp({ history: HISTORY, gateway: NO_GENIE });
    const srv = await listen(made.app);
    try {
      const context = await call(srv.url, `/api/inspire/implement/context?${Q}`);
      assert.equal(context.data.features.genie_code.available, false);
      const submit = await call(srv.url, '/api/inspire/implement/submit', { method: 'POST',
        body: { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: SPEC } });
      assert.equal(submit.status, 409);
    } finally {
      await srv.close();
    }
  } finally {
    if (saved !== undefined) process.env.INSPIRE_RUN_AS_PERSON = saved;
  }
});

// REQ-409 item 1: the job-level cancel (cancel-all) and the owner read of the installed job use the App's token in run-as mode.
const MVP_JOB = { job_id: 77, settings: { tags: { dbx_inspire_ai_run_type: 'implement', dbx_inspire_ai_session_id: '42', dbx_inspire_ai_usecase_id: 'N01-U01' },
  schedule: { quartz_cron_expression: '0 0 6 * * ?', timezone_id: 'Europe/London', pause_status: 'PAUSED' } } };
const LIVE_HISTORY = [{ spec_version: 2, status: 'ready', spec_json: JSON.stringify(SPEC), use_case_id: 'N01-U01', job_id: '77', implement_run_id: '900' }];

test('REQ-409 item 1: a job-level cancel of the installed job reads its owner and cancels its runs with the App token, never the person token', async () => {
  const saved = { run: process.env.INSPIRE_RUN_AS_PERSON, job: process.env.INSPIRE_JOB_ID_IMPLEMENT };
  process.env.INSPIRE_RUN_AS_PERSON = '1';
  process.env.INSPIRE_JOB_ID_IMPLEMENT = IMPLEMENT_JOB;
  try {
    const made = makeApp({ history: LIVE_HISTORY, responses: { 'GET /api/2.1/jobs/get': [MVP_JOB] },
      runAs: { env: { INSPIRE_JOB_ID_IMPLEMENT: IMPLEMENT_JOB }, appToken: SP } });
    made.state.workspace = ({ token, path, method }) => {
      if (token === PERSON && (path.startsWith('/api/2.1/jobs/runs/cancel-all') || path.startsWith('/api/2.1/jobs/get'))) {
        return [{ error_code: 'PERMISSION_DENIED', message: 'Permission denied: CAN_MANAGE on the job' }, 403];
      }
      if (token === SP && path.startsWith('/api/2.1/jobs/runs/cancel-all') && method === 'POST') return [{}, 200];
      return undefined;
    };
    const srv = await listen(made.app);
    try {
      const got = await call(srv.url, `/api/inspire/implement/control?${Q}`, { method: 'POST', body: { asset: 'job', action: 'cancel' } });
      assert.equal(got.status, 200, JSON.stringify(got.data));
      const cancels = made.fetches.filter((f) => f.path.startsWith('/api/2.1/jobs/runs/cancel-all'));
      assert.equal(cancels.length, 1);
      assert.equal(cancels[0].token, SP, 'the job-level cancel carries the App token');
      const owners = made.fetches.filter((f) => f.path.startsWith('/api/2.1/jobs/get'));
      assert.ok(owners.length >= 1 && owners.every((f) => f.token === SP), `the owner read of the installed job uses the App token: ${JSON.stringify(owners.map((f) => f.token))}`);
    } finally {
      await srv.close();
    }
  } finally {
    if (saved.run === undefined) delete process.env.INSPIRE_RUN_AS_PERSON; else process.env.INSPIRE_RUN_AS_PERSON = saved.run;
    if (saved.job === undefined) delete process.env.INSPIRE_JOB_ID_IMPLEMENT; else process.env.INSPIRE_JOB_ID_IMPLEMENT = saved.job;
  }
});
