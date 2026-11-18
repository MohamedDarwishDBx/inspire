// REQ-354 follow-up: the App deletes an Uninstall all run's own build job once the run is TERMINATED, once per job, and says so when it cannot.
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');

const UNINSTALL_ROW = { implement_run_id: 900, status: 'uninstalled', spec_version: 4, spec_json: { uninstall: true } };
const BUILD_ROW = { implement_run_id: 800, status: 'ready', spec_version: 3, spec_json: { uninstall: false } };
const terminal = (job_id = 555) => ({ job_id, state: { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS' } });
const running = (job_id = 555) => ({ job_id, state: { life_cycle_state: 'RUNNING' } });

function remover(answer) {
  const calls = [];
  const remove = async (jobId) => {
    calls.push(jobId);
    return answer(jobId);
  };
  return { calls, remove };
}

test('the uninstall run is recognised only when its row is an uninstall with a run id', () => {
  assert.equal(I.uninstallRunId(UNINSTALL_ROW), '900');
  assert.equal(I.uninstallRunId(BUILD_ROW), null, 'a build is never deleted this way');
  assert.equal(I.uninstallRunId({ implement_run_id: null, spec_json: { uninstall: true } }), null);
});

test('a terminal uninstall run deletes its own job once', async () => {
  const { calls, remove } = remover(async () => ({ ok: true, status: 200, data: {} }));
  const cache = new Map();
  const got = await I.settleUninstallRunJob({ row: UNINSTALL_ROW, run: terminal(555), remove, cache });
  assert.deepEqual(calls, ['555']);
  assert.deepEqual(got, { state: 'deleted', job_id: '555', message: '' });
});

test('a run that is still going keeps its job: nothing is deleted and no line is shown', async () => {
  const { calls, remove } = remover(async () => ({ ok: true, status: 200, data: {} }));
  assert.equal(await I.settleUninstallRunJob({ row: UNINSTALL_ROW, run: running(), remove, cache: new Map() }), null);
  assert.equal(await I.settleUninstallRunJob({ row: UNINSTALL_ROW, run: null, remove, cache: new Map() }), null);
  assert.deepEqual(calls, []);
});

test('repeated status reads, including ones that overlap, delete the job exactly once', async () => {
  const { calls, remove } = remover(async () => ({ ok: true, status: 200, data: {} }));
  const cache = new Map();
  const reads = await Promise.all([1, 2, 3].map(() => I.settleUninstallRunJob({ row: UNINSTALL_ROW, run: terminal(555), remove, cache })));
  await I.settleUninstallRunJob({ row: UNINSTALL_ROW, run: terminal(555), remove, cache });
  assert.deepEqual(calls, ['555'], 'one delete however many polls read the run');
  assert.ok(reads.every((r) => r.state === 'deleted'));
});

test('a job already gone (404) is deleted as far as Inspire is concerned, and says nothing', async () => {
  const { calls, remove } = remover(async () => ({ ok: false, status: 404, data: { error_code: 'RESOURCE_DOES_NOT_EXIST' } }));
  const got = await I.settleUninstallRunJob({ row: UNINSTALL_ROW, run: terminal(555), remove, cache: new Map() });
  assert.equal(calls.length, 1);
  assert.deepEqual(got, { state: 'deleted', job_id: '555', message: '' });
});

test('a permission refusal is one plain line naming the job, and it is not retried on every poll', async () => {
  const { calls, remove } = remover(async () => ({ ok: false, status: 403, data: { message: 'User does not have CAN_MANAGE on job 555' } }));
  const cache = new Map();
  const first = await I.settleUninstallRunJob({ row: UNINSTALL_ROW, run: terminal(555), remove, cache });
  const second = await I.settleUninstallRunJob({ row: UNINSTALL_ROW, run: terminal(555), remove, cache });
  assert.equal(first.state, 'failed');
  assert.equal(first.message, 'build job 555 of this uninstall could not be deleted (User does not have CAN_MANAGE on job 555), so it stays in Jobs; delete it there.');
  assert.deepEqual(second, first);
  assert.deepEqual(calls, ['555'], 'a refusal is answered once, not on every poll');
});

test('a thrown delete error is reported as a failure, not swallowed', async () => {
  const { remove } = remover(async () => { throw new Error('Cannot reach the workspace'); });
  const got = await I.settleUninstallRunJob({ row: UNINSTALL_ROW, run: terminal(555), remove, cache: new Map() });
  assert.equal(got.state, 'failed');
  assert.match(got.message, /Cannot reach the workspace/);
});

test('a terminal run whose job id cannot be read says so instead of staying silent', async () => {
  const { calls, remove } = remover(async () => ({ ok: true, status: 200, data: {} }));
  const got = await I.settleUninstallRunJob({ row: UNINSTALL_ROW, run: { state: { life_cycle_state: 'TERMINATED' } }, remove, cache: new Map() });
  assert.equal(got.state, 'unknown');
  assert.match(got.message, /could not read the build job/);
  assert.deepEqual(calls, []);
});

test('a build row never triggers a delete, even when its run is terminal', async () => {
  const { calls, remove } = remover(async () => ({ ok: true, status: 200, data: {} }));
  assert.equal(await I.settleUninstallRunJob({ row: BUILD_ROW, run: terminal(555), remove, cache: new Map() }), null);
  assert.deepEqual(calls, []);
});
