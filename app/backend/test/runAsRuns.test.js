// REQ-409: the run-as token rule. An installed job's run is started, read and cancelled with the App's token; a run of any other job keeps
// the person's token. The Genie Code check in run-as mode reports unchecked, never refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInstalledRuns, installedJobIds, isInstalledRun } = require('../lib/runAsRuns');
const GC = require('../lib/genieCodeCheck');

const SP = 'sp-token';
const PERSON = 'person-token';
const ENV = { INSPIRE_JOB_ID_DISCOVER: '555', INSPIRE_JOB_ID_IMPLEMENT: '556', INSPIRE_JOB_ID_GENIE: '557', INSPIRE_JOB_ID_DEMO: '558' };

// A fake dbFetch: the App token reads any run; the person token is refused for run reads.
function fakeFetch(runs) {
  const calls = [];
  const dbFetch = async (host, token, path) => {
    calls.push({ token, path });
    const id = (path.match(/run_id=(\d+)/) || [])[1];
    if (token !== SP || !runs[id]) return { ok: false, status: 403, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => runs[id] };
  };
  return { dbFetch, calls };
}

test('the installed job ids come from the installer environment, one per job type', () => {
  assert.deepEqual([...installedJobIds(ENV)].sort(), ['555', '556', '557', '558']);
  assert.equal(isInstalledRun({ job_id: 555 }, ENV), true);
  assert.equal(isInstalledRun({ job_id: 999 }, ENV), false, 'a job the installer did not make is not an installed run');
  assert.equal(isInstalledRun(null, ENV), false);
});

test('run-as: a start uses the App token, and never the person token (must-fail before: the person token was used)', async () => {
  const { dbFetch } = fakeFetch({});
  const runs = createInstalledRuns({ dbFetch, appToken: async () => SP, runAs: () => true, env: ENV });
  assert.equal(await runs.startToken(PERSON), SP);
});

test('run-as: a start with no App token stops with a plain 503, it does not fall back to the person token', async () => {
  const runs = createInstalledRuns({ dbFetch: fakeFetch({}).dbFetch, appToken: async () => null, runAs: () => true, env: ENV });
  await assert.rejects(() => runs.startToken(PERSON), (err) => err.statusCode === 503 && /installed job/.test(err.message));
});

test('not run-as: the person token is kept for every call (REQ-113)', async () => {
  const runs = createInstalledRuns({ dbFetch: fakeFetch({}).dbFetch, appToken: async () => SP, runAs: () => false, env: ENV });
  assert.equal(await runs.startToken(PERSON), PERSON);
  assert.equal(await runs.runToken('h', PERSON, '99'), PERSON);
});

test('run-as: a run of an installed job is read and cancelled with the App token; a run of another job keeps the person token', async () => {
  const { dbFetch, calls } = fakeFetch({ 10: { job_id: 555 }, 11: { job_id: 4242 } });
  const runs = createInstalledRuns({ dbFetch, appToken: async () => SP, runAs: () => true, env: ENV });
  assert.equal(await runs.runToken('h', PERSON, '10'), SP, 'the installed job run uses the App token');
  assert.equal(await runs.runToken('h', PERSON, '11'), PERSON, 'a run of another job keeps the person token');
  assert.equal(await runs.runToken('h', PERSON, 'not-a-run'), PERSON, 'a malformed run id is never looked up with the App token');
  assert.ok(calls.every((c) => c.path.startsWith('/api/2.1/jobs/runs/get')), 'only the run lookup used the App token to check the job');
});

test('run-as: when the App cannot read the run, the person token is used (no App access is assumed)', async () => {
  const { dbFetch } = fakeFetch({});
  const runs = createInstalledRuns({ dbFetch, appToken: async () => SP, runAs: () => true, env: ENV });
  assert.equal(await runs.runToken('h', PERSON, '77'), PERSON);
});

test('run-as: the Genie Code check reports unchecked, with the run-as reason, and does not refuse the build', () => {
  const verdict = GC.runAsUnchecked();
  assert.equal(verdict.available, null, 'unchecked, not false: the build is not refused');
  assert.match(verdict.reason, /run-as mode: the run checks its AI model as the installer, and stops with the reason if none answers/);
});
