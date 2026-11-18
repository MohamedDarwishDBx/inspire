// REQ-405: before a run starts, the identity the run uses (the App's service principal, or the signed-in person in run-as-me) must be
// able to query a chat model. The candidates are the agent's roster order (lib/modelRoster.js), at most the roster's size, each probed
// with one one-word chat call. Any answer passes. A Permission Required entry needs a refusal (HTTP 403) from every probed candidate
// and nothing else: an error that is not a refusal means the check could not tell, so the launch is not blocked.
const { rosterOrder } = require('./modelRoster');
const { permissionRequired } = require('./permissions');

// The agent's roster holds at most six models (TECHNICAL_CONTEXT roster size); probing stops at the first answer.
const CANDIDATE_LIMIT = 6;
const PROBE = { messages: [{ role: 'user', content: 'Reply with the single word OK.' }], max_tokens: 4, temperature: 0 };

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

// The Unity Gateway serves models the agent can also pick (the roster includes its routes). A gateway that lists a model means the
// run is not blocked by the serving endpoints alone.
const GATEWAY_MODELS = '/ai-gateway/codex/v1/models';
async function gatewayServes(call) {
  const listed = await call('GET', GATEWAY_MODELS);
  return listed.ok && ((listed.data.models || []).length + (listed.data.data || []).length) > 0;
}

// `call(method, path, body)` resolves to { ok, status, data }, the shape jsonOf gives. Returns null when the run may start.
async function modelAccessPermission({ call, principal }) {
  const listed = await call('GET', '/api/2.0/serving-endpoints');
  if (!listed.ok && listed.status !== 403) return null;
  const endpoints = listed.ok ? listed.data.endpoints || [] : [];
  const byName = new Map(endpoints.filter((e) => e && e.name).map((e) => [e.name, e]));
  const candidates = rosterOrder(endpoints).slice(0, CANDIDATE_LIMIT).map((name) => byName.get(name));
  const denied = [];
  let inconclusive = false;
  for (const endpoint of candidates) {
    const probe = await call('POST', `/serving-endpoints/${encodeURIComponent(endpoint.name)}/invocations`, PROBE);
    if (probe.ok) return null;
    if (probe.status === 403) denied.push(endpoint);
    else inconclusive = true;
  }
  if (inconclusive) return null;
  if (await gatewayServes(call)) return null;
  return permissionFor(principal, denied);
}

module.exports = { modelAccessPermission, CANDIDATE_LIMIT };
