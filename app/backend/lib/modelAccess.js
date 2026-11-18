// REQ-405: before a run starts, the identity the run uses (the App's service principal, or the signed-in person in run-as-me) must be
// able to query a chat model. The check sends one one-word chat call to each ready chat endpoint it can see, at most three. Only a
// refusal (HTTP 403) from every candidate is a Permission Required entry, with the grant to ask for. An answer from any candidate, or
// an error that is not a refusal, does not block the launch.
const { permissionRequired } = require('./permissions');

const CHAT_TASK = 'llm/v1/chat';
const CANDIDATE_LIMIT = 3;
const PROBE = { messages: [{ role: 'user', content: 'Reply with the single word OK.' }], max_tokens: 4, temperature: 0 };
const READY = 'READY';

const isReady = (endpoint) => String(endpoint.state && typeof endpoint.state === 'object' ? endpoint.state.ready : endpoint.state).toUpperCase() === READY;
const grantCommand = (id, principal) => `databricks api patch /api/2.0/permissions/serving-endpoints/${id} --json '{"access_control_list":[{"service_principal_name":"${principal}","permission_level":"CAN_QUERY"}]}'`;

function permissionFor(principal, denied) {
  if (denied.length) {
    const names = denied.map((e) => e.name).join(', ');
    const steps = denied.flatMap((e) => [
      `In Databricks, open serving endpoint ${e.name} > Permissions, and add ${principal} with Can query`,
      grantCommand(e.id, principal),
    ]);
    return permissionRequired({ steps, principal, why: `Inspire runs the chat model ${names} as ${principal}, and that identity cannot query it yet.` });
  }
  return permissionRequired({
    steps: [`In Databricks, open Serving, pick a chat model you can use, open its Permissions, and add ${principal} with Can query`],
    principal,
    why: `Inspire runs a chat model as ${principal}, and no chat model is visible to that identity, so it cannot query one yet.`,
  });
}

// `call(method, path, body)` resolves to { ok, status, data }, the shape jsonOf gives. Returns null when the run may start.
async function modelAccessPermission({ call, principal }) {
  const listed = await call('GET', '/api/2.0/serving-endpoints');
  if (listed.status === 403) return permissionFor(principal, []);
  if (!listed.ok) return null;
  const candidates = (listed.data.endpoints || []).filter((e) => e && e.name && e.task === CHAT_TASK && isReady(e)).slice(0, CANDIDATE_LIMIT);
  if (!candidates.length) return permissionFor(principal, []);
  const denied = [];
  for (const endpoint of candidates) {
    const probe = await call('POST', `/serving-endpoints/${encodeURIComponent(endpoint.name)}/invocations`, PROBE);
    if (probe.ok) return null;
    if (probe.status !== 403) return null;
    denied.push(endpoint);
  }
  return permissionFor(principal, denied);
}

module.exports = { modelAccessPermission, CHAT_TASK, CANDIDATE_LIMIT };
