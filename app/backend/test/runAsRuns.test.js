// REQ-409: the run-as token rule. An installed job's run is started, read and cancelled with the App's token, and only once its job id is
// known to be an installed one; a run of any other job keeps the person's token, and a run id is never read with the App's token before its
// job id is known. Job-level calls on an installed job use the App's token. The Genie Code check reports unchecked in run-as mode.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInstalledRuns, installedJobIds, isInstalledJob } = require('../lib/runAsRuns');
const GC = require('../lib/genieCodeCheck');

const SP = 'sp-token';
const PERSON = 'person-token';
const ENV = { INSPIRE_JOB_ID_DISCOVER: '555', INSPIRE_JOB_ID_IMPLEMENT: '556', INSPIRE_JOB_ID_GENIE: '557', INSPIRE_JOB_ID_DEMO: '558' };

// A fake workspace. Runs: id -> job_id, readable by the App token only for the ids in `appCanRead` (the person's read is refused for all runs
// unless `personCanRead` lists them). Every call is recorded with its token.
function fakeFetch({ runs = {}, personCanRead = [] }) {
  const calls = [];
  const dbFetch = async (host, token, path) => {
    calls.push({ token, path });
    const id = (path.match(/run_id=(\d+)/) || [])[1];
    const readable = (token === SP) || (token === PERSON && personCanRead.includes(id));
    if (!readable || !runs[id]) return { ok: false, status: 403, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ job_id: runs[id] }) };
  };
  return { dbFetch, calls };
}

test('the installed job ids come from the installer environment, one per job type', () => {
  assert.deepEqual([...installedJobIds(ENV)].sort(), ['555', '556', '557', '558']);
  assert.equal(isInstalledJob('555', ENV), true);
  assert.equal(isInstalledJob(999, ENV), false, 'a job the installer did not make is not an installed job');
  assert.equal(isInstalledJob('', ENV), false);
});

test('run-as: a start uses the App token, and never the person token', async () => {
  const runs = createInstalledRuns({ dbFetch: fakeFetch({}).dbFetch, appToken: async () => SP, runAs: () => true, env: ENV });
  assert.equal(await runs.startToken(PERSON), SP);
});

test('run-as: a start with no App token stops with a plain 503, it does not fall back to the person token', async () => {
  const runs = createInstalledRuns({ dbFetch: fakeFetch({}).dbFetch, appToken: async () => null, runAs: () => true, env: ENV });
  await assert.rejects(() => runs.startToken(PERSON), (err) => err.statusCode === 503 && /installed job/.test(err.message));
});

test('not run-as: the person token is kept for every call (REQ-113)', async () => {
  const { dbFetch, calls } = fakeFetch({ runs: { 10: '555' } });
  const runs = createInstalledRuns({ dbFetch, appToken: async () => SP, runAs: () => false, env: ENV });
  assert.equal(await runs.startToken(PERSON), PERSON);
  assert.equal(await runs.runToken('h', PERSON, '10'), PERSON);
  assert.equal(await runs.jobToken(PERSON, '555'), PERSON);
  assert.ok(calls.every((c) => c.token === PERSON));
});

test('REQ-409 item 2: a run outside the installed jobs is never read with the App token (the App is not called for its run)', async () => {
  // Run 11 belongs to another job and the person cannot read it; the launch record has no row for it. The App token must not be used at all.
  const { dbFetch, calls } = fakeFetch({ runs: { 11: '4242' } });
  const runs = createInstalledRuns({ dbFetch, appToken: async () => SP, runAs: () => true, env: ENV });
  assert.equal(await runs.runToken('h', PERSON, '11', async () => null), PERSON);
  assert.ok(calls.every((c) => c.token === PERSON), `no App read of a run outside the installed jobs: ${JSON.stringify(calls)}`);
});

test('run-as: an installed job run the person cannot read is found through Inspire\'s launch record, then read with the App token', async () => {
  const { dbFetch, calls } = fakeFetch({ runs: { 10: '555' } });
  const runs = createInstalledRuns({ dbFetch, appToken: async () => SP, runAs: () => true, env: ENV });
  assert.equal(await runs.runToken('h', PERSON, '10', async (id) => (id === '10' ? '555' : null)), SP);
  assert.ok(calls.some((c) => c.token === PERSON), 'the person read came first');
});

test('run-as: the person\'s own read of an installed job run is enough; the App token is then used for the cancel', async () => {
  const { dbFetch } = fakeFetch({ runs: { 12: '556' }, personCanRead: ['12'] });
  const runs = createInstalledRuns({ dbFetch, appToken: async () => SP, runAs: () => true, env: ENV });
  assert.equal(await runs.runToken('h', PERSON, '12'), SP);
});

test('run-as: a malformed run id is never looked up with the App token', async () => {
  const { dbFetch, calls } = fakeFetch({});
  const runs = createInstalledRuns({ dbFetch, appToken: async () => SP, runAs: () => true, env: ENV });
  assert.equal(await runs.runToken('h', PERSON, 'not-a-run', async () => '555'), PERSON);
  assert.equal(calls.length, 0);
});

test('run-as: a job-level call on an installed job (cancel-all, job get, runs list) uses the App token; another job keeps the person token', async () => {
  const runs = createInstalledRuns({ dbFetch: fakeFetch({}).dbFetch, appToken: async () => SP, runAs: () => true, env: ENV });
  assert.equal(await runs.jobToken(PERSON, '556'), SP);
  assert.equal(await runs.jobToken(PERSON, '4242'), PERSON);
});

test('run-as: the Genie Code check reports unchecked, with the run-as reason, and does not refuse the build', () => {
  const verdict = GC.runAsUnchecked();
  assert.equal(verdict.available, null, 'unchecked, not false: the build is not refused');
  assert.match(verdict.reason, /run-as mode: the run checks its AI model as the installer, and stops with the reason if none answers/);
});
