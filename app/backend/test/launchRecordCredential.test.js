// REQ-188 root cause: the route-policy gate runs before requireToken, so the launch-record reads it makes must take the App's own
// credential themselves. A read with no credential answers 401 "Credential was not sent", which Monitor saw as "no record".
const test = require('node:test');
const assert = require('node:assert/strict');

const { fakeWorkspace, startInspire } = require('./support/serverProcess');
const { PERSON, SP_TOKEN, NO_CREDENTIAL, OUTPUT_FOLDERS, LAUNCH_PARAMS, LAUNCH_ENV, PERSON_HEADERS, launchWorkspaceAnswer, statementOf } = require('./support/launchWorkspace');

const workspaceAnswer = launchWorkspaceAnswer();
const launchEnv = LAUNCH_ENV;

test('after the person launches a run, the launch-record read for that run carries the same App credential as the launch INSERT and the run passes the gate (fail-pre: 503 with no credential)', async () => {
  const workspace = await fakeWorkspace(workspaceAnswer, { folders: OUTPUT_FOLDERS });
  const inspire = await startInspire({ ...launchEnv, DATABRICKS_HOST: workspace.url });
  try {
    const launched = await fetch(`${inspire.url}/api/run`, {
      method: 'POST',
      headers: PERSON_HEADERS,
      body: JSON.stringify({ params: LAUNCH_PARAMS }),
    });
    assert.equal(launched.status, 200, await launched.text());
    const read = await fetch(`${inspire.url}/api/run/99`, { headers: { 'x-forwarded-access-token': 'person-token', 'x-forwarded-email': PERSON } });
    const body = await read.json();
    assert.equal(read.status, 200, JSON.stringify(body));
    assert.equal(body.run_id, 99);
    const insert = workspace.calls.find((c) => c.path === '/api/2.0/sql/statements' && /INSERT INTO .*__inspire_launch/.test(statementOf(c)));
    const select = workspace.calls.find((c) => c.path === '/api/2.0/sql/statements' && /^SELECT launched_by FROM/.test(statementOf(c)));
    assert.ok(insert, 'the launch record was written');
    assert.ok(select, 'the launch record was read');
    assert.equal(select.token, SP_TOKEN, 'the read carries the App credential, not none');
    assert.equal(select.token, insert.token, 'the read uses the same credential as the launch INSERT');
  } finally {
    await inspire.stop();
    await workspace.close();
  }
});

test('must-exclude: with no App credential at all, the run read fails closed with a plain 503 that tries again, never a 401, a crash, or "no record" (must-exclude)', async () => {
  const workspace = await fakeWorkspace(workspaceAnswer, { folders: OUTPUT_FOLDERS });
  const inspire = await startInspire({ ...launchEnv, DATABRICKS_HOST: workspace.url, DATABRICKS_CLIENT_ID: '', DATABRICKS_CLIENT_SECRET: '' });
  try {
    const read = await fetch(`${inspire.url}/api/run/99`, { headers: { 'x-forwarded-email': PERSON } });
    const body = await read.json();
    assert.equal(read.status, 503, JSON.stringify(body));
    assert.match(body.error, /^Inspire could not check its record of run 99 just now \(Inspire has no credential of its own/);
    assert.doesNotMatch(body.error, /no record of run|Credential was not sent/);
    assert.equal(workspace.calls.filter((c) => c.path === '/api/2.0/sql/statements').length, 0, 'no SQL call goes out without a credential');
  } finally {
    await inspire.stop();
    await workspace.close();
  }
});
