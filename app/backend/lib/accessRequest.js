// Request for Access (Unity Catalog, REST /api/3.0/rfa): a request asks the owner of a securable for the privileges a GRANT in the
// Permission Required dialog names. It goes out with the signed-in person's own token. The person's own grants leave behalf_of empty,
// so the requester is that person. A grant to the App or another principal names that principal as behalf_of (its SCIM id), so the
// owner sees who the access is for. A principal that cannot be resolved stays copy-only. The API needs the user-app scope
// 'unity-catalog' (Databricks API reference, Request For Access: "API scopes: unity-catalog").
const RFA_SCOPE = 'unity-catalog';
const RFA_TYPES = new Set(['CATALOG', 'SCHEMA', 'TABLE', 'VOLUME']);
const GRANT_RE = /^GRANT\s+(.+?)\s+ON\s+(CATALOG|SCHEMA|TABLE|VOLUME)\s+(.+?)\s+TO\s+(.+?);?$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCIM = '/api/2.0/preview/scim/v2';
const COMMENT = 'Requested through Inspire for a use case I run';
const NO_DESTINATION = 'no one has set up where access requests for these go yet, so ask your Databricks admin to send them the copied text';
const NO_PERSON = 'Inspire cannot tell who is signed in, so it cannot send the request as you';
const NO_GRANT = 'none of these grants can be requested through Request for Access';
const NO_PRINCIPAL = 'Inspire could not find a principal one of these grants names, so that grant can only be copied';

