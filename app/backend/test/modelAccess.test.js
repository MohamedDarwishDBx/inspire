// REQ-405: the App checks, before a run starts, that the run's identity can query a chat model, and names the grant when it cannot.
const test = require('node:test');
const assert = require('node:assert/strict');
const { modelAccessPermission, CANDIDATE_LIMIT } = require('../lib/modelAccess');

const PRINCIPAL = '11111111-2222-3333-4444-555555555555';
const chat = (name, id, state = { ready: 'READY' }) => ({ name, id, task: 'llm/v1/chat', state });
const posts = (calls) => calls.filter(([m]) => m === 'POST').map(([, p]) => p);

// A fake of the REST calls the check makes. `probes` maps an invocations path to a status; unlisted probes answer 200.
function fakeCall({ listing = { ok: true, status: 200, data: { endpoints: [] } }, probes = {} } = {}) {
  const calls = [];
  const call = async (method, path) => {
    calls.push([method, path]);
    if (method === 'GET') return listing;
    const status = probes[path] ?? 200;
    return { ok: status === 200, status, data: {} };
  };
  return { call, calls };
}
const listed = (endpoints) => ({ ok: true, status: 200, data: { endpoints } });
const invocations = (name) => `/serving-endpoints/${name}/invocations`;

test('a chat endpoint that answers lets the run start, with no permission entry', async () => {
  const { call } = fakeCall({ listing: listed([chat('databricks-claude-sonnet-4-6', 'id-46')]) });
  assert.equal(await modelAccessPermission({ call, principal: PRINCIPAL }), null);
});

test('when every candidate refuses the identity, the permission names each one and the CAN_QUERY grant for the App', async () => {
  const endpoints = [chat('databricks-claude-sonnet-4-6', 'id-46'), chat('databricks-gpt-oss-120b', 'id-gpt')];
  const probes = { [invocations('databricks-claude-sonnet-4-6')]: 403, [invocations('databricks-gpt-oss-120b')]: 403 };
  const { call, calls } = fakeCall({ listing: listed(endpoints), probes });
  const permission = await modelAccessPermission({ call, principal: PRINCIPAL });
  assert.ok(permission, 'a refusal from every candidate is a Permission Required');
  assert.equal(permission.principal, PRINCIPAL);
  assert.deepEqual(permission.statements, []);
  assert.ok(permission.steps.includes(`databricks api patch /api/2.0/permissions/serving-endpoints/id-46 --json '{"access_control_list":[{"service_principal_name":"${PRINCIPAL}","permission_level":"CAN_QUERY"}]}'`));
  assert.ok(permission.steps.some((s) => s.includes('id-gpt')), 'the second endpoint is named too');
  assert.equal(posts(calls).length, 2, 'each candidate is probed once');
});

test('a refusal from the first candidate does not block: a later candidate that answers lets the run start', async () => {
  const endpoints = [chat('databricks-claude-sonnet-4-6', 'id-46'), chat('databricks-gpt-oss-120b', 'id-gpt')];
  const probes = { [invocations('databricks-claude-sonnet-4-6')]: 403 };
  const { call, calls } = fakeCall({ listing: listed(endpoints), probes });
  assert.equal(await modelAccessPermission({ call, principal: PRINCIPAL }), null, 'one usable model is enough');
  assert.deepEqual(posts(calls), [invocations('databricks-claude-sonnet-4-6'), invocations('databricks-gpt-oss-120b')]);
});

test('candidates are probed in the agent roster order, newest Claude Sonnet first, whatever order the listing gives', async () => {
  const endpoints = [chat('databricks-claude-sonnet-4-5', 'id-45'), chat('databricks-claude-sonnet-4-6', 'id-46')];
  const { call, calls } = fakeCall({ listing: listed(endpoints) });
  await modelAccessPermission({ call, principal: PRINCIPAL });
  assert.deepEqual(posts(calls), [invocations('databricks-claude-sonnet-4-6')]);
});

test('an identity that cannot list the serving endpoints gets the grant to ask for, with no endpoint named', async () => {
  const { call } = fakeCall({ listing: { ok: false, status: 403, data: {} } });
  const permission = await modelAccessPermission({ call, principal: PRINCIPAL });
  assert.ok(permission && permission.steps.length === 1 && permission.steps[0].includes('Can query'), 'the admin is told which permission to give');
});

test('a workspace with only embedding or non-chat endpoints names no chat model and asks for one', async () => {
  const endpoints = [{ name: 'databricks-bge-large-en', id: 'id-embed', task: 'llm/v1/embeddings', state: { ready: 'READY' } }];
  const { call, calls } = fakeCall({ listing: listed(endpoints) });
  const permission = await modelAccessPermission({ call, principal: PRINCIPAL });
  assert.ok(permission && permission.why.includes('no chat model is visible'), permission && permission.why);
  assert.deepEqual(posts(calls), [], 'nothing is probed');
});

