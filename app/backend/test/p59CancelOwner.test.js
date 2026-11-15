// REQ-231 (3): a CANCELED run reads as a person's Stop only with that person's control-log record; otherwise "stopped outside Inspire".
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');
const C = require('../lib/implementControl');

const NOW = Date.parse('2026-11-15T04:00:00Z');
const version = (status, extra = {}) => ({ spec_version: 4, status, implement_run_id: '77', job_id: '9001', use_case_id: 'uc1', updated_at: '2026-11-15T03:00:00.000Z', ...extra });
const cancelled = { state: { life_cycle_state: 'TERMINATED', result_state: 'CANCELED', state_message: 'Run cancelled by user' } };

test('case 1, a person pressed Stop: the status line names the person and never reads "by user"', () => {
  const got = I.implementStalled(version('filling'), cancelled, NOW, { person: 'amr.ali@example.com' });
  assert.equal(got.ended_by, 'user');
  assert.equal(got.reason, 'the run building v4 ended (stopped by amr.ali@example.com from the Build page) while v4 was still filling');
  assert.doesNotMatch(got.reason, /by user/);
});

test('case 2, Inspire stopped the run: the row Inspire already wrote is not replaced by a Databricks cancel line', () => {
  // The notebook writes its own "Stopped by Inspire because ..." text and status failed. The backend reads only active rows, so this one stays.
  const written = version('failed', { status_message: 'Stopped by Inspire because the preview run 77 was still running after 40 minutes, twice the 20-minute preview budget' });
  assert.equal(I.implementStalled(written, cancelled, NOW, null), null, 'a row Inspire ended is not re-read as a Databricks cancel');
  assert.match(written.status_message, /^Stopped by Inspire because /);
});

test('case 3, nothing was recorded: the run reads as stopped outside Inspire, never by a person', () => {
  const got = I.implementStalled(version('filling'), cancelled, NOW, null);
  assert.equal(got.ended_by, 'outside');
  assert.equal(got.reason, 'the run building v4 ended (stopped outside Inspire) while v4 was still filling');
  assert.doesNotMatch(got.reason, /by user|cancelled by user/);
});

test('a run that failed on its own keeps its own text and reads as system', () => {
  const failed = { state: { life_cycle_state: 'TERMINATED', result_state: 'FAILED', state_message: 'Workload failed' } };
  const got = I.implementStalled(version('filling'), failed, NOW, { person: 'amr' });
  assert.equal(got.ended_by, 'system');
  assert.match(got.reason, /\(Failed: Workload failed\)/);
});

test('the ended write stores user, outside or system only, so an unrecorded cancel never lands as user', () => {
  const stalled = I.implementStalled(version('filling'), cancelled, NOW, null);
  const write = I.implementRunEndedStatement('t', { session_id: 1, ...version('filling') }, stalled);
  assert.equal(write.parameters.find((p) => p.name === 'endedBy').value, 'outside');
  const userWrite = I.implementRunEndedStatement('t', { session_id: 1, ...version('filling') }, I.implementStalled(version('filling'), cancelled, NOW, { person: 'amr' }));
  assert.equal(userWrite.parameters.find((p) => p.name === 'endedBy').value, 'user');
});

test('a Stop is recorded for the run it cancelled: the newest record for this run names the person', () => {
  const rows = [{ action: 'cancel', asset: 'build', asset_id: '77', result: 'requested', acted_by: 'amr' }];
  assert.deepEqual(C.stoppedByRecord(rows, { runId: '77', jobId: '9001' }), { person: 'amr' });
  assert.equal(C.stoppedByRecord(rows, { runId: '78' }), null, 'another run is not this run');
  assert.equal(C.stoppedByRecord([{ action: 'cancel', asset: 'job', asset_id: '9001', result: 'requested', acted_by: 'amr' }], { runId: '77', jobId: '9001' }).person, 'amr', 'a job cancel-all that stopped the run names its person');
});

test('a Stop whose cancel Databricks refused is not a recorded Stop', () => {
  const rows = [
    { action: 'cancel', asset: 'build', asset_id: '77', result: 'failed', acted_by: 'amr' },
    { action: 'cancel', asset: 'build', asset_id: '77', result: 'requested', acted_by: 'amr' },
  ];
  assert.equal(C.stoppedByRecord(rows, { runId: '77' }), null, 'the newest row is the refusal');
});

test('only the stop actions write a record before the cancel', () => {
  assert.equal(C.isRunStop('build', 'cancel'), true);
  assert.equal(C.isRunStop('job', 'cancel'), true);
  assert.equal(C.isRunStop('app', 'stop'), false, 'an App stop is not a run');
  assert.equal(C.isRunStop('dashboard', 'publish'), false);
});
