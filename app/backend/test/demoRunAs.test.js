// REQ-409: a demo run in run-as-me starts the installed demo job with the App's token (the person's is refused there), and runs as the
// installer. Outside run-as, the demo keeps the person's token.
const test = require('node:test');
const assert = require('node:assert/strict');
const { triggerDemoDataPipeline } = require('../lib/demoDataPipeline');

const APP_TOKEN = 'sp-token';
const PERSON = 'person-token';

async function runDemo({ runAs, startToken }) {
  const saved = { run: process.env.INSPIRE_RUN_AS_PERSON, job: process.env.INSPIRE_JOB_ID_DEMO };
  if (runAs) {
    process.env.INSPIRE_RUN_AS_PERSON = '1';
    process.env.INSPIRE_JOB_ID_DEMO = '558';
  } else {
    delete process.env.INSPIRE_RUN_AS_PERSON;
  }
  const runNowTokens = [];
  const fetcher = async (host, token, url) => {
    if (url === '/api/2.0/clusters/list') return { ok: true, json: async () => ({ clusters: [] }) };
    if (url === '/api/2.1/jobs/run-now') {
      runNowTokens.push(token);
      // The installed job refuses the person's token, as the installer's job does in a real run-as install.
      return token === APP_TOKEN || !runAs ? { ok: true, json: async () => ({ run_id: 9 }) } : { ok: false, status: 403, text: async () => 'CAN_MANAGE_RUN' };
    }
    if (url === '/api/2.1/jobs/create') return { ok: true, json: async () => ({ job_id: 7 }) };
    throw new Error(`unexpected call ${url}`);
  };
  try {
    const options = {
      description: 'A retailer with stores', businessName: 'Acme Retail', inspireDatabase: 'main._inspire', sessionId: '42', cluster_id: '',
      resolveWorkspaceNotebookObjectPath: async (host, token, p) => p, ensureInspireNotebookPublished: async () => '/Shared/x/nb',
    };
    if (startToken) options.startToken = startToken;
    const out = await triggerDemoDataPipeline(fetcher, () => 'https://h/run', 'https://h', PERSON, options);
    return { out, runNowTokens };
  } finally {
    if (saved.run === undefined) delete process.env.INSPIRE_RUN_AS_PERSON; else process.env.INSPIRE_RUN_AS_PERSON = saved.run;
    if (saved.job === undefined) delete process.env.INSPIRE_JOB_ID_DEMO; else process.env.INSPIRE_JOB_ID_DEMO = saved.job;
  }
}

test('REQ-409: run-as demo starts the installed job with the App token from startToken, never the person token', async () => {
  const { runNowTokens } = await runDemo({ runAs: true, startToken: async () => APP_TOKEN });
  assert.deepEqual(runNowTokens, [APP_TOKEN]);
});

test('REQ-409: outside run-as the demo starts with the person token (REQ-113)', async () => {
  const { runNowTokens } = await runDemo({ runAs: false });
  assert.deepEqual(runNowTokens, [PERSON]);
});
