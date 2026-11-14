// REQ-188 gaps: a launch whose session check cannot read the launch record answers 503 (never a permanent "already exists" refusal),
// and a run whose launch record cannot be written is never left running with nobody able to cancel it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');
const { LAUNCH_PARAMS, LAUNCH_ENV, PERSON_HEADERS, OUTPUT_FOLDERS, launchWorkspaceAnswer, statementOf } = require('./support/launchWorkspace');

const SESSION_PARAMS = { ...LAUNCH_PARAMS, '14_session_id': '1001' };
const RECORD_WRITE_FAILED = 'Inspire started run 99 but could not record it, so Cancel and Run again may refuse it';

async function launch(answer, { env = {}, params = LAUNCH_PARAMS } = {}) {
  const workspace = await fakeWorkspace(answer, { folders: OUTPUT_FOLDERS });
  const inspire = await startInspire({ ...LAUNCH_ENV, DATABRICKS_HOST: workspace.url, ...env });
  try {
    const resp = await fetch(`${inspire.url}/api/run`, { method: 'POST', headers: PERSON_HEADERS, body: JSON.stringify({ params }) });
    return { status: resp.status, body: await resp.json(), calls: workspace.calls };
  } finally {
    await inspire.stop();
    await workspace.close();
  }
}

const submitted = (calls) => calls.filter((c) => c.path === '/api/2.1/jobs/run-now').length;
const cancels = (calls) => calls.filter((c) => c.path === '/api/2.1/jobs/runs/cancel');

test('(1) an existing session whose launch record cannot be read answers 503 "try again" and submits nothing (fail-pre: 403 "already exists and Inspire has no record of who launched it")', async () => {
  const got = await launch(launchWorkspaceAnswer({ ledgerFails: true }), { params: SESSION_PARAMS });
  assert.equal(got.status, 503, JSON.stringify(got.body));
  assert.match(got.body.error, /^Inspire could not read the launch record of session 1001 just now \(.+\), so it cannot tell whether this may be launched; try again$/);
  assert.doesNotMatch(got.body.error, /already exists|no record of who launched/);
  assert.equal(submitted(got.calls), 0, 'no run is submitted when the check cannot read');
});

test('(2a) a launch record that cannot be written twice stops the run and answers 503, so no unrecorded run stays (fail-pre: 200 with the run left running and unrecorded)', async () => {
  const got = await launch(launchWorkspaceAnswer({ insertFails: true }));
  assert.equal(got.status, 503, JSON.stringify(got.body));
  assert.equal(got.body.error, 'Inspire could not record run 99, so it asked Databricks to stop the run. Start it again.');
  assert.equal(submitted(got.calls), 1, 'the run was submitted');
  const stop = cancels(got.calls);
  assert.equal(stop.length, 1, 'the run is asked to stop');
  assert.deepEqual(stop[0].body, { run_id: 99 });
  assert.equal(got.calls.filter((c) => c.path === '/api/2.0/sql/statements' && /^INSERT INTO .*__inspire_launch/.test(statementOf(c))).length, 2, 'the write is retried once');
});

test('(2b) when the stop is refused too, the launch answers 200 with a warning that names the run (fail-pre: no warning at all)', async () => {
  const got = await launch(launchWorkspaceAnswer({ insertFails: true, cancelStatus: 500 }));
  assert.equal(got.status, 200, JSON.stringify(got.body));
  assert.equal(String(got.body.run_id), '99');
  assert.equal(got.body.launcher_recorded, false);
  assert.ok((got.body.warnings || []).includes(RECORD_WRITE_FAILED), `warnings: ${JSON.stringify(got.body.warnings)}`);
  assert.equal(cancels(got.calls).length, 1, 'the stop was attempted');
});

test('must-exclude: with no App database configured, nothing is recorded by design and no run is stopped (the stop is only for a failed write)', async () => {
  const got = await launch(launchWorkspaceAnswer(), { env: { INSPIRE_DATABASE: '' } });
  assert.equal(got.status, 200, JSON.stringify(got.body));
  assert.equal(got.body.launcher_recorded, false);
  assert.equal(cancels(got.calls).length, 0, 'a missing database is not a failed write');
});
