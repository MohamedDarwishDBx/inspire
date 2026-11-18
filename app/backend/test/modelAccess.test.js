// REQ-405: the App checks, before a run starts, that the run's identity can query a chat model, and names the grant when it cannot.
const test = require('node:test');
const assert = require('node:assert/strict');
const { modelAccessPermission, CANDIDATE_LIMIT } = require('../lib/modelAccess');

const PRINCIPAL = '11111111-2222-3333-4444-555555555555';
const chat = (name, id, state = { ready: 'READY' }) => ({ name, id, task: 'llm/v1/chat', state });

// A fake of the REST calls the check makes. `answers` maps "METHOD path" to a status; unlisted probes answer 200.
function fakeCall({ listing = { ok: true, status: 200, data: { endpoints: [] } }, probes = {} } = {}) {
  const calls = [];
  const call = async (method, path, body) => {
    calls.push([method, path]);
    if (method === 'GET') return listing;
    const status = probes[path] ?? 200;
    return { ok: status === 200, status, data: {} };
  };
  return { call, calls };
}

test('a chat endpoint that answers lets the run start, with no permission entry', async () => {
  const { call } = fakeCall({ listing: { ok: true, status: 200, data: { endpoints: [chat('databricks-claude-sonnet-4-6', 'id-46')] } } });
  assert.equal(await modelAccessPermission({ call, principal: PRINCIPAL }), null);
});

test('when every chat endpoint refuses the identity, the permission names each endpoint and the CAN_QUERY grant for the App', async () => {
  const endpoints = [chat('databricks-claude-sonnet-4-6', 'id-46'), chat('databricks-gpt-oss-120b', 'id-gpt')];
  const probes = { '/serving-endpoints/databricks-claude-sonnet-4-6/invocations': 403, '/serving-endpoints/databricks-gpt-oss-120b/invocations': 403 };
  const { call, calls } = fakeCall({ listing: { ok: true, status: 200, data: { endpoints } }, probes });
  const permission = await modelAccessPermission({ call, principal: PRINCIPAL });
  assert.ok(permission, 'a refusal from every candidate is a Permission Required');
  assert.equal(permission.principal, PRINCIPAL);
  assert.deepEqual(permission.statements, []);
  assert.ok(permission.steps.includes(`databricks api patch /api/2.0/permissions/serving-endpoints/id-46 --json '{"access_control_list":[{"service_principal_name":"${PRINCIPAL}","permission_level":"CAN_QUERY"}]}'`));
  assert.ok(permission.steps.some((s) => s.includes('id-gpt')), 'the second endpoint is named too');
  assert.equal(calls.filter(([m]) => m === 'POST').length, 2, 'each candidate is probed once');
});

test('one refusing endpoint does not block the run while another one answers', async () => {
  const endpoints = [chat('databricks-claude-sonnet-4-6', 'id-46'), chat('databricks-gpt-oss-120b', 'id-gpt')];
  const probes = { '/serving-endpoints/databricks-claude-sonnet-4-6/invocations': 403 };
  const { call } = fakeCall({ listing: { ok: true, status: 200, data: { endpoints } }, probes });
  assert.equal(await modelAccessPermission({ call, principal: PRINCIPAL }), null, 'a usable model exists, so the run starts');
});

test('an identity that cannot list the serving endpoints gets the grant to ask for, with no endpoint named', async () => {
  const { call } = fakeCall({ listing: { ok: false, status: 403, data: {} } });
  const permission = await modelAccessPermission({ call, principal: PRINCIPAL });
  assert.ok(permission && permission.steps.length === 1 && permission.steps[0].includes('Can query'), 'the admin is told which permission to give');
});

test('a workspace with only embedding or non-chat endpoints names no chat model and asks for one', async () => {
  const endpoints = [{ name: 'databricks-bge-large-en', id: 'id-embed', task: 'llm/v1/embeddings', state: { ready: 'READY' } }];
  const { call } = fakeCall({ listing: { ok: true, status: 200, data: { endpoints } } });
  const permission = await modelAccessPermission({ call, principal: PRINCIPAL });
  assert.ok(permission && permission.why.includes('no chat model is visible'), permission && permission.why);
});

test('an endpoint that is not ready is not probed, and a probe that fails for another reason does not block the launch', async () => {
  const endpoints = [chat('databricks-claude-sonnet-4-6', 'id-46', { ready: 'NOT_READY' }), chat('databricks-gpt-oss-120b', 'id-gpt')];
  const probes = { '/serving-endpoints/databricks-gpt-oss-120b/invocations': 500 };
  const { call, calls } = fakeCall({ listing: { ok: true, status: 200, data: { endpoints } }, probes });
  assert.equal(await modelAccessPermission({ call, principal: PRINCIPAL }), null, 'a server error is not a refusal');
  assert.deepEqual(calls.filter(([m]) => m === 'POST').map(([, p]) => p), ['/serving-endpoints/databricks-gpt-oss-120b/invocations'], 'only the ready one is probed');
});

test('the probe count is capped', async () => {
  const endpoints = Array.from({ length: CANDIDATE_LIMIT + 3 }, (_, i) => chat(`databricks-model-${i}`, `id-${i}`));
  const probes = Object.fromEntries(endpoints.map((e) => [`/serving-endpoints/${e.name}/invocations`, 403]));
  const { call, calls } = fakeCall({ listing: { ok: true, status: 200, data: { endpoints } }, probes });
  const permission = await modelAccessPermission({ call, principal: PRINCIPAL });
  assert.equal(calls.filter(([m]) => m === 'POST').length, CANDIDATE_LIMIT, 'at most the limit is probed');
  assert.ok(permission && permission.steps.length === CANDIDATE_LIMIT * 2, 'and only the probed ones are named');
});