test('a model that is not ready is not probed, and a server error is not shown as a permission problem', async () => {
  const endpoints = [chat('databricks-claude-sonnet-4-6', 'id-46', { ready: 'NOT_READY' }), chat('databricks-gpt-oss-120b', 'id-gpt')];
  const probes = { [invocations('databricks-gpt-oss-120b')]: 500 };
  const { call, calls } = fakeCall({ listing: listed(endpoints), probes });
  assert.equal(await modelAccessPermission({ call, principal: PRINCIPAL }), null, 'a server error is not a refusal');
  assert.deepEqual(posts(calls), [invocations('databricks-gpt-oss-120b')], 'only the ready one is probed');
});

test('a 403 on every candidate but one that errors for another reason does not become a permission problem', async () => {
  const endpoints = [chat('databricks-claude-sonnet-4-6', 'id-46'), chat('databricks-gpt-oss-120b', 'id-gpt')];
  const probes = { [invocations('databricks-claude-sonnet-4-6')]: 403, [invocations('databricks-gpt-oss-120b')]: 503 };
  const { call } = fakeCall({ listing: listed(endpoints), probes });
  assert.equal(await modelAccessPermission({ call, principal: PRINCIPAL }), null, 'the check could not tell, so the launch is not blocked');
});

test('the probe count is capped at the roster size, and only the probed endpoints are named', async () => {
  const endpoints = Array.from({ length: CANDIDATE_LIMIT + 3 }, (_, i) => chat(`databricks-claude-sonnet-4-${i + 1}`, `id-${i}`));
  const probes = Object.fromEntries(endpoints.map((e) => [invocations(e.name), 403]));
  const { call, calls } = fakeCall({ listing: listed(endpoints), probes });
  const permission = await modelAccessPermission({ call, principal: PRINCIPAL });
  assert.equal(posts(calls).length, CANDIDATE_LIMIT, 'at most the roster size is probed');
  assert.equal(permission.steps.length, CANDIDATE_LIMIT * 2);
});

test('serving endpoints that all refuse do not block a run while the Unity Gateway lists a model the App can use', async () => {
  const endpoints = [chat('databricks-claude-sonnet-4-6', 'id-46')];
  const calls = [];
  const call = async (method, path) => {
    calls.push([method, path]);
    if (method === 'GET' && path === '/api/2.0/serving-endpoints') return listed(endpoints);
    if (method === 'GET' && path === '/ai-gateway/codex/v1/models') return { ok: true, status: 200, data: { models: [{ slug: 'gpt-5' }] } };
    return { ok: false, status: 403, data: {} };
  };
  assert.equal(await modelAccessPermission({ call, principal: PRINCIPAL }), null);
  assert.ok(calls.some(([, p]) => p === '/ai-gateway/codex/v1/models'), 'the gateway list is consulted before a permission is raised');
});

// Live shape (2026-11-19): databricks-* foundation endpoints have no id. Their access object is the Unity Gateway model service.
test('a refused foundation endpoint with no id is named as its system model service, never as an endpoint id', async () => {
  const endpoints = [chat('databricks-claude-sonnet-4-6', undefined)];
  const probes = { [invocations('databricks-claude-sonnet-4-6')]: 403 };
  const { call } = fakeCall({ listing: listed(endpoints), probes });
  const permission = await modelAccessPermission({ call, principal: PRINCIPAL });
  assert.ok(permission, 'a refusal from every candidate is a Permission Required');
  const all = permission.steps.join('\n');
  assert.ok(!all.includes('undefined') && !all.includes('serving-endpoints/'), all);
  assert.ok(permission.steps.includes(`databricks grants update model_service system.ai.claude-sonnet-4-6 --json '{"changes":[{"principal":"${PRINCIPAL}","add":["EXECUTE"]}]}'`), all);
  assert.ok(permission.steps.some((s) => s.includes('system.ai.claude-sonnet-4-6') && s.includes('Can execute')), all);
});

test('a refused foundation endpoint and a refused endpoint with an id are each named by their own grant path', async () => {
  const endpoints = [chat('databricks-claude-sonnet-4-6', undefined), chat('databricks-gpt-oss-120b', 'id-gpt')];
  const probes = { [invocations('databricks-claude-sonnet-4-6')]: 403, [invocations('databricks-gpt-oss-120b')]: 403 };
  const { call } = fakeCall({ listing: listed(endpoints), probes });
  const permission = await modelAccessPermission({ call, principal: PRINCIPAL });
  assert.ok(permission.steps.includes(`databricks api patch /api/2.0/permissions/serving-endpoints/id-gpt --json '{"access_control_list":[{"service_principal_name":"${PRINCIPAL}","permission_level":"CAN_QUERY"}]}'`));
  assert.ok(permission.steps.some((s) => s.includes('system.ai.claude-sonnet-4-6')));
  assert.ok(!permission.steps.join('\n').includes('undefined'));
});