const cleanName = (text) => String(text || '').replace(/`/g, '').trim();

// One GRANT statement as its grantee, securable and privilege. Only the securable types Request for Access takes are read.
function parseGrant(statement) {
  const hit = GRANT_RE.exec(String(statement || '').trim());
  if (!hit) return null;
  const type = hit[2].toUpperCase();
  if (!RFA_TYPES.has(type)) return null;
  const grantee = cleanName(hit[4]);
  const fullName = cleanName(hit[3]);
  if (!grantee || !fullName) return null;
  return { grantee, type, fullName, privilege: hit[1].trim().toUpperCase().replace(/\s+/g, '_') };
}

// The requestable grants of a dialog: one entry per grantee and securable, with its privileges once each.
function requestsOf(statements) {
  const byKey = new Map();
  for (const statement of Array.isArray(statements) ? statements : []) {
    const grant = parseGrant(statement);
    if (!grant) continue;
    const key = `${grant.grantee.toLowerCase()}|${grant.type}:${grant.fullName}`;
    if (!byKey.has(key)) byKey.set(key, { grantee: grant.grantee, securable: { type: grant.type, full_name: grant.fullName }, permissions: [] });
    const entry = byKey.get(key);
    if (!entry.permissions.includes(grant.privilege)) entry.permissions.push(grant.privilege);
  }
  return [...byKey.values()];
}

const destinationsPath = (securable) => `/api/3.0/rfa/destinations/${securable.type.toLowerCase()}/${encodeURIComponent(securable.full_name)}`;

// A destination is its address (an email, a URL, a notification destination id), or the owner of the securable for a special one.
function destinationLabel(destination, securable) {
  const id = String(destination?.destination_id || '').trim();
  if (id) return id;
  return `the owner of ${securable.type.toLowerCase()} ${securable.full_name}`;
}

function failureText(got) {
  const data = got?.data && typeof got.data === 'object' ? got.data : {};
  return String(data.message || data.error || data.raw || `the workspace answered ${got ? got.status : 0}`);
}

// The SCIM record of a grantee: a service principal named by its application id, else a user by name, else a group by name.
// A name SCIM does not know returns null, so that grant stays copy-only.
async function resolvePrincipal(call, grantee, cache) {
  const key = grantee.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  if (/["\\]/.test(grantee)) {
    cache.set(key, null);
    return null;
  }
  const lookups = [
    ...(UUID_RE.test(grantee) ? [[`ServicePrincipals`, `applicationId eq "${grantee}"`, 'SERVICE_PRINCIPAL']] : []),
    ['Users', `userName eq "${grantee}"`, 'USER_PRINCIPAL'],
    ['Groups', `displayName eq "${grantee}"`, 'GROUP_PRINCIPAL'],
  ];
  let found = null;
  for (const [resource, filter, principalType] of lookups) {
    const got = await call(`${SCIM}/${resource}?filter=${encodeURIComponent(filter)}`, { method: 'GET' });
    const id = got?.ok && Array.isArray(got.data?.Resources) && got.data.Resources[0] ? String(got.data.Resources[0].id || '') : '';
    if (id) {
      found = { id, principal_type: principalType };
      break;
    }
  }
  cache.set(key, found);
  return found;
}

// Reads the destinations of each requestable securable once, resolves each grantee, and keeps the requests that can be sent.
async function checkAccessRequest({ call, who, statements }) {
  if (!who) return { offered: false, destinations: [], reason: NO_PERSON, pending: [] };
  const requests = requestsOf(statements);
  if (!requests.length) return { offered: false, destinations: [], reason: NO_GRANT, pending: [] };
  const destinationsOfSecurable = new Map();
  let reason = '';
  for (const request of requests) {
    const key = `${request.securable.type}:${request.securable.full_name}`;
    if (destinationsOfSecurable.has(key)) continue;
    const got = await call(destinationsPath(request.securable), { method: 'GET' });
    if (!got.ok) {
      reason = failureText(got);
      destinationsOfSecurable.set(key, []);
      continue;
    }
    const found = Array.isArray(got.data?.destinations) ? got.data.destinations : [];
    destinationsOfSecurable.set(key, found.map((d) => destinationLabel(d, request.securable)));
  }
  const cache = new Map();
  const pending = [];
  const labels = [];
  let unresolved = false;
  for (const request of requests) {
    const destinations = destinationsOfSecurable.get(`${request.securable.type}:${request.securable.full_name}`) || [];
    if (!destinations.length) continue;
    const isPerson = request.grantee.toLowerCase() === String(who).toLowerCase();
    const principal = isPerson ? null : await resolvePrincipal(call, request.grantee, cache);
    if (!isPerson && !principal) {
      unresolved = true;
      continue;
    }
    pending.push({ ...request, principal, destinations });
    labels.push(...destinations);
  }
  const destinations = [...new Set(labels)];
  if (pending.length) return { offered: true, destinations, reason: '', pending };
  if (unresolved) return { offered: false, destinations: [], reason: NO_PRINCIPAL, pending: [] };
  return { offered: false, destinations: [], reason: reason || NO_DESTINATION, pending: [] };
}

// One request object per principal (the API needs each principal once per call). The person's own grants carry no behalf_of.
function requestBodyOf(pending) {
  const byPrincipal = new Map();
  for (const request of pending) {
    const key = request.principal ? request.principal.id : 'requester';
    if (!byPrincipal.has(key)) {
      byPrincipal.set(key, {
        ...(request.principal ? { behalf_of: { id: request.principal.id, principal_type: request.principal.principal_type } } : {}),
        comment: COMMENT,
        securable_permissions: [],
      });
    }
    byPrincipal.get(key).securable_permissions.push({ securable: request.securable, permissions: request.permissions });
  }
  return { requests: [...byPrincipal.values()] };
}

// Sends the requests the check kept. Destinations are read first, so no request is sent where none is set.
async function sendAccessRequest({ call, who, statements }) {
  const check = await checkAccessRequest({ call, who, statements });
  if (!check.offered) return { sent: false, destinations: [], reason: check.reason };
  const got = await call('/api/3.0/rfa/requests', { method: 'POST', body: JSON.stringify(requestBodyOf(check.pending)) });
  if (!got.ok) return { sent: false, destinations: [], reason: failureText(got) };
  return { sent: true, destinations: check.destinations, reason: '' };
}

module.exports = {
  RFA_SCOPE, COMMENT, NO_DESTINATION, NO_PRINCIPAL, requestsOf, parseGrant, destinationsPath, destinationLabel, requestBodyOf,
  checkAccessRequest, sendAccessRequest,
};
