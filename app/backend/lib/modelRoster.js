// REQ-405: the agent's model roster starts from the newest chat endpoint of each model family, and keeps every other member after it.
// The App needs the same order to check which model the run can call. The agent's family functions are Python and run in the job,
// so this file is a port of them: the family table, the version order and the exclusions. test/modelRoster.test.js holds the table to
// the bundled notebook and checks the order against the notebook's own functions (test/support/modelRosterCases.json).
const LLM_FAMILY_SPECS = [
  ['claude-opus', 'sonnet|haiku'],
  ['claude-sonnet', 'opus|haiku'],
  ['claude-haiku', 'opus|sonnet'],
  ['meta-llama|llama-3|llama-4', 'gpt|claude|mistral'],
  ['gpt-oss-120b|gpt-oss-large', '\\b20b\\b|small'],
  ['gpt-oss-20b|gpt-oss-small', '\\b120b\\b|large'],
  ['gpt-oss', ''],
];
const AI_QUERY_TEXT_TASKS = ['llm/v1/chat', 'llm/v1/completions'];

// The version of a model name, as three numbers: the first up to three one- or two-digit tokens, a leading "v" allowed.
function versionOf(name) {
  const numbers = [];
  for (const token of String(name || '').toLowerCase().split(/[-_.]/)) {
    const digits = token.startsWith('v') ? token.slice(1) : token;
    if (/^\d{1,2}$/.test(digits)) numbers.push(Number(digits));
    else if (numbers.length) break;
  }
  const three = numbers.slice(0, 3);
  while (three.length < 3) three.push(0);
  return three;
}

function compareVersionsDesc(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return b[i] - a[i];
  return 0;
}

function servedModelNames(endpoint) {
  const entities = (endpoint.config && endpoint.config.served_entities) || [];
  const names = [];
  for (const entity of entities) {
    for (const kind of ['foundation_model', 'external_model']) {
      const part = entity && entity[kind];
      if (part && part.name) names.push(String(part.name));
    }
    if (entity && entity.entity_name) names.push(String(entity.entity_name));
  }
  return names;
}

// The name that puts an endpoint in a family: its own name when Databricks hosts it, otherwise the model it serves. An endpoint not
// hosted by Databricks counts only when its task is a chat or completions task.
function familyNameOf(endpoint, familyRe, excludeRe) {
  const name = endpoint.name || '';
  let candidates;
  if (name.toLowerCase().startsWith('databricks-')) candidates = [name];
  else if (AI_QUERY_TEXT_TASKS.includes(String(endpoint.task || '').trim().toLowerCase())) candidates = [name, ...servedModelNames(endpoint)];
  else return '';
  return candidates.find((candidate) => familyRe.test(candidate) && !(excludeRe && excludeRe.test(candidate))) || '';
}

// Why ai_query cannot serve an endpoint, or '' when it can. Mirrors the agent's exclusion (task, readiness, served models).
function exclusionOf(endpoint) {
  const task = endpoint.task;
  if (task && !AI_QUERY_TEXT_TASKS.includes(String(task).trim().toLowerCase())) return 'task is not a chat or completions task';
  const ready = endpoint.state ? endpoint.state.ready : undefined;
  const readyValue = String(ready ?? '').trim().toUpperCase();
  if (readyValue && readyValue !== 'READY') return `endpoint state is ${readyValue}`;
  const entities = endpoint.config ? endpoint.config.served_entities : undefined;
  if (Array.isArray(entities) && entities.length === 0) return 'endpoint serves no model';
  return '';
}

// The members of one family, newest first. `seen` holds the endpoints an earlier family already took, and excluded ones are added to it.
function familyEndpoints(endpoints, familyPattern, excludePattern, seen) {
  const familyRe = new RegExp(familyPattern, 'i');
  const excludeRe = excludePattern ? new RegExp(excludePattern, 'i') : null;
  const matched = [];
  for (const endpoint of endpoints) {
    const name = endpoint && endpoint.name;
    if (!name || seen.has(name)) continue;
    if (!familyNameOf(endpoint, familyRe, excludeRe)) continue;
    if (exclusionOf(endpoint)) {
      seen.add(name);
      continue;
    }
    matched.push({ name, version: versionOf(familyNameOf(endpoint, familyRe, excludeRe)) });
  }
  return matched.sort((a, b) => compareVersionsDesc(a.version, b.version));
}

// Every chat endpoint the roster can pick, in the agent's order: family by family, newest first, each endpoint once.
function rosterOrder(endpoints) {
  const seen = new Set();
  const order = [];
  for (const [familyPattern, excludePattern] of LLM_FAMILY_SPECS) {
    const members = familyEndpoints(endpoints || [], familyPattern, excludePattern, seen);
    for (const member of members) {
      seen.add(member.name);
      order.push(member.name);
    }
  }
  return [...new Set(order)];
}

module.exports = { LLM_FAMILY_SPECS, AI_QUERY_TEXT_TASKS, versionOf, rosterOrder };
