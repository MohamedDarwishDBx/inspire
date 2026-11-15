// Request for Access (Unity Catalog, REST /api/3.0/rfa): a person asks the owner of a securable for the privileges a GRANT in the
// Permission Required dialog names. The request goes out with the signed-in person's own token and leaves behalf_of empty, so the
// requester is that person. Only grants made to that person are requested; a grant to the App or a service principal stays copy-only.
// The API needs the user-app scope 'unity-catalog' (Databricks API reference, Request For Access: "API scopes: unity-catalog").
const RFA_SCOPE = 'unity-catalog';
const RFA_TYPES = new Set(['CATALOG', 'SCHEMA', 'TABLE', 'VOLUME']);
const GRANT_RE = /^GRANT\s+(.+?)\s+ON\s+(CATALOG|SCHEMA|TABLE|VOLUME)\s+(.+?)\s+TO\s+(.+?);?$/i;
const COMMENT = 'Requested through Inspire for a use case I run';
const NO_DESTINATION = 'no one has set up where access requests for these go yet, so ask your Databricks admin to send them the copied text';
const NO_PERSON = 'Inspire cannot tell who is signed in, so it cannot send the request as you';

const cleanName = (text) => String(text || '').replace(/`/g, '').trim();

// One GRANT statement as its securable and privilege, only when the grantee is the signed-in person.
function parseGrant(statement, who) {
  const hit = GRANT_RE.exec(String(statement || '').trim());
  if (!hit) return null;
  const grantee = cleanName(hit[4]).toLowerCase();
  if (!who || grantee !== String(who).toLowerCase()) return null;
  return { type: hit[2].toUpperCase(), fullName: cleanName(hit[3]), privilege: hit[1].trim().toUpperCase().replace(/\s+/g, '_') };
}

// The requestable securables of a dialog: one entry per securable, with its privileges once each.
function requestsOf(statements, who) {
  const bySecurable = new Map();
  for (const statement of Array.isArray(statements) ? statements : []) {
    const grant = parseGrant(statement, who);
    if (!grant || !RFA_TYPES.has(grant.type) || !grant.fullName) continue;
    const key = `${grant.type}:${grant.fullName}`;
    if (!bySecurable.has(key)) bySecurable.set(key, { securable: { type: grant.type, full_name: grant.fullName }, permissions: [] });
    const entry = bySecurable.get(key);
    if (!entry.permissions.includes(grant.privilege)) entry.permissions.push(grant.privilege);
  }
  return [...bySecurable.values()];
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

// Reads the destinations of every requestable securable. A securable with no destination, or a read that fails, is not offered.
async function checkAccessRequest({ call, who, statements }) {
  if (!who) return { offered: false, destinations: [], reason: NO_PERSON, pending: [] };
  const requests = requestsOf(statements, who);
  if (!requests.length) return { offered: false, destinations: [], reason: 'none of these grants can be requested through Request for Access', pending: [] };
  const pending = [];
  const labels = [];
  let reason = '';
  for (const request of requests) {
    const got = await call(destinationsPath(request.securable), { method: 'GET' });
    if (!got.ok) {
      reason = failureText(got);
      continue;
    }
    const found = Array.isArray(got.data?.destinations) ? got.data.destinations : [];
    if (!found.length) continue;
    const destinations = found.map((d) => destinationLabel(d, request.securable));
    pending.push({ ...request, destinations });
    labels.push(...destinations);
  }
  const destinations = [...new Set(labels)];
  if (pending.length) return { offered: true, destinations, reason: '', pending };
  return { offered: false, destinations: [], reason: reason || NO_DESTINATION, pending: [] };
}

// Sends one request per securable the person can request, as the person. Destinations are read first, so no request is sent where none is set.
async function sendAccessRequest({ call, who, statements }) {
  const check = await checkAccessRequest({ call, who, statements });
  if (!check.offered) return { sent: false, destinations: [], reason: check.reason };
  const body = {
    requests: [{
      comment: COMMENT,
      securable_permissions: check.pending.map((p) => ({ securable: p.securable, permissions: p.permissions })),
    }],
  };
  const got = await call('/api/3.0/rfa/requests', { method: 'POST', body: JSON.stringify(body) });
  if (!got.ok) return { sent: false, destinations: [], reason: failureText(got) };
  return { sent: true, destinations: check.destinations, reason: '' };
}

module.exports = { RFA_SCOPE, COMMENT, NO_DESTINATION, requestsOf, parseGrant, destinationsPath, destinationLabel, checkAccessRequest, sendAccessRequest };
