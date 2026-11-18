// REQ-354 follow-up, route level: GET .../implement/status deletes the Uninstall all run's own build job once that run is TERMINATED.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const UNINSTALL_ROW = { spec_version: 4, status: 'uninstalled', implement_run_id: 900, use_case_id: 'N01-U01', spec_json: { uninstall: true, use_case_id: 'N01-U01' }, asset_status: {} };
const TERMINATED = { run_id: 900, job_id: 555, state: { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS' } };

function deletesIn(recorder, answer = [{}, 200]) {
  return async ({ path, method, body }) => {
    if (method === 'POST' && path === '/api/2.2/jobs/delete') {
      recorder.push(body);
      return answer;
    }
    return undefined;
  };
}

async function status(srv) {
  const resp = await fetch(`${srv.url}/api/inspire/implement/status?${Q}`);
  assert.equal(resp.status, 200);
  return resp.json();
}

test('the Uninstall all run job is deleted once however many status reads see it terminal, and the card says nothing', async () => {
  const deleted = [];
  const { app } = makeApp({ history: [UNINSTALL_ROW], implementRun: TERMINATED, workspace: deletesIn(deleted) });
  const srv = await listen(app);
  try {
    const first = await status(srv);
    const second = await status(srv);
    assert.deepEqual(deleted, [{ job_id: 555 }], 'one delete, whatever the number of polls');
    assert.ok(!first.latest.status_message && !second.latest.status_message, 'no line on the card');
  } finally {
    await srv.close();
  }
});

test('while the uninstall run is still going its job is kept and nothing is deleted', async () => {
  const deleted = [];
  const running = { run_id: 900, job_id: 555, state: { life_cycle_state: 'RUNNING' } };
  const { app } = makeApp({ history: [UNINSTALL_ROW], implementRun: running, workspace: deletesIn(deleted) });
  const srv = await listen(app);
  try {
    const got = await status(srv);
    assert.deepEqual(deleted, []);
    assert.ok(!got.latest.status_message, 'no line on the card');
  } finally {
    await srv.close();
  }
});

test('a refused delete shows one line on the card and is not retried on the next read', async () => {
  const deleted = [];
  const refusal = [{ error_code: 'PERMISSION_DENIED', message: 'User does not have CAN_MANAGE on job 555' }, 403];
  const { app } = makeApp({ history: [UNINSTALL_ROW], implementRun: TERMINATED, workspace: deletesIn(deleted, refusal) });
  const srv = await listen(app);
  try {
    const first = await status(srv);
    const second = await status(srv);
    assert.equal(deleted.length, 1, 'answered once, not on every read');
    assert.equal(first.latest.status_message, 'build job 555 of this uninstall could not be deleted (User does not have CAN_MANAGE on job 555), so it stays in Jobs; delete it there.');
    assert.equal(second.latest.status_message, first.latest.status_message);
  } finally {
    await srv.close();
  }
});
